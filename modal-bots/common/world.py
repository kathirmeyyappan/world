"""The world's structures and walkable ground, for bots that need to see past walls or find a way
somewhere (up the tower's stair, say).

It reads ``world_map.json.gz``, which ``npm run bot-map`` builds from the TypeScript content and
sim (``packages/shared/src/sim/botMap.ts``): the structures, the same list the server collides
with, and a graph of the spots a player can stand on a 1 m grid, joined where the sim walks
between neighbours. ``clear`` mirrors the sim's line of sight (``Structures.clear``), and the map's
own sight checks pin it to the sim's answers.
"""

from __future__ import annotations

import gzip
import heapq
import json
import math
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from .protocol import Vec3

MAP_PATH = Path(__file__).with_name("world_map.json.gz")
EYE_HEIGHT = 1.7  # metres from feet to eyes (EYE_HEIGHT in packages/shared/src/sim/constants.ts)
CELL = 8.0  # metres per side of the grid that sight lines look structures up in
RAY_STEP = 0.05  # metres between samples where a sight line crosses a sloped top (collision.ts)
JUMP_COST = 2.0  # metres of walking a route would rather take than one jump


@dataclass(frozen=True, slots=True)
class Hitbox:
    """What a shot has to land in (Hitbox in packages/shared/src/sim/avatars.ts): an upright capsule
    from the feet up to ``top`` metres, ``radius`` round its axis, whose top ``head`` metres are the
    head."""

    top: float
    radius: float
    head: float


@dataclass(frozen=True, slots=True)
class Piece:
    """One structure placed in the world: a w x d footprint turned by yaw, from ``base`` up to
    ``top(lx, lz)`` above it at each local point."""

    x: float
    z: float
    cos: float
    sin: float
    hw: float
    hd: float
    base: float
    height: float
    top: Callable[[float, float], float]

    def local(self, x: float, z: float) -> tuple[float, float]:
        dx = x - self.x
        dz = z - self.z
        return dx * self.cos - dz * self.sin, dx * self.sin + dz * self.cos


class WorldMap:
    def __init__(self, data: Mapping[str, Any]):
        self.pieces = tuple(_piece(s) for s in data["structures"])
        # Where a player can stand (feet); for each, the neighbours they can walk straight to, and
        # the ones only a running jump reaches.
        self.nodes = tuple(Vec3(float(x), float(y), float(z)) for x, y, z in data["nodes"])
        self.edges = tuple(tuple(int(j) for j in out) for out in data["edges"])
        self.jumps = tuple(frozenset(int(j) for j in out) for out in data["jumps"])
        # Spots well up with a wide view out (the balconies and decks), all reachable on foot.
        self.lookouts = tuple(int(i) for i in data["lookouts"])
        self.hitboxes = {
            avatar: Hitbox(float(h["top"]), float(h["radius"]), float(h["head"]))
            for avatar, h in data["hitboxes"].items()
        }
        self.sight_checks = tuple(tuple(float(v) for v in check) for check in data["sightChecks"])
        self._cells: dict[tuple[int, int], list[int]] = {}
        for i, p in enumerate(self.pieces):
            r = math.hypot(p.hw, p.hd)
            for key in _cells_over(p.x - r, p.z - r, p.x + r, p.z + r):
                self._cells.setdefault(key, []).append(i)
        self._columns: dict[tuple[int, int], list[int]] = {}
        for i, n in enumerate(self.nodes):
            self._columns.setdefault((round(n.x), round(n.z)), []).append(i)

    def hitbox(self, avatar: str) -> Hitbox:
        """An avatar's hitbox, the standard one's for an avatar the map doesn't know."""
        return self.hitboxes.get(avatar, self.hitboxes["standard"])

    def clear(self, a: Vec3, b: Vec3) -> bool:
        """Whether nothing stands between ``a`` and ``b``: a shot from one reaches the other."""
        length = math.dist((a.x, a.y, a.z), (b.x, b.y, b.z))
        if length < 1e-9:
            return True
        d = ((b.x - a.x) / length, (b.y - a.y) / length, (b.z - a.z) / length)
        return all(not self._hits(self.pieces[i], a, d, length) for i in self._along(a, b))

    def node_at(self, feet: Vec3, reach: float = 3) -> int | None:
        """The node nearest ``feet`` (a player's ``pos`` less EYE_HEIGHT) within ``reach`` metres."""
        best: int | None = None
        best_distance = reach
        span = math.ceil(reach)
        cx, cz = round(feet.x), round(feet.z)
        for dx in range(-span, span + 1):
            for dz in range(-span, span + 1):
                for i in self._columns.get((cx + dx, cz + dz), ()):
                    n = self.nodes[i]
                    distance = math.dist((n.x, n.y, n.z), (feet.x, feet.y, feet.z))
                    if distance < best_distance:
                        best, best_distance = i, distance
        return best

    def path(self, start: int, goal: int) -> list[int] | None:
        """The shortest way from node ``start`` to node ``goal`` (both ends included), or None
        when there's none. It jumps only where walking can't get there (``jumps``)."""
        target = self.nodes[goal]
        frontier = [(0.0, start)]
        cost = {start: 0.0}
        came_from: dict[int, int] = {}
        while frontier:
            _, i = heapq.heappop(frontier)
            if i == goal:
                route = [i]
                while route[-1] != start:
                    route.append(came_from[route[-1]])
                return route[::-1]
            here = self.nodes[i]
            for j in (*self.edges[i], *self.jumps[i]):
                there = self.nodes[j]
                step = cost[i] + math.dist((here.x, here.y, here.z), (there.x, there.y, there.z))
                if j in self.jumps[i]:
                    step += JUMP_COST
                if step < cost.get(j, math.inf):
                    cost[j] = step
                    came_from[j] = i
                    estimate = math.dist((there.x, there.y, there.z), (target.x, target.y, target.z))
                    heapq.heappush(frontier, (step + estimate, j))
        return None

    def _along(self, a: Vec3, b: Vec3) -> Iterator[int]:
        """Each piece whose grid cells the segment's ground track crosses, once."""
        seen: set[int] = set()
        for key in _cells_on_segment(a.x, a.z, b.x, b.z):
            for i in self._cells.get(key, ()):
                if i not in seen:
                    seen.add(i)
                    yield i

    @staticmethod
    def _hits(p: Piece, o: Vec3, d: tuple[float, float, float], max_t: float) -> bool:
        """Whether the ray from ``o`` along unit ``d`` enters the piece within ``max_t`` (the sim's
        ``Structures.raycast``)."""
        ox, oz = p.local(o.x, o.z)
        dx = d[0] * p.cos - d[2] * p.sin
        dz = d[0] * p.sin + d[2] * p.cos
        t0, t1 = 0.0, max_t
        for v, dv, lo, hi in ((ox, dx, -p.hw, p.hw), (oz, dz, -p.hd, p.hd), (o.y, d[1], p.base, p.base + p.height)):
            if abs(dv) < 1e-12:
                if v < lo or v > hi:
                    return False
                continue
            a = (lo - v) / dv
            b = (hi - v) / dv
            t0 = max(t0, min(a, b))
            t1 = min(t1, max(a, b))
        t = t0
        while t <= t1:
            lx = max(-p.hw, min(p.hw, ox + dx * t))
            lz = max(-p.hd, min(p.hd, oz + dz * t))
            if o.y + d[1] * t <= p.base + p.top(lx, lz) + 1e-9:
                return True
            t += RAY_STEP
        return False


@cache
def load_world_map() -> WorldMap:
    """The world, read once per process and shared by every bot in it."""
    with gzip.open(MAP_PATH, "rt", encoding="utf-8") as f:
        return WorldMap(json.load(f))


def _piece(s: Mapping[str, Any]) -> Piece:
    """A structure from the map, with its kind's top (surfaceOf in packages/shared/src/sim/structures.ts)."""
    yaw = float(s.get("yaw", 0))
    w, d = float(s["w"]), float(s["d"])
    top: Callable[[float, float], float]
    if s["kind"] == "box":
        h = float(s["h"])
        height = h

        def top(_lx: float, _lz: float) -> float:
            return h
    elif s["kind"] == "ramp":
        h = float(s["h"])
        height = h

        def top(_lx: float, lz: float) -> float:
            return h * (lz / d + 0.5)
    elif s["kind"] == "terrain":
        heights = [[float(v) for v in row] for row in s["heights"]]
        height = max(0.0, *(v for row in heights for v in row))

        def top(lx: float, lz: float) -> float:
            return _bilinear(heights, w, d, lx, lz)
    else:
        raise ValueError(f"unknown structure kind {s['kind']!r}; rebuild the map and teach world.py about it")
    return Piece(
        x=float(s["x"]),
        z=float(s["z"]),
        cos=math.cos(yaw),
        sin=math.sin(yaw),
        hw=w / 2,
        hd=d / 2,
        base=float(s.get("y", 0)),
        height=height,
        top=top,
    )


def _bilinear(heights: list[list[float]], w: float, d: float, lx: float, lz: float) -> float:
    rows, cols = len(heights), len(heights[0])
    fx = max(0.0, min(cols - 1.0, (lx / w + 0.5) * (cols - 1)))
    fz = max(0.0, min(rows - 1.0, (lz / d + 0.5) * (rows - 1)))
    i = min(cols - 2, math.floor(fx))
    j = min(rows - 2, math.floor(fz))
    tx, tz = fx - i, fz - j

    def row(r: list[float]) -> float:
        return r[i] + (r[i + 1] - r[i]) * tx

    return row(heights[j]) + (row(heights[j + 1]) - row(heights[j])) * tz


def _cells_over(min_x: float, min_z: float, max_x: float, max_z: float) -> Iterator[tuple[int, int]]:
    for cx in range(math.floor(min_x / CELL), math.floor(max_x / CELL) + 1):
        for cz in range(math.floor(min_z / CELL), math.floor(max_z / CELL) + 1):
            yield cx, cz


def _cells_on_segment(ax: float, az: float, bx: float, bz: float) -> Iterator[tuple[int, int]]:
    """The grid cells a segment on the ground passes through, in order (Amanatides and Woo)."""
    cx, cz = math.floor(ax / CELL), math.floor(az / CELL)
    end = (math.floor(bx / CELL), math.floor(bz / CELL))
    dx, dz = bx - ax, bz - az
    step_x = 1 if dx > 0 else -1
    step_z = 1 if dz > 0 else -1
    # Fraction of the segment to the next cell edge along each axis, and per whole cell.
    next_x = ((cx + (step_x > 0)) * CELL - ax) / dx if dx else math.inf
    next_z = ((cz + (step_z > 0)) * CELL - az) / dz if dz else math.inf
    per_x = CELL / abs(dx) if dx else math.inf
    per_z = CELL / abs(dz) if dz else math.inf
    yield cx, cz
    while (cx, cz) != end and min(next_x, next_z) <= 1:
        if next_x < next_z:
            cx += step_x
            next_x += per_x
        else:
            cz += step_z
            next_z += per_z
        yield cx, cz
