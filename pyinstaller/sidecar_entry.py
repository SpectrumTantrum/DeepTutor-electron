"""PyInstaller-safe entrypoint for the DeepTutor backend sidecar.

Differences from ``deeptutor/api/run_server.py`` (which is kept for Docker/CLI):

- No ``os.chdir`` -- incompatible with PyInstaller's ``_MEIPASS`` model.
- Binds ``127.0.0.1`` (not ``0.0.0.0``) for App Sandbox compliance.
- ``reload=False`` -- uvicorn reload forks subprocesses and breaks bundles.
- ``BACKEND_PORT`` and ``DEEPTUTOR_DATA_DIR`` are read from env vars only.
"""

from __future__ import annotations

import asyncio
import os
import sys


def _ensure_event_loop_policy() -> None:
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())


def _resolve_port() -> int:
    raw = os.environ.get("BACKEND_PORT", "").strip()
    if not raw:
        raise SystemExit(
            "BACKEND_PORT env var is required when running the bundled sidecar."
        )
    try:
        port = int(raw)
    except ValueError as exc:
        raise SystemExit(f"BACKEND_PORT is not a valid integer: {raw!r}") from exc
    if not (1 <= port <= 65_535):
        raise SystemExit(f"BACKEND_PORT out of range: {port}")
    return port


def _ensure_data_dir() -> str:
    data_dir = os.environ.get("DEEPTUTOR_DATA_DIR", "").strip()
    if not data_dir:
        raise SystemExit(
            "DEEPTUTOR_DATA_DIR env var is required when running the bundled sidecar."
        )
    os.makedirs(data_dir, exist_ok=True)
    return data_dir


def main() -> None:
    _ensure_event_loop_policy()

    os.environ["PYTHONUNBUFFERED"] = "1"
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True, errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(line_buffering=True, errors="replace")

    port = _resolve_port()
    _ensure_data_dir()

    # Import uvicorn AFTER the env vars above are set so PathService -- a
    # singleton initialised on first import -- sees DEEPTUTOR_DATA_DIR.
    import uvicorn

    from deeptutor.logging import configure_logging
    from deeptutor.runtime.mode import RunMode, set_mode

    set_mode(RunMode.SERVER)
    configure_logging()

    uvicorn.run(
        "deeptutor.api.main:app",
        host="127.0.0.1",
        port=port,
        reload=False,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    main()
