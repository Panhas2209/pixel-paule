# Maintaining pixel-paule

Notes for whoever owns or forks this plugin. Regular users don't need any of
this — see the [README](../README.md) to install and use it.

## How conflicts are prevented

The plugin bundles three independent design skills that, on their own, would all
try to answer "build me a website" and fight over the request. The orchestration
keeps them in lanes:

- Each vendored skill is patched to `disable-model-invocation: true`, so only the
  `website` orchestrator auto-fires. The specialists are loaded by it on demand —
  it reads their `SKILL.md` and runs their scripts.
- Hard-coded `.claude/skills/...` paths are rewritten to `${CLAUDE_PLUGIN_ROOT}/...`
  during vendoring.
- impeccable's always-on anti-slop hook and browser "live" mode are intentionally
  not wired up: the audit phase covers quality, and the live mode needs a running
  browser.

The lane split (impeccable builds, ui-ux-pro-max provides data + audits, emil does
motion) was decided by a blind head-to-head bake-off — see
[`scripts/bake-off/`](../scripts/bake-off/README.md).

## First-party orchestrator code

The `website` skill is **not** vendored — it is this repo's own orchestrator. Any
tooling the orchestrator itself runs lives under
[`plugin/skills/website/scripts/`](../plugin/skills/website/scripts/README.md) and
is safe there: `sync-upstreams.sh` only `rm -rf`s the vendored skill targets, so a
file placed inside a vendored skill (e.g. `plugin/skills/impeccable/`) would be
wiped on the next upstream bump. Keep first-party scripts out of the vendored dirs.

Three first-party scripts live here, all safe from the vendoring wipe:

- `verify-composition.mjs` — blocking **layout** audit (Mode A · A4, Mode C · C3).
- `verify-seo-perf.mjs` — blocking **SEO / meta / OpenGraph / structured-data /
  performance** audit (Mode A · A4b, Mode C · C3). Static pass needs no browser;
  the optional runtime pass reuses the same system-Chrome-over-CDP launcher.
- `load-brand.mjs` — loads the **optional** brand file (Step 0b) as a hard
  constraint. Schema + rules in `plugin/skills/website/reference/brand-input.md`.

All three are zero-dependency and share one test suite:

```bash
node --test 'plugin/skills/website/scripts/test/*.test.mjs'
```

The composition tests skip cleanly without Chrome; the SEO/perf tests run fully
offline (`--no-chrome`).

## Keeping upstreams current

**Upstream skills → this repo (automatic, PR-based).** A weekly GitHub Action
([`.github/workflows/sync.yml`](../.github/workflows/sync.yml)) checks each bundled
skill for a newer release (per the `update` policy in
[`upstreams.json`](../upstreams.json)). If there is one it bumps the pin,
re-vendors + re-patches, bumps the plugin version, and **opens a pull request**
with a changelog — nothing lands unreviewed. If nothing is newer, it does nothing.

> One-time: in **Settings → Actions → General → Workflow permissions**, enable
> *"Read and write permissions"* and *"Allow GitHub Actions to create and approve
> pull requests"* so the Action can open PRs.

To bump a pin yourself: `python3 scripts/check-upstreams.py` (resolves the latest
refs) or edit `upstreams.json` directly, then `bash scripts/sync-upstreams.sh --bump`.

## Extending it (add / swap / remove a skill)

Everything is data-driven via [`upstreams.json`](../upstreams.json):

- **Add** a skill → add one entry (repo, ref, source subpath, role, license, patch
  directives).
- **Swap** a skill → change its entry + repoint the role row in the orchestrator's
  table.
- **Remove** → delete the entry.

Then `bash scripts/sync-upstreams.sh`. The sync +
[`patch-frontmatter.py`](../scripts/patch-frontmatter.py) scripts contain no
skill-specific code, so most additions need zero code. To decide *whether* a new
builder is actually better than the current one, run the reusable
[bake-off harness](../scripts/bake-off/README.md).

## The names you'll see

You never type your own name anywhere. The only name you supply is the repo
address `Panhas2209/pixel-paule` (where the code lives, like a `git clone` URL).

| You see | What it is |
|---|---|
| `Panhas2209/pixel-paule` | the **GitHub repo address** (`owner/repo`) — only used by `marketplace add`. Same for everyone. |
| `panhas2209` | the **marketplace** (catalog) name — declared in this repo's `marketplace.json`, read automatically. |
| `pixel-paule` | the **plugin** (the actual tool) — what you install and use. |

`pixel-paule@panhas2209` just means "the `pixel-paule` plugin from the
`panhas2209` catalog".
