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
    """
    Set the asyncio event loop policy to WindowsProactorEventLoopPolicy when running on Windows.
    
    Does nothing on non-Windows platforms.
    """
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())


def _resolve_port() -> int:
    """
    Resolve BACKEND_PORT from the environment, validate it, and return it.
    
    Raises:
        SystemExit: If BACKEND_PORT is missing, cannot be parsed as an integer,
                    or is not within the range 1 through 65535.
    
    Returns:
        int: The validated port number (1 through 65535).
    """
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
    """
    Ensure the DEEPTUTOR_DATA_DIR environment variable is set and that the directory exists.
    
    Reads DEEPTUTOR_DATA_DIR from the environment, creates the directory if it does not exist, and returns the directory path.
    
    Returns:
        data_dir (str): The path from DEEPTUTOR_DATA_DIR.
    
    Raises:
        SystemExit: If DEEPTUTOR_DATA_DIR is not set or is empty.
    """
    data_dir = os.environ.get("DEEPTUTOR_DATA_DIR", "").strip()
    if not data_dir:
        raise SystemExit(
            "DEEPTUTOR_DATA_DIR env var is required when running the bundled sidecar."
        )
    os.makedirs(data_dir, exist_ok=True)
    return data_dir


def main() -> None:
    """
    Launch the DeepTutor backend sidecar using uvicorn after validating environment and configuring runtime.
    
    Performs environment-driven startup: ensures the appropriate asyncio event loop policy on Windows, sets PYTHONUNBUFFERED and line-buffering for standard streams when supported, validates and reads BACKEND_PORT and DEEPTUTOR_DATA_DIR, sets the runtime mode to SERVER, configures logging, and starts uvicorn serving "deeptutor.api.main:app" bound to 127.0.0.1 on the validated port with automatic reload disabled.
    """
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
