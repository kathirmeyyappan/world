"""Following a way through the world map: steer at each node of a path in turn, jumping where the
map says only a jump gets there."""

from __future__ import annotations

import math

from .controls import TICK_RATE, Controls
from .protocol import Vec3
from .world import EYE_HEIGHT, WorldMap

ARRIVE = 0.6  # metres across the floor from a node that count as there
JUMP_FROM = 0.3  # metres from a jump's take-off a bot lines up within first (the map jumped from it)
STUCK_SECONDS = 2.0  # this long without reaching the next node means something's in the way


class Route:
    """A path from ``world.path``. Call ``steer`` on every snapshot; it sets the controls' move
    (relative to whatever they're looking at, so look first) and says when the walk is over."""

    def __init__(self, world: WorldMap, path: list[int], tick: int):
        self.world = world
        self.path = path
        self.next = 1 if len(path) > 1 else 0
        self._since = tick
        self._jumped = False

    @property
    def goal(self) -> int:
        return self.path[-1]

    @property
    def done(self) -> bool:
        return self.next >= len(self.path)

    def stuck(self, tick: int) -> bool:
        """No closer to the next node for STUCK_SECONDS: plan again from where the bot is."""
        return not self.done and tick - self._since > STUCK_SECONDS * TICK_RATE

    def steer(self, eye: Vec3, tick: int, controls: Controls, speed: float = 1) -> bool:
        """Move toward the next node (``eye`` is the bot's ``pos``); False once at the end."""
        feet = Vec3(eye.x, eye.y - EYE_HEIGHT, eye.z)
        while not self.done and self._reached(feet):
            self.next += 1
            self._since = tick
            self._jumped = False
        if self.done:
            controls.stop()
            return False
        here, there = self.path[self.next - 1], self.path[self.next]
        if there in self.world.jumps[here] and not self._jumped:
            # Line up on the take-off spot, then go: the map's jump starts there at a run.
            start = self.world.nodes[here]
            if _across(feet, start) > JUMP_FROM:
                controls.walk_toward(eye, start, speed)
                return True
            controls.jump()
            self._jumped = True
        controls.walk_toward(eye, self.world.nodes[there], speed)
        return True

    def _reached(self, feet: Vec3) -> bool:
        node = self.world.nodes[self.path[self.next]]
        return _across(feet, node) <= ARRIVE and abs(feet.y - node.y) <= 0.6


def _across(a: Vec3, b: Vec3) -> float:
    return math.hypot(a.x - b.x, a.z - b.z)
