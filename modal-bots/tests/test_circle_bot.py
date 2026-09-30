from __future__ import annotations

from bots.circle_bot import BLOCKED_TICKS, MOVE_SPEED, SETTLE_TICKS, Spin
from common import Controls, Vec3
from common.controls import TICK_RATE

from tests.test_controls import FakeConnection


def test_spin_reverses_once_when_the_bot_stops_making_headway() -> None:
    controls = Controls(FakeConnection())  # type: ignore[arg-type]
    controls.look(0)  # facing +z, so moving right heads for +x
    controls.move(right=1)
    spin = Spin()
    x = 0.0
    reversals: list[int] = []
    for tick in range(120):
        if tick < 60:
            x += MOVE_SPEED / TICK_RATE  # walking freely, then pinned against the edge from tick 60
        if spin.blocked(tick, Vec3(x, 1.7, 0), controls):
            reversals.append(tick)

    assert reversals[0] - 60 <= 2 * BLOCKED_TICKS
    # Still pinned, it waits out the round trip before judging (and flipping) again.
    assert reversals[1] - reversals[0] >= SETTLE_TICKS
    assert spin.direction == (-1) ** len(reversals)
