"""Mesh helpers the house scripts share (house-model.py, house_interior.py): triangles as lists of
corners (position, texture coordinates), cutting openings out of them, lining an opening through a
wall, lathes and discs, and writing a part in the client's format."""

from __future__ import annotations

from collections.abc import Callable
from itertools import pairwise
from pathlib import Path

import numpy as np

Corner = tuple[np.ndarray, np.ndarray]  # position, texture coordinates
Triangle = list[Corner]
Outline = list[tuple[float, float]]
Profile = list[tuple[float, float]]  # (height, radius) up a lathe
UV_UNIT = 4096  # texture coordinate units to the repeat in the part files


def area(tri: Triangle) -> float:
    a, b, c = (p for p, _ in tri)
    return float(np.linalg.norm(np.cross(b - a, c - a))) / 2


def fan(poly: list[Corner]) -> list[Triangle]:
    tris = [[poly[0], poly[i], poly[i + 1]] for i in range(1, len(poly) - 1)]
    return [t for t in tris if area(t) > 1e-9]


def clip(
    poly: list[Corner],
    a: tuple[float, float],
    b: tuple[float, float],
    keep_left: bool,
    flat: Callable[[np.ndarray], np.ndarray],
) -> list[Corner]:
    """Sutherland-Hodgman against the line a-b in the plane `flat` projects to, keeping its left
    side (inside a counter-clockwise outline) or its right."""
    if not poly:
        return []
    side = lambda p: (b[0] - a[0]) * (flat(p)[1] - a[1]) - (b[1] - a[1]) * (flat(p)[0] - a[0])
    out: list[Corner] = []
    for k in range(len(poly)):
        p, q = poly[k], poly[(k + 1) % len(poly)]
        sp, sq = side(p[0]), side(q[0])
        keep_p, keep_q = (sp >= 0) == keep_left or abs(sp) < 1e-12, (sq >= 0) == keep_left or abs(sq) < 1e-12
        if keep_p:
            out.append(p)
        if keep_p != keep_q and abs(sp - sq) > 1e-12:
            f = sp / (sp - sq)
            out.append((p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f))
    return out


def cut_out(
    tris: list[Triangle], hole: Outline, flat: Callable[[np.ndarray], np.ndarray], near: Callable[[Triangle], bool]
) -> tuple[list[Triangle], list[Triangle]]:
    """The triangles with a convex opening (counter-clockwise in the plane `flat` projects to) taken
    out of the ones `near` says are candidates: what's left of such a triangle is the pieces outside
    each of the opening's edges and inside the ones before. Returns the cut ones and the rest."""
    cut: list[Triangle] = []
    rest: list[Triangle] = []
    for tri in tris:
        if not near(tri):
            rest.append(tri)
            continue
        for i in range(len(hole)):
            piece = clip(tri, hole[i], hole[(i + 1) % len(hole)], False, flat)
            for j in range(i):
                piece = clip(piece, hole[j], hole[(j + 1) % len(hole)], True, flat)
            cut += fan(piece)
    return cut, rest


def arch(x0: float, x1: float, top: float, steps: int = 16, bottom: float = -0.5) -> Outline:
    """An opening's outline in a wall's (x, y) plane, counter-clockwise: an arch on a rectangle
    from `bottom` (below the floor, so the opening runs out the bottom of the wall)."""
    r = (x1 - x0) / 2
    cx, cy = (x0 + x1) / 2, top - r
    outline = [(x0, bottom), (x1, bottom), (x1, cy)]
    outline += [(cx + r * np.cos(a), cy + r * np.sin(a)) for a in np.linspace(0, np.pi, steps + 1)[1:-1]]
    return outline + [(x0, cy)]


def circle(cx: float, cy: float, r: float, steps: int = 24) -> Outline:
    """A round opening's outline, counter-clockwise."""
    return [(cx + r * np.cos(a), cy + r * np.sin(a)) for a in 2 * np.pi * np.arange(steps) / steps]


def turned_by(tris: list[Triangle], angle: float) -> list[Triangle]:
    """The triangles turned about the y axis by `angle`, the way a lathe's angle runs (from +z toward
    +x), so what stood at bearing `angle` stands at +z when turned by -angle."""
    c, s = np.cos(angle), np.sin(angle)
    turn = lambda p: np.array([p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c])
    return [[(turn(p), q) for p, q in tri] for tri in tris]


def facing_out(tri: Triangle, axis: tuple[float, float] = (0.0, 0.0)) -> Triangle:
    """Wound to read outward from the upright axis through (x, z) (a left-handed frame, where the
    cross product of an outward face points in)."""
    a, b, c = (p for p, _ in tri)
    radial = (a + b + c) / 3 * np.array([1, 0, 1]) - np.array([axis[0], 0, axis[1]])
    return tri if float(np.cross(b - a, c - a) @ radial) < 0 else [tri[0], tri[2], tri[1]]


def lathe(
    profile: Profile,
    tile: float,
    place: Callable[[float, float], np.ndarray],
    angles: list[float] | None = None,
    segments: int = 72,
    axis: tuple[float, float] = (0.0, 0.0),
) -> list[Triangle]:
    """The profile's rings turned round the upright axis through (x, z), each point of the grid put
    where `place` says (angle, height), as triangles facing out with coordinates that wrap it in
    whole repeats of `tile` round and up. The seam column comes twice (at 0 and at the whole number
    of repeats), so no triangle spans the wrap."""
    angles = angles or [2 * np.pi * k / segments for k in range(segments + 1)]
    around = max(1, round(2 * np.pi * np.mean([np.hypot(*(place(0.0, y)[[0, 2]] - axis)) for y, _ in profile]) / tile))
    grid = [[(place(a, y), np.array([around * a / (2 * np.pi), -y / tile])) for a in angles] for y, _ in profile]
    tris: list[Triangle] = []
    for row, above in pairwise(grid):
        for k in range(len(angles) - 1):
            a, b, c, d = row[k], row[k + 1], above[k + 1], above[k]
            tris.append(facing_out([a, b, c], axis))
            tris.append(facing_out([a, c, d], axis))
    return [t for t in tris if area(t) > 1e-9]


def disc(
    ring: list[np.ndarray], centre: np.ndarray, down: bool, flat: Callable[[np.ndarray], np.ndarray]
) -> list[Triangle]:
    """A fan over a ring of points, facing down (a ceiling) or up (a floor), with the coordinates
    `flat` gives each point."""
    tris = []
    for i in range(len(ring)):
        a, b = ring[i], ring[(i + 1) % len(ring)]
        tri = [(centre, flat(centre)), (a, flat(a)), (b, flat(b))]
        if (np.cross(a - centre, b - centre)[1] < 0) != down:
            tri = [tri[0], tri[2], tri[1]]
        tris.append(tri)
    return tris


def along(
    p: np.ndarray, a: np.ndarray, b: np.ndarray, flat: Callable[[np.ndarray], np.ndarray], beyond: bool = False
) -> float | None:
    """How far along the edge a-b of an opening (in the plane `flat` projects to) a point lies, if it
    lies on it, or with `beyond` anywhere on its line."""
    d = b - a
    t = float(((flat(p) - a) @ d) / (d @ d))
    on_line = np.linalg.norm(a + d * t - flat(p)) < 1e-6
    return t if on_line and (beyond or -1e-9 <= t <= 1 + 1e-9) else None


def outline_points(
    tris: list[Triangle], a: np.ndarray, b: np.ndarray, flat: Callable[[np.ndarray], np.ndarray]
) -> list[tuple[float, np.ndarray]]:
    """The corners of a cut surface lying on the edge a-b of its opening, each as how far along the
    edge it is and where it is, in order along the edge."""
    found: dict[float, np.ndarray] = {}
    for tri in tris:
        for p, _ in tri:
            t = along(p, a, b, flat)
            if t is not None:
                found.setdefault(round(t, 7), p)
    return sorted(found.items())


def split_edge(
    tris: list[Triangle], a: np.ndarray, b: np.ndarray, ts: list[float], flat: Callable[[np.ndarray], np.ndarray]
) -> None:
    """Splits a cut surface's triangles along the edge a-b of its opening so there's a corner at each
    of `ts` along it, in place. A triangle's edge on that line may run on past the opening's corner
    (the cut leaves the line whole), so corners anywhere on the line count."""
    for t in ts:
        for k, tri in enumerate(tris):
            edge = sorted(
                (u, j) for j, (p, _) in enumerate(tri) if (u := along(p, a, b, flat, beyond=True)) is not None
            )
            if len(edge) != 2 or not edge[0][0] + 1e-7 < t < edge[1][0] - 1e-7:
                continue
            (t0, j0), (t1, j1) = edge
            (p0, q0), (p1, q1) = tri[j0], tri[j1]
            f = (t - t0) / (t1 - t0)
            m = (p0 + (p1 - p0) * f, q0 + (q1 - q0) * f)
            first, second = list(tri), list(tri)
            first[j1] = m
            second[j0] = m
            tris[k] = first
            tris.append(second)
            break


def along_edge(points: list[tuple[float, np.ndarray]], t: float) -> np.ndarray:
    """Where a cut surface's outline is `t` of the way along an edge: between the corners either side
    of it (the surface is flat between them)."""
    ts = [u for u, _ in points]
    j = int(np.clip(np.searchsorted(ts, t, side="right") - 1, 0, len(points) - 2))
    (t0, p0), (t1, p1) = points[j], points[j + 1]
    f = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
    return p0 + (p1 - p0) * f


def lining(
    outer: list[Triangle],
    inner: list[Triangle] | float,
    hole: Outline,
    tile: float,
    flat: Callable[[np.ndarray], np.ndarray],
    lift: Callable[[np.ndarray, float], np.ndarray],
    from_floor: bool = True,
) -> list[Triangle]:
    """An opening's reveal: the opening cut straight through a wall, a surface from its outline on
    the outer cut surface to the same outline on the inner one, or to a flat plane at depth
    `inner` (`lift` puts a point of the outline at a depth). Each edge of the outline is a strip
    broken at every point either surface's cut put on that edge, and each surface's triangles along
    the edge are split at the other's points too, so all three meet vertex to vertex with no crack
    between. The texture runs along the outline and in from the outer face, `tile` to the repeat.
    With `from_floor`, edges below the floor (both ends under 0) are left out, the floor being the
    ground."""
    middle = np.array([0.0, max(y for _, y in hole) / 2, 0.0])
    strips: list[Triangle] = []
    along_wall = 0.0
    for i in range(len(hole)):
        a, b = np.array(hole[i]), np.array(hole[(i + 1) % len(hole)])
        length = float(np.linalg.norm(b - a))
        if not from_floor or a[1] >= 0 or b[1] >= 0:
            on_outer = outline_points(outer, a, b, flat)
            on_inner = (
                outline_points(inner, a, b, flat)
                if isinstance(inner, list)
                else [(0.0, lift(a, inner)), (1.0, lift(b, inner))]
            )
            ts: list[float] = []
            for t in sorted({t for t, _ in on_outer} | {t for t, _ in on_inner}):
                if not ts or t - ts[-1] > 1e-6:
                    ts.append(t)
            split_edge(outer, a, b, ts, flat)
            if isinstance(inner, list):
                split_edge(inner, a, b, ts, flat)
            for t0, t1 in pairwise(ts):
                o0, o1 = along_edge(on_outer, t0), along_edge(on_outer, t1)
                i0, i1 = along_edge(on_inner, t0), along_edge(on_inner, t1)
                s0, s1 = (along_wall + t0 * length) / tile, (along_wall + t1 * length) / tile
                d0, d1 = float(np.linalg.norm(i0 - o0)) / tile, float(np.linalg.norm(i1 - o1)) / tile
                quad: list[Corner] = [
                    (o0, np.array([0.0, s0])),
                    (o1, np.array([0.0, s1])),
                    (i1, np.array([d1, s1])),
                    (i0, np.array([d0, s0])),
                ]
                for tri in ([quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]):
                    p, q, r = (v for v, _ in tri)
                    if np.cross(q - p, r - p) @ (middle - (p + q + r) / 3) < 0:
                        tri = [tri[0], tri[2], tri[1]]
                    if area(tri) > 1e-9:
                        strips.append(tri)
        along_wall += length
    return strips


class MeshBuilder:
    """Collects triangles, each corner with its texture coordinates, or by swatch name for a plain
    colour from the part's texture."""

    def __init__(self) -> None:
        self.tris: list[tuple[Triangle, str | None]] = []

    def add(self, tris: list[Triangle], swatch: str | None = None) -> None:
        self.tris += [(t, swatch) for t in tris]


def emit_part(out: Path, mesh: MeshBuilder, swatch_uv: dict[str, np.ndarray]) -> None:
    """One part's mesh as a .bin: vertex and triangle counts (Uint32), then positions in centimetres
    (Int16), texture coordinates (Uint16, UV_UNIT to the repeat, v down the image), triangles
    (Uint16) and unit normals (Int8), normals last so nothing needs padding. A wrapped texture's
    coordinates are brought down by whole repeats a triangle at a time, so a lathe of any girth fits
    the format. Vertices at one spot share a normal whatever their coordinates."""
    positions, uvs, indices = [], [], []
    index: dict[tuple, int] = {}
    for tri, swatch in mesh.tris:
        corners = [(p, swatch_uv[swatch] if swatch else q) for p, q in tri]
        repeats = np.floor(np.min([q for _, q in corners], axis=0))
        for p, q in corners:
            uv = q - repeats
            key = (*np.round(p * 100).astype(int), *np.round(uv * UV_UNIT).astype(int))
            if key not in index:
                index[key] = len(positions)
                positions.append(p)
                uvs.append(uv)
            indices.append(index[key])
    pos = np.array(positions)
    idx = np.array(indices).reshape(-1, 3)
    if len(pos) > 65535:
        raise SystemExit(f"{out.name}: {len(pos)} vertices, too many for Uint16 triangles")
    _, welded = np.unique(np.round(pos, 3), axis=0, return_inverse=True)
    welded = welded.ravel()
    normals = np.zeros((welded.max() + 1, 3))
    a, b, c = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
    face = np.cross(b - a, c - a)
    for k in range(3):
        np.add.at(normals, welded[idx[:, k]], face)
    normals /= np.linalg.norm(normals, axis=1, keepdims=True) + 1e-12
    normals = normals[welded]
    uv = np.array(uvs)
    if uv.max() >= 16:
        raise SystemExit(f"{out.name}: a triangle spans {uv.max():.1f} repeats, too many for Uint16 coordinates")
    out.write_bytes(
        np.array([len(pos), len(idx)], dtype="<u4").tobytes()
        + np.round(pos * 100).astype("<i2").tobytes()
        + np.round(uv * UV_UNIT).astype("<u2").tobytes()
        + idx.astype("<u2").tobytes()
        + np.round(normals * 127).astype("i1").tobytes()
    )
    print(f"wrote {out} ({len(pos)} vertices, {len(idx)} triangles, {out.stat().st_size} bytes)")
