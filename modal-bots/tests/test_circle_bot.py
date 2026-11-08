from __future__ import annotations

from bots.circle_bot import (
    BLOCKED_TICKS,
    LOOSEN_RATE,
    MAX_RADIUS,
    MIN_RADIUS,
    MOVE_SPEED,
    SETTLE_TICKS,
    SHRINK,
    Orbit,
)
from common import Controls, Vec3
from common.controls import TICK_RATE

from tests.test_controls import FakeConnection


def test_orbit_tightens_when_blocked_and_loosens_when_clear() -> None:
    controls = Controls(FakeConnection())  # type: ignore[arg-type]
    controls.look(0)  # facing +z, so moving right heads for +x
    controls.move(right=1)
    orbit = Orbit()
    x = 0.0
    blocks: list[int] = []
    for tick in range(120):
        if tick < 60:
            x += MOVE_SPEED / TICK_RATE  # walking freely, then pinned against the edge from tick 60
        if orbit.blocked(tick, Vec3(x, 1.7, 0), controls):
            blocks.append(tick)

    assert blocks[0] - 60 <= 2 * BLOCKED_TICKS
    # Still pinned, it waits out the round trip before judging (and tightening) again.
    assert blocks[1] - blocks[0] >= SETTLE_TICKS
    assert orbit.radius < MAX_RADIUS * SHRINK ** (len(blocks) - 1)

    # Pinned for long enough, the circle shrinks to the floor and no further.
    for tick in range(120, 2000):
        orbit.blocked(tick, Vec3(x, 1.7, 0), controls)
    assert orbit.radius == MIN_RADIUS

    # Walking freely again, it eases back out to the widest.
    for tick in range(2000, 2000 + int(MAX_RADIUS / LOOSEN_RATE * TICK_RATE) + 1):
        x += MOVE_SPEED / TICK_RATE
        orbit.blocked(tick, Vec3(x, 1.7, 0), controls)
    assert orbit.radius == MAX_RADIUS
