"""Builds the pineapple house (SpongeBob's) for the world from two Sketchfab models: penqin's
house for the outside, and the Sbfbb SpongeBob House (cherylhill28) for the rooms inside
(house_interior.py). Writes the client's meshes (public/assets/models/pineapple-<part>.bin, fetched
by the loader), their textures, the parts list (render/models/pineappleParts.ts) and what the sim
collides with (content/pineappleProfile.ts and content/pineappleInterior.ts).

    python packages/client/scripts/house-model.py path/to/spongebobs_house.glb path/to/sbfbb_house.glb

The outside model is a single skin: the pineapple's shell (a coarse lathe, open at the ground and
at the crown), a door panel with its frame and wheel, three portholes in the wall, a chimney, the
leaves, the rivets on all of those, and round it a stone path and flowers on a mound. From it this
keeps the shell's outline (its rings' radii up the height), the leaves, the chimney and the
portholes, and the path and flowers, and builds the rest itself:

- skin: the shell turned afresh as a smooth lathe through those rings, scaled so its belly is OUTER
  round like the keep it replaces, in a pineapple diamond pattern painted here and wrapped round,
  flattened into an upright face round the door (a door hangs true in a flat wall, and the shell
  leans out as it rises) that rounds back into the shell either side and above, with the doorway
  cut out of it;
- passage: the vestibule inside the doorway, cased in riveted steel painted here: its sides run
  straight back from the skin to a steel wall standing just outside the rooms' front wall, with the
  rooms' own door frame set in it (the way in); and the frame round the doorway on the face;
- trim: the leaves, the chimney, the portholes (their tubes cut off inside the shell's wall, their
  glass painted with its sheen) and the crown's cap;
- door: a flat slab the doorway's shape less a hair of clearance all round, the show's front door
  painted here on both faces, flush with the face about the pin at its left edge on the ground,
  for the sim to swing (content/pineapple.ts);
- garden: the path from the door down the dune and the flowers round it, laid on the dune;
- interior and door-<name>: the rooms and their doors (house_interior.py).

The profile the sim collides with (the shell's rings, the doorway and its door, the flat face, the
openings through the shell, the dune, the rooms' levels, stairs and doors) comes from the same
lathe and the same rooms; the boxes the rooms are cut into go to content/pineappleInterior.ts.
"""

from __future__ import annotations

import io
import subprocess
import sys
from pathlib import Path

import house_interior as inside
import numpy as np
from glb import accessor, components, local_matrix, read_glb
from house_mesh import (
    MeshBuilder,
    Outline,
    Profile,
    Triangle,
    arch,
    clip_at,
    cut_out,
    disc,
    emit_part,
    fan,
    lathe,
    lining,
)
from PIL import Image

OUTER = 20.0  # metres: the shell's radius at its widest, the keep's (content/keep.ts)
DOOR_WIDTH = 4.0  # metres: the doorway, an arch
DOOR_HEIGHT = 6.0
DOOR_THICKNESS = 0.3
CLEARANCE = 0.02  # metres the door stands in from the doorway's edge all round
KNUCKLES = (0.9, 4.7)  # metres up the pin the two hinge knuckles sit
KNUCKLE = (0.08, 0.36)  # a knuckle's radius and height
FRAME = 0.4  # metres wide the frame round the doorway is
FRAME_PROUD = 0.04  # metres it stands off the face
ARCH_STEPS = 32  # straight pieces in the doorway's arch
FACE = 2.7  # metres either side of the door the shell is a flat upright face
FACE_BLEND = 4.6  # metres either side where that face has rounded back into the shell
FACE_TOP = 6.6  # metres up the face is flat
FACE_BLEND_TOP = 10.5  # metres up it has leaned back into the shell
SEGMENTS = 72  # round the lathe
FINE_SPAN = 24  # degrees either side of the door the lathe is turned a degree at a time, for the face
RING_STEP = 1.0  # metres between the lathe's rings
PROFILE_STEP = 3.0  # metres between the rings the sim gets
SKIN_TILE = 8.5  # metres of shell one repeat of the pineapple pattern (two diamonds) covers
STEEL_TILE = 3.0  # metres of passage one repeat of the steel (two plates) covers
PORTHOLE_STUB = 0.3  # metres inside the skin a porthole's tube is cut off: within the shell's wall
GLASS_RADIUS = 3.2  # metres from a porthole's axis its glass reaches, which tells the panes from the ring's rims
GLASS = 56  # pixels across the glass painted in the trim texture's strip
TRIM_TEXTURE = 512  # the model's texture is cut down to this for what's kept of it
GARDEN_TEXTURES = (512, 256)  # the flowers' and the path's textures, cut down to these
ATLAS_PAD = 64  # pixels of blank strip added at the trim texture's right for the swatches
SWATCHES = {"crown": (138, 107, 42), "iron": (74, 74, 80)}
PATH_SCALE = 0.6  # the model's path, which ran on past the grounds, shrunk about the door's foot to fit the dune
DUNE_HEIGHT = 3.0  # metres the dune's flat top, and the house's floor, stand above the floor
DUNE_FOOT = 30.0  # where the dune meets the floor: the grounds' radius (sim/outline.ts BUILDING_GROUNDS)
DUNE_BULGES = 5  # soft mounds round the slope
BULGE = 0.5  # metres they rise and fall by
CLIENT = Path(__file__).resolve().parents[1]
MODELS_OUT = CLIENT / "public/assets/models"
TEXTURES_OUT = CLIENT / "public/assets/textures/models"
PARTS_OUT = CLIENT / "src/render/models/pineappleParts.ts"
PROFILE_OUT = CLIENT.parent / "shared/src/content/pineappleProfile.ts"
BOXES_OUT = CLIENT.parent / "shared/src/content/pineappleInterior.ts"

flat_xy = lambda p: p[[0, 1]]


def main(outside: str, rooms: str) -> None:
    doc, blob = read_glb(Path(outside).read_bytes())
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
    on_door = {
        k
        for k in range(len(parts))
        if k != shell and bounds[k][0][2] > 0.8 and bounds[k][0][0] >= dx0 - 0.02 and bounds[k][1][0] <= dx1 + 0.02
    }

    rings = lathe_rings(points[parts[shell]])
    s = OUTER / max(r for _, r in rings)
    profile = smooth_profile([(y * s, r * s) for y, r in rings])
    print(f"shell: {len(rings)} rings in the model, {len(profile)} in the lathe; scale {s:.3f}")
    atlas, swatch_uv, squeeze, glass = trim_texture(doc, blob)
    portholes = {k for k in range(len(parts)) if k not in on_door and k != shell and is_porthole(points[parts[k]] * s)}
    # Each porthole's glass and rivets: the pieces about it no bigger than its ring.
    fittings = {
        k: [
            c
            for c in range(len(parts))
            if c not in on_door and c != shell and c != k and on_porthole(points[parts[c]] * s, points[parts[k]] * s)
        ]
        for k in portholes
    }

    interior = inside.load(rooms)
    inside.build_floors(
        interior,
        lambda a, y: float(np.hypot(*surface(profile, a, y)[[0, 2]])),
        lathe_angles(),
        [y for y, _ in profile],
    )

    # The skin, with the doorway cut out of it, and the vestibule behind.
    skin_tris = lathe(profile, SKIN_TILE, lambda a, y: surface(profile, a, y), lathe_angles())
    hole = arch(-DOOR_WIDTH / 2, DOOR_WIDTH / 2, DOOR_HEIGHT, ARCH_STEPS)
    cut, rest = cut_hole(skin_tris, hole)
    through = MeshBuilder()
    lift = lambda a, z: np.array([a[0], a[1], z])
    through.add(lining(cut, interior.front_z, hole, STEEL_TILE, flat_xy, lift))
    skin_tris = cut + rest
    through.add(
        back_wall(
            arch(-DOOR_WIDTH / 2, DOOR_WIDTH / 2, DOOR_HEIGHT, ARCH_STEPS, bottom=0.0), interior.front_z, interior.front
        )
    )
    through.add(frame_band(face_plane(profile) + FRAME_PROUD))
    skin = MeshBuilder()
    skin.add(skin_tris)
    # The trim: the crown's cap, the leaves and chimney as the model has them, and its portholes sunk.
    trim = MeshBuilder()
    trim.add(
        disc(ring_points(profile, profile[-1][0]), np.array([0, profile[-1][0], 0.0]), False, lambda p: np.zeros(2)),
        "crown",
    )
    fitted = {c for cs in fittings.values() for c in cs}
    for k in range(len(parts)):
        if k == shell or k in on_door or k in portholes or k in fitted:
            continue
        trim.add(model_triangles(points, uv, tris[of == k], s, squeeze))
    for k, cs in fittings.items():
        trim.add(porthole(points, uv, tris, of, parts, [k, *cs], s, squeeze, profile, glass))
    door_part, front_door = build_door(profile)
    garden, garden_atlas = build_garden(doc, blob, s, dune_top(profile))

    atlas.quantize(256, dither=Image.Dither.FLOYDSTEINBERG).save(TEXTURES_OUT / "pineapple.png", optimize=True)
    garden_atlas.save(TEXTURES_OUT / "pineapple-garden.png", optimize=True)
    paint_pineapple().save(TEXTURES_OUT / "pineapple-skin.png", optimize=True)
    paint_steel().save(TEXTURES_OUT / "steel.png", optimize=True)
    paint_door().save(TEXTURES_OUT / "door.png", optimize=True)
    rooms_atlas, places = inside.pack_atlas(interior)
    rooms_atlas.save(TEXTURES_OUT / "pineapple-interior.png", optimize=True)
    MODELS_OUT.mkdir(parents=True, exist_ok=True)
    for old in MODELS_OUT.glob("pineapple-*.bin"):
        old.unlink()
    for old in ("bamboo.png", "net.png"):
        (TEXTURES_OUT / old).unlink(missing_ok=True)
    emit_part(MODELS_OUT / "pineapple-skin.bin", skin, {})
    emit_part(MODELS_OUT / "pineapple-passage.bin", through, {})
    emit_part(MODELS_OUT / "pineapple-trim.bin", trim, swatch_uv)
    emit_part(MODELS_OUT / "pineapple-door-front.bin", door_part, swatch_uv)
    emit_part(MODELS_OUT / "pineapple-garden.bin", garden, {})
    rooms = MeshBuilder()
    rooms.add(inside.in_atlas(interior.tris, places))
    emit_part(MODELS_OUT / "pineapple-interior.bin", rooms, {})
    doors_material = inside.material(interior, "Doors")
    for d in interior.doors:
        panel = MeshBuilder()
        panel.add(inside.in_atlas([(t, doors_material) for t in d.mesh], places))
        emit_part(MODELS_OUT / f"pineapple-door-{d.id}.bin", panel, {})
    boxes = inside.voxel_boxes(interior.solid + [t for t, _ in through.tris])
    emit_parts_list(interior.doors)
    emit_profile(profile, [front_door, *interior.doors], interior)
    emit_boxes(boxes)
    subprocess.run(
        ["npx", "prettier", "--write", str(PARTS_OUT), str(PROFILE_OUT), str(BOXES_OUT)],
        check=True,
        cwd=CLIENT.parent.parent,
    )


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
                "material": prim["material"],
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
    ground and the face's heights among its own."""
    ys, rs = (np.array(v) for v in zip(*rings))
    heights = sorted({*np.arange(0, ys[-1], RING_STEP), ys[-1], FACE_TOP, FACE_BLEND_TOP})

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


def model_triangles(points: np.ndarray, uv: np.ndarray, tris: np.ndarray, s: float, squeeze: float) -> list[Triangle]:
    """The model's triangles at world scale, with its texture coordinates squeezed to the strip of
    the trim texture its image takes up."""
    return [[(points[i] * s, uv[i] * np.array([squeeze, 1.0])) for i in tri] for tri in tris]


def cut_hole(tris: list[Triangle], hole: Outline, floor: bool = True) -> tuple[list[Triangle], list[Triangle]]:
    """An opening cut out of the skin's front (its triangles on the +z side near the opening), in
    the wall's (x, y) plane; `floor` for an opening running out the bottom of the shell."""
    top = max(y for _, y in hole)
    bottom = min(y for _, y in hole)
    x0, x1 = min(x for x, _ in hole), max(x for x, _ in hole)
    near = lambda tri: (
        all(p[2] > 0 for p, _ in tri)
        and not all(p[1] > top + 0.5 for p, _ in tri)
        and (floor or not all(p[1] < bottom - 0.5 for p, _ in tri))
        and not all(p[0] > x1 + 3 for p, _ in tri)
        and not all(p[0] < x0 - 3 for p, _ in tri)
    )
    return cut_out(tris, hole, flat_xy, near)


def back_wall(outline: Outline, z: float, frame: Outline) -> list[Triangle]:
    """The vestibule's back wall: the doorway's arch filled at depth `z`, facing out, in the steel,
    with the rooms' door frame's outline cut out of it so the frame stands in the hole."""
    tris = fan([(np.array([x, y, z]), np.array([x / STEEL_TILE, -y / STEEL_TILE])) for x, y in outline])
    tris = [
        tri if np.cross(tri[1][0] - tri[0][0], tri[2][0] - tri[0][0])[2] > 0 else [tri[0], tri[2], tri[1]]
        for tri in tris
    ]
    cut, rest = cut_out(tris, frame, flat_xy, lambda tri: True)
    return cut + rest


def is_porthole(pts: np.ndarray) -> bool:
    """Whether a piece of the outside model is one of its portholes: a hollow ring 5 to 12 m across
    low on the wall."""
    size = pts.max(axis=0) - pts.min(axis=0)
    if not (5 < size.max() < 12 and pts[:, 1].max() < 50):
        return False
    c = pts.mean(axis=0)
    axis = np.array([c[0], 0, c[2]])
    axis /= np.linalg.norm(axis)
    rel = pts - c
    perp = np.linalg.norm(rel - np.outer(rel @ axis, axis), axis=1)
    return bool(perp.min() > 1)


def on_porthole(pts: np.ndarray, ring: np.ndarray) -> bool:
    """Whether a piece is part of a porthole whose ring this is: its glass or a rivet, about the
    ring's middle and no bigger than it."""
    size = (pts.max(axis=0) - pts.min(axis=0)).max()
    return (
        size <= (ring.max(axis=0) - ring.min(axis=0)).max() and np.linalg.norm(pts.mean(axis=0) - ring.mean(axis=0)) < 7
    )


def porthole(
    points: np.ndarray,
    uv: np.ndarray,
    tris: np.ndarray,
    of: np.ndarray,
    parts: list[np.ndarray],
    pieces: list[int],
    s: float,
    squeeze: float,
    profile: Profile,
    glass: tuple[float, float, float, float],
) -> list[Triangle]:
    """One of the outside model's portholes (its ring first, with its glass, then its rivets) where
    the model has it, less the back of its tube, cut off PORTHOLE_STUB inside the skin, following
    it: the tube runs metres in, and a stub within the shell's wall shows nowhere, while one
    through it would stand into a room. The glass (the ring's flat panes about its axis) is
    painted afresh with its sheen, the pane's own texture coordinates across the `glass` box of
    the trim texture."""
    c = points[parts[pieces[0]]].mean(axis=0) * s
    axis = np.array([c[0], 0, c[2]])
    axis /= np.linalg.norm(axis)
    # How far inside the skin a point is.
    depth = lambda p: float(
        np.hypot(*surface(profile, float(np.arctan2(p[0], p[2])), p[1])[[0, 2]]) - np.hypot(p[0], p[2])
    )
    up = np.array([0.0, 1.0, 0.0])
    right = np.cross(axis, up)  # to the right as seen from outside
    radius = lambda p: float(np.linalg.norm((p - c) - ((p - c) @ axis) * axis))

    def is_pane(tri: Triangle) -> bool:
        a, b, d = (p for p, _ in tri)
        n = np.cross(b - a, d - a)
        return abs(float(n @ axis)) > 0.9 * float(np.linalg.norm(n)) and max(radius(p) for p, _ in tri) < GLASS_RADIUS

    ring = model_triangles(points, uv, tris[of == pieces[0]], s, squeeze)
    panes = [tri for tri in ring if is_pane(tri)]
    rim = max(radius(p) for tri in panes for p, _ in tri) * 1.02
    u0, v0, u1, v1 = glass
    on_glass = lambda p: np.array(
        [
            u0 + (u1 - u0) * (0.5 + float((p - c) @ right) / (2 * rim)),
            v0 + (v1 - v0) * (0.5 - float((p - c) @ up) / (2 * rim)),
        ]
    )
    kept: list[Triangle] = [[(p, on_glass(p)) for p, _ in tri] for tri in panes]
    rest = [tri for tri in ring if not is_pane(tri)]
    for piece in pieces[1:]:
        rest += model_triangles(points, uv, tris[of == piece], s, squeeze)
    for tri in rest:
        kept += fan(clip_at(tri, depth, PORTHOLE_STUB))
    return kept


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
        quad = [
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


def build_door(profile: Profile) -> tuple[MeshBuilder, inside.Door]:
    """The door: a flat slab the doorway's outline less CLEARANCE from the ground up, DOOR_THICKNESS
    thick, its face flush with the flat face of the shell, in the house's frame about its pin (the
    slab's left edge on the ground, on the face it swings toward); and the door for the sim, which
    swings it outward, square to the doorway, to stand at its side."""
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
    door = inside.Door("front", (float(x0), float(face)), 0.0, 0.0, x1 - x0, top, DOOR_THICKNESS, np.pi / 2, [])
    return mesh, door


def dune_top(profile: Profile) -> float:
    """Radius of the dune's flat top: just past the shell's foot."""
    return radius_at(profile, 0.0) + 1


def dune(lx: float, lz: float, top: float) -> float:
    """The dune's height under a point of the house's frame, over the house's floor: flat on top
    (`top` out), down to the grounds' floor by their edge, never steeper than a walk, bulging a
    little round the slope. The same hill as content/pineapple.ts builds from the profile's `dune`."""
    out = float(np.hypot(lx, lz))
    t = float(np.clip((DUNE_FOOT - out) / (DUNE_FOOT - top), 0, 1))
    slope = t * t * (3 - 2 * t)
    bulge = float(np.sin(DUNE_BULGES * np.arctan2(lz, lx)) * np.sin(np.pi * t))
    return (DUNE_HEIGHT + 0.05) * slope + BULGE * bulge - 0.05 - DUNE_HEIGHT


def build_garden(doc: dict, blob: bytes, s: float, top: float) -> tuple[MeshBuilder, Image.Image]:
    """The model's flowers as they stand round the house, and its stone path from the door, shrunk
    about the door's foot to end on the dune, both laid on the dune; and their two textures side by
    side in one image."""
    flowers = load_mesh(doc, blob, "Circle_0")
    stones = load_mesh(doc, blob, "Plane.001_0")
    images = []
    for mesh, size in zip((flowers, stones), GARDEN_TEXTURES):
        m = doc["materials"][mesh["material"]]
        texture = m["extensions"]["KHR_materials_pbrSpecularGlossiness"]["diffuseTexture"]["index"]
        view = doc["bufferViews"][doc["images"][doc["textures"][texture]["source"]]["bufferView"]]
        image = Image.open(io.BytesIO(blob[view["byteOffset"] : view["byteOffset"] + view["byteLength"]])).convert(
            "RGB"
        )
        images.append(image.resize((size, size), Image.Resampling.LANCZOS))
    width = sum(GARDEN_TEXTURES)
    atlas = Image.new("RGB", (width, max(GARDEN_TEXTURES)))
    garden = MeshBuilder()
    left = 0
    door_foot = np.array([0.0, 0.0, 22.0 / 15.07 * s])  # where the model's path begins, below its door
    for mesh, size, scale in zip((flowers, stones), GARDEN_TEXTURES, (1.0, PATH_SCALE)):
        atlas.paste(images.pop(0), (left, 0))
        pos = mesh["positions"] * s
        pos = door_foot + (pos - door_foot) * scale
        pos[:, 1] += np.array([dune(p[0], p[2], top) for p in pos])
        uvs = (mesh["uvs"] % 1) * size / [width, max(GARDEN_TEXTURES)] + [left / width, 0]
        garden.add([[(pos[i], uvs[i]) for i in tri] for tri in mesh["triangles"]])
        left += size
    return garden, atlas.quantize(256, dither=Image.Dither.FLOYDSTEINBERG).convert("RGB")


def bled(image: Image.Image, rounds: int = 24) -> Image.Image:
    """The image with its painted parts bled out over the black between them, so nothing sampled
    near a part's edge (or blended into it by a coarser mipmap) is black."""
    px = np.asarray(image).astype(np.int32)
    painted = px.max(axis=2) > 24
    for _ in range(rounds):
        if painted.all():
            break
        total = np.zeros_like(px)
        count = np.zeros(painted.shape, np.int32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            shifted = np.roll(px, (dy, dx), (0, 1))
            has = np.roll(painted, (dy, dx), (0, 1))
            total += shifted * has[..., None]
            count += has
        fill = ~painted & (count > 0)
        px[fill] = total[fill] // count[fill][:, None]
        painted |= fill
    return Image.fromarray(px.astype(np.uint8))


def trim_texture(
    doc: dict, blob: bytes
) -> tuple[Image.Image, dict[str, np.ndarray], float, tuple[float, float, float, float]]:
    """The model's texture at TRIM_TEXTURE, for the leaves, chimney and window rings, with a blank
    strip ATLAS_PAD wide added at its right and the swatches painted down it, then the portholes'
    glass; each swatch's texture coordinates (its middle); how much the model's own coordinates
    squeeze by across; and the glass's box in texture coordinates."""
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
    gx, gy = TRIM_TEXTURE + (ATLAS_PAD - GLASS) // 2, 8 + len(SWATCHES) * 40
    atlas.paste(paint_glass(GLASS), (gx, gy))
    glass = (gx / atlas.width, gy / atlas.height, (gx + GLASS) / atlas.width, (gy + GLASS) / atlas.height)
    return atlas, swatch_uv, TRIM_TEXTURE / atlas.width, glass


def paint_glass(size: int) -> Image.Image:
    """A porthole's glass: sea blue, deeper toward the rim and the lower right, lit from the upper
    left where the sky catches it, with a bright streak of that sheen, in a few flat shades."""
    shades = [(62, 122, 186), (92, 158, 214), (126, 190, 236), (170, 218, 246), (222, 242, 252)]
    img = Image.new("RGB", (size, size))
    px = img.load()
    for x in range(size):
        for y in range(size):
            fx, fy = (x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5  # across and down, -0.5 to 0.5
            light = 0.55 - 0.9 * (fx + fy) - 2 * (fx * fx + fy * fy)
            streak = abs(fx + fy + 0.3) < 0.04 and -0.42 < fx - fy < 0.22
            px[x, y] = shades[4] if streak else shades[int(np.clip(round(light * 3), 0, 3))]
    return img


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


def emit_parts_list(doors: list[inside.Door]) -> None:
    """The client's list of the house's parts: each one's mesh, texture, whether that texture
    repeats or is an atlas with clear pixels, whether it's lit by the sun (the outside) or shows as
    painted (the rooms), and the door it hangs on."""
    parts = [
        ("skin", "pineapple-skin", True, False, False, None),
        ("passage", "steel", True, False, False, None),
        ("trim", "pineapple", False, False, False, None),
        ("garden", "pineapple-garden", False, False, False, None),
        ("door-front", "door", False, False, False, "front"),
        ("interior", "pineapple-interior", False, True, True, None),
        *((f"door-{d.id}", "pineapple-interior", False, True, True, d.id) for d in doors),
    ]
    lines = [
        "// Generated by scripts/house-model.py; don't edit. The pineapple house's parts: each one's mesh",
        "// (public/assets/models/pineapple-<name>.bin), its texture (public/assets/textures/models/<texture>.png),",
        "// whether the texture repeats (coordinates run past 1) or is an atlas, whether it has clear pixels,",
        "// whether it's drawn as painted rather than lit (the rooms, which the sun never reaches), and the",
        "// door it hangs on, if it swings (content/pineappleProfile.ts).",
        "export interface PineapplePart {",
        "  name: string;",
        "  texture: string;",
        "  wrap: boolean;",
        "  alpha: boolean;",
        "  unlit: boolean;",
        "  door?: string;",
        "}",
        "",
        "export const PINEAPPLE_PARTS: readonly PineapplePart[] = [",
    ]
    for name, texture, wrap, alpha, unlit, door in parts:
        extra = f", door: '{door}'" if door else ""
        flags = f"wrap: {str(wrap).lower()}, alpha: {str(alpha).lower()}, unlit: {str(unlit).lower()}"
        lines.append(f"  {{ name: '{name}', texture: '{texture}', {flags}{extra} }},")
    lines += ["];", ""]
    PARTS_OUT.write_text("\n".join(lines))
    print(f"wrote {PARTS_OUT}: {len(parts)} parts")


def emit_profile(profile: Profile, doors: list[inside.Door], interior: inside.Interior) -> None:
    ys = sorted({*np.arange(0, profile[-1][0], PROFILE_STEP), profile[-1][0]})
    rings = [(y, radius_at(profile, y)) for y in ys]
    levels = interior.levels
    num = lambda v: f"{v:.3f}".rstrip("0").rstrip(".")
    (fx0, fz0), (fx1, fz1), fw = inside.FLIGHT
    lines = [
        "// Generated by packages/client/scripts/house-model.py; don't edit. The pineapple house's shape for",
        "// the sim (content/pineapple.ts), in metres in the house's frame (the door facing +z, y up from",
        "// the house's floor on the dune): the shell's rings from the ground up (height, radius); the dune",
        "// it stands on; the flat upright face round the doorway (how far it reaches either side of the",
        "// door and up, and how far out from the axis it stands); the doorway cut in it and the vestibule",
        "// behind (how far back its steel wall stands); the rooms' levels (the ground floor's ceiling, the",
        "// first floor at the bedroom's floor and its ceiling, the library's floor, and the top of its wall,",
        "// above which the shell is solid); how tall the landing is; the library's wall, band by band up",
        "// it (height, inside, outside); the",
        "// spiral in the living room (where it winds, its radii, how many turns from what angle, from +x",
        "// toward +z) and the flight up the stairwell (its foot and head on the floor, its width); and",
        "// every door (its pin, the floor it stands on, the way it runs from the pin shut, from +x toward",
        "// +z, how far, how tall and thick, and how far it swings).",
        "export const PINEAPPLE_PROFILE = {",
        f"  rings: [{', '.join(f'[{y:.2f}, {r:.2f}]' for y, r in rings)}],",
        f"  dune: {{ height: {num(DUNE_HEIGHT)}, top: {num(dune_top(profile))}, foot: {num(DUNE_FOOT)}, bulges: {DUNE_BULGES}, bulge: {num(BULGE)} }},",
        f"  face: {{ halfWidth: {num(FACE_BLEND)}, top: {num(FACE_BLEND_TOP)}, z: {num(face_plane(profile))} }},",
        f"  doorway: {{ width: {num(DOOR_WIDTH)}, height: {num(DOOR_HEIGHT)} }},",
        f"  vestibule: {{ back: {num(interior.front_z)} }},",
        f"  levels: {{ ceiling: {num(levels['ceiling'])}, hall: {num(levels['hall'])}, hallCeiling: {num(levels['hallCeiling'])}, library: {num(levels['library'])}, top: {num(levels['top'])} }},",
        f"  landing: {{ height: {num(inside.LANDING_HEIGHT)} }},",
        f"  library: [{', '.join(f'[{y:.2f}, {a:.2f}, {b:.2f}]' for y, a, b in inside.library_wall(interior, PROFILE_STEP))}],",
        f"  spiral: {{ x: {num(inside.SPIRAL[0])}, z: {num(inside.SPIRAL[1])}, inner: {num(inside.STAIR_INNER)}, outer: {num(inside.SPIRAL[2])}, turns: 1, start: 0 }},",
        (
            f"  flight: {{ from: [{num(fx0)}, {num(fz0)}], to: [{num(fx1)}, {num(fz1)}], width: {num(fw)}, "
            f"slot: [{', '.join(num(v) for v in inside.landing_slot(interior))}] }},"
        ),
        "  doors: [",
        *(
            f"    {{ id: '{d.id}', hinge: [{num(d.hinge[0])}, {num(d.hinge[1])}], y: {num(d.y)}, bearing: {num(d.bearing)}, reach: {num(d.reach)}, height: {num(d.height)}, thickness: {num(d.thickness)}, swing: {num(d.swing)} }},"
            for d in doors
        ),
        "  ],",
        "} as const;",
        "",
    ]
    PROFILE_OUT.write_text("\n".join(lines))
    print(f"wrote {PROFILE_OUT}: {len(rings)} rings, {len(doors)} doors")


def emit_boxes(boxes: list[list[float]]) -> None:
    lines = [
        "// Generated by packages/client/scripts/house-model.py; don't edit. The boxes the sim collides",
        "// with inside the pineapple house (content/pineapple.ts): every surface of the rooms and what's",
        "// in them, cut on a grid, each as [x, z, y, w, d, h] in metres in the house's frame (its centre",
        "// across, its underside, its size).",
        "export const PINEAPPLE_BOXES: readonly (readonly [number, number, number, number, number, number])[] = [",
        *(f"  [{', '.join(f'{v:g}' for v in box)}]," for box in boxes),
        "];",
        "",
    ]
    BOXES_OUT.write_text("\n".join(lines))
    print(f"wrote {BOXES_OUT}: {len(boxes)} boxes")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
