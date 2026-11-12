"""Circle the nearest player, or the world origin when alone, clockwise at a fixed radius, and
when something's in the way find a way round it through the world map instead."""

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
from common.navigation import Route
from common.world import EYE_HEIGHT, load_world_map

ORBIT_RADIUS = 12
RADIAL_CORRECTION_DISTANCE = 6
# Within this of the ring the bot circles; further off (a wall or the world's edge pushing it
# off, or the target having moved) it walks to the ring by the map.
RING_BAND = 3
# The ring point a detour heads for is this far round the circle from where the bot is, so the
# way there goes round whatever it stopped at; the next ones round are tried when the map has no
# way to it.
DETOUR_STEP = math.radians(60)
# A detour is planned again when its target has moved this far since.
REPLAN_DISTANCE = 4
# Blocked means covering under half the commanded distance over a few ticks: the world's edge or a
# wall is soaking up the move. The window is long enough that one late snapshot doesn't count.
BLOCKED_PROGRESS = 0.5
BLOCKED_TICKS = 4
# After joining or a detour, the snapshots still show the old input for a round trip, so the
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
    circler = Circler(load_world_map())
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
                if circler.step(state.tick, state.me, center, controls):
                    log_message(name, "detour", tick=state.tick, nodes=len(circler.route.path) if circler.route else 0)
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
        detours=circler.detours,
    )
    return {
        "bot": name,
        "completed": completed,
        "observed_seconds": round(observed_seconds, 6),
        "connection_seconds": round(connected_at - connect_started, 6),
        "target": target_key,
        "detours": circler.detours,
        "last_tick": state.tick,
        "final_state": state.to_dict(),
    }


class Circler:
    """Circling, or on a detour by the map to a point further round the ring."""

    def __init__(self, world: WorldMap) -> None:
        self.world = world
        self.stall = Stall()
        self.route: Route | None = None
        self.route_center: Vec3 | None = None
        self.detours = 0

    def step(self, tick: int, me: Player, center: Vec3, controls: Controls) -> bool:
        """Set the controls for this snapshot; True when a detour was planned."""
        controls.look_at(me.pos, center)
        if self.route is not None and self.route_center is not None:
            moved = math.hypot(center.x - self.route_center.x, center.z - self.route_center.z)
            if self.route.done or moved > REPLAN_DISTANCE:
                self.route = None
                self.stall.reset(tick)
            elif self.route.stuck(tick):
                return self._detour(tick, me, center)
            else:
                self.route.steer(me.pos, tick, controls)
                return False
        distance = math.hypot(me.pos.x - center.x, me.pos.z - center.z)
        if abs(distance - ORBIT_RADIUS) > RING_BAND or self.stall.blocked(
            tick, me.pos, controls, self.world.walk_speed(me.avatar)
        ):
            return self._detour(tick, me, center)
        _orbit(controls, distance)
        return False

    def _detour(self, tick: int, me: Player, center: Vec3) -> bool:
        """Plan a way round to the ring; back to circling (and the stall check) when there's none."""
        self.route = None
        self.route_center = center
        self.stall.reset(tick)
        start = self.world.node_at(_feet(me))
        if start is None:
            return False
        for goal in self.ring_goals(me, center):
            path = self.world.path(start, goal)
            if path is not None:
                self.route = Route(self.world, path, tick)
                self.detours += 1
                return True
        return False

    def ring_goals(self, me: Player, center: Vec3) -> list[int]:
        """The map's nodes nearest the ring points round the circle from the bot's side, the
        first a step on in the circling direction, in the order to try them."""
        bearing = math.atan2(me.pos.x - center.x, me.pos.z - center.z)
        feet_y = center.y - EYE_HEIGHT
        goals: list[int] = []
        for k in range(1, round(2 * math.pi / DETOUR_STEP) + 1):
            a = bearing + _CIRCLING_SIGN * k * DETOUR_STEP
            spot = Vec3(center.x + ORBIT_RADIUS * math.sin(a), feet_y, center.z + ORBIT_RADIUS * math.cos(a))
            node = self.world.node_at(spot)
            if node is not None and node not in goals:
                goals.append(node)
        return goals


# Strafing right while facing the centre takes the bot clockwise seen from above, which is the
# way its bearing from the centre decreases (bearing is atan2(x, z), yaw's frame).
_CIRCLING_SIGN = -1


def _orbit(controls: Controls, distance: float) -> None:
    """Strafe round the centre, easing in or out toward the ring."""
    radial = max(-1.0, min(1.0, (distance - ORBIT_RADIUS) / RADIAL_CORRECTION_DISTANCE))
    controls.move(forward=radial, right=1)


class Stall:
    """Whether the bot has stopped making headway on the move it's commanding."""

    def __init__(self) -> None:
        self._settle_until: int | None = None
        # Where the window started: tick, position, and the commanded move in world metres per
        # second at full speed.
        self._start: tuple[int, float, float, float, float] | None = None

    def reset(self, tick: int) -> None:
        self._settle_until = tick + SETTLE_TICKS
        self._start = None

    def blocked(self, tick: int, pos: Vec3, controls: Controls, speed: float) -> bool:
        """Judge the move commanded so far against where the bot got to, walking at ``speed`` m/s
        at full input."""
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
        if made >= BLOCKED_PROGRESS * speed * elapsed / TICK_RATE:
            return False
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


def _feet(p: Player) -> Vec3:
    return Vec3(p.pos.x, p.pos.y - EYE_HEIGHT, p.pos.z)


def _player_name(state: WorldState, player_id: str) -> str:
    player = state.players.get(player_id)
    return player.name if player else player_id
