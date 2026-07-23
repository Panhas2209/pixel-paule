# CLAUDE.md — pixel-paule

Guidance for Claude Code (and humans) working in this repository. Read this first.

## What this project is

**pixel-paule** is a Claude Code **plugin** that turns a plain-language request
("build me a landing page") into a production-ready web page. A single
orchestrator skill (`website`) sequences bundled specialist design skills and two
deterministic audit scripts. It is an extended fork of
[Jarek2k/website-builder](https://github.com/Jarek2k/website-builder), adding an
optional **brand lock** and a **SEO / OpenGraph / performance audit**.

- **Repo:** `github.com/Panhas2209/pixel-paule`
- **Marketplace (catalog) name:** `panhas2209`
- **Plugin name:** `pixel-paule`
- **Install:** `claude plugin marketplace add Panhas2209/pixel-paule` then `claude plugin install pixel-paule@panhas2209`
- **Current version:** `1.1.0` (kept in sync across three fields — see "Versioning")
- **Author:** Panhas2209 · panhas@gmx.net · license MIT (first-party)

## Repository layout

This repo is a **marketplace repository**, so there are two levels: the repo root
(catalog + tooling) and `plugin/` (the actual installable plugin).

```
.
├── .claude-plugin/marketplace.json   # catalog "panhas2209", lists the plugin + version
├── plugin/                           # the installable plugin (this is what ships)
│   ├── .claude-plugin/plugin.json    # plugin manifest: name "pixel-paule", version
│   ├── skills/                       # all skills (see below)
│   ├── NOTICE                        # third-party attribution (bundled copy)
│   └── third_party/                  # vendored skill licenses (bundled copy)
├── scripts/                          # vendoring/sync tooling (NOT shipped in the plugin)
│   ├── sync-upstreams.sh             # re-vendor + patch + regen NOTICE/VENDOR.lock
│   ├── check-upstreams.py            # bump upstream pins per update policy
│   ├── patch-frontmatter.py          # set frontmatter + apply path rewrites (data-driven)
│   └── bake-off/                     # harness to compare builders (has its own README)
├── docs/
│   ├── maintaining.md                # maintainer guide (sync, extend, naming)
│   └── logo.png                      # README logo placeholder (swap with your own)
├── third_party/                      # vendored skill licenses (source of truth)
├── upstreams.json                    # SINGLE SOURCE OF TRUTH for bundled skills
├── VENDOR.lock                       # resolved upstream pins (generated)
├── NOTICE                            # third-party attribution (generated)
└── README.md                         # user-facing docs (English)
```

## The skills

All live under `plugin/skills/<dir>/SKILL.md`. The `name:` frontmatter = the
slash-command name (`/pixel-paule:<name>`). Only `website` auto-fires; the rest are
set `disable-model-invocation: true` so they never compete with the orchestrator
(they still appear in the slash list and can be called explicitly).

| Skill (`/pixel-paule:…`) | Dir | Origin | Role |
|---|---|---|---|
| `website` | `website` | **first-party** | The orchestrator — the only entry point. Detects mode, runs the pipeline. |
| `website-build` | `website-build` | vendored: [impeccable](https://github.com/pbakaus/impeccable) (Apache-2.0) | Lead builder: layout, type, anti-AI-slop craft, critique. |
| `website-ux` | `website-ux` | vendored: [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (MIT) | Design-system data: palettes, fonts, 80+ named styles, UX rules. Python engine. |
| `website-animation` | `website-animation` | vendored: [emil-design-eng](https://github.com/emilkowalski/skills) (MIT) | Motion & micro-interactions. |
| `website-animation-review` | `website-animation-review` | vendored: emilkowalski/skills (MIT) | Motion QA gate (10 standards). |
| `website-seo` | `website-seo` | **first-party** | Standalone entry to run the SEO/perf audit script only (no build). |

> **Skill names were deliberately renamed** from their upstream names to
> function-based names. The rename is reproduced on every sync — see "Vendoring".

## First-party scripts (the audit gates + brand loader)

Under `plugin/skills/website/scripts/`. All **zero-dependency Node** (Node 18+),
deterministic, no LLM. The `website` orchestrator runs the two gates automatically
at the end of every build; you can also run them by hand.

| Script | Purpose | Run |
|---|---|---|
| `verify-composition.mjs` | Layout audit: overflow, unequal heights, width use, contrast. Renders via system Chrome (CDP). | `node …/verify-composition.mjs <file-or-url> -b 390,768,1280` |
| `verify-seo-perf.mjs` | SEO / meta / OpenGraph / structured-data / **asset-parity** / performance audit. Static pass needs no browser; optional Chrome pass adds runtime metrics. | `node …/verify-seo-perf.mjs <file-or-url> [--no-chrome] [--json]` |
| `load-brand.mjs` | Discover/parse/validate the optional brand file. | `node …/load-brand.mjs [path]` |

**Exit codes (both audits):** `0` clean · `1` at least one `error`-severity finding · `2` target unreadable.
`error` blocks "done"; `warn`/`info` are advisory. Without Chrome the scripts degrade gracefully.

**Tests** (zero-dependency, `node:test`): `node --test 'plugin/skills/website/scripts/test/*.test.mjs'`
The `verify-seo-perf` tests run fully offline; the `verify-composition` tests skip cleanly when no Chrome is present.

## The orchestrator pipeline (`website`)

Defined in `plugin/skills/website/SKILL.md`. Key behaviors:

- **Three modes, auto-detected:** New (from a brief), From-reference (URL/site),
  Improve (existing file/project).
- **Step 0b — optional brand:** runs `load-brand.mjs`. If a brand file exists it
  becomes a hard constraint through all phases (brand wins over taste).
- **Pipeline:** shape/confirm → data (`website-ux`) → build (`website-build`) →
  motion (`website-animation` + `website-animation-review`) → audits
  (`verify-composition` + `verify-seo-perf`). It confirms the plan before building.
- **Flags are typed inside the prompt** (not separate commands): `--keep-brand`,
  `--stack next|astro|vite|svelte|html`, `brand=./path.json`.
- **Default tech stack** = Next.js + Tailwind + shadcn/ui, set in `SKILL.md` step
  **A0**. Change that one line for a different permanent default.
- **Visual styles:** `website-ux` ships 80+ named styles; the user names one in the
  prompt (no flag). Data lives in `plugin/skills/website-ux/data/`.

## Vendoring & update system (IMPORTANT)

Everything about the bundled skills is data-driven from **`upstreams.json`** — the
single source of truth. `scripts/sync-upstreams.sh` clones each upstream, copies it
into `plugin/skills/<target>/`, runs `patch-frontmatter.py`, and regenerates NOTICE
+ VENDOR.lock. `scripts/check-upstreams.py` bumps pins to the newest release.

Per-skill fields in `upstreams.json`:

- `name` — **upstream provenance** (used for cloning + NOTICE/VENDOR.lock). Keep as the original name.
- `target` — the **local skill directory AND invocation name** (e.g. `website-build`).
- `frontmatterSet` — frontmatter keys forced on the vendored `SKILL.md`. We set
  `disable-model-invocation: true` **and** `name: <target>` so the rename survives every sync.
- `pathRewrites` — literal string replacements so the skill's self-references point at the new dir.

**This is how the renames stay update-safe:** on any future sync, upstreams are
re-vendored into the `website-*` dirs and re-patched with the friendly names
automatically. Do **not** rename skills by hand-editing the vendored files only —
change `target` / `frontmatterSet.name` / `pathRewrites` in `upstreams.json`, then
run the sync (or `patch-frontmatter.py`).

Weekly sync runs via `.github/workflows/sync.yml` (Mondays + manual dispatch): it
opens a **PR** with any upstream bumps; nothing lands unreviewed.

## Conventions & gotchas

- **Versioning — bump 3 fields together:** `plugin/.claude-plugin/plugin.json`
  `version`, `.claude-plugin/marketplace.json` top-level `version`, and its
  `plugins[0].version`. Claude Code detects updates from these JSON files, **not**
  from GitHub Releases (releases are optional). `sync-upstreams.sh --bump` does the
  patch bump automatically; manual changes need a manual bump.
- **GitHub Actions can't push workflow files.** The default `GITHUB_TOKEN` may not
  create/modify `.github/workflows/**`. The sync workflow strips that path from its
  commit for this reason. Push workflow edits yourself (humans are allowed).
- **Don't "Re-run" a failed sync job** — it replays the stale state. Trigger a fresh
  run via Actions → sync-upstreams → Run workflow.
- **Repo setting for the sync PR:** Settings → Actions → General → Workflow
  permissions → enable "Read and write" + "Allow GitHub Actions to create and
  approve pull requests".
- **Zero-dependency rule:** first-party scripts use only Node built-ins (no npm
  install). Keep it that way; they must run anywhere with just `node`.
- **Chrome is optional:** audits degrade gracefully without it; never make a local
  browser a hard requirement.
- **Don't edit vendored skills directly** (`website-build`, `website-ux`,
  `website-animation`, `website-animation-review`) — changes are wiped on the next
  sync. First-party code lives in `website/` and `website-seo/` only.
- **`docs/logo.png`** is a placeholder; replacing that file updates the README logo
  (top-right, floated) without touching markup.

## Common tasks

| Task | How |
|---|---|
| Run the audits by hand | `node plugin/skills/website/scripts/verify-seo-perf.mjs ./index.html` (and `verify-composition.mjs … -b 390,768,1280`) |
| Run tests | `node --test 'plugin/skills/website/scripts/test/*.test.mjs'` |
| Re-vendor / update bundled skills | edit `upstreams.json` → `bash scripts/sync-upstreams.sh` (add `--bump` to bump version) |
| Add / swap / remove a bundled skill | edit one entry in `upstreams.json` (repo, ref, sourceSubpath, target, license, frontmatterSet, pathRewrites) → run the sync |
| Release a change | bump the 3 version fields → `git commit` → `git push`; then `claude plugin update pixel-paule@panhas2209` |
| Install/update locally | `claude plugin marketplace add Panhas2209/pixel-paule` / `claude plugin update pixel-paule@panhas2209`, then reload the editor |

## Credits & licenses

Bundled upstreams keep their own licenses (copies in `third_party/`, summarized in
`NOTICE`): ui-ux-pro-max (MIT), emil-design-eng (MIT), impeccable (Apache-2.0).
First-party code (orchestrator, both audit gates, brand loader, tooling) is MIT.
Original orchestrator scaffolding from Jarek2k/website-builder (MIT).
