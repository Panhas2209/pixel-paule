# Bake-off harness — evaluate a builder skill before adding/replacing it

A repeatable, blind A/B evaluation to decide, on evidence, whether a candidate
design skill should **lead the build**, **complement** the bundle in a new role,
or **replace** the incumbent builder. This is the tool to reach for whenever a
promising new skill appears (the question Jarek raised: *"vielleicht wird bald
ein neuer Skill released, der einen ablöst"*).

The current lane assignment (impeccable builds; ui-ux-pro-max = data + checklist
+ audit; emil = motion) was decided by exactly this procedure.

## How to run it

Ask Claude (with this plugin active):

> "Run the website bake-off: build the standard brief with `<candidate-skill>`
> and with `<incumbent>` (impeccable), then judge them blind."

Claude drives it as follows — no committed script, because the steps are agentic:

1. **Same brief, both builders.** Use the standard brief below (or a second one in
   a different register for breadth — e.g. a dashboard/app-UI brief). Each builder
   uses **only** its assigned skill and writes a single self-contained `index.html`
   to its own output dir. Identical output constraints for fairness (vanilla, no
   framework, opens via `file://`).
2. **Blind the outputs.** Copy both into neutral `A/` and `B/` dirs, scrub any
   tool-name strings from comments, and render identical desktop (1440) + mobile
   (390) screenshots with headless Chrome.
3. **Three independent judges**, each on one lens, each blind to which tool is which:
   - **Anti-AI-slop / distinctiveness / brand fit** — does it look AI-made? cream-bg
     default, per-section uppercase eyebrows, identical card grids, gradient text, etc.
   - **Production quality** — semantic HTML, a11y/contrast/focus, responsive integrity
     (read the mobile shot), reduced-motion, no-JS visibility, code quality.
   - **Visual craft & taste** — typography, spacing/rhythm, color, composition, motion.
   Each scores both designs, picks a winner on its lens, with concrete evidence.
4. **Tally.** Majority of lenses → the lead builder. A split (e.g. one wins craft,
   the other wins production-correctness) is itself a finding: it usually means the
   loser of the build lane is the better **checklist/audit** lane — which is exactly
   how ui-ux-pro-max ended up as the data + audit layer rather than the builder.

## Standard brief

> Landing page for **"Mycelium"** — turns scattered voice memos into an organized
> second brain. Audience: overwhelmed knowledge workers. Tone: calm, organic,
> anti-hustle. Sections, in order: Hero, How-it-works (3 steps), Feature highlights,
> Social proof, Pricing teaser, Footer CTA. Real copy (no lorem). Responsive,
> accessible, tasteful motion. Output: one self-contained `index.html`, vanilla,
> no framework/build, opens via `file://`.

Chosen because the lazy AI default (cream/sand bg, eyebrow-on-every-section, identical
card grids) is obvious here — so a builder's ability to *avoid* slop is measurable.

## Result that set the current lanes (2026-06-28, blind)

| Lens | ui-ux-pro-max | impeccable | Winner |
|---|---|---|---|
| Anti-slop / distinctiveness | distinct 4 · brandfit 7 | distinct 8 · brandfit 7 | **impeccable** (high) |
| Production / correctness | a11y 9 · resp 9 · code 8 | a11y 7 · resp 6 · code 8 | **ui-ux-pro-max** (high) |
| Visual craft | 7 / 7 / 8 / 7 | 8 / 8 / 8 / 8 | **impeccable** (med) |

impeccable won the two lenses that measure "doesn't look AI-made / has taste";
ui-ux-pro-max won production-correctness (impeccable's build had a mobile-clipping
bug + OKLCH-without-fallback). Hence: **impeccable builds, ui-ux-pro-max audits.**
The orchestrator's A4 audit step explicitly re-checks impeccable's demonstrated
blind spots (mobile overflow, contrast margin, color fallback).
