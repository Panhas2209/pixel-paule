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
