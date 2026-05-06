#!/usr/bin/env bash
# End-to-end packaging script: build the Python sidecar, build the web
# sidecar, then run electron-builder to produce a signed+notarized
# universal2 DMG.
#
# Required env (set by your shell or CI for signing+notarization to succeed):
#   APPLE_ID                    -- developer Apple ID
#   APPLE_APP_SPECIFIC_PASSWORD -- app-specific password from appleid.apple.com
#   APPLE_TEAM_ID               -- 10-char Team ID from developer.apple.com/account
#   CSC_LINK / CSC_KEY_PASSWORD -- developer ID certificate (for code signing)
#
# Without those, run with --unsigned for a local-only unsigned .app bundle
# that you can `xattr -cr` and run manually.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

UNSIGNED=0
if [[ "${1:-}" == "--unsigned" ]]; then
  UNSIGNED=1
fi

echo "=== Phase 1: Python sidecar (universal2) ==="
bash "${ROOT}/scripts/build-py-sidecar.sh"

echo "=== Phase 2: Web sidecar (Next.js standalone) ==="
bash "${ROOT}/scripts/build-web-sidecar.sh"

echo "=== Phase 3: Electron compile + package ==="
cd "${ROOT}/electron"

if [[ ! -d node_modules ]]; then
  npm ci --no-audit --no-fund
fi

if [[ "${UNSIGNED}" -eq 1 ]]; then
  echo ">>> Building unsigned bundle (development only)"
  npm run package:unsigned
else
  if [[ -z "${APPLE_ID:-}" || -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" || -z "${APPLE_TEAM_ID:-}" ]]; then
    echo "ERROR: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID are required for signed builds." >&2
    echo "       Run with --unsigned for a local development build." >&2
    exit 1
  fi
  npm run package
fi

echo "=== Done ==="
ls -lh "${ROOT}/electron/build/"
