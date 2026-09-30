"""Generic Modal entrypoint for running a named bot."""

import os
from typing import Any

import modal
from bots import get_bot_invocation
from common import Vec3
from common.deployment import (
    BOT_TIMEOUT_SECONDS,
    MAX_BOT_CONTAINERS,
    MAX_BOTS_PER_CONTAINER,
    TARGET_BOTS_PER_CONTAINER,
    app,
    bot_config,
    bot_image,
)


@app.function(
    image=bot_image,
    secrets=[bot_config],
    timeout=BOT_TIMEOUT_SECONDS,
    max_containers=MAX_BOT_CONTAINERS,
)
@modal.concurrent(max_inputs=MAX_BOTS_PER_CONTAINER, target_inputs=TARGET_BOTS_PER_CONTAINER)
async def run_bot(
    bot: str,
    room: str,
    seconds: float = 300,
    spawn: dict[str, float] | None = None,
    avatar: str | None = None,
) -> dict[str, Any]:
    """Run a named bot in a given room for a given duration. It plays as ``<bot>-bot``, standing
    at ``spawn`` ({x, y, z}, feet) and wearing ``avatar`` when given (the room's BotPlacement)."""
    return await get_bot_invocation(bot)(
        room=room,
        name=f"{bot}-bot",
        seconds=seconds,
        lobby_url=os.environ["WORLD_LOBBY_URL"],
        spawn=Vec3(spawn["x"], spawn["y"], spawn["z"]) if spawn else None,
        avatar=avatar,
    )
