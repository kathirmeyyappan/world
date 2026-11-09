"""Orbit the nearest player, or the world origin when alone, tightening the circle on anything in the way."""

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
    WorldMap,
    WorldState,
    connect,
    log_death,
    log_message,
    run_input_loop,
)
from common.controls import TICK_RATE
from common.deployment import validate_duration
from common.world import EYE_HEIGHT, load_world_map

# The circle's radius in metres: the widest ring round the centre that the map says is walkable
# all the way round, down the ladder to the floor, and tighter still each time the bot stops making
# headway on it, easing back out toward that ring while the way round is clear.
MAX_RADIUS = 12
MIN_RADIUS = 0.1
RADII = (12.0, 10.0, 8.0, 6.0, 4.0, 3.0, 2.0, 1.0, 0.5, MIN_RADIUS)
SHRINK = 0.5  # the radius is multiplied by this on each block
LOOSEN_RATE = 0.25  # metres per second the radius grows back while the way round is clear
# A ring point is walkable when a node of the map's 1 m grid lies within this of it, so the ring
# keeps a node's half-spacing from any edge or wall. The fit is sampled every few ticks.
RING_REACH = 0.8
FIT_TICKS = 10
RADIAL_CORRECTION_DISTANCE = 6
MOVE_SPEED = 8  # metres per second at full input (MOVE_SPEED in packages/shared/src/sim/constants.ts)
# Blocked means covering under half the commanded distance over a few ticks: the world's edge or a
# wall is soaking up the move. The window is long enough that one late snapshot doesn't count.
BLOCKED_PROGRESS = 0.5
BLOCKED_TICKS = 4
# After joining or reversing, the snapshots still show the old input for a round trip, so the
# check waits this long before judging again.
SETTLE_TICKS = 15


async def run_circle_bot(
    room: str,
    name: str = "circle-bot",
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
    target_key: str | None = None
    orbit = Orbit(load_world_map())
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
                    # Input from the dead does nothing, so stop sending it and wait for the server
                    # to remove the corpse and close the connection. A shot death's kill event,
                    # naming the killer and weapon, follows the fatal hit; /kill-bots sends none.
                    stop.set()
                    if isinstance(message, Event) and message.t == "kill":
                        log_death(
                            name,
                            _player_name(state, message.data["shooter"]),
                            item=message.data["item"],
                            headshot=message.data["headshot"],
                        )
                    continue

                target = state.nearest_player()
                center = target.pos if target else Vec3(0, state.me.pos.y, 0)
                orbit.fit(state.tick, Vec3(center.x, center.y - EYE_HEIGHT, center.z))
                if orbit.blocked(state.tick, state.me.pos, controls):
                    log_message(name, "orbit tightened", tick=state.tick, radius=orbit.radius)
                _steer(state.me, controls, center, orbit.radius)
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


class Orbit:
    """How wide the circle is: the widest walkable ring, halved as soon as the bot stops making
    headway, widening again slowly."""

    def __init__(self, world: WorldMap) -> None:
        self.world = world
        self.radius = float(MAX_RADIUS)
        # The widest ring round the centre that is walkable all the way round.
        self.cap = float(MAX_RADIUS)
        self._fit_tick: int | None = None
        self._settle_until: int | None = None
        # Where the window started: tick, position, and the commanded move in world metres per
        # second at full speed.
        self._start: tuple[int, float, float, float, float] | None = None

    def fit(self, tick: int, center: Vec3) -> None:
        """Cap the radius at the widest ring round ``center`` (feet) that the map can walk."""
        if self._fit_tick is not None and tick - self._fit_tick < FIT_TICKS:
            return
        self._fit_tick = tick
        self.cap = next((r for r in RADII if self._walkable(center, r)), MIN_RADIUS)
        self.radius = min(self.radius, self.cap)

    def _walkable(self, center: Vec3, radius: float) -> bool:
        samples = min(32, max(8, math.ceil(2 * math.pi * radius)))
        for k in range(samples):
            a = 2 * math.pi * k / samples
            spot = Vec3(center.x + radius * math.sin(a), center.y, center.z + radius * math.cos(a))
            if self.world.node_at(spot, RING_REACH) is None:
                return False
        return True

    def blocked(self, tick: int, pos: Vec3, controls: Controls) -> bool:
        """Judge the move commanded so far against where the bot got to; tighten if it stalled."""
        if self._settle_until is None:
            self._settle_until = tick + SETTLE_TICKS
        dx, dz = _world_move(controls)
        if tick < self._settle_until or self._start is None:
            self._start = (tick, pos.x, pos.z, dx, dz)
            return False
        start_tick, x, z, sdx, sdz = self._start
        elapsed = tick - start_tick
        if elapsed < BLOCKED_TICKS:
            return False
        self._start = (tick, pos.x, pos.z, dx, dz)
        wanted = sdx * sdx + sdz * sdz
        if wanted < 1e-6:
            return False
        # Metres along the commanded line, scaled up as if the command had been full speed.
        made = ((pos.x - x) * sdx + (pos.z - z) * sdz) / wanted
        if made >= BLOCKED_PROGRESS * MOVE_SPEED * elapsed / TICK_RATE:
            self.radius = min(self.cap, self.radius + LOOSEN_RATE * elapsed / TICK_RATE)
            return False
        self.radius = max(MIN_RADIUS, self.radius * SHRINK)
        self._settle_until = tick + SETTLE_TICKS
        return True


# The commanded move in world x/z, as the sim turns an input frame's mx/my into motion
# (stepPlayer in packages/shared/src/sim/player.ts).
def _world_move(controls: Controls) -> tuple[float, float]:
    sin_y = math.sin(controls.yaw)
    cos_y = math.cos(controls.yaw)
    return (
        sin_y * controls.forward + cos_y * controls.right,
        cos_y * controls.forward - sin_y * controls.right,
    )


def _steer(me: Player, controls: Controls, center: Vec3, radius: float) -> None:
    controls.look_at(me.pos, center)

    distance = math.hypot(me.pos.x - center.x, me.pos.z - center.z)
    radial = max(
        -1.0,
        min(1.0, (distance - radius) / RADIAL_CORRECTION_DISTANCE),
    )
    controls.move(forward=radial, right=1)


def _player_name(state: WorldState, player_id: str) -> str:
    player = state.players.get(player_id)
    return player.name if player else player_id
