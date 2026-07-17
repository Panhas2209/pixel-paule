# website orchestrator scripts

First-party tooling owned by the `website` orchestrator. Unlike the specialist
skills (`impeccable`, `ui-ux-pro-max`, …), this directory is **not** vendored
from an upstream, so it survives `scripts/sync-upstreams.sh` and is the right
home for checks the orchestrator itself runs.

## verify-composition.mjs

A deterministic UI composition checker. It renders a target headless and reports
layout defects with hard numbers, so the audit step (Mode A · A4, Mode C · C3)
catches what an eyeballed screenshot misses.

```bash
node verify-composition.mjs <file-or-url> [--breakpoints 390,768,1280]
node verify-composition.mjs --target ./dist/index.html -b 390,1280
```

**Checks** (thresholds are named constants at the top of the file):

| Rule | id | severity | what it catches |
|---|---|---|---|
| 1 | `horizontal-overflow` | error | `documentElement.scrollWidth > clientWidth` (+ the offending selectors) |
| 2 | `unequal-sibling-heights` | warn | cards/columns in one flex/grid row that differ > 4% **and** > 8px in height |
| 3 | `text-width-utilization` | info | a text block floating narrow (< 55%) and left-anchored in a wide (> 480px) container |
| 4 | `contrast` | error | effective text vs background below WCAG AA (4.5:1 normal, 3:1 large/bold) |

**Output.** A JSON array to **stdout** — one entry per violation
`{rule, severity, breakpoint, selector, measured, expected, note}` — and a
human-readable summary to **stderr**. Exit codes:

- `0` — rendered, no `error`-severity violations (warn/info are non-blocking)
- `1` — rendered, at least one `error`-severity violation
- `2` — could **not** render (no Chrome, launch/navigation failure); emits a
  single `environment` finding and a clear message instead of crashing

**Rendering.** Drives the **system Chrome/Chromium** directly over the Chrome
DevTools Protocol using Node's built-in `WebSocket`/`fetch` — no `puppeteer`, no
npm install, no bundle. Chrome is discovered from `VERIFY_COMPOSITION_CHROME` /
`CHROME_PATH` / `PUPPETEER_EXECUTABLE_PATH`, then platform defaults, then `PATH`.
Reveal-on-scroll content (IntersectionObserver / `opacity:0` transitions) is
forced visible and the page is scrolled through before measuring, so gated
sections are measured rather than read as empty.

Requires Node 18+ (global `fetch`/`WebSocket`) and a Chrome/Chromium install.

## Tests

Zero-dependency, `node:test` + `node:assert`, driving the real script over the
fixtures in `test/fixtures/`. The suite skips itself cleanly when no Chrome is
available.

```bash
node --test 'plugin/skills/website/scripts/test/*.test.mjs'
```

## verify-seo-perf.mjs

The companion audit gate. Where `verify-composition.mjs` measures **layout**,
this one measures the things a beautiful page still ships broken: search
metadata, social-share cards, structured data, and load performance — as hard,
blocking numbers. Wired into Mode A · A4b and Mode C · C3.

```bash
node verify-seo-perf.mjs <file-or-url>
node verify-seo-perf.mjs ./dist/index.html --no-chrome   # static pass only
node verify-seo-perf.mjs https://example.com --json      # JSON only, no stderr summary
```

**Categories & example rules:**

| Category | severity range | catches |
|---|---|---|
| `seo` | error/warn/info | missing `<title>`/`<h1>`/viewport (error), thin/oversized title & description, missing `<html lang>`, charset, canonical, favicon, image `alt` coverage, accidental `noindex` (error) |
| `opengraph` | error/warn/info | missing `og:image` (error), `og:title`/`description` (warn), `og:type`/`url` (info) |
| `twitter` | info | missing `twitter:card` + `title`/`description`/`image` (only when no `og:` fallback) |
| `structured-data` | error/info | JSON-LD absent (info) or present-but-invalid JSON (error) |
| `performance` | warn/info | render-blocking head scripts, images without width/height (CLS), no lazy-loading, `@import`, oversized inline CSS/JS, large data: URIs, fonts without preconnect / `display=swap`, large document |
| `performance` (runtime) | warn/info | with Chrome: request count, transferred bytes, DOMContentLoaded, load event |

**Output.** JSON array to **stdout** — `{rule, category, severity, context, measured, expected, note}` —
plus a human summary to **stderr**. Exit codes match the composition checker:
`0` clean, `1` at least one `error`, `2` target unreadable (degraded).

**Rendering.** The static pass is pure Node string analysis — no browser, works
on a local file or a URL (`fetch`). The optional runtime pass reuses the same
system-Chrome-over-CDP technique as `verify-composition.mjs` for real load
metrics and degrades gracefully (an `info` finding, never a crash) when no Chrome
is present or when `--no-chrome` is passed.

## load-brand.mjs

Discovers, parses, validates and normalises the **optional** brand file (never
required). When present, the orchestrator (Step 0b) feeds it as a hard constraint
into every phase. JSON is fully supported; a small YAML subset works too.

```bash
node load-brand.mjs                 # auto-discover brand.json / brand.yaml / …
node load-brand.mjs ./config/brand.json
```

Prints normalised brand JSON to stdout (`{"present": false}` when none found — a
valid state) and a summary + validation warnings to stderr. Schema, precedence,
and per-phase rules: `../reference/brand-input.md`; example: `../reference/brand.example.json`.
