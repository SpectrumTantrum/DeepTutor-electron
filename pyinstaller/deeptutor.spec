# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the DeepTutor backend sidecar.

One-folder bundle (~1 s cold start vs ~5 s for one-file). Routers are
imported dynamically by ``deeptutor.api.main`` so each one is enumerated
in ``hiddenimports`` to keep PyInstaller happy.

Build with:
    pyinstaller --noconfirm pyinstaller/deeptutor.spec
"""

from __future__ import annotations

import os

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

ROUTERS = (
    "agent_config",
    "attachments",
    "book",
    "chat",
    "co_writer",
    "dashboard",
    "knowledge",
    "memory",
    "notebook",
    "plugins_api",
    "question",
    "question_notebook",
    "sessions",
    "settings",
    "skills",
    "solve",
    "system",
    "tutorbot",
    "unified_ws",
    "vision_solver",
    "outputs",
)

hiddenimports = []

# uvicorn protocol modules -- not statically discoverable
hiddenimports += [
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
]

# WebSocket libs
hiddenimports += [
    "websockets.legacy",
    "websockets.legacy.server",
    "wsproto",
    "h11",
    "httptools",
]

# DeepTutor routers (imported dynamically by deeptutor.api.main)
hiddenimports += [f"deeptutor.api.routers.{r}" for r in ROUTERS]

# LlamaIndex core + plugins actually used
hiddenimports += collect_submodules("llama_index.core")
hiddenimports += collect_submodules("llama_index.embeddings")
hiddenimports += collect_submodules("llama_index.llms")

# tiktoken encodings
hiddenimports += [
    "tiktoken",
    "tiktoken_ext",
    "tiktoken_ext.openai_public",
]

# PyMuPDF
hiddenimports += ["fitz"]

# pydantic v2 internals
hiddenimports += collect_submodules("pydantic")

datas = []
datas += collect_data_files("deeptutor")
datas += collect_data_files("llama_index")
datas += collect_data_files("tiktoken_ext")

# Bundle DeepTutor's runtime registry / config dirs explicitly so they
# survive PyInstaller's pruning.
project_root = os.path.abspath(os.path.dirname(SPECPATH))
for src, dest in (
    ("deeptutor/runtime/registry/manifests", "deeptutor/runtime/registry/manifests"),
    ("deeptutor/configs", "deeptutor/configs"),
):
    abs_src = os.path.join(project_root, src)
    if os.path.isdir(abs_src):
        datas.append((abs_src, dest))

excludes = [
    "manim",
    "matplotlib.tests",
    "tests",
    "pytest",
    "telegram",
    "matrix_client",
    "slack_sdk",
]

a = Analysis(
    ["pyinstaller/sidecar_entry.py"],
    pathex=[project_root],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="deeptutor-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="py-sidecar",
)
