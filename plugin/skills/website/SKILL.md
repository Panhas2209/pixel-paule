---
name: website
description: >
  Build, rebuild, or improve a complete production-quality website or web app, end to end. Use this
  whenever the user wants to: build/make/design a NEW website, landing page, dashboard, web app, or UI
  from a brief ("build me a website", "make a landing page", "neue Website bauen", "design a dashboard");
  REBUILD or REDESIGN from an existing site or URL ("bau das nach", "rebuild this site", "redesign it but
  keep the logo/brand"); or AUDIT and IMPROVE an existing page or file ("optimize my site", "geh über die
  HTML", "fix the spacing/typography/animations", "make this production-ready", "why does this look off").
  Single entry point for front-end build work — orchestrates a design-system data pass, a taste-driven
  anti-slop build, motion craft, and a production audit that includes composition, accessibility, SEO,
  OpenGraph/social, and load performance. Accepts an OPTIONAL brand file to lock colors/fonts/logo/voice.
  Prefer this over the individual bundled skills.
argument-hint: "[brief | URL | file/path] [brand=path] [--keep-brand] [--stack next|astro|vite|svelte|html]"
user-invocable: true
---

# Website Builder — Orchestrator

You are the conductor of a small team of specialist design skills bundled inside this plugin. You do
**not** invent palettes, type systems, motion, or audits from scratch — you load the right specialist's
method and apply it. Your job is sequencing, hand-off, and keeping two builders from doing the same work
twice.

The lane assignment below was decided by a blind head-to-head bake-off (see `scripts/bake-off/`):
**impeccable** produces the more distinctive, less-AI-looking, higher-craft build; **ui-ux-pro-max** is
the stronger systematic data source and production/accessibility checklist; **emil** is the motion
specialist. Respect those lanes.

## Specialists → assets (the one place to change when swapping a skill)

| Role | Asset to use | How |
|---|---|---|
| Data / inspiration | `ui-ux-pro-max` | run its engine: `python3 "$PR/skills/ui-ux-pro-max/scripts/search.py" "<keywords>" --design-system` |
| Production checklist / audit | `ui-ux-pro-max` | read the rule sections of `$PR/skills/ui-ux-pro-max/SKILL.md`, or query `--domain ux\|style\|color` |
| Builder (taste, anti-slop) | `impeccable` | read `$PR/skills/impeccable/SKILL.md` + the relevant `reference/<command>.md`, then build |
| Motion | `emil-design-eng` | read `$PR/skills/emil-design-eng/SKILL.md` and apply |
| Motion QA gate | `review-animations` | read `$PR/skills/review-animations/SKILL.md` and apply to the motion you added |
| Composition audit gate | `verify-composition` (first-party) | `node "$PR/skills/website/scripts/verify-composition.mjs" <file-or-url> --breakpoints 390,768,1280` |
| SEO / meta / OpenGraph / performance audit gate | `verify-seo-perf` (first-party) | `node "$PR/skills/website/scripts/verify-seo-perf.mjs" <file-or-url>` |
| Optional brand constraint | `load-brand` (first-party) | `node "$PR/skills/website/scripts/load-brand.mjs" [path]` — see `reference/brand-input.md` |

**How you "use" a specialist:** these skills are bundled as a knowledge + script library. Load one by
**Reading its `SKILL.md`** (and only the `reference/` files it points you to for the current task) and
**running its scripts**. Do not rely on auto-invocation — they are intentionally set
`disable-model-invocation` so they never fire on their own and compete with you. (A power user may still
call one directly, e.g. `/pixel-paule:impeccable audit`; that's fine and bypasses you on purpose.)

## Step 0 — Resolve the plugin root (do this first, once)

```bash
PR="${CLAUDE_PLUGIN_ROOT}"
[ -z "$PR" ] && PR="$(ls -d ~/.claude/plugins/cache/*/pixel-paule/*/ 2>/dev/null | sort | tail -1)"
echo "$PR"   # all bundled assets live under $PR/skills/<name>/
```
Use that absolute `$PR` for every script path below. On Windows use `python` instead of `python3`.

## Step 0b — Load the OPTIONAL brand constraint (do this once, before the mode pipeline)

A brand file is **never required** — most runs won't have one, and that is fine. But if one exists it
becomes a **hard constraint** you carry through every phase, so check for it up front:

```bash
node "$PR/skills/website/scripts/load-brand.mjs" ${BRAND_PATH:-}   # BRAND_PATH from a `brand=…` arg, else auto-discover
```

- Output `{"present": false}` → no brand file. Derive identity from the brief (Mode A) or the reference
  (Mode B `--keep-brand`), exactly as the base pipeline does. Free-text brand hints in the prompt still apply.
- Output `{"present": true, "brand": {…}}` → **the brand wins over taste.** Its `colors`, `fonts`, `logo`,
  `radius`, `density`, `voice`/`tone`, and every entry in `doNot` are locked inputs, not suggestions. Reference
  data (A1) and impeccable's taste (A2) fill only what the brand left open. Feed `name`/`url` into the SEO audit.

Precedence: explicit `brand=path` > auto-discovered brand file > `--keep-brand` + free text > brief-derived.
Full schema and per-phase rules: `$PR/skills/website/reference/brand-input.md`.

## Step 1 — Detect the mode from the input

- **Input is a brief / description / nothing** → **Mode A (new build)**.
- **Input is a URL or names an existing live site** → **Mode B (from reference)**.
- **Input is a file path / existing project / "my site" / "this page"** → **Mode C (improve existing)**.

If genuinely ambiguous, ask one short question. Then run the matching pipeline.

---

## Mode A — Build new from a brief

**A0 · Shape — discover, then confirm (do NOT skip this).** Before any build, run impeccable's shape step:
read `$PR/skills/impeccable/reference/shape.md` and follow it. Run **one focused discovery round** — call the
AskUserQuestion tool with 2–3 questions covering: the page's purpose/goal, the audience and their state of
mind, the **real content/data** it must show, scope & fidelity, and visual direction (color strategy + a
one-sentence scene + 1–2 named anchor references). Fold the stack default (**Next.js + Tailwind + shadcn/ui**,
honor `--stack`) in as a constraint — don't make it the headline question. Then present a **compact design
brief (3–5 bullets)** — what you're building, the primary user action, the visual lane, key sections/states —
and **stop for explicit confirm/override. Do not build in the same turn.** Skip the discovery round only when
the prompt already pins purpose + content + direction unambiguously; the brief + confirmation are never skipped.

**A1 · Data foundation — ui-ux-pro-max.** Run the engine for a starting design system:
```bash
python3 "$PR/skills/ui-ux-pro-max/scripts/search.py" "<product type> <industry> <keywords>" --design-system
```
Treat its palette / font-pairing / style / pattern as **candidates and reference data**, not a lock.
Note its UX-rule domains for the later audit. Do **not** let it author the final page — it is data here.
**If Step 0b loaded a brand**, the brand's `colors`/`fonts` are the locked seed and this engine's output is
subordinate reference only — use it to fill gaps the brand didn't specify, never to override it.

**A2 · Build — impeccable (lead).** Read `$PR/skills/impeccable/SKILL.md`, then `reference/craft.md`, and
the references craft.md points to (typically `layout`, `typeset`, `colorize`, `animate`, plus `brand` for
marketing surfaces or `product` for app UI). **Shape is already done and confirmed in A0 — skip craft.md's
Step 1 (shape); treat the confirmed brief as the locked direction** and go straight to its build steps. You
may run `node "$PR/skills/impeccable/scripts/palette.mjs"` for a brand seed. Build the real, production-grade
page, honoring impeccable's anti-slop doctrine and absolute bans. Feed A1's candidates in as options; impeccable's taste decides. This is where the design
actually gets made.

**A3 · Motion — emil-design-eng.** Read `$PR/skills/emil-design-eng/SKILL.md` and add/refine motion on the
interactive surfaces only. **Constraint:** do not restructure layout or change the palette/type from A2 —
motion only.

**A3b · Motion QA — review-animations.** Read `$PR/skills/review-animations/SKILL.md` and review the motion
you just added against its craft bar. Fix what it flags. (Automatic; no need to ask the user.)

**A4 · Audit & harden — impeccable + ui-ux-pro-max checklist.** Read impeccable `reference/audit.md`,
`polish.md`, `harden.md` and run them as a **reviewer**. Then cross-check against ui-ux-pro-max's rule set.
Do **not** run impeccable's `craft`/`shape`/`init` here — those rebuild and would re-litigate A2.

**Run the deterministic composition check — it is blocking.** Measure the built artifact at every breakpoint
*before* you say "done"; do not sign off from an eyeballed screenshot:
```bash
node "$PR/skills/website/scripts/verify-composition.mjs" <built-file-or-local-URL> --breakpoints 390,768,1280
```
It renders headless via the system Chrome (no npm install) and prints a JSON array of violations to stdout
(`{rule, severity, breakpoint, selector, measured, expected, note}`) plus a summary line. Treat **every**
violation as a finding: fix it, or write one sentence saying why it is intentional (e.g. deliberately unequal
card heights). Then **re-run until the output is clean or every remaining entry is justified.** A
`severity:"error"` entry (horizontal overflow, contrast below the minimum) exits non-zero and must **not**
survive to "done". If it emits an `environment` finding (no Chrome available), fall back to reading
screenshots and say so.

**Explicitly verify the failure modes a strong taste-build tends to miss** (these cost real points in the
bake-off), the first four of which the script measures for you:
- **No horizontal overflow** at 390/768/1280 — `documentElement.scrollWidth ≤ clientWidth` (Rule 1).
- **Equal sibling heights** — cards/columns in one flex/grid row don't disagree in height (Rule 2).
- **Width utilization** — text blocks aren't floating narrow and left-anchored in a wide container (Rule 3).
- **Body contrast ≥ 4.5:1** (≥ 3:1 for large/bold text) with margin (Rule 4).
- Heading clipping at 390/768; a color fallback when using OKLCH; `prefers-reduced-motion` honored; content
  visible without JS (no section gated behind a reveal).

**Composition balance — equal heights, width utilization — is part of the check, not just the a11y
checklist.** Render and read a screenshot at desktop **and** mobile widths as well: the script measures, the
screenshot confirms.

**A4b · SEO / meta / OpenGraph / performance audit — also blocking.** A beautiful page that no one can find
and that previews as a bare link is not done. Run the second deterministic gate:
```bash
node "$PR/skills/website/scripts/verify-seo-perf.mjs" <built-file-or-local-URL>
```
It prints a JSON array of findings (`{rule, category, severity, context, measured, expected, note}`) across
five categories — **seo** (title, meta description, single `<h1>`, `<html lang>`, charset, viewport,
canonical, robots, image alt, favicon), **opengraph** (og:title/description/**image**/type/url), **twitter**
(card + fallbacks), **structured-data** (JSON-LD present + parses), and **performance** (render-blocking head
scripts, images without width/height → CLS, missing lazy-loading, `@import`, oversized inline blocks, large
data: URIs, fonts without preconnect / `display=swap`, document size). If Chrome is available it adds real
runtime metrics (request count, transferred bytes, DOMContentLoaded, load). Treat every `severity:"error"`
(missing title/`<h1>`/viewport/og:image, invalid JSON-LD, accidental `noindex`) as blocking — **fix it or
justify it in one sentence**, then re-run until clean or justified. `warn`/`info` are strong nudges, not gates.
**If a brand was loaded**, confirm `<title>`/canonical/og:url reflect the brand `name`/`url` and that the
favicon/logo are wired up. Runs offline: with `--no-chrome` it does the full static pass and skips runtime
metrics gracefully.

---

## Mode B — Rebuild / redesign from a URL or reference

**B0 · Intake the reference.** Fetch the page with WebFetch (structure + copy). If a browser/screenshot
tool is available, capture a screenshot for visual fidelity; otherwise proceed from HTML/CSS and say so.
Download the brand assets to preserve — **logo**, brand colors, fonts.

**B1 · Extract — impeccable.** Read `$PR/skills/impeccable/SKILL.md` + `reference/extract.md` (and
`document.md`) to capture the reference's design tokens, structure, and brand into a usable system.

**B2 · Branch on intent.**
- **Faithful rebuild** ("bau das nach", "rebuild this") → reproduce structure, layout, and look in clean,
  production-grade code. Stay close to the original; improve only correctness (a11y, responsive, semantics).
- **Redesign, keep brand** (`--keep-brand`, "neu bauen aber Logo behalten") → hold the logo + brand identity
  fixed, then run the **Mode A** pipeline (A0 shape gate → A2–A4) with that brand as the seed, regenerating
  everything else. In the A0 discovery, only ask what the reference didn't already answer. If a **brand file**
  was loaded in Step 0b, it takes precedence over what B1 extracted; the extraction fills only the gaps.

**B3 · Finish.** Motion (A3 + A3b) and audit (A4 composition + A4b SEO/perf) exactly as in Mode A.

---

## Mode C — Audit & improve an existing page (impeccable's home turf)

**C0 · Read the work.** Read the existing file(s) / project. Treat the existing brand and identity as
**fixed** unless the user asks to change it (impeccable's "identity-preservation wins"). If the goal of the
pass is unclear, ask **one** quick question (what should this improvement achieve?); otherwise the existing
page is the content — proceed without an interview.

**C1 · Diagnose.** Read impeccable `reference/audit.md` + `critique.md` and run them over the code. Cross-
check with the ui-ux-pro-max rule set (`--domain ux` / the SKILL.md checklist). Produce a short, concrete
findings list (spacing, typography, hierarchy, color/contrast, a11y, anti-slop tells, motion, states).

**C2 · Fix with the matching command.** For each finding, read and apply the matching impeccable reference
and edit in place: spacing/rhythm → `layout`; typography → `typeset`; flat/garish color → `colorize`;
motion → `animate` (then read `emil-design-eng` for depth and run the `review-animations` gate); broad
quality → `polish`; production-readiness (errors, i18n, edge/empty states) → `harden`; performance →
`optimize`; responsiveness → `adapt`. Re-render and read a screenshot to confirm each fix. Don't invent
defects to look busy; a clean "first pass is solid" is a valid result.

**C3 · Verify (blocking).** Before saying "done", run the same deterministic composition check as **A4** on
the improved file at all breakpoints:
```bash
node "$PR/skills/website/scripts/verify-composition.mjs" <file-or-local-URL> --breakpoints 390,768,1280
```
Overflow, unequal sibling heights, poor width utilization, and low contrast are measured, not guessed. Every
violation is either fixed or explicitly justified as intentional; re-run until the output is clean or
justified. This is part of the diagnosis in C1 too — use it to ground the findings list in numbers, not just
what the screenshot looks like.

**Also run the SEO/perf gate** on the improved file (same as A4b) — an "improve" pass is exactly where missing
meta, broken OpenGraph, or a render-blocking script should get caught:
```bash
node "$PR/skills/website/scripts/verify-seo-perf.mjs" <file-or-local-URL>
```
Fold its findings into C1's diagnosis and fix/justify every `error` before "done". Don't add SEO tags the page
legitimately shouldn't have (e.g. a canonical for a fragment) — justify skips in one line.

---

## Cross-cutting rules (all modes)

- **One builder at a time.** ui-ux-pro-max provides data and the checklist; impeccable builds and audits.
  Never run both as builders on the same surface — that's the conflict this plugin exists to prevent.
- **Hand-off contract.** Each phase receives the previous phase's concrete file paths + the design tokens.
  Never re-run an earlier generative phase.
- **Verify by measuring, then looking.** Before saying "done", run **both** blocking gates —
  `verify-composition.mjs` (layout, A4) and `verify-seo-perf.mjs` (SEO/meta/OpenGraph/performance, A4b) —
  and clear or justify every `error`, **then** render and read a screenshot at mobile + desktop. Numbers
  catch what the eye misses; a screenshot you didn't read doesn't count.
- **Brand wins over taste.** When Step 0b loaded a brand file, its tokens and `doNot` list override any
  design-data candidate or taste call. When there's no brand, derive identity as the base pipeline does.
- **Match the project.** In an existing repo, use its framework, components, icon set, and conventions;
  don't introduce a second stack.
