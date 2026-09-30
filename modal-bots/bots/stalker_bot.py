"""Stand still and turn to face the nearest person (never another bot)."""

from __future__ import annotations

import asyncio
import time
from contextlib import suppress
from typing import Any

from common import (
    Controls,
    Event,
    RoomConnectionError,
    Vec3,
    WorldState,
    connect,
    log_death,
    log_message,
    run_input_loop,
)
from common.deployment import validate_duration


async def run_stalker_bot(
    room: str,
    name: str = "stalker-bot",
    seconds: float = 30,
    *,
    lobby_url: str | None = None,
    direct_ws_url: str | None = None,
    spawn: Vec3 | None = None,
    avatar: str | None = None,
) -> dict[str, Any]:
    validate_duration(seconds)
    connect_started = time.monotonic()
    connection = await connect(
        lobby_url,
        room,
        name,
        direct_url=direct_ws_url,
        spawn=spawn,
        avatar=avatar,
    )
    connected_at = time.monotonic()
    state = WorldState(connection.welcome, connection.room)
    controls = Controls(connection)
    stop = asyncio.Event()
    inputs = asyncio.create_task(run_input_loop(controls, stop))
    completed = False
    watching: str | None = None
    observed_until = connected_at

    log_message(name, "joined room", player_id=connection.id, room=connection.room)

    try:
        async with asyncio.timeout(seconds):
            while True:
                message = await connection.receive()
                state.apply(message)
                me = state.me
                if me is None:
                    break
                if me.dead:
                    # As circle_bot: stop sending input and lie there until the room drops the corpse.
                    stop.set()
                    if isinstance(message, Event) and message.t == "kill":
                        shooter = state.players.get(message.data["shooter"])
                        log_death(
                            name,
                            shooter.name if shooter else message.data["shooter"],
                            item=message.data["item"],
                            headshot=message.data["headshot"],
                        )
                    continue

                target = state.nearest_player(people_only=True)
                if target:
                    controls.look_at(me.pos, target.pos)
                if (target.id if target else None) != watching:
                    watching = target.id if target else None
                    log_message(name, "watching", target=watching)
    except TimeoutError:
        completed = True
    except RoomConnectionError:
        pass
    finally:
        observed_until = time.monotonic()
        stop.set()
        inputs.cancel()
        with suppress(asyncio.CancelledError, RoomConnectionError):
            await inputs
        if connection.close_code is None:
            await connection.close(reason=f"{name} complete")

    observed_seconds = observed_until - connected_at
    log_message(name, "finished", completed=completed, observed_seconds=round(observed_seconds, 3))
    return {
        "bot": name,
        "completed": completed,
        "observed_seconds": round(observed_seconds, 6),
        "connection_seconds": round(connected_at - connect_started, 6),
        "watching": watching,
        "last_tick": state.tick,
        "final_state": state.to_dict(),
    }
