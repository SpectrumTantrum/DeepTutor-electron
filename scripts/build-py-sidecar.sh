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

build_arch() {
  local arch="$1"
  local venv_dir="$2"
  local out_dir="$3"

  echo ">>> Building py-sidecar for ${arch}..."
  rm -rf "${venv_dir}" "${out_dir}"
  mkdir -p "${out_dir}"

  if [[ "${arch}" == "x86_64" ]]; then
    arch -x86_64 /usr/bin/python3 -m venv "${venv_dir}"
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
    python3 -m venv "${venv_dir}"
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
    lipo -create "${file}" "${x64_counterpart}" -output "${DIST}/${rel}" || true
  fi
done < <(find "${ROOT}/dist/py-arm64/py-sidecar" -type f -print0)

echo ">>> py-sidecar ready at ${DIST}"
ls -lh "${DIST}/deeptutor-server"
file "${DIST}/deeptutor-server"
