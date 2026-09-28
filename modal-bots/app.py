"""Generic Modal entrypoint for running a named bot."""

import os
from typing import Any

from bots import get_bot_invocation
from common.deployment import (
    BOT_TIMEOUT_SECONDS,
    app,
    bot_config,
    bot_image,
)


@app.function(image=bot_image, secrets=[bot_config], timeout=BOT_TIMEOUT_SECONDS)
async def run_bot(
    bot: str,
    room: str,
    seconds: float = 30,
) -> dict[str, Any]:
    """Run a named bot in a given room for a given duration. It plays as ``<bot>-bot``."""
    return await get_bot_invocation(bot)(
        room=room,
        name=f"{bot}-bot",
        seconds=seconds,
        lobby_url=os.environ["WORLD_LOBBY_URL"],
    )
