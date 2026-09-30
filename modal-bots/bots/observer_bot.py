"""A bounded, non-controlling room observer."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from common import (
    Event,
    RoomConnectionError,
    Snapshot,
    Vec3,
    WorldState,
    connect,
    log_death,
    log_kill,
    log_message,
)
from common.deployment import validate_duration


async def run_observer_bot(
    room: str,
    name: str = "observer-bot",
    seconds: float = 30,
    *,
    lobby_url: str | None = None,
    direct_ws_url: str | None = None,
    spawn: Vec3 | None = None,
    avatar: str | None = None,
) -> dict[str, Any]:
    """Join visibly as a normal player and observe without gameplay input.

    Args:
        room: The room to observe.
        name: The name of the observer.
        seconds: The duration to observe the room for.
        lobby_url: The URL of the lobby to use.
        direct_ws_url: The URL of the direct WebSocket to use.
        spawn: Where to stand (feet position), or None for a random spawn.
        avatar: The skin to wear, or None for the default look.

    Report observed room state.
    """

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
    event_counts = {"welcome": 1}
    snapshots = 0
    completed = False
    close_code: int | None = None
    close_reason = ""
    observed_until = connected_at

    log_message(
        name,
        "joined room",
        player_id=connection.id,
        room=connection.room,
        transport=connection.transport,
    )

    deadline = connected_at + seconds
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                completed = True
                break
            try:
                message = await asyncio.wait_for(connection.receive(), timeout=remaining)
            except TimeoutError:
                completed = True
                break
            except RoomConnectionError:
                close_code = connection.close_code
                close_reason = connection.close_reason
                break

            event_counts[message.t] = event_counts.get(message.t, 0) + 1
            if isinstance(message, Snapshot):
                snapshots += 1
            elif isinstance(message, Event) and message.t == "kill":
                shooter = message.data["shooter"]
                victim = message.data["victim"]
                details = {
                    "item": message.data["item"],
                    "headshot": message.data["headshot"],
                }
                if shooter == connection.id:
                    log_kill(name, _player_name(state, victim), **details)
                if victim == connection.id:
                    log_death(name, _player_name(state, shooter), **details)
            state.apply(message)
    finally:
        observed_until = time.monotonic()
        if connection.close_code is None:
            await connection.close(reason="observer complete")
        close_code = close_code if close_code is not None else connection.close_code
        close_reason = close_reason or connection.close_reason

    observed_seconds = max(0.0, observed_until - connected_at)
    report = {
        "requested_room": state.requested_room,
        "session_room": state.session_room,
        "observer_id": state.self_id,
        "transport": connection.transport,
        "requested_seconds": seconds,
        "observed_seconds": round(observed_seconds, 6),
        "connection_seconds": round(connected_at - connect_started, 6),
        "completed": completed,
        "first_tick": connection.welcome.tick,
        "last_tick": state.tick,
        "snapshots": snapshots,
        "snapshot_hz": (round(snapshots / observed_seconds, 3) if observed_seconds else 0.0),
        "event_counts": event_counts,
        "close_code": close_code,
        "close_reason": close_reason,
        "final_state": state.to_dict(),
    }
    log_message(
        name,
        "finished",
        observed_seconds=report["observed_seconds"],
        snapshots=snapshots,
        first_tick=connection.welcome.tick,
        last_tick=state.tick,
    )
    return report


def _player_name(state: WorldState, player_id: str) -> str:
    player = state.players.get(player_id)
    return player.name if player else player_id
