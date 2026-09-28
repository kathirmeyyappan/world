"""Orbit the nearest player, or the world origin when alone."""

from __future__ import annotations

import asyncio
import math
import time
from contextlib import suppress
from typing import Any

from common import (
    Controls,
    Event,
    Player,
    RoomConnectionError,
    Vec3,
    WorldState,
    connect,
    log_death,
    log_message,
    run_input_loop,
)
from common.deployment import validate_duration

ORBIT_RADIUS = 6
RADIAL_CORRECTION_DISTANCE = 3


async def run_circle_bot(
    room: str,
    name: str = "circle",
    seconds: float = 30,
    *,
    lobby_url: str | None = None,
    direct_ws_url: str | None = None,
) -> dict[str, Any]:
    validate_duration(seconds)
    connect_started = time.monotonic()
    connection = await connect(
        lobby_url,
        room,
        name,
        direct_url=direct_ws_url,
    )
    connected_at = time.monotonic()
    state = WorldState(connection.welcome, connection.room)
    controls = Controls(connection)
    stop = asyncio.Event()
    inputs = asyncio.create_task(run_input_loop(controls, stop))
    completed = False
    target_key: str | None = None
    observed_until = connected_at

    log_message(name, "joined room", player_id=connection.id, room=connection.room)

    try:
        async with asyncio.timeout(seconds):
            while True:
                message = await connection.receive()
                state.apply(message)
                if state.me is None:
                    break
                if state.me.dead:
                    if isinstance(message, Event) and message.t == "kill":
                        log_death(
                            name,
                            _player_name(state, message.data["shooter"]),
                            item=message.data["item"],
                            headshot=message.data["headshot"],
                        )
                    else:
                        log_death(name)
                    break

                target = _steer(state, controls)
                next_target = target.id if target else "origin"
                if next_target != target_key:
                    target_key = next_target
                    log_message(name, "orbit target changed", target=target_key)
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
    log_message(
        name,
        "finished",
        completed=completed,
        observed_seconds=round(observed_seconds, 3),
        target=target_key,
    )
    return {
        "bot": name,
        "completed": completed,
        "observed_seconds": round(observed_seconds, 6),
        "connection_seconds": round(connected_at - connect_started, 6),
        "target": target_key,
        "last_tick": state.tick,
        "final_state": state.to_dict(),
    }


def _steer(state: WorldState, controls: Controls) -> Player | None:
    me = state.me
    if me is None:
        return None

    target = _nearest_player(state)
    center = target.pos if target else Vec3(0, me.pos.y, 0)
    controls.look_at(me.pos, center)

    distance = math.hypot(me.pos.x - center.x, me.pos.z - center.z)
    radial = max(
        -1.0,
        min(1.0, (distance - ORBIT_RADIUS) / RADIAL_CORRECTION_DISTANCE),
    )
    controls.move(forward=radial, right=1)
    return target


def _nearest_player(state: WorldState) -> Player | None:
    me = state.me
    if me is None:
        return None
    candidates = (
        player
        for player in state.players.values()
        if player.id != me.id and not player.dead
    )
    return min(
        candidates,
        key=lambda player: math.hypot(
            player.pos.x - me.pos.x,
            player.pos.z - me.pos.z,
        ),
        default=None,
    )


def _player_name(state: WorldState, player_id: str) -> str:
    player = state.players.get(player_id)
    return player.name if player else player_id
