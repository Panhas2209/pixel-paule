#!/usr/bin/env python3
"""Generic, data-driven patcher for vendored skills.

Reads upstreams.json and, for each skill entry, applies:
  - `frontmatterSet`: set/insert top-level keys in the skill's SKILL.md frontmatter
    (e.g. disable-model-invocation: true) so bundled skills don't auto-fire and
    fight the orchestrator.
  - `pathRewrites`: literal string replacements across the skill's text files
    (e.g. rewrite hard-coded `.claude/skills/...` paths to `${CLAUDE_PLUGIN_ROOT}/...`).

No skill-specific logic lives here — everything is read from the manifest, so a new
upstream skill needs zero code changes. Re-running is idempotent.
"""
import argparse
import json
import os

TEXT_EXTS = {".md", ".mjs", ".cjs", ".js", ".ts", ".json", ".py", ".txt",
             ".sh", ".html", ".htm", ".css", ".yml", ".yaml"}


def fmt(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def set_frontmatter(path, kv):
    """Set top-level scalar keys in a markdown YAML frontmatter block. Idempotent."""
    if not kv:
        return False
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()

    if not text.startswith("---"):
        block = "---\n" + "".join(f"{k}: {fmt(v)}\n" for k, v in kv.items()) + "---\n"
        new = block + text
        if new != text:
            with open(path, "w", encoding="utf-8") as f:
                f.write(new)
            return True
        return False

    lines = text.split("\n")
    close = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if close is None:
        return False

    fm = lines[1:close]
    for k, v in kv.items():
        val = fmt(v)
        replaced = False
        for j, ln in enumerate(fm):
            # match top-level keys only (column 0, not indented list items)
            if ln[:1] not in (" ", "\t") and ":" in ln and ln.split(":", 1)[0].strip() == k:
                fm[j] = f"{k}: {val}"
                replaced = True
                break
        if not replaced:
            fm.append(f"{k}: {val}")

    new = "\n".join([lines[0]] + fm + lines[close:])
    if new != text:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new)
        return True
    return False


def apply_rewrites(root, rewrites):
    """Apply literal path rewrites to every text file under root. Idempotent even
    when `from` is a substring of `to` (protects already-rewritten occurrences)."""
    if not rewrites:
        return 0
    changed = 0
    for dirpath, _dirs, files in os.walk(root):
        for fn in files:
            if os.path.splitext(fn)[1].lower() not in TEXT_EXTS:
                continue
            p = os.path.join(dirpath, fn)
            try:
                with open(p, "r", encoding="utf-8") as f:
                    text = f.read()
            except (UnicodeDecodeError, OSError):
                continue
            orig = text
            for i, rw in enumerate(rewrites):
                frm, to = rw["from"], rw["to"]
                sentinel = "\x00RW%d\x00" % i
                text = text.replace(to, sentinel).replace(frm, to).replace(sentinel, to)
            if text != orig:
                with open(p, "w", encoding="utf-8") as f:
                    f.write(text)
                changed += 1
    return changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--skills-dir", required=True)
    args = ap.parse_args()

    with open(args.manifest, encoding="utf-8") as f:
        manifest = json.load(f)

    for s in manifest["skills"]:
        target = os.path.join(args.skills_dir, s["target"])
        if not os.path.isdir(target):
            print(f"  ! skip {s['name']}: {target} missing")
            continue
        skill_md = os.path.join(target, "SKILL.md")
        fm_changed = (set_frontmatter(skill_md, s.get("frontmatterSet") or {})
                      if os.path.isfile(skill_md) else False)
        rewritten = apply_rewrites(target, s.get("pathRewrites") or [])
        print(f"  · {s['name']}: frontmatter={'updated' if fm_changed else 'ok'}, "
              f"files-rewritten={rewritten}")


if __name__ == "__main__":
    main()
