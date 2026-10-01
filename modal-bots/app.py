"""The bots app's Modal workers, one per kind of bot (see ``bots/__init__.py``).

Both share the image, Secret, timeout and packing: bots are async and cheap, so a container runs
many on one event loop. The room's sidecar spawns them by name (``infra/config.py``); by hand,
``modal run modal-bots/app.py --bot circle --room <room> --seconds 60`` picks the bot's worker
(``--targets kat,bob`` for a combat bot).
"""

import os
from typing import Any

import modal
from bots import COMBAT_BOTS, get_combat_bot, get_dumb_bot
from common import Vec3, load_world_map
from common.deployment import (
    BOT_TIMEOUT_SECONDS,
    MAX_BOT_CONTAINERS,
    MAX_BOTS_PER_CONTAINER,
    TARGET_BOTS_PER_CONTAINER,
    app,
    bot_config,
    bot_image,
)

worker = app.function(
    image=bot_image,
    secrets=[bot_config],
    timeout=BOT_TIMEOUT_SECONDS,
    max_containers=MAX_BOT_CONTAINERS,
)
packed = modal.concurrent(max_inputs=MAX_BOTS_PER_CONTAINER, target_inputs=TARGET_BOTS_PER_CONTAINER)


@worker
@packed
async def run_dumb_bot(
    bot: str,
    room: str,
    seconds: float = 300,
    spawn: dict[str, float] | None = None,
    avatar: str | None = None,
) -> dict[str, Any]:
    """Run a named dumb bot in a room for a while. It plays as ``<bot>-bot``, standing at ``spawn``
    ({x, y, z}, feet) and wearing ``avatar`` when given (the room's BotPlacement)."""
    return await get_dumb_bot(bot)(
        room=room,
        name=f"{bot}-bot",
        seconds=seconds,
        lobby_url=os.environ["WORLD_LOBBY_URL"],
        spawn=_vec(spawn),
        avatar=avatar,
    )


@worker
@packed
async def run_combat_bot(
    bot: str,
    room: str,
    seconds: float = 300,
    targets: list[str] | None = None,
    spawn: dict[str, float] | None = None,
    avatar: str | None = None,
) -> dict[str, Any]:
    """As ``run_dumb_bot``, for a combat bot: it gets the world map, and goes after players whose
    names contain any of ``targets`` (any case), or every person when there are none."""
    return await get_combat_bot(bot)(
        room=room,
        name=f"{bot}-bot",
        seconds=seconds,
        world=load_world_map(),
        targets=tuple(targets or ()),
        lobby_url=os.environ["WORLD_LOBBY_URL"],
        spawn=_vec(spawn),
        avatar=avatar,
    )


def _vec(spawn: dict[str, float] | None) -> Vec3 | None:
    return Vec3(spawn["x"], spawn["y"], spawn["z"]) if spawn else None


@app.local_entrypoint()
def main(bot: str, room: str, seconds: float = 30, targets: str = "") -> None:
    """Run one bot by hand on its worker, with ``targets`` as comma-separated names. The workers
    take placement as a dict, which ``modal run`` can't parse, so this is the command line."""
    if bot in COMBAT_BOTS:
        names = [name for name in targets.split(",") if name]
        report = run_combat_bot.remote(bot=bot, room=room, seconds=seconds, targets=names)
    else:
        report = run_dumb_bot.remote(bot=bot, room=room, seconds=seconds)
    print(report)
