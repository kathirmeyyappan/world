"""The pineapple house's inside, from the Sbfbb SpongeBob House model on Sketchfab (cherylhill28,
CC-BY-4.0): the game's rooms, skinned into their bind pose and stood inside our shell at
INTERIOR_SCALE, the way in at our doorway. The model is three loose levels with nothing between
them: four rooms round a ground floor (the living room at the front, the closet beside it, the
kitchen behind and the bathroom behind that), the bedroom over the kitchen, and the library, a
round room the shape of the pineapple's top. This keeps all of it and builds what joins it up, in
the model's own textures: a hall at the bedroom's level, round it to the pineapple's inside, where
the bedroom's doors open and a door of its own leads out to the stair round the back of the house
(house-model.py builds that stair, from the kitchen's back door); a straight flight up from the
hall through its ceiling, a shaft of bamboo, and a hole in the library's own floor; the hall
floored in the rooms' sand under a net ceiling like the rooms' and walled in the library's bamboo,
and the library capped with a net ceiling of its own (content/pineapple.ts builds the flight). The
library's old door is walled up, so nothing outside its wall can be reached or seen.

What changes in the model: the painted front door and its wheel go (our door swings at the face,
and the model's frame stands at the back of the vestibule behind it), the door panels become doors
of the sim's, each hung on a pin at the edge the model's rig turns it on (the library's goes for
good), the kitchen's back wall and the library's floor get their openings, the library's wall loses
its outside, and everything stands FLOOR_LIFT above the dune so its floor doesn't fight the sand.

Everything here is in the model's frame, which is glTF's, right-handed; what's written out for
the game is mirrored in x (house_mesh.MIRROR), so a bearing measured on the model (in Blender or
on Sketchfab) is the one to write here, and a door's pin is hung on the face the game wants once
mirrored (make_door).

The sim collides with boxes cut from every surface on a VOXEL grid (walls, floors, ceilings and
furniture alike, so a couch is something to stand on), written with the rest to
content/pineappleInterior.ts.
"""

from __future__ import annotations

import io
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from glb import accessor, components, local_matrix, read_glb
from house_mesh import Outline, Triangle, arch, area, cut_out, disc, fan, lathe, turned_by
from PIL import Image

INTERIOR_SCALE = 0.5  # metres per unit of the model: its doors come out 3 m tall, players SpongeBob's size
FLOOR_LIFT = 0.02  # metres the rooms stand above the dune's top
VOXEL = 0.25  # metres: the grid the sim's boxes are cut on
SILL = 0.02  # metres a stair's head and a platform sit below the floor they meet, so no two tops share a height
LINING = 0.35  # metres inside the shell's skin the hall's wall stands
SEGMENTS = 72
# The flight from the hall up through the library's floor: its foot and head on the floor and its
# width. It runs across the hall's front half, the whole of it under the library's floor, and comes
# up in the front of the library, clear of the chair in the middle.
FLIGHT = ((-8.0, 7.0), (2.8, 7.0), 2.4)
# The doorways this house cuts itself, each an arch (width, height): the vestibule's into the
# living room, and the kitchen's back door and the hall's, the way out to the stair round the back.
FRONT_DOORWAY = (2.6, 3.3)
DOORWAY = (2.4, 3.2)
CLEARANCE = 0.02  # metres a door stands in from its doorway's edge all round
BACK_BEARING = np.radians(183.0)  # bearing (from +z toward +x) of the kitchen's back door, where its outer wall is bare
HALL_BEARING = np.radians(250.0)  # bearing of the hall's door, at the head of the stair
# The stair round the back, from the back door up to the platform at the hall's door, standing
# clear of the shell: its width (rails on both edges stand on it), how far beyond the skin's
# widest within STAIR_HEADROOM over a step its inner edge keeps, its risers, its slabs, and its
# rails.
STAIR_WIDTH = 2.8
STAIR_GAP = 0.8
STAIR_HEADROOM = 2.4
STAIR_START = np.radians(12.0)  # past the back door's bearing the stair's foot stands: beside the doorway, not in front
STAIR_RISER = 0.25
STAIR_THICKNESS = 0.3
STAIR_FOOT = 4.0  # metres clear of the sand at which a step's underside is a slab in the air again
STAIR_SINK = 0.2  # metres a step standing on the sand goes down into it, past the terrain's sampling
RAIL = 1.0
RAIL_WIDTH = 0.2
PLATFORM_ACROSS = 2.8  # the platform at the stair's head, across the arc; it runs out to the stair's outer edge
FLIGHT_SLOT = 0.15  # metres of room round the flight in the floors it climbs through
# Metres of tread under a floor from which the flight's slot in it starts: a head under the floor's
# half-metre boxes, with the grid's slack and a riser to spare, so no one walking down meets it.
FLIGHT_HEADROOM = 3.5
CAP_DROP = 0.3  # metres under the library's wall's top its ceiling hangs, where the wall is still round
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
SEALED = ("library",)  # doors walled up (seal_library): the panel goes, and its row above says where
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
    paper: bool = False  # the model made the panel a sheet with no thickness


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
    hall_wall: list[Triangle] = field(default_factory=list)  # the hall's round wall, kept aside until its door is cut
    hall_wall_material: int = 0
    hall_round: dict[float, float] = field(
        default_factory=dict
    )  # at each of its rings' heights, how far out it stands at its roundest
    sealed: list[Door] = field(default_factory=list)  # the doors walled up, for where their openings are


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
    way: the painted front door and its wheel, the windows' glass, and the door panels (kept aside
    as doors, or as where an opening is walled up)."""
    drop: set[int] = set()
    frames = comps(interior, "Metal_Doors_and_Window_Borders")
    front = max(frames, key=lambda ks: bounds(interior, ks)[1][2])
    # The front frame goes whole, painted door and all: the vestibule's steel wall stands where its
    # outer face stood, with this house's own doorway cut through it and the wall behind.
    drop.update(front)
    interior.front = arch(-FRONT_DOORWAY[0] / 2, FRONT_DOORWAY[0] / 2, FRONT_DOORWAY[1])
    interior.front_z = float(bounds(interior, front)[1][2]) - 0.13
    # The lures' feathers are painted on black the model showed as clear.
    for name in ("Furry_Lure", "Green_Blue_Lure"):
        m = interior.materials.index(name)
        image = interior.images[m]
        if image is None:
            continue
        px = image.convert("RGB").load()
        w, h = image.size
        for k, (tri, mm) in enumerate(interior.tris):
            if mm == m:
                u, v = np.mean([q for _, q in tri], axis=0)
                if sum(px[int(u * w) % w, int(v * h) % h]) < 60:
                    drop.add(k)
    for ks in frames:
        lo, hi = bounds(interior, ks)
        if ks is not front and hi[2] > 12 and abs((lo[0] + hi[0]) / 2) < 1 and lo[1] > 0.5:
            drop.update(ks)  # the wheel on the painted door
    for ks in comps(interior, "Doors"):
        lo, hi = bounds(interior, ks)
        centre = ((lo + hi) / 2)[[0, 2]]
        panel = hi[1] - lo[1] >= 2.5 and min(hi[0] - lo[0], hi[2] - lo[2]) <= 0.6
        if panel and min(np.hypot(*(np.array(d[1]) - centre)) for d in DOORS) < 1.5:
            door = make_door(interior, ks)
            (interior.sealed if door.id in SEALED else interior.doors).append(door)
            drop.update(ks)
    # The panels the model made paper-thin take the closet's, a slab with the same look.
    stock = next(d for d in interior.doors if d.id == "closet")
    for d in interior.doors:
        if d.paper:
            d.mesh = clone_door(stock, d.bearing, d.reach, d.height)
            d.thickness = stock.thickness
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


def clone_door(stock: Door, bearing: float, reach: float, height: float) -> list[Triangle]:
    """The stock door's panel fitted to another doorway: scaled to its reach and height about the
    pin on the floor, and turned to run at its bearing (from +x toward +z)."""
    scale = np.array([1.0, height / stock.height, reach / stock.reach])
    return turned_by([[(p * scale, q) for p, q in tri] for tri in stock.mesh], np.pi / 2 - bearing)


def new_door(interior: Interior, id_: str, bearing: float, depth: float, y: float, out: bool) -> Door:
    """A door of this house's own in a DOORWAY-sized opening through a wall standing `depth` out
    from the axis at a bearing (from +z toward +x): the closet's panel fitted to it, swinging a
    quarter turn out (`out`) or in, and hung on the face it swings toward, as a real door is, so
    swung square it stands clear of its jamb: out, at the opening's +x edge on the wall's outer
    face, running across to -x; in, at the -x edge on the inner face, running to +x. Either way the
    panel (to the left of its run, make_door) fills the opening just inside the wall's surface."""
    stock = next(d for d in interior.doors if d.id == "closet")
    reach, height = DOORWAY[0] - 2 * CLEARANCE, DOORWAY[1] - CLEARANCE
    edge = DOORWAY[0] / 2 - CLEARANCE
    local = np.array([edge, 0.0, depth]) if out else np.array([-edge, 0.0, depth - stock.thickness])
    pin, along = (
        turned_by([[(p, np.zeros(2))]], bearing)[0][0][0] for p in (local, np.array([-1.0 if out else 1.0, 0.0, 0.0]))
    )
    run = float(np.arctan2(along[2], along[0]))
    swing = -np.pi / 2  # toward the right of the run: the way the pin's face looks
    door = Door(
        id_,
        (float(pin[0]), float(pin[2])),
        y,
        run,
        reach,
        height,
        stock.thickness,
        swing,
        clone_door(stock, run, reach, height),
    )
    interior.doors.append(door)
    return door


def cut_doorway(
    interior: Interior, bearing: float, depths: tuple[float, float], hole: Outline
) -> tuple[list[Triangle], int]:
    """An opening cut through the rooms' outer wall at a bearing (from +z toward +x): the wall's
    triangles facing along it between two depths from the axis are cut by `hole`, an outline in
    the wall's plane as seen from outside (across, up), and taken out of the interior, returned
    with their material for the opening's reveal to be built onto them before they go back in."""
    turned = turned_by([tri for tri, _ in interior.tris], -bearing)
    x0, x1 = min(x for x, _ in hole) - 0.5, max(x for x, _ in hole) + 0.5
    top = max(y for _, y in hole) + 0.5

    def near(tri: Triangle) -> bool:
        a, b, c = (p for p, _ in tri)
        n = np.cross(b - a, c - a)
        pts = np.array([p for p, _ in tri])
        mid = pts.mean(axis=0)
        return bool(
            abs(n[2]) > 0.5 * np.linalg.norm(n)
            and depths[0] < mid[2] < depths[1]
            and pts[:, 0].max() > x0
            and pts[:, 0].min() < x1
            and pts[:, 1].min() < top
        )

    which = [k for k, tri in enumerate(turned) if near(tri)]
    # The wall is whichever material covers most there; what's hung on it stays whole.
    extent: dict[int, float] = {}
    for k in which:
        extent[interior.tris[k][1]] = extent.get(interior.tris[k][1], 0.0) + area(turned[k])
    m = max(extent, key=lambda n: extent[n])
    if len(extent) > 1:
        others = sorted(interior.materials[n] for n in extent if n != m)
        print(f"doorway at {np.degrees(bearing):.0f}°: cutting {interior.materials[m]}, leaving {others} whole")
    which = {k for k in which if interior.tris[k][1] == m}
    cut, rest = cut_out([turned[k] for k in which], hole, flat_xy, lambda tri: True)
    gone = {id(interior.tris[k][0]) for k in which}
    interior.tris = [t for k, t in enumerate(interior.tris) if k not in which]
    opened = turned_by(cut + rest, bearing)
    interior.solid = [t for t in interior.solid if id(t) not in gone] + opened
    return opened, m


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
    # A panel the model left ajar is thick as a box; what tells a sheet is its extent across itself.
    pts = np.array([p for k in ks for p, _ in interior.tris[k][0]])
    flattest = np.linalg.svd(pts - pts.mean(axis=0), full_matrices=False)[2][2]
    paper = float(np.ptp((pts - pts.mean(axis=0)) @ flattest)) < 0.05
    thickness = DOOR_THICKNESS if paper else float(hi[across_axis] - lo[across_axis])
    reach = float(hi[length_axis] - lo[length_axis])
    at, other = (lo, hi) if end == "min" else (hi, lo)
    bearing = (
        (0.0 if length_axis == 0 else np.pi / 2)
        if other[length_axis] > at[length_axis]
        else (np.pi if length_axis == 0 else -np.pi / 2)
    )
    # A swing of a quarter turn the bearing's way opens toward +90°, the room's side; if the room
    # is the other side, the door turns the other way. The game hangs a slab to the right of its
    # run from the pin (doors.ts), and this frame is the game's mirrored (house_mesh.MIRROR), so
    # here the pin goes on the panel's face to the right of its run, the panel to the pin's left.
    opens = np.array([-np.sin(bearing), np.cos(bearing)])
    sign = 1.0 if opens[0 if across_axis == 0 else 1] * side > 0 else -1.0
    mid = (lo[across_axis] + hi[across_axis]) / 2
    pin = [0.0, 0.0]
    pin[0 if length_axis == 0 else 1] = float(at[length_axis])
    pin[0 if across_axis == 0 else 1] = float(mid - sign * side * thickness / 2)
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
        paper,
    )


def flat_xz(p: np.ndarray) -> np.ndarray:
    return p[[0, 2]]


def flat_xy(p: np.ndarray) -> np.ndarray:
    return p[[0, 1]]


def material(interior: Interior, name: str) -> int:
    return interior.materials.index(name)


def build_floors(
    interior: Interior, skin: Callable[[float, float], float], angles: list[float], heights: list[float]
) -> None:
    """The hall at the bedroom's floor, round it to the pineapple's inside: a floor in the rooms'
    sand, a ceiling in their net, a wall in the library's bamboo, and the flight's slot cut through
    that ceiling and through the library's own floor above, with a shaft of bamboo between them;
    and a net ceiling over the library, under its wall's top. The hall's floor and ceiling stop at
    the bedroom's own, edge to edge. `skin(a, y)` is the shell's radius at a bearing (from +z
    toward +x) and a height, `angles` the bearings it is turned at and `heights` its rings, so the
    hall's wall, turned at the same ones, keeps a wall's thickness inside it everywhere, where the
    shell is flattened into the face round the door too; the floor and ceiling, turned at the same
    angles, tuck their rims just behind it, so no gap shows the shell's inside (which the client
    never draws). The hall's wall is kept aside (`hall_wall`) for its door to be cut through it."""
    levels = interior.levels
    hall, ceiling, library, top = levels["hall"], levels["hallCeiling"], levels["library"], levels["top"]
    wall = lambda a, y: skin(a, y) - LINING
    sand, net, lid, bamboo = (material(interior, n) for n in ("Sand_Floor", "Netting", "Ceiling", "Library_Bamboo"))
    pieces: list[tuple[list[Triangle], int]] = []
    fx1 = FLIGHT[1][0]
    slot = lambda y, end=fx1 + FLIGHT_SLOT, side=FLIGHT_SLOT: flight_slot(levels, y, end, side)
    round_angles = angles[:-1]  # the lathe's seam column comes twice

    # The hall's floor runs into the wall where the hall's door is, under the doorway's own floor
    # (a hair lower), so the two meet with no crack.
    def floor_edge(a: float) -> float:
        at_door = abs((a - HALL_BEARING + np.pi) % (2 * np.pi) - np.pi) < np.radians(6)
        return wall(a, hall) + (0.05 if at_door else 0.01)

    pieces.append((round_floor(hall, floor_edge, False, [interior.bedroom_floor], SAND_TILE, round_angles), sand))
    shaft, shaft_hole = slot(ceiling)
    lid_edge = lambda a: wall(a, ceiling) + 0.01
    holes = [interior.bedroom_walls, shaft_hole]
    pieces.append((round_floor(ceiling, lid_edge, True, holes, CEILING_TILE, round_angles), lid))
    pieces.append((round_floor(ceiling - 0.1, lid_edge, True, holes, NET_TILE, round_angles), net))
    # The wall: the shell's inside, LINING in from the skin so it leans out with it. Where it stands
    # in from the round (behind the face) the sim gets it as boxes, since the shell's rings are round.
    place = lambda a, y: np.array([wall(a, y) * np.sin(a), y, wall(a, y) * np.cos(a)])
    # From a little under the floor, so the hall's doorway (its floor a hair under the hall's) cuts
    # through wall all round.
    rings = [
        (y, wall(0.0, y)) for y in sorted({hall - 0.3, hall, ceiling, *(y for y in heights if hall < y < ceiling)})
    ]
    interior.hall_wall = lathe(rings, BAMBOO_TILE, place, angles=angles)
    interior.hall_wall_material = bamboo
    interior.hall_round = {y: max(wall(a, y) for a in angles) for y, _ in rings}
    # The flight's shaft, from the hall's ceiling up to the library's floor, and its hole in that
    # floor, which it arrives through.
    sx0, sx1, sz0, sz1 = shaft
    inside_shaft = ((sx0 + sx1) / 2, (sz0 + sz1) / 2)
    for a, b in (
        ((sx0, sz0), (sx1, sz0)),
        ((sx1, sz0), (sx1, sz1)),
        ((sx1, sz1), (sx0, sz1)),
        ((sx0, sz1), (sx0, sz0)),
    ):
        pieces.append((upright(a, b, ceiling, library, inside_shaft), bamboo))
    cut_floor(interior, "Library_Floor", slot(library, fx1, 0.0)[1])
    # The library's ceiling: a disc under the wall's top, its rim tucked into the wall, which leans
    # in there (the band of the wall's vertices just above gives how far in).
    wall_top = np.array(
        [
            p
            for ks in comps(interior, "Library_Wall")
            for k in ks
            for p, _ in interior.tris[k][0]
            if p[1] > top - CAP_DROP
        ]
    )
    cap = float(np.hypot(wall_top[:, 0], wall_top[:, 2]).min()) + 0.2
    for drop, m, tile in ((CAP_DROP, lid, CEILING_TILE), (CAP_DROP + 0.1, net, NET_TILE)):
        pieces.append((round_floor(top - drop, lambda a: cap, True, [], tile), m))
    for tris, m in pieces:
        interior.tris += [(t, m) for t in tris]
    interior.solid += [t for tris, _ in pieces for t in tris]


def faced_wall(interior: Interior) -> list[Triangle]:
    """What the sim gets of the hall's wall as boxes: the round of it is rings of the profile's,
    so only where it stands in from the round, behind the faces round the doors; taken once its
    door is cut through it."""
    at = lambda y: interior.hall_round[min(interior.hall_round, key=lambda ry: abs(ry - y))]
    return [tri for tri in interior.hall_wall if any(np.hypot(p[0], p[2]) < at(p[1]) - 0.01 for p, _ in tri)]


def cut_floor(interior: Interior, name: str, hole: Outline) -> None:
    """A hole cut through one of the model's floors: every triangle of that material the hole's
    footprint touches, in place in the rooms and in what the sim gets."""
    m = material(interior, name)
    near = about(hole)
    which = {k for k, (tri, mm) in enumerate(interior.tris) if mm == m and near(tri)}
    cut, _ = cut_out([interior.tris[k][0] for k in sorted(which)], hole, flat_xz, lambda tri: True)
    gone = {id(interior.tris[k][0]) for k in which}
    interior.tris = [t for k, t in enumerate(interior.tris) if k not in which] + [(t, m) for t in cut]
    interior.solid = [t for t in interior.solid if id(t) not in gone] + cut


def seal_library(interior: Interior) -> None:
    """The library's doorway walled up, since the flight comes up through its floor: the opening
    its door left in the wall (the wall's edges round it that border one triangle only, chained
    from jamb to jamb over the arch, the longest such chain near the door) filled with a sheet of
    bamboo between them; and the wall's outside, toward the gap between it and the shell that
    nothing can look into, dropped."""
    door = next(d for d in interior.sealed if d.id == "library")
    wall_m, bamboo = material(interior, "Library_Wall"), material(interior, "Library_Bamboo")
    x0, x1 = sorted((door.hinge[0], door.hinge[0] + door.reach * np.cos(door.bearing)))
    floor = interior.levels["library"]
    near = lambda p: (
        x0 - 0.3 < p[0] < x1 + 0.3
        and floor + 0.005 < p[1] < floor + door.height + 1.5
        and abs(p[2] - door.hinge[1]) < 1.0
    )
    key = lambda p: tuple(np.round(p, 3))
    edges: dict[tuple[tuple, tuple], int] = {}
    corner: dict[tuple, np.ndarray] = {}
    for tri, m in interior.tris:
        if m != wall_m:
            continue
        pts = [p for p, _ in tri]
        for i in range(3):
            a, b = pts[i], pts[(i + 1) % 3]
            if near(a) and near(b):
                ka, kb = key(a), key(b)
                corner[ka], corner[kb] = a, b
                edge = (ka, kb) if ka < kb else (kb, ka)
                edges[edge] = edges.get(edge, 0) + 1
    links: dict[tuple, list[tuple]] = {}
    for a, b in (e for e, n in edges.items() if n == 1):
        links.setdefault(a, []).append(b)
        links.setdefault(b, []).append(a)
    # Chains of those edges; the rim is the longest.
    seen: set[tuple] = set()
    chains: list[list[tuple]] = []
    for start in sorted(links, key=lambda k: (len(links[k]), k)):
        if start in seen or len(links[start]) > 2:
            continue
        chain = [start]
        seen.add(start)
        while True:
            on = [n for n in links[chain[-1]] if n not in seen]
            if not on:
                break
            chain.append(on[0])
            seen.add(on[0])
        chains.append(chain)
    rim = max(chains, key=len)
    r = float(np.mean([np.hypot(corner[k][0], corner[k][2]) for k in rim]))
    tex = lambda p: np.array([r * float(np.arctan2(p[0], p[2])) / BAMBOO_TILE, -p[1] / BAMBOO_TILE])
    sheet = fan([(corner[k], tex(corner[k])) for k in rim])
    inward = lambda tri: float(
        np.cross(tri[1][0] - tri[0][0], tri[2][0] - tri[0][0]) @ -(sum(p for p, _ in tri) * [1.0, 0.0, 1.0])
    )
    interior.tris += [(tri if inward(tri) > 0 else [tri[0], tri[2], tri[1]], bamboo) for tri in sheet]

    def outside(tri: Triangle) -> bool:
        a, b, c = (p for p, _ in tri)
        n = np.cross(b - a, c - a)
        mid = (a + b + c) / 3
        out = float(np.hypot(mid[0], mid[2]))
        return out > 11.0 and float(n[[0, 2]] @ mid[[0, 2]]) > 0.3 * float(np.linalg.norm(n)) * out

    before = len(interior.tris)
    interior.tris = [(t, m) for t, m in interior.tris if not (m == wall_m and outside(t))]
    print(
        f"library: doorway walled up with {len(sheet)} triangles over {len(rim)} rim points, "
        f"{before - len(interior.tris)} triangles of the wall's outside dropped"
    )


def flat_tile(tile: float) -> Callable[[np.ndarray], np.ndarray]:
    """Texture coordinates for a level surface: tiled from the house's axis."""
    return lambda p: np.array([p[0] / tile, p[2] / tile])


def round_floor(
    y: float,
    r: Callable[[float], float],
    down: bool,
    holes: list[Outline],
    tile: float,
    angles: list[float] | None = None,
) -> list[Triangle]:
    """A round floor (or ceiling, facing down) at a height, reaching the radius `r` gives at each
    bearing (SEGMENTS of them, or `angles`), with holes cut out of it."""
    angles = angles or [float(a) for a in 2 * np.pi * np.arange(SEGMENTS) / SEGMENTS]
    ring = [np.array([r(a) * np.sin(a), y, r(a) * np.cos(a)]) for a in angles]
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


def library_slot(interior: Interior) -> Rect:
    """The flight's slot in the library's floor, for the rails the sim stands round it."""
    return flight_slot(interior.levels, interior.levels["library"], FLIGHT[1][0], 0.0)[0]


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
