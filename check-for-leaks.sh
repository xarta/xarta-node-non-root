#!/bin/bash

# check-for-leaks.sh
# Checks that values from the primary node config (.env, .nodes.json, and
# private infra patterns) do not appear in tracked files in /xarta-node.
#
# Source data defaults to the root-managed repo because /xarta-node is the
# non-root public repo and does not carry its own .env or private inner clone.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="${SOURCE_ROOT:-/root/xarta-node}"
PRIVATE_ROOT="${PRIVATE_ROOT:-$SOURCE_ROOT/.xarta}"
ENV_FILE="${ENV_FILE:-$SOURCE_ROOT/.env}"
INFRA_LEAKS_FILE="${INFRA_LEAKS_FILE:-$PRIVATE_ROOT/infra-leaks.txt}"

# Minimum value length to bother checking — avoids false positives on
# short/common strings like "5" or short interface names.
MIN_LEN=5

# Well-known public values that should never be flagged as leaks regardless of
# which .env key they appear under.
SKIP_VALUES=(
    "1.1.1.1"
    "1.0.0.1"
    "8.8.8.8"
    "8.8.4.4"
    "9.9.9.9"
    "149.112.112.112"
    "208.67.222.222"
    "208.67.220.220"
    "0.0.0.0"
    "127.0.0.1"
    "::1"
)

# Keys whose values are intentionally referenced in committed files and should
# not be treated as leaks.
SKIP_KEYS=(
    "REPO_CADDY_PATH"
    "REPO_OUTER_PATH"
    "REPO_INNER_PATH"
    "SERVICE_RESTART_CMD"
    "BLUEPRINTS_DB_DIR"
    "GIT_USER_NAME"
    "XARTA_USER"
    "XARTA_HOME"
    "XARTA_ENABLE_XRDP"
    "TAILSCALE_ACCEPT_DNS"
    "TAILSCALE_EXIT_NODE"
    "PROXMOX_SSH_KEY"
    "NODES_JSON_PATH"
    "BLUEPRINTS_FALLBACK_GUI_DIR"
    "BLUEPRINTS_SHARED_DB_DIR"
    "BLUEPRINTS_EMBED_DIR"
    "BLUEPRINTS_ASSETS_DIR"
    "BLUEPRINTS_GUI_DIR"
    "BLUEPRINTS_BACKUP_DIR"
    "CERTS_DIR"
    "SEEKDB_DB"
    "SYNCTHING_GUI_USER"
    "DOCS_ROOT"
    "THIS_NODE_DOCS_BACKUP"
)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [[ ! -f "$ENV_FILE" ]]; then
    echo "Error: .env not found at $ENV_FILE" >&2
    exit 1
fi

mapfile -t SCAN_FILES < <(
    git -C "$REPO_DIR" ls-files | sed "s|^|$REPO_DIR/|"
)

if [[ "${#SCAN_FILES[@]}" -eq 0 ]]; then
    echo "No tracked files found to scan in $REPO_DIR"
    exit 1
fi

echo "Scanning ${#SCAN_FILES[@]} tracked file(s) for leaks..."
echo "Scan repo:           $REPO_DIR"
echo "Source .env:         $ENV_FILE"
echo "Source infra-leaks:  $INFRA_LEAKS_FILE"
echo ""

LEAKS=0
SKIPPED=0

echo "=== Checking .env values ==="

while IFS= read -r line; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue

    key="${line%%=*}"
    raw_value="${line#*=}"

    skip=0
    for skip_key in "${SKIP_KEYS[@]}"; do
        [[ "$key" == "$skip_key" ]] && skip=1 && break
    done
    [[ "$skip" -eq 1 ]] && continue

    value="${raw_value#\"}"
    value="${value%\"}"
    value="${value%%[[:space:]]*#*}"
    value="${value%"${value##*[![:space:]]}"}"

    [[ -z "$value" ]] && continue

    skip_val=0
    for sv in "${SKIP_VALUES[@]}"; do
        [[ "$value" == "$sv" ]] && skip_val=1 && break
    done
    [[ "$skip_val" -eq 1 ]] && continue

    if [[ "${#value}" -lt "$MIN_LEN" ]]; then
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    matches=$(grep -rn --fixed-strings -- "$value" "${SCAN_FILES[@]}" 2>/dev/null || true)

    if [[ -n "$matches" ]]; then
        echo -e "${RED}LEAK${NC}: $key=\"$value\""
        echo "$matches" | while IFS= read -r match; do
            rel="${match/$REPO_DIR\//}"
            echo "       $rel"
        done
        echo ""
        LEAKS=$((LEAKS + 1))
    fi
done < "$ENV_FILE"

echo ""
echo "=== Checking infrastructure patterns ==="

if [[ ! -f "$INFRA_LEAKS_FILE" ]]; then
    echo -e "${YELLOW}Warning:${NC} $INFRA_LEAKS_FILE not found — skipping infrastructure pattern check."
else
    echo "Loading patterns from: $INFRA_LEAKS_FILE"
    echo ""

    while IFS= read -r pattern; do
        [[ -z "$pattern" || "$pattern" =~ ^[[:space:]]*# ]] && continue
        [[ "${#pattern}" -lt "$MIN_LEN" ]] && continue

        if [[ "$pattern" == ~* ]]; then
            regex="${pattern:1}"
            matches=$(grep -rn -E -- "$regex" "${SCAN_FILES[@]}" 2>/dev/null || true)
            label="~${regex}"
        else
            matches=$(grep -rn --fixed-strings -- "$pattern" "${SCAN_FILES[@]}" 2>/dev/null || true)
            label="$pattern"
        fi

        if [[ -n "$matches" ]]; then
            echo -e "${RED}LEAK${NC}: \"$label\""
            echo "$matches" | while IFS= read -r match; do
                rel="${match/$REPO_DIR\//}"
                echo "       $rel"
            done
            echo ""
            LEAKS=$((LEAKS + 1))
        fi
    done < "$INFRA_LEAKS_FILE"
fi

echo ""
echo "=== Checking .nodes.json values ==="

NODES_JSON=""
if [[ -f "$ENV_FILE" ]]; then
    NODES_JSON="$(grep -E '^NODES_JSON_PATH=' "$ENV_FILE" 2>/dev/null | head -1 | sed 's/^NODES_JSON_PATH=//' | tr -d '"' | tr -d "'" || true)"
fi
: "${NODES_JSON:=$SOURCE_ROOT/.nodes.json}"

if [[ ! -f "$NODES_JSON" ]]; then
    echo -e "${YELLOW}Warning:${NC} $NODES_JSON not found — skipping .nodes.json value check."
else
    echo "Loading values from: $NODES_JSON"
    echo ""

    mapfile -t JSON_VALUES < <(python3 - "$NODES_JSON" <<'PYEOF'
import json, sys
data = json.load(open(sys.argv[1]))
seen = set()
for n in data.get("nodes", []):
    for field in ("primary_ip", "primary_hostname", "tailnet_ip", "tailnet_hostname"):
        v = n.get(field, "").strip()
        if v and v not in seen:
            seen.add(v)
            print(v)
PYEOF
    )

    for jval in "${JSON_VALUES[@]}"; do
        [[ "${#jval}" -lt "$MIN_LEN" ]] && continue
        matches=$(grep -rn --fixed-strings -- "$jval" "${SCAN_FILES[@]}" 2>/dev/null || true)
        if [[ -n "$matches" ]]; then
            echo -e "${RED}LEAK${NC}: .nodes.json value \"$jval\""
            echo "$matches" | while IFS= read -r match; do
                rel="${match/$REPO_DIR\//}"
                echo "       $rel"
            done
            echo ""
            LEAKS=$((LEAKS + 1))
        fi
    done
fi

echo "---"
if [[ "$LEAKS" -gt 0 ]]; then
    echo -e "${RED}${LEAKS} leak(s) found.${NC} Review the files above before pushing."
    exit 1
else
    echo -e "${GREEN}No leaks found.${NC}"
    if [[ "$SKIPPED" -gt 0 ]]; then
        echo -e "${YELLOW}Note:${NC} $SKIPPED value(s) skipped (shorter than ${MIN_LEN} chars — increase MIN_LEN if needed)."
    fi
    exit 0
fi