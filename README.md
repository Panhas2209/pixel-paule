# pixel-paule

A Claude Code plugin that turns "build me a website" into one command. Describe
what you want and it produces a real, production-grade page — design system,
build, motion, and a **two-part blocking audit (composition + SEO/OpenGraph/
performance)** — without you installing or invoking a single design skill by hand.

This is an extended fork of the original
[`website-builder`](https://github.com/Jarek2k/website-builder): it keeps
everything that made that one good and adds two things production sites actually
need — an **optional brand constraint** and a deterministic **SEO / meta /
OpenGraph / load-performance audit**.

## What's new vs. the original

- **Optional brand input.** Drop a `brand.json` (or `brand.yaml`) with your CI
  colors, fonts, logo, radius, tone/voice, and a `doNot` list — it's loaded once
  and carried as a *hard constraint* through data → build → motion → audit, so the
  result stays on-brand. No brand file? Nothing changes; identity is derived from
  the brief exactly as before. Precedence: `brand=path` > auto-discovered file >
  `--keep-brand` + free text > brief-derived. See
  [`plugin/skills/website/reference/brand-input.md`](plugin/skills/website/reference/brand-input.md).
- **SEO / OpenGraph / performance audit** (`verify-seo-perf.mjs`), a second
  deterministic gate alongside the layout checker. It measures — with hard,
  blocking numbers — search metadata, social-share cards, structured data, and
  load performance. A gorgeous page that no one can find and that previews as a
  bare link no longer counts as "done".

Everything else from the original is intact: the single `website` orchestrator,
the three vendored specialist skills, the anti-slop doctrine, and the blocking
composition checker.

## How it works

One orchestrator skill, **`website`**, is the single entry point. It doesn't
invent palettes, type, or motion itself — it sequences bundled specialist skills
and its own audit gates, and hands work between them so two builders never do the
same job twice:

| Skill / gate | Its job in the pipeline |
|---|---|
| **[impeccable](https://github.com/pbakaus/impeccable)** | the lead builder — taste-driven, anti-AI-slop craft + design critique |
| **[ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)** | design-system data (palettes, font pairings, UX rules) + production/accessibility checklist |
| **[emil-design-eng](https://github.com/emilkowalski/skills)** | motion & micro-interactions, with a `review-animations` QA gate |
| **verify-composition** (first-party) | blocking layout audit — overflow, unequal heights, width use, contrast |
| **verify-seo-perf** (first-party) | blocking SEO / meta / OpenGraph / structured-data / performance audit |
| **load-brand** (first-party) | loads the optional brand file as a hard constraint |

The specialists are kept out of autonomous routing, so only `website` fires on a
request and loads each specialist on demand.

## Install

The way that works **everywhere** — including the VS Code / JetBrains extensions,
where the in-app `/plugin` command is disabled — is the terminal CLI. Publish this
folder to a Git repo you control, then:

```
claude plugin marketplace add Panhas2209/pixel-paule
claude plugin install pixel-paule@panhas2209
```

(`panhas2209` is the marketplace/catalog name declared in
`.claude-plugin/marketplace.json`; `pixel-paule` is the plugin.)

Then reload your editor (VS Code: **Cmd/Ctrl+Shift+P → "Developer: Reload
Window"**). Verify with `claude plugin list`.

Requirements: `python3` and `node` (both usually present). A browser/Playwright
MCP is optional but improves URL rebuilds and visual checks; a local Chrome/
Chromium enables the runtime performance metrics (the audits degrade gracefully
without it).

## Use it

Just describe what you want — the orchestrator picks the mode automatically:

```
# New build from a brief
"Build me a landing page for a calm voice-notes second-brain app."

# On-brand build with a brand file present in the project
"Build our product landing page."        # picks up ./brand.json automatically
"Build the landing page. brand=./config/brand.json"

# Rebuild / redesign from a reference
"Rebuild https://example.com but cleaner."
"Redesign this site but keep our logo and brand colors." (--keep-brand)

# Audit & improve an existing page
"Go over ./index.html — fix the spacing, typography, SEO and animations."
```

Three modes, picked from your input:

- **New** — from a brief → shape & confirm, then data → build → motion → audit.
- **From a reference** — from a URL or site → fetch & extract, then a faithful
  rebuild *or* a redesign that keeps the brand → motion → audit.
- **Improve** — from a file or project → diagnose, then targeted fixes in place.

Every mode ends with **both** audit gates (composition + SEO/perf); each blocks
on `error`-severity findings until fixed or explicitly justified.

You can still call any bundled skill directly, e.g.
`/pixel-paule:impeccable audit`, or run a gate by hand:

```
node plugin/skills/website/scripts/verify-seo-perf.mjs ./index.html
node plugin/skills/website/scripts/verify-composition.mjs ./index.html -b 390,768,1280
```

## Credits & licenses

This plugin **vendors** the upstream skills; each keeps its own license (copies in
[`third_party/`](third_party), summarized in [`NOTICE`](NOTICE)): ui-ux-pro-max
(MIT), emil-design-eng (MIT), impeccable (Apache-2.0). All credit for the design
intelligence belongs to their authors. The orchestrator, the two audit gates, the
brand loader, and the tooling here are MIT. Original orchestrator scaffolding by
[Jarek2k/website-builder](https://github.com/Jarek2k/website-builder) (MIT).

---

Maintaining, extending, or forking this plugin? See
[`docs/maintaining.md`](docs/maintaining.md) for the upstream-sync automation, how
to add/swap a skill, and how conflicts between the bundled builders are prevented.
