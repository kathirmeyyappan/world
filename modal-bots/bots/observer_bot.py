"""A bounded, non-controlling room observer."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from common import RoomConnectionError, Snapshot, WorldState, connect
from common.deployment import validate_duration


async def run_observer_bot(
    room: str,
    name: str = "observer",
    seconds: float = 30,
    *,
    lobby_url: str | None = None,
    direct_ws_url: str | None = None,
) -> dict[str, Any]:
    """Join visibly as a normal player and observe without gameplay input.

    Args:
        room: The room to observe.
        name: The name of the observer.
        seconds: The duration to observe the room for.
        lobby_url: The URL of the lobby to use.
        direct_ws_url: The URL of the direct WebSocket to use.

    Report observed room state.
    """

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
    event_counts = {"welcome": 1}
    snapshots = 0
    completed = False
    close_code: int | None = None
    close_reason = ""
    observed_until = connected_at

    print(
        f"observer {connection.id} joined {connection.room} "
        f"via {connection.transport}"
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
        "snapshot_hz": (
            round(snapshots / observed_seconds, 3) if observed_seconds else 0.0
        ),
        "event_counts": event_counts,
        "close_code": close_code,
        "close_reason": close_reason,
        "final_state": state.to_dict(),
    }
    print(
        f"observer {connection.id} finished after {report['observed_seconds']:.2f}s: "
        f"{snapshots} snapshots, tick {connection.welcome.tick}->{state.tick}"
    )
    return report
