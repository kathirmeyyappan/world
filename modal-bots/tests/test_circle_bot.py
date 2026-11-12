from __future__ import annotations

import dataclasses
import math

from bots.circle_bot import BLOCKED_TICKS, ORBIT_RADIUS, SETTLE_TICKS, Circler, Stall
from common import Controls, Vec3
from common.controls import TICK_RATE
from common.world import load_world_map

from tests.test_controls import FakeConnection

SPEED = 3.5  # m/s at full input: a slow walker's, under half the standard body's


def test_stall_fires_once_per_settle_when_the_bot_stops_making_headway() -> None:
    controls = Controls(FakeConnection())  # type: ignore[arg-type]
    controls.look(0)  # facing +z, so moving right heads for +x
    controls.move(right=1)
    stall = Stall()
    x = 0.0
    stalls: list[int] = []
    for tick in range(120):
        if tick < 60:
            x += SPEED / TICK_RATE  # walking freely, then pinned against the edge from tick 60
        if stall.blocked(tick, Vec3(x, 1.7, 0), controls, SPEED):
            stalls.append(tick)

    assert stalls[0] - 60 <= 2 * BLOCKED_TICKS
    # Still pinned, it waits out the round trip before judging again.
    assert stalls[1] - stalls[0] >= SETTLE_TICKS


def test_detour_heads_round_the_ring_by_the_map() -> None:
    world = load_world_map()
    circler = Circler(world)
    center = Vec3(0, 1.7, 0)
    me = dataclasses.replace(FakeConnection().welcome.players[0], pos=Vec3(ORBIT_RADIUS, 1.7, 0))
    goals = circler.ring_goals(me, center)
    assert goals
    first = world.nodes[goals[0]]
    assert abs(math.hypot(first.x, first.z) - ORBIT_RADIUS) < 1
    # A step on in the circling direction from +x (bearing falls): round toward +z.
    assert first.z > ORBIT_RADIUS / 2
    # Every candidate sits on the ring, and the way there exists from where the bot stands.
    assert all(abs(math.hypot(world.nodes[g].x, world.nodes[g].z) - ORBIT_RADIUS) < 1 for g in goals)
    start = world.node_at(Vec3(ORBIT_RADIUS, 0, 0))
    assert start is not None and world.path(start, goals[0]) is not None
