"""The pineapple house's inside, from the Sbfbb SpongeBob House model on Sketchfab (cherylhill28,
CC-BY-4.0): the game's rooms, skinned into their bind pose and stood inside our shell at
INTERIOR_SCALE, the way in at our doorway. The model is three loose levels with nothing between
them: four rooms round a ground floor (the living room at the front, the closet beside it, the
kitchen behind and the bathroom behind that), the bedroom over the kitchen, and the library, a
round room the shape of the pineapple's top. This keeps all of it and builds what joins it up, in
the model's own textures: a hall at the bedroom's level, round it to the pineapple's inside, where
a spiral stair of the sim's comes up from the living room through a round well cut in its ceiling
and the bedroom's doors open; a straight flight along the hall's front up through its ceiling to
the landing before the library's door; all floored in the rooms' sand under net ceilings like the
rooms', the hall and landing walled in the library's bamboo (content/pineapple.ts builds the
flights).

What changes in the model: the painted front door and its wheel go (our door swings at the face,
and the model's frame stands at the back of the vestibule behind it), the door panels become doors
of the sim's, each hung on a pin at the edge the model's rig turns it on, the living room's ceiling
gets the well for the stair, and everything stands FLOOR_LIFT above the dune so its floor doesn't
fight the sand.

The sim collides with boxes cut from every surface on a VOXEL grid (walls, floors, ceilings and
furniture alike, so a couch is something to stand on), written with the rest to
content/pineappleInterior.ts.
"""

from __future__ import annotations

import io
from collections.abc import Callable
from dataclasses import dataclass, field
from itertools import pairwise
from pathlib import Path

import numpy as np
from glb import accessor, components, local_matrix, read_glb
from house_mesh import Outline, Triangle, area, circle, cut_out, disc, lathe
from PIL import Image

INTERIOR_SCALE = 0.5  # metres per unit of the model: its doors come out 3 m tall, players SpongeBob's size
FLOOR_LIFT = 0.02  # metres the rooms stand above the dune's top
VOXEL = 0.25  # metres: the grid the sim's boxes are cut on
STAIR_INNER = 0.9  # metres: the spiral's post
WELL = 0.1  # metres a stair's well reaches past its flight's outer edge: clear of the steps' corners
WELL_HEADROOM = 2.7  # metres under the hall's floor from which the spiral needs its opening
LINING = 0.35  # metres inside the shell's skin the hall's wall stands
SEGMENTS = 72  # round the hall's wall and floor
# The spiral in the living room (x, z, outer radius): clear of the furniture, starting at +x so its
# first turn passes over the television.
SPIRAL = (5.0, 7.0, 3.0)
# The flight from the hall up to the landing: its foot and head on the floor and its width. It runs
# along the hall's front, outside the library's wall above, inside the hall's wall below.
FLIGHT = ((-5.2, 14.9), (5.6, 14.9), 2.4)
FLIGHT_SLOT = 0.15  # metres of room round the flight in the floors it climbs through
# Metres of tread under a floor from which the flight's slot in it starts: a head under the floor's
# half-metre boxes, with the grid's slack and a riser to spare, so no one walking down meets it.
FLIGHT_HEADROOM = 3.5
LANDING_SECTOR = np.radians(32)  # either side of the library's door the landing reaches
LANDING_HEIGHT = 4.0  # metres of ceiling over the landing
LIBRARY_SKIRT = 12.0  # radius the landing's floor and ceiling start from: under the library's wall's foot
# Metres of surface one repeat of a texture covers, as the model's rooms map them.
SAND_TILE = 3.4
CEILING_TILE = 5.9
NET_TILE = 2.65
BAMBOO_TILE = 2.0
QUANTIZE = 48  # colours a texture is brought down to: the flat shading of the world's own pixel textures
TEXTURE_PAD = 8  # pixels of a texture's own edge repeated round it in the atlas, for the coarser mipmaps
SWATCHES = {"Wringer": (118, 126, 138), "Typewriter": (58, 60, 68), "Typewriter_Buttons": (198, 198, 204)}
# The library's wall and the bamboo on it: round, so the sim gets them as rings from the profile
# (house-model.py) instead of boxes.
ROUND_WALLS = ("Library_Wall", "Library_Bamboo")
# The door panels: which end of each (along its length) the pin is at, from the model's rig where it
# has one, and which way it swings: into the room it closes.
DOORS = (
    ("closet", (-2.5, 2.6), "min", -1),
    ("bathroom", (2.2, -2.6), "max", 1),
    ("bedroom-east", (0.5, -5.5), "min", 1),
    ("bedroom-west", (-10.3, -5.6), "min", -1),
    ("library", (0.3, 12.2), "max", -1),
)
DOOR_THICKNESS = 0.15  # metres a panel the model made paper-thin is for the sim


@dataclass
class Door:
    id: str
    hinge: tuple[float, float]  # the pin, in the house's frame
    y: float  # the floor it stands on
    bearing: float  # the way the panel runs from the pin when shut, radians from +x toward +z
    reach: float
    height: float
    thickness: float
    swing: float  # radians it turns to open, the same way round as the bearing
    mesh: list[Triangle]  # the panel about its pin on the floor, textured in the atlas


@dataclass
class Interior:
    tris: list[tuple[Triangle, int]]  # every surface that stays, with its material
    materials: list[str]
    images: dict[int, Image.Image | None]
    doors: list[Door]
    front: Outline  # the model's front door frame's outer edge, in the wall's (x, y) plane
    front_z: float  # where the vestibule's back wall stands: just outside the room's wall, within the frame's depth
    solid: list[Triangle] = field(default_factory=list)  # what the sim gets boxes for
    levels: dict[str, float] = field(default_factory=dict)
    bedroom_walls: Outline = field(default_factory=list)  # the bedroom's walls' footprint
    bedroom_floor: Outline = field(default_factory=list)  # its floor's, a little past the walls


def load(path: str) -> Interior:
    """The model in the house's frame: skinned into its bind pose (the rig only turns it upright),
    scaled, and shifted so its ground floor is centred on the house's axis, where its front door
    lands on the axis too."""
    doc, blob = read_glb(Path(path).read_bytes())
    world: dict[int, np.ndarray] = {}

    def walk(n: int, parent: np.ndarray) -> None:
        m = parent @ local_matrix(doc["nodes"][n])
        world[n] = m
        for c in doc["nodes"][n].get("children", []):
            walk(c, m)

    for root in doc["scenes"][0]["nodes"]:
        walk(root, np.eye(4))
    skin = doc["skins"][0]
    binds = accessor(doc, blob, skin["inverseBindMatrices"]).reshape(-1, 4, 4)
    joints = [world[j] @ binds[i].T for i, j in enumerate(skin["joints"])]
    positions, normals, uvs, tris, mats = [], [], [], [], []
    base = 0
    for node in doc["nodes"]:
        if "mesh" not in node:
            continue
        for prim in doc["meshes"][node["mesh"]]["primitives"]:
            pos = accessor(doc, blob, prim["attributes"]["POSITION"])
            nrm = accessor(doc, blob, prim["attributes"]["NORMAL"])
            weights = accessor(doc, blob, prim["attributes"]["WEIGHTS_0"])
            bones = accessor(doc, blob, prim["attributes"]["JOINTS_0"]).astype(int)
            skinned = np.zeros((len(pos), 3))
            turned = np.zeros((len(pos), 3))
            hom = np.c_[pos, np.ones(len(pos))]
            for k in range(4):
                for j in np.unique(bones[:, k]):
                    sel = bones[:, k] == j
                    skinned[sel] += weights[sel, k : k + 1] * (hom[sel] @ joints[j].T)[:, :3]
                    turned[sel] += weights[sel, k : k + 1] * (nrm[sel] @ joints[j][:3, :3].T)
            positions.append(skinned)
            normals.append(turned)
            uvs.append(accessor(doc, blob, prim["attributes"]["TEXCOORD_0"]))
            idx = accessor(doc, blob, prim["indices"]).reshape(-1, 3).astype(int)
            tris.append(idx + base)
            mats.append(np.full(len(idx), prim["material"]))
            base += len(pos)
    points = np.concatenate(positions)
    normal = np.concatenate(normals)
    uv = np.concatenate(uvs)
    triangles = np.concatenate(tris)
    material = np.concatenate(mats)
    names = [m["name"] for m in doc["materials"]]
    images: dict[int, Image.Image | None] = {}
    for i, m in enumerate(doc["materials"]):
        texture = m.get("pbrMetallicRoughness", {}).get("baseColorTexture", {}).get("index")
        if texture is None:
            images[i] = None
            continue
        view = doc["bufferViews"][doc["images"][doc["textures"][texture]["source"]]["bufferView"]]
        images[i] = Image.open(io.BytesIO(blob[view["byteOffset"] : view["byteOffset"] + view["byteLength"]])).convert(
            "RGB"
        )

    # Wound to agree with the model's normals, so a face's winding says which way it faces from
    # here on (the cuts below keep winding, not the attribute).
    a, b, c = points[triangles[:, 0]], points[triangles[:, 1]], points[triangles[:, 2]]
    face = np.cross(b - a, c - a)
    meant = normal[triangles].sum(axis=1)
    flip = np.einsum("ij,ij->i", face, meant) < 0
    triangles[flip] = triangles[flip][:, [0, 2, 1]]
    print(f"interior: {len(triangles)} triangles, {int(flip.sum())} rewound to face as the model's normals say")

    sand = names.index("Sand_Floor")
    ground = np.unique(triangles[(material == sand) & (points[triangles[:, 0], 1] < 1)])
    lo, hi = points[ground].min(axis=0), points[ground].max(axis=0)
    origin = np.array([(lo[0] + hi[0]) / 2, 0.0, (lo[2] + hi[2]) / 2])
    points = (points - origin) * INTERIOR_SCALE + [0, FLOOR_LIFT, 0]
    kept = [([(points[i], uv[i]) for i in tri], int(m)) for tri, m in zip(triangles, material)]
    interior = Interior(kept, names, images, [], [], 0.0)
    take_apart(interior)
    return interior


def comps(interior: Interior, name: str) -> list[list[int]]:
    """The separate pieces of a material: lists of indices into the interior's triangles."""
    m = interior.materials.index(name)
    which = [k for k, (_, mat) in enumerate(interior.tris) if mat == m]
    if not which:
        return []
    pos = np.array([p for k in which for p, _ in interior.tris[k][0]])
    parts = components({"positions": pos, "triangles": np.arange(len(pos)).reshape(-1, 3)})
    by_vertex = {}
    for g, verts in enumerate(parts):
        for v in verts:
            by_vertex[int(v)] = g
    groups: dict[int, list[int]] = {}
    for n, k in enumerate(which):
        groups.setdefault(by_vertex[3 * n], []).append(k)
    return list(groups.values())


def bounds(interior: Interior, which: list[int]) -> tuple[np.ndarray, np.ndarray]:
    pos = np.array([p for k in which for p, _ in interior.tris[k][0]])
    return pos.min(axis=0), pos.max(axis=0)


def take_apart(interior: Interior) -> None:
    """Finds the model's doors, windows and front frame, and takes out what this house does its own
    way: the painted front door and its wheel, the windows' glass, the door panels (kept aside as
    doors), and the living room's ceiling where the stair comes through."""
    drop: set[int] = set()
    frames = comps(interior, "Metal_Doors_and_Window_Borders")
    front = max(frames, key=lambda ks: bounds(interior, ks)[1][2])
    kept_frame: list[int] = []
    for k in front:
        tri, _ = interior.tris[k]
        p, q, r = (v for v, _ in tri)
        n = np.cross(q - p, r - p)
        if abs(n[2]) > 0.9 * np.linalg.norm(n) and area(tri) > 1.0:
            drop.add(k)  # the painted door: a sheet across the frame
        else:
            kept_frame.append(k)
    print(f"front door: {len(front) - len(kept_frame)} triangles of painted door dropped from its frame")
    outline = np.array([p[[0, 1]] for k in kept_frame for p, _ in interior.tris[k][0]])
    interior.front = shrunk(hull(outline), 0.05)
    interior.front_z = float(bounds(interior, kept_frame)[1][2]) - 0.13
    for ks in frames:
        lo, hi = bounds(interior, ks)
        if ks is not front and hi[2] > 12 and abs((lo[0] + hi[0]) / 2) < 1 and lo[1] > 0.5:
            drop.update(ks)  # the wheel on the painted door
    for ks in comps(interior, "Doors"):
        lo, hi = bounds(interior, ks)
        centre = ((lo + hi) / 2)[[0, 2]]
        panel = hi[1] - lo[1] >= 2.5 and min(hi[0] - lo[0], hi[2] - lo[2]) <= 0.6
        if panel and min(np.hypot(*(np.array(d[1]) - centre)) for d in DOORS) < 1.5:
            interior.doors.append(make_door(interior, ks))
            drop.update(ks)
    interior.tris = [t for k, t in enumerate(interior.tris) if k not in drop]
    interior.solid = [t for t, m in interior.tris if interior.materials[m] not in ROUND_WALLS]
    # The levels, from the model: the ground floor's ceiling, the bedroom's floor and ceiling (the
    # hall's), the library's floor, and the top of its wall.
    ceilings = sorted(bounds(interior, ks)[0][1] for ks in comps(interior, "Ceiling"))
    bedroom = max(comps(interior, "Sand_Floor"), key=lambda ks: bounds(interior, ks)[0][1])
    interior.levels = {
        "ceiling": float(ceilings[0]),
        "hall": float(bounds(interior, bedroom)[0][1]),
        "hallCeiling": float(ceilings[-1]),
        "library": float(bounds(interior, comps(interior, "Library_Floor")[0])[0][1]),
        "top": float(max(bounds(interior, ks)[1][1] for ks in comps(interior, "Library_Wall"))),
    }
    print("levels:", {k: round(v, 2) for k, v in interior.levels.items()})
    walls = [k for ks in comps(interior, "Metal_Walls") if bounds(interior, ks)[0][1] > 5 for k in ks]
    walls += [k for ks in comps(interior, "Red_Walls") for k in ks]
    interior.bedroom_walls = shrunk(hull(np.array([p[[0, 2]] for k in walls for p, _ in interior.tris[k][0]])), -0.02)
    interior.bedroom_floor = shrunk(hull(np.array([p[[0, 2]] for k in bedroom for p, _ in interior.tris[k][0]])), -0.02)
    well = circle(SPIRAL[0], SPIRAL[1], SPIRAL[2] + WELL)
    for name in ("Ceiling", "Netting"):
        ks = next(ks for ks in comps(interior, name) if covers(bounds(interior, ks), SPIRAL[0], SPIRAL[1]))
        cut_in_plane(interior, ks, well)


def covers(box: tuple[np.ndarray, np.ndarray], x: float, z: float) -> bool:
    lo, hi = box
    return bool(lo[0] <= x <= hi[0] and lo[2] <= z <= hi[2])


def hull(points: np.ndarray) -> Outline:
    """The convex hull of 2D points, counter-clockwise (Andrew's monotone chain)."""
    pts = sorted({(float(x), float(y)) for x, y in points})
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower: list[tuple[float, float]] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 1e-12:
            lower.pop()
        lower.append(p)
    upper: list[tuple[float, float]] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 1e-12:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def shrunk(outline: Outline, by: float) -> Outline:
    """A convex outline pulled in toward its centroid by about `by` (out, for a negative `by`),
    corners that meet dropped."""
    c = np.mean(outline, axis=0)
    out: Outline = []
    for x, y in outline:
        d = np.array([x, y]) - c
        d -= d / (np.linalg.norm(d) + 1e-9) * by
        p = (float(c[0] + d[0]), float(c[1] + d[1]))
        if not out or np.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 1e-3:
            out.append(p)
    return out


def make_door(interior: Interior, ks: list[int]) -> Door:
    """A door panel as a door of the sim's and a part about its pin."""
    lo, hi = bounds(interior, ks)
    centre = ((lo + hi) / 2)[[0, 2]]
    id_, _, end, side = min(DOORS, key=lambda d: np.hypot(*(np.array(d[1]) - centre)))
    length_axis = 0 if hi[0] - lo[0] >= hi[2] - lo[2] else 2
    across_axis = 2 - length_axis
    thickness = max(float(hi[across_axis] - lo[across_axis]), DOOR_THICKNESS)
    reach = float(hi[length_axis] - lo[length_axis])
    at, other = (lo, hi) if end == "min" else (hi, lo)
    bearing = (
        (0.0 if length_axis == 0 else np.pi / 2)
        if other[length_axis] > at[length_axis]
        else (np.pi if length_axis == 0 else -np.pi / 2)
    )
    # A swing of a quarter turn the bearing's way opens toward +90°; if the room is the other
    # side, the door turns the other way, and hangs on the far face of its pin (doors.ts).
    opens = np.array([-np.sin(bearing), np.cos(bearing)])
    sign = 1.0 if opens[0 if across_axis == 0 else 1] * side > 0 else -1.0
    mid = (lo[across_axis] + hi[across_axis]) / 2
    pin = [0.0, 0.0]
    pin[0 if length_axis == 0 else 1] = float(at[length_axis])
    pin[0 if across_axis == 0 else 1] = float(mid + sign * side * thickness / 2)
    shift = np.array([-pin[0], -lo[1], -pin[1]])
    mesh = [[(p + shift, q) for p, q in interior.tris[k][0]] for k in ks]
    print(
        f"door {id_}: pin ({pin[0]:.2f}, {pin[1]:.2f}) on floor {lo[1]:.2f}, {reach:.2f} m long, {hi[1] - lo[1]:.2f} tall, swings {'+' if sign > 0 else '-'}90°"
    )
    return Door(
        id_,
        (pin[0], pin[1]),
        float(lo[1]),
        float(bearing),
        reach,
        float(hi[1] - lo[1]),
        thickness,
        sign * np.pi / 2,
        mesh,
    )


def flat_xz(p: np.ndarray) -> np.ndarray:
    return p[[0, 2]]


def cut_in_plane(interior: Interior, ks: list[int], hole: Outline) -> None:
    """Cuts a round hole out of a flat piece (a ceiling), in place in the interior's list."""
    tris = [interior.tris[k][0] for k in ks]
    m = interior.tris[ks[0]][1]
    cut, rest = cut_out(tris, hole, flat_xz, about(hole))
    for k in sorted(ks, reverse=True):
        del interior.tris[k]
    interior.tris += [(t, m) for t in cut + rest]
    interior.solid = [t for t, m in interior.tris if interior.materials[m] not in ROUND_WALLS]


def material(interior: Interior, name: str) -> int:
    return interior.materials.index(name)


def build_floors(
    interior: Interior, skin: Callable[[float, float], float], angles: list[float], heights: list[float]
) -> None:
    """The hall at the bedroom's floor, round it to the pineapple's inside, and the landing before
    the library's door: floors in the rooms' sand, ceilings in their net, walls in the library's
    bamboo, the spiral's well a drum from the living room's ceiling up to the hall's floor, and
    the flight's slot a shaft from the hall's ceiling up to the landing's floor. The hall's floor
    and ceiling stop at the bedroom's own, edge to edge. `skin(a, y)` is the shell's radius at a
    bearing (from +z toward +x) and a height, `angles` the bearings it is turned at and `heights`
    its rings, so the hall's wall, turned at the same ones, keeps a wall's thickness inside it
    everywhere, where the shell is flattened into the face round the door too."""
    levels = interior.levels
    hall, ceiling, library = levels["hall"], levels["hallCeiling"], levels["library"]
    landing_top = library + LANDING_HEIGHT
    wall = lambda a, y: skin(a, y) - LINING
    sand, net, lid, bamboo = (material(interior, n) for n in ("Sand_Floor", "Netting", "Ceiling", "Library_Bamboo"))
    pieces: list[tuple[list[Triangle], int]] = []
    # The well's opening in the hall's floor: only where the spiral comes up through it, from where
    # a head on the steps would meet the floor (the spiral rises `hall` in its one turn, from angle
    # 0, in the drum's 24 segments) round to where it arrives; the post's top is floored.
    arrival = 2 * np.pi * np.floor(24 * (1 - WELL_HEADROOM / hall)) / 24
    well = wedge(SPIRAL[0], SPIRAL[1], SPIRAL[2] + WELL, arrival, 2 * np.pi)
    post = wedge(SPIRAL[0], SPIRAL[1], STAIR_INNER - 0.1, arrival, 2 * np.pi)
    fx1 = FLIGHT[1][0]
    slot = lambda y, end=fx1 + FLIGHT_SLOT, side=FLIGHT_SLOT: flight_slot(levels, y, end, side)

    pieces.append(
        (
            round_floor(hall, lambda a: wall(a, hall) - 0.05, False, [interior.bedroom_floor, well], SAND_TILE)
            + wedge_floor(hall, post, SAND_TILE),
            sand,
        )
    )
    shaft, shaft_hole = slot(ceiling)
    lid_edge = lambda a: wall(a, ceiling) - 0.05
    pieces.append((round_floor(ceiling, lid_edge, True, [interior.bedroom_walls, shaft_hole], CEILING_TILE), lid))
    pieces.append((round_floor(ceiling - 0.1, lid_edge, True, [interior.bedroom_walls, shaft_hole], NET_TILE), net))
    # The wall: the shell's inside, LINING in from the skin so it leans out with it; above the hall's
    # ceiling only where the landing is. Where it stands in from the round (behind the face) the
    # sim gets it as boxes, since the shell's rings are round.
    place = lambda a, y: np.array([wall(a, y) * np.sin(a), y, wall(a, y) * np.cos(a)])
    rings = [(y, wall(0.0, y)) for y in sorted({hall, ceiling, *(y for y in heights if hall < y < ceiling)})]
    hall_wall = lathe(rings, BAMBOO_TILE, place, angles=angles)
    pieces.append((hall_wall, bamboo))
    round_wall = {y: max(wall(a, y) for a in angles) for y, _ in rings}
    faced = [
        tri
        for tri in hall_wall
        if any(np.hypot(p[0], p[2]) < round_wall[min(round_wall, key=lambda y: abs(y - p[1]))] - 0.01 for p, _ in tri)
    ]
    rings = [
        (y, wall(0.0, y)) for y in sorted({ceiling, landing_top, *(y for y in heights if ceiling < y < landing_top)})
    ]
    sector_angles = [float(a) for a in np.linspace(-LANDING_SECTOR, LANDING_SECTOR, 13)]
    pieces.append((lathe(rings, BAMBOO_TILE, place, angles=sector_angles), bamboo))
    # The spiral's well, and the flight's shaft.
    r = SPIRAL[2] + WELL
    drum = lambda a, y: np.array([SPIRAL[0] + r * np.sin(a), y, SPIRAL[1] + r * np.cos(a)])
    pieces.append((lathe([(levels["ceiling"], r), (hall, r)], BAMBOO_TILE, drum, segments=24, axis=SPIRAL[:2]), bamboo))
    sx0, sx1, sz0, sz1 = shaft
    inside_shaft = ((sx0 + sx1) / 2, (sz0 + sz1) / 2)
    for a, b in (
        ((sx0, sz0), (sx1, sz0)),
        ((sx1, sz0), (sx1, sz1)),
        ((sx1, sz1), (sx0, sz1)),
        ((sx0, sz1), (sx0, sz0)),
    ):
        pieces.append((upright(a, b, ceiling, library, inside_shaft), bamboo))
    # The landing: a sector of floor and ceiling between the library's wall and the hall's, the
    # flight arriving through its floor, and a wall closing each side.
    _, landing_hole = slot(library, fx1, 0.0)
    floor = sector(library, LIBRARY_SKIRT, wall(0.0, library) - 0.05, False, landing_hole, flat_tile(SAND_TILE))
    # In the library's doorway, with no wall to hide the two overlapping, the landing's floor stops
    # where the library's own ends, edge to edge.
    boards = material(interior, "Library_Floor")
    threshold = max(
        p[2] for tri, m in interior.tris if m == boards for p, _ in tri if abs(p[0]) < 1.5 and abs(p[1] - library) < 0.3
    )
    doorway = [(-1.5, LIBRARY_SKIRT - 1.0), (1.5, LIBRARY_SKIRT - 1.0), (1.5, threshold), (-1.5, threshold)]
    cut, rest = cut_out(floor, doorway, flat_xz, about(doorway))
    pieces.append((cut + rest, sand))
    pieces.append(
        (sector(landing_top, LIBRARY_SKIRT, wall(0.0, landing_top) - 0.05, True, None, flat_tile(CEILING_TILE)), lid)
    )
    pieces.append(
        (sector(landing_top - 0.1, LIBRARY_SKIRT, wall(0.0, landing_top) - 0.05, True, None, flat_tile(NET_TILE)), net)
    )
    for side in (-1, 1):
        a = side * LANDING_SECTOR
        along = (np.sin(a), np.cos(a))
        foot = (LIBRARY_SKIRT * along[0], LIBRARY_SKIRT * along[1])
        far = ((wall(a, library) - 0.05) * along[0], (wall(a, library) - 0.05) * along[1])
        pieces.append((upright(foot, far, library, landing_top, (0.0, 15.0)), bamboo))
    for tris, m in pieces:
        interior.tris += [(t, m) for t in tris]
    # The hall's wall is round: the sim gets it as a ring from the profile, not boxes, but for where
    # it stands in from the round.
    interior.solid += [t for tris, _ in pieces[:3] + pieces[5:] for t in tris] + faced


def flat_tile(tile: float) -> Callable[[np.ndarray], np.ndarray]:
    """Texture coordinates for a level surface: tiled from the house's axis."""
    return lambda p: np.array([p[0] / tile, p[2] / tile])


def round_floor(y: float, r: Callable[[float], float], down: bool, holes: list[Outline], tile: float) -> list[Triangle]:
    """A round floor (or ceiling, facing down) at a height, reaching the radius `r` gives at each
    bearing, with holes cut out of it."""
    ring = [np.array([r(a) * np.sin(a), y, r(a) * np.cos(a)]) for a in 2 * np.pi * np.arange(SEGMENTS) / SEGMENTS]
    tris = disc(ring, np.array([0.0, y, 0.0]), down, flat_tile(tile))
    for hole in holes:
        cut, rest = cut_out(tris, hole, flat_xz, about(hole))
        tris = cut + rest
    return tris


def flight_slot(levels: dict[str, float], y: float, end: float, side: float = FLIGHT_SLOT) -> tuple[Rect, Outline]:
    """The flight's slot in a floor at a height: from where a tread is FLIGHT_HEADROOM under it to
    `end` (past the flight's head, or at it for the floor it arrives on, so the last step meets the
    floor with no crack), `side` wider than the flight either side (none for the floor it arrives
    on, whose edges meet the flight's rails)."""
    (fx0, fz), (fx1, _), fw = FLIGHT
    hall, rise = levels["hall"], levels["library"] - levels["hall"]
    x0 = fx0 + (fx1 - fx0) * (y - FLIGHT_HEADROOM - hall) / rise - FLIGHT_SLOT
    rect = (x0, end, fz - fw / 2 - side, fz + fw / 2 + side)
    return rect, [(rect[0], rect[2]), (rect[1], rect[2]), (rect[1], rect[3]), (rect[0], rect[3])]


def landing_slot(interior: Interior) -> Rect:
    """The flight's slot in the landing's floor, for the rails the sim stands round it."""
    return flight_slot(interior.levels, interior.levels["library"], FLIGHT[1][0], 0.0)[0]


def wedge(cx: float, cz: float, r: float, a0: float, a1: float) -> Outline:
    """A pie slice's outline, counter-clockwise: its point at (cx, cz), its arc from angle a0 round
    to a1 (from +x toward +z, less than a half turn, so it's convex) in the drum's 24 segments."""
    steps = round(24 * (a1 - a0) / (2 * np.pi))
    return [(cx, cz)] + [(cx + r * np.cos(a), cz + r * np.sin(a)) for a in np.linspace(a0, a1, steps + 1)]


def wedge_floor(y: float, outline: Outline, tile: float) -> list[Triangle]:
    """A level pie slice at a height, facing up: a fan from its point over its arc."""
    centre = np.array([outline[0][0], y, outline[0][1]])
    tex = flat_tile(tile)
    tris: list[Triangle] = []
    for (ax, az), (bx, bz) in pairwise(outline[1:]):
        a, b = np.array([ax, y, az]), np.array([bx, y, bz])
        tri = [centre, a, b] if np.cross(a - centre, b - centre)[1] > 0 else [centre, b, a]
        tris.append([(p, tex(p)) for p in tri])
    return tris


def sector(
    y: float, inner: float, outer: float, down: bool, hole: Outline | None, tex: Callable[[np.ndarray], np.ndarray]
) -> list[Triangle]:
    """A level ring sector either side of +z between two radii, facing down or up, with a hole."""
    tris: list[Triangle] = []
    for a0, a1 in pairwise(np.linspace(-LANDING_SECTOR, LANDING_SECTOR, 13)):
        ring = lambda a, r: np.array([r * np.sin(a), y, r * np.cos(a)])
        quad = [ring(a0, inner), ring(a1, inner), ring(a1, outer), ring(a0, outer)]
        for tri in ([quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]):
            if (np.cross(tri[1] - tri[0], tri[2] - tri[0])[1] < 0) != down:
                tri = [tri[0], tri[2], tri[1]]
            tris.append([(p, tex(p)) for p in tri])
    if hole:
        cut, rest = cut_out(tris, hole, flat_xz, about(hole))
        tris = cut + rest
    return tris


Rect = tuple[float, float, float, float]  # x0, x1, z0, z1


def about(hole: Outline) -> Callable[[Triangle], bool]:
    """Whether a triangle's footprint overlaps a hole's: the ones worth cutting."""
    xs, zs = zip(*hole)
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    return lambda tri: (
        not (
            all(p[0] < x0 for p, _ in tri)
            or all(p[0] > x1 for p, _ in tri)
            or all(p[2] < z0 for p, _ in tri)
            or all(p[2] > z1 for p, _ in tri)
        )
    )


def upright(
    a: tuple[float, float], b: tuple[float, float], y0: float, y1: float, inside: tuple[float, float]
) -> list[Triangle]:
    """A wall from a to b (on the floor) between two heights, facing the side `inside` is on, the
    bamboo running along it and up."""
    along = np.array([b[0] - a[0], 0, b[1] - a[1]])
    length = float(np.linalg.norm(along))
    normal = np.array([along[2], 0, -along[0]]) / length
    if normal @ np.array([inside[0] - a[0], 0, inside[1] - a[1]]) < 0:
        normal = -normal
    corners = [
        np.array([a[0], y0, a[1]]),
        np.array([b[0], y0, b[1]]),
        np.array([b[0], y1, b[1]]),
        np.array([a[0], y1, a[1]]),
    ]
    tex = lambda p: np.array(
        [float(np.linalg.norm(p - corners[0] * [1, 0, 1] - [0, p[1], 0])) / BAMBOO_TILE, -p[1] / BAMBOO_TILE]
    )
    tris = []
    for tri in ([corners[0], corners[1], corners[2]], [corners[0], corners[2], corners[3]]):
        if np.cross(tri[1] - tri[0], tri[2] - tri[0]) @ normal < 0:
            tri = [tri[0], tri[2], tri[1]]
        tris.append([(p, tex(p)) for p in tri])
    return tris


def library_wall(interior: Interior, step: float) -> list[tuple[float, float, float]]:
    """The library's wall, every `step` up from its floor to its top: the least and greatest radius
    its vertices reach in each band, a little either way, for the sim's rings."""
    pts = np.array([p for ks in comps(interior, "Library_Wall") for k in ks for p, _ in interior.tris[k][0]])
    out = []
    y = interior.levels["library"]
    while y < interior.levels["top"] - 1e-6:
        band = pts[(pts[:, 1] >= y - 0.5) & (pts[:, 1] < y + step + 0.5)]
        radii = np.hypot(band[:, 0], band[:, 2])
        out.append((y, float(radii.min()) - 0.1, float(radii.max()) + 0.1))
        y += step
    return out


def split_repeats(tri: Triangle) -> list[Triangle]:
    """A triangle cut along every whole number its texture coordinates cross, so each piece lies
    within one repeat of its texture (what an atlas can hold), the pieces' coordinates brought
    down to that repeat."""
    polys = [list(tri)]
    for axis in (0, 1):
        lo = min(q[axis] for _, q in tri)
        hi = max(q[axis] for _, q in tri)
        for k in range(int(np.floor(lo)) + 1, int(np.ceil(hi))):
            split: list[list] = []
            for poly in polys:
                for keep_low in (True, False):
                    piece: list = []
                    for i in range(len(poly)):
                        p, q = poly[i], poly[(i + 1) % len(poly)]
                        sp, sq = p[1][axis] - k, q[1][axis] - k
                        in_p, in_q = (
                            (sp <= 1e-9) == keep_low or abs(sp) < 1e-9,
                            (sq <= 1e-9) == keep_low or abs(sq) < 1e-9,
                        )
                        if in_p:
                            piece.append(p)
                        if in_p != in_q and abs(sp - sq) > 1e-12:
                            f = sp / (sp - sq)
                            piece.append((p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f))
                    if len(piece) >= 3:
                        split.append(piece)
            polys = split
    out: list[Triangle] = []
    for poly in polys:
        base = np.floor(np.min([q for _, q in poly], axis=0))
        shifted = [(p, np.clip(q - base, 0, 1)) for p, q in poly]
        out += [
            t for t in ([shifted[0], shifted[i], shifted[i + 1]] for i in range(1, len(shifted) - 1)) if area(t) > 1e-9
        ]
    return out


def pack_atlas(
    interior: Interior, quantize: int = QUANTIZE
) -> tuple[Image.Image, dict[int, tuple[float, float, float, float]]]:
    """One image of every texture the rooms use, each at its own size with its edge repeated
    TEXTURE_PAD round it, brought down to `quantize` colours (no dither, so shading goes flat like
    the world's painted textures), the netting's black made clear; and where each material's
    repeat lies in it (left, top, width, height, as fractions)."""
    cells: list[tuple[int, Image.Image]] = []
    for m, name in enumerate(interior.materials):
        image = interior.images[m]
        if image is None:
            image = Image.new("RGB", (8, 8), SWATCHES[name])
        else:
            image = image.quantize(quantize, dither=Image.Dither.NONE).convert("RGB")
        rgba = image.convert("RGBA")
        if name == "Netting":
            px = np.array(rgba)
            px[(px[:, :, :3].max(axis=2) < 40), 3] = 0
            rgba = Image.fromarray(px)
        cells.append((m, rgba))
    cells.sort(key=lambda c: -c[1].height)
    width = 1024
    spots: dict[int, tuple[int, int, int, int]] = {}
    x = y = row = 0
    for m, image in cells:
        w, h = image.width + 2 * TEXTURE_PAD, image.height + 2 * TEXTURE_PAD
        if x + w > width:
            x, y, row = 0, y + row, 0
        spots[m] = (x, y, image.width, image.height)
        x += w
        row = max(row, h)
    height = y + row
    atlas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for m, image in cells:
        x, y, w, h = spots[m]
        padded = np.pad(
            np.asarray(image), ((TEXTURE_PAD, TEXTURE_PAD), (TEXTURE_PAD, TEXTURE_PAD), (0, 0)), mode="edge"
        )
        atlas.paste(Image.fromarray(padded), (x, y))
    places = {
        m: ((x + TEXTURE_PAD) / width, (y + TEXTURE_PAD) / height, w / width, h / height)
        for m, (x, y, w, h) in spots.items()
    }
    print(f"interior atlas {width}x{height} from {len(cells)} textures")
    return atlas, places


def in_atlas(tris: list[tuple[Triangle, int]], places: dict[int, tuple[float, float, float, float]]) -> list[Triangle]:
    """The triangles with their coordinates moved into their material's place in the atlas, each
    first cut to lie within one repeat."""
    out: list[Triangle] = []
    for tri, m in tris:
        x, y, w, h = places[m]
        for piece in split_repeats(tri):
            out.append([(p, np.array([x + q[0] * w, y + q[1] * h])) for p, q in piece])
    return out


def voxel_boxes(tris: list[Triangle], size: float = VOXEL) -> list[list[float]]:
    """Boxes for the sim covering every surface: each triangle marks the two grid cells behind it
    (against its normal, so a floor's box tops out at the floor and a wall's stands behind its face,
    half a metre thick), and runs of marked cells are merged into boxes, longest along x first.
    Each box is [x, z, y, w, d, h]: its centre across, its underside, its size."""
    origin = np.array([-25.0, -1.0, -25.0])
    shape = (int(50 / size), int(45 / size), int(50 / size))
    filled = np.zeros(shape, bool)
    step = size / 2
    for tri in tris:
        a, b, c = (p for p, _ in tri)
        n = np.cross(b - a, c - a)
        length = np.linalg.norm(n)
        if length < 1e-9:
            continue
        n /= length
        e1, e2 = b - a, c - a
        n1, n2 = max(1, int(np.ceil(np.linalg.norm(e1) / step))), max(1, int(np.ceil(np.linalg.norm(e2) / step)))
        i, j = np.meshgrid(np.arange(n1 + 1), np.arange(n2 + 1))
        u, v = (i / n1).ravel(), (j / n2).ravel()
        keep = u + v <= 1 + 1e-9
        on = a + np.outer(u[keep], e1) + np.outer(v[keep], e2)
        for depth in (0.02, 0.02 + size):
            cells = np.floor((on - n * depth - origin) / size).astype(int)
            cells = cells[(cells >= 0).all(axis=1) & (cells < shape).all(axis=1)]
            filled[cells[:, 0], cells[:, 1], cells[:, 2]] = True
    used = np.zeros(shape, bool)
    boxes: list[list[float]] = []
    for ix, iy, iz in sorted(map(tuple, np.argwhere(filled)), key=lambda c: (c[1], c[2], c[0])):
        if True:
            if True:
                if used[ix, iy, iz]:
                    continue
                x1 = ix
                while x1 + 1 < shape[0] and filled[x1 + 1, iy, iz] and not used[x1 + 1, iy, iz]:
                    x1 += 1
                z1 = iz
                while (
                    z1 + 1 < shape[2]
                    and filled[ix : x1 + 1, iy, z1 + 1].all()
                    and not used[ix : x1 + 1, iy, z1 + 1].any()
                ):
                    z1 += 1
                y1 = iy
                while (
                    y1 + 1 < shape[1]
                    and filled[ix : x1 + 1, y1 + 1, iz : z1 + 1].all()
                    and not used[ix : x1 + 1, y1 + 1, iz : z1 + 1].any()
                ):
                    y1 += 1
                used[ix : x1 + 1, iy : y1 + 1, iz : z1 + 1] = True
                boxes.append(
                    [
                        round(float(origin[0] + (ix + x1 + 1) / 2 * size), 3),
                        round(float(origin[2] + (iz + z1 + 1) / 2 * size), 3),
                        round(float(origin[1] + iy * size), 3),
                        round((x1 - ix + 1) * size, 3),
                        round((z1 - iz + 1) * size, 3),
                        round((y1 - iy + 1) * size, 3),
                    ]
                )
    print(f"collision: {int(filled.sum())} cells in {len(boxes)} boxes")
    return boxes
