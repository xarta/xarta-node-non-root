---
name: repo-permissions-guard
description: Keep xarta-owned repo paths free of root-owned drift when root-run scripts or services write into them. Use when adding write operations under /xarta-node or auditing ownership problems.
---

# Repo Permissions Guard

Use this when work touches xarta-owned repo paths such as `/xarta-node` but the
writer is still `root`.

## Core rule

If a root-run script creates, rewrites, or relinks anything inside an xarta-owned
repo path, hand ownership back immediately.

Preferred helper:

```bash
chown_like() {
    local ref_path="$1"
    local target_path="$2"
    local owner

    owner="$(stat -c '%u:%g' "$ref_path")"
    if [[ -L "$target_path" ]]; then
        chown -h "$owner" "$target_path"
    else
        chown "$owner" "$target_path"
    fi
}
```

## Audit script

Check a repo tree for ownership drift:

```bash
bash /xarta-node/.claude/skills/repo-permissions-guard/scripts/check-repo-owner-drift.sh /xarta-node xarta xarta
```

## Scope

This public copy exists because the guard is directly relevant to the public
non-root repo layout. Keep private-only operational notes in the private repo.