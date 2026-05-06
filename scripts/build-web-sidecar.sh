#!/usr/bin/env bash
# Build the Next.js standalone bundle for the DeepTutor Electron app.
#
# The output (web/.next/standalone/server.js plus minimal node_modules) is
# spawned at runtime via Electron's bundled Node (process.execPath with
# ELECTRON_RUN_AS_NODE=1) -- no second Node.js binary is shipped.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT}/web"

# APP_VERSION is embedded as NEXT_PUBLIC_APP_VERSION via web/next.config.js.
# At package time we want the git tag; in dev "git describe" works directly.
if [[ -z "${APP_VERSION:-}" ]]; then
  APP_VERSION="$(git describe --tags --always --dirty=-dev 2>/dev/null || echo "dev")"
fi
export APP_VERSION

echo ">>> Building web sidecar (APP_VERSION=${APP_VERSION})..."

if [[ ! -d node_modules ]]; then
  npm ci --no-audit --no-fund
fi

npm run build

# Sanity-check expected outputs.
test -f .next/standalone/server.js || {
  echo "ERROR: .next/standalone/server.js not produced. Is output:'standalone' set in next.config.js?" >&2
  exit 1
}
test -d .next/static
test -d public

echo ">>> web sidecar ready at ${ROOT}/web/.next/standalone/"
ls -lh .next/standalone/server.js
