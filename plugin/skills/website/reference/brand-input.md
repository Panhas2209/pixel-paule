# Brand input (optional)

A brand file is **never required**. When one exists it is loaded once at the
start of a run and passed as a **hard constraint** into every phase — data,
build, motion, and both audits — so the result stays on-brand instead of
inventing a new identity. When none exists, the pipeline behaves exactly like
the original: it derives an identity from the brief (or, in `--keep-brand` mode,
from the reference/logo).

## Precedence (highest first)

1. An explicit path passed to the orchestrator (`brand=./config/brand.json`).
2. A brand file auto-discovered in the project root:
   `brand.json` → `brand.yaml` → `brand.yml` → `.brand.json` → `brand/brand.json`.
3. The `--keep-brand` flag + any free-text brand description in the prompt
   (unstructured fallback — the original behaviour).
4. Nothing → identity is derived from the brief.

A structured brand file always wins over free-text. Free-text only fills gaps
the file left empty.

## Loading it

```bash
node "$PR/skills/website/scripts/load-brand.mjs" [optional/path/to/brand.json]
```

It prints normalised JSON on stdout (`{present:false}` when nothing is found —
a valid, common state) and a human summary + validation warnings on stderr.
JSON is fully supported; a small YAML subset (2-level maps + string lists) is
supported for convenience — prefer JSON if a field looks ambiguous.

## Schema

All fields optional. Unknown keys are ignored with a warning.

| Key | Type | Meaning |
|---|---|---|
| `name` | string | Brand name, referenced in copy + metadata. |
| `url` | string | Canonical site URL (feeds SEO canonical + og:url). |
| `colors` | map | `primary, secondary, accent, background, surface, text, muted, border, success, warning, danger` — CSS colors (hex/rgb/hsl/oklch/var). |
| `fonts` | map | `heading, body, mono` — font family names. |
| `logo` / `logoDark` | string | Path or URL. Held fixed; never restyled. |
| `favicon` | string | Path or URL. |
| `radius` | string | Corner radius token, e.g. `10px`. |
| `density` | string | `compact` \| `comfortable` \| `spacious`. |
| `tone` | string | Brand tone in one line. |
| `voice` | string | Copy voice/rules (e.g. language, formality). |
| `doNot` | string[] | Hard don'ts the build + audit must respect. |
| `references` | string[] | Aesthetic anchors (URLs or names). |

See `brand.example.json` in this folder for a filled-in example.

## How each phase must honour it

- **A0 Shape** — do not re-ask what the brand file already answers; only fill gaps.
- **A1 Data** — treat brand `colors`/`fonts` as the locked seed; ui-ux-pro-max
  output is candidate/reference data, subordinate to the brand.
- **A2 Build** — brand colors, fonts, radius, logo are fixed inputs, not
  suggestions. Respect every entry in `doNot`. Copy follows `voice`/`tone`.
- **A3 Motion** — motion must not fight the brand's density/tone.
- **A4 / SEO audit** — `name`/`url` feed `<title>`, canonical, og:title/og:url;
  `logo`/favicon presence is verified.

If a brand entry conflicts with a taste decision, **the brand wins** — that is
the whole point of supplying one.
