#!/usr/bin/env bash
# Native aarch64 eval launcher for DGX Spark.
# Official Linux releases are x64-only. This runs the Electron app from source
# against the already-installed local ComfyUI on :8188.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export DISPLAY="${DISPLAY:-:1}"
export ELECTRON_DISABLE_SANDBOX=1
# Prefer the Spark's aarch64 ffmpeg over GitHub ffmpeg-static assets.
export FFMPEG_BIN="${FFMPEG_BIN:-/home/codex450/.local/bin/ffmpeg}"
export FFPROBE_BIN="${FFPROBE_BIN:-/home/codex450/.local/bin/ffprobe}"

if [[ ! -x node_modules/electron/dist/electron ]]; then
  echo "Electron ARM64 binary missing under node_modules/electron/dist" >&2
  exit 1
fi

exec npm run electron:dev -- --no-sandbox
