#!/usr/bin/env bash
# Systemd-friendly Velorn launch. Do not pass extra flags through npm —
# concurrently would swallow --no-sandbox. ELECTRON_DISABLE_SANDBOX is enough.
set -euo pipefail
ROOT=/home/codex450/opensource/velorn
export DISPLAY="${DISPLAY:-:1}"
export ELECTRON_DISABLE_SANDBOX=1
export FFMPEG_BIN="${FFMPEG_BIN:-/home/codex450/.local/bin/ffmpeg}"
export FFPROBE_BIN="${FFPROBE_BIN:-/home/codex450/.local/bin/ffprobe}"
export LIGHTPANDA_DISABLE_TELEMETRY=true

if [[ ! -x "$ROOT/node_modules/electron/dist/electron" ]]; then
  echo "Velorn Electron binary is missing. Rebuild from $ROOT" >&2
  exit 1
fi

cd "$ROOT"
exec npm run electron:dev
