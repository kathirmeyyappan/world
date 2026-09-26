"""Shared Modal objects. Importing this module is side-effect free apart from declaring them."""

import modal

from .config import APP_NAME, REPO

app = modal.App(APP_NAME)

# Runs the Node room server, which also serves the client bundle (see lobby.py for why).
room_image = (
    modal.Image.from_registry("node:22-slim", add_python="3.12")
    .workdir("/app")
    .add_local_dir(
        REPO,
        "/app",
        copy=True,
        ignore=["node_modules", "dist", ".git", "docs", "infra", "e2e", "__pycache__", "*.local"],
    )
    .run_commands("npm ci", "npm run build")
)

lobby_image = modal.Image.debian_slim(python_version="3.12").uv_pip_install("fastapi[standard]>=0.115")

rooms = modal.Dict.from_name(f"{APP_NAME}-rooms", create_if_missing=True)
