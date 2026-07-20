---
name: website-seo
description: >
  Run ONLY the deterministic SEO / meta / OpenGraph / structured-data / load-performance audit on an
  existing HTML page — a local file or a URL — WITHOUT building or redesigning anything. Use when the
  user wants a focused findability/performance check ("audit my SEO", "check the meta tags", "are my
  OpenGraph/social preview tags right", "why does my link preview look bad", "check page performance",
  "SEO-Check für diese Seite"). This is the standalone entry point for the same SEO/perf gate that the
  `website` orchestrator runs at the end of a build. For a full build/redesign, use `website` instead.
argument-hint: "<file-or-URL> [--no-chrome]"
user-invocable: true
disable-model-invocation: true
---

# website-seo — standalone SEO / OpenGraph / performance audit

You run one deterministic script and act on its findings. You do **not** rebuild, redesign, or restyle
the page — this is a focused audit. (For a full build or redesign, that's the `website` skill's job.)

## Step 1 — Resolve the plugin root

```bash
PR="${CLAUDE_PLUGIN_ROOT}"
[ -z "$PR" ] && PR="$(ls -d ~/.claude/plugins/cache/*/pixel-paule/*/ 2>/dev/null | sort | tail -1)"
```

## Step 2 — Run the audit

Take the target from the user's input (a local file path or an `http(s)` URL). Then:

```bash
node "$PR/skills/website/scripts/verify-seo-perf.mjs" <file-or-URL>
```

- Add `--no-chrome` if the user asks for a static-only pass, or if no local Chrome is available (the
  script already degrades gracefully — it emits an info finding and keeps the full static analysis).
- Add `--json` if the user wants only the machine-readable output with no summary.

The script prints a JSON array of findings to stdout — each
`{rule, category, severity, context, measured, expected, note}` — and a human summary to stderr.
Exit code `0` = clean, `1` = at least one `error`, `2` = target could not be read.

## Step 3 — Report and (optionally) fix

Summarize the findings grouped by category (seo, opengraph, twitter, structured-data, performance).
Lead with any `severity:"error"` items — missing `<title>`/`<h1>`/viewport/`og:image`, invalid JSON-LD,
or an accidental `noindex` — because those are the ones that actually break search and social sharing.
Then list `warn` and `info` as prioritized suggestions.

If (and only if) the user asks you to fix the issues, apply the minimal, targeted edits to the page
(add the missing tags, fix the broken JSON-LD, add `width`/`height` to images, etc.) and then **re-run
the script** to confirm the `error` count is zero. Don't redesign or change the visual look — if the
user wants that, hand off to the `website` skill (Improve mode). Never invent tags a page legitimately
shouldn't have (e.g. a canonical for a fragment) — say so in one line instead.
