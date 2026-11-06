"""The pineapple house's inside, from the Sbfbb SpongeBob House model on Sketchfab (cherylhill28,
CC-BY-4.0): the game's rooms, skinned into their bind pose and stood inside our shell at
INTERIOR_SCALE, the way in at our doorway. The model is three loose levels with nothing between
them: four rooms round a ground floor (the living room at the front, the closet beside it, the
kitchen behind and the bathroom behind that), the bedroom over the kitchen, and the library, a
round room the shape of the pineapple's top. This keeps all of it and builds what joins it up, in
the model's own textures: a hall at the bedroom's level, round it to the pineapple's inside, where
the bedroom's doors open and a door of its own leads out to the stair round the back of the house
(house-model.py builds that stair, from the kitchen's back door), floored in the rooms' sand under a
net ceiling like the rooms' and walled in the library's bamboo, and the library capped with a net
ceiling of its own. Upstairs a corridor runs from the hall's door along the bedroom and round the
bathroom, walled off from the rest of the hall; the ground floor's closet and bathroom are copied
off the bedroom (add_rooms); and a straight stair of solid steps climbs from the corridor's end
through the hall's ceiling and a hole in the library's floor, open along the corridor and walled
both sides from where the corridor's wall meets it (stairwell; content/pineapple.ts stands its
steps). The library's old door is walled up, so nothing outside its wall can be reached
or seen.

What changes in the model: the painted front door and its wheel go (our door swings at the face,
and the model's frame stands at the back of the vestibule behind it), the door panels become doors
of the sim's, each hung on a pin at the edge the model's rig turns it on (the library's goes for
good, and the living room's side panel for a door of this house's own in its frame, SIDE_AT), the
kitchen's back wall, the wall round that frame and the library's floor get their openings, the
library's wall loses its outside, and everything stands FLOOR_LIFT above the dune so its floor
doesn't fight the sand.

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
from itertools import pairwise
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
# The stairwell up to the library: a straight flight of STAIRWELL_STEPS risers, STAIRWELL_WIDTH wide,
# from its foot (STAIRWELL_FOOT: a bearing from +z toward +x, and how far out from the axis the
# foot's middle stands) to its head (STAIRWELL_HEAD, the same), its steps solid down to the hall's
# floor. Along the corridor, which ends at the foot, its near side is open, so the flight is in
# plain sight; from where the corridor's wall meets it the way is closed: walls both sides from the
# hall's floor up to its ceiling, then up to a roof of its own that rises off that ceiling
# STAIRWELL_LID over the treads until it meets the library's floor, where the way opens through a
# hole in that floor, flush with it; walls, roof and holes share their edges, so nothing shows
# through. The walls are STAIRWELL_WALL thick, a face each side, and the steps run into them, so no
# slot shows along a tread's end and no face of a step lies in a wall's. The foot stands at the end
# of the corridor from the hall's door, a corridor's width inside the hall's wall, the head well
# inside the library's wall and clear of the chair in its middle, and the flight between keeps
# clear of the bedroom, the closet and the bathroom, passing the bathroom's corner so close that
# one short wall joins them (stairwell). The lid is what keeps the way down open: the sim gets the
# roof and the library's floor as boxes on a VOXEL grid, reaching a cell past a hole's edge and a
# cell under the roof, and a player's head (2 m over the feet) coming down from the library has to
# pass under them, so the lid is a cell and a couple of risers more than the head's height.
STAIRWELL_FOOT = (np.radians(330.0), 14.8)
STAIRWELL_HEAD = (np.radians(31.0), 6.6)
STAIRWELL_STEPS = 35
STAIRWELL_WIDTH = 2.4
STAIRWELL_WALL = 0.1
STAIRWELL_LID = 3.05
# The doorways this house cuts itself, each an arch (width, height): the vestibule's into the
# living room, and the kitchen's back door and the hall's, the way out to the stair round the back.
FRONT_DOORWAY = (2.6, 3.3)
DOORWAY = (2.4, 3.2)
CLEARANCE = 0.02  # metres the bedroom's wall is cut clear of the bathroom door's frame all round
ARCH_STEPS = 32  # straight pieces in a doorway's arch, and in the crown of the door that fills it
# The living room's side door: the model's panel stands painted shut in a frame on the outer wall,
# SIDE_AT on the floor. The panel goes, and this house hangs a door of its own on the frame's face
# toward the room: a panel the frame's pointed opening (side_frame) grown SIDE_LAP all round, so
# it laps onto the frame's band and nothing shows past its edge, swinging in square to the wall.
# Behind the frame a passage is dug out along the radial through it (house-model.py), from the
# frame's back (its jambs and lintel run deep enough to seal the mouth) through the shell onto the
# dune, SIDE_DOORWAY (width, height) its arch.
SIDE_AT = (10.5, 2.3)
SIDE_BEARING = float(np.arctan2(*SIDE_AT))
SIDE_LAP = 0.06
SIDE_DOORWAY = (2.0, 3.0)
BACK_BEARING = np.radians(183.0)  # bearing (from +z toward +x) of the kitchen's back door, where its outer wall is bare
HALL_BEARING = np.radians(250.0)  # bearing of the hall's door, at the head of the stair
# The stair round the back, from the back door up to the platform at the hall's door, standing
# clear of the shell: its width (rails on both edges stand on it), how far beyond the skin's
# widest within STAIR_HEADROOM over a step its inner edge keeps, its risers, its slabs, and its
# rails.
STAIR_WIDTH = 4.5
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
# Metres of tread under a floor from which the stairwell's hole in it starts: a head under the
# floor's half-metre boxes, with the grid's slack and a riser to spare, so no one walking down
# meets it.
CAP_DROP = 0.3  # metres under the library's wall's top its ceiling hangs, where the wall is still round
# Metres of surface one repeat of a texture covers, as the model's rooms map them.
SAND_TILE = 3.4
CEILING_TILE = 5.9
NET_TILE = 2.65
BAMBOO_TILE = 2.0
METAL_TILE = 3.5  # metres per repeat of the bedroom's wall, from the model
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
    ("bedroom-east", (0.5, -5.5), "min", -1),
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
class Stairwell:
    """The stair up to the library (STAIRWELL_*): its steps as the sim's boxes, each
    [x, z, y, w, d, h, bearing] (centre, underside, size across, along and up, the bearing it
    faces), each solid from the hall's floor up to its tread; the hall's ceiling and the library's floor
    cut over the steps, a hole per step, where the stair's roof rises through the one and the stair
    comes up through the other; that roof, a slab per step (its four corners, round in order, at
    the walls' tops); its walls and the corridor's as chords on the floor (a, b) from one height up
    to a top at each end, facing a point inside; and the walls that close the corridor against the
    hall's wall, each from a point on the floor straight out from the axis into that wall, from one
    height up to another, facing a point inside, in a material of the model's."""

    steps: list[list[float]]
    ceiling_holes: list[Outline]
    library_holes: list[Outline]
    roof: list[list[np.ndarray]]
    walls: list[tuple[tuple[float, float], tuple[float, float], float, tuple[float, float], tuple[float, float]]]
    shell_walls: list[tuple[tuple[float, float], float, float, tuple[float, float], str]]


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
    bedroom_top: Outline = field(default_factory=list)  # the walls' outline at the ceiling, where they lean in
    bedroom_floor: Outline = field(default_factory=list)  # its floor's, a little past the walls
    hall_wall: list[Triangle] = field(default_factory=list)  # the hall's round wall, kept aside until its door is cut
    hall_wall_material: int = 0
    hall_round: dict[float, float] = field(
        default_factory=dict
    )  # at each of its rings' heights, how far out it stands at its roundest
    sealed: list[Door] = field(default_factory=list)  # the doors walled up, for where their openings are
    side_depth: float = 0.0  # how far out the side door's painted panel stood at its back: the passage's lining ends there, in the frame's band
    stairwell: Stairwell | None = None
    closet: Outline = field(default_factory=list)  # the closet upstairs: its walls' footprint, a little past them
    bathroom_walls: Outline = field(default_factory=list)  # the bathroom upstairs: its walls' footprint


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
        if not (hi[1] - lo[1] >= 2.5 and min(hi[0] - lo[0], hi[2] - lo[2]) <= 0.6):
            continue
        if np.hypot(*(np.array(SIDE_AT) - centre)) < 1.5:
            along = np.array([np.sin(SIDE_BEARING), 0.0, np.cos(SIDE_BEARING)])
            interior.side_depth = max(float(p @ along) for k in ks for p, _ in interior.tris[k][0])
            drop.update(ks)
        elif min(np.hypot(*(np.array(d[1]) - centre)) for d in DOORS) < 1.5:
            door = make_door(interior, ks)
            (interior.sealed if door.id in SEALED else interior.doors).append(door)
            drop.update(ks)
    # The panels the model made paper-thin take the closet's look on a slab cut to their wall's
    # opening (opening), hung on the face the door swings toward, as new_door hangs this house's.
    stock = next(d for d in interior.doors if d.id == "closet")
    for d in interior.doors:
        if d.paper:
            foot, d.bearing, shape = opening(interior, d, stock.thickness)
            d.hinge = (float(foot[0]), float(foot[2]))
            d.reach, d.height, d.thickness = 2 * shape[0][1], shape[-1][0], stock.thickness
            d.mesh = turned_by(panel(shape, stock.thickness, stock_uv(stock, d.reach, d.height)), np.pi / 2 - d.bearing)
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
    pts = np.array([p for k in walls for p, _ in interior.tris[k][0]])
    interior.bedroom_walls = shrunk(hull(pts[:, [0, 2]]), -0.02)
    interior.bedroom_top = shrunk(hull(pts[pts[:, 1] > interior.levels["hallCeiling"] - 0.3][:, [0, 2]]), -0.02)
    interior.bedroom_floor = shrunk(hull(np.array([p[[0, 2]] for k in bedroom for p, _ in interior.tris[k][0]])), -0.02)


Shape = list[tuple[float, float]]  # an opening's shape: (height, half-width) up its middle, floor to top


def opening(interior: Interior, door: Door, thickness: float) -> tuple[np.ndarray, float, Shape]:
    """The opening in the wall one of the model's paper-thin doors stood in, measured from the
    wall's face the door swings toward (the model's sheets stand off their walls, short of the
    jambs, and a wall can run askew of its sheet): the foot of the jamb on that face at the pin's
    end, the bearing (from +x toward +z) the face runs at from there to the other jamb, and the
    shape (height, half-width) of a panel `thickness` thick hung on that foot, into the wall: the
    opening's outline where it is narrowest through that depth, so the panel fills it at the face
    and nowhere comes out through the reveals, which splay and lean through the wall."""
    along = 0 if abs(np.cos(door.bearing)) > 0.5 else 2
    across = 2 - along
    forward = (np.cos(door.bearing) if along == 0 else np.sin(door.bearing)) > 0
    start = door.hinge[0 if along == 0 else 1]
    ends = sorted((start, start + (door.reach if forward else -door.reach)))
    plane = door.hinge[1 if along == 0 else 0]
    opens = (np.cos(door.bearing - door.swing), np.sin(door.bearing - door.swing))[0 if across == 0 else 1]
    tris = [np.array([p for p, _ in tri]) for tri, _ in interior.tris]
    normals = [np.cross(pts[1] - pts[0], pts[2] - pts[0]) for pts in tris]
    # The jambs' reveals, across the run at the sheet's ends, run the wall's thickness: their feet
    # are the wall's corners there, and the corner further the way the door opens is on its face.
    feet = []
    for end in ends:
        corners = [
            p
            for pts, n in zip(tris, normals)
            if abs(n[along]) > 0.8 * np.linalg.norm(n)
            and abs(pts[:, along].mean() - end) < 0.3
            and abs(pts[:, across].mean() - plane) < 0.8
            and door.y - 0.1 < pts[:, 1].min() < door.y + 0.5
            for p in pts
            if p[1] < door.y + 0.05
        ]
        feet.append(max(corners, key=lambda p: float(p[across]) * opens))
    foot, far = feet if forward else feet[::-1]
    run = far - foot
    run[1] = 0.0
    reach = float(np.linalg.norm(run))
    run = run / reach
    bearing = float(np.arctan2(run[2], run[0]))
    normal = np.array([-run[2], 0.0, run[0]])
    # The reveals round the opening: the pieces of wall facing along the run or up and down, from
    # the face in, over the opening's height.
    reveals = [
        (pts, (pts - foot) @ normal, (pts - foot) @ run)
        for pts, n in zip(tris, normals)
        if abs(n @ normal) < 0.5 * np.linalg.norm(n)
        and -0.1 < ((pts - foot) @ normal).min()
        and ((pts - foot) @ normal).max() < 0.6
        and ((pts - foot) @ run).max() > -0.3
        and ((pts - foot) @ run).min() < reach + 0.3
        and door.y - 0.05 < pts[:, 1].min()
        and pts[:, 1].max() < door.y + 3.5
    ]

    def section(depth: float) -> list[tuple[float, float, float, float]]:
        """The opening's outline that deep into the wall: where the reveals cross that plane, as
        pieces of line (y0, y1, u at each) along the run from the foot."""
        pieces = []
        for pts, off, u in reveals:
            crossings = []
            for i, j in ((0, 1), (1, 2), (2, 0)):
                if (off[i] - depth) * (off[j] - depth) < 0:
                    t = (depth - off[i]) / (off[j] - off[i])
                    crossings.append((float(pts[i, 1] + t * (pts[j, 1] - pts[i, 1])), float(u[i] + t * (u[j] - u[i]))))
            if len(crossings) == 2:
                pieces.append(crossings)
        return [(a[0], b[0], a[1], b[1]) for a, b in pieces]

    def width(pieces: list[tuple[float, float, float, float]], y: float) -> float | None:
        """How far the opening reaches either side of its middle at a height, the nearer side: the
        pieces of outline at that height, or None where there are none."""
        us = [
            u0 + (y - y0) / (y1 - y0) * (u1 - u0) if y1 != y0 else u
            for y0, y1, u0, u1 in pieces
            for u in (u0, u1)
            if min(y0, y1) - 1e-6 <= y <= max(y0, y1) + 1e-6
        ]
        left = [u for u in us if u < reach / 2]
        right = [u for u in us if u >= reach / 2]
        if not left or not right:
            return None
        return min(reach / 2 - max(left), min(right) - reach / 2)

    # The narrowest of the sections the panel passes through, at every height any of them bends,
    # up to the top of the deepest: a panel filling the face would come out through a reveal that
    # splays inward, so the shape is the least of them at each height, and never wider higher up.
    sections = [section(depth) for depth in (0.01, thickness / 2, thickness)]
    top = max(max(y0, y1) for y0, y1, _, _ in sections[-1])
    heights = sorted({round(y - door.y, 2) for pieces in sections for y0, y1, _, _ in pieces for y in (y0, y1)})
    shape: Shape = [(0.0, reach / 2)]
    for y in heights:
        if y <= 0 or y > top - door.y + 1e-6:
            continue
        widths = [w for pieces in sections if (w := width(pieces, y + door.y)) is not None]
        if widths:
            shape.append((y, max(0.0, min(min(widths), shape[-1][1]))))
    return foot, bearing, shape


def arch_shape(width: float, top: float) -> Shape:
    """A round-arched opening's shape, with the ARCH_STEPS pieces round the arch an opening is cut
    with, so a panel of it fills the opening corner for corner."""
    right = sorted((y, x) for x, y in arch(-width / 2, width / 2, top, ARCH_STEPS, bottom=0.0) if x > 1e-9)
    return [(0.0, width / 2)] + [(y, x) for y, x in right if y > 1e-9] + [(top, 0.0)]


def stock_shape(stock: Door, reach: float, height: float) -> Shape:
    """The stock door's own shape, a pointed crown with a flat top, at a reach and height."""
    outline = hull(np.array([[p[2], p[1]] for tri in stock.mesh for p, _ in tri]))
    mid = stock.reach / 2
    right = sorted({(round(float(y), 4), round(float(x - mid), 4)) for x, y in outline if x >= mid - 1e-6})
    shape = [(0.0, mid)] + [(y, hw) for y, hw in right if y > 1e-6]
    return [(y * height / stock.height, hw * reach / stock.reach) for y, hw in shape]


def stock_uv(stock: Door, reach: float, height: float) -> Callable[[float, float], np.ndarray]:
    """Where a point (along, up) of a panel `reach` long and `height` tall lies in the stock door's
    texture: the stock's own mapping, straight along and up its face, stretched to the panel."""
    zs, ys, us, vs = [], [], [], []
    for tri in stock.mesh:
        p = np.array([q for q, _ in tri])
        n = np.cross(p[1] - p[0], p[2] - p[0])
        if n[0] > 0.9 * np.linalg.norm(n):
            for q, uv in tri:
                zs.append(float(q[2]))
                ys.append(float(q[1]))
                us.append(float(uv[0]))
                vs.append(float(uv[1]))
    (bu, au), (bv, av) = np.polyfit(zs, us, 1), np.polyfit(ys, vs, 1)
    return lambda z, y: np.array([au + bu * z * stock.reach / reach, av + bv * y * stock.height / height])


def panel(shape: Shape, thickness: float, uv: Callable[[float, float], np.ndarray]) -> list[Triangle]:
    """A door panel of an opening's shape: standing on the floor with its pin edge up the y axis,
    running along +z and `thickness` thick toward -x, as the stock panel stands, its faces
    textured by `uv(along, up)`; a flat piece per band of the shape, each wound to face out."""
    reach, height = 2 * shape[0][1], shape[-1][0]
    middle = np.array([-thickness / 2, height / 2, reach / 2])
    left = [(reach / 2 - hw, y) for y, hw in shape]
    right = [(reach / 2 + hw, y) for y, hw in shape]
    tris: list[Triangle] = []

    def add(ring: list[tuple[float, float, float]]) -> None:
        corners = [c for i, c in enumerate(ring) if c != ring[i - 1]]
        for tri in fan([(np.array([x, y, z]), uv(z, y)) for x, y, z in corners]):
            p, q, r = (c for c, _ in tri)
            n = np.cross(q - p, r - p)
            if np.linalg.norm(n) < 1e-9:
                continue
            tris.append(tri if n @ ((p + q + r) / 3 - middle) > 0 else [tri[0], tri[2], tri[1]])

    for (zl0, y0), (zr0, _), (zl1, y1), (zr1, _) in zip(left, right, left[1:], right[1:]):
        for x in (0.0, -thickness):
            add([(x, y0, zl0), (x, y0, zr0), (x, y1, zr1), (x, y1, zl1)])
        add([(0.0, y0, zr0), (0.0, y1, zr1), (-thickness, y1, zr1), (-thickness, y0, zr0)])
        add([(0.0, y0, zl0), (-thickness, y0, zl0), (-thickness, y1, zl1), (0.0, y1, zl1)])
    add(
        [(0.0, 0.0, left[0][0]), (-thickness, 0.0, left[0][0]), (-thickness, 0.0, right[0][0]), (0.0, 0.0, right[0][0])]
    )
    (zl, yt), (zr, _) = left[-1], right[-1]
    if zr - zl > 1e-6:
        add([(0.0, yt, zl), (0.0, yt, zr), (-thickness, yt, zr), (-thickness, yt, zl)])
    return tris


def side_frame(interior: Interior) -> tuple[float, float, float, Shape]:
    """The frame on the living room's outer wall the side door hangs on, from the model: the
    bearing (from +z toward +x) its face toward the room looks along (the frame stands a few
    degrees off the radial through it), how far out from the axis that face is, how far to the
    right of the bearing's line (looking out) the opening's middle is, and the opening's shape:
    the frame's inner edge up one jamb and round its pointed arch, as height and half-width from
    that middle."""
    frames = comps(interior, "Metal_Doors_and_Window_Borders")
    at = lambda ks: ((bounds(interior, ks)[0] + bounds(interior, ks)[1]) / 2)[[0, 2]]
    ks = min(frames, key=lambda ks: float(np.hypot(*(np.array(SIDE_AT) - at(ks)))))
    pts = np.array([p for k in ks for p, _ in interior.tris[k][0]])
    out = pts @ np.array([np.sin(SIDE_BEARING), 0.0, np.cos(SIDE_BEARING)])
    # The band's face toward the room is flat; its back stands the frame's depth further out. The
    # band runs across its face's longest spread, and the face looks the other way, outward.
    face = pts[out < out.min() + 0.3]
    spread = np.unique(np.round(face[:, [0, 2]], 3), axis=0)
    run = np.linalg.svd(spread - spread.mean(axis=0))[2][0]
    normal = np.array([run[1], -run[0]])
    if normal @ spread.mean(axis=0) < 0:
        normal = -normal
    bearing = float(np.arctan2(normal[0], normal[1]))
    along = np.array([np.sin(bearing), 0.0, np.cos(bearing)])
    across = np.array([np.cos(bearing), 0.0, -np.sin(bearing)])
    corners = {(round(float(c), 3), 0.0 if y < 0.01 else round(float(y), 3)) for c, y in zip(face @ across, face[:, 1])}
    # The band's outer edge is the convex hull of its face; its inner edge is every other corner
    # (the feet of its jambs lie along the hull's floor edge, which the hull keeps no corner on).
    rim = set(hull(np.array(sorted(corners))))
    inner = sorted(c for c in corners if c not in rim)
    feet = [c for c, y in inner if y == 0.0]
    middle = (min(feet) + max(feet)) / 2
    right = sorted((y, c - middle) for c, y in inner if c - middle > -0.02)
    shape: Shape = [(y, 0.0 if hw < 0.02 else hw) for y, hw in right]
    return bearing, float(np.mean(face @ along)), middle, shape


def grown(shape: Shape, by: float) -> Shape:
    """A shape's outline moved out `by` all round but along the floor: each edge up its side
    pushed out square to itself, the corners where neighbours meet again, and the crown where the
    top edge meets its own mirror."""
    pts = [np.array([hw, y]) for y, hw in shape]
    lines = []
    for a, b in pairwise(pts):
        d = b - a
        lines.append((a + by * np.array([d[1], -d[0]]) / np.linalg.norm(d), d))
    out: Shape = [(0.0, float(lines[0][0][0]))]
    for (p, d), (q, e) in pairwise(lines):
        s = np.linalg.solve(np.array([[d[0], -e[0]], [d[1], -e[1]]]), q - p)[0]
        out.append((float((p + s * d)[1]), float((p + s * d)[0])))
    p, d = lines[-1]
    out.append((float(p[1] - p[0] * d[1] / d[0]), 0.0))
    return out


def new_door(
    interior: Interior,
    id_: str,
    bearing: float,
    depth: float,
    y: float,
    out: bool,
    shape: Shape,
    turn: float = np.pi / 2,
    across: float = 0.0,
) -> Door:
    """A door of this house's own filling an opening of `shape` through a wall standing `depth`
    out from the axis at a bearing (from +z toward +x), its middle `across` from the bearing's line
    (to the right, looking out): a panel in the stock door's look, cut to the opening's shape so
    it meets the jambs and the arch edge to edge, swinging `turn` out (`out`) or in, and hung on
    the face it swings toward, as a real door is, so swung square it stands clear of its jamb:
    out, at the opening's +x edge on the wall's outer face, running across to -x; in, at the -x
    edge on the inner face, running to +x. Either way the panel (to the left of its run,
    make_door) fills the opening just inside the wall's surface."""
    stock = next(d for d in interior.doors if d.id == "closet")
    reach, height = 2 * shape[0][1], shape[-1][0]
    edge = reach / 2
    local = np.array([across + edge, 0.0, depth]) if out else np.array([across - edge, 0.0, depth - stock.thickness])
    pin, along = (
        turned_by([[(p, np.zeros(2))]], bearing)[0][0][0] for p in (local, np.array([-1.0 if out else 1.0, 0.0, 0.0]))
    )
    run = float(np.arctan2(along[2], along[0]))
    swing = -turn  # toward the right of the run: the way the pin's face looks
    mesh = turned_by(panel(shape, stock.thickness, stock_uv(stock, reach, height)), np.pi / 2 - run)
    door = Door(id_, (float(pin[0]), float(pin[2])), y, run, reach, height, stock.thickness, swing, mesh)
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
    sand, a ceiling in their net, a wall in the library's bamboo, and the stairwell's walls, with
    its holes cut through that ceiling and through the library's own floor above; and a net
    ceiling over the library, under its wall's top. The hall's floor and ceiling stop at
    the bedroom's own, edge to edge. `skin(a, y)` is the shell's radius at a bearing (from +z
    toward +x) and a height, `angles` the bearings it is turned at and `heights` its rings, so the
    hall's wall, turned at the same ones, keeps a wall's thickness inside it everywhere, where the
    shell is flattened into the face round the door too; the floor and ceiling, turned at the same
    angles, tuck their rims just behind it, so no gap shows the shell's inside (which the client
    never draws). The hall's wall is kept aside (`hall_wall`) for its door to be cut through it."""
    levels = interior.levels
    hall, ceiling, top = levels["hall"], levels["hallCeiling"], levels["top"]
    wall = lambda a, y: skin(a, y) - LINING
    sand, net, lid, bamboo = (material(interior, n) for n in ("Sand_Floor", "Netting", "Ceiling", "Library_Bamboo"))
    TILES = {"Library_Bamboo": BAMBOO_TILE, "Metal_Walls": METAL_TILE}
    pieces: list[tuple[list[Triangle], int]] = []
    # The library's floor is clear to its bamboo, which lines the wall from the floor up.
    library_clear = min(
        float(np.hypot(p[0], p[2]))
        for ks in comps(interior, "Library_Bamboo")
        for k in ks
        for p, _ in interior.tris[k][0]
        if p[1] < levels["library"] + 1.5
    )
    library_top = max(
        float(p[1]) for ks in comps(interior, "Library_Floor") for k in ks for p, _ in interior.tris[k][0]
    )
    bands = sorted({hall, ceiling, *(y for y in heights if hall < y < ceiling)})
    well = stairwell(
        levels,
        wall,
        interior.bedroom_walls,
        interior.closet,
        interior.bathroom_walls,
        library_top,
        library_clear - 0.3,
    )
    interior.stairwell = well
    round_angles = angles[:-1]  # the lathe's seam column comes twice

    # The hall's floor runs into the wall where the hall's door is, under the doorway's own floor
    # (a hair lower), so the two meet with no crack.
    def floor_edge(a: float) -> float:
        at_door = abs((a - HALL_BEARING + np.pi) % (2 * np.pi) - np.pi) < np.radians(6)
        return wall(a, hall) + (0.05 if at_door else 0.01)

    pieces.append((round_floor(hall, floor_edge, False, [interior.bedroom_floor], SAND_TILE, round_angles), sand))
    lid_edge = lambda a: wall(a, ceiling) + 0.01
    # The bedroom's walls lean in at their top, so the ceiling meets them at their outline there.
    holes = [interior.bedroom_top, *well.ceiling_holes]
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
    # The stairwell's and the corridor's walls and the stairwell's roof, and its holes through the
    # library's floor, which it arrives through.
    for a, b, y0, tops, inner in well.walls:
        pieces.append((upright(a, b, y0, tops[0], inner, tops[1]), bamboo))
    for a, y0, y1, inner, name in well.shell_walls:
        pieces.append((to_shell(a, y0, y1, inner, wall, bands, TILES[name]), material(interior, name)))
    for corners in well.roof:
        pieces.append((slab(corners, CEILING_TILE), lid))
    for hole in well.library_holes:
        cut_floor(interior, "Library_Floor", hole)
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


def ccw(poly: Outline) -> Outline:
    """An outline the way round cut_out wants it: counter-clockwise on the floor."""
    area = sum(x0 * z1 - x1 * z0 for (x0, z0), (x1, z1) in zip(poly, poly[1:] + poly[:1]))
    return poly if area > 0 else poly[::-1]


def within(p: tuple[float, float], outline: Outline) -> bool:
    """Whether a point on the floor lies inside an outline."""
    inside = False
    for (x0, z0), (x1, z1) in zip(outline, outline[1:] + outline[:1]):
        if (z0 > p[1]) != (z1 > p[1]) and p[0] < x0 + (x1 - x0) * (p[1] - z0) / (z1 - z0):
            inside = not inside
    return inside


def slab(corners: list[np.ndarray], tile: float) -> list[Triangle]:
    """A ceiling over four corners (round in order, at any heights), facing down, tiled from the
    house's axis as if it lay level."""
    tris = fan([(c, np.array([c[0] / tile, c[2] / tile])) for c in corners])
    down = lambda tri: float(np.cross(tri[1][0] - tri[0][0], tri[2][0] - tri[0][0])[1]) < 0
    return [tri if down(tri) else [tri[0], tri[2], tri[1]] for tri in tris]


def stairwell(
    levels: dict[str, float],
    wall: Callable[[float, float], float],
    bedroom: Outline,
    closet: Outline,
    bathroom: Outline,
    library_top: float,
    library_clear: float,
) -> Stairwell:
    """The stair up to the library laid out (STAIRWELL_*), and the walls that close the corridor to
    its foot: `wall(a, y)` is how far out the hall's wall stands at a bearing and a height,
    `bedroom`, `closet` and `bathroom` the footprints of their walls (the closet's a little past
    them), `library_top` the top of the library's floor, and `library_clear` how far out that
    floor is clear."""
    hall, ceiling, library = levels["hall"], levels["hallCeiling"], levels["library"]
    riser = (library - SILL - hall) / STAIRWELL_STEPS
    at = lambda r, b: np.array([r * np.sin(b), r * np.cos(b)])
    foot, head = (at(r, b) for b, r in (STAIRWELL_FOOT, STAIRWELL_HEAD))
    length = float(np.linalg.norm(head - foot))
    along = (head - foot) / length
    tread = length / STAIRWELL_STEPS
    facing = float(np.arctan2(along[0], along[1]))
    # The flight's sides: the near one passes the bathroom's corner, where the corridor ends.
    half = np.array([-along[1], along[0]]) * STAIRWELL_WIDTH / 2
    nearest = lambda p: min(float(np.hypot(*(p - np.array(q)))) for q in bathroom)
    if nearest(foot - half) > nearest(foot + half):
        half = -half
    point = lambda p: (float(p[0]), float(p[1]))
    # The stair's edges at each step's start, and the last step's end: the near and far corners,
    # and the roof's height there, STAIRWELL_LID over the step.
    edges = [
        (foot + along * (i * tread) - half, foot + along * (i * tread) + half, hall + riser * (i + 1) + STAIRWELL_LID)
        for i in range(STAIRWELL_STEPS + 1)
    ]
    # The corridor's wall meets the flight's near side where it passes the bathroom's corner:
    # before that the side is open to the corridor, from there on walled.
    near = foot - half
    corner = min(bathroom, key=lambda p: abs(float(np.cross(np.array(p) - near, along))))
    met = float((np.array(corner) - near) @ along)
    joint = near + along * met
    well = Stairwell([], [], [], [], [], [])
    opened = False  # past the roof's end, where the way is open through the library's floor
    for i in range(STAIRWELL_STEPS):
        (a0, b0, r0), (a1, b1, r1) = edges[i], edges[i + 1]
        top = hall + riser * (i + 1)
        centre = point((a0 + b0 + a1 + b1) / 4)
        well.steps.append(
            [*centre, hall - 0.05, STAIRWELL_WIDTH + STAIRWELL_WALL, tread + 0.05, top - hall + 0.05, facing]
        )
        corners = [point(p) for p in (a0, b0, b1, a1)]
        footprint = ccw(corners)
        for room, name in ((bedroom, "bedroom"), (closet, "closet"), (bathroom, "bathroom")):
            if any(within(c, room) for c in corners):
                raise ValueError(f"the stairwell's step {i} stands in the {name}")
        if not opened and r0 >= library:
            # The roof has come up to the library's floor: from here the way is open through it.
            opened = True
        if opened:
            if any(np.hypot(*c) > library_clear for c in corners):
                raise ValueError(f"the stairwell comes up through the library's floor outside it, at step {i}")
            tops = (library_top, library_top)
            well.library_holes.append(footprint)
        elif r1 > ceiling:
            # Under the roof: off the hall's ceiling where it starts, up to the library's floor.
            tops = (max(r0, ceiling), min(r1, library))
            well.roof.append([np.array([x, y, z]) for (x, z), y in zip(corners, (tops[0], tops[0], tops[1], tops[1]))])
        else:
            tops = (ceiling, ceiling)
        if opened or r1 > ceiling:
            if i * tread < met:
                raise ValueError(f"the hall's ceiling opens over step {i}, where the flight's side is still open")
            well.ceiling_holes.append(footprint)
        # Each wall is two faces, the stair's and its back, STAIRWELL_WALL apart; where the way is
        # open through the library's floor the back stops just under that floor.
        back = STAIRWELL_WALL * half / (STAIRWELL_WIDTH / 2)
        outer = (library_top - 0.01, library_top - 0.01) if opened else tops
        if (i + 1) * tread > met:
            a_from = a0 if i * tread >= met else joint
            well.walls.append((point(a_from), corners[3], hall, tops, centre))
            well.walls.append((point(a_from - back), point(a1 - back), hall, outer, centre))
        well.walls.append((corners[1], corners[2], hall, tops, centre))
        well.walls.append((point(b0 + back), point(b1 + back), hall, outer, centre))
    print(
        f"stairwell: {STAIRWELL_STEPS} steps of {tread:.2f} m at bearing {np.degrees(facing) % 360:.0f} deg, "
        f"open along the corridor for {met:.2f} m, "
        f"{len(well.ceiling_holes)} holes in the hall's ceiling, {len(well.roof)} roof slabs, {len(well.library_holes)} holes in the library's floor"
    )
    # The corridor from the hall's door to the foot, closed all round: across from the bedroom's
    # corner past the door, where its wall turns north (so the door has a stretch of corridor
    # before it), out to the hall's wall, in the bedroom's own steel so that end reads as the
    # bedroom's corner; the slot between the bedroom and the bathroom covered; from the bathroom's
    # corner across to the flight, where its near wall begins; and from the flight's far corner
    # out to the hall's wall. (The bathroom's wall, which the corridor runs along, is carried up
    # to the ceiling by add_rooms.)
    inward = lambda p, by: tuple(float(v) for v in np.array(p) * (1 - by / float(np.hypot(*p))))
    west = [p for p in bedroom if p[0] < -9]
    south = max(west, key=lambda p: p[1])
    turn = min((p for p in bedroom if p[0] < -8.5), key=lambda p: p[1])
    corridor = point(at(14.0, float(np.arctan2(turn[0], turn[1])) + np.radians(8)))
    well.shell_walls.append((inward(turn, 0.1), hall, ceiling, corridor, "Metal_Walls"))
    west_most = min(bathroom, key=lambda p: p[0])
    well.walls.append((point(south), point(west_most), hall, (ceiling, ceiling), corridor))
    well.walls.append((point(corner), point(joint), hall, (ceiling, ceiling), point(foot)))
    well.shell_walls.append((point(foot + half), hall, ceiling, point(near), "Library_Bamboo"))
    return well


def add_rooms(interior: Interior, wall: Callable[[float, float], float]) -> None:
    """Upstairs, the closet and the bathroom off the bedroom: the ground floor's, copied with
    everything in them, their ceilings and the bathroom's carpet (the hall's own sand is their
    floor). The closet is mirrored onto the bedroom's east wall so that its doorway, with the thick
    wall's reveal round it, runs on from the bedroom's own east door: the reveal's mouth on the
    wall's face the door hangs on, its jamb in line with the door's pin. The bathroom is turned so that
    its doorway lands in the bedroom's south wall, west of the porthole there, where that wall is
    cut and a door of this house's own hung in the reveal; its north wall stands a wall's thickness
    beyond the bedroom's, as the kitchen's stood from it downstairs."""
    hall, ceiling = interior.levels["hall"], interior.levels["hallCeiling"]
    doors = {d.id: d for d in interior.doors}
    floor = min(p[1] for tri, m in interior.tris if interior.materials[m] == "Sand_Floor" for p, _ in tri if p[1] < 1)
    lift = hall - floor

    def plane(name: str, axis: int, box: tuple[tuple[float, float], ...]) -> float:
        """Where a wall's face of a material stands along an axis: the mean over its triangles
        facing that way whose middles lie in `box` (ranges of x, y, z)."""
        found = []
        for tri, m in interior.tris:
            if interior.materials[m] != name:
                continue
            pts = np.array([p for p, _ in tri])
            n = np.cross(pts[1] - pts[0], pts[2] - pts[0])
            c = pts.mean(axis=0)
            if abs(n[axis]) > 0.7 * np.linalg.norm(n) and all(lo < c[k] < hi for k, (lo, hi) in enumerate(box)):
                found.append(float(c[axis]))
        return float(np.mean(found))

    def copy(
        materials: set[str], pick: Callable[[np.ndarray], bool], move: Callable[[np.ndarray], np.ndarray]
    ) -> list[tuple[Triangle, int]]:
        copied = []
        for tri, m in interior.tris:
            if interior.materials[m] not in materials:
                continue
            pts = np.array([p for p, _ in tri])
            if pick(pts.mean(axis=0)):
                moved = [(move(p), q) for p, q in tri]
                copied.append(([moved[0], moved[2], moved[1]], m))  # mirrored, so rewound to face the same way
        interior.tris += copied
        interior.solid += [t for t, _ in copied]
        return copied

    # The closet: mirrored in x, then moved so its doorway's reveal starts where the bedroom's
    # east door hangs, its jamb at the door's pin.
    closet, east = doors["closet"], doors["bedroom-east"]
    reveal = {"Hallways"}
    reveal_at = lambda c: -3.1 < c[0] < -1.95 and 1.4 < c[2] < 3.7
    mouth = max(
        p[0]
        for tri, m in interior.tris
        if interior.materials[m] in reveal and reveal_at(np.mean([p for p, _ in tri], axis=0))
        for p, _ in tri
    )
    dx, dz = east.hinge[0] + mouth, east.hinge[1] - closet.hinge[1]
    closet_in = {
        "Blue_Walls",
        "Ceiling",
        "Netting",
        "Clothes",
        "Bamboo_2",
        "Cardboard",
        "Closet_Barrel",
        "Closet_Beach_Ball",
        "Closet_Cannonball",
        "Closet_Lifesaver",
        "Soap_and_Rubber_Ducky",
    }
    mirror = lambda p: np.array([-p[0] + dx, p[1] + lift, p[2] + dz])
    room = copy(closet_in, lambda c: c[0] < -2.95 and 0.5 < c[2] < 8.2 and c[1] < 6.0, mirror)
    room += copy(reveal, reveal_at, mirror)
    walls = {material(interior, n) for n in ("Blue_Walls", "Hallways")}
    interior.closet = shrunk(hull(np.array([p[[0, 2]] for tri, m in room if m in walls for p, _ in tri])), -0.3)
    print(f"closet upstairs: {len(room)} triangles, moved by ({dx:.2f}, {dz:.2f})")
    # The bathroom: x and z swapped, then moved so its west wall's face stands a wall's thickness
    # (the kitchen's wall to its own, downstairs) beyond the bedroom's south face, and its doorway
    # a clear 0.8 m west of the porthole in that wall.
    bath = doors["bathroom"]
    kitchen_face = plane("Metal_Walls", 0, ((1.3, 2.2), (0, 6.2), (-8, -0.6)))
    south_face = plane("Metal_Walls", 2, ((-11, 0.5), (7.5, 16), (-1.4, -0.6)))
    porthole = min(
        p[0]
        for tri, m in interior.tris
        if interior.materials[m] == "Windows"
        for p, _ in tri
        if -1.4 < p[2] < -0.6 and 8 < p[1] < 12
    )
    bz = south_face - kitchen_face
    bx = porthole - 0.8 - bath.hinge[1]
    bath_in = {
        "Flower_Walls",
        "Rusty_Metal",
        "Bathroom_Carpet",
        "Bathtub",
        "Shower_Curtain",
        "Bathroom_Sink",
        "Wringer",
        "Bamboo_1",
        "Soap_and_Rubber_Ducky",
        "Toilet_Paper",
        "Bathroom_Mirror",
        "Shellfish_Pic",
        "Towels",
        "Toilet_Seat_and_Vanity_Seat",
        "Windows",
        "Doors",
    }
    turn = lambda p: np.array([p[2] + bx, p[1] + lift + 0.015, p[0] + bz])
    room = copy(bath_in, lambda c: c[0] > 2.7 and -8.3 < c[2] < -0.5 and c[1] < 6.0, turn)
    n = len(room) + len(copy(reveal, lambda c: 1.6 < c[0] < 2.9 and -3.7 < c[2] < -1.5, turn))
    flower = material(interior, "Flower_Walls")
    interior.bathroom_walls = hull(np.array([p[[0, 2]] for tri, m in room if m == flower for p, _ in tri]))
    # The bathroom's wall stops short of the hall's ceiling. Along the corridor, which runs round
    # its outside, it is carried up to the ceiling in its own wallpaper, each face's pattern
    # continued up from its top edge, so the corridor's inner side is one wall floor to ceiling.
    middle = np.mean(interior.bathroom_walls, axis=0)
    raised = []
    for tri, m in room:
        if m != flower:
            continue
        pts = [p for p, _ in tri]
        top = max(p[1] for p in pts)
        if top < hall + 3.0 or sum(p[1] > top - 0.02 for p in pts) != 2:
            continue
        (a, ua), (b, ub) = [(p, q) for p, q in tri if p[1] > top - 0.02]
        c, uc = next((p, q) for p, q in tri if p[1] <= top - 0.02)
        mid = (a + b) / 2
        out = np.array([b[2] - a[2], 0.0, a[0] - b[0]])
        if out @ (mid - [middle[0], mid[1], middle[1]]) < 0:
            out = -out
        if out[[0, 2]] @ mid[[0, 2]] < 0.3 * np.linalg.norm(out) * np.linalg.norm(mid[[0, 2]]):
            continue
        # How far the texture runs straight up the face from its top edge to the ceiling, from
        # this piece's own mapping.
        e1, e2 = b - a, c - a
        beta = 1.0 / e2[1]
        alpha = -beta * float(e2 @ e1) / float(e1 @ e1)
        rise = (alpha * (ub - ua) + beta * (uc - ua)) * (ceiling - top)
        up = np.array([0.0, ceiling - top, 0.0])
        for t in (
            [(a, ua), (b, ub), (b + up, ub + rise)],
            [(a, ua), (b + up, ub + rise), (a + up, ua + rise)],
        ):
            if np.cross(t[1][0] - t[0][0], t[2][0] - t[0][0]) @ out < 0:
                t = [t[0], t[2], t[1]]
            raised.append(t)
    interior.tris += [(t, flower) for t in raised]
    interior.solid += raised
    # Its doorway through the bedroom's wall, and the door in it, swinging into the bathroom.
    x1 = bath.hinge[1] + bx
    x0 = x1 - bath.reach
    hole = [(x, y + hall) for x, y in arch(x0 - CLEARANCE, x1 + CLEARANCE, bath.height + CLEARANCE)]
    opened, wall_m = cut_doorway(interior, 0.0, (south_face - 0.3, south_face + 0.25), hole)
    interior.tris += [(tri, wall_m) for tri in opened]
    new_door(
        interior,
        "bathroom-up",
        0.0,
        bath.hinge[0] + bz + bath.thickness / 2,
        hall,
        True,
        stock_shape(doors["closet"], bath.reach, bath.height),
        across=(x0 + x1) / 2,
    )
    print(f"bathroom upstairs: {n} triangles, swapped and moved by ({bx:.2f}, {bz:.2f}); door at x {x0:.2f}..{x1:.2f}")


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
    a: tuple[float, float],
    b: tuple[float, float],
    y0: float,
    y1: float,
    inside: tuple[float, float],
    y1b: float | None = None,
) -> list[Triangle]:
    """A wall from a to b (on the floor) from one height up to another (`y1` at a, and `y1b` at b
    where the top slopes), facing the side `inside` is on."""
    corners = [
        np.array([a[0], y0, a[1]]),
        np.array([b[0], y0, b[1]]),
        np.array([b[0], y1 if y1b is None else y1b, b[1]]),
        np.array([a[0], y1, a[1]]),
    ]
    return sheet(corners, inside)


def to_shell(
    a: tuple[float, float],
    y0: float,
    y1: float,
    inside: tuple[float, float],
    wall: Callable[[float, float], float],
    heights: list[float],
    tile: float = BAMBOO_TILE,
) -> list[Triangle]:
    """A wall from a point on the floor straight out from the axis into the hall's wall, from one
    height up to another, facing the side `inside` is on, its texture repeating every `tile`
    metres: its far edge follows that wall as it leans out, a piece between each pair of the
    heights the hall's wall is turned at, so the two meet all the way up."""
    bearing = float(np.arctan2(a[0], a[1]))
    out = lambda y: (wall(bearing, y) + 0.15) * np.array([np.sin(bearing), 0.0, np.cos(bearing)])
    tris = []
    for h0, h1 in pairwise(sorted({y0, y1, *(y for y in heights if y0 < y < y1)})):
        corners = [np.array([a[0], h0, a[1]]), out(h0) + [0, h0, 0], out(h1) + [0, h1, 0], np.array([a[0], h1, a[1]])]
        tris += sheet(corners, inside, tile)
    return tris


def sheet(corners: list[np.ndarray], inside: tuple[float, float], tile: float = BAMBOO_TILE) -> list[Triangle]:
    """A flat piece of wall over four corners (round in order), facing the side `inside` is on,
    its texture running along it from the first corner and up, a repeat every `tile` metres."""
    normal = np.cross(corners[1] - corners[0], corners[3] - corners[0])
    if normal @ np.array([inside[0] - corners[0][0], 0, inside[1] - corners[0][2]]) < 0:
        normal = -normal
    tex = lambda p: np.array([float(np.hypot(p[0] - corners[0][0], p[2] - corners[0][2])) / tile, -p[1] / tile])
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
        # The repeat the piece lies in is its middle's: its edges may fall a hair either side of
        # a whole number, and a piece taken for the wrong repeat is clipped flat.
        base = np.floor(np.mean([q for _, q in poly], axis=0))
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
