"""Shared Modal resources for bot functions."""

from __future__ import annotations

import os
from pathlib import Path

import modal  # type: ignore[import-not-found]

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LOBBY_URL = os.environ.get("WORLD_LOBBY_URL", "")
BOT_TIMEOUT_SECONDS = 3600
MAX_BOT_SECONDS = 3500

app = modal.App("kathir-world-bots")

bot_image = (
    modal.Image.debian_slim(python_version="3.12")
    .workdir("/app")
    .uv_pip_install("httpx", "websockets")
    .add_local_dir(ROOT / "common", "/app/common", copy=True)
    .add_local_dir(ROOT / "bots", "/app/bots", copy=True)
)


def validate_duration(seconds: float) -> None:
    if not 0 < seconds <= MAX_BOT_SECONDS:
        raise ValueError(f"seconds must be between 0 and {MAX_BOT_SECONDS}")
