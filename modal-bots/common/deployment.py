"""Shared Modal resources for bot functions."""

from __future__ import annotations

from pathlib import Path

import modal  # type: ignore[import-not-found]

ROOT = Path(__file__).resolve().parent.parent
BOT_TIMEOUT_SECONDS = 3600
MAX_BOT_SECONDS = 3500

# Bots are async and cheap (a WebSocket plus 30 Hz JSON), so one container runs many on its event
# loop. The autoscaler adds a container past TARGET_BOTS_PER_CONTAINER; a container takes up to
# MAX_BOTS_PER_CONTAINER; MAX_BOT_CONTAINERS bounds the whole fleet whatever chat asks for.
TARGET_BOTS_PER_CONTAINER = 16
MAX_BOTS_PER_CONTAINER = 64
MAX_BOT_CONTAINERS = 10
BOT_CONTAINER_CPU = 1.0

app = modal.App("kathir-world-bots")
bot_config = modal.Secret.from_name("kathir-world-bots-config")

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
