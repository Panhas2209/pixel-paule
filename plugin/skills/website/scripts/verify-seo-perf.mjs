#!/usr/bin/env node
/**
 * verify-seo-perf — deterministic SEO / metadata / social / performance checker.
 *
 * The companion to verify-composition.mjs. Where that script measures visual
 * layout, this one measures the things a beautiful page still routinely ships
 * broken: search metadata, social-share cards, structured data, and load-time
 * performance. All as hard, blocking numbers instead of "looks fine".
 *
 * What it checks (category → rules):
 *   seo             — <title>, meta description, single <h1>, <html lang>,
 *                     <meta charset>, viewport, canonical, robots noindex,
 *                     image alt coverage, favicon
 *   opengraph       — og:title / og:description / og:image / og:type / og:url
 *   twitter         — twitter:card / title / description / image
 *   structured-data — JSON-LD present + valid JSON
 *   performance     — render-blocking head scripts, images without width/height
 *                     (CLS), missing lazy-loading, @import, oversized inline
 *                     blocks, huge data: URIs, fonts without display=swap,
 *                     missing preconnect for third-party font origins, doc size
 *   performance*    — (optional, needs Chrome) real request count, transferred
 *                     bytes, DOMContentLoaded + load timing
 *
 * The static pass needs no browser and works on a local file OR a URL. The
 * optional runtime pass renders via the SYSTEM Chrome over CDP (no npm install,
 * same technique as verify-composition.mjs) and degrades gracefully if no
 * Chrome is present.
 *
 * Usage:
 *   node verify-seo-perf.mjs <file-or-url>
 *   node verify-seo-perf.mjs ./dist/index.html --no-chrome
 *   node verify-seo-perf.mjs https://example.com --json
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
// Thresholds — the one place to tune the checks.
// ---------------------------------------------------------------------------

const TITLE_MIN = 10;
const TITLE_MAX = 60;
const DESC_MIN = 50;
const DESC_MAX = 160;
const DATA_URI_MAX_BYTES = 100 * 1024; // inline base64 asset warning
const INLINE_STYLE_MAX_BYTES = 100 * 1024;
const INLINE_SCRIPT_MAX_BYTES = 150 * 1024;
const DOC_SIZE_WARN_BYTES = 250 * 1024; // raw HTML document
const RUNTIME_REQUEST_WARN = 60; // total requests
const RUNTIME_BYTES_WARN = 2 * 1024 * 1024; // total transferred
const RUNTIME_LOAD_WARN_MS = 4000; // load event
const RUNTIME_DCL_WARN_MS = 2500; // DOMContentLoaded

const CHROME_PORT_TIMEOUT_MS = 15000;
const NAV_TIMEOUT_MS = 30000;
const SETTLE_MS = 600;

const SEVERITY_RANK = { error: 0, warn: 1, info: 2 };

// ---------------------------------------------------------------------------
// Tiny HTML helpers (regex-based, dependency-free). Good enough for metadata:
// we only ever read attributes off head/meta/link/script/img/html tags.
// ---------------------------------------------------------------------------

function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/** All tags of a given name → array of { raw, attrs }. */
function findTags(html, name) {
  const re = new RegExp(`<${name}\\b[^>]*>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push({ raw: m[0], attrs: parseAttrs(m[0]) });
  return out;
}

/** Elements with inner text, e.g. <title>…</title> or <h1>…</h1>. */
function findElements(html, name) {
  const re = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)<\\/${name}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push({ attrs: parseAttrs('<x ' + m[1] + '>'), inner: m[2] });
  return out;
}

function parseAttrs(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  // skip the tag name itself
  const body = tag.replace(/^<\s*[a-zA-Z0-9-]+/, '').replace(/\/?>$/, '');
  let m;
  while ((m = re.exec(body)) !== null) {
    const key = m[1].toLowerCase();
    const val = m[3] ?? m[4] ?? m[5] ?? '';
    attrs[key] = val;
  }
  return attrs;
}

function textOf(inner) {
  return inner
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Read a <meta> value by name= or property=. Returns the content or null. */
function metaContent(metas, key) {
  const k = key.toLowerCase();
  for (const t of metas) {
    const id = (t.attrs.name || t.attrs.property || t.attrs.itemprop || '').toLowerCase();
    if (id === k) return t.attrs.content ?? '';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Static analysis — the heart of the checker.
// ---------------------------------------------------------------------------

function analyseHtml(rawHtml, ctx) {
  const findings = [];
  const add = (rule, category, severity, context, measured, expected, note) =>
    findings.push({ rule, category, severity, context, measured, expected, note });

  const html = stripComments(rawHtml);
  const head = (html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i) || [null, html])[1] || html;
  const metas = findTags(html, 'meta');
  const links = findTags(html, 'link');
  const scripts = findElements(html, 'script');
  const imgs = findTags(html, 'img');
  const htmlTag = findTags(html, 'html')[0];

  // ---- SEO -------------------------------------------------------------
  const titles = findElements(html, 'title');
  if (titles.length === 0) {
    add('title-missing', 'seo', 'error', '<head>', 'none', 'one <title>', 'No <title> — the single most important SEO tag.');
  } else {
    const t = textOf(titles[0].inner);
    if (t.length === 0)
      add('title-empty', 'seo', 'error', '<title>', 'empty', `${TITLE_MIN}–${TITLE_MAX} chars`, 'Title tag is empty.');
    else if (t.length < TITLE_MIN)
      add('title-short', 'seo', 'warn', '<title>', `${t.length} chars`, `≥ ${TITLE_MIN} chars`, `Title too short: "${t}"`);
    else if (t.length > TITLE_MAX)
      add('title-long', 'seo', 'warn', '<title>', `${t.length} chars`, `≤ ${TITLE_MAX} chars`, 'Title likely truncated in SERPs.');
  }

  const desc = metaContent(metas, 'description');
  if (desc === null)
    add('meta-description-missing', 'seo', 'warn', '<head>', 'none', 'meta description', 'No meta description — Google may auto-generate a worse one.');
  else if (desc.trim().length < DESC_MIN)
    add('meta-description-short', 'seo', 'warn', 'meta[name=description]', `${desc.trim().length} chars`, `${DESC_MIN}–${DESC_MAX} chars`, 'Description too thin.');
  else if (desc.trim().length > DESC_MAX)
    add('meta-description-long', 'seo', 'info', 'meta[name=description]', `${desc.trim().length} chars`, `≤ ${DESC_MAX} chars`, 'Description likely truncated.');

  const h1s = findElements(html, 'h1');
  if (h1s.length === 0)
    add('h1-missing', 'seo', 'error', 'document', '0', 'exactly one <h1>', 'No <h1> — page has no primary heading.');
  else if (h1s.length > 1)
    add('h1-multiple', 'seo', 'warn', 'document', `${h1s.length}`, 'exactly one <h1>', 'Multiple <h1> dilute the page topic.');

  if (!htmlTag || !htmlTag.attrs.lang)
    add('html-lang-missing', 'seo', 'warn', '<html>', 'none', 'lang="…"', 'No lang attribute — hurts a11y and international SEO.');

  const hasCharset = metas.some((m) => 'charset' in m.attrs || (m.attrs['http-equiv'] || '').toLowerCase() === 'content-type');
  if (!hasCharset)
    add('charset-missing', 'seo', 'warn', '<head>', 'none', '<meta charset="utf-8">', 'No charset declared.');

  const viewport = metaContent(metas, 'viewport');
  if (viewport === null)
    add('viewport-missing', 'seo', 'error', '<head>', 'none', 'responsive viewport meta', 'No viewport meta — mobile rendering breaks.');

  const canonical = links.some((l) => (l.attrs.rel || '').toLowerCase().split(/\s+/).includes('canonical'));
  if (!canonical)
    add('canonical-missing', 'seo', 'info', '<head>', 'none', 'rel="canonical"', 'No canonical URL — risk of duplicate-content dilution.');

  const robots = (metaContent(metas, 'robots') || '').toLowerCase();
  if (robots.includes('noindex'))
    add('robots-noindex', 'seo', 'error', 'meta[name=robots]', 'noindex', 'indexable', 'Page is set to noindex — will not appear in search. Intentional?');

  const imgsMissingAlt = imgs.filter((i) => !('alt' in i.attrs));
  if (imgsMissingAlt.length > 0)
    add('img-alt-missing', 'seo', 'warn', '<img>', `${imgsMissingAlt.length}/${imgs.length} images`, 'all images have alt', 'Missing alt text hurts a11y and image SEO. Decorative images need alt="".');

  const favicon = links.some((l) => (l.attrs.rel || '').toLowerCase().includes('icon'));
  if (!favicon)
    add('favicon-missing', 'seo', 'info', '<head>', 'none', 'favicon link', 'No favicon declared.');

  // ---- OpenGraph -------------------------------------------------------
  const og = (k) => metaContent(metas, 'og:' + k);
  for (const [k, sev] of [['title', 'warn'], ['description', 'warn'], ['image', 'error'], ['type', 'info'], ['url', 'info']]) {
    if (og(k) === null)
      add(`og-${k}-missing`, 'opengraph', sev, '<head>', 'none', `og:${k}`, `Missing og:${k} — link previews on social/Slack/iMessage will be poor.`);
  }

  // ---- Twitter cards ---------------------------------------------------
  const tw = (k) => metaContent(metas, 'twitter:' + k);
  if (tw('card') === null)
    add('twitter-card-missing', 'twitter', 'info', '<head>', 'none', 'twitter:card', 'No twitter:card — X/Twitter falls back to a bare link (og: may still cover it).');
  for (const k of ['title', 'description', 'image']) {
    if (tw(k) === null && og(k) === null)
      add(`twitter-${k}-missing`, 'twitter', 'info', '<head>', 'none', `twitter:${k} or og:${k}`, `No twitter:${k} and no og:${k} fallback.`);
  }

  // ---- Structured data (JSON-LD) --------------------------------------
  const ldScripts = scripts.filter((s) => (s.attrs.type || '').toLowerCase() === 'application/ld+json');
  if (ldScripts.length === 0)
    add('structured-data-missing', 'structured-data', 'info', 'document', 'none', 'JSON-LD schema', 'No JSON-LD — no rich results eligibility (Organization, Product, Article, etc.).');
  ldScripts.forEach((s, i) => {
    try {
      JSON.parse(s.inner.trim());
    } catch (e) {
      add('structured-data-invalid', 'structured-data', 'error', `JSON-LD #${i + 1}`, 'invalid JSON', 'valid JSON', `JSON-LD block fails to parse: ${e.message}`);
    }
  });

  // ---- Performance (static heuristics) --------------------------------
  const blocking = findTags(head, 'script').filter((s) => s.attrs.src && !('defer' in s.attrs) && !('async' in s.attrs) && (s.attrs.type || '').toLowerCase() !== 'module');
  if (blocking.length > 0)
    add('render-blocking-script', 'performance', 'warn', '<head>', `${blocking.length} script(s)`, 'defer/async or move to <body>', 'Render-blocking scripts in <head> delay first paint.');

  const imgsNoDim = imgs.filter((i) => !('width' in i.attrs) || !('height' in i.attrs)).filter((i) => !(i.attrs.style || '').match(/aspect-ratio/));
  if (imgsNoDim.length > 0)
    add('img-no-dimensions', 'performance', 'warn', '<img>', `${imgsNoDim.length}/${imgs.length} images`, 'width+height or aspect-ratio', 'Images without intrinsic size cause layout shift (CLS).');

  if (imgs.length > 2) {
    const lazy = imgs.filter((i) => (i.attrs.loading || '').toLowerCase() === 'lazy').length;
    if (lazy === 0)
      add('img-no-lazy', 'performance', 'info', '<img>', `0/${imgs.length} lazy`, 'loading="lazy" below the fold', 'No lazy-loaded images — below-the-fold images block initial load. (Keep the LCP/hero image eager.)');
  }

  const styleImport = (html.match(/@import\b/gi) || []).length;
  if (styleImport > 0)
    add('css-import', 'performance', 'warn', 'CSS', `${styleImport} @import`, 'avoid @import', '@import serializes CSS downloads; use <link> or a bundler.');

  const inlineStyles = findElements(html, 'style');
  const inlineStyleBytes = inlineStyles.reduce((n, s) => n + Buffer.byteLength(s.inner, 'utf8'), 0);
  if (inlineStyleBytes > INLINE_STYLE_MAX_BYTES)
    add('inline-css-large', 'performance', 'info', '<style>', `${kb(inlineStyleBytes)}`, `≤ ${kb(INLINE_STYLE_MAX_BYTES)}`, 'Large inline CSS bloats the HTML payload.');

  const inlineScriptBytes = scripts.filter((s) => !s.attrs.src).reduce((n, s) => n + Buffer.byteLength(s.inner, 'utf8'), 0);
  if (inlineScriptBytes > INLINE_SCRIPT_MAX_BYTES)
    add('inline-js-large', 'performance', 'info', '<script>', `${kb(inlineScriptBytes)}`, `≤ ${kb(INLINE_SCRIPT_MAX_BYTES)}`, 'Large inline JS in the document is not cacheable across pages.');

  const dataUris = [...rawHtml.matchAll(/data:[^;,"')\s]+;base64,([A-Za-z0-9+/=]+)/g)];
  const bigData = dataUris.filter((m) => (m[1].length * 3) / 4 > DATA_URI_MAX_BYTES);
  if (bigData.length > 0)
    add('data-uri-large', 'performance', 'warn', 'data: URI', `${bigData.length} over ${kb(DATA_URI_MAX_BYTES)}`, 'external cacheable asset', 'Large base64 data URIs are uncacheable and inflate the HTML.');

  // Google Fonts / third-party font origins without preconnect
  const usesGFonts = /fonts\.(googleapis|gstatic)\.com/i.test(html);
  const hasPreconnect = links.some((l) => (l.attrs.rel || '').toLowerCase().includes('preconnect') && /gstatic|googleapis/i.test(l.attrs.href || ''));
  if (usesGFonts && !hasPreconnect)
    add('font-no-preconnect', 'performance', 'info', '<head>', 'no preconnect', 'preconnect to font origin', 'Add <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin> to cut font latency.');
  if (usesGFonts && !/display=swap/i.test(html))
    add('font-no-display-swap', 'performance', 'info', 'Google Fonts', 'no display=swap', '&display=swap', 'Without font-display:swap, text is invisible while the webfont loads (FOIT).');

  const docBytes = Buffer.byteLength(rawHtml, 'utf8');
  if (docBytes > DOC_SIZE_WARN_BYTES)
    add('doc-size-large', 'performance', 'info', 'document', kb(docBytes), `≤ ${kb(DOC_SIZE_WARN_BYTES)}`, 'Large HTML document — consider code-splitting / trimming inline payloads.');

  return findings;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// ---------------------------------------------------------------------------
// Optional runtime pass — real load metrics via system Chrome over CDP.
// Mirrors verify-composition.mjs's launcher so no extra dependency is added.
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-perf-'));
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
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Performance.enable', {}, sessionId);

    let requestCount = 0;
    let transferred = 0;
    cdp.on('Network.requestWillBeSent', () => {
      requestCount += 1;
    });
    cdp.on('Network.loadingFinished', (p) => {
      transferred += p.encodedDataLength || 0;
    });

    const loaded = new Promise((resolve) => {
      cdp.on('Page.loadEventFired', () => resolve());
      setTimeout(resolve, NAV_TIMEOUT_MS);
    });
    await cdp.send('Page.navigate', { url: targetUrl }, sessionId);
    await loaded;
    await sleep(SETTLE_MS);

    const timing = await cdp.send(
      'Runtime.evaluate',
      {
        expression: `(() => { const nav = performance.getEntriesByType('navigation')[0]; const t = performance.timing; return JSON.stringify(nav ? { dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd } : { dcl: t.domContentLoadedEventEnd - t.navigationStart, load: t.loadEventEnd - t.navigationStart }); })()`,
        returnByValue: true,
      },
      sessionId
    );
    let dcl = 0,
      load = 0;
    try {
      const parsed = JSON.parse(timing.result.value);
      dcl = Math.round(parsed.dcl);
      load = Math.round(parsed.load);
    } catch {
      /* ignore */
    }

    await cdp.send('Target.closeTarget', { targetId });
    ws.close();

    findings.push({ rule: 'runtime-requests', category: 'performance', severity: requestCount > RUNTIME_REQUEST_WARN ? 'warn' : 'info', context: 'runtime', measured: `${requestCount} requests`, expected: `≤ ${RUNTIME_REQUEST_WARN}`, note: 'Total network requests to fully load the page.' });
    findings.push({ rule: 'runtime-transferred', category: 'performance', severity: transferred > RUNTIME_BYTES_WARN ? 'warn' : 'info', context: 'runtime', measured: kb(transferred), expected: `≤ ${kb(RUNTIME_BYTES_WARN)}`, note: 'Total bytes transferred over the wire.' });
    if (dcl > 0) findings.push({ rule: 'runtime-dcl', category: 'performance', severity: dcl > RUNTIME_DCL_WARN_MS ? 'warn' : 'info', context: 'runtime', measured: `${dcl} ms`, expected: `≤ ${RUNTIME_DCL_WARN_MS} ms`, note: 'DOMContentLoaded (headless, warm cache — treat as relative).' });
    if (load > 0) findings.push({ rule: 'runtime-load', category: 'performance', severity: load > RUNTIME_LOAD_WARN_MS ? 'warn' : 'info', context: 'runtime', measured: `${load} ms`, expected: `≤ ${RUNTIME_LOAD_WARN_MS} ms`, note: 'Load event (headless — treat as relative, not a field metric).' });
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
  process.stderr.write(`\nverify-seo-perf: ${target}\n`);
  process.stderr.write(`  ${errors} error · ${warns} warn · ${infos} info\n`);
  for (const f of sorted) {
    const tag = f.severity.toUpperCase().padEnd(5);
    process.stderr.write(`  [${tag}] ${f.category}/${f.rule} — ${f.measured} (expected ${f.expected})\n`);
    if (f.note) process.stderr.write(`          ${f.note}\n`);
  }
  if (errors === 0) process.stderr.write(`\n✓ no blocking SEO/perf findings\n`);
  else process.stderr.write(`\n✗ ${errors} blocking finding(s) — fix or justify before "done"\n`);
}

function degrade(message, detail) {
  const finding = [{ rule: 'environment', category: 'environment', severity: 'info', context: 'runner', measured: 'not analysed', expected: 'analysed', note: detail || message }];
  process.stdout.write(JSON.stringify(finding, null, 2) + '\n');
  process.stderr.write(`verify-seo-perf: ${message}\n`);
  process.exit(2);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.target) {
    process.stderr.write('Usage: node verify-seo-perf.mjs <file-or-url> [--no-chrome] [--json]\n');
    process.exit(2);
  }

  let loaded;
  try {
    loaded = await loadHtml(opts.target);
  } catch (e) {
    return degrade(`could not read target: ${e.message}`, e.message);
  }

  const findings = analyseHtml(loaded.html, { url: loaded.url });

  if (opts.chrome) {
    const chrome = findChrome();
    if (chrome) {
      try {
        const { findings: rt } = await measureRuntime(chrome, loaded.url);
        findings.push(...rt);
      } catch (e) {
        findings.push({ rule: 'runtime-skipped', category: 'performance', severity: 'info', context: 'runtime', measured: 'skipped', expected: 'measured', note: `Runtime perf pass failed (${e.message}); static findings still apply.` });
      }
    } else {
      findings.push({ rule: 'runtime-skipped', category: 'performance', severity: 'info', context: 'runtime', measured: 'no Chrome', expected: 'measured', note: 'No Chrome found — ran static analysis only. Set CHROME_PATH for runtime metrics.' });
    }
  }

  process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
  if (!opts.json) printSummary(opts.target, findings);

  const hasError = findings.some((f) => f.severity === 'error');
  process.exit(hasError ? 1 : 0);
}

main().catch((err) => degrade(`unexpected failure: ${err.message}`, err.stack));
