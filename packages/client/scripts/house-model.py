"""Builds the pineapple house (SpongeBob's) for the world from penqin's Sketchfab model: the client's
meshes (public/assets/models/pineapple-<part>.bin, fetched by the loader) and textures, and the
sim's content/pineappleProfile.ts.

    python packages/client/scripts/house-model.py path/to/spongebobs_house.glb

The model is a single skin: the pineapple's shell (a coarse lathe, open at the ground and at the
crown), a door panel with a porthole, three portholes in the wall, a chimney, the leaves, and the
rivets on all of those. From it this keeps the shell's outline (its rings' radii up the height), the
leaves, the portholes and the chimney, and builds the rest itself, in five parts:

- skin: the shell turned afresh as a smooth lathe through those rings, scaled so its belly is OUTER
  round like the keep it replaces, in a pineapple diamond pattern painted here and wrapped round,
  with the doorway cut out of its front;
- inside: the same lathe WALL inward up to CEILING, papered in stripes painted here, the doorway cut
  out of it the same way;
- frame: the doorway's jambs and arch, straight through the wall from the one cut to the other,
  lined with planks painted here;
- trim: the leaves, portholes and chimney as the model has them (its texture, cut down), the
  ceiling and the crown's cap;
- door: a flat slab the doorway's shape less a hair of clearance all round, a plank door with a
  porthole painted here on both faces, standing upright in the passage where it clears both skins,
  about the pin at its left edge on the sill, for the sim to swing (content/pineapple.ts).

The profile the sim collides with (the shell's rings, the doorway and its door, the ceiling) comes
from the same lathe.
"""

from __future__ import annotations

import io
import sys
from itertools import pairwise
from pathlib import Path

import numpy as np
from glb import accessor, components, local_matrix, read_glb
from PIL import Image

OUTER = 20.0  # metres: the shell's radius at its widest, the keep's (content/keep.ts)
WALL = 2.0  # metres: how thick the shell is made
CEILING = 15.0  # metres above the shell's foot: the flat ceiling of the one room inside
SILL = 0.1  # metres above the shell's foot the floor's top, and the door's bottom, stand
DOOR_WIDTH = 2.8  # metres: the doorway, an arch
DOOR_HEIGHT = 4.0
DOOR_THICKNESS = 0.2
CLEARANCE = 0.02  # metres the door stands in from the doorway's edge all round
KNUCKLES = (0.6, 3.1)  # metres up the pin the two hinge knuckles sit
KNUCKLE = (0.05, 0.24)  # a knuckle's radius and height
SEGMENTS = 72  # round the lathe
RING_STEP = 1.0  # metres between the lathe's rings
PROFILE_STEP = 3.0  # metres between the rings the sim gets
SKIN_TILE = 3.0  # metres of shell one repeat of the pineapple pattern covers
PAPER_TILE = 2.0  # metres of wall one repeat of the stripes covers
PLANK_TILE = 1.0  # metres of jamb one repeat of the planks covers
TRIM_TEXTURE = 512  # the model's texture is cut down to this for what's kept of it
CLIENT = Path(__file__).resolve().parents[1]
MODELS_OUT = CLIENT / "public/assets/models"
TEXTURES_OUT = CLIENT / "public/assets/textures/models"
PROFILE_OUT = CLIENT.parent / "shared/src/content/pineappleProfile.ts"
SWATCHES = {"ceiling": (121, 85, 48), "crown": (138, 107, 42)}  # painted into the trim texture's spare corner

Corner = tuple[np.ndarray, np.ndarray]  # position, texture coordinates
Triangle = list[Corner]
Outline = list[tuple[float, float]]


def main(path: str) -> None:
    doc, blob = read_glb(Path(path).read_bytes())
    house = load_mesh(doc, blob, "Circle.001_0")
    points, uv, tris = house["positions"], house["uvs"], house["triangles"]
    parts = components({"positions": points, "triangles": tris})
    owner = np.zeros(len(points), int)
    for k, verts in enumerate(parts):
        owner[verts] = k
    of = owner[tris[:, 0]]
    shell = int(np.argmax(np.bincount(of, minlength=len(parts))))
    bounds = {k: (points[v].min(axis=0), points[v].max(axis=0)) for k, v in enumerate(parts)}
    # The model's door panel, its porthole and rivets: not kept, only where they stood.
    door = next(k for k in range(len(parts)) if k != shell and bounds[k][0][1] < 0.05 and bounds[k][1][2] > 0.8)
    (dx0, _, _), (dx1, _, _) = bounds[door]
    on_door = [
        k
        for k in range(len(parts))
        if k != shell and bounds[k][0][2] > 0.8 and bounds[k][0][0] >= dx0 - 0.02 and bounds[k][1][0] <= dx1 + 0.02
    ]

    rings = lathe_rings(points[parts[shell]])
    s = OUTER / max(r for _, r in rings)
    profile = smooth_profile([(y * s, r * s) for y, r in rings])
    print(f"shell: {len(rings)} rings in the model, {len(profile)} in the lathe; scale {s:.3f}")

    hole = arch(-DOOR_WIDTH / 2, DOOR_WIDTH / 2, DOOR_HEIGHT)
    front, rest = cut_hole(lathe(profile, 0.0, SKIN_TILE), hole)
    inner_rings = [(y, r) for y, r in profile if y <= CEILING + 1e-6]
    inner_front, inner_rest = cut_hole(lathe(inner_rings, WALL, PAPER_TILE), hole)
    lining = passage(front, inner_front, hole)
    skin = MeshBuilder()
    skin.add(front + rest)
    inside = MeshBuilder()
    inside.add([list(reversed(tri)) for tri in inner_front + inner_rest])
    frame = MeshBuilder()
    frame.add(lining)
    trim = MeshBuilder()
    trim.add(disc(ring_points(profile, CEILING, 0.0), (0, CEILING, 0), down=True), "ceiling")
    trim.add(disc(ring_points(profile, profile[-1][0], 0.0), (0, profile[-1][0], 0), down=False), "crown")
    for k in range(len(parts)):
        if k == shell or k in on_door:
            continue
        kept = [
            tri for tri in model_triangles(points, uv, tris[of == k], s) if not all(within(p, profile) for p, _ in tri)
        ]
        trim.add(kept)
    door_part, hinge = build_door(profile)

    atlas, swatch_uv = trim_texture(doc, blob)
    atlas.quantize(256, dither=Image.Dither.FLOYDSTEINBERG).save(TEXTURES_OUT / "pineapple.png", optimize=True)
    paint_pineapple().save(TEXTURES_OUT / "pineapple-skin.png", optimize=True)
    paint_stripes().save(TEXTURES_OUT / "wallpaper.png", optimize=True)
    paint_planks().save(TEXTURES_OUT / "planks.png", optimize=True)
    paint_door().save(TEXTURES_OUT / "door.png", optimize=True)
    MODELS_OUT.mkdir(parents=True, exist_ok=True)
    emit_part("skin", skin, {})
    emit_part("inside", inside, {})
    emit_part("frame", frame, {})
    emit_part("trim", trim, swatch_uv)
    emit_part("door", door_part, {})
    emit_profile(profile, hinge)


def load_mesh(doc: dict, blob: bytes, name: str) -> dict:
    """A mesh's positions in the scene's frame, texture coordinates and triangles."""
    world: dict[int, np.ndarray] = {}

    def walk(n: int, parent: np.ndarray) -> None:
        m = parent @ local_matrix(doc["nodes"][n])
        world[n] = m
        for c in doc["nodes"][n].get("children", []):
            walk(c, m)

    walk(doc["scenes"][0]["nodes"][0], np.eye(4))
    for n, node in enumerate(doc["nodes"]):
        if "mesh" in node and doc["meshes"][node["mesh"]]["name"] == name:
            prim = doc["meshes"][node["mesh"]]["primitives"][0]
            pos = accessor(doc, blob, prim["attributes"]["POSITION"])
            pos = (np.c_[pos, np.ones(len(pos))] @ world[n].T)[:, :3]
            return {
                "positions": pos,
                "uvs": accessor(doc, blob, prim["attributes"]["TEXCOORD_0"]),
                "triangles": accessor(doc, blob, prim["indices"]).reshape(-1, 3),
            }
    raise SystemExit(f"no mesh {name}")


def lathe_rings(shell: np.ndarray) -> list[tuple[float, float]]:
    """The model shell's rings, lowest first: each one's height and mean radius about the y axis."""
    ys = np.sort(shell[:, 1])
    groups: list[list[float]] = [[ys[0]]]
    for y in ys[1:]:
        (groups[-1] if y - groups[-1][-1] < 0.1 else groups.append([y]) or groups[-1]).append(y)
    rings = []
    for g in groups:
        band = shell[(shell[:, 1] >= g[0] - 1e-9) & (shell[:, 1] <= g[-1] + 1e-9)]
        rings.append((float(np.mean(g)), float(np.hypot(band[:, 0], band[:, 2]).mean())))
    return rings


def smooth_profile(rings: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """The shell's outline every RING_STEP from the ground to the crown, a Catmull-Rom curve through
    the model's rings (so the pineapple swells and tapers smoothly rather than in facets), with the
    ground and ceiling among its heights."""
    ys, rs = (np.array(v) for v in zip(*rings))
    heights = sorted({*np.arange(0, ys[-1], RING_STEP), ys[-1], CEILING})

    def at(y: float) -> float:
        i = int(np.clip(np.searchsorted(ys, y) - 1, 0, len(ys) - 2))
        t = (y - ys[i]) / (ys[i + 1] - ys[i])
        p0, p1, p2, p3 = (rs[max(i - 1, 0)], rs[i], rs[i + 1], rs[min(i + 2, len(rs) - 1)])
        return float(
            0.5
            * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t**3)
        )

    return [(float(y), at(float(y))) for y in heights]


def radius_at(profile: list[tuple[float, float]], y: float) -> float:
    ys, rs = zip(*profile)
    return float(np.interp(y, ys, rs))


def within(p: np.ndarray, profile: list[tuple[float, float]]) -> bool:
    """Whether a point is inside the inner skin: under the ceiling, short of the shell by the wall."""
    return p[1] < CEILING and np.hypot(p[0], p[2]) < radius_at(profile, p[1]) - WALL - 0.01


def lathe(profile: list[tuple[float, float]], inset: float, tile: float) -> list[Triangle]:
    """The profile turned round the y axis, `inset` in from it, as triangles with coordinates that
    wrap it in whole repeats of `tile` round and up. The seam column comes twice (at 0 and at the
    whole number of repeats), so no triangle spans the wrap."""
    around = max(1, round(2 * np.pi * np.mean([r for _, r in profile]) / tile))
    grid = []
    for y, r in profile:
        row = []
        for k in range(SEGMENTS + 1):
            a = 2 * np.pi * k / SEGMENTS
            row.append(
                (
                    np.array([(r - inset) * np.sin(a), y, (r - inset) * np.cos(a)]),
                    np.array([around * k / SEGMENTS, -y / tile]),
                )
            )
        grid.append(row)
    tris: list[Triangle] = []
    for j in range(len(grid) - 1):
        for k in range(SEGMENTS):
            a, b, c, d = grid[j][k], grid[j][k + 1], grid[j + 1][k + 1], grid[j + 1][k]
            tris.append(facing_out([a, b, c]))
            tris.append(facing_out([a, c, d]))
    return [t for t in tris if area(t) > 1e-9]


def facing_out(tri: Triangle) -> Triangle:
    """Wound to read outward from the y axis (the model's winding: a left-handed frame, where the
    cross product of an outward face points in)."""
    a, b, c = (p for p, _ in tri)
    radial = (a + b + c) / 3 * np.array([1, 0, 1])
    return tri if float(np.cross(b - a, c - a) @ radial) < 0 else [tri[0], tri[2], tri[1]]


def model_triangles(points: np.ndarray, uv: np.ndarray, tris: np.ndarray, s: float) -> list[Triangle]:
    """The model's triangles at world scale, with its texture coordinates."""
    return [[(points[i] * s, uv[i]) for i in tri] for tri in tris]


def arch(x0: float, x1: float, top: float, steps: int = 16, bottom: float = -0.5) -> Outline:
    """An opening's outline in the wall's (x, y) plane, counter-clockwise: an arch on a rectangle
    from `bottom` (below the ground, so the opening runs out the bottom of the shell)."""
    r = (x1 - x0) / 2
    cx, cy = (x0 + x1) / 2, top - r
    outline = [(x0, bottom), (x1, bottom), (x1, cy)]
    outline += [(cx + r * np.cos(a), cy + r * np.sin(a)) for a in np.linspace(0, np.pi, steps + 1)[1:-1]]
    return outline + [(x0, cy)]


def cut_hole(tris: list[Triangle], hole: Outline) -> tuple[list[Triangle], list[Triangle]]:
    """The triangles with the opening taken out of the front ones (the hole is convex, so what's left
    of a triangle is the pieces outside each of its edges and inside the ones before), and the rest
    untouched."""
    top = max(y for _, y in hole)
    reach = max(abs(x) for x, _ in hole)
    front: list[Triangle] = []
    rest: list[Triangle] = []
    for tri in tris:
        if (
            not all(p[2] > 0 for p, _ in tri)
            or all(p[1] > top + 0.5 for p, _ in tri)
            or all(abs(p[0]) > reach + 3 for p, _ in tri)
        ):
            rest.append(tri)
            continue
        for i in range(len(hole)):
            piece = clip(tri, hole[i], hole[(i + 1) % len(hole)], keep_left=False)
            for j in range(i):
                piece = clip(piece, hole[j], hole[(j + 1) % len(hole)], keep_left=True)
            front += fan(piece)
    return front, rest


def clip(poly: list[Corner], a: tuple[float, float], b: tuple[float, float], keep_left: bool) -> list[Corner]:
    """Sutherland-Hodgman against the line a-b in the (x, y) plane, keeping its left side (inside a
    counter-clockwise outline) or its right."""
    if not poly:
        return []
    side = lambda p: (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
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


def fan(poly: list[Corner]) -> list[Triangle]:
    tris = [[poly[0], poly[i], poly[i + 1]] for i in range(1, len(poly) - 1)]
    return [t for t in tris if area(t) > 1e-9]


def area(tri: Triangle) -> float:
    a, b, c = (p for p, _ in tri)
    return float(np.linalg.norm(np.cross(b - a, c - a))) / 2


def passage(outer: list[Triangle], inner: list[Triangle], hole: Outline) -> list[Triangle]:
    """The doorway's jambs and arch: the opening cut straight through the wall, a surface from its
    outline on the outer skin to the same outline on the inner. Each edge of the outline is a strip
    broken at every point either skin's cut put on that edge, and each skin's triangles along the
    edge are split at the other's points too, so all three meet vertex to vertex with no crack
    between. The planks run along the edge and across the depth from the outer skin in."""
    middle = np.array([0.0, max(y for _, y in hole) / 2, 0.0])
    strips: list[Triangle] = []
    along = 0.0
    for i in range(len(hole)):
        a, b = np.array(hole[i]), np.array(hole[(i + 1) % len(hole)])
        length = float(np.linalg.norm(b - a))
        if a[1] >= 0 or b[1] >= 0:
            on_outer, on_inner = outline_points(outer, a, b), outline_points(inner, a, b)
            ts: list[float] = []
            for t in sorted({t for t, _ in on_outer} | {t for t, _ in on_inner}):
                if not ts or t - ts[-1] > 1e-6:
                    ts.append(t)
            split_edge(outer, a, b, ts)
            split_edge(inner, a, b, ts)
            for t0, t1 in pairwise(ts):
                o0, o1 = along_edge(on_outer, t0), along_edge(on_outer, t1)
                i0, i1 = along_edge(on_inner, t0), along_edge(on_inner, t1)
                s0, s1 = (along + t0 * length) / PLANK_TILE, (along + t1 * length) / PLANK_TILE
                d0, d1 = float(np.linalg.norm(i0 - o0)) / PLANK_TILE, float(np.linalg.norm(i1 - o1)) / PLANK_TILE
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
        along += length
    return strips


def along(p: np.ndarray, a: np.ndarray, b: np.ndarray, beyond: bool = False) -> float | None:
    """How far along the edge a-b of the opening (in the wall's (x, y) plane) a point lies, if it lies
    on it, or with `beyond` anywhere on its line."""
    d = b - a
    t = float(((p[[0, 1]] - a) @ d) / (d @ d))
    on_line = np.linalg.norm(a + d * t - p[[0, 1]]) < 1e-6
    return t if on_line and (beyond or -1e-9 <= t <= 1 + 1e-9) else None


def outline_points(tris: list[Triangle], a: np.ndarray, b: np.ndarray) -> list[tuple[float, np.ndarray]]:
    """The corners of the cut skin lying on the edge a-b of the opening, each as how far along the
    edge it is and where it is, in order along the edge."""
    found: dict[float, np.ndarray] = {}
    for tri in tris:
        for p, _ in tri:
            t = along(p, a, b)
            if t is not None:
                found.setdefault(round(t, 7), p)
    return sorted(found.items())


def split_edge(tris: list[Triangle], a: np.ndarray, b: np.ndarray, ts: list[float]) -> None:
    """Splits the cut skin's triangles along the edge a-b of the opening so there's a corner at each
    of `ts` along it, in place. A triangle's edge on that line may run on past the opening's corner
    (the cut leaves the line whole), so corners anywhere on the line count."""
    for t in ts:
        for k, tri in enumerate(tris):
            edge = sorted((u, j) for j, (p, _) in enumerate(tri) if (u := along(p, a, b, beyond=True)) is not None)
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
    """Where the cut skin's outline is `t` of the way along the edge: between the corners either side
    of it (the skin is flat between them)."""
    ts = [u for u, _ in points]
    j = int(np.clip(np.searchsorted(ts, t, side="right") - 1, 0, len(points) - 2))
    (t0, p0), (t1, p1) = points[j], points[j + 1]
    f = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
    return p0 + (p1 - p0) * f


def ring_points(profile: list[tuple[float, float]], y: float, inset: float) -> list[np.ndarray]:
    """The lathe's vertices on the ring at height y, round in angle order."""
    r = radius_at(profile, y) - inset
    return [np.array([r * np.sin(a), y, r * np.cos(a)]) for a in 2 * np.pi * np.arange(SEGMENTS) / SEGMENTS]


def disc(ring: list[np.ndarray], centre: tuple[float, float, float], down: bool) -> list[Triangle]:
    """A fan over a ring, facing down (a ceiling) or up (a cap), in one colour."""
    c = np.array(centre, float)
    swatch = np.array([0.0, 0.0])
    tris = []
    for i in range(len(ring)):
        a, b = ring[i], ring[(i + 1) % len(ring)]
        tri = [(c, swatch), (a, swatch), (b, swatch)]
        if (np.cross(a - c, b - c)[1] < 0) != down:
            tri = [tri[0], tri[2], tri[1]]
        tris.append(tri)
    return tris


def build_door(profile: list[tuple[float, float]]) -> tuple[MeshBuilder, np.ndarray]:
    """The door: a flat slab the doorway's outline less CLEARANCE from the sill up, DOOR_THICKNESS
    thick, in the house's frame about its pin (the slab's left edge on the sill, on the face it
    swings toward); and that pin. The shell leans out as it rises, so the slab stands where it
    clears the outer skin at the sill's corners and the inner skin at the arch's top, midway between
    the two."""
    x0, x1 = -DOOR_WIDTH / 2 + CLEARANCE, DOOR_WIDTH / 2 - CLEARANCE
    top = DOOR_HEIGHT - CLEARANCE
    nearest_outer = float(np.sqrt(radius_at(profile, SILL) ** 2 - (DOOR_WIDTH / 2) ** 2))
    farthest_inner = radius_at(profile, DOOR_HEIGHT) - WALL
    room = nearest_outer - farthest_inner - DOOR_THICKNESS
    if room < 0.05:
        raise SystemExit(f"the door can't stand upright in the wall: {room:.2f} m to spare")
    face = nearest_outer - room / 2
    print(f"door: face {face:.3f} m out, {room / 2:.3f} m clear of either skin")
    hinge = np.array([x0, SILL, face])
    outline = arch(x0, x1, top, steps=12, bottom=SILL)
    pts = [np.array([x, y, 0.0]) for x, y in outline]
    uvs = [np.array([(x - x0) / (x1 - x0), DOOR_PLANKS * (top - y) / (top - SILL)]) for x, y in outline]
    centre = np.array([(x0 + x1) / 2, (SILL + top) / 2, 0.0])
    mesh = MeshBuilder()
    for z, out in ((face, 1.0), (face - DOOR_THICKNESS, -1.0)):
        shift = np.array([0, 0, z]) - hinge
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            tri = [
                (centre + shift, np.array([0.5, DOOR_PLANKS / 2])),
                (a + shift, uvs[i]),
                (b + shift, uvs[(i + 1) % len(pts)]),
            ]
            if np.cross(a - centre, b - centre)[2] * out < 0:
                tri = [tri[0], tri[2], tri[1]]
            mesh.add([tri])
    # The slab's edge all round, in the door's own wood (the planks' bottom edge).
    edge = np.array([0.5, DOOR_PLANKS - 0.01])
    axis = centre - hinge + np.array([0, 0, face - DOOR_THICKNESS / 2])
    for i in range(len(pts)):
        a, b = pts[i] + np.array([0, 0, face]) - hinge, pts[(i + 1) % len(pts)] + np.array([0, 0, face]) - hinge
        a2, b2 = a - np.array([0, 0, DOOR_THICKNESS]), b - np.array([0, 0, DOOR_THICKNESS])
        for tri in ([(a, edge), (b, edge), (b2, edge)], [(a, edge), (b2, edge), (a2, edge)]):
            p, q, r = (v for v, _ in tri)
            if np.cross(q - p, r - p) @ ((p + q + r) / 3 - axis) < 0:
                tri = [tri[0], tri[2], tri[1]]
            mesh.add([tri])
    # The hinge's knuckles: short iron drums round the pin, in the texture's iron swatch.
    iron = np.array([0.25, (DOOR_PLANKS + 1) / 2])
    radius, height = KNUCKLE
    for at in KNUCKLES:
        ring = [np.array([radius * np.cos(a), 0.0, radius * np.sin(a)]) for a in 2 * np.pi * np.arange(8) / 8]
        for i in range(8):
            lo_a, lo_b = ring[i] + [0, at - height / 2, 0], ring[(i + 1) % 8] + [0, at - height / 2, 0]
            hi_a, hi_b = lo_a + [0, height, 0], lo_b + [0, height, 0]
            mesh.add([[(lo_a, iron), (hi_b, iron), (lo_b, iron)], [(lo_a, iron), (hi_a, iron), (hi_b, iron)]])
            mesh.add([[(np.array([0, at + height / 2, 0.0]), iron), (hi_b, iron), (hi_a, iron)]])
            mesh.add([[(np.array([0, at - height / 2, 0.0]), iron), (lo_a, iron), (lo_b, iron)]])
    return mesh, hinge


class MeshBuilder:
    """Collects triangles, each corner with its texture coordinates, or by swatch name for a plain
    colour from the part's texture."""

    def __init__(self) -> None:
        self.tris: list[tuple[Triangle, str | None]] = []

    def add(self, tris: list[Triangle], swatch: str | None = None) -> None:
        self.tris += [(t, swatch) for t in tris]


def trim_texture(doc: dict, blob: bytes) -> tuple[Image.Image, dict[str, np.ndarray]]:
    """The model's texture at TRIM_TEXTURE, for the leaves, portholes and chimney, with the swatches
    painted into its empty right-hand strip; and each swatch's texture coordinates (its middle)."""
    image = next(
        doc["images"][
            doc["textures"][m["extensions"]["KHR_materials_pbrSpecularGlossiness"]["diffuseTexture"]["index"]]["source"]
        ]
        for m in doc["materials"]
        if m["name"] == "home"
    )
    view = doc["bufferViews"][image["bufferView"]]
    atlas = Image.open(io.BytesIO(blob[view["byteOffset"] : view["byteOffset"] + view["byteLength"]])).convert("RGB")
    atlas = atlas.resize((TRIM_TEXTURE, TRIM_TEXTURE), Image.Resampling.LANCZOS)
    swatch_uv: dict[str, np.ndarray] = {}
    for i, (name, colour) in enumerate(SWATCHES.items()):
        box = (TRIM_TEXTURE - 40, 8 + i * 40, TRIM_TEXTURE - 8, 40 + i * 40)
        atlas.paste(Image.new("RGB", (32, 32), colour), box[:2])
        swatch_uv[name] = np.array([(box[0] + box[2]) / 2 / TRIM_TEXTURE, (box[1] + box[3]) / 2 / TRIM_TEXTURE])
    return atlas, swatch_uv


def paint_pineapple(size: int = 64) -> Image.Image:
    """One repeat of the pineapple's skin: orange, scored in a lattice of dark diagonal grooves into
    diamonds, each with a lighter middle and a dark eye, in a few shades so it isn't flat."""
    rng = np.random.default_rng(2)
    img = Image.new("RGB", (size, size))
    px = img.load()
    cell = size // 2
    for x in range(size):
        for y in range(size):
            u, v = (x + y) % cell, (x - y) % cell
            groove = u < 3 or v < 3
            d = min(u, cell - u) + min(v, cell - v)  # how far into the diamond
            if groove:
                px[x, y] = (150, 78, 20)
            elif d > cell * 0.8:
                px[x, y] = (255, 208, 90)
            elif d > cell * 0.55:
                px[x, y] = (247, 176, 48) if rng.random() < 0.85 else (255, 196, 70)
            else:
                px[x, y] = (236, 150, 34) if rng.random() < 0.9 else (224, 136, 28)
    return img


def paint_stripes(size: int = 32) -> Image.Image:
    """One repeat of the room's paper: baby blue with two upright stripes of dark blue."""
    img = Image.new("RGB", (size, size), (166, 220, 247))
    px = img.load()
    for x in range(size):
        if x % (size // 2) < 3:
            for y in range(size):
                px[x, y] = (42, 92, 168)
    return img


def paint_planks(size: int = 32, planks: int = 4) -> Image.Image:
    """One repeat of the doorway's lining: upright planks of warm wood with dark seams between."""
    rng = np.random.default_rng(5)
    img = Image.new("RGB", (size, size))
    px = img.load()
    shades = [(150, 103, 52), (138, 94, 47), (160, 112, 60), (144, 98, 50)]
    width = size // planks
    for x in range(size):
        colour = shades[(x // width) % len(shades)]
        for y in range(size):
            seam = x % width == width - 1
            px[x, y] = (70, 45, 22) if seam else ((120, 80, 40) if rng.random() < 0.07 else colour)
    return img


DOOR_PLANKS = 0.9  # how much of the door texture, down from the top, is the door; under it, the iron swatch


def paint_door(w: int = 96, h: int = 160) -> Image.Image:
    """The door, both faces: upright planks of warm wood with dark seams, a porthole ringed in blue in
    the upper middle, and a blue brace across the bottom third; and a strip of iron under it for the
    hinge's knuckles."""
    rng = np.random.default_rng(4)
    img = Image.new("RGB", (w, h), (74, 74, 80))
    px = img.load()
    h = int(h * DOOR_PLANKS)
    shades = [(150, 103, 52), (138, 94, 47), (160, 112, 60), (144, 98, 50)]
    plank = w // 6
    for x in range(w):
        colour = shades[(x // plank) % len(shades)]
        for y in range(h):
            seam = x % plank == plank - 1
            px[x, y] = (70, 45, 22) if seam else ((120, 80, 40) if rng.random() < 0.07 else colour)
    brace = int(h * 0.68)
    for x in range(w):
        for y in range(brace, brace + h // 14):
            px[x, y] = (54, 76, 140) if (x // 3 + y // 3) % 7 else (38, 52, 100)
    cx, cy, r = w // 2, int(h * 0.3), int(w * 0.2)
    for x in range(w):
        for y in range(h):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d < r * 0.7:
                px[x, y] = (172, 206, 228) if (x + y) % 9 else (210, 232, 244)
            elif d < r:
                px[x, y] = (72, 96, 176) if int(d) != r - 1 else (54, 72, 140)
    return img


def emit_part(name: str, mesh: MeshBuilder, swatch_uv: dict[str, np.ndarray]) -> None:
    """One part's mesh as public/assets/models/pineapple-<name>.bin: vertex and triangle counts
    (Uint32), then positions in centimetres (Int16), texture coordinates (Uint16, 4096 to the
    repeat, v down the image), triangles (Uint16) and unit normals (Int8), normals last so nothing
    needs padding. A wrapped texture's coordinates are brought down by whole repeats a triangle at
    a time, so a lathe of any girth fits the format. Vertices at one spot share a normal whatever
    their coordinates."""
    positions, uvs, indices = [], [], []
    index: dict[tuple, int] = {}
    for tri, swatch in mesh.tris:
        corners = [(p, swatch_uv[swatch] if swatch else q) for p, q in tri]
        repeats = np.floor(np.min([q for _, q in corners], axis=0))
        for p, q in corners:
            uv = q - repeats
            key = (*np.round(p * 100).astype(int), *np.round(uv * 4096).astype(int))
            if key not in index:
                index[key] = len(positions)
                positions.append(p)
                uvs.append(uv)
            indices.append(index[key])
    pos = np.array(positions)
    idx = np.array(indices).reshape(-1, 3)
    if len(pos) > 65535:
        raise SystemExit(f"{name}: {len(pos)} vertices, too many for Uint16 triangles")
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
        raise SystemExit(f"{name}: a triangle spans {uv.max():.1f} repeats, too many for Uint16 coordinates")
    out = MODELS_OUT / f"pineapple-{name}.bin"
    out.write_bytes(
        np.array([len(pos), len(idx)], dtype="<u4").tobytes()
        + np.round(pos * 100).astype("<i2").tobytes()
        + np.round(uv * 4096).astype("<u2").tobytes()
        + idx.astype("<u2").tobytes()
        + np.round(normals * 127).astype("i1").tobytes()
    )
    print(f"wrote {out} ({len(pos)} vertices, {len(idx)} triangles, {out.stat().st_size} bytes)")


def emit_profile(profile: list[tuple[float, float]], hinge: np.ndarray) -> None:
    ys = sorted({*np.arange(0, profile[-1][0], PROFILE_STEP), CEILING, profile[-1][0]})
    rings = [(y, radius_at(profile, y)) for y in ys]
    lines = [
        "// Generated by packages/client/scripts/house-model.py; don't edit. The pineapple house's shape for",
        "// the sim (content/pineapple.ts), in metres in the house's frame (the door facing +z): the shell's",
        "// rings from the ground up (height, radius), the doorway cut in its front and the door that hangs",
        "// in it (its pin at the door's left edge, on the face it swings toward, how far above the ground the",
        "// sill it stands on is, how far the door reaches from the pin, how tall and thick it is), how far",
        "// above the ground the flat ceiling is, and the wall's thickness.",
        "export const PINEAPPLE_PROFILE = {",
        f"  rings: [{', '.join(f'[{y:.2f}, {r:.2f}]' for y, r in rings)}],",
        f"  doorway: {{ width: {DOOR_WIDTH}, height: {DOOR_HEIGHT} }},",
        "  door: {",
        f"    hinge: [{hinge[0]:.3f}, {hinge[2]:.3f}],",
        f"    sill: {SILL},",
        f"    reach: {DOOR_WIDTH - 2 * CLEARANCE:.2f},",
        f"    height: {DOOR_HEIGHT - CLEARANCE - SILL:.2f},",
        f"    thickness: {DOOR_THICKNESS},",
        "  },",
        f"  ceiling: {CEILING},",
        f"  wall: {WALL},",
        "} as const;",
        "",
    ]
    PROFILE_OUT.write_text("\n".join(lines))
    print(f"wrote {PROFILE_OUT}: {len(rings)} rings, {[(round(y, 1), round(r, 1)) for y, r in rings][:6]}...")


if __name__ == "__main__":
    main(sys.argv[1])
