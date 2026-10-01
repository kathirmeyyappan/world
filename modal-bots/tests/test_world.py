from __future__ import annotations

import math

from common import Vec3
from common.world import load_world_map

TOWER = (112.0, 0.0)  # the Tung Tung Tower's centre (ANNEX in packages/shared/src/sim/outline.ts)


def test_line_of_sight_matches_the_sim() -> None:
    world = load_world_map()
    assert len(world.sight_checks) > 0
    for ax, ay, az, bx, by, bz, clear in world.sight_checks:
        assert world.clear(Vec3(ax, ay, az), Vec3(bx, by, bz)) == bool(clear), (ax, ay, az, bx, by, bz)


def test_a_walk_from_the_main_disc_climbs_to_every_balcony() -> None:
    world = load_world_map()
    start = world.node_at(Vec3(0, 0, 0))
    assert start is not None
    for floor in (20, 40, 60):
        balcony = world.node_at(Vec3(TOWER[0] + 21.5, floor, TOWER[1]))
        assert balcony is not None
        route = world.path(start, balcony)
        assert route is not None, f"no way to the balcony at {floor} m"
        assert math.isclose(world.nodes[route[-1]].y, floor, abs_tol=0.05)
        # Up the stair and off it (over the rail, on floors 1 and 2), never higher than a jump.
        assert max(world.nodes[i].y for i in route) <= floor + 1.5
