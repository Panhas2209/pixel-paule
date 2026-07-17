#!/usr/bin/env node
/**
 * verify-composition — deterministic UI composition checker.
 *
 * Turns "checked it by eye" into hard, blocking numbers. Renders a target
 * (local file OR URL) headless at several breakpoints and reports layout
 * defects that a taste-build tends to miss when only eyeballed:
 *
 *   1. horizontal-overflow      — documentElement.scrollWidth > clientWidth
 *   2. unequal-sibling-heights  — cards/columns in one flex/grid row differ in height
 *   3. text-width-utilization   — a text block floats narrow, left-anchored, in a wide container
 *   4. contrast                 — effective text vs background below WCAG AA
 *
 * Rendering uses the SYSTEM Chrome/Chromium driven directly over the Chrome
 * DevTools Protocol (CDP) via Node's built-in WebSocket/fetch — no puppeteer,
 * no npm install, no heavy bundle. If no Chrome is found the script degrades
 * gracefully with a clear message instead of crashing (exit 2).
 *
 * Usage:
 *   node verify-composition.mjs <file-or-url> [--breakpoints 390,768,1280]
 *   node verify-composition.mjs --target ./dist/index.html -b 390,1280
 *
 * Output:
 *   stdout — JSON array of violations, each:
 *            { rule, severity, breakpoint, selector, measured, expected, note }
 *   stderr — a human-readable summary line (+ one line per violation)
 *
 * Exit codes:
 *   0  rendered, no severity=error violations (warn/info are non-blocking)
 *   1  rendered, at least one severity=error violation
 *   2  could not verify (no Chrome, launch/navigation failure) — degraded
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Thresholds — the one place to tune the checks.
// ---------------------------------------------------------------------------

const DEFAULT_BREAKPOINTS = [390, 768, 1280];
const VIEWPORT_HEIGHT = 1200;

const OVERFLOW_TOLERANCE_PX = 1; // sub-pixel rounding slack

const SIBLING_HEIGHT_MIN_DIFF_PX = 8; // ignore differences below this
const SIBLING_HEIGHT_MIN_RATIO = 0.04; // AND below 4% of the row's tallest
const SIBLING_MIN_ROW_HEIGHT_PX = 24; // ignore tiny chip/icon rows

const WIDTH_UTILIZATION_RATIO = 0.55; // flag text narrower than 55% of its container
const WIDTH_UTILIZATION_MIN_CONTAINER_PX = 480; // ...only in a genuinely wide container
const WIDTH_UTILIZATION_MIN_TEXT_CHARS = 40; // ...and only for real prose, not short labels
const WIDTH_UTILIZATION_MIN_ASYMMETRY = 0.5; // 0=centered (intentional measure), 1=all slack on one side

const CONTRAST_NORMAL = 4.5; // WCAG AA, normal text
const CONTRAST_LARGE = 3.0; // WCAG AA, large text
const LARGE_TEXT_PX = 24; // 18pt
const LARGE_BOLD_TEXT_PX = 18.66; // 14pt
const LARGE_BOLD_WEIGHT = 700;

const MAX_OFFENDERS_PER_RULE = 8;

// Rendering timeouts
const CHROME_PORT_TIMEOUT_MS = 15000;
const NAV_TIMEOUT_MS = 30000;
const SETTLE_MS = 200;

const SEVERITY_RANK = { error: 0, warn: 1, info: 2 };

// ---------------------------------------------------------------------------
// The in-page probe. Serialized with .toString() and evaluated inside Chrome,
// so it must be fully self-contained (no references to Node scope). All tuning
// arrives via `cfg`. Returns plain JSON: { violations, stats }.
// ---------------------------------------------------------------------------

async function probe(cfg) {
  const round = (n) => Math.round(n);
  const round2 = (n) => Math.round(n * 100) / 100;

  const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + cssEscape(el.id);
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      if (node.id) {
        parts.unshift('#' + cssEscape(node.id));
        break;
      }
      let part = node.tagName.toLowerCase();
      const cls = (node.getAttribute('class') || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((c) => '.' + cssEscape(c))
        .join('');
      part += cls;
      const parent = node.parentElement;
      if (parent) {
        const sames = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (sames.length > 1) part += `:nth-of-type(${sames.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  function isVisible(el, cs) {
    cs = cs || getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Does an ancestor clip/scroll on `axis`, containing any overflow so it never
  // reaches the document? (auto/scroll = contained in a scroller; hidden/clip = clipped)
  function clippedByAncestor(el, axis) {
    let p = el.parentElement;
    while (p && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      const ov = axis === 'x' ? cs.overflowX : cs.overflowY;
      if (ov === 'hidden' || ov === 'clip' || ov === 'auto' || ov === 'scroll') return true;
      p = p.parentElement;
    }
    return false;
  }

  // --- reveal-on-scroll robustness ------------------------------------------
  // Content gated behind IntersectionObserver / opacity-transition must be made
  // visible BEFORE measuring, or we'd measure empty/hidden boxes.
  function injectRevealStyle() {
    const selectors = [
      '[data-reveal]', '[data-aos]', '[data-animate]', '[data-sr]', '[data-scroll]',
      '.reveal', '.reveal-on-scroll', '.fade-in', '.fade-up', '.fade-in-up',
      '.animate-in', '.will-reveal', '.js-reveal', '.scroll-reveal', '.on-scroll',
    ];
    const style = document.createElement('style');
    style.setAttribute('data-verify-composition', 'reveal');
    style.textContent = selectors
      .map(
        (s) =>
          `${s}{opacity:1 !important;visibility:visible !important;transform:none !important;filter:none !important;clip-path:none !important;}`
      )
      .join('\n');
    document.head.appendChild(style);
  }

  function forceOpacityHeuristic() {
    for (const el of document.body.getElementsByTagName('*')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue; // genuinely toggled off
      if (cs.position === 'fixed') continue; // sticky headers / modals
      if (el.getAttribute('aria-hidden') === 'true') continue;
      if (parseFloat(cs.opacity) >= 0.05) continue;
      const transitions = `${cs.transitionProperty || ''} ${cs.transition || ''}`;
      const animated = cs.animationName && cs.animationName !== 'none';
      if (/opacity|transform|all/.test(transitions) || animated) {
        el.style.setProperty('opacity', '1', 'important');
        el.style.setProperty('transform', 'none', 'important');
        el.style.setProperty('visibility', 'visible', 'important');
      }
    }
  }

  async function scrollThrough() {
    const step = Math.max(200, window.innerHeight * 0.8);
    const max = document.documentElement.scrollHeight;
    for (let y = 0; y <= max; y += step) {
      window.scrollTo(0, y);
      await raf2();
    }
    window.scrollTo(0, 0);
    await raf2();
  }

  // --- rule 1: horizontal overflow ------------------------------------------
  function checkOverflow(bp) {
    const de = document.documentElement;
    const vw = de.clientWidth;
    if (de.scrollWidth <= vw + cfg.OVERFLOW_TOLERANCE_PX) return null;

    const rectOffenders = [];
    const spillOffenders = [];
    for (const el of document.body.getElementsByTagName('*')) {
      const cs = getComputedStyle(el);
      if (!isVisible(el, cs)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + cfg.OVERFLOW_TOLERANCE_PX && !clippedByAncestor(el, 'x')) {
        rectOffenders.push({ el, right: r.right, width: r.width, over: r.right - vw });
      }
      if (
        cs.overflowX === 'visible' &&
        el.scrollWidth > el.clientWidth + cfg.OVERFLOW_TOLERANCE_PX &&
        !clippedByAncestor(el, 'x')
      ) {
        spillOffenders.push({
          el,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          over: el.scrollWidth - el.clientWidth,
        });
      }
    }

    // Keep only leaf boxes (an ancestor always inherits a child's overflow).
    const leaves = rectOffenders.filter(
      (o) => !rectOffenders.some((other) => other.el !== o.el && o.el.contains(other.el))
    );

    const combined = [];
    for (const o of leaves) {
      combined.push({
        selector: cssPath(o.el),
        kind: 'box',
        rightPx: round(o.right),
        widthPx: round(o.width),
        overflowPx: round(o.over),
      });
    }
    for (const o of spillOffenders) {
      combined.push({
        selector: cssPath(o.el),
        kind: 'content',
        scrollWidthPx: round(o.scrollWidth),
        clientWidthPx: round(o.clientWidth),
        overflowPx: round(o.over),
      });
    }
    const seen = new Set();
    const offenders = combined
      .filter((o) => (seen.has(o.selector) ? false : seen.add(o.selector)))
      .sort((a, b) => b.overflowPx - a.overflowPx)
      .slice(0, cfg.MAX_OFFENDERS_PER_RULE);

    return {
      rule: 'horizontal-overflow',
      severity: 'error',
      breakpoint: bp,
      selector: offenders[0] ? offenders[0].selector : 'html',
      measured: {
        scrollWidth: round(de.scrollWidth),
        clientWidth: vw,
        overflowPx: round(de.scrollWidth - vw),
        offenders,
      },
      expected: { maxScrollWidth: vw + cfg.OVERFLOW_TOLERANCE_PX },
      note: `Page overflows horizontally by ${round(de.scrollWidth - vw)}px at ${bp}px.${
        offenders[0] ? ` Worst offender: ${offenders[0].selector}.` : ''
      }`,
    };
  }

  // --- rule 2: unequal sibling heights --------------------------------------
  function clusterRows(items) {
    const sorted = [...items].sort((a, b) => a.r.top - b.r.top);
    const rows = [];
    for (const it of sorted) {
      let placed = false;
      for (const row of rows) {
        const top = Math.max(row.top, it.r.top);
        const bottom = Math.min(row.bottom, it.r.bottom);
        const overlap = bottom - top;
        const minH = Math.min(row.bottom - row.top, it.r.height);
        if (overlap > 0.5 * minH) {
          row.items.push(it);
          row.top = Math.min(row.top, it.r.top);
          row.bottom = Math.max(row.bottom, it.r.bottom);
          placed = true;
          break;
        }
      }
      if (!placed) rows.push({ items: [it], top: it.r.top, bottom: it.r.bottom });
    }
    return rows.map((r) => r.items);
  }

  function checkSiblingHeights(bp) {
    const out = [];
    for (const container of document.body.getElementsByTagName('*')) {
      const cs = getComputedStyle(container);
      if (!/(^|\s)(flex|grid|inline-flex|inline-grid)(\s|$)/.test(cs.display)) continue;
      const kids = [...container.children].filter((k) => {
        const kcs = getComputedStyle(k);
        if (kcs.position === 'absolute' || kcs.position === 'fixed') return false;
        return isVisible(k, kcs);
      });
      if (kids.length < 2) continue;
      const items = kids.map((k) => ({ el: k, r: k.getBoundingClientRect() }));
      for (const row of clusterRows(items)) {
        if (row.length < 2) continue;
        const maxH = Math.max(...row.map((it) => it.r.height));
        if (maxH < cfg.SIBLING_MIN_ROW_HEIGHT_PX) continue;
        for (const it of row) {
          const diff = maxH - it.r.height;
          if (diff > cfg.SIBLING_HEIGHT_MIN_DIFF_PX && diff / maxH > cfg.SIBLING_HEIGHT_MIN_RATIO) {
            out.push({
              rule: 'unequal-sibling-heights',
              severity: 'warn',
              breakpoint: bp,
              selector: cssPath(it.el),
              measured: {
                heightPx: round(it.r.height),
                rowMaxHeightPx: round(maxH),
                diffPx: round(diff),
                diffPct: round((100 * diff) / maxH),
                container: cssPath(container),
              },
              expected: { withinPx: cfg.SIBLING_HEIGHT_MIN_DIFF_PX, withinPct: cfg.SIBLING_HEIGHT_MIN_RATIO * 100 },
              note: `Item is ${round(diff)}px (${round((100 * diff) / maxH)}%) shorter than the tallest sibling in its row inside ${cssPath(
                container
              )}. Equalize heights or make the difference intentional.`,
            });
          }
        }
      }
    }
    return out;
  }

  // --- rule 3: text width utilization ---------------------------------------
  function nearestBlockContainer(el) {
    let p = el.parentElement;
    while (p && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      if (/(block|flex|grid|list-item|table|flow-root)/.test(cs.display) && p.clientWidth > el.clientWidth) return p;
      p = p.parentElement;
    }
    return document.body;
  }

  function checkWidthUtilization(bp) {
    const out = [];
    for (const el of document.body.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6')) {
      const cs = getComputedStyle(el);
      if (!isVisible(el, cs)) continue;
      if ((el.textContent || '').trim().length < cfg.WIDTH_UTILIZATION_MIN_TEXT_CHARS) continue;
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const contentW = el.clientWidth - padL - padR;
      const container = nearestBlockContainer(el);
      const ccs = getComputedStyle(container);
      const cPadL = parseFloat(ccs.paddingLeft) || 0;
      const cPadR = parseFloat(ccs.paddingRight) || 0;
      const cBorderL = parseFloat(ccs.borderLeftWidth) || 0;
      const cBorderR = parseFloat(ccs.borderRightWidth) || 0;
      const containerContentW = container.clientWidth - cPadL - cPadR;
      if (containerContentW < cfg.WIDTH_UTILIZATION_MIN_CONTAINER_PX) continue;
      if (contentW >= cfg.WIDTH_UTILIZATION_RATIO * containerContentW) continue;

      // Centered text (symmetric slack) is an intentional readability measure — skip it.
      // Only left-anchored text floating in a wide container is the real "doesn't use the width" smell.
      const r = el.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      const leftSlack = r.left - (cr.left + cPadL + cBorderL);
      const rightSlack = cr.right - cPadR - cBorderR - r.right;
      const totalSlack = leftSlack + rightSlack;
      if (totalSlack <= 0) continue;
      const asymmetry = Math.abs(leftSlack - rightSlack) / totalSlack;
      if (asymmetry < cfg.WIDTH_UTILIZATION_MIN_ASYMMETRY) continue;

      out.push({
        rule: 'text-width-utilization',
        severity: 'info',
        breakpoint: bp,
        selector: cssPath(el),
        measured: {
          textWidthPx: round(contentW),
          containerWidthPx: round(containerContentW),
          ratioPct: round((100 * contentW) / containerContentW),
          leftSlackPx: round(leftSlack),
          rightSlackPx: round(rightSlack),
        },
        expected: { minRatioPct: round(cfg.WIDTH_UTILIZATION_RATIO * 100) },
        note: `Text uses ${round((100 * contentW) / containerContentW)}% of its container and is left-anchored (${round(
          rightSlack
        )}px empty on the right). Widen it, or give it an intentional max-width/centering.`,
      });
    }
    return out;
  }

  // --- rule 4: contrast ------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Resolve ANY CSS color string (named/hex/rgb/hsl/oklch/color()) to straight
  // RGBA by painting it — bulletproof across color syntaxes, incl. OKLCH.
  function resolveColor(str) {
    if (!str) return { r: 0, g: 0, b: 0, a: 0 };
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = str;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  }

  function over(fg, bg) {
    const a = fg.a + bg.a * (1 - fg.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
      g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
      b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
      a,
    };
  }

  // Effective background behind an element's text. Returns null if it can't be
  // determined (a background-image/gradient lies behind the text) — we skip
  // those rather than risk a false contrast error.
  function effectiveBackground(el) {
    const layers = [];
    let node = el;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const bg = resolveColor(cs.backgroundColor);
      if (bg.a > 0) layers.push(bg);
      if (bg.a >= 0.999) break;
      node = node.parentElement;
    }
    layers.push({ r: 255, g: 255, b: 255, a: 1 }); // default canvas
    let res = layers[layers.length - 1];
    for (let i = layers.length - 2; i >= 0; i--) res = over(layers[i], res);
    return res;
  }

  function luminance(c) {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  function contrastRatio(a, b) {
    const l1 = luminance(a);
    const l2 = luminance(b);
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  function toHex(c) {
    const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  }

  function hasDirectText(el) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim().length > 0) return true;
    }
    return false;
  }

  function checkContrast(bp) {
    const out = [];
    const seen = new Set();
    for (const el of document.body.getElementsByTagName('*')) {
      if (!hasDirectText(el)) continue;
      const cs = getComputedStyle(el);
      if (!isVisible(el, cs)) continue;
      if (parseFloat(cs.opacity) === 0) continue;
      const fg0 = resolveColor(cs.color);
      if (fg0.a === 0) continue;
      const bg = effectiveBackground(el);
      if (!bg) continue;
      const fg = fg0.a < 1 ? over(fg0, bg) : fg0;
      const ratio = contrastRatio(fg, bg);
      const fontSize = parseFloat(cs.fontSize) || 16;
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const isLarge =
        fontSize >= cfg.LARGE_TEXT_PX || (fontSize >= cfg.LARGE_BOLD_TEXT_PX && weight >= cfg.LARGE_BOLD_WEIGHT);
      const threshold = isLarge ? cfg.CONTRAST_LARGE : cfg.CONTRAST_NORMAL;
      if (ratio >= threshold - 0.05) continue;
      const selector = cssPath(el);
      const key = `${selector}|${toHex(fg)}|${toHex(bg)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        rule: 'contrast',
        severity: 'error',
        breakpoint: bp,
        selector,
        measured: {
          ratio: round2(ratio),
          foreground: toHex(fg),
          background: toHex(bg),
          fontSizePx: round(fontSize),
          fontWeight: weight,
          largeText: isLarge,
        },
        expected: { minRatio: threshold },
        note: `Text contrast ${round2(ratio)}:1 is below the ${threshold}:1 minimum for ${
          isLarge ? 'large' : 'normal'
        } text (${toHex(fg)} on ${toHex(bg)}).`,
      });
    }
    return out;
  }

  // --- run -------------------------------------------------------------------
  injectRevealStyle();
  await scrollThrough();
  forceOpacityHeuristic();
  await raf2();

  const violations = [];
  const overflow = checkOverflow(cfg.bp);
  if (overflow) violations.push(overflow);
  violations.push(...checkSiblingHeights(cfg.bp));
  violations.push(...checkWidthUtilization(cfg.bp));
  violations.push(...checkContrast(cfg.bp));

  return {
    violations,
    stats: {
      breakpoint: cfg.bp,
      elements: document.body.getElementsByTagName('*').length,
      scrollHeight: document.documentElement.scrollHeight,
    },
  };
}

// ---------------------------------------------------------------------------
// Chrome discovery — env override, then platform defaults, then PATH.
// ---------------------------------------------------------------------------

function chromeCandidates() {
  const env = [process.env.VERIFY_COMPOSITION_CHROME, process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH].filter(
    Boolean
  );
  const platform = process.platform;
  let known = [];
  if (platform === 'darwin') {
    known = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  } else if (platform === 'win32') {
    const roots = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']].filter(
      Boolean
    );
    for (const root of roots) {
      known.push(path.join(root, 'Google/Chrome/Application/chrome.exe'));
      known.push(path.join(root, 'Chromium/Application/chrome.exe'));
      known.push(path.join(root, 'Microsoft/Edge/Application/msedge.exe'));
    }
  } else {
    known = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/usr/bin/microsoft-edge',
    ];
  }
  return [...env, ...known];
}

function findChrome() {
  for (const candidate of chromeCandidates()) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  // last resort: names on PATH
  const names =
    process.platform === 'win32'
      ? ['chrome.exe', 'msedge.exe']
      : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        if (fs.existsSync(full)) return full;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Minimal CDP client over the built-in WebSocket.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : ev.data.toString();
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'CDP error'));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers.get(msg.method) || []) h(msg.params, msg.sessionId);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  waitForEvent(method, sessionId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(method, handler);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      const handler = (params, sid) => {
        if (sessionId && sid !== sessionId) return;
        clearTimeout(timer);
        this.off(method, handler);
        resolve(params);
      };
      this.on(method, handler);
    });
  }

  on(method, cb) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(cb);
  }

  off(method, cb) {
    const list = this.handlers.get(method);
    if (!list) return;
    const i = list.indexOf(cb);
    if (i >= 0) list.splice(i, 1);
  }
}

async function waitForDevToolsPort(userDataDir, timeoutMs) {
  const file = path.join(userDataDir, 'DevToolsActivePort');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const contents = fs.readFileSync(file, 'utf8');
      const port = parseInt(contents.split('\n')[0], 10);
      if (port > 0) return port;
    } catch {
      /* not written yet */
    }
    await sleep(100);
  }
  throw new Error('Chrome did not report a DevTools port in time');
}

function launchChrome(execPath, userDataDir, headlessMode) {
  const args = [
    `--headless=${headlessMode}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--mute-audio',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ];
  // CI runners (and root) can't initialize the Chrome sandbox — match the
  // existing detector convention and disable it only there.
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (process.env.CI || isRoot) args.push('--no-sandbox', '--disable-setuid-sandbox');
  return spawn(execPath, args, { stdio: ['ignore', 'ignore', 'ignore'] });
}

// ---------------------------------------------------------------------------
// Render a target at each breakpoint and collect violations.
// ---------------------------------------------------------------------------

async function renderAndMeasure(execPath, targetUrl, breakpoints) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-composition-'));
  let child = null;
  let ws = null;
  const cleanup = () => {
    try {
      if (ws) ws.close();
    } catch {
      /* ignore */
    }
    try {
      if (child) child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  try {
    // Launch (try modern headless, fall back to legacy for old Chrome builds).
    let port;
    for (const mode of ['new', 'old']) {
      child = launchChrome(execPath, userDataDir, mode);
      try {
        port = await waitForDevToolsPort(userDataDir, CHROME_PORT_TIMEOUT_MS);
        break;
      } catch (err) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        child = null;
        if (mode === 'old') throw err;
      }
    }

    const versionRes = await fetch(`http://127.0.0.1:${port}/json/version`);
    const { webSocketDebuggerUrl } = await versionRes.json();
    ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 10000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('WebSocket connection failed'));
      }, { once: true });
    });

    const cdp = new CDP(ws);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);

    const loaded = cdp.waitForEvent('Page.loadEventFired', sessionId, NAV_TIMEOUT_MS);
    await cdp.send('Page.navigate', { url: targetUrl }, sessionId);
    await loaded;
    await sleep(SETTLE_MS);

    const cfgBase = {
      OVERFLOW_TOLERANCE_PX,
      SIBLING_HEIGHT_MIN_DIFF_PX,
      SIBLING_HEIGHT_MIN_RATIO,
      SIBLING_MIN_ROW_HEIGHT_PX,
      WIDTH_UTILIZATION_RATIO,
      WIDTH_UTILIZATION_MIN_CONTAINER_PX,
      WIDTH_UTILIZATION_MIN_TEXT_CHARS,
      WIDTH_UTILIZATION_MIN_ASYMMETRY,
      CONTRAST_NORMAL,
      CONTRAST_LARGE,
      LARGE_TEXT_PX,
      LARGE_BOLD_TEXT_PX,
      LARGE_BOLD_WEIGHT,
      MAX_OFFENDERS_PER_RULE,
    };

    const violations = [];
    for (const bp of breakpoints) {
      await cdp.send(
        'Emulation.setDeviceMetricsOverride',
        { width: bp, height: VIEWPORT_HEIGHT, deviceScaleFactor: 1, mobile: false, screenWidth: bp, screenHeight: VIEWPORT_HEIGHT },
        sessionId
      );
      await sleep(60);
      const cfg = { ...cfgBase, bp };
      const expression = `(${probe.toString()})(${JSON.stringify(cfg)})`;
      const result = await cdp.send(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        sessionId
      );
      if (result.exceptionDetails) {
        const message = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
        throw new Error(`in-page probe failed at ${bp}px: ${message}`);
      }
      const value = result.result?.value;
      if (value?.violations) violations.push(...value.violations);
    }

    await cdp.send('Target.closeTarget', { targetId });
    return violations;
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { target: null, breakpoints: DEFAULT_BREAKPOINTS, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else if (arg === '--target' || arg === '-t') {
      out.target = argv[++i];
    } else if (arg.startsWith('--target=')) {
      out.target = arg.slice('--target='.length);
    } else if (arg === '--breakpoints' || arg === '-b') {
      out.breakpoints = parseBreakpoints(argv[++i]);
    } else if (arg.startsWith('--breakpoints=')) {
      out.breakpoints = parseBreakpoints(arg.slice('--breakpoints='.length));
    } else if (!arg.startsWith('-') && !out.target) {
      out.target = arg;
    }
  }
  return out;
}

function parseBreakpoints(value) {
  if (!value) return DEFAULT_BREAKPOINTS;
  const list = String(value)
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return list.length ? list : DEFAULT_BREAKPOINTS;
}

function resolveTargetUrl(target) {
  if (/^https?:\/\//i.test(target)) return { url: target, kind: 'url' };
  const abs = path.resolve(process.cwd(), target);
  if (!fs.existsSync(abs)) {
    const err = new Error(`Target file not found: ${abs}`);
    err.code = 'TARGET_NOT_FOUND';
    throw err;
  }
  return { url: pathToFileURL(abs).href, kind: 'file' };
}

const HELP = `verify-composition — deterministic UI composition checker

Usage:
  node verify-composition.mjs <file-or-url> [--breakpoints 390,768,1280]

Options:
  -t, --target <path|url>     target to render (or pass positionally)
  -b, --breakpoints <list>    comma-separated widths (default: 390,768,1280)
  -h, --help                  show this help

Checks: horizontal-overflow, unequal-sibling-heights, text-width-utilization, contrast.
stdout = JSON array of violations; stderr = human summary. Exit 1 on any error-severity
violation, exit 2 if it could not render (no Chrome / navigation failure).`;

function printResult(violations) {
  const sorted = [...violations].sort(
    (a, b) =>
      (a.breakpoint ?? 0) - (b.breakpoint ?? 0) ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      String(a.rule).localeCompare(String(b.rule)) ||
      String(a.selector).localeCompare(String(b.selector))
  );
  process.stdout.write(JSON.stringify(sorted, null, 2) + '\n');
  return sorted;
}

function printSummary(target, breakpoints, sorted) {
  const counts = { error: 0, warn: 0, info: 0 };
  for (const v of sorted) counts[v.severity] = (counts[v.severity] || 0) + 1;
  const status = counts.error > 0 ? 'FAIL' : 'PASS';
  process.stderr.write(
    `verify-composition: ${target} @ [${breakpoints.join(', ')}] — ` +
      `${counts.error} error, ${counts.warn} warn, ${counts.info} info  [${status}]\n`
  );
  for (const v of sorted) {
    const tag = v.severity.toUpperCase().padEnd(5);
    const bp = v.breakpoint == null ? '   -' : `${v.breakpoint}`.padStart(4);
    process.stderr.write(`  ${tag} ${bp}px  ${v.rule}  ${v.selector}\n         ${v.note}\n`);
  }
}

function degrade(message, detail) {
  const violation = {
    rule: 'environment',
    severity: 'error',
    breakpoint: null,
    selector: null,
    measured: { rendered: false },
    expected: { rendered: true },
    note: message,
  };
  process.stdout.write(JSON.stringify([violation], null, 2) + '\n');
  process.stderr.write(`verify-composition: could not verify — ${message}\n`);
  if (detail) process.stderr.write(`  ${detail}\n`);
  process.exit(2);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.target) {
    process.stderr.write(HELP + '\n');
    process.exit(opts.target ? 0 : 2);
  }

  let target;
  try {
    target = resolveTargetUrl(opts.target);
  } catch (err) {
    degrade(err.message);
    return;
  }

  const chrome = findChrome();
  if (!chrome) {
    degrade(
      'no Chrome/Chromium executable found.',
      'Install Google Chrome or Chromium, or point VERIFY_COMPOSITION_CHROME / CHROME_PATH at the binary.'
    );
    return;
  }

  let violations;
  try {
    violations = await renderAndMeasure(chrome, target.url, opts.breakpoints);
  } catch (err) {
    degrade(`rendering failed — ${err.message}`, `Chrome: ${chrome}`);
    return;
  }

  const sorted = printResult(violations);
  printSummary(opts.target, opts.breakpoints, sorted);
  const hasError = sorted.some((v) => v.severity === 'error');
  process.exit(hasError ? 1 : 0);
}

main().catch((err) => {
  degrade(`unexpected error — ${err.message}`);
});
