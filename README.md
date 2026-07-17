# pixel-paule

**One sentence you type → one production-grade web page you ship.**

pixel-paule is a Claude Code plugin. You describe a page in plain language; it
runs a full design studio for you — design system, taste-driven build, motion,
and a two-part *blocking* audit (layout + SEO/OpenGraph/performance) — and hands
back real, production-quality code. You never install, pick, or invoke a single
design skill by hand. You just talk; it orchestrates.

It's an extended fork of [`website-builder`](https://github.com/Jarek2k/website-builder)
that keeps everything good and adds the two things real sites need: an **optional
brand lock** and a **deterministic SEO / meta / OpenGraph / load-performance audit**.

---

## The idea in one minute

Ask a general-purpose AI to "build me a landing page" and you usually get
plausible-looking HTML that quietly breaks: horizontal scroll on mobile, cards of
unequal height, grey-on-grey text, no `<title>`, a link that previews as a naked
URL in Slack. It *looks* done. It isn't.

pixel-paule closes that gap with two ideas:

| Idea | What it means for you |
|---|---|
| **One conductor, many specialists** | A single skill (`website`) sequences three expert design skills + its own checks. You talk to one thing; it delegates. No skill-picking, no prompt-juggling. |
| **"Done" is measured, not eyeballed** | Two scripts render/parse the finished page and report defects as hard numbers. The build can't declare itself finished while a real `error` is open. |

The result: you stay at the level of *intent* ("make it calmer", "keep our
logo"), and the plugin handles the craft and the checklist underneath.

---

## How it works

`website` is the only entry point. It doesn't invent palettes, type, or motion —
it loads the right specialist for each phase and passes the work along so two
builders never redo the same job.

| Phase | Who does it | What comes out |
|---|---|---|
| 0 · Brand (optional) | `load-brand` | If a `brand.json` exists, its colors/fonts/logo/voice become a locked constraint for every later phase. |
| 1 · Data | `ui-ux-pro-max` | Candidate palettes, font pairings, UX rules — reference material, not the final look. |
| 2 · Build | `impeccable` | The actual page: taste-driven, anti-"AI-slop", production-grade code. |
| 3 · Motion | `emil-design-eng` + `review-animations` | Micro-interactions on interactive surfaces, then a motion QA pass. |
| 4 · Audit (layout) | `verify-composition` | Blocking check: overflow, unequal heights, width use, contrast — with numbers. |
| 4b · Audit (findability) | `verify-seo-perf` | Blocking check: SEO, meta, OpenGraph/social, structured data, load performance. |

The specialists are kept out of auto-routing, so **only `website` reacts to your
request** and pulls each specialist in on demand.

---

## The three modes (it picks automatically)

You never name a mode. pixel-paule reads your input and chooses:

| You give it… | Mode | What it does |
|---|---|---|
| A description / brief / nothing | **New** | Asks 2–3 sharp questions, shows a short design brief, waits for your OK, then builds → motion → audits. |
| A URL or an existing site | **From reference** | Fetches + extracts the reference, then either rebuilds it faithfully *or* redesigns it while keeping the brand. |
| A file or project path | **Improve** | Diagnoses the existing page, fixes issues in place, re-audits. Won't touch your identity unless you ask. |

### What actually happens — a worked example

You type:

> **"Build me a landing page for a calm voice-notes second-brain app."**

Here's the flow, so there are no surprises:

| Step | What you see |
|---|---|
| 1. Shape | It asks ~3 focused questions: who's it for, what's the one action, any color/visual direction. |
| 2. Brief | It replies with a 3–5 bullet plan (what it's building, primary CTA, visual lane) and **stops for your confirmation**. |
| 3. Build | On your OK, it builds the real page (default stack Next.js + Tailwind + shadcn/ui; override with `--stack`). |
| 4. Motion | It adds tasteful motion, then reviews it against a craft bar. |
| 5. Audits | It runs both gates, fixes every `error`, and only then says "done" — telling you what it checked. |

The key habit: **it confirms the direction before building**, so you're never
surprised by a wrong turn after five minutes of generation.

### More example prompts

| Goal | Say something like… |
|---|---|
| New page from scratch | `"Make a pricing page for a B2B analytics tool, trustworthy and dense."` |
| Pin the tech stack | `"Build a docs landing page. --stack astro"` |
| Rebuild a reference 1:1 | `"Rebuild https://example.com but with clean, accessible code."` |
| Redesign but keep brand | `"Redesign our site, keep the logo and brand colors." (--keep-brand)` |
| Fix an existing file | `"Go over ./index.html — fix spacing, typography, SEO and animations."` |
| Just audit, no rebuild | `"Audit ./index.html for SEO and layout problems, don't change the design yet."` |

---

## Brand input (optional, but powerful)

Drop a `brand.json` (or `brand.yaml`) in your project and pixel-paule keeps every
build on-brand automatically — same colors, fonts, logo, tone, and hard "don'ts".
No brand file? Nothing changes; it derives a look from your brief as usual.

A minimal example (full template: `plugin/skills/website/reference/brand.example.json`):

```json
{
  "name": "Acme Manufacturing",
  "url": "https://acme.example",
  "colors": { "primary": "#0F3D66", "accent": "#E8A317", "text": "#12212E" },
  "fonts":  { "heading": "Inter", "body": "Inter" },
  "logo":   "assets/logo.svg",
  "voice":  "kurze, konkrete Sätze; Nutzen vor Features; Sie-Form",
  "doNot":  ["keine Stockfoto-Ästhetik", "Logo nie einfärben"]
}
```

| Field | Effect |
|---|---|
| `colors` / `fonts` | Locked seed — the design-data phase can only fill gaps, never override them. |
| `logo` / `favicon` | Held fixed; never restyled. Wired into the page and the SEO audit. |
| `voice` / `tone` | Drives the copy's wording and formality. |
| `doNot` | Hard rules the build **and** the audit must respect. |
| `name` / `url` | Feed `<title>`, canonical, and `og:` tags in the SEO audit. |

Precedence when several are present:
`brand=path` › auto-discovered file › `--keep-brand` + free text › brief-derived.
Details: [`plugin/skills/website/reference/brand-input.md`](plugin/skills/website/reference/brand-input.md).

---

## The two audit gates (why output is trustworthy)

Both are plain Node scripts — deterministic, zero-dependency, no LLM guessing.
Each prints a JSON list of findings + a human summary, and exits non-zero if any
`error`-level issue remains. The build treats an `error` as blocking.

| Gate | Catches (examples) | `error` = |
|---|---|---|
| `verify-composition` | horizontal overflow, unequal card heights, poor text-width use, low contrast | overflow, contrast below WCAG AA |
| `verify-seo-perf` | missing `<title>`/`<h1>`/viewport, weak meta description, OpenGraph/Twitter cards, JSON-LD validity, render-blocking scripts, images without dimensions (CLS), fonts without `display=swap`, load weight/timing | missing title/`<h1>`/viewport/`og:image`, invalid JSON-LD, accidental `noindex` |

You can run either by hand on any page — great as a standalone linter:

```
node plugin/skills/website/scripts/verify-seo-perf.mjs ./index.html
node plugin/skills/website/scripts/verify-composition.mjs ./index.html -b 390,768,1280
```

A local Chrome unlocks real runtime metrics (requests, bytes, load timing); both
scripts degrade gracefully without it, and `verify-seo-perf --no-chrome` runs the
full static pass anyway.

---

## Install

Works everywhere, including the VS Code / JetBrains extensions (where in-app
`/plugin` is disabled):

```
claude plugin marketplace add Panhas2209/pixel-paule
claude plugin install pixel-paule@panhas2209
```

Then reload your editor (VS Code: **Cmd/Ctrl+Shift+P → "Developer: Reload
Window"**) and verify with `claude plugin list`. Update later with
`claude plugin update pixel-paule@panhas2209`.

Requirements: `node` and `python3` (both usually present). A browser/Playwright
MCP is optional (better URL rebuilds + visual checks); a local Chrome/Chromium
enables runtime performance metrics.

## Power-user shortcuts

| Want to… | Do this |
|---|---|
| Call a bundled specialist directly | `/pixel-paule:impeccable audit` |
| Force a stack | add `--stack next\|astro\|vite\|svelte\|html` to your prompt |
| Point at a specific brand file | add `brand=./config/brand.json` to your prompt |
| Keep an existing brand on a redesign | add `--keep-brand` |

---

## Credits & licenses

This plugin **vendors** the upstream skills; each keeps its own license (copies in
[`third_party/`](third_party), summarized in [`NOTICE`](NOTICE)): ui-ux-pro-max
(MIT), emil-design-eng (MIT), impeccable (Apache-2.0). All credit for the design
intelligence belongs to their authors. The orchestrator, both audit gates, the
brand loader, and the tooling here are MIT. Original orchestrator scaffolding by
[Jarek2k/website-builder](https://github.com/Jarek2k/website-builder) (MIT).

---

Maintaining, extending, or forking this plugin? See
[`docs/maintaining.md`](docs/maintaining.md) for the upstream-sync automation, how
to add/swap a skill, and how conflicts between the bundled builders are prevented.
