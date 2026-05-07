# DeepTutor Electron Desktop App

A signed, notarized macOS universal2 DMG that bundles the existing FastAPI backend (PyInstaller sidecar) and the Next.js standalone server (spawned via Electron's bundled Node) into a double-clickable app.

The renderer is the unmodified `web/` Next.js app talking to the Python backend over the existing REST + `/api/v1/ws` WebSocket interface on dynamically-allocated `127.0.0.1` ports — no source forks of `web/` or `deeptutor/`.

## Prerequisites

- **macOS 12+** (Apple Silicon recommended; Intel works under the universal2 build)
- **Node 22+** — `node -v` should report `v22.x`
- **Python 3.11+** — `python3.11 --version`. Install via `brew install python@3.11` or python.org's universal2 installer. Required for the PyInstaller build; the running app does not need a system Python.
- **Xcode Command Line Tools** — `xcode-select --install`
- **Apple Developer ID certificate** (only for signed/notarized release builds) — see [Signed builds](#signed-builds) below

## Development workflow

The fastest inner loop runs the three components in three terminals:

```bash
# Terminal 1 — Python backend (uses your local Python 3.11+ venv)
python -m deeptutor.api.run_server

# Terminal 2 — Next.js frontend
cd web && npm run dev

# Terminal 3 — Electron shell pointing at the Next.js dev server
cd electron && npm install   # first time only
cd electron && npm run dev
```

`npm run dev` defaults to `DEEPTUTOR_DEV_FRONTEND_URL=http://localhost:3782`. Override that env var to point at a different frontend host.

When iterating on the Electron main-process TypeScript, `cd electron && npm run watch` keeps `tsc` in `--watch` mode while you `npm run dev` in another terminal.

## Local packaged build (unsigned)

For a double-clickable `.app` you can `xattr -cr` and run on your own Mac:

```bash
bash scripts/package-electron.sh --unsigned
xattr -cr electron/build/mac-universal/DeepTutor.app
open electron/build/mac-universal/DeepTutor.app
```

This pipeline runs three phases:

1. `scripts/build-py-sidecar.sh` — PyInstaller arm64 + x86_64 + `lipo` merge → `dist/py-sidecar/deeptutor-server` (universal2)
2. `scripts/build-web-sidecar.sh` — `cd web && npm run build` → `web/.next/standalone/server.js`
3. `cd electron && electron-builder --mac --universal -c.mac.identity=null` → `electron/build/`

Expect ~30–60 min for the first PyInstaller run; subsequent runs are faster.

## Signed builds

For a release `.dmg` with hardened runtime + notarization, set:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCD1234EF"
# plus a Developer ID Application cert in Keychain, or CSC_LINK / CSC_KEY_PASSWORD
bash scripts/package-electron.sh
```

The DMG appears at `electron/build/DeepTutor-<version>-universal.dmg` along with `latest-mac.yml` for `electron-updater`.

Generate `APPLE_APP_SPECIFIC_PASSWORD` at <https://appleid.apple.com>. The Team ID is the 10-character ID at <https://developer.apple.com/account>.

## Logs and data

Runtime data lives under standard macOS paths so users can inspect or back up state:

| Path | Contents |
|---|---|
| `~/Library/Application Support/DeepTutor/deeptutor-data/` | Sidecar's `data/user/` tree (chat history, knowledge bases, settings) |
| `~/Library/Application Support/DeepTutor/settings.json` | Non-secret settings (LLM binding/model/host, etc.) |
| `~/Library/Application Support/DeepTutor/secrets.bin` | safeStorage-encrypted API keys (Keychain-backed) |
| `~/Library/Application Support/DeepTutor/window-state.json` | Restored window bounds |
| `~/Library/Logs/DeepTutor/main.log` | Electron main-process logs (NDJSON via pino, daily-rotated, 7-day retention) |
| `~/Library/Logs/DeepTutor/python.log` | Python sidecar stdout/stderr |
| `~/Library/Logs/DeepTutor/web.log` | Next.js sidecar stdout/stderr |

The app menu's **Help → Show Logs** opens that directory in Finder.

## Architecture overview

```
Electron main process (TypeScript)
├── SidecarManager
│   ├── Python sidecar  (PyInstaller bundle, uvicorn → 127.0.0.1:$BACKEND_PORT)
│   └── Node   sidecar  (server.js via process.execPath, 127.0.0.1:$FRONTEND_PORT)
├── Settings (safeStorage for secrets, JSON for non-secrets)
├── Native menu, window-state, file associations, drag-drop
└── BrowserWindow → loadURL("http://127.0.0.1:$FRONTEND_PORT")
```

Both sidecars bind `127.0.0.1` only (App Sandbox compliance, no firewall prompts). Ports are allocated dynamically per launch — the `BACKEND_PORT`/`FRONTEND_PORT` env vars are ignored in Electron mode.

The two preloads serve different windows on purpose:

- `dist/main-preload.js` — chat window. Exposes settings + drag-drop, **not** `restartSidecar`.
- `dist/preload.js` — settings window. Wider surface including `restartSidecar`.

## Troubleshooting

- **Splash stuck on "Starting backend"** — check `~/Library/Logs/DeepTutor/python.log`. Most common cause: missing `LLM_API_KEY` (open Settings ⌘, and enter it). Watchdog will surface a Retry/Show Logs/Quit panel after 60 seconds.
- **`scripts/build-py-sidecar.sh` errors with "python3.11 not found"** — `brew install python@3.11`, or `PYTHON_BIN=/path/to/python3.11 bash scripts/build-py-sidecar.sh`.
- **Notarization rejected** — pre-flight `codesign --verify --deep --strict --verbose=4 electron/build/mac-universal/DeepTutor.app` and `spctl -a -vv electron/build/mac-universal/DeepTutor.app`. Check that all four hardened-runtime entitlements (`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`, `allow-dyld-environment-variables`) are present in both `electron/resources/entitlements.mac.plist` and `entitlements.mac.inherit.plist`.
