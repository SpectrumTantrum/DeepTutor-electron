#!/usr/bin/env bash
# Build the universal2 PyInstaller sidecar for the DeepTutor Electron app.
#
# Strategy:
#   1. Build arm64 in a clean venv with arm64 wheels.
#   2. Build x86_64 in a clean venv (under Rosetta) with x86_64 wheels.
#   3. lipo-merge the two binaries into dist/py-sidecar/deeptutor-server.
#
# Cross-compilation via --target-arch=universal2 is unreliable because
# PyMuPDF and several llama-index transitive deps lack universal2 wheels.
# Two-build + lipo is the boring, reliable path.
#
# Run on an Apple Silicon Mac with Python 3.11 installed.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${ROOT}/dist/py-sidecar"
BUILD_ARM64="${ROOT}/build/py-arm64"
BUILD_X64="${ROOT}/build/py-x64"

# DeepTutor's pyproject.toml requires Python >=3.11. macOS ships 3.9 at
# /usr/bin/python3, so we cannot use that. Resolve an explicit 3.11 binary
# (overridable via PYTHON_BIN) and fail fast with an install hint if it's
# not available on the build host.
PYTHON_BIN="${PYTHON_BIN:-python3.11}"
if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  cat >&2 <<EOF
ERROR: ${PYTHON_BIN} not found on PATH.

DeepTutor requires Python >= 3.11. Install it via:
  brew install python@3.11
or download the universal2 installer from python.org. Then either ensure
python3.11 is on PATH, or re-run with:
  PYTHON_BIN=/path/to/python3.11 bash scripts/build-py-sidecar.sh
EOF
  exit 1
fi

PYTHON_BIN_ABS="$(command -v "${PYTHON_BIN}")"
echo ">>> Using Python: ${PYTHON_BIN_ABS} ($(${PYTHON_BIN_ABS} --version))"

# build_arch builds the PyInstaller bundle for a given architecture into
# the specified output directory using the provided virtual environment path.
build_arch() {
  local arch="$1"
  local venv_dir="$2"
  local out_dir="$3"

  echo ">>> Building py-sidecar for ${arch}..."
  rm -rf "${venv_dir}" "${out_dir}"
  mkdir -p "${out_dir}"

  if [[ "${arch}" == "x86_64" ]]; then
    arch -x86_64 "${PYTHON_BIN_ABS}" -m venv "${venv_dir}"
    # shellcheck disable=SC1091
    source "${venv_dir}/bin/activate"
    arch -x86_64 pip install --upgrade pip
    arch -x86_64 pip install -e ".[server]" pyinstaller==6.10.0
    arch -x86_64 pyinstaller \
      --noconfirm \
      --distpath "${out_dir}" \
      --workpath "${ROOT}/build/py-${arch}-work" \
      --clean \
      "${ROOT}/pyinstaller/deeptutor.spec"
  else
    "${PYTHON_BIN_ABS}" -m venv "${venv_dir}"
    # shellcheck disable=SC1091
    source "${venv_dir}/bin/activate"
    pip install --upgrade pip
    pip install -e ".[server]" pyinstaller==6.10.0
    pyinstaller \
      --noconfirm \
      --distpath "${out_dir}" \
      --workpath "${ROOT}/build/py-${arch}-work" \
      --clean \
      "${ROOT}/pyinstaller/deeptutor.spec"
  fi
  deactivate
}

cd "${ROOT}"

build_arch arm64  "${BUILD_ARM64}"  "${ROOT}/dist/py-arm64"
build_arch x86_64 "${BUILD_X64}"    "${ROOT}/dist/py-x64"

echo ">>> Merging arm64 + x86_64 with lipo..."
rm -rf "${DIST}"
mkdir -p "${DIST}"

# Copy the arm64 bundle as the canonical layout, then replace mach-o files
# (binaries and dylibs) with universal2 versions produced by lipo.
cp -R "${ROOT}/dist/py-arm64/py-sidecar/." "${DIST}/"

while IFS= read -r -d '' file; do
  rel="${file#${ROOT}/dist/py-arm64/py-sidecar/}"
  x64_counterpart="${ROOT}/dist/py-x64/py-sidecar/${rel}"
  if [[ -f "${x64_counterpart}" ]] && file "${file}" | grep -q "Mach-O"; then
    lipo -create "${file}" "${x64_counterpart}" -output "${DIST}/${rel}"
  fi
done < <(find "${ROOT}/dist/py-arm64/py-sidecar" -type f -print0)

echo ">>> Verifying universal2 layout..."
archs="$(lipo -archs "${DIST}/deeptutor-server" 2>/dev/null || true)"
if ! echo "${archs}" | grep -q "arm64" || ! echo "${archs}" | grep -q "x86_64"; then
  echo "ERROR: ${DIST}/deeptutor-server is not universal2. lipo reported: '${archs}'" >&2
  exit 1
fi

echo ">>> py-sidecar ready at ${DIST}"
ls -lh "${DIST}/deeptutor-server"
file "${DIST}/deeptutor-server"
echo ">>> archs: ${archs}"
