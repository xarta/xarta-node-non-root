#!/usr/bin/env bash
set -euo pipefail

ROOT="/xarta-node"
TOOLING_RUN="$ROOT/.lone-wolf/stacks/tooling-runtime/.claude/skills/dockge-stack-tooling-runtime/scripts/run.sh"
HOST_TRANSCRIPTS="${WAKE_WAVE_TRANSCRIPT_DIR:-$ROOT/.lone-wolf/state/wake-to-talk-wave-e2e/transcripts}"
CONTAINER_TRANSCRIPTS="${WAKE_WAVE_CONTAINER_TRANSCRIPT_DIR:-/workspace/.lone-wolf/state/wake-to-talk-wave-e2e/transcripts}"

/opt/blueprints/venv/bin/python "$ROOT/gui-fallback/tests/wake_to_talk_wave_stt_capture.py" "$@"
bash "$TOOLING_RUN" env WAKE_WAVE_TRANSCRIPT_DIR="$CONTAINER_TRANSCRIPTS" node /workspace/gui-fallback/tests/wake-to-talk-wave-e2e.test.cjs

echo "wake-to-talk WAV E2E suite passed using transcripts in $HOST_TRANSCRIPTS"
