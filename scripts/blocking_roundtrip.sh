#!/usr/bin/env bash
# Blocking v7 Phase 4 — headless CI round-trip (docs/blocking-v7-plan.md §4.6).
#
#   tests/fixtures/blocking_roundtrip.json
#     → Blender bridge render_apply.py (green/pose/depth + --export-samples)
#     → assert G5 frame-lock, export.samples sanity, camera round-trip
#       (position 1 mm, angles 0.5°, per the bridge's documented tolerances)
#
# Headless-safe (blender -b, no X server). Skips with exit 0 when blender or
# the bridge is absent so app CI without Blender doesn't hard-fail.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRIDGE="${VELORN_BLENDER_BRIDGE:-/home/codex450/creative/_library/blender-bridge}"
BLENDER="${BLENDER:-$(command -v blender || true)}"

if [ -z "$BLENDER" ]; then
  echo "SKIP: blender not on PATH — blocking round-trip needs Blender 4.x headless"
  exit 0
fi
if [ ! -f "$BRIDGE/render_apply.py" ]; then
  echo "SKIP: blender bridge not found at $BRIDGE (set VELORN_BLENDER_BRIDGE)"
  exit 0
fi

# run_blender <logfile> <blender args...> — preserves the exit code past the grep filter.
run_blender() {
  local log="$1"; shift
  set +e
  "$BLENDER" "$@" > "$log" 2>&1
  local code=$?
  set -e
  grep -E "WROTE|CREATED|CAMERA|RENDERED|EXPORTED|SAVED|DONE|ROUNDTRIP|Error|Traceback" "$log" || true
  return $code
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$ROOT/tests/fixtures/blocking_roundtrip.json" "$TMP/blocking.json"
cp "$ROOT/tests/fixtures/ref_front_stud.png" "$TMP/"

echo "=== 1. base blend ==="
run_blender "$TMP/gen.log" -b --python "$ROOT/scripts/blocking_roundtrip_gen_blend.py" -- "$TMP/base.blend"

echo "=== 2. bridge render_apply (green/pose/depth + export-samples) ==="
# cwd=$TMP so the fixture's relative ref_set.front resolves; the bridge
# writes export.samples back into blocking.json.
(cd "$TMP" && run_blender "$TMP/apply.log" -b base.blend --python "$BRIDGE/render_apply.py" -- \
  --blocking blocking.json --shot rt01 --out control \
  --qa --export-samples --start 1 --end 9 --save-blend applied.blend) || {
    echo "FAIL: render_apply exited non-zero (see $TMP/apply.log on failure path)"; exit 1; }

echo "=== 3. camera round-trip (inside Blender, bridge tolerances) ==="
run_blender "$TMP/cam.log" -b "$TMP/applied.blend" \
  --python "$ROOT/scripts/blocking_roundtrip_verify_blend.py" -- \
  --blocking "$TMP/blocking.json" --bridge "$BRIDGE" || {
    echo "FAIL: camera round-trip outside tolerance"; exit 1; }

echo "=== 4. host assertions (G5 + export.samples + gate table) ==="
node "$ROOT/scripts/blocking_roundtrip_verify.mjs" "$TMP"

echo "=== BLOCKING ROUNDTRIP PASS ==="
