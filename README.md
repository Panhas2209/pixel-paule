# pixel-paule

<img src="docs/logo.png" align="right" width="140" alt="pixel-paule logo — replace docs/logo.png with your own">

**Type one sentence. Get one production-ready web page.**

pixel-paule is a Claude Code plugin. You describe a page in plain words. It runs a
full design studio for you — design system, hand-crafted build, motion, and a
two-part audit (layout + SEO/OpenGraph/performance) — and gives you real,
production-ready code. You never install, pick, or call a design skill yourself.
You just talk; it does the rest.

It's an extended fork of [`website-builder`](https://github.com/Jarek2k/website-builder).
It keeps everything good and adds the two things real sites need: an **optional
brand lock** and a **built-in SEO / meta / OpenGraph / performance audit**.

---

## The idea in one minute

Ask an AI to "build me a landing page" and you often get HTML that looks fine but
quietly breaks: sideways scroll on mobile, cards of different heights, grey text on
grey, no `<title>`, a link that shows as a bare URL in Slack. It *looks* done. It
isn't.

pixel-paule fixes that with two ideas:

| Idea | What it means for you |
|---|---|
| **One conversation partner, many specialists** | You talk to one skill (`website`). It calls three expert design skills plus its own checks. No skill-picking, no prompt-juggling. |
| **"Done" is measured, not guessed** | Two scripts read the finished page and report problems as hard numbers. The build can't call itself done while a real `error` is still open. |

So you stay at the level of *intent* ("make it calmer", "keep our logo"). The
plugin handles the craft and the checklist underneath.

---

## How it works

`website` is the only way in. It doesn't invent palettes, type, or motion. It calls
the right specialist for each step and passes the work along, so no two builders do
the same job.

| Step | Who does it | What comes out |
|---|---|---|
| 0 · Brand (optional) | `load-brand` | If a `brand.json` exists, its colors/fonts/logo/voice become a fixed rule for every later step. |
| 1 · Data | `website-ux` | Candidate palettes, font pairings, UX rules — reference material, not the final look. |
| 2 · Build | `website-build` | The real page: hand-crafted, non-generic, production-ready code. |
| 3 · Motion | `website-animation` + `website-animation-review` | Small interactions on the moving parts, then a motion review. |
| 4 · Audit (layout) | `verify-composition` | Blocking check: overflow, uneven heights, width use, contrast — with numbers. |
| 4b · Audit (findability) | `verify-seo-perf` | Blocking check: SEO, meta, OpenGraph, structured data, load performance. |

Only `website` reacts to your request; it pulls in each specialist when needed.
The specialist skills are named by what they do (`website-build`, `website-ux`,
`website-animation`, `website-animation-review`); they're bundled from upstream
projects — see [Credits](#credits--licenses) for the sources.

---

## The three modes (it picks for you)

You never name a mode. pixel-paule reads your input and chooses:

| You give it… | Mode | What it does |
|---|---|---|
| A description, a brief, or nothing | **New** | Asks 2–3 short questions, shows a quick plan, waits for your OK, then builds → motion → audits. |
| A URL or an existing site | **From reference** | Reads the reference, then either rebuilds it closely *or* redesigns it while keeping the brand. |
| A file or project path | **Improve** | Checks the page, fixes problems in place, audits again. Won't change your identity unless you ask. |

### A worked example

You type:

> **"Build me a landing page for a calm voice-notes second-brain app."**

Here's what happens, so nothing surprises you:

| Step | What you see |
|---|---|
| 1. Shape | It asks ~3 questions: who it's for, the one main action, any color/visual direction. |
| 2. Plan | It replies with a 3–5 bullet plan and **waits for your OK**. |
| 3. Build | After your OK, it builds the real page (default stack Next.js + Tailwind + shadcn/ui; change with `--stack`). |
| 4. Motion | It adds tasteful motion, then reviews it. |
| 5. Audits | It runs both checks, fixes every `error`, and only then says "done". |

The point: **it confirms the direction before it builds**, so you don't lose five
minutes to a wrong turn.

### More example prompts

| Goal | Say something like… |
|---|---|
| New page from scratch | `"Make a pricing page for a B2B analytics tool, trustworthy and dense."` |
| Set the tech stack | `"Build a docs landing page. --stack astro"` |
| Rebuild a reference 1:1 | `"Rebuild https://example.com but with clean, accessible code."` |
| Redesign but keep brand | `"Redesign our site, keep the logo and brand colors. --keep-brand"` |
| Fix an existing file | `"Go over ./index.html — fix spacing, typography, SEO and animations."` |
| Audit only, no rebuild | `"Audit ./index.html for SEO and layout problems, don't change the design yet."` |

> **Flags go *inside* your message.** `--keep-brand`, `--stack …`, and `brand=…`
> are just words you type in the sentence, not separate commands. Example:
> *"Redesign our site but keep the logo. **--keep-brand**"*. You can mix them:
> *"Rebuild this page. **--stack astro brand=./brand.json**"*.

---

## Tech stack — default and how to change it

You don't have to name a stack. Say nothing and pixel-paule uses its default. To
force another one, add `--stack <name>` to your message.

| | |
|---|---|
| **Default** | **Next.js + Tailwind + shadcn/ui** |
| **Change per build** | add `--stack astro` (or `next`, `vite`, `svelte`, `html`, …) to your prompt |

**Which values work?** `--stack` is just a hint, so you can name any framework.
What makes pixel-paule *smarter* per stack is the design data bundled with `website-ux`
(from ui-ux-pro-max), which covers these **16 stacks**:

| Web | App / native | Other |
|---|---|---|
| `react`, `nextjs`, `vue`, `nuxtjs`, `nuxt-ui`, `svelte`, `astro`, `angular`, `html-tailwind`, `shadcn`, `laravel` | `swiftui`, `react-native`, `flutter`, `jetpack-compose` | `threejs` |

A stack outside this list still works. You just don't get the extra stack-specific
reference data.

---

## Visual style — pick a look

You can steer the *look* of the page. The bundled `website-ux` skill (from
ui-ux-pro-max) ships a
catalog of 80+ named visual styles — Minimalism / Swiss, Glassmorphism,
Neumorphism, Brutalism, Bento Grid, Claymorphism, Aurora UI, Cyberpunk / HUD,
Editorial / Magazine, Dark Mode (OLED), Data-Dense Dashboard, and many more.

See the full list here:
[ui-ux-pro-max — Available styles](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill#available-styles-67).

You don't need a flag — just name the style in your prompt. pixel-paule looks it
up and uses it as the visual direction for the build.

```
"Build a landing page for a fintech app in a Glassmorphism style, dark mode."
"Make a docs homepage — Swiss / Minimalism, lots of whitespace."
"Redesign this page as a Bento Grid."
```

Tip: you can also nudge the intensity in plain words — *"make it bolder"* or
*"keep it calmer"* — and pixel-paule adjusts without you naming a style.

---

## Brand input (optional, but powerful)

Put a `brand.json` (or `brand.yaml`) in your project and pixel-paule keeps every
build on-brand: same colors, fonts, logo, tone, and hard "don'ts". No brand file?
Nothing changes; it builds a look from your brief as usual.

**Where does it go?** In the **root of the project you build the site in**.
pixel-paule finds it automatically (first match wins):

| Looked for (from your project root) |
|---|
| `brand.json` → `brand.yaml` → `brand.yml` → `.brand.json` → `brand/brand.json` → `brand/brand.yaml` |

Somewhere else? Point at it with `brand=./config/my-brand.json` in your prompt.

**Example `brand.json`:**

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
| `name` / `url` | Fill `<title>`, canonical, and `og:` tags in the SEO audit. |
| `colors` / `fonts` | Fixed seed — the data step can only fill gaps, never override them. |
| `logo` / `favicon` | Kept as-is, never restyled. Wired into the page and the SEO audit. |
| `voice` / `tone` | Set the copy's wording and formality. |
| `doNot` | Hard rules the build **and** the audit must follow. |

---

## The two audit gates (why you can trust the output)

Both are plain Node scripts: fixed rules, no extra installs, no AI guessing. Each
prints a JSON list of findings plus a short summary. Each exits non-zero if any
`error`-level problem is left. During a build, an `error` blocks "done".

| Gate | Catches (examples) | `error` means |
|---|---|---|
| `verify-composition` | sideways overflow, uneven card heights, poor text width, low contrast | overflow, or contrast below WCAG AA |
| `verify-seo-perf` | missing `<title>`/`<h1>`/viewport, weak meta description, OpenGraph/Twitter cards, JSON-LD validity, render-blocking scripts, images with no size (CLS), fonts without `display=swap`, page weight/timing | missing title/`<h1>`/viewport/`og:image`, broken JSON-LD, or accidental `noindex` |

pixel-paule runs both for you at the end of every build. You don't have to type
anything. But you *can* run either one by hand on any page, as a standalone linter:

```
node plugin/skills/website/scripts/verify-seo-perf.mjs ./index.html
node plugin/skills/website/scripts/verify-composition.mjs ./index.html -b 390,768,1280
```

A local Chrome adds real runtime numbers (requests, bytes, load time). Both scripts
still work without it, and `verify-seo-perf --no-chrome` runs the full static check
anyway.

---

## Install

```
claude plugin marketplace add Panhas2209/pixel-paule
claude plugin install pixel-paule@panhas2209
```

Then reload your editor and check with `claude plugin list`. Update later with
`claude plugin update pixel-paule@panhas2209`.

You need `node` and `python3` (usually already there). A browser/Playwright MCP is
optional (better URL rebuilds and visual checks). A local Chrome/Chromium turns on
the runtime performance numbers.

## Power-user shortcuts

| Want to… | Do this |
|---|---|
| Call a bundled specialist directly | `/pixel-paule:website-build audit` |
| Run only the SEO/OpenGraph/performance audit | `/pixel-paule:website-seo ./index.html` |
| Set a stack | add `--stack next\|astro\|vite\|svelte\|html` to your prompt |
| Point at a specific brand file | add `brand=./config/brand.json` to your prompt |
| Keep an existing brand on a redesign | add `--keep-brand` |

---

## Credits & licenses

This plugin **bundles** the upstream skills; each keeps its own license (copies in
[`third_party/`](third_party), summarized in [`NOTICE`](NOTICE)): ui-ux-pro-max
(MIT), emil-design-eng (MIT), impeccable (Apache-2.0). All credit for the design
smarts goes to their authors. The orchestrator, both audit gates, the brand loader,
and the tooling here are MIT. Original orchestrator scaffolding by
[Jarek2k/website-builder](https://github.com/Jarek2k/website-builder) (MIT).

---

Maintaining, extending, or forking this plugin? See
[`docs/maintaining.md`](docs/maintaining.md) for the upstream-sync automation, how
to add or swap a skill, and how conflicts between the bundled builders are prevented.
