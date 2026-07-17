#!/usr/bin/env python3
"""Check each bundled upstream for a newer release and bump its `ref` in upstreams.json.

- Tag-tracked skills  -> highest semver tag matching the policy's `pattern`.
- Branch-tracked skills (no upstream tags) -> current branch HEAD commit SHA.

Writes new refs back with a surgical text replace (so diffs stay one line) and prints
a Markdown summary (old -> new) for the CI PR body. Read-only against the upstream
repos; never touches vendored files. No newer release -> upstreams.json is untouched.
"""
import json
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "upstreams.json")


def ls_remote(args):
    return subprocess.run(["git", "ls-remote", *args],
                          capture_output=True, text=True, check=True).stdout


def latest_tag(repo, pattern):
    prefix = pattern[:-1] if pattern.endswith("*") else pattern
    best = None
    for line in ls_remote(["--tags", "--refs", repo]).splitlines():
        tag = line.rsplit("refs/tags/", 1)[-1]
        if not tag.startswith(prefix):
            continue
        m = re.match(r"^(\d+)\.(\d+)\.(\d+)$", tag[len(prefix):])
        if m:
            key = tuple(int(x) for x in m.groups())
            if best is None or key > best[0]:
                best = (key, tag)
    return best[1] if best else None


def head_sha(repo, branch):
    out = ls_remote(["--heads", repo, branch]).strip()
    return out.split()[0] if out else None


def main():
    with open(MANIFEST, encoding="utf-8") as f:
        text = f.read()
    manifest = json.loads(text)

    changes = []
    for s in manifest["skills"]:
        pol = s.get("update")
        if not pol:
            continue
        cur = s["ref"]
        if pol.get("track") == "tag":
            new = latest_tag(s["repo"], pol["pattern"])
        elif pol.get("track") == "branch":
            new = head_sha(s["repo"], pol.get("branch", "main"))
        else:
            new = None
        if new and new != cur:
            changes.append((s["name"], cur, new))
            text = text.replace(f'"ref": "{cur}"', f'"ref": "{new}"')

    if changes:
        with open(MANIFEST, "w", encoding="utf-8") as f:
            f.write(text)

    lines = [f"- **{name}**: `{old}` -> `{new}`" for name, old, new in changes]
    print("\n".join(lines) if lines else "No upstream updates.")

    summary = os.environ.get("UPSTREAM_SUMMARY_FILE")
    if summary and lines:
        with open(summary, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
