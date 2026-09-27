"""Generic Modal entrypoint for spawning a named bot."""

from typing import Any

from bots import get_bot
from common.deployment import (
    BOT_TIMEOUT_SECONDS,
    DEFAULT_LOBBY_URL,
    app,
    bot_image,
)


@app.function(image=bot_image, timeout=BOT_TIMEOUT_SECONDS)
async def spawn_bot(
    bot: str,
    room: str,
    seconds: float = 30,
    lobby_url: str = DEFAULT_LOBBY_URL,
) -> dict[str, Any]:
    return await get_bot(bot)(
        room=room,
        name=bot,
        seconds=seconds,
        lobby_url=lobby_url,
    )
