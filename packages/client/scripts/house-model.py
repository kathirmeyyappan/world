"""Builds the pineapple house (SpongeBob's) for the world from penqin's Sketchfab model: the client's
meshes (public/assets/models/pineapple-<part>.bin, fetched by the loader) and textures, and the
sim's content/pineappleProfile.ts.

    python packages/client/scripts/house-model.py path/to/spongebobs_house.glb

The model is a single skin: the pineapple's shell (a coarse lathe, open at the ground and at the
crown), a door panel with its frame and wheel, three portholes in the wall, a chimney, the leaves,
and the rivets on all of those. From it this keeps the shell's outline (its rings' radii up the
height), the leaves, the portholes and the chimney, and builds the rest itself, in six parts:

- skin: the shell turned afresh as a smooth lathe through those rings, scaled so its belly is OUTER
  round like the keep it replaces, in a pineapple diamond pattern painted here and wrapped round,
  flattened into an upright face round the door (a door hangs true in a flat wall, and the shell
  leans out as it rises) that rounds back into the shell either side and above, with the doorway
  cut out of it;
- inside: the room, an upright cylinder WALL in from the shell's foot up to CEILING (the shell
  leans out above it, so the wall thickens as it rises), walled in the show's bamboo painted here,
  the doorway cut out of it the same way (the floor between its two storeys is the content's);
- ceiling: the flat ceiling over the top floor, in the show's rope net painted here;
- passage: the doorway through the wall, straight from the one cut to the other, and the frame
  round it on the face, cased in riveted steel painted here;
- trim: the leaves, portholes and chimney as the model has them (its texture, cut down), and the
  crown's cap;
- door: a flat slab the doorway's shape less a hair of clearance all round, the show's front door
  painted here on both faces, flush with the face about the pin at its left edge on the ground,
  for the sim to swing (content/pineapple.ts).

The profile the sim collides with (the shell's rings, the room's radius, the doorway and its door,
the flat face, the ceiling) comes from the same lathe.
"""

from __future__ import annotations

import io
import sys
from collections.abc import Callable
from itertools import pairwise
from pathlib import Path

import numpy as np
from glb import accessor, components, local_matrix, read_glb
from PIL import Image

OUTER = 20.0  # metres: the shell's radius at its widest, the keep's (content/keep.ts)
WALL = 2.0  # metres: how thick the shell is at its foot, where the room's wall stands
CEILING = 26.5  # metres above the shell's foot: the flat ceiling over the house's two storeys
DOOR_WIDTH = 2.8  # metres: the doorway, an arch
DOOR_HEIGHT = 4.0
DOOR_THICKNESS = 0.2
CLEARANCE = 0.02  # metres the door stands in from the doorway's edge all round
KNUCKLES = (0.6, 3.1)  # metres up the pin the two hinge knuckles sit
KNUCKLE = (0.05, 0.24)  # a knuckle's radius and height
FRAME = 0.25  # metres wide the frame round the doorway is
FRAME_PROUD = 0.03  # metres it stands off the face
ARCH_STEPS = 32  # straight pieces in the doorway's arch
FACE = 1.9  # metres either side of the door the shell is a flat upright face
FACE_BLEND = 3.4  # metres either side where that face has rounded back into the shell
FACE_TOP = 4.4  # metres up the face is flat
FACE_BLEND_TOP = 8.0  # metres up it has leaned back into the shell
SEGMENTS = 72  # round the lathe
FINE_SPAN = 16  # degrees either side of the door the lathe is turned a degree at a time, for the face
RING_STEP = 1.0  # metres between the lathe's rings
PROFILE_STEP = 3.0  # metres between the rings the sim gets
SKIN_TILE = 8.5  # metres of shell one repeat of the pineapple pattern (two diamonds) covers
BAMBOO_TILE = 6.0  # metres of wall one repeat of the bamboo (five poles) covers: players are small in this house
NET_TILE = 6.0  # metres of ceiling one repeat of the net (two meshes) covers
STEEL_TILE = 3.0  # metres of passage one repeat of the steel (two plates) covers
TRIM_TEXTURE = 512  # the model's texture is cut down to this for what's kept of it
ATLAS_PAD = 64  # pixels of blank strip added at that texture's right for the swatches
SWATCHES = {"crown": (138, 107, 42), "iron": (74, 74, 80)}
CLIENT = Path(__file__).resolve().parents[1]
MODELS_OUT = CLIENT / "public/assets/models"
TEXTURES_OUT = CLIENT / "public/assets/textures/models"
PROFILE_OUT = CLIENT.parent / "shared/src/content/pineappleProfile.ts"

Corner = tuple[np.ndarray, np.ndarray]  # position, texture coordinates
Triangle = list[Corner]
Outline = list[tuple[float, float]]
Profile = list[tuple[float, float]]  # (height, radius) up the shell


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
    # The model's door, its frame, wheel and rivets: not kept, only where they stood.
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
    room = room_radius(profile)
    print(
        f"shell: {len(rings)} rings in the model, {len(profile)} in the lathe; scale {s:.3f}; room {room:.2f} m round"
    )

    hole = arch(-DOOR_WIDTH / 2, DOOR_WIDTH / 2, DOOR_HEIGHT, ARCH_STEPS)
    front, rest = cut_hole(lathe(profile, SKIN_TILE, lambda a, y: surface(profile, a, y), lathe_angles()), hole)
    inner_rings = [(y, r) for y, r in profile if y <= CEILING + 1e-6]
    inner_front, inner_rest = cut_hole(
        lathe(inner_rings, BAMBOO_TILE, lambda a, y: np.array([room * np.sin(a), y, room * np.cos(a)])), hole
    )
    lining = passage(front, inner_front, hole)
    skin = MeshBuilder()
    skin.add(front + rest)
    inside = MeshBuilder()
    inside.add([list(reversed(tri)) for tri in inner_front + inner_rest])
    ceiling = MeshBuilder()
    ceiling.add(net_disc(room + 0.3))
    through = MeshBuilder()
    through.add(lining)
    through.add(frame_band(face_plane(profile) + FRAME_PROUD))
    trim = MeshBuilder()
    trim.add(disc(ring_points(profile, profile[-1][0]), (0, profile[-1][0], 0), down=False), "crown")
    atlas, swatch_uv, squeeze = trim_texture(doc, blob)
    for k in range(len(parts)):
        if k == shell or k in on_door:
            continue
        kept = [
            tri
            for tri in model_triangles(points, uv, tris[of == k], s, squeeze)
            if not any(within(p, room) for p, _ in tri)
        ]
        trim.add(kept)
    door_part, hinge = build_door(profile)

    atlas.quantize(256, dither=Image.Dither.FLOYDSTEINBERG).save(TEXTURES_OUT / "pineapple.png", optimize=True)
    paint_pineapple().save(TEXTURES_OUT / "pineapple-skin.png", optimize=True)
    paint_bamboo().save(TEXTURES_OUT / "bamboo.png", optimize=True)
    paint_net().save(TEXTURES_OUT / "net.png", optimize=True)
    paint_steel().save(TEXTURES_OUT / "steel.png", optimize=True)
    paint_door().save(TEXTURES_OUT / "door.png", optimize=True)
    MODELS_OUT.mkdir(parents=True, exist_ok=True)
    emit_part("skin", skin, {})
    emit_part("inside", inside, {})
    emit_part("ceiling", ceiling, {})
    emit_part("passage", through, {})
    emit_part("trim", trim, swatch_uv)
    emit_part("door", door_part, swatch_uv)
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


def lathe_rings(shell: np.ndarray) -> Profile:
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


def smooth_profile(rings: Profile) -> Profile:
    """The shell's outline every RING_STEP from the ground to the crown, a Catmull-Rom curve through
    the model's rings (so the pineapple swells and tapers smoothly rather than in facets), with the
    ground, the ceiling and the face's heights among its own."""
    ys, rs = (np.array(v) for v in zip(*rings))
    heights = sorted({*np.arange(0, ys[-1], RING_STEP), ys[-1], CEILING, FACE_TOP, FACE_BLEND_TOP})

    def at(y: float) -> float:
        i = int(np.clip(np.searchsorted(ys, y) - 1, 0, len(ys) - 2))
        t = (y - ys[i]) / (ys[i + 1] - ys[i])
        p0, p1, p2, p3 = (rs[max(i - 1, 0)], rs[i], rs[i + 1], rs[min(i + 2, len(rs) - 1)])
        return float(
            0.5
            * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t**3)
        )

    return [(float(y), at(float(y))) for y in heights]


def radius_at(profile: Profile, y: float) -> float:
    ys, rs = zip(*profile)
    return float(np.interp(y, ys, rs))


def room_radius(profile: Profile) -> float:
    """The room's wall: WALL in from the shell's foot, upright the whole way up."""
    return radius_at(profile, 0.0) - WALL


def within(p: np.ndarray, room: float) -> bool:
    """Whether a point is inside the room: under the ceiling, short of its wall. A trim triangle with
    any corner there (the back of a porthole's ring) would show on the room's wall."""
    return p[1] < CEILING and np.hypot(p[0], p[2]) < room - 0.01


def face_plane(profile: Profile) -> float:
    """How far out the flat face round the door stands: a chord of the shell's foot, FACE either side
    of the door, so it never stands proud of the ground's rim."""
    return float(np.sqrt(radius_at(profile, 0.0) ** 2 - FACE**2))


def fade(t: float, t0: float, t1: float) -> float:
    """1 up to t0, falling smoothly to 0 at t1."""
    u = float(np.clip((t - t0) / (t1 - t0), 0, 1))
    return 1 - u * u * (3 - 2 * u)


def surface(profile: Profile, a: float, y: float) -> np.ndarray:
    """A point of the outer skin: the lathe, but flattened into the upright face round the door, which
    rounds back into the shell FACE_BLEND either side of the door and FACE_BLEND_TOP up. The face
    is a chord of the foot: within it a point's radius is what puts it on the plane."""
    r = radius_at(profile, y)
    aside = abs((a + np.pi) % (2 * np.pi) - np.pi)  # the angle round from the door, either way
    if aside < np.pi / 3:
        w = fade(radius_at(profile, 0.0) * np.sin(aside), FACE, FACE_BLEND) * fade(y, FACE_TOP, FACE_BLEND_TOP)
        r -= w * (r - face_plane(profile) / np.cos(aside))
    return np.array([r * np.sin(a), y, r * np.cos(a)])


def lathe_angles() -> list[float]:
    """The lathe's angles round: SEGMENTS round the whole, and a degree apart within FINE_SPAN of
    the door (which faces angle 0), where the face is shaped. From 0 to a whole turn, both ends in."""
    whole = {2 * np.pi * k / SEGMENTS for k in range(SEGMENTS + 1)}
    fine = {np.radians(d) % (2 * np.pi) for d in range(-FINE_SPAN, FINE_SPAN + 1)}
    return sorted(whole | fine | {2 * np.pi})


def lathe(
    profile: Profile, tile: float, place: Callable[[float, float], np.ndarray], angles: list[float] | None = None
) -> list[Triangle]:
    """The profile's rings turned round the y axis, each point of the grid put where `place` says,
    as triangles with coordinates that wrap it in whole repeats of `tile` round and up. The seam
    column comes twice (at 0 and at the whole number of repeats), so no triangle spans the wrap."""
    angles = angles or [2 * np.pi * k / SEGMENTS for k in range(SEGMENTS + 1)]
    around = max(1, round(2 * np.pi * np.mean([np.hypot(*place(0.0, y)[[0, 2]]) for y, _ in profile]) / tile))
    grid = [[(place(a, y), np.array([around * a / (2 * np.pi), -y / tile])) for a in angles] for y, _ in profile]
    tris: list[Triangle] = []
    for row, above in pairwise(grid):
        for k in range(len(angles) - 1):
            a, b, c, d = row[k], row[k + 1], above[k + 1], above[k]
            tris.append(facing_out([a, b, c]))
            tris.append(facing_out([a, c, d]))
    return [t for t in tris if area(t) > 1e-9]


def facing_out(tri: Triangle) -> Triangle:
    """Wound to read outward from the y axis (the model's winding: a left-handed frame, where the
    cross product of an outward face points in)."""
    a, b, c = (p for p, _ in tri)
    radial = (a + b + c) / 3 * np.array([1, 0, 1])
    return tri if float(np.cross(b - a, c - a) @ radial) < 0 else [tri[0], tri[2], tri[1]]


def model_triangles(points: np.ndarray, uv: np.ndarray, tris: np.ndarray, s: float, squeeze: float) -> list[Triangle]:
    """The model's triangles at world scale, with its texture coordinates squeezed to the strip of
    the trim texture its image takes up."""
    return [[(points[i] * s, uv[i] * np.array([squeeze, 1.0])) for i in tri] for tri in tris]


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
    between. The steel runs along the edge and in from the face."""
    middle = np.array([0.0, max(y for _, y in hole) / 2, 0.0])
    strips: list[Triangle] = []
    along_wall = 0.0
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
                s0, s1 = (along_wall + t0 * length) / STEEL_TILE, (along_wall + t1 * length) / STEEL_TILE
                d0, d1 = float(np.linalg.norm(i0 - o0)) / STEEL_TILE, float(np.linalg.norm(i1 - o1)) / STEEL_TILE
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


def frame_band(z: float) -> list[Triangle]:
    """The frame round the doorway: a flat band FRAME wide along the arch and down both jambs, on the
    face at `z`, in the steel, a plate's middle across it and the plates along it."""
    inner = arch(-DOOR_WIDTH / 2, DOOR_WIDTH / 2, DOOR_HEIGHT, ARCH_STEPS, bottom=0.0)
    outer = arch(-DOOR_WIDTH / 2 - FRAME, DOOR_WIDTH / 2 + FRAME, DOOR_HEIGHT + FRAME, ARCH_STEPS, bottom=0.0)
    tris: list[Triangle] = []
    along_wall = 0.0
    for i in range(1, len(inner)):  # the pairs along the outline but the bottom, which is the ground
        j = (i + 1) % len(inner)
        length = float(np.hypot(inner[j][0] - inner[i][0], inner[j][1] - inner[i][1]))
        s0, s1 = along_wall / STEEL_TILE, (along_wall + length) / STEEL_TILE
        p0, p1, q0, q1 = (np.array([x, y, z]) for x, y in (inner[i], inner[j], outer[i], outer[j]))
        quad: list[Corner] = [
            (p0, np.array([0.25, s0])),
            (p1, np.array([0.25, s1])),
            (q1, np.array([0.25 + FRAME / STEEL_TILE, s1])),
            (q0, np.array([0.25 + FRAME / STEEL_TILE, s0])),
        ]
        for tri in ([quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]):
            if np.cross(tri[1][0] - tri[0][0], tri[2][0] - tri[0][0])[2] < 0:
                tri = [tri[0], tri[2], tri[1]]
            tris.append(tri)
        along_wall += length
    return tris


def ring_points(profile: Profile, y: float) -> list[np.ndarray]:
    """The lathe's vertices on the ring at height y, round in angle order."""
    r = radius_at(profile, y)
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


def net_disc(r: float) -> list[Triangle]:
    """The ceiling: a fan over a ring of radius r at CEILING, facing down, in NET_TILE repeats of the
    net across the floor's axes."""
    ring = [np.array([r * np.sin(a), CEILING, r * np.cos(a)]) for a in 2 * np.pi * np.arange(SEGMENTS) / SEGMENTS]
    c = np.array([0.0, CEILING, 0.0])
    flat = lambda p: np.array([p[0] / NET_TILE, p[2] / NET_TILE])
    tris = []
    for i in range(len(ring)):
        a, b = ring[i], ring[(i + 1) % len(ring)]
        tri = [(c, flat(c)), (a, flat(a)), (b, flat(b))]
        if np.cross(a - c, b - c)[1] >= 0:
            tri = [tri[0], tri[2], tri[1]]
        tris.append(tri)
    return tris


def build_door(profile: Profile) -> tuple[MeshBuilder, np.ndarray]:
    """The door: a flat slab the doorway's outline less CLEARANCE from the ground up, DOOR_THICKNESS
    thick, its face flush with the flat face of the shell, in the house's frame about its pin (the
    slab's left edge on the ground, on the face it swings toward); and that pin."""
    x0, x1 = -DOOR_WIDTH / 2 + CLEARANCE, DOOR_WIDTH / 2 - CLEARANCE
    top = DOOR_HEIGHT - CLEARANCE
    face = face_plane(profile)
    hinge = np.array([x0, 0.0, face])
    outline = arch(x0, x1, top, ARCH_STEPS, bottom=0.0)
    pts = [np.array([x, y, 0.0]) for x, y in outline]
    uvs = [np.array([(x - x0) / (x1 - x0), DOOR_PLANKS * (top - y) / top]) for x, y in outline]
    centre = np.array([(x0 + x1) / 2, top / 2, 0.0])
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
    # The slab's edge all round, and the hinge's knuckles, short drums round the pin: iron.
    axis = centre - hinge + np.array([0, 0, face - DOOR_THICKNESS / 2])
    edge: list[Triangle] = []
    for i in range(len(pts)):
        a, b = pts[i] + np.array([0, 0, face]) - hinge, pts[(i + 1) % len(pts)] + np.array([0, 0, face]) - hinge
        a2, b2 = a - np.array([0, 0, DOOR_THICKNESS]), b - np.array([0, 0, DOOR_THICKNESS])
        for tri in ([a, b, b2], [a, b2, a2]):
            p, q, r = tri
            if np.cross(q - p, r - p) @ ((p + q + r) / 3 - axis) < 0:
                tri = [tri[0], tri[2], tri[1]]
            edge.append([(v, np.array([0.0, 0.0])) for v in tri])
    radius, height = KNUCKLE
    for at in KNUCKLES:
        ring = [np.array([radius * np.cos(a), 0.0, radius * np.sin(a)]) for a in 2 * np.pi * np.arange(8) / 8]
        for i in range(8):
            lo_a, lo_b = ring[i] + [0, at - height / 2, 0], ring[(i + 1) % 8] + [0, at - height / 2, 0]
            hi_a, hi_b = lo_a + [0, height, 0], lo_b + [0, height, 0]
            for tri in (
                [lo_a, hi_b, lo_b],
                [lo_a, hi_a, hi_b],
                [np.array([0, at + height / 2, 0.0]), hi_b, hi_a],
                [np.array([0, at - height / 2, 0.0]), lo_a, lo_b],
            ):
                edge.append([(v, np.array([0.0, 0.0])) for v in tri])
    mesh.add(edge, "iron")
    return mesh, hinge


class MeshBuilder:
    """Collects triangles, each corner with its texture coordinates, or by swatch name for a plain
    colour from the part's texture."""

    def __init__(self) -> None:
        self.tris: list[tuple[Triangle, str | None]] = []

    def add(self, tris: list[Triangle], swatch: str | None = None) -> None:
        self.tris += [(t, swatch) for t in tris]


def trim_texture(doc: dict, blob: bytes) -> tuple[Image.Image, dict[str, np.ndarray], float]:
    """The model's texture at TRIM_TEXTURE, for the leaves, portholes and chimney, with a blank strip
    ATLAS_PAD wide added at its right and the swatches painted down it; each swatch's texture
    coordinates (its middle); and how much the model's own coordinates squeeze by across."""
    image = next(
        doc["images"][
            doc["textures"][m["extensions"]["KHR_materials_pbrSpecularGlossiness"]["diffuseTexture"]["index"]]["source"]
        ]
        for m in doc["materials"]
        if m["name"] == "home"
    )
    view = doc["bufferViews"][image["bufferView"]]
    model = Image.open(io.BytesIO(blob[view["byteOffset"] : view["byteOffset"] + view["byteLength"]])).convert("RGB")
    atlas = Image.new("RGB", (TRIM_TEXTURE + ATLAS_PAD, TRIM_TEXTURE))
    atlas.paste(model.resize((TRIM_TEXTURE, TRIM_TEXTURE), Image.Resampling.LANCZOS), (0, 0))
    swatch_uv: dict[str, np.ndarray] = {}
    for i, (name, colour) in enumerate(SWATCHES.items()):
        box = (TRIM_TEXTURE + 16, 8 + i * 40, TRIM_TEXTURE + 48, 40 + i * 40)
        atlas.paste(Image.new("RGB", (32, 32), colour), box[:2])
        swatch_uv[name] = np.array([(box[0] + box[2]) / 2 / atlas.width, (box[1] + box[3]) / 2 / atlas.height])
    return atlas, swatch_uv, TRIM_TEXTURE / atlas.width


def paint_pineapple(size: int = 128, groove: int = 6) -> Image.Image:
    """One repeat of the pineapple's skin: orange, scored in a lattice of dark diagonal grooves into
    diamonds, each with a lighter middle and a dark eye, in a few shades so it isn't flat."""
    rng = np.random.default_rng(2)
    img = Image.new("RGB", (size, size))
    px = img.load()
    cell = size // 2
    for x in range(size):
        for y in range(size):
            u, v = (x + y) % cell, (x - y) % cell
            scored = u < groove or v < groove
            d = min(u, cell - u) + min(v, cell - v)  # how far into the diamond
            if scored:
                px[x, y] = (150, 78, 20)
            elif d > cell * 0.8:
                px[x, y] = (255, 208, 90)
            elif d > cell * 0.55:
                px[x, y] = (247, 176, 48) if rng.random() < 0.85 else (255, 196, 70)
            else:
                px[x, y] = (236, 150, 34) if rng.random() < 0.9 else (224, 136, 28)
    return img


def paint_bamboo(size: int = 192) -> Image.Image:
    """One repeat of the room's wall, the show's living room: upright bamboo poles in sky blue, of a
    few widths, each shaded down one side and lit down the other with a dark seam between, and a
    knuckle or two across each (a dark line under a bright lip)."""
    rng = np.random.default_rng(6)
    img = Image.new("RGB", (size, size))
    px = img.load()
    seam, shade, fill, bright = (40, 136, 184), (66, 166, 206), (96, 196, 226), (176, 232, 244)
    x = 0
    for w in (32, 44, 28, 40, 48):  # together the tile's width, so the poles wrap
        knuckles = {int(k) for k in rng.integers(6, size - 6, 2)}
        for i in range(w):
            for y in range(size):
                if i < 2:
                    c = seam
                elif y in knuckles or y - 1 in knuckles:
                    c = shade
                elif y + 1 in knuckles or y + 2 in knuckles:
                    c = bright
                elif i < 6:
                    c = shade
                elif w - 8 <= i < w - 2:
                    c = bright
                else:
                    c = fill if rng.random() < 0.9 else (88, 188, 220)
                px[x + i, y] = c
        x += w
    return img


def paint_net(size: int = 192, rope: int = 5) -> Image.Image:
    """One repeat of the ceiling, the show's: a rope net, two meshes to the repeat, over tan."""
    rng = np.random.default_rng(7)
    img = Image.new("RGB", (size, size))
    px = img.load()
    cell = size // 2
    for x in range(size):
        for y in range(size):
            u, v = (x + y) % cell, (x - y) % cell
            if u < rope or v < rope:
                px[x, y] = (122, 80, 42) if rng.random() < 0.8 else (104, 66, 34)
            else:
                px[x, y] = (206, 152, 90) if rng.random() < 0.9 else (194, 140, 80)
    return img


def paint_steel(size: int = 192) -> Image.Image:
    """One repeat of the passage's casing: steel plates, two by two to the repeat, each a shade of
    its own, with dark seams between and a rivet every so often along every seam."""
    rng = np.random.default_rng(8)
    img = Image.new("RGB", (size, size))
    px = img.load()
    plate = size // 2
    seam = 5
    shades = [(134, 146, 166), (128, 140, 160), (140, 152, 172), (131, 143, 163)]
    for x in range(size):
        for y in range(size):
            c = shades[(x // plate + 2 * (y // plate)) % 4]
            if rng.random() < 0.06:
                c = (c[0] - 8, c[1] - 8, c[2] - 8)
            if x % plate < seam or y % plate < seam:
                c = (78, 88, 108)
            px[x, y] = c
    for k in range(0, size, size // 8):  # rivets along the seams, a plate's eighth apart
        for cx, cy in (
            (k + seam // 2 + 2, seam // 2 + 2),
            (seam // 2 + 2, k + seam // 2 + 2),
            (k + seam // 2 + 2, plate + seam // 2 + 2),
            (plate + seam // 2 + 2, k + seam // 2 + 2),
        ):
            for x in range(cx - 4, cx + 5):
                for y in range(cy - 4, cy + 5):
                    d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                    if d <= 4 and 0 <= x < size and 0 <= y < size:
                        px[x, y] = (
                            (196, 206, 222)
                            if d <= 2 and x <= cx and y <= cy
                            else ((70, 78, 96) if d > 3 else (156, 166, 184))
                        )
    return img


DOOR_PLANKS = 0.9  # how much of the door texture, down from the top, is the door; under it, the iron swatch


def paint_door(w: int = 96, h: int = 160) -> Image.Image:
    """The door, both faces, the show's front door: upright boards of steel blue with darker seams, a
    porthole in the upper middle with a pale rim and four rivets, and a darker band across the
    bottom third with two bolts; and a strip of iron under it for the hinge's knuckles."""
    rng = np.random.default_rng(4)
    img = Image.new("RGB", (w, h), (74, 74, 80))
    px = img.load()
    h = int(h * DOOR_PLANKS)
    plank = w // 4
    for x in range(w):
        for y in range(h):
            seam = x % plank >= plank - 2
            px[x, y] = (104, 124, 156) if seam else ((150, 170, 200) if rng.random() < 0.08 else (166, 186, 212))
    band = int(h * 0.68)
    for x in range(w):
        for y in range(band, band + h // 11):
            px[x, y] = (190, 206, 228) if y == band else (118, 138, 172)
    for bx in (w // 4, 3 * w // 4):
        for x in range(bx - 2, bx + 2):
            for y in range(band + h // 22 - 2, band + h // 22 + 2):
                px[x, y] = (214, 224, 238)
    cx, cy, r = w // 2, int(h * 0.3), int(w * 0.2)
    for x in range(w):
        for y in range(h):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d < r * 0.62:
                px[x, y] = (210, 234, 246) if (x + y) % 11 else (236, 246, 252)
            elif d < r * 0.72:
                px[x, y] = (84, 100, 132)
            elif d < r:
                px[x, y] = (196, 208, 228) if d < r - 1.5 else (84, 100, 132)
    for a in (0.785, 2.356, 3.927, 5.498):
        rx, ry = int(cx + r * 0.86 * np.cos(a)), int(cy + r * 0.86 * np.sin(a))
        for x in range(rx - 1, rx + 2):
            for y in range(ry - 1, ry + 2):
                px[x, y] = (84, 100, 132)
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


def emit_profile(profile: Profile, hinge: np.ndarray) -> None:
    ys = sorted({*np.arange(0, profile[-1][0], PROFILE_STEP), CEILING, profile[-1][0]})
    rings = [(y, radius_at(profile, y)) for y in ys]
    lines = [
        "// Generated by packages/client/scripts/house-model.py; don't edit. The pineapple house's shape for",
        "// the sim (content/pineapple.ts), in metres in the house's frame (the door facing +z): the shell's",
        "// rings from the ground up (height, radius), the room's radius (its wall stands upright inside the",
        "// shell), the doorway cut in its front and the door that hangs in it (its pin on the ground at the",
        "// door's left edge, on the face it swings toward, how far the door reaches from the pin, how tall",
        "// and thick it is), the flat upright face the door stands in (how far it reaches either side of the",
        "// door and up, and how far out from the axis it stands), and how far above the ground the flat",
        "// ceiling is.",
        "export const PINEAPPLE_PROFILE = {",
        f"  rings: [{', '.join(f'[{y:.2f}, {r:.2f}]' for y, r in rings)}],",
        f"  room: {room_radius(profile):.3f},",
        f"  doorway: {{ width: {DOOR_WIDTH}, height: {DOOR_HEIGHT} }},",
        "  door: {",
        f"    hinge: [{hinge[0]:.3f}, {hinge[2]:.3f}],",
        f"    reach: {DOOR_WIDTH - 2 * CLEARANCE:.2f},",
        f"    height: {DOOR_HEIGHT - CLEARANCE:.2f},",
        f"    thickness: {DOOR_THICKNESS},",
        "  },",
        f"  face: {{ halfWidth: {FACE_BLEND}, top: {FACE_BLEND_TOP}, z: {face_plane(profile):.3f} }},",
        f"  ceiling: {CEILING},",
        "} as const;",
        "",
    ]
    PROFILE_OUT.write_text("\n".join(lines))
    print(f"wrote {PROFILE_OUT}: {len(rings)} rings, {[(round(y, 1), round(r, 1)) for y, r in rings][:6]}...")


if __name__ == "__main__":
    main(sys.argv[1])
