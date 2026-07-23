#!/usr/bin/env node
/**
 * verify-a11y — deterministic accessibility (WCAG 2.2 AA) checker.
 *
 * The third quality gate, alongside verify-composition.mjs (layout) and
 * verify-seo-perf.mjs (findability). This one measures the structural and
 * semantic accessibility failures a page ships when it looks fine but locks
 * out keyboard and assistive-tech users: controls with no accessible name,
 * links/buttons with empty labels, disabled zoom, invalid ARIA, broken
 * heading order, missing landmarks.
 *
 * NON-OVERLAPPING BY DESIGN. To stay a clean lane and not re-litigate the
 * sibling gates, this script deliberately does NOT re-check:
 *   - colour contrast          → verify-composition.mjs (Rule 4)
 *   - <img alt> coverage        → verify-seo-perf.mjs (img-alt-missing)
 *   - <html lang> / charset     → verify-seo-perf.mjs
 * Run all three for full coverage. What lives here is a11y-specific and not
 * measured anywhere else.
 *
 * What it checks (rule → WCAG SC):
 *   control-unlabeled      — form control with no programmatic label   (1.3.1 / 4.1.2)
 *   input-image-no-alt     — <input type=image> without alt            (1.1.1)
 *   link-empty             — <a href> with no accessible name          (2.4.4 / 4.1.2)
 *   button-empty           — <button> with no accessible name          (4.1.2)
 *   viewport-zoom-disabled — user-scalable=no / maximum-scale<2        (1.4.4)
 *   heading-order-skip     — heading level jumps (e.g. h2→h4)          (1.3.1)
 *   heading-empty          — heading element with no text              (1.3.1 / 2.4.6)
 *   landmark-main-missing  — no <main> / role=main                     (1.3.1 / 2.4.1)
 *   landmark-main-multiple — more than one main landmark               (1.3.1)
 *   aria-role-invalid      — role="…" not a known ARIA role            (4.1.2)
 *   aria-attr-invalid      — aria-* attribute not in the ARIA spec     (4.1.2)
 *   aria-hidden-focusable  — aria-hidden on a natively focusable node  (1.3.1 / 4.1.2)
 *   tabindex-positive      — tabindex > 0 (breaks focus order)         (2.4.3)
 *   iframe-title-missing   — <iframe> without a title                  (2.4.1 / 4.1.2)
 *   id-duplicate           — duplicate id (breaks for=/aria refs)      (1.3.1 / 4.1.2)
 *   ax-empty-name          — (Chrome) interactive AX node, empty name  (4.1.2)
 *
 * The static pass needs no browser and works on a local file OR a URL. The
 * optional runtime pass renders via the SYSTEM Chrome over CDP (no npm
 * install) and reads the real accessibility tree to catch empty accessible
 * names that static heuristics can't resolve (e.g. wrapped labels, dynamic
 * content). It degrades gracefully if no Chrome is present.
 *
 * Usage:
 *   node verify-a11y.mjs <file-or-url>
 *   node verify-a11y.mjs ./dist/index.html --no-chrome
 *   node verify-a11y.mjs https://example.com --json
 *
 * Output:
 *   stdout — JSON array of findings, each:
 *            { rule, category, severity, context, measured, expected, note }
 *   stderr — a human-readable summary line (+ one line per finding)
 *
 * Exit codes:
 *   0  analysed, no severity=error findings (warn/info are non-blocking)
 *   1  analysed, at least one severity=error finding
 *   2  could not analyse (target unreadable) — degraded
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Thresholds / tunables.
// ---------------------------------------------------------------------------

const CHROME_PORT_TIMEOUT_MS = 15000;
const NAV_TIMEOUT_MS = 30000;
const SETTLE_MS = 600;

const SEVERITY_RANK = { error: 0, warn: 1, info: 2 };

// Interactive AX roles whose accessible name must not be empty.
const NAMED_AX_ROLES = new Set(['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'searchbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'listbox']);

// The WAI-ARIA 1.2 role vocabulary (abstract roles excluded; they may not be used).
const ARIA_ROLES = new Set([
  'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'button', 'caption', 'cell', 'checkbox', 'code', 'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition', 'deletion', 'dialog', 'directory', 'document', 'emphasis', 'feed', 'figure', 'form', 'generic', 'grid', 'gridcell', 'group', 'heading', 'img', 'insertion', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'meter', 'navigation', 'none', 'note', 'option', 'paragraph', 'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'strong', 'subscript', 'superscript', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox', 'time', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem',
]);

// aria-* attributes defined by WAI-ARIA 1.2/1.3.
const ARIA_ATTRS = new Set([
  'aria-activedescendant', 'aria-atomic', 'aria-autocomplete', 'aria-braillelabel', 'aria-brailleroledescription', 'aria-busy', 'aria-checked', 'aria-colcount', 'aria-colindex', 'aria-colindextext', 'aria-colspan', 'aria-controls', 'aria-current', 'aria-describedby', 'aria-description', 'aria-details', 'aria-disabled', 'aria-dropeffect', 'aria-errormessage', 'aria-expanded', 'aria-flowto', 'aria-grabbed', 'aria-haspopup', 'aria-hidden', 'aria-invalid', 'aria-keyshortcuts', 'aria-label', 'aria-labelledby', 'aria-level', 'aria-live', 'aria-modal', 'aria-multiline', 'aria-multiselectable', 'aria-orientation', 'aria-owns', 'aria-placeholder', 'aria-posinset', 'aria-pressed', 'aria-readonly', 'aria-relevant', 'aria-required', 'aria-roledescription', 'aria-rowcount', 'aria-rowindex', 'aria-rowindextext', 'aria-rowspan', 'aria-selected', 'aria-setsize', 'aria-sort', 'aria-valuemax', 'aria-valuemin', 'aria-valuenow', 'aria-valuetext',
]);

// Input types that carry their own name from value/alt, not a <label>.
const SELF_LABELLING_INPUTS = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

// ---------------------------------------------------------------------------
// Tiny HTML helpers (regex-based, dependency-free) — same approach as the
// sibling gates: we only ever read attributes/inner-text off known tags.
// ---------------------------------------------------------------------------

function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function parseAttrs(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const body = tag.replace(/^<\s*\/?\s*[a-zA-Z0-9-]+/, '').replace(/\/?>$/, '');
  let m;
  while ((m = re.exec(body)) !== null) {
    const key = m[1].toLowerCase();
    attrs[key] = m[3] ?? m[4] ?? m[5] ?? '';
  }
  return attrs;
}

/** All open-tags of a given name → array of { raw, attrs }. */
function findTags(html, name) {
  const re = new RegExp(`<${name}\\b[^>]*>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push({ raw: m[0], attrs: parseAttrs(m[0]) });
  return out;
}

/** Elements with inner content, e.g. <a …>…</a> → { attrs, inner }. */
function findElements(html, name) {
  const re = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)<\\/${name}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push({ attrs: parseAttrs('<x ' + m[1] + '>'), inner: m[2] });
  return out;
}

/** Every open tag in document order → { name, attrs }. */
function allTags(html) {
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push({ name: m[1].toLowerCase(), attrs: parseAttrs(m[0]) });
  return out;
}

function textOf(inner) {
  return inner
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Best-effort accessible name for an interactive element from static HTML.
 * Covers the common naming vectors; aria-labelledby is treated as "named"
 * because we can't resolve the reference target statically (the runtime AX
 * pass is authoritative for those).
 */
function accessibleName(el) {
  const t = textOf(el.inner);
  if (t) return t;
  if ((el.attrs['aria-label'] || '').trim()) return el.attrs['aria-label'].trim();
  if ((el.attrs['aria-labelledby'] || '').trim()) return '[aria-labelledby]';
  if ((el.attrs['title'] || '').trim()) return el.attrs['title'].trim();
  const imgAlt = [...el.inner.matchAll(/<img\b[^>]*\balt\s*=\s*("([^"]*)"|'([^']*)')/gi)]
    .map((m) => (m[2] ?? m[3] ?? '').trim())
    .find(Boolean);
  if (imgAlt) return imgAlt;
  if (/<svg\b[\s\S]*?<title\b[^>]*>\s*\S/i.test(el.inner)) return '[svg-title]';
  if (/\brole\s*=\s*("|')?img\1[^>]*\baria-label\s*=/i.test(el.inner)) return '[img-aria-label]';
  return '';
}

// ---------------------------------------------------------------------------
// Static analysis — the heart of the checker.
// ---------------------------------------------------------------------------

function analyseHtml(rawHtml) {
  const findings = [];
  const add = (rule, severity, context, measured, expected, note) =>
    findings.push({ rule, category: 'a11y', severity, context, measured, expected, note });

  const html = stripComments(rawHtml);

  // ---- Zoom / viewport (1.4.4) ----------------------------------------
  const viewport = findTags(html, 'meta').find((m) => (m.attrs.name || '').toLowerCase() === 'viewport');
  if (viewport) {
    const content = (viewport.attrs.content || '').toLowerCase();
    const maxScale = (content.match(/maximum-scale\s*=\s*([0-9.]+)/) || [])[1];
    if (/user-scalable\s*=\s*(no|0)/.test(content))
      add('viewport-zoom-disabled', 'error', 'meta[viewport]', 'user-scalable=no', 'zoom allowed', 'Disabling pinch-zoom fails WCAG 1.4.4. Remove user-scalable=no.');
    else if (maxScale !== undefined && parseFloat(maxScale) < 2)
      add('viewport-zoom-disabled', 'warn', 'meta[viewport]', `maximum-scale=${maxScale}`, '≥ 2 (or unset)', 'maximum-scale below 2 restricts zoom (WCAG 1.4.4).');
  }

  // ---- Landmarks (1.3.1 / 2.4.1) --------------------------------------
  const mains = findTags(html, 'main').length + allTags(html).filter((t) => t.name !== 'main' && (t.attrs.role || '').toLowerCase() === 'main').length;
  if (mains === 0)
    add('landmark-main-missing', 'warn', 'document', 'no main landmark', 'one <main> / role=main', 'No main landmark — screen-reader users can\'t jump to primary content.');
  else if (mains > 1)
    add('landmark-main-multiple', 'warn', 'document', `${mains} main landmarks`, 'exactly one', 'Multiple main landmarks confuse assistive tech; keep one per page.');

  // ---- Headings (1.3.1 / 2.4.6) ---------------------------------------
  const headingRe = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
  const headings = [];
  let hm;
  while ((hm = headingRe.exec(html)) !== null) headings.push({ level: Number(hm[1]), attrs: parseAttrs('<x ' + hm[2] + '>'), text: textOf(hm[3]) });
  let emptyHeadings = 0;
  for (const h of headings) if (!h.text && !(h.attrs['aria-label'] || '').trim() && !(h.attrs['aria-labelledby'] || '').trim()) emptyHeadings += 1;
  if (emptyHeadings > 0)
    add('heading-empty', 'warn', '<h1>–<h6>', `${emptyHeadings} empty heading(s)`, 'headings have text', 'Empty headings create phantom entries in the screen-reader outline.');
  let prev = 0;
  let skips = 0;
  for (const h of headings) {
    if (prev && h.level > prev + 1) skips += 1;
    prev = h.level;
  }
  if (skips > 0)
    add('heading-order-skip', 'warn', 'heading outline', `${skips} level jump(s)`, 'no skipped levels', 'Heading levels jump (e.g. h2→h4); the document outline has gaps (WCAG 1.3.1).');

  // ---- Form controls need a programmatic label (1.3.1 / 4.1.2) --------
  const labelFor = new Set(findTags(html, 'label').map((l) => (l.attrs.for || '').trim()).filter(Boolean));
  const controls = [...findTags(html, 'input'), ...findTags(html, 'select'), ...findTags(html, 'textarea')];
  let unlabeled = 0;
  let imageNoAlt = 0;
  for (const c of controls) {
    const type = (c.attrs.type || 'text').toLowerCase();
    if (type === 'image') {
      if (!(c.attrs.alt || '').trim() && !(c.attrs['aria-label'] || '').trim() && !(c.attrs['aria-labelledby'] || '').trim()) imageNoAlt += 1;
      continue;
    }
    if (SELF_LABELLING_INPUTS.has(type)) continue;
    if ((c.attrs['aria-hidden'] || '').toLowerCase() === 'true') continue;
    const id = (c.attrs.id || '').trim();
    const named = (id && labelFor.has(id)) || (c.attrs['aria-label'] || '').trim() || (c.attrs['aria-labelledby'] || '').trim() || (c.attrs.title || '').trim();
    if (!named) unlabeled += 1;
  }
  if (imageNoAlt > 0)
    add('input-image-no-alt', 'error', 'input[type=image]', `${imageNoAlt} without alt`, 'alt text present', 'Image submit buttons need alt text as their accessible name (WCAG 1.1.1).');
  if (unlabeled > 0)
    // WARN, not error: a wrapping <label> or a runtime-resolved name can't be
    // seen statically. The optional Chrome AX pass turns real cases into errors.
    add('control-unlabeled', 'warn', 'form control', `${unlabeled} control(s) with no static label`, 'label / aria-label / aria-labelledby / title', 'Form control has no label a parser can see. Confirm a wrapping <label> exists, or add one. The --chrome pass verifies the real accessible name.');

  // ---- Links & buttons need an accessible name (2.4.4 / 4.1.2) --------
  let emptyLinks = 0;
  for (const a of findElements(html, 'a')) {
    if (!(a.attrs.href || '').trim()) continue; // not a link without href
    if ((a.attrs['aria-hidden'] || '').toLowerCase() === 'true') continue;
    if (!accessibleName(a)) emptyLinks += 1;
  }
  if (emptyLinks > 0)
    add('link-empty', 'error', '<a href>', `${emptyLinks} empty link(s)`, 'discernible link text', 'Links with no text/aria-label are unusable for screen readers (WCAG 2.4.4). Icon links need aria-label.');

  let emptyButtons = 0;
  for (const b of findElements(html, 'button')) {
    if ((b.attrs['aria-hidden'] || '').toLowerCase() === 'true') continue;
    if (!accessibleName(b) && !(b.attrs.value || '').trim()) emptyButtons += 1;
  }
  if (emptyButtons > 0)
    add('button-empty', 'error', '<button>', `${emptyButtons} empty button(s)`, 'discernible button label', 'Buttons with no text/aria-label have no accessible name (WCAG 4.1.2). Icon buttons need aria-label.');

  // ---- ARIA validity + focus (4.1.2 / 2.4.3) --------------------------
  const tags = allTags(html);
  const invalidRoles = new Set();
  const invalidAttrs = new Set();
  let ariaHiddenFocusable = 0;
  let positiveTabindex = 0;
  const focusableTag = (t) => (t.name === 'a' && 'href' in t.attrs) || t.name === 'button' || (t.name === 'input' && (t.attrs.type || '').toLowerCase() !== 'hidden') || t.name === 'select' || t.name === 'textarea';
  for (const t of tags) {
    const role = (t.attrs.role || '').trim().toLowerCase();
    if (role) for (const r of role.split(/\s+/)) if (r && !ARIA_ROLES.has(r) && !r.startsWith('doc-')) invalidRoles.add(r);
    for (const k of Object.keys(t.attrs)) if (k.startsWith('aria-') && !ARIA_ATTRS.has(k)) invalidAttrs.add(k);
    const tabindex = t.attrs.tabindex;
    if (tabindex !== undefined && /^\+?\d+$/.test(tabindex.trim()) && Number(tabindex) > 0) positiveTabindex += 1;
    if ((t.attrs['aria-hidden'] || '').toLowerCase() === 'true' && focusableTag(t) && (t.attrs.tabindex || '').trim() !== '-1') ariaHiddenFocusable += 1;
  }
  if (invalidRoles.size > 0)
    add('aria-role-invalid', 'warn', 'role="…"', [...invalidRoles].slice(0, 6).join(', '), 'a valid ARIA role', 'Unknown ARIA role(s) are ignored by assistive tech (WCAG 4.1.2).');
  if (invalidAttrs.size > 0)
    add('aria-attr-invalid', 'warn', 'aria-*', [...invalidAttrs].slice(0, 6).join(', '), 'a valid aria-* attribute', 'Misspelled/unknown aria-* attribute(s) do nothing (WCAG 4.1.2).');
  if (ariaHiddenFocusable > 0)
    add('aria-hidden-focusable', 'warn', '[aria-hidden]', `${ariaHiddenFocusable} focusable node(s)`, 'not focusable while hidden', 'aria-hidden="true" on a focusable element hides it from AT but keeps it in the tab order — a confusing dead stop (WCAG 4.1.2).');
  if (positiveTabindex > 0)
    add('tabindex-positive', 'warn', '[tabindex]', `${positiveTabindex} positive tabindex`, 'tabindex 0 or -1', 'Positive tabindex overrides natural focus order and is almost always a bug (WCAG 2.4.3).');

  // ---- iframes need a title (2.4.1 / 4.1.2) ---------------------------
  const iframesNoTitle = findTags(html, 'iframe').filter((f) => !(f.attrs.title || '').trim() && (f.attrs['aria-hidden'] || '').toLowerCase() !== 'true');
  if (iframesNoTitle.length > 0)
    add('iframe-title-missing', 'warn', '<iframe>', `${iframesNoTitle.length} without title`, 'title="…"', 'Frames need a title so screen-reader users know what they contain (WCAG 4.1.2).');

  // ---- Duplicate ids (breaks for=/aria-* references) ------------------
  const idCounts = new Map();
  for (const t of tags) {
    const id = (t.attrs.id || '').trim();
    if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
  }
  const dups = [...idCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  if (dups.length > 0)
    add('id-duplicate', 'warn', 'id="…"', dups.slice(0, 6).join(', '), 'unique ids', 'Duplicate ids break label for=, aria-labelledby, and aria-controls references (WCAG 1.3.1/4.1.2).');

  return findings;
}

// ---------------------------------------------------------------------------
// Optional runtime pass — real accessibility tree via system Chrome over CDP.
// Mirrors the sibling gates' launcher so no extra dependency is added.
// ---------------------------------------------------------------------------

function chromeCandidates() {
  const env = [process.env.VERIFY_COMPOSITION_CHROME, process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH].filter(Boolean);
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
    const roots = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']].filter(Boolean);
    for (const root of roots) {
      known.push(path.join(root, 'Google/Chrome/Application/chrome.exe'));
      known.push(path.join(root, 'Chromium/Application/chrome.exe'));
      known.push(path.join(root, 'Microsoft/Edge/Application/msedge.exe'));
    }
  } else {
    known = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'];
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
  const names = process.platform === 'win32' ? ['chrome.exe', 'msedge.exe'] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
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
  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }
}

async function waitForDevToolsPort(userDataDir, timeoutMs) {
  const start = Date.now();
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  while (Date.now() - start < timeoutMs) {
    try {
      if (fs.existsSync(portFile)) {
        const content = fs.readFileSync(portFile, 'utf8').split('\n');
        const port = parseInt(content[0], 10);
        if (port) return port;
      }
    } catch {
      /* ignore */
    }
    await sleep(100);
  }
  throw new Error('Chrome DevTools port did not open in time');
}

function launchChrome(execPath, userDataDir, headlessMode) {
  const args = [
    headlessMode,
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-gpu',
    '--hide-scrollbars',
    '--mute-audio',
    'about:blank',
  ].filter(Boolean);
  return spawn(execPath, args, { stdio: 'ignore', detached: false });
}

async function measureRuntime(execPath, targetUrl) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-'));
  let child;
  const findings = [];
  try {
    for (const mode of ['--headless=new', '--headless']) {
      try {
        child = launchChrome(execPath, userDataDir, mode);
        await waitForDevToolsPort(userDataDir, CHROME_PORT_TIMEOUT_MS);
        break;
      } catch (e) {
        try {
          child && child.kill();
        } catch {}
        child = null;
        if (mode === '--headless') throw e;
      }
    }
    const port = await waitForDevToolsPort(userDataDir, CHROME_PORT_TIMEOUT_MS);
    const listRes = await fetch(`http://127.0.0.1:${port}/json/version`);
    const { webSocketDebuggerUrl } = await listRes.json();
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const cdp = new CDP(ws);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Accessibility.enable', {}, sessionId);

    const loaded = new Promise((resolve) => {
      cdp.on('Page.loadEventFired', () => resolve());
      setTimeout(resolve, NAV_TIMEOUT_MS);
    });
    await cdp.send('Page.navigate', { url: targetUrl }, sessionId);
    await loaded;
    await sleep(SETTLE_MS);

    const { nodes } = await cdp.send('Accessibility.getFullAXTree', {}, sessionId);
    const offenders = [];
    for (const n of nodes || []) {
      if (n.ignored) continue;
      const role = n.role && n.role.value;
      if (!NAMED_AX_ROLES.has(role)) continue;
      const name = (n.name && typeof n.name.value === 'string' ? n.name.value : '').trim();
      if (!name) offenders.push(role);
    }

    await cdp.send('Target.closeTarget', { targetId });
    ws.close();

    if (offenders.length > 0) {
      const byRole = {};
      for (const r of offenders) byRole[r] = (byRole[r] || 0) + 1;
      const summary = Object.entries(byRole)
        .map(([r, n]) => `${n} ${r}`)
        .join(', ');
      findings.push({ rule: 'ax-empty-name', category: 'a11y', severity: 'error', context: 'accessibility tree', measured: `${offenders.length} node(s): ${summary}`, expected: 'every interactive node has a name', note: 'Chrome\'s accessibility tree reports interactive elements with an empty accessible name — screen readers announce them as bare "button"/"link" (WCAG 4.1.2).' });
    }
    return { findings, ok: true };
  } finally {
    try {
      child && child.kill();
    } catch {}
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Input / output plumbing.
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { target: null, json: false, chrome: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--no-chrome') opts.chrome = false;
    else if (a === '--target') opts.target = argv[++i];
    else if (!a.startsWith('-') && !opts.target) opts.target = a;
  }
  return opts;
}

function isUrl(s) {
  return /^https?:\/\//i.test(s);
}

async function loadHtml(target) {
  if (isUrl(target)) {
    const res = await fetch(target, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${target}`);
    return { html: await res.text(), url: target };
  }
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
  return { html: fs.readFileSync(abs, 'utf8'), url: pathToFileURL(abs).href };
}

function printSummary(target, findings) {
  const sorted = [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const errors = sorted.filter((f) => f.severity === 'error').length;
  const warns = sorted.filter((f) => f.severity === 'warn').length;
  const infos = sorted.filter((f) => f.severity === 'info').length;
  process.stderr.write(`\nverify-a11y: ${target}\n`);
  process.stderr.write(`  ${errors} error · ${warns} warn · ${infos} info\n`);
  for (const f of sorted) {
    const tag = f.severity.toUpperCase().padEnd(5);
    process.stderr.write(`  [${tag}] ${f.category}/${f.rule} — ${f.measured} (expected ${f.expected})\n`);
    if (f.note) process.stderr.write(`          ${f.note}\n`);
  }
  if (errors === 0) process.stderr.write(`\n✓ no blocking a11y findings\n`);
  else process.stderr.write(`\n✗ ${errors} blocking finding(s) — fix or justify before "done"\n`);
}

function degrade(message, detail) {
  const finding = [{ rule: 'environment', category: 'environment', severity: 'info', context: 'runner', measured: 'not analysed', expected: 'analysed', note: detail || message }];
  process.stdout.write(JSON.stringify(finding, null, 2) + '\n');
  process.stderr.write(`verify-a11y: ${message}\n`);
  process.exit(2);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.target) {
    process.stderr.write('Usage: node verify-a11y.mjs <file-or-url> [--no-chrome] [--json]\n');
    process.exit(2);
  }

  let loaded;
  try {
    loaded = await loadHtml(opts.target);
  } catch (e) {
    return degrade(`could not read target: ${e.message}`, e.message);
  }

  const findings = analyseHtml(loaded.html);

  if (opts.chrome) {
    const chrome = findChrome();
    if (chrome) {
      try {
        const { findings: rt } = await measureRuntime(chrome, loaded.url);
        findings.push(...rt);
      } catch (e) {
        findings.push({ rule: 'runtime-skipped', category: 'a11y', severity: 'info', context: 'runtime', measured: 'skipped', expected: 'measured', note: `Runtime AX pass failed (${e.message}); static findings still apply.` });
      }
    } else {
      findings.push({ rule: 'runtime-skipped', category: 'a11y', severity: 'info', context: 'runtime', measured: 'no Chrome', expected: 'measured', note: 'No Chrome found — ran static analysis only. Set CHROME_PATH for the accessibility-tree pass.' });
    }
  }

  process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
  if (!opts.json) printSummary(opts.target, findings);

  const hasError = findings.some((f) => f.severity === 'error');
  process.exit(hasError ? 1 : 0);
}

main().catch((err) => degrade(`unexpected failure: ${err.message}`, err.stack));
