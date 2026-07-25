#!/usr/bin/env bash
# Kiosk dev-preview (docs/plan.md T10-prep/T9b): launches desktop Chromium
# with the same --app/--window-size invocation as the Pi kiosk, minus
# --kiosk, for pixel-identical 480x320 layout/animation checks off-hardware.
#
# Usage: bun run dev:kiosk   (override with PORT= / KIOSK_URL=)
set -euo pipefail

PORT="${PORT:-8080}"
URL="${KIOSK_URL:-http://localhost:$PORT}"

for bin in google-chrome-stable google-chrome chromium chromium-browser; do
  if command -v "$bin" >/dev/null 2>&1; then
    exec "$bin" "--app=$URL" --window-size=480,320
  fi
done

echo "No Chromium binary found (tried google-chrome-stable, google-chrome, chromium, chromium-browser)." >&2
exit 1
