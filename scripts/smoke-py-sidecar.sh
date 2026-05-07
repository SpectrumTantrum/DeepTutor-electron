#!/usr/bin/env bash
# Smoke-test the PyInstaller sidecar bundle:
#   1. Boot the bundled deeptutor-server on an ephemeral port + temp data dir.
#   2. Poll /api/v1/system/runtime-topology until 200 (or fail after 30 s).
#   3. Catches "ModuleNotFoundError" hidden-import gaps before users hit them.
#   4. Tear the server down and clean up.
#
# Run after scripts/build-py-sidecar.sh on the build host.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${ROOT}/dist/py-sidecar/deeptutor-server"

if [[ ! -x "${BIN}" ]]; then
  echo "ERROR: ${BIN} not found or not executable. Run scripts/build-py-sidecar.sh first." >&2
  exit 1
fi

# Pick an ephemeral free port. Small TOCTOU window between bind/release and
# the sidecar's bind is acceptable for a smoke test.
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
DATA_DIR="$(mktemp -d -t deeptutor-smoke-XXXXXX)"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo ">>> Stopping sidecar (pid=${SERVER_PID})"
    kill -TERM "${SERVER_PID}" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "${SERVER_PID}" 2>/dev/null || break
      sleep 1
    done
    kill -KILL "${SERVER_PID}" 2>/dev/null || true
  fi
  rm -rf "${DATA_DIR}"
}
trap cleanup EXIT INT TERM

echo ">>> Launching ${BIN} on 127.0.0.1:${PORT} (data=${DATA_DIR})"
BACKEND_PORT="${PORT}" DEEPTUTOR_DATA_DIR="${DATA_DIR}" "${BIN}" >"${DATA_DIR}/stdout.log" 2>&1 &
SERVER_PID=$!

URL="http://127.0.0.1:${PORT}/api/v1/system/runtime-topology"
DEADLINE=$((SECONDS + 30))
while (( SECONDS < DEADLINE )); do
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "ERROR: sidecar exited prematurely. Last log lines:" >&2
    tail -50 "${DATA_DIR}/stdout.log" >&2 || true
    exit 1
  fi
  if curl --silent --fail --max-time 2 "${URL}" >/dev/null 2>&1; then
    elapsed=$((30 - (DEADLINE - SECONDS)))
    echo ">>> Smoke PASS — ${URL} returned 200 within ${elapsed}s"
    exit 0
  fi
  sleep 0.5
done

echo "ERROR: sidecar did not become ready within 30s. Last log lines:" >&2
tail -100 "${DATA_DIR}/stdout.log" >&2 || true
exit 1
