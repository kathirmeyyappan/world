"""Builds the pineapple house (SpongeBob's) for the world from two Sketchfab models: penqin's
house for the outside, and the Sbfbb SpongeBob House (cherylhill28) for the rooms inside
(house_interior.py). Writes the client's meshes (public/assets/models/pineapple/<part>.bin, fetched
by the loader) with their textures beside them, the parts list (render/models/pineappleParts.ts)
and what the sim collides with (content/pineappleProfile.ts and content/pineappleInterior.ts).

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
  rooms' own door frame set in it (the way in); the frame round the doorway on the face; and the
  passages through the shell at the back door, the hall's and the living room's side door, lined
  in the same steel;
- trim: the leaves, the chimney, the portholes (their tubes cut off inside the shell's wall, their
  glass painted with its sheen) and the crown's cap;
- door: a flat slab the doorway's shape less a hair of clearance all round, the show's front door
  painted here on both faces, flush with the face about the pin at its left edge on the ground,
  for the sim to swing (content/pineapple.ts);
- flowers and path: the model's flowers round the house, each in one colour, shrunk and drawn
  see-through, and the stone path from the door down the dune, both laid on the dune;
- interior and door-<name>: the rooms and their doors (house_interior.py), and hatch and hatch-rim: the
  hatch's tube and the slide, and the collar round the hatch, in steel painted here (door-hatch too).

The profile the sim collides with (the shell's rings, the doorway and its door, the flat face, the
openings through the shell, the dune, the rooms' levels, stairs and doors) comes from the same
lathe and the same rooms; the boxes the rooms are cut into go to content/pineappleInterior.ts.

Both models are in glTF's frame, right-handed; the game's is Babylon's, left-handed. The scripts
work in the models' frame, where a bearing is what Blender or Sketchfab shows, and everything
written out is mirrored in x (house_mesh.MIRROR): the meshes as they are written, the profile's
numbers here.
"""

from __future__ import annotations

import io
import subprocess
import sys
from dataclasses import dataclass
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
    emit_part,
    fan,
    lathe,
    lining,
    turned_by,
)
from PIL import Image, ImageDraw

OUTER = 20.0  # metres: the shell's radius at its widest, the keep's (content/keep.ts)
DOOR_WIDTH = 4.0  # metres: the doorway, an arch
DOOR_HEIGHT = 6.0
DOOR_THICKNESS = 0.3
KNUCKLES = (0.9, 4.7)  # metres up the pin the two hinge knuckles sit
KNUCKLE = (0.08, 0.36)  # a knuckle's radius and height
FRAME = 0.4  # metres wide the frame round the doorway is
FRAME_PROUD = 0.04  # metres it stands off the face
SEGMENTS = 72  # round the lathe
FINE_SPAN = 24  # degrees either side of the front door the lathe is turned a degree at a time, for its face
DOOR_FINE_SPAN = 14  # and either side of the house's own doors, for their smaller faces
RING_STEP = 1.0  # metres between the lathe's rings
PROFILE_STEP = 3.0  # metres at most between the rings the sim gets
RING_LEAN = 0.25  # metres the skin may lean within one of the sim's bands, which stand as proud of it as that
FACE_THICKNESS = 1.0  # metres thick the sim's wall along the face is, in from the skin
SKIN_TILE = 8.5  # metres of shell one repeat of the pineapple pattern (two diamonds) covers
STEEL_TILE = 3.0  # metres of passage one repeat of the steel (two plates) covers
PORTHOLE_STUB = 0.3  # metres inside the skin a porthole's tube is cut off: within the shell's wall
GLASS_RADIUS = 3.2  # metres from a porthole's axis its glass reaches, which tells the panes from the ring's rims
LEAVES_FROM = 46.5  # metres up: a trim part standing wholly above this is a leaf
CANOPY_HEIGHT = 2.6  # metres over the deck the leaves are cut off, head height and some
CANOPY_CLEAR = 1.0  # metres past the deck's edge the cut reaches
GLASS = 56  # pixels across the glass painted in the trim texture's strip
TRIM_TEXTURE = 512  # the model's texture is cut down to this for what's kept of it
PATH_TEXTURE = 256  # the path's texture, cut down to this
FLOWER_SCALE = 0.5  # how big the flowers stand, of the model's
FLOWER_OPACITY = 0.75  # how solid the flowers are drawn
ATLAS_PAD = 64  # pixels of blank strip added at the trim texture's right for the swatches
SWATCHES = {"crown": (138, 107, 42), "iron": (74, 74, 80)}
PATH_NEAR = 17.5  # metres out from the axis the path's first stone lies (just under the dune's flat top)
PATH_FAR = 32.0  # and its last, just past the dune's foot onto the floor
STONE_SCALE = 0.8  # how wide each stone lies, of the model's
STONE_HEIGHT = 0.12  # metres a stone stands above the sand: a flagstone to step on, not a drum
PATH_SPREAD = (
    10.0  # metres either side of the path's line its flagstones lie within (the model's rock lies further out)
)
DUNE_HEIGHT = 3.0  # metres the dune's flat top, and the house's floor, stand above the floor
DUNE_FOOT = 30.0  # where the dune meets the floor: the grounds' radius (sim/outline.ts BUILDING_GROUNDS)
DUNE_BULGES = 5  # soft mounds round the slope
BULGE = 0.5  # metres they rise and fall by
CLIENT = Path(__file__).resolve().parents[1]
MODELS_OUT = CLIENT / "public/assets/models/pineapple"  # the meshes and their textures, together
PARTS_OUT = CLIENT / "src/render/models/pineappleParts.ts"
PROFILE_OUT = CLIENT.parent / "shared/src/content/pineappleProfile.ts"
BOXES_OUT = CLIENT.parent / "shared/src/content/pineappleInterior.ts"

flat_xy = lambda p: p[[0, 1]]


@dataclass(frozen=True)
class Face:
    """An upright flat face carved into the shell round a doorway, so its door hangs true in a flat
    wall: at a bearing (from +z toward +x), flat `flat` either side of the doorway's middle and
    rounded back into the shell by `blend`; from `floor`, where its plane is a chord of the shell,
    flat up to `top` and leaned back into the shell by `blend_top`. The shell leans out as it rises,
    so above the floor the face is carved in; below it the shell is narrower than the plane and
    stays as it is. `door` is the doorway's half-width and height, for the sim's wall above it."""

    bearing: float
    flat: float
    blend: float
    floor: float
    top: float
    blend_top: float
    door: tuple[float, float]


FRONT_FACE = Face(0.0, 2.7, 4.6, 0.0, 6.6, 10.5, (DOOR_WIDTH / 2, DOOR_HEIGHT))
# The faces round the doors: the front's, and (once the rooms' levels are known, main) the back
# door's and the hall's, each flat 1.8 m either side of its DOORWAY and 4 m up, leaned back by 6.5.
FACES: list[Face] = [FRONT_FACE]


def door_face(bearing: float, floor: float, doorway: tuple[float, float] = inside.DOORWAY) -> Face:
    return Face(bearing, 1.8, 3.2, floor, floor + 4.0, floor + 6.5, (doorway[0] / 2, doorway[1]))


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
    hall = interior.levels["hall"]
    FACES.extend(
        (
            door_face(inside.BACK_BEARING, 0.0),
            door_face(inside.HALL_BEARING, hall),
            door_face(inside.SIDE_BEARING, 0.0, inside.SIDE_DOORWAY),
        )
    )
    skin_r = lambda a, y: float(np.hypot(*surface(profile, a, y)[[0, 2]]))
    inside.add_rooms(interior, lambda a, y: skin_r(a, y) - inside.LINING)
    inside.build_floors(interior, skin_r, lathe_angles(), [y for y, _ in profile])
    inside.seal_library(interior)
    inside.hatch_and_slide(interior)

    # The skin, with the doorway cut out of it, and the vestibule behind.
    skin_tris = lathe(profile, SKIN_TILE, lambda a, y: surface(profile, a, y), lathe_angles())
    hole = arch(-DOOR_WIDTH / 2, DOOR_WIDTH / 2, DOOR_HEIGHT, inside.ARCH_STEPS)
    cut, rest = cut_hole(skin_tris, hole)
    through = MeshBuilder()
    lift = lambda a, z: np.array([a[0], a[1], z])
    through.add(lining(cut, interior.front_z, hole, STEEL_TILE, flat_xy, lift))
    skin_tris = cut + rest
    # The vestibule's back wall, with the doorway into the living room cut through it and the
    # room's wall behind, the reveal between them in the steel too.
    back = back_wall(
        arch(-DOOR_WIDTH / 2, DOOR_WIDTH / 2, DOOR_HEIGHT, inside.ARCH_STEPS, bottom=0.0),
        interior.front_z,
        interior.front,
    )
    front_wall, front_material = inside.cut_doorway(interior, 0.0, (12.4, 13.6), interior.front)
    through.add(lining(back, front_wall, interior.front, STEEL_TILE, flat_xy, lift))
    through.add(back)
    interior.tris += [(t, front_material) for t in front_wall]
    # The back door out of the kitchen, and the hall's door at the head of the stair, each a
    # doorway through the shell: the skin cut, the wall behind cut, and the steel between.
    back_hole = arch(-inside.DOORWAY[0] / 2, inside.DOORWAY[0] / 2, inside.DOORWAY[1], inside.ARCH_STEPS)
    kitchen_wall, kitchen_material = inside.cut_doorway(interior, inside.BACK_BEARING, (12.0, 13.6), back_hole)
    skin_tris, tube = doorway(skin_tris, inside.BACK_BEARING, back_hole, kitchen_wall, 0.0, True)
    through.add(tube)
    interior.tris += [(t, kitchen_material) for t in kitchen_wall]
    hall_hole = arch(-inside.DOORWAY[0] / 2, inside.DOORWAY[0] / 2, inside.DOORWAY[1], inside.ARCH_STEPS, bottom=-0.01)
    skin_tris, tube = doorway(skin_tris, inside.HALL_BEARING, hall_hole, interior.hall_wall, hall, False)
    through.add(tube)
    interior.tris += [(t, interior.hall_wall_material) for t in interior.hall_wall]
    # The living room's side door: the skin cut on the radial through its frame, and the passage
    # lined from the cut to the frame's back. The frame runs deeper than the wall round it and the
    # doorway's arch stands within the frame's, so the frame seals the passage's mouth.
    side_hole = arch(-inside.SIDE_DOORWAY[0] / 2, inside.SIDE_DOORWAY[0] / 2, inside.SIDE_DOORWAY[1], inside.ARCH_STEPS)
    cut, rest = cut_hole(turned_by(skin_tris, -inside.SIDE_BEARING), side_hole)
    tube = lining(cut, interior.side_depth, side_hole, STEEL_TILE, flat_xy, lift)
    skin_tris = turned_by(cut + rest, inside.SIDE_BEARING)
    through.add(turned_by(tube, inside.SIDE_BEARING))
    interior.solid += inside.faced_wall(interior)
    # The back door swings out onto the sand, the hall's in off the platform, and the side door in
    # off its frame's face, standing a hair off it so their faces never share a plane.
    door_shape = inside.arch_shape(*inside.DOORWAY)
    side_bearing, side_face, side_middle, side_opening = inside.side_frame(interior)
    for id_, bearing, depth, floor, out, shape, across in (
        ("back", inside.BACK_BEARING, wall_depth(kitchen_wall, inside.BACK_BEARING), 0.0, True, door_shape, 0.0),
        (
            "hall",
            inside.HALL_BEARING,
            wall_depth(interior.hall_wall, inside.HALL_BEARING),
            hall,
            False,
            door_shape,
            0.0,
        ),
        ("side", side_bearing, side_face - 0.01, 0.0, False, inside.grown(side_opening, inside.SIDE_LAP), side_middle),
    ):
        inside.new_door(interior, id_, bearing, depth, floor, out, shape, across=across)
    through.add(frame_band(face_plane(profile, FRONT_FACE) + FRAME_PROUD))
    skin = MeshBuilder()
    skin.add(skin_tris)
    # The trim: the leaves and chimney as the model has them, and its portholes sunk. The crown is
    # open: the attic stair's deck (content/pineapple.ts, from the profile) is the top of the fruit.
    trim = MeshBuilder()
    fitted = {c for cs in fittings.values() for c in cs}
    # The leaves stand on the crown, through the deck: within CANOPY_CLEAR of the deck's edge they
    # are cut off below CANOPY_HEIGHT over it, so the deck stands under a canopy, not in a thicket.
    if interior.attic is None:
        raise SystemExit("the interior has no attic stair")
    canopy = interior.attic.deck[1] + CANOPY_HEIGHT
    clear = interior.attic.deck[0] + CANOPY_CLEAR
    for k in range(len(parts)):
        if k == shell or k in on_door or k in portholes or k in fitted:
            continue
        part_tris = model_triangles(points, uv, tris[of == k], s, squeeze)
        if (points[parts[k]][:, 1] * s).min() > LEAVES_FROM:
            part_tris = [t for tri in part_tris for t in canopy_cut(tri, canopy, clear)]
        trim.add(part_tris)
    for k, cs in fittings.items():
        trim.add(porthole(points, uv, tris, of, parts, [k, *cs], s, squeeze, profile, glass))
    door_part, front_door = build_door(profile)
    flowers, flower_swatches, path, path_image, stones = build_garden(doc, blob, s, dune_top(profile))

    MODELS_OUT.mkdir(parents=True, exist_ok=True)
    for old in MODELS_OUT.glob("*.bin"):
        old.unlink()
    atlas.quantize(256, dither=Image.Dither.FLOYDSTEINBERG).save(MODELS_OUT / "trim.png", optimize=True)
    path_image.save(MODELS_OUT / "path.png", optimize=True)
    flower_swatches.save(MODELS_OUT / "flowers.png", optimize=True)
    paint_pineapple().save(MODELS_OUT / "skin.png", optimize=True)
    paint_steel().save(MODELS_OUT / "steel.png", optimize=True)
    paint_door().save(MODELS_OUT / "door.png", optimize=True)
    rooms_atlas, places = inside.pack_atlas(interior)
    rooms_atlas.save(MODELS_OUT / "interior.png", optimize=True)
    emit_part(MODELS_OUT / "skin.bin", skin, {})
    emit_part(MODELS_OUT / "passage.bin", through, {})
    emit_part(MODELS_OUT / "trim.bin", trim, swatch_uv)
    emit_part(MODELS_OUT / "door-front.bin", door_part, swatch_uv)
    emit_part(MODELS_OUT / "flowers.bin", flowers, {})
    emit_part(MODELS_OUT / "path.bin", path, {})
    rooms = MeshBuilder()
    rooms.add(inside.in_atlas(interior.tris, places))
    emit_part(MODELS_OUT / "interior.bin", rooms, {})
    for d in interior.doors:
        panel = MeshBuilder()
        if d.texture == "interior":
            panel.add(inside.in_atlas([(t, inside.material(interior, d.material)) for t in d.mesh], places))
            panel.add(inside.in_atlas([(t, inside.material(interior, m)) for t, m in d.trim], places))
        else:
            panel.add(d.mesh)
        emit_part(MODELS_OUT / f"door-{d.id}.bin", panel, {})
    for name, tris in (
        ("hatch", interior.hatch_steel),
        ("slide-floor", interior.slide_floor),
        ("hatch-rim", interior.hatch_rim),
    ):
        mesh = MeshBuilder()
        mesh.add(tris)
        emit_part(MODELS_OUT / f"{name}.bin", mesh, {})
    paint_slide().save(MODELS_OUT / "slide.png", optimize=True)
    paint_slide(dark=True).save(MODELS_OUT / "slide-floor.png", optimize=True)
    paint_rim().save(MODELS_OUT / "hatch-rim.png", optimize=True)
    paint_hatch_door().save(MODELS_OUT / "hatch-door.png", optimize=True)
    boxes = inside.voxel_boxes(interior.solid + [t for t, _ in through.tris])
    emit_parts_list(interior.doors)
    emit_profile(profile, [front_door, *interior.doors], interior, stones)
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
    heights = sorted({*np.arange(0, ys[-1], RING_STEP), ys[-1], FRONT_FACE.top, FRONT_FACE.blend_top})

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


def face_plane(profile: Profile, face: Face) -> float:
    """How far out a face's plane stands: a chord of the shell at the face's floor, `flat` either
    side of the doorway, so it never stands proud of the shell there."""
    return float(np.sqrt(radius_at(profile, face.floor) ** 2 - face.flat**2))


def fade(t: float, t0: float, t1: float) -> float:
    """1 up to t0, falling smoothly to 0 at t1."""
    u = float(np.clip((t - t0) / (t1 - t0), 0, 1))
    return 1 - u * u * (3 - 2 * u)


def surface(profile: Profile, a: float, y: float) -> np.ndarray:
    """A point of the outer skin: the lathe, but flattened into the upright faces round the doors
    (FACES), each rounding back into the shell by its blends. A face is a chord of the shell at its
    floor: within it a point's radius is what puts it on the plane, and only ever less than the
    lathe's, so under its floor, where the shell is narrower, nothing changes."""
    r = radius_at(profile, y)
    for face in FACES:
        aside = abs((a - face.bearing + np.pi) % (2 * np.pi) - np.pi)  # the angle round from the door, either way
        if aside < np.pi / 3:
            r0 = radius_at(profile, face.floor)
            w = fade(r0 * np.sin(aside), face.flat, face.blend) * fade(y, face.top, face.blend_top)
            r -= w * max(0.0, r - face_plane(profile, face) / np.cos(aside))
    return np.array([r * np.sin(a), y, r * np.cos(a)])


def lathe_angles() -> list[float]:
    """The lathe's angles round: SEGMENTS round the whole, and a degree apart within FINE_SPAN of
    the front door (which faces angle 0) and DOOR_FINE_SPAN of the other doors, where the faces are
    shaped. From 0 to a whole turn, both ends in."""
    whole = {2 * np.pi * k / SEGMENTS for k in range(SEGMENTS + 1)}
    fine = {np.radians(d) % (2 * np.pi) for d in range(-FINE_SPAN, FINE_SPAN + 1)}
    for face in FACES[1:]:
        fine |= {(face.bearing + np.radians(d)) % (2 * np.pi) for d in range(-DOOR_FINE_SPAN, DOOR_FINE_SPAN + 1)}
    return sorted(whole | fine | {2 * np.pi})


def canopy_cut(tri: Triangle, canopy: float, clear: float) -> list[Triangle]:
    """A leaf's triangle with the block under `canopy` within `clear` of the axis taken out: what
    stands above the canopy, and what stands below it outside that radius."""
    pts = np.array([p for p, _ in tri])
    if (pts[:, 1] >= canopy).all() or (np.hypot(pts[:, 0], pts[:, 2]) >= clear).all():
        return [tri]
    above = clip_at(list(tri), lambda p: canopy - p[1], 0.0)
    below = clip_at(list(tri), lambda p: p[1] - canopy, 0.0)
    outside = clip_at(below, lambda p: clear - float(np.hypot(p[0], p[2])), 0.0)
    return [t for poly in (above, outside) if len(poly) >= 3 for t in fan(poly)]


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


def doorway(
    skin: list[Triangle], bearing: float, hole: Outline, inner: list[Triangle], base: float, from_floor: bool
) -> tuple[list[Triangle], list[Triangle]]:
    """A doorway through the shell at a bearing (from +z toward +x): the hole (an outline in the
    wall's plane seen from outside, over `base`) cut out of the skin and out of `inner`, the wall
    behind (replaced in place, split so the two meet corner to corner), and the reveal from the one
    cut to the other, in the steel. Returns the skin with its hole and the reveal. `from_floor` for
    a doorway on the ground, whose floor is the ground."""
    turn = lambda tris, back: [[(p + [0, base, 0] if back else p - [0, base, 0], q) for p, q in tri] for tri in tris]
    turned = turn(turned_by(skin, -bearing), False)
    cut, rest = cut_hole(turned, hole, from_floor)
    wall_cut, wall_rest = cut_hole(turn(turned_by(inner, -bearing), False), hole, from_floor)
    wall = wall_cut + wall_rest
    lift = lambda a, z: np.array([a[0], a[1], z])
    reveal = lining(cut, wall, hole, STEEL_TILE, flat_xy, lift, from_floor)
    inner[:] = turned_by(turn(wall, True), bearing)
    return turned_by(turn(cut + rest, True), bearing), turned_by(turn(reveal, True), bearing)


def wall_depth(wall: list[Triangle], bearing: float) -> float:
    """How far out from the axis a wall stands along a bearing: its nearest corner to the line."""
    along = np.array([np.sin(bearing), 0.0, np.cos(bearing)])
    across = np.array([np.cos(bearing), 0.0, -np.sin(bearing)])
    pts = [p for tri in wall for p, _ in tri]
    return float(min((abs(p @ across), p @ along) for p in pts)[1])


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
    inner = arch(-DOOR_WIDTH / 2, DOOR_WIDTH / 2, DOOR_HEIGHT, inside.ARCH_STEPS, bottom=0.0)
    outer = arch(-DOOR_WIDTH / 2 - FRAME, DOOR_WIDTH / 2 + FRAME, DOOR_HEIGHT + FRAME, inside.ARCH_STEPS, bottom=0.0)
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
    """The door: a flat slab the doorway's outline from the ground up, DOOR_THICKNESS thick, its
    face flush with the flat face of the shell, about its pin (an edge on the ground, on the outer
    face, the face it swings toward); and the door for the sim, which swings it outward, square to
    the doorway, to stand at its side. The slab runs to -x from its pin here, so that mirrored into
    the game (house_mesh.MIRROR) it hangs to the right of its run, as doors.ts hangs every slab,
    with the pin at the game's -x edge."""
    x0, x1 = -DOOR_WIDTH / 2, DOOR_WIDTH / 2
    top = DOOR_HEIGHT
    face = face_plane(profile, FRONT_FACE)
    hinge = np.array([x1, 0.0, face])
    outline = arch(x0, x1, top, inside.ARCH_STEPS, bottom=0.0)
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
    door = inside.Door("front", (float(x1), float(face)), 0.0, np.pi, x1 - x0, top, DOOR_THICKNESS, -np.pi / 2, [])
    return mesh, door


def dune_top(profile: Profile) -> float:
    """Radius of the dune's flat top: just past the shell's foot."""
    return radius_at(profile, 0.0) + 1


def dune(lx: float, lz: float, top: float) -> float:
    """The dune's height under a point of the game's frame (the model's mirrored in x,
    house_mesh.MIRROR), over the house's floor: flat on top (`top` out), down to the grounds' floor
    by their edge, never steeper than a walk, bulging a little round the slope. The same hill as
    content/pineapple.ts builds from the profile's `dune`."""
    out = float(np.hypot(lx, lz))
    t = float(np.clip((DUNE_FOOT - out) / (DUNE_FOOT - top), 0, 1))
    slope = t * t * (3 - 2 * t)
    bulge = float(np.sin(DUNE_BULGES * np.arctan2(lz, lx)) * np.sin(np.pi * t))
    return (DUNE_HEIGHT + 0.05) * slope + BULGE * bulge - 0.05 - DUNE_HEIGHT


def build_stair(profile: Profile, hall: float) -> list[list[float]]:
    """The stair round the back of the house, from the back door up to the platform at the hall's
    door, standing clear of the shell (which leans out overhead) by STAIR_GAP beyond the skin's
    widest within a walker's height over each step: each step a slab with a rail along both edges
    where it stands out of the sand, the flight going on down into the sand below the door's floor
    (see STAIR_FOOT), then the platform, a slab from the hall's face out to the stair's outer
    edge, railed along that edge, its far side, and its near side from the wall to the stair's
    inner rail. Each piece as
    [x, z, y, w, d, h, yaw] in the house's frame: its centre across, its underside, its size across
    the arc, out from the axis and up, and the bearing it faces (from +z toward +x), the sim's yaw."""
    skin_at = lambda a, y: float(np.hypot(*surface(profile, a, y)[[0, 2]]))
    # Clear of the lathe's round, not a face's carve: the stair keeps its distance from the shell
    # behind a face too, so a door can swing out under it.
    clear = lambda h: (
        max(radius_at(profile, y) for y in np.arange(h, h + inside.STAIR_HEADROOM + 1e-6, 0.5)) + inside.STAIR_GAP
    )
    top = hall - inside.SILL
    steps = int(np.ceil(top / inside.STAIR_RISER))
    rail_w, width = inside.RAIL_WIDTH, inside.STAIR_WIDTH
    across = inside.PLATFORM_ACROSS
    plat_in = skin_at(inside.HALL_BEARING, hall) + 0.05
    r_in_top = clear(top)
    out = r_in_top + width - plat_in
    plat_half = across / 2 / (plat_in + out / 2)
    a0, a1 = inside.BACK_BEARING + inside.STAIR_START, inside.HALL_BEARING - plat_half
    at = lambda r, a: [r * np.sin(a), r * np.cos(a)]
    top_r = dune_top(profile)
    rise = top / steps

    def lay(i: int) -> tuple[list[list[float]], float]:
        """The step's slab and its rails, and how far its top stands over the lowest sand under it
        (nothing, when it lies buried whole)."""
        b0, b1 = a0 + (a1 - a0) * i / steps, a0 + (a1 - a0) * (i + 1) / steps
        bm = (b0 + b1) / 2
        h = rise * (i + 1)
        r_in = clear(max(h, 0.0))
        r_out = r_in + width
        depth = (b1 - b0) * r_out + 0.05
        base = h - inside.STAIR_THICKNESS
        centre = np.array(at((r_in + r_out) / 2, bm))
        along, outward = np.array([np.cos(bm), -np.sin(bm)]), np.array([np.sin(bm), np.cos(bm)])
        corners = [centre + sx * along * depth / 2 + sy * outward * width / 2 for sy in (-1, 1) for sx in (-1, 1)]
        sand = [
            dune(-float(c[0]), float(c[1]), top_r) for c in corners
        ]  # under the inner edge's ends, then the outer's
        # The flight's foot stands in the sand, which falls away under it: a step less than
        # STAIR_FOOT over its lowest corner goes down into the sand, and the underside of the next
        # few lifts off by degrees (a riser's rise more each step), so the flight leaves the ground
        # as one solid piece rather than hovering just over it.
        gap = base - min(sand)
        skirt = max(0.0, inside.STAIR_FOOT - gap)
        if skirt + rise >= gap:
            skirt = gap + inside.STAIR_SINK
        base -= skirt
        pieces = [[*centre, base, depth, width, h - base, bm]]
        for r, edge in ((r_in + rail_w / 2, sand[:2]), (r_out - rail_w / 2, sand[2:])):
            if h > max(edge):  # a rail only along an edge standing out of the sand
                pieces.append([*at(r, bm), h, depth + 0.02, rail_w, inside.RAIL, bm])
        return pieces, h - min(sand)

    # Below the door's floor the flight goes on down into the sand, a step at a time, until the
    # next would lie buried whole: so the lowest step out of the sand stands at most a riser over
    # it, and the flight is stepped onto from the slope like any stair.
    foot = 0
    while lay(foot - 1)[1] > 0:
        foot -= 1
    rows: list[list[float]] = []
    for i in range(foot, steps):
        rows += lay(i)[0]
    rm = plat_in + out / 2
    centre = np.array(at(rm, inside.HALL_BEARING))
    tangent = np.array([np.cos(inside.HALL_BEARING), -np.sin(inside.HALL_BEARING)])
    rows.append([*centre, top - inside.STAIR_THICKNESS, across, out, inside.STAIR_THICKNESS, inside.HALL_BEARING])
    rows.append(
        [*at(plat_in + out - rail_w / 2, inside.HALL_BEARING), top, across, rail_w, inside.RAIL, inside.HALL_BEARING]
    )
    far = centre + tangent * (across / 2 - rail_w / 2)
    rows.append([*far, top, rail_w, out - rail_w, inside.RAIL, inside.HALL_BEARING])
    near_r = (plat_in + r_in_top) / 2
    near = np.array(at(near_r, inside.HALL_BEARING)) - tangent * (across / 2 - rail_w / 2)
    rows.append([*near, top, rail_w, r_in_top - plat_in + rail_w, inside.RAIL, inside.HALL_BEARING])
    return [[round(float(v), 3) for v in row] for row in rows]


def face_walls(profile: Profile) -> list[list[float]]:
    """The sim's walls along the faces round the doors: for each face, each half-metre band from its
    floor up to where it has leaned back into the shell, the face's outline at the band's top (where
    it stands outermost) as chords between its end, its blend into the flat and the doorway's edge
    either side, and across above the doorway; each as [x1, z1, x2, z2, y0, y1], the chord's ends
    moved in by half FACE_THICKNESS so a wall that thick stands with its outer face on the skin."""
    rows: list[list[float]] = []
    for face in FACES:
        r0 = radius_at(profile, face.floor)
        asides = [face.blend, (face.blend + face.flat) / 2, face.flat, face.door[0] + 0.3]
        y = face.floor
        while y < face.blend_top - 1e-6:
            y1 = min(y + 0.5, face.blend_top)
            pts = lambda side, at=y1, r0=r0, face=face, asides=asides: [
                surface(profile, face.bearing + side * float(np.arcsin(d / r0)), at)[[0, 2]] for d in asides
            ]
            chords = [(pts(side)[k], pts(side)[k + 1]) for side in (-1, 1) for k in range(3)]
            if y >= face.floor + face.door[1]:
                chords.append((pts(-1)[3], pts(1)[3]))
            for a, b in chords:
                d = b - a
                n = np.array([d[1], -d[0]]) / np.linalg.norm(d)
                if n @ (a + b) < 0:
                    n = -n
                a, b = a - n * FACE_THICKNESS / 2, b - n * FACE_THICKNESS / 2
                rows.append([round(float(v), 3) for v in (a[0], a[1], b[0], b[1], y, y1)])
            y = y1
    return rows


def build_garden(
    doc: dict, blob: bytes, s: float, top: float
) -> tuple[MeshBuilder, Image.Image, MeshBuilder, Image.Image, list[list[float]]]:
    """The model's flowers on the dune, each in the one colour its texture paints it (a swatch in a
    small image), FLOWER_SCALE as big about its foot on the dune; and its stone path from the door,
    laid again down the dune from PATH_NEAR to PATH_FAR out (the model's ran on past the grounds),
    each stone STONE_SCALE as wide about its own middle and no taller than STONE_HEIGHT, a
    flagstone to step on, with its texture; both laid on the dune. A flower standing off the dune
    and the rock beside the path are left out. Also each stone for the sim: a
    ramp lying with the dune's slope, [lowX, lowZ, highX, highZ, y, w, h] (its downhill and uphill
    ends on the floor, its underside at the downhill end, its width across, and its rise)."""
    flowers = load_mesh(doc, blob, "Circle_0")
    image = garden_image(doc, blob, flowers)
    px = image.load()
    pos = flowers["positions"] * s
    parts = components({"positions": flowers["positions"], "triangles": flowers["triangles"]})
    owner = np.zeros(len(pos), int)
    for k, verts in enumerate(parts):
        owner[verts] = k
    swatches = Image.new("RGB", (8 * 8, 8 * ((len(parts) + 7) // 8)))
    blooms = MeshBuilder()
    for k, verts in enumerate(parts):
        foot = np.array([pos[verts, 0].mean(), pos[verts, 1].min(), pos[verts, 2].mean()])
        if in_the_way(foot) or np.hypot(foot[0], foot[2]) > DUNE_FOOT:
            continue
        tris = [tri for tri in flowers["triangles"] if owner[tri[0]] == k]
        samples = []
        for tri in tris:
            u, v = np.mean(flowers["uvs"][tri] % 1, axis=0)
            c = px[int(u * image.width) % image.width, int(v * image.height) % image.height]
            if sum(c) > 90:
                samples.append(c)
        colour = tuple(int(v) for v in np.median(np.array(samples), axis=0))
        box = (8 * (k % 8), 8 * (k // 8))
        swatches.paste(Image.new("RGB", (8, 8), colour), box)
        uv = np.array([(box[0] + 4) / swatches.width, (box[1] + 4) / swatches.height])
        placed = foot + (pos - foot) * FLOWER_SCALE
        placed[:, 1] += np.array([dune(-p[0], p[2], top) for p in placed])
        blooms.add([[(placed[i], uv) for i in tri] for tri in tris])
    stones = load_mesh(doc, blob, "Plane.001_0")
    path_image = garden_image(doc, blob, stones).resize((PATH_TEXTURE, PATH_TEXTURE), Image.Resampling.LANCZOS)
    pos = stones["positions"] * s
    parts = components({"positions": stones["positions"], "triangles": stones["triangles"]})
    centres = [(pos[v].min(axis=0) + pos[v].max(axis=0)) / 2 for v in parts]
    parts, centres = zip(*[(v, c) for v, c in zip(parts, centres) if abs(c[0]) < PATH_SPREAD])
    owner = np.full(len(pos), -1)
    for k, verts in enumerate(parts):
        owner[verts] = k
    near, far = min(c[2] for c in centres), max(c[2] for c in centres)
    k = (PATH_FAR - PATH_NEAR) / (far - near)
    laid = pos.copy()
    ramps: list[list[float]] = []
    for verts, c in zip(parts, centres):
        where = np.array([c[0] * k, 0.0, PATH_NEAR + (c[2] - near) * k])
        p = where + (pos[verts] - c) * [k * STONE_SCALE, 1.0, k * STONE_SCALE]
        p[:, 1] = (p[:, 1] - p[:, 1].min()) * min(1.0, STONE_HEIGHT / float(np.ptp(p[:, 1])))
        # The ramp: the stone's spread along and across the slope, which falls away from the house.
        radial = where[[0, 2]] / np.linalg.norm(where[[0, 2]])
        along = (p[:, [0, 2]] - where[[0, 2]]) @ radial
        wide = (p[:, [0, 2]] - where[[0, 2]]) @ np.array([-radial[1], radial[0]])
        low, high = where[[0, 2]] + radial * along.max(), where[[0, 2]] + radial * along.min()
        y_low, y_high = (dune(-q[0], q[1], top) + STONE_HEIGHT for q in (low, high))
        ramps.append([*low, *high, y_low, float(np.ptp(wide)), max(0.02, y_high - y_low)])
        p[:, 1] += np.array([dune(-q[0], q[2], top) for q in p])
        laid[verts] = p
    path = MeshBuilder()
    uvs = stones["uvs"] % 1
    path.add([[(laid[i], uvs[i]) for i in tri] for tri in stones["triangles"] if owner[tri[0]] >= 0])
    return (
        blooms,
        swatches,
        path,
        path_image.quantize(256, dither=Image.Dither.FLOYDSTEINBERG).convert("RGB"),
        [[round(float(v), 3) for v in row] for row in ramps],
    )


def in_the_way(foot: np.ndarray) -> bool:
    """Whether a flower standing there would stand in the stair round the back or at its doors, or
    outside the side door."""
    bearing = float(np.arctan2(foot[0], foot[2])) % (2 * np.pi)
    margin = np.radians(8)
    out = float(np.hypot(foot[0], foot[2]))
    return (inside.BACK_BEARING - margin < bearing < inside.HALL_BEARING + margin and out < 24) or (
        abs(bearing - inside.SIDE_BEARING) < margin and out < 20
    )


def garden_image(doc: dict, blob: bytes, mesh: dict) -> Image.Image:
    """A garden mesh's texture as the model has it."""
    m = doc["materials"][mesh["material"]]
    texture = m["extensions"]["KHR_materials_pbrSpecularGlossiness"]["diffuseTexture"]["index"]
    view = doc["bufferViews"][doc["images"][doc["textures"][texture]["source"]]["bufferView"]]
    return Image.open(io.BytesIO(blob[view["byteOffset"] : view["byteOffset"] + view["byteLength"]])).convert("RGB")


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


def paint_slide(size: int = 128, dark: bool = False) -> Image.Image:
    """One repeat of the slide's steel, as the show paints it: pale periwinkle plates, two by two
    to the repeat, a dark seam between them with a rivet every so often along it; `dark` a shade
    darker, for the slide's floor against its sides."""
    rng = np.random.default_rng(11)
    img = Image.new("RGB", (size, size))
    px = img.load()
    plate = size // 2
    seam = 4
    tint = 14 if dark else 0
    shades = [
        (186 - tint, 198 - tint, 240 - tint // 2),
        (178 - tint, 190 - tint, 234 - tint // 2),
        (192 - tint, 204 - tint, 244 - tint // 2),
        (182 - tint, 194 - tint, 238 - tint // 2),
    ]
    for x in range(size):
        for y in range(size):
            c = shades[(x // plate + 2 * (y // plate)) % 4]
            if rng.random() < 0.05:
                c = (c[0] - 10, c[1] - 10, c[2] - 6)
            if x % plate < seam or y % plate < seam:
                c = (104, 116, 206)
            px[x, y] = c
    draw = ImageDraw.Draw(img)
    for k in range(size // 16 // 2, size, size // 8):  # rivets along the seams
        for cx, cy in ((k, seam // 2), (seam // 2, k), (k, plate + seam // 2), (plate + seam // 2, k)):
            draw.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=(76, 88, 180))
            draw.ellipse([cx - 2, cy - 3, cx, cy - 1], fill=(214, 222, 250))
    return img


def paint_rim(size: int = 64) -> Image.Image:
    """One repeat of the hatch's frame: dark blue steel, lighter along its top (the ring's inner
    edge and the bolts' heads take it) and darker along its bottom (the ring's outer edge)."""
    img = Image.new("RGB", (size, size), (84, 96, 190))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, size - 1, size // 8 - 1], fill=(150, 162, 228))
    draw.rectangle([0, size // 8, size - 1, size // 8 + 2], fill=(110, 122, 206))
    draw.rectangle([0, size - size // 8, size - 1, size - 1], fill=(52, 62, 150))
    return img


def paint_hatch_door(size: int = 256) -> Image.Image:
    """The hatch's door, as the show paints it, over the panel's whole face (across, and down from
    its top): a round steel door in a dark rim studded with rivets, a porthole high in it and a
    wheel to turn, on the plate's pale blue."""
    img = Image.new("RGB", (size, size), (176, 188, 236))
    draw = ImageDraw.Draw(img)
    top = inside.HATCH_CENTRE + inside.HATCH_ACROSS / 2
    cx, cy = size / 2, size * (1 - inside.HATCH_CENTRE / top)
    rx, ry = size / 2, size * (inside.HATCH_ACROSS / 2) / top

    def disc(
        k: float, fill: tuple[int, int, int] | None, outline: tuple[int, int, int] | None = None, width: int = 1
    ) -> None:
        draw.ellipse([cx - rx * k, cy - ry * k, cx + rx * k, cy + ry * k], fill=fill, outline=outline, width=width)

    disc(1.0, (84, 96, 190))
    disc(0.86, (188, 200, 242))
    disc(0.78, None, (146, 158, 220), 3)
    for i in range(20):
        a = 2 * np.pi * i / 20
        x, y = cx + rx * 0.93 * np.cos(a), cy + ry * 0.93 * np.sin(a)
        draw.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(52, 62, 150))
        draw.ellipse([x - 4, y - 5, x - 1, y - 2], fill=(160, 170, 226))
    px, py, pr = cx, cy - ry * 0.42, size * 0.11
    draw.ellipse([px - pr - 8, py - pr - 8, px + pr + 8, py + pr + 8], fill=(70, 84, 180))
    draw.ellipse([px - pr, py - pr, px + pr, py + pr], fill=(126, 204, 238))
    draw.ellipse([px - pr * 0.65, py - pr * 0.85, px - pr * 0.1, py - pr * 0.3], fill=(214, 242, 250))
    wx, wy, wr = cx, cy + ry * 0.3, size * 0.13
    draw.ellipse([wx - wr, wy - wr, wx + wr, wy + wr], outline=(60, 72, 160), width=8)
    for a in (0.0, np.pi / 2):
        draw.line(
            [wx - wr * np.cos(a), wy - wr * np.sin(a), wx + wr * np.cos(a), wy + wr * np.sin(a)],
            fill=(60, 72, 160),
            width=7,
        )
    draw.ellipse([wx - 9, wy - 9, wx + 9, wy + 9], fill=(60, 72, 160))
    return img


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
    painted (the rooms), whether only its outside is drawn, and the door it hangs on."""
    parts = [
        ("skin", "skin", True, False, False, None, None, True),
        ("passage", "steel", True, False, False, None, None, False),
        ("trim", "trim", False, False, False, None, None, False),
        ("flowers", "flowers", False, False, False, FLOWER_OPACITY, None, False),
        ("path", "path", False, False, False, None, None, False),
        ("door-front", "door", False, False, False, None, "front", False),
        ("interior", "interior", False, True, True, None, None, False),
        ("hatch", "slide", True, False, True, None, None, False),
        ("slide-floor", "slide-floor", True, False, True, None, None, False),
        ("hatch-rim", "hatch-rim", True, False, True, None, None, False),
        *((f"door-{d.id}", d.texture, False, d.texture == "interior", True, None, d.id, False) for d in doors),
    ]
    lines = [
        "// Generated by scripts/house-model.py; don't edit. The pineapple house's parts: each one's mesh",
        "// (public/assets/models/pineapple/<name>.bin), its texture (<texture>.png beside it),",
        "// whether the texture repeats (coordinates run past 1) or is an atlas, whether it has clear pixels,",
        "// whether it's drawn as painted rather than lit (the rooms, which the sun never reaches), how solid",
        "// it's drawn if it's see-through, whether only its outside is drawn (the skin, sealed all round,",
        "// so nothing looks at its inside), and the door it hangs on, if it swings (content/pineappleProfile.ts).",
        "export interface PineapplePart {",
        "  name: string;",
        "  texture: string;",
        "  wrap: boolean;",
        "  alpha: boolean;",
        "  unlit: boolean;",
        "  opacity?: number;",
        "  oneSided?: boolean;",
        "  door?: string;",
        "}",
        "",
        "export const PINEAPPLE_PARTS: readonly PineapplePart[] = [",
    ]
    for name, texture, wrap, alpha, unlit, opacity, door, one_sided in parts:
        extra = (
            (f", opacity: {opacity}" if opacity is not None else "")
            + (", oneSided: true" if one_sided else "")
            + (f", door: '{door}'" if door else "")
        )
        flags = f"wrap: {str(wrap).lower()}, alpha: {str(alpha).lower()}, unlit: {str(unlit).lower()}"
        lines.append(f"  {{ name: '{name}', texture: '{texture}', {flags}{extra} }},")
    lines += ["];", ""]
    PARTS_OUT.write_text("\n".join(lines))
    print(f"wrote {PARTS_OUT}: {len(parts)} parts")


def emit_profile(
    profile: Profile, doors: list[inside.Door], interior: inside.Interior, stones: list[list[float]]
) -> None:
    # Rings where the skin has leaned RING_LEAN since the last, or PROFILE_STEP up at most.
    ys = [0.0]
    for y in np.arange(0.5, profile[-1][0], 0.5):
        if abs(radius_at(profile, y) - radius_at(profile, ys[-1])) > RING_LEAN or y - ys[-1] >= PROFILE_STEP:
            ys.append(float(y))
    ys.append(profile[-1][0])
    rings = [(y, radius_at(profile, y)) for y in ys]
    levels = interior.levels
    num = lambda v: f"{v:.3f}".rstrip("0").rstrip(".")
    # Into the game's frame, the model's mirrored in x (house_mesh.MIRROR): x negated, a bearing
    # from +z negated, a way from +x turned to π less it, and a swing the other way round.
    across = lambda x: -x + 0.0
    bearing = lambda b: (-b) % (2 * np.pi)
    if interior.attic is None:
        raise SystemExit("the interior has no attic stair")
    attic = interior.attic
    if interior.hatch is None:
        raise SystemExit("the interior has no hatch")
    hatch = interior.hatch
    way = lambda a: (2 * np.pi - a) % (2 * np.pi) - np.pi
    lines = [
        "// Generated by packages/client/scripts/house-model.py; don't edit. The pineapple house's shape for",
        "// the sim (content/pineapple.ts), in metres in the house's frame (the door facing +z, y up from",
        "// the house's floor on the dune): the shell's rings from the ground up (height, radius); the dune",
        "// it stands on; the flat upright faces round the doors (each one's bearing from +z toward +x, the",
        "// arc of the shell's rings it takes the place of, and from how high to how high) and how thick",
        "// the sim's wall along them is; the front doorway and the vestibule behind (how far back its",
        "// steel wall stands); the rooms' levels (the ground floor's ceiling, the",
        "// first floor at the bedroom's floor and its ceiling, the library's floor, and the top of its wall,",
        "// above which the shell is solid); the library's wall, band by band up it (height, inside,",
        "// outside); the sim's wall along the face, as chords in bands ([x1, z1, x2, z2, y0, y1]); the",
        "// stair round the back and its platform, and the stairwell up from the corridor's end to the",
        "// library, piece by piece ([x, z, y, w, d, h, yaw]: centre, underside, size, the bearing it",
        "// faces); the attic stair up the cylinder standing on the library's ceiling to a deck on the",
        "// crown (its pieces the same way, slabs and rail posts; the cylinder's inside radius, wall",
        "// thickness, the ceiling it stands on, its floor and its top; the deck's radius, the height of",
        "// its top, its thickness, and the hole the stair comes up through: its inner radius and the",
        "// bearings, from +z toward +x, it runs between); the hatch high in the library's wall (its",
        "// bearing, the height of its sill, the circle it is cut to: across, and its centre's height over",
        "// the sill; and the radii its tube runs between) and the slide down from it, as ramps like the",
        "// path's stones; the doorways through",
        "// the shell for the sim (bearing from +z toward +x, width, bottom, top); the path's stones, each",
        "// a ramp lying with the dune ([lowX, lowZ, highX, highZ, y, w, h]: its downhill and uphill ends,",
        "// its underside at the downhill end, its width, its rise); and every door (its pin, the floor it",
        "// stands on, the way it runs from the pin shut, from +x toward +z, how far, how tall and thick,",
        "// and how far it swings).",
        "export const PINEAPPLE_PROFILE = {",
        f"  rings: [{', '.join(f'[{y:.2f}, {r:.2f}]' for y, r in rings)}],",
        f"  dune: {{ height: {num(DUNE_HEIGHT)}, top: {num(dune_top(profile))}, foot: {num(DUNE_FOOT)}, bulges: {DUNE_BULGES}, bulge: {num(BULGE)} }},",
        "  faces: ["
        + ", ".join(
            f"{{ bearing: {num(bearing(f.bearing))}, arc: {num(2 * np.arcsin(f.blend / radius_at(profile, f.floor)))}, "
            f"bottom: {num(f.floor)}, top: {num(f.blend_top)} }}"
            for f in FACES
        )
        + "],",
        f"  faceThickness: {num(FACE_THICKNESS)},",
        f"  doorway: {{ width: {num(DOOR_WIDTH)}, height: {num(DOOR_HEIGHT)} }},",
        f"  vestibule: {{ back: {num(interior.front_z)} }},",
        f"  levels: {{ ceiling: {num(levels['ceiling'])}, hall: {num(levels['hall'])}, hallCeiling: {num(levels['hallCeiling'])}, library: {num(levels['library'])}, top: {num(levels['top'])} }},",
        f"  library: [{', '.join(f'[{y:.2f}, {a:.2f}, {b:.2f}]' for y, a, b in inside.library_wall(interior, PROFILE_STEP))}],",
        "  faceWalls: ["
        + ", ".join(
            "[" + ", ".join(num(v) for v in (across(x1), z1, across(x2), z2, y0, y1)) + "]"
            for x1, z1, x2, z2, y0, y1 in face_walls(profile)
        )
        + "],",
        "  stair: ["
        + ", ".join(
            "[" + ", ".join(num(v) for v in (across(x), z, y, w, d, h, bearing(yaw))) + "]"
            for x, z, y, w, d, h, yaw in build_stair(profile, levels["hall"])
        )
        + "],",
        "  stairwell: ["
        + ", ".join(
            "[" + ", ".join(num(v) for v in (across(x), z, y, w, d, h, bearing(yaw))) + "]"
            for x, z, y, w, d, h, yaw in (interior.stairwell.steps if interior.stairwell else [])
        )
        + "],",
        "  stones: ["
        + ", ".join(
            "[" + ", ".join(num(v) for v in (across(lx), lz, across(hx), hz, y, w, h)) + "]"
            for lx, lz, hx, hz, y, w, h in stones
        )
        + "],",
        "  attic: {",
        "    steps: ["
        + ", ".join(
            "[" + ", ".join(num(v) for v in (across(x), z, y, w, d, h, bearing(yaw))) + "]"
            for x, z, y, w, d, h, yaw in attic.steps
        )
        + "],",
        (
            f"    cylinder: {{ r: {num(attic.cylinder[0])}, thickness: {num(attic.cylinder[1])}, bottom: {num(attic.cylinder[2])}, "
            f"floor: {num(attic.cylinder[3])}, top: {num(attic.cylinder[4])} }},"
        ),
        (
            f"    deck: {{ r: {num(attic.deck[0])}, y: {num(attic.deck[1])}, thickness: {num(attic.deck[2])}, "
            f"hole: {{ inner: {num(attic.deck_hole[0])}, from: {num(bearing(attic.deck_hole[2]))}, "
            f"to: {num(bearing(attic.deck_hole[2]) + attic.deck_hole[2] - attic.deck_hole[1])} }} }},"
        ),
        "  },",
        (
            f"  hatch: {{ bearing: {num(bearing(hatch.bearing))}, sill: {num(hatch.sill)}, across: {num(hatch.across)}, "
            f"centre: {num(hatch.centre)}, inner: {num(hatch.inner)}, outer: {num(hatch.outer)} }},"
        ),
        "  slide: ["
        + ", ".join(
            "[" + ", ".join(num(v) for v in (across(lx), lz, across(hx), hz, y, w, h)) + "]"
            for lx, lz, hx, hz, y, w, h in hatch.slide
        )
        + "],",
        "  doorways: [",
        f"    {{ bearing: {num(bearing(inside.BACK_BEARING))}, width: {num(inside.DOORWAY[0] + 0.6)}, bottom: 0, top: {num(inside.DOORWAY[1] + 0.4)} }},",
        f"    {{ bearing: {num(bearing(inside.HALL_BEARING))}, width: {num(inside.DOORWAY[0] + 0.6)}, bottom: {num(levels['hall'])}, top: {num(levels['hall'] + inside.DOORWAY[1] + 0.4)} }},",
        f"    {{ bearing: {num(bearing(inside.SIDE_BEARING))}, width: {num(inside.SIDE_DOORWAY[0] + 0.6)}, bottom: 0, top: {num(inside.SIDE_DOORWAY[1] + 0.4)} }},",
        "  ],",
        "  doors: [",
        *(
            f"    {{ id: '{d.id}', hinge: [{num(across(d.hinge[0]))}, {num(d.hinge[1])}], y: {num(d.y)}, bearing: {num(way(d.bearing))}, reach: {num(d.reach)}, height: {num(d.height)}, thickness: {num(d.thickness)}, swing: {num(-d.swing)} }},"
            for d in doors
        ),
        "  ],",
        "} as const;",
        "",
    ]
    PROFILE_OUT.write_text("\n".join(lines))
    print(f"wrote {PROFILE_OUT}: {len(rings)} rings, {len(doors)} doors")


def emit_boxes(boxes: list[list[float]]) -> None:
    # Into the game's frame: mirrored in x (house_mesh.MIRROR).
    lines = [
        "// Generated by packages/client/scripts/house-model.py; don't edit. The boxes the sim collides",
        "// with inside the pineapple house (content/pineapple.ts): every surface of the rooms and what's",
        "// in them, cut on a grid, each as [x, z, y, w, d, h] in metres in the house's frame (its centre",
        "// across, its underside, its size).",
        "export const PINEAPPLE_BOXES: readonly (readonly [number, number, number, number, number, number])[] = [",
        *(f"  [{', '.join(f'{v:g}' for v in (-x + 0.0, z, y, w, d, h))}]," for x, z, y, w, d, h in boxes),
        "];",
        "",
    ]
    BOXES_OUT.write_text("\n".join(lines))
    print(f"wrote {BOXES_OUT}: {len(boxes)} boxes")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
