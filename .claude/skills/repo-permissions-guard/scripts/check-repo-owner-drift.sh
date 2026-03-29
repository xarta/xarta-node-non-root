#!/usr/bin/env bash

set -euo pipefail

REPO_PATH="${1:-/xarta-node}"
EXPECTED_USER="${2:-xarta}"
EXPECTED_GROUP="${3:-$EXPECTED_USER}"

if [[ ! -e "$REPO_PATH" ]]; then
    echo "ERROR: path not found: $REPO_PATH" >&2
    exit 2
fi

echo "Repo path      : $REPO_PATH"
echo "Expected owner : $EXPECTED_USER:$EXPECTED_GROUP"
echo "Ignoring       : .git internals"
echo

mapfile -d '' mismatches < <(
    find "$REPO_PATH" \
        -path '*/.git' -prune -o \
        \( -not -user "$EXPECTED_USER" -o -not -group "$EXPECTED_GROUP" \) -print0
)

if (( ${#mismatches[@]} == 0 )); then
    echo "OK: no ownership drift found."
    exit 0
fi

echo "Ownership drift found: ${#mismatches[@]} path(s)"
echo

for path in "${mismatches[@]}"; do
    stat -c '%U:%G %A %n' "$path"
done

exit 1