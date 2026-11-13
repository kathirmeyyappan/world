"""Builds the Krusty Krab for the world from Mrlunettes' model on Sketchfab (The Krusty Krab,
CC BY-NC 4.0: https://sketchfab.com/3d-models/the-krusty-krab-e109df8b1cb1487dbf2553e5e2d7eff1),
a 176 MB file of 4.2 million triangles, as about nine thousand triangles in a quarter of a
megabyte: the client's meshes (public/assets/models/krusty-krab/<part>.bin, fetched by the loader)
with their textures beside them, the parts list (render/models/krustyKrabParts.ts) and what the
sim knows the building by (content/krustyKrabProfile.ts: its size, its door and what's solid).

    pip install numpy pillow scipy mapbox_earcut fast_simplification
    python packages/client/scripts/krusty-krab-model.py path/to/the_krusty_krab.glb

The model is the restaurant on a disc of sand: a barrel of thick wooden staves between two arched
ends, on a low plinth, glazed along the front and under the arches, with a double glass door;
inside, the dining room (a plank floor, tables on ship's wheels with barrels for stools, the
cashier's boat) in front of the kitchen's steel wall, with its three doors, the order window and
the menu hung over the boat. The kitchen itself is a block with a dark box behind the window.

Its meshes are bevelled boards and loose bolts, which collapsing edges doesn't thin, so every
object kept is built again from its shape, whichever way suits it (build):

- prism: anything cut from a board (the roof's staves, the arches, the plinth, the kitchen's
  panels and doors, the wheels round the tables, the rope nets, the flags) is its silhouette
  through the board, traced off a bitmap and straightened, pushed through again; a net or a flag
  is the one face, a sheet;
- hull: anything convex (crates, barrels, the roof's rivets, the chimney, cups) is the convex
  shape through its outermost points along a handful of ways;
- boat: the cashier's boat is a hull lofted through its outline at each plank's edges;
- pipe: the chimney's bent pipe is a run of straight lengths;
- and the little that is plain already (the kitchen's block, the menu's board, the glass) stays
  as it is.

The scenery goes (the sky, the sand and its base, the road, the two houses and the seaweed), and
so does everything too small to see: the floor's nails and the steel's rivets, each a little dome
of triangles, tens of thousands of them (MIN_SIZE), and the straws in the drinks. The floor's 305
bevelled planks become one slab.

Nothing keeps the model's photographic textures. The timber is two small plank textures painted
here and wrapped over it in metres (planks, planked), the floor a third, and everything else a
plain colour from one small atlas, which also carries the menu, the ORDER HERE sign and the one
flag with a picture, shrunk (atlas).

The parts: roof and frame (the timber, dark and light), floor, trim (everything else that's
solid, indoors and out), glass, and the two leaves of the door with their handles, each on a pin
at its outer edge for the sim to swing together (content/krustyKrab.ts). All of it is lit, like
the pineapple's outside.

What the sim collides with is worked out as each piece is built (Model): boxes round what's
upright or level, stacks of them for the arches, the wedge under the outer face of each of the
roof's leaning staves, and thin walls along the boat's rim.

Its size is one rule: Squidward, 3.2 m tall, standing in the boat, has the top of his head a third
of the way up the dark of the order window (SCALE).

The model is in glTF's frame, right-handed, its door facing +x and its length along z. Everything
here is in the game's frame instead (left-handed, metres, the ground at 0, the building's middle at
the origin, the door facing +z and the length along x), which is the model's with x and z swapped,
so every triangle is wound the other way round as it is read (load).
"""

from __future__ import annotations

import io
import sys
from dataclasses import dataclass, field
from itertools import pairwise
from pathlib import Path

import mapbox_earcut as earcut
import numpy as np
from glb import accessor, local_matrix, read_glb
from PIL import Image, ImageDraw
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import ConvexHull, QhullError

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets/models/krusty-krab"
PARTS_TS = ROOT / "src/render/models/krustyKrabParts.ts"
PROFILE_TS = ROOT.parent / "shared/src/content/krustyKrabProfile.ts"

# Measured off the model, in its own units and frame.
GROUND = -0.809  # the height of the ground the plinth stands on
MIDDLE = (-0.32, 0.1785)  # the plinth's middle, x and z
BOAT_FLOOR = -0.765  # the boards inside the cashier's boat
WINDOW = (0.384, 0.835)  # the bottom and top of the order window's opening, inside its frame
SQUIDWARD = 3.2  # metres: his height in the game (render/avatars/squidwardModel.ts)
# Metres to the model's unit: Squidward, standing in the boat, reaches a third of the way up the window.
SCALE = SQUIDWARD / (WINDOW[0] + (WINDOW[1] - WINDOW[0]) / 3 - BOAT_FLOOR)

MIN_SIZE = 0.2  # metres: a loose piece of an object smaller than this across is left out


@dataclass
class Mesh:
    """Triangles in the game's frame: `points` by three, `tris` indexing them, wound so that the
    cross product of a triangle's first two edges points out of its face; `uv` per point, for the
    few that keep a picture."""

    points: np.ndarray
    tris: np.ndarray
    uv: np.ndarray | None = None

    def __len__(self) -> int:
        return len(self.tris)


@dataclass
class Obj:
    """One of the model's objects: its name and, by material name, its triangles."""

    name: str
    meshes: dict[str, Mesh] = field(default_factory=dict)


def load(path: str) -> tuple[dict[str, Obj], dict, bytes]:
    """The model's objects (the children of its root, each with everything under it), in the
    game's frame."""
    doc, blob = read_glb(Path(path).read_bytes())
    nodes = doc["nodes"]
    root = next(i for i, n in enumerate(nodes) if n.get("name") == "RootNode")
    objs: dict[str, Obj] = {}

    def walk(i: int, m: np.ndarray, obj: Obj | None) -> None:
        node = nodes[i]
        m = m @ local_matrix(node)
        if obj is not None and "mesh" in node:
            for prim in doc["meshes"][node["mesh"]]["primitives"]:
                at = accessor(doc, blob, prim["attributes"]["POSITION"]).astype(np.float64)
                at = (m @ np.c_[at, np.ones(len(at))].T).T[:, :3]
                points = np.stack(
                    [(at[:, 2] - MIDDLE[1]) * SCALE, (at[:, 1] - GROUND) * SCALE, (at[:, 0] - MIDDLE[0]) * SCALE],
                    axis=1,
                )
                tris = accessor(doc, blob, prim["indices"]).astype(np.int64).reshape(-1, 3)[:, [0, 2, 1]]
                uv = (
                    accessor(doc, blob, prim["attributes"]["TEXCOORD_0"]).astype(np.float64)
                    if "TEXCOORD_0" in prim["attributes"]
                    else np.zeros((len(at), 2))
                )
                material = doc["materials"][prim["material"]]["name"]
                had = obj.meshes.get(material)
                if had is None:
                    obj.meshes[material] = Mesh(points, tris, uv)
                else:
                    assert had.uv is not None
                    obj.meshes[material] = Mesh(
                        np.concatenate([had.points, points]),
                        np.concatenate([had.tris, tris + len(had.points)]),
                        np.concatenate([had.uv, uv]),
                    )
        for child in node.get("children", []):
            if i == root:
                name = nodes[child]["name"]
                assert name not in objs, name
                objs[name] = Obj(name)
                walk(child, m, objs[name])
            else:
                walk(child, m, obj)

    for top in doc["scenes"][doc.get("scene", 0)]["nodes"]:
        walk(top, np.eye(4), None)
    return objs, doc, blob


def welded(mesh: Mesh, grain: float = 1e-4) -> Mesh:
    """The mesh with points at one spot made one, and triangles that close up to nothing dropped."""
    points, index = np.unique(np.round(mesh.points / grain).astype(np.int64), axis=0, return_inverse=True)
    tris = index.ravel()[mesh.tris]
    alive = (tris[:, 0] != tris[:, 1]) & (tris[:, 1] != tris[:, 2]) & (tris[:, 0] != tris[:, 2])
    return Mesh(points * grain, tris[alive])


def pieces(mesh: Mesh) -> np.ndarray:
    """Which loose piece each triangle of a welded mesh belongs to."""
    n = len(mesh.points)
    a = np.concatenate([mesh.tris[:, 0], mesh.tris[:, 1]])
    b = np.concatenate([mesh.tris[:, 1], mesh.tris[:, 2]])
    _, label = connected_components(coo_matrix((np.ones(len(a)), (a, b)), shape=(n, n)), directed=False)
    return label[mesh.tris[:, 0]]


def compact(mesh: Mesh) -> Mesh:
    """The mesh without the points no triangle uses."""
    used, index = np.unique(mesh.tris, return_inverse=True)
    return Mesh(mesh.points[used], index.reshape(-1, 3), None if mesh.uv is None else mesh.uv[used])


def without_small(mesh: Mesh, size: float = MIN_SIZE) -> Mesh:
    """A welded mesh less its loose pieces smaller than `size` across."""
    if len(mesh) == 0:
        return mesh
    label = pieces(mesh)
    keep = np.zeros(len(mesh), bool)
    order = np.argsort(label, kind="stable")
    starts = np.flatnonzero(np.r_[True, label[order][1:] != label[order][:-1], True])
    for s, e in pairwise(starts):
        which = order[s:e]
        at = mesh.points[np.unique(mesh.tris[which])]
        if np.linalg.norm(at.max(axis=0) - at.min(axis=0)) >= size:
            keep[which] = True
    return compact(Mesh(mesh.points, mesh.tris[keep]))


def merged(meshes: list[Mesh]) -> Mesh:
    """Several meshes as one."""
    meshes = [m for m in meshes if len(m)]
    if not meshes:
        return Mesh(np.zeros((0, 3)), np.zeros((0, 3), np.int64))
    starts = np.cumsum([0] + [len(m.points) for m in meshes[:-1]])
    uv = None if any(m.uv is None for m in meshes) else np.concatenate([m.uv for m in meshes])
    return Mesh(
        np.concatenate([m.points for m in meshes]), np.concatenate([m.tris + s for m, s in zip(meshes, starts)]), uv
    )


def loose(mesh: Mesh) -> list[Mesh]:
    """A mesh's loose pieces, each a mesh of its own."""
    mesh = welded(mesh)
    if len(mesh) == 0:
        return []
    label = pieces(mesh)
    return [compact(Mesh(mesh.points, mesh.tris[label == k])) for k in np.unique(label)]


def around(spokes: int, tilts: tuple[float, ...] = (-40.0, 0.0, 40.0), turn: float = 0.0) -> np.ndarray:
    """Directions round the upright axis: `spokes` of them at each tilt (degrees above level), and
    straight up and down."""
    out = [(0.0, 1.0, 0.0), (0.0, -1.0, 0.0)]
    for tilt in np.radians(tilts):
        for a in turn + 2 * np.pi * np.arange(spokes) / spokes:
            out.append((np.cos(tilt) * np.cos(a), np.sin(tilt), np.cos(tilt) * np.sin(a)))
    return np.array(out)


BLOCK = around(16, (-35.0, 35.0))  # finds the corners of a block however it is turned on the floor
ROUND = around(8)  # an eight-sided barrel: its rims and its middle
# Every way at once, for something lying any way up: the corners of an icosahedron and of a cube.
PHI = (1 + 5**0.5) / 2
ANYWAY = np.array(
    [(0, s, t * PHI) for s in (-1, 1) for t in (-1, 1)]
    + [(s, t * PHI, 0) for s in (-1, 1) for t in (-1, 1)]
    + [(t * PHI, 0, s) for s in (-1, 1) for t in (-1, 1)]
    + [(a, b, c) for a in (-1, 1) for b in (-1, 1) for c in (-1, 1)],
    dtype=np.float64,
)
ANYWAY /= np.linalg.norm(ANYWAY, axis=1, keepdims=True)


def hull(points: np.ndarray, ways: np.ndarray = BLOCK, merge: float = 0.05) -> Mesh:
    """The convex shape through a cloud's outermost points along each of `ways`, those nearer than
    `merge` to one already taken left out: a box comes back as its eight corners, twelve triangles,
    and a barrel as a prism with as many sides as the ways go round."""
    extreme = points[np.unique(np.argmax(points @ ways.T, axis=0))]
    kept: list[np.ndarray] = []
    for p in extreme:
        if all(np.linalg.norm(p - q) >= merge for q in kept):
            kept.append(p)
    corners = np.array(kept)
    if len(corners) < 4:
        return Mesh(np.zeros((0, 3)), np.zeros((0, 3), np.int64))
    try:
        found = ConvexHull(corners)
    except QhullError:
        found = ConvexHull(corners, qhull_options="QJ")
    tris = found.simplices.astype(np.int64)
    a, b, c = (corners[tris[:, k]] for k in range(3))
    inward = np.einsum("ij,ij->i", np.cross(b - a, c - a), found.equations[:, :3]) < 0
    tris[inward] = tris[inward][:, [0, 2, 1]]
    return compact(Mesh(corners, tris))


def frame(axis: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Two directions square to an axis and to each other, and the axis, as unit vectors u, v, w
    with u cross v along w."""
    w = np.asarray(axis, np.float64) / np.linalg.norm(axis)
    up = np.array([0.0, 1.0, 0.0]) if abs(w[1]) < 0.9 else np.array([0.0, 0.0, 1.0])
    u = np.cross(up, w)
    u /= np.linalg.norm(u)
    return u, np.cross(w, u), w


def outlines(mask: np.ndarray) -> list[np.ndarray]:
    """The edges of a bitmap's filled cells as closed loops of corner points (column, row), the
    filled side on the left of the way round: counter-clockwise round a region, clockwise round a
    hole in one. Cells touching only at a corner are different regions."""
    m = np.pad(mask, 1).astype(bool)
    rows, cols = np.nonzero(m)
    nexts: dict[tuple[int, int], list[tuple[int, int]]] = {}

    def add(sel: np.ndarray, ax: int, ay: int, bx: int, by: int) -> None:
        for r, c in zip(rows[sel].tolist(), cols[sel].tolist()):
            nexts.setdefault((c + ax, r + ay), []).append((c + bx, r + by))

    add(~m[rows - 1, cols], 0, 0, 1, 0)  # nothing below: along the bottom, toward +x
    add(~m[rows, cols + 1], 1, 0, 1, 1)  # nothing to the right: up the right side
    add(~m[rows + 1, cols], 1, 1, 0, 1)  # nothing above: back along the top
    add(~m[rows, cols - 1], 0, 1, 0, 0)  # nothing to the left: down the left side
    loops: list[np.ndarray] = []
    while nexts:
        start = next(iter(nexts))
        loop = [start]
        at, came = start, (0, 0)
        while True:
            options = nexts[at]
            if len(options) == 1:
                to = options.pop()
            else:
                # Where two regions touch at a corner, turn left: stay with this one.
                left = (-came[1], came[0])
                to = next((o for o in options if (o[0] - at[0], o[1] - at[1]) == left), options[0])
                options.remove(to)
            if not options:
                del nexts[at]
            came = (to[0] - at[0], to[1] - at[1])
            at = to
            if at == start:
                break
            loop.append(at)
        loops.append(np.array(loop, np.float64) - 1)  # less the padding
    return loops


def straightened(loop: np.ndarray, tolerance: float) -> np.ndarray:
    """A closed loop with the points it can do without, none of them further than `tolerance` from
    the line that replaces them (Douglas-Peucker, between its two most distant points)."""
    first = int(np.argmax(np.linalg.norm(loop - loop[0], axis=1)))
    second = int(np.argmax(np.linalg.norm(loop - loop[first], axis=1)))
    lo, hi = sorted((first, second))
    ring = np.r_[np.arange(lo, len(loop)), np.arange(0, lo + 1)]  # from lo all the way round to lo
    chain = loop[ring]
    keep = np.zeros(len(chain), bool)
    keep[[0, hi - lo, len(chain) - 1]] = True
    spans = [(0, hi - lo), (hi - lo, len(chain) - 1)]
    while spans:
        a, b = spans.pop()
        if b - a < 2:
            continue
        d = chain[b] - chain[a]
        rel = chain[a + 1 : b] - chain[a]
        length = np.linalg.norm(d)
        off = np.abs(rel[:, 0] * d[1] - rel[:, 1] * d[0]) / length if length > 0 else np.linalg.norm(rel, axis=1)
        k = int(np.argmax(off))
        if off[k] > tolerance:
            keep[a + 1 + k] = True
            spans += [(a, a + 1 + k), (a + 1 + k, b)]
    return chain[keep][:-1]


def signed_area(loop: np.ndarray) -> float:
    x, y = loop[:, 0], loop[:, 1]
    return float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y) / 2)


def inside(point: np.ndarray, loop: np.ndarray) -> bool:
    x, y = point
    a, b = loop, np.roll(loop, -1, axis=0)
    crosses = ((a[:, 1] > y) != (b[:, 1] > y)) & (
        x < a[:, 0] + (y - a[:, 1]) * (b[:, 0] - a[:, 0]) / (b[:, 1] - a[:, 1] + 1e-300)
    )
    return bool(crosses.sum() % 2)


@dataclass
class Shape:
    """A flat shape: regions, each an outer loop (counter-clockwise) and the holes in it
    (clockwise), in a plane's own coordinates."""

    regions: list[tuple[np.ndarray, list[np.ndarray]]]

    def loops(self) -> list[np.ndarray]:
        return [loop for outer, holes in self.regions for loop in (outer, *holes)]


def silhouette(
    points: np.ndarray, tris: np.ndarray, u: np.ndarray, v: np.ndarray, cell: float, tolerance: float, least: float
) -> Shape:
    """What a mesh covers seen along the axis square to u and v: drawn into a bitmap of `cell`
    metres, its outlines traced and straightened to within `tolerance`, regions and holes smaller
    than `least` square metres left out."""
    flat = np.stack([points @ u, points @ v], axis=1)
    low = flat.min(axis=0) - 2 * cell
    size = np.ceil((flat.max(axis=0) - low) / cell).astype(int) + 3
    image = Image.new("1", (int(size[0]), int(size[1])), 0)
    draw = ImageDraw.Draw(image)
    px = (flat - low) / cell
    for a, b, c in px[tris].tolist():
        draw.polygon([tuple(a), tuple(b), tuple(c)], fill=1, outline=1)
    outers: list[np.ndarray] = []
    holes: list[np.ndarray] = []
    for loop in outlines(np.asarray(image)):
        loop = straightened(loop, tolerance / cell) * cell + low
        area = signed_area(loop)
        if len(loop) >= 3 and abs(area) >= least:
            (outers if area > 0 else holes).append(loop)
    regions: list[tuple[np.ndarray, list[np.ndarray]]] = [(o, []) for o in outers]
    for hole in holes:
        around_it = [r for r in regions if inside(hole[0], r[0])]
        if around_it:
            min(around_it, key=lambda r: signed_area(r[0]))[1].append(hole)
    return Shape(regions)


def filled(shape: Shape) -> tuple[np.ndarray, np.ndarray]:
    """A shape as triangles (counter-clockwise) over its loops' points."""
    points: list[np.ndarray] = []
    tris: list[np.ndarray] = []
    for outer, holes in shape.regions:
        rings = [outer, *holes]
        at = np.concatenate(rings)
        cut = earcut.triangulate_float64(at, np.cumsum([len(r) for r in rings]).astype(np.uint32)).reshape(-1, 3)
        a, b, c = (at[cut[:, k]] for k in range(3))
        turned = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0]) < 0
        cut[turned] = cut[turned][:, [0, 2, 1]]
        tris.append(cut.astype(np.int64) + sum(len(p) for p in points))
        points.append(at)
    if not points:
        return np.zeros((0, 2)), np.zeros((0, 3), np.int64)
    return np.concatenate(points), np.concatenate(tris)


def extruded(shape: Shape, u: np.ndarray, v: np.ndarray, w: np.ndarray, near: float, far: float) -> Mesh:
    """A flat shape pushed through from `near` to `far` along w: its two faces and the wall round
    every loop. With near and far the same it is a sheet, one face."""
    flat, cut = filled(shape)
    if len(cut) == 0:
        return Mesh(np.zeros((0, 3)), np.zeros((0, 3), np.int64))
    lift = lambda at, depth: at[:, :1] * u + at[:, 1:] * v + depth * w
    if near == far:
        return Mesh(lift(flat, near), cut)
    points = [lift(flat, far), lift(flat, near)]
    tris = [cut, cut[:, [0, 2, 1]] + len(flat)]
    count = 2 * len(flat)
    for loop in shape.loops():
        n = len(loop)
        points += [lift(loop, near), lift(loop, far)]
        i = np.arange(n)
        j = (i + 1) % n
        tris += [
            np.stack([count + i, count + j, count + n + j], axis=1),
            np.stack([count + i, count + n + j, count + n + i], axis=1),
        ]
        count += 2 * n
    return Mesh(np.concatenate(points), np.concatenate(tris))


def prism(
    mesh: Mesh,
    axis: np.ndarray | None = None,
    cell: float = 0.02,
    tolerance: float = 0.03,
    least: float = 0.004,
    sheet: bool = False,
    depth: tuple[float, float] | None = None,
) -> Mesh:
    """A mesh rebuilt as its silhouette along an axis (the way it is thinnest, unless given),
    pushed through as far as the mesh reaches along it, or to `depth`; as a `sheet`, one face at
    its middle. Exact for anything cut from a board, whatever its bevels and bolts."""
    points = mesh.points[np.unique(mesh.tris)]
    if axis is None:
        _, _, turned = np.linalg.svd(points - points.mean(axis=0), full_matrices=False)
        axis = turned[2]
    u, v, w = frame(axis)
    shape = silhouette(mesh.points, mesh.tris, u, v, cell, tolerance, least)
    reach = points @ w
    near, far = depth if depth else (float(reach.min()), float(reach.max()))
    if sheet:
        near = far = (near + far) / 2
    return extruded(shape, u, v, w, near, far)


def convex_outline(points: np.ndarray) -> np.ndarray:
    """The convex outline of points on the floor (x, z), counter-clockwise seen with x to the
    right and z up."""
    return points[ConvexHull(points).vertices]


def along_rays(outline: np.ndarray, centre: np.ndarray, angles: np.ndarray) -> np.ndarray:
    """How far out from `centre` a convex outline lies along each of the rays at `angles`."""
    a, b = outline, np.roll(outline, -1, axis=0)
    out = np.empty(len(angles))
    for k, angle in enumerate(angles):
        d = np.array([np.cos(angle), np.sin(angle)])
        # centre + t d = a + s (b - a)
        e = b - a
        det = e[:, 0] * d[1] - e[:, 1] * d[0]
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (e[:, 0] * (a[:, 1] - centre[1]) - e[:, 1] * (a[:, 0] - centre[0])) / det
            along = (d[0] * (a[:, 1] - centre[1]) - d[1] * (a[:, 0] - centre[0])) / det
        hit = (np.abs(det) > 1e-12) & (along >= -1e-9) & (along <= 1 + 1e-9) & (t > 0)
        out[k] = t[hit].max() if hit.any() else 0.0
    return out


def inset(ring: np.ndarray, by: float) -> np.ndarray:
    """A convex ring of points (counter-clockwise) moved in by `by` metres square to its sides."""
    before = ring - np.roll(ring, 1, axis=0)
    after = np.roll(ring, -1, axis=0) - ring
    normal = lambda e: np.stack([-e[:, 1], e[:, 0]], axis=1) / (np.linalg.norm(e, axis=1, keepdims=True) + 1e-12)
    n1, n2 = normal(before), normal(after)  # pointing in, for a counter-clockwise ring
    return ring + by * (n1 + n2) / (1 + np.einsum("ij,ij->i", n1, n2))[:, None]


@dataclass
class Boat:
    """The cashier's boat rebuilt: the hull's planks from the bottom one up, each with the lap
    under it, the inside with its rim and floor, and what the sim needs of it (the rim's outline
    on the floor, its height, the floor's height, how thick the side is)."""

    planks: list[Mesh]
    inside: Mesh
    outline: np.ndarray
    rim: float
    floor: float
    side: float


BOAT_SIDE = 0.12  # metres through the boat's side at the rim
STRAKES = (0.44, 0.81, 1.19, 1.5)  # metres up the hull each plank laps over the one below


def boat(white: Mesh, red: Mesh) -> Boat:
    """The boat as a hull lofted through its outline at each plank's edges, the planks lapping as
    the model's do (the outline just under and just over each lap, so every plank overhangs the
    one below), the lowest painted red; inside, the same outlines moved in by the side's
    thickness, down to the floor's boards."""
    points = np.concatenate([white.points, red.points])
    floor = (BOAT_FLOOR - GROUND) * SCALE
    low = float(points[:, 1].min()) + 0.02
    rim = float(np.percentile(points[points[:, 1] < 1.7, 1], 99.9))  # under the stem's post
    gap = 0.012
    levels = [low] + [y + s * gap for y in STRAKES for s in (-1, 1)] + [rim]

    def at(y: float, reach: float = 0.03) -> np.ndarray:
        near = points[np.abs(points[:, 1] - y) <= reach]
        return convex_outline(near[:, [0, 2]])

    top = at(rim - 0.03)
    centre = top.mean(axis=0)
    # The rays every outline is measured along: through the rim's corners, so the stem, the
    # transom's corners and the turn of the sides fall on them.
    corners = straightened(top, 0.035)
    angles = np.sort(np.arctan2(corners[:, 1] - centre[1], corners[:, 0] - centre[0]))
    way = np.stack([np.cos(angles), np.sin(angles)], axis=1)
    rings = [centre + way * along_rays(at(y), centre, angles)[:, None] for y in levels]
    n = len(angles)

    def band(lower: np.ndarray, y0: float, upper: np.ndarray, y1: float, facing_out: bool) -> Mesh:
        pts = np.concatenate(
            [
                np.stack([lower[:, 0], np.full(n, y0), lower[:, 1]], axis=1),
                np.stack([upper[:, 0], np.full(n, y1), upper[:, 1]], axis=1),
            ]
        )
        i = np.arange(n)
        j = (i + 1) % n
        tris = np.concatenate([np.stack([i, n + j, j], axis=1), np.stack([i, n + i, n + j], axis=1)])
        return Mesh(pts, tris if facing_out else tris[:, [0, 2, 1]])

    outside = [band(rings[k], levels[k], rings[k + 1], levels[k + 1], True) for k in range(len(levels) - 1)]
    inner = [inset(ring, BOAT_SIDE) for ring in rings]
    heights = [floor, levels[4], levels[-1]]
    within = [
        inset(centre + way * along_rays(at(max(y, low + 0.05)), centre, angles)[:, None], BOAT_SIDE) for y in heights
    ]
    inside_bands = [band(within[k], heights[k], within[k + 1], heights[k + 1], False) for k in range(2)]
    top_ring = band(inner[-1], rim, rings[-1], rim, False)
    deck = Mesh(
        np.stack([within[0][:, 0], np.full(n, floor), within[0][:, 1]], axis=1),
        np.stack([np.zeros(n - 2, np.int64), np.arange(2, n), np.arange(1, n - 1)], axis=1),
    )
    stem = hull(white.points[white.points[:, 1] > rim + 0.02], BLOCK, merge=0.06)
    return Boat(
        planks=[outside[0]] + [merged(outside[k : k + 2]) for k in range(1, len(outside), 2)],
        inside=merged([*inside_bands, top_ring, deck, stem]),
        outline=straightened(rings[-1], 0.08),
        rim=rim,
        floor=floor,
        side=BOAT_SIDE,
    )


def fitted(source: Mesh, points: np.ndarray) -> np.ndarray:
    """Texture coordinates for the points of a flat sheet rebuilt from `source`: the plane through
    the source's own coordinates, by least squares."""
    assert source.uv is not None
    at = np.c_[source.points, np.ones(len(source.points))]
    plane, *_ = np.linalg.lstsq(at, source.uv, rcond=None)
    return np.c_[points, np.ones(len(points))] @ plane


def slab(low: np.ndarray, high: np.ndarray) -> Mesh:
    """A box between two corners."""
    corners = np.array([[x, y, z] for x in (low[0], high[0]) for y in (low[1], high[1]) for z in (low[2], high[2])])
    return hull(corners, BLOCK, merge=0)


def pipe(mesh: Mesh, length: float = 1.2) -> Mesh:
    """A bent tube as a run of straight-sided lengths: its points sorted by how far along the
    tube's own surface they are from its top, cut every `length` metres (each cut sharing a ring
    with the next), and each length the convex shape round its points."""
    mesh = welded(mesh)
    edges = np.concatenate([mesh.tris[:, [0, 1]], mesh.tris[:, [1, 2]], mesh.tris[:, [2, 0]]])
    span = np.linalg.norm(mesh.points[edges[:, 0]] - mesh.points[edges[:, 1]], axis=1)
    n = len(mesh.points)
    far = dijkstra(
        coo_matrix((span, (edges[:, 0], edges[:, 1])), shape=(n, n)),
        directed=False,
        indices=int(np.argmax(mesh.points[:, 1])),
    )
    far[~np.isfinite(far)] = 0
    lengths = []
    for start in np.arange(0, far.max(), length):
        within = mesh.points[(far >= start - 0.15) & (far <= start + length + 0.15)]
        if len(within) >= 4:
            lengths.append(hull(within, ANYWAY, merge=0.12))
    return merged(lengths)


PROUD = 0.03  # metres the kitchen's panels stand off the block behind them
LAPPED = {"Plane.008": 0.01, "Plane.012": 0.02}  # metres more for the panels lying over others' edges
# Metres up the boat's side the sim stops at, a little under its rim (1.68 m): Squidward jumps
# 1.28 m and a walker steps the last of a climb, so this is what lets him into his own boat.
BOAT_RIM = 1.5

X, Y, Z = np.eye(3)  # the game's frame: along the building, up, and out through the door
DRUM = around(8, (-40.0, 40.0))  # an eight-sided drum: its two rims
SIX = around(6, (-40.0, 40.0))


@dataclass
class Piece:
    """Triangles bound for one part of the model, in one look: a plain colour of the atlas (a
    material's name), a picture in it (the mesh has its texture coordinates), or for the timber
    the way its planks run ("along" the building, "around" an arch, "up" a post)."""

    part: str
    look: str
    mesh: Mesh


@dataclass
class Door:
    """One leaf of the front door: the part it is drawn from and, on the floor, where its pin is,
    the way it runs from the pin shut (radians from +x toward +z), how far, how tall, and how far
    it swings open."""

    part: str
    hinge: tuple[float, float]
    bearing: float
    reach: float
    height: float
    swing: float


@dataclass
class Model:
    """Everything the model comes to: its pieces, what the sim collides with (boxes as
    [x, z, y, w, d, h, yaw], and ramps as [lowX, lowZ, highX, highZ, y, w, h] like a flight of
    one), and the door's leaves."""

    pieces: list[Piece] = field(default_factory=list)
    boxes: list[list[float]] = field(default_factory=list)
    ramps: list[list[float]] = field(default_factory=list)
    doors: list[Door] = field(default_factory=list)

    def add(self, part: str, look: str, mesh: Mesh) -> Mesh:
        if len(mesh):
            self.pieces.append(Piece(part, look, mesh))
        return mesh

    def box(self, low: np.ndarray, high: np.ndarray, thin: float = 0.0) -> None:
        """A box between two corners, widened to `thin` across the floor if it is thinner."""
        size = np.maximum(high - low, [thin, 0, thin])
        mid = (low + high) / 2
        self.boxes.append([mid[0], mid[2], low[1], size[0], size[2], high[1] - low[1], 0.0])

    def bounds(self, mesh: Mesh, thin: float = 0.0) -> None:
        at = mesh.points[np.unique(mesh.tris)]
        self.box(at.min(axis=0), at.max(axis=0), thin)


WALL = 0.3  # metres: the thinnest a wall of the sim's may be (a pane of glass is thinner)


def rects(mask: np.ndarray) -> list[tuple[int, int, int, int]]:
    """A bitmap's filled cells as rectangles (column, row, columns, rows), each grown as wide as
    it goes and then as tall."""
    left = mask.copy()
    out = []
    while left.any():
        r, c = np.unravel_index(int(np.argmax(left)), left.shape)
        w = 1
        while c + w < left.shape[1] and left[r, c + w]:
            w += 1
        h = 1
        while r + h < left.shape[0] and left[r + h, c : c + w].all():
            h += 1
        left[r : r + h, c : c + w] = False
        out.append((int(c), int(r), w, h))
    return out


def blocks(mesh: Mesh, axis: np.ndarray, cell: float) -> list[tuple[np.ndarray, np.ndarray]]:
    """A mesh cut from a board lying square to `axis` (one of X, Y, Z) as boxes, each a pair of
    corners: its silhouette on a grid of `cell` metres, a cell counted when its middle is covered,
    in as few rectangles as cover it, each as deep as the mesh."""
    k = int(np.argmax(np.abs(axis)))
    i, j = [n for n in range(3) if n != k]
    at = mesh.points
    low = np.floor(at.min(axis=0) / cell) * cell
    size = np.ceil((at.max(axis=0) - low) / cell).astype(int) + 1
    scale = 4  # the bitmap is drawn this many times finer, and a cell is filled if half of it is
    image = Image.new("1", (int(size[i]) * scale, int(size[j]) * scale), 0)
    draw = ImageDraw.Draw(image)
    px = (at[:, [i, j]] - low[[i, j]]) / cell * scale
    for a, b, c in px[mesh.tris].tolist():
        draw.polygon([tuple(a), tuple(b), tuple(c)], fill=1)
    fine = np.asarray(image).reshape(int(size[j]), scale, int(size[i]), scale)
    mask = fine.sum(axis=(1, 3)) * 2 >= scale * scale
    out = []
    for c, r, w, h in rects(mask):
        a, b = np.empty(3), np.empty(3)
        a[i], b[i] = low[i] + c * cell, low[i] + (c + w) * cell
        a[j], b[j] = low[j] + r * cell, low[j] + (r + h) * cell
        a[k], b[k] = at[:, k].min(), at[:, k].max()
        out.append((a, b))
    return out


def build(objs: dict[str, Obj]) -> Model:
    model = Model()
    used: set[str] = set()

    def take(name: str) -> Obj:
        """An object by its name, or the start of it (a few have accents the file garbles)."""
        name = name if name in objs else next(n for n in objs if n.startswith(name))
        used.add(name)
        return objs[name]

    def one(name: str) -> Mesh:
        """The mesh of an object in one material."""
        (mesh,) = take(name).meshes.values()
        return mesh

    # The scenery, what's too fine to see, and a second copy of two things.
    for name in objs:
        if name.startswith("Algue") or name in (
            "Sphere",  # the sky
            "Plane.001",  # the sand and the base under it
            "Plane.002",
            "Plane.035",  # the road
            "Circle.011",  # the two houses
            "Circle.016",
            "Circle.002",  # the floor's nails
            "Circle.010",  # a row of rivets along the kitchen's top
            "Cylinder.004",  # a column's foot, twice
            "Plane.003",  # a steel panel, twice
        ):
            used.add(name)

    # The barrel: seven staves, each a board the building's length, from the back wall over the
    # top to the band above the front windows. Upright ones are walls to the sim; a leaning one
    # is the wedge under its outer face, which is all anything outside can touch.
    for stave in loose(one("Toit")):
        board = model.add("roof", "along", prism(stave, X, tolerance=0.04))
        at = board.points
        section = np.unique(np.round(at[:, [2, 1]], 3), axis=0)
        # The board's own two ways in its section: across its width, and out through its outer
        # face, the one away from the middle of the room. The outer face runs between the outer
        # corners furthest apart, and its slope says whether the board stands, lies or leans.
        middle = section.mean(axis=0)
        _, _, (across, out) = np.linalg.svd(section - middle, full_matrices=False)
        out = out if out @ (middle - [0, 5]) > 0 else -out
        face = section[(section - middle) @ out > 0]
        low, high = sorted(face[np.argsort(face @ across)[[0, -1]]], key=lambda corner: corner[1])
        slope = np.degrees(np.arctan2(high[1] - low[1], abs(high[0] - low[0])))
        if slope < 8 or slope > 80:
            model.bounds(board)
            continue
        mid = (at[:, 0].min() + at[:, 0].max()) / 2
        model.ramps.append([mid, low[0], mid, high[0], low[1], np.ptp(at[:, 0]), high[1] - low[1]])

    # The two ends: the arch, the wall under it down to the windows, and the rope net over the
    # glass, each cut from a board standing across the building. To the sim the arch and the wall
    # are stacks of boxes half a metre tall.
    for arch in loose(one("Arche bati")):
        board = model.add("frame", "around", prism(arch, X, cell=0.03, tolerance=0.05))
        for a, b in blocks(board, X, 0.5):
            model.box(a, b)
    for wall in loose(one("Murs 01")):
        board = model.add("roof", "along", prism(wall, X, cell=0.03, tolerance=0.05))
        for a, b in blocks(board, X, 0.5):
            model.box(a, b)
    for name in ("Cordage bati ext", "Cordage bati ext.001"):
        # Nothing to the sim: the glass and the wall stand just behind it.
        model.add("trim", "Cordage", prism(one(name), X, tolerance=0.05, least=0.02, sheet=True))

    # The plinth round the floor, open at the door, and the door's frame.
    plinth = model.add("frame", "along", prism(one("Fondations"), Y, cell=0.03, tolerance=0.05))
    for a, b in blocks(plinth, Y, 0.05):
        model.box(a, b)
    posts = model.add("roof", "up", prism(one("Montant porte"), Z, tolerance=0.04))
    for a, b in blocks(posts, Z, 0.05):
        model.box(a, b)

    # The glass: four panes, along the front either side of the door and under each arch.
    glass = take("Vitres").meshes["EEVEE_Glass_Shader"]
    model.add("glass", "glass", glass)
    for pane in loose(glass):
        model.bounds(pane, WALL)

    # The door: two leaves of glass meeting in the middle, each with its handle, hung at its
    # outer edge to open outward. The sim's slab hangs behind its pin (sim/doors.ts), so each
    # pin stands half the slab in front of the glass or behind it.
    leaves = sorted(loose(one("Porte vitr")), key=lambda leaf: leaf.points[:, 0].mean())
    handles = sorted(loose(one("Poign")), key=lambda h: h.points[:, 0].mean())
    for side, leaf, handle in zip(("left", "right"), leaves, handles):
        at = leaf.points
        outer = at[:, 0].min() if side == "left" else at[:, 0].max()
        z = (at[:, 2].min() + at[:, 2].max()) / 2 + (WALL / 2 if side == "left" else -WALL / 2)
        pin = np.array([outer, 0.0, z])
        model.add(f"door-{side}", "glass", Mesh(leaf.points - pin, leaf.tris))
        model.add(f"handle-{side}", "Poigne_dore", hull(handle.points - pin, BLOCK, merge=0.08))
        model.doors.append(
            Door(
                part=side,
                hinge=(float(pin[0]), float(pin[2])),
                bearing=0.0 if side == "left" else float(np.pi),
                reach=float(np.ptp(at[:, 0])),
                height=float(at[:, 1].max()),
                swing=float(np.pi / 2) if side == "left" else -float(np.pi / 2),
            )
        )

    # On the roof: its big rivets, the chimney on its plate, and the aerial.
    for rivet in loose(one("Clous toit")):
        model.add("trim", "Chocofur_Metal_Solid_05", hull(rivet.points, ANYWAY, merge=0.22))
    stack = [take("Chemin"), take("Cylinder.029"), take("Cylinder.014")]
    for obj in stack:
        for mesh in obj.meshes.values():
            for piece in loose(mesh):
                model.add("trim", "Chocofur_Metal_Solid_01", hull(piece.points, DRUM, merge=0.1))
    model.add("trim", "Chocofur_Metal_Solid_01", hull(one("Cube.033").points, BLOCK))
    model.bounds(one("Chemin"))
    for rod in loose(without_small(welded(one("Antenne")), 0.5)):
        # The mast, and the two bars crossed on it.
        upright = np.ptp(rod.points[:, 1]) > np.ptp(rod.points[:, 0])
        model.add("trim", "Antenne", hull(rod.points, SIX, merge=0.03) if upright else prism(rod, Y, tolerance=0.02))

    # The flags along the front, each a sheet in its two colours (one has a picture), on their rope.
    for name in ("Plane.019", "Plane.005", "Plane.061", "Plane.028", "Plane.013"):
        for material, cloth in take(name).meshes.items():
            flag = prism(cloth, Z, tolerance=0.04, sheet=True)
            if material == "Flag-Jaune":
                flag.uv = fitted(cloth, flag.points)
            model.add("trim", material, flag)
    model.add("trim", "Cordage", prism(one("Plane.020"), Z, tolerance=0.04, least=0.002, sheet=True))

    # The floor: one slab for the 305 planks.
    planks = one("Plane.250").points
    low, high = planks.min(axis=0), planks.max(axis=0)
    model.add("floor", "along", slab(low, high))
    model.box(np.array([low[0], 0.0, low[2]]), high)

    # The two posts down the middle with their steel collars, and the beams across over them in
    # their brackets.
    for name in ("Cylinder.013", "Cylinder"):
        post = model.add("roof", "up", hull(one(name).points, DRUM, merge=0.1))
        model.bounds(post)
    for name in ("Cylinder.015", "Cylinder.016", "Cylinder.017", "Cylinder.018", "Cylinder.028", "Cylinder.046"):
        model.add("trim", "Mtal_poutre", hull(take(name).meshes["Mtal_poutre"].points, DRUM, merge=0.1))
    for name in ("Cube.003", "Cube"):
        beam = model.add("frame", "across", hull(one(name).points, BLOCK))
        model.bounds(beam)
    for name in ("Cube.008", "Cube.005"):
        for strap in loose(take(name).meshes["Mtal_poutre"]):
            model.add("trim", "Mtal_poutre", hull(strap.points, BLOCK, merge=0.08))

    # The kitchen: a block the building's length with the loft on top, steel panels over its
    # front, the three doors and the order window (a dark box behind it), none of which open.
    kitchen = take("Cube.010")
    for material, mesh in kitchen.meshes.items():
        model.add("trim", material, mesh)
    at = np.concatenate([m.points for m in kitchen.meshes.values()])
    low, high = at.min(axis=0), at.max(axis=0)
    face = float(np.unique(np.round(at[:, 2], 2))[-2]) + PROUD + 0.04  # the panels' own face
    ledge = float(np.unique(np.round(at[:, 1], 2))[-2])  # where the cornice along the top begins
    model.box(low, np.array([high[0], ledge, face]))
    model.box(np.array([low[0], ledge, low[2]]), high)
    dark = one("Cube.014")
    model.add("trim", "Material.003", Mesh(dark.points - 0.03 * Z, dark.tris))
    for name in ("Cube.018", "Cube.017", "Plane.008", "Plane.011", "Plane.012", "Cube.015", "Cube.019"):
        for material, mesh in take(name).meshes.items():
            if material.startswith("Cuisine"):
                panel = prism(mesh, Z, tolerance=0.03) if len(mesh) > 100 else Mesh(mesh.points.copy(), mesh.tris)
                # A little proud of the block's face, so the two never share a plane, and the two
                # panels that lap over their neighbours a little further still.
                panel.points += (PROUD + LAPPED.get(name, 0.0)) * Z
                model.add("trim", material, panel)
    for name in ("Circle.008", "Circle.007", "Circle.009", "Cube.013"):
        for material, mesh in take(name).meshes.items():
            if material.startswith("Metal_porte"):
                model.add("trim", material, prism(mesh, Z, cell=0.01, tolerance=0.025, least=0.01))
            elif material.startswith("EEVEE"):
                model.add("trim", "porthole", prism(mesh, Z, cell=0.01, tolerance=0.025))
    model.add("trim", "Chocofur_Metal_Solid_05", prism(one("Torus.001"), Z, cell=0.01, tolerance=0.02))

    # Over the boat: the menu on its ropes and pulleys, and the ORDER HERE sign.
    for name in ("Plane.018", "Plane.059"):
        for material, mesh in take(name).meshes.items():
            model.add("trim", material, mesh)
    for name in ("Plane.062", "Plane.063"):
        model.add("trim", "Cordage", prism(one(name), X, tolerance=0.03, least=0.002, sheet=True))
    for name in ("Plane.064", "Plane.065"):
        model.add("trim", "Cordage", hull(one(name).points, BLOCK, merge=0.01))
    for name in ("Cube.032", "Cube.034", "Cylinder.047", "Cylinder.049"):
        model.add("trim", "Box_1", hull(one(name).points, BLOCK, merge=0.08))
    used.update(("Cylinder.048", "Cylinder.050"))  # their hooks

    # The cashier's boat: the hull, the bench in its stern, the counter in its bow and the till.
    hull_of = take("Cube.016")
    shell = boat(hull_of.meshes["Blanc_Bateau"], hull_of.meshes["Rouge_Bateau"])
    # The bottom plank is red; the white ones above it are told apart by a shade.
    for n, plank in enumerate(shell.planks):
        model.add("trim", "Rouge_Bateau" if n == 0 else "Blanc_Bateau" if n % 2 else "boat-shade", plank)
    model.add("trim", "Blanc_Bateau", shell.inside)
    ring = shell.outline
    for a, b in zip(ring, np.roll(ring, -1, axis=0)):
        # Each side of the rim a wall, its outer face on the rim.
        along = (b - a) / np.linalg.norm(b - a)
        inward = np.array([-along[1], along[0]]) * shell.side / 2
        mid = (a + b) / 2 + inward
        model.boxes.append(
            [
                mid[0],
                mid[1],
                0.0,
                shell.side,
                float(np.linalg.norm(b - a)),
                BOAT_RIM,
                float(np.arctan2(along[0], along[1])),
            ]
        )
    keel = hull_of.meshes["Blanc_Bateau"].points
    keel = keel[keel[:, 1] < shell.floor + 0.02]
    model.box(
        np.array([keel[:, 0].min(), 0.0, keel[:, 2].min()]), np.array([keel[:, 0].max(), shell.floor, keel[:, 2].max()])
    )
    bench = model.add("trim", "Blanc_Bateau", hull(one("Cube.020").points, BLOCK))
    model.bounds(bench)
    model.add("trim", "Cube.022__0", hull(one("Cube.022").points, BLOCK, merge=0.1))
    counter = model.add("trim", "Cube.022__0", hull(one("Cube.023").points, BLOCK, merge=0.1))
    model.bounds(counter)
    till = model.add("trim", "Caisse_enregistreuse", prism(one("Cube.021"), X, cell=0.01, tolerance=0.02))
    model.bounds(till)
    model.add("trim", "Caisse_enregistreuse", hull(one("Cube.024").points, BLOCK))
    used.update(("Circle.019", "Circle.020", "Circle.021", "Cube.001"))  # the till's keys and glass

    # The tables: a ship's wheel round a yellow top, on a steel post and foot. To the sim, the
    # top (two boxes, turned an eighth of a turn apart, for its round) and the post.
    for name in ("Circle", "Circle.001", "Circle.003", "Circle.004", "Circle.005", "Circle.006"):
        table = take(name)
        wheel = model.add("trim", "Rouge_table", prism(table.meshes["Rouge_table"], Y, tolerance=0.035, least=0.01))
        model.add("trim", "Jaune_table", hull(table.meshes["Jaune_table"].points, DRUM, merge=0.1))
        for part in loose(without_small(welded(table.meshes["Metal_table"]))):
            at = part.points
            if np.ptp(at[:, 1]) < 0.8:
                model.add("trim", "Metal_table", hull(at, DRUM, merge=0.06))
                continue
            # The post and its foot are one piece: apart, so the post stays thin.
            foot = at[:, 1] < at[:, 1].min() + 0.2
            model.add("trim", "Metal_table", hull(at[foot], DRUM, merge=0.04))
            model.bounds(model.add("trim", "Metal_table", hull(at[~foot], SIX, merge=0.03)), WALL)
        top = table.meshes["Jaune_table"].points
        mid, across = (top.min(axis=0) + top.max(axis=0)) / 2, float(np.ptp(top[:, 0]))
        under, over = float(wheel.points[:, 1].min()), float(wheel.points[:, 1].max())
        for turn in (0.0, np.pi / 4):
            model.boxes.append([mid[0], mid[2], under, across * 0.92, across * 0.92, over - under, turn])

    # The stools: barrels, each with its hoops.
    for name in [f"Cylinder.{n:03d}" for n in (5, 6, 7, 8, 9, 10, 11, 12, 51, 52, 53, 54)]:
        stool = take(name)
        barrel = model.add("trim", "Bois_tabouret", hull(stool.meshes["Bois_tabouret"].points, ROUND, merge=0.08))
        model.add("trim", "Bois_tabouret.002", hull(stool.meshes["Bois_tabouret.002"].points, DRUM, merge=0.08))
        for hoop in loose(without_small(welded(stool.meshes["Chocofur_Metal_Solid_01.003"]))):
            model.add("trim", "Chocofur_Metal_Solid_01.003", hull(hoop.points, DRUM, merge=0.08))
        at = barrel.points
        mid, across = (at.min(axis=0) + at.max(axis=0)) / 2, float(np.ptp(at[:, 0])) * 0.85
        model.boxes.append([mid[0], mid[2], 0.0, across, across, float(at[:, 1].max()), 0.0])

    # What's on the tables: trays, drinks and burger boxes (the straws are too fine to keep).
    for name, obj in objs.items():
        materials = set(obj.meshes)
        if materials == {"Plateau"}:
            model.add("trim", "Plateau", hull(one(name).points, BLOCK, merge=0.02))
        elif materials == {"Burger_box"}:
            for box in loose(one(name)):
                model.add("trim", "Burger_box", hull(box.points, BLOCK, merge=0.06))
        elif "Soda.001" in materials:
            model.add("trim", "Soda.001", hull(take(name).meshes["Soda.001"].points, SIX, merge=0.04))
        elif materials <= {"Soda_2.001", "Paille.001"}:
            used.add(name)

    # The loft over the kitchen: crates and sacks, the anchor against the back wall, and the
    # chimney's pipe coming down through the roof.
    for name, obj in objs.items():
        materials = set(obj.meshes)
        if materials == {"Box_2", "Box_1"}:
            crate = model.add(
                "trim", "Box_2", hull(np.concatenate([m.points for m in take(name).meshes.values()]), BLOCK, merge=0.1)
            )
            model.bounds(crate)
        elif materials == {"tOILE_JUTE"}:
            model.add("trim", "tOILE_JUTE", hull(one(name).points, ANYWAY, merge=0.15))
    model.add("trim", "Chocofur_Metal_Solid_05", prism(one("Torus.002"), tolerance=0.04, least=0.01))
    model.add("trim", "Chocofur_Metal_Solid_01", pipe(one("Plane.010")))
    used.add("Plane.006")  # the pipe's bands

    left = sorted(set(objs) - used)
    if left:
        raise SystemExit(f"objects with no place in the build: {left}")
    return model


TILE = 4.0  # metres to a repeat of the timber's planks: four to the repeat, a metre each
FLOOR_TILE = 3.0  # and of the floor's
TEXELS = 32  # across a plank texture: the world's own textures are this size (structureMaterials.ts)
UV_UNIT = 4096  # texture coordinate units to the repeat in the part files
CREASE = 40.0  # degrees between two faces past which the edge they share is drawn sharp
PICTURES = {"Menu_1": 96, "Menu_3": 40, "Flag-Jaune": 32}  # materials that keep their picture, and how tall, px
GLASS = (176, 216, 235)
PORTHOLE = (128, 170, 205)


def colours(doc: dict, blob: bytes) -> dict[str, tuple[int, int, int]]:
    """Each material's plain colour: its base colour times the middle of its texture, if it has one."""
    out: dict[str, tuple[int, int, int]] = {"glass": GLASS, "porthole": PORTHOLE}
    for material in doc["materials"]:
        pbr = material.get("pbrMetallicRoughness", {})
        linear = np.array(pbr.get("baseColorFactor", [1, 1, 1, 1])[:3])
        texture = pbr.get("baseColorTexture", {}).get("index")
        if texture is not None:
            linear = linear * (np.asarray(picture(doc, blob, texture)).reshape(-1, 3) / 255).mean(axis=0) ** 2.2
        out[material["name"]] = tuple(int(c) for c in np.round(255 * linear ** (1 / 2.2)))
    out["boat-shade"] = tuple(int(c * 0.86) for c in out["Blanc_Bateau"])
    return out


def picture(doc: dict, blob: bytes, texture: int) -> Image.Image:
    view = doc["bufferViews"][doc["images"][doc["textures"][texture]["source"]]["bufferView"]]
    return Image.open(io.BytesIO(blob[view["byteOffset"] : view["byteOffset"] + view["byteLength"]])).convert("RGB")


def planks(base: tuple[int, int, int], seed: int, ends: bool = False) -> Image.Image:
    """A square of four planks running across it, in the world's chunky pixels: each its own shade
    of `base`, lit along its top edge and dark along its seam, flecked with grain; with `ends`,
    each butted against the next board somewhere along it, with a nail either side of the joint."""
    rng = np.random.default_rng(seed)
    tall = TEXELS // 4
    px = np.empty((TEXELS, TEXELS, 3))
    for plank in range(4):
        rows = slice(plank * tall, (plank + 1) * tall)
        px[rows] = np.array(base) * (0.9 + 0.2 * rng.random())
        px[rows] *= np.where(rng.random((tall, TEXELS, 1)) < 0.1, 0.86, 1.0)
        for _ in range(3):  # streaks of grain
            y, x, run = plank * tall + rng.integers(1, tall - 1), rng.integers(TEXELS), rng.integers(3, 8)
            px[y, np.arange(x, x + run) % TEXELS] *= 0.84
        px[plank * tall] *= 1.12
        px[(plank + 1) * tall - 1] *= 0.55
        if ends:
            end = int(rng.integers(TEXELS))
            px[rows, end] *= 0.6
            px[plank * tall + tall // 2, [(end - 2) % TEXELS, (end + 2) % TEXELS]] = np.array(base) * 0.45
    return Image.fromarray(np.clip(px, 0, 255).astype(np.uint8))


def planked(piece: Piece, tile: float) -> np.ndarray:
    """Texture coordinates for a piece of timber, by triangle and corner: each face mapped flat in
    metres with the planks running the piece's way where the face allows (along the building,
    across it, up a post, or round an arch, square to its length), `tile` to the repeat."""
    at = piece.mesh.points[piece.mesh.tris]
    normal = np.cross(at[:, 1] - at[:, 0], at[:, 2] - at[:, 0])
    normal /= np.linalg.norm(normal, axis=1, keepdims=True) + 1e-12
    if piece.look == "around":
        way = np.cross(normal, X)
    else:
        way = np.tile({"along": X, "across": Z, "up": Y}[piece.look], (len(at), 1))
    way = way - np.einsum("ij,ij->i", way, normal)[:, None] * normal
    # A face square to the planks' way has no way of its own: its planks run level instead.
    spare = np.where(np.abs(normal[:, 1:2]) > 0.9, X if piece.look != "along" else Z, np.cross(Y, normal))
    spare /= np.linalg.norm(spare, axis=1, keepdims=True) + 1e-12
    lost = np.linalg.norm(way, axis=1) < 0.3
    way[lost] = spare[lost]
    way /= np.linalg.norm(way, axis=1, keepdims=True)
    across = np.cross(normal, way)
    return np.stack([np.einsum("fcj,fj->fc", at, way), np.einsum("fcj,fj->fc", at, across)], axis=2) / tile


def atlas(model: Model, doc: dict, blob: bytes) -> tuple[Image.Image, dict[str, tuple[float, float, float, float]]]:
    """One small image for everything that isn't timber: the pictures that are kept, each cut to
    the part of its image its piece shows and shrunk, with its edge repeated round it; then every
    plain colour in use, a few pixels each. Returns it with each look's place in it (left, top,
    width, height, as fractions; a colour's is a point)."""
    shade = colours(doc, blob)
    looks = sorted({piece.look for piece in model.pieces if piece.part not in ("roof", "frame", "floor")})
    pad, cell, width = 2, 4, 128
    cuts: dict[str, tuple[Image.Image, np.ndarray, np.ndarray]] = {}
    for material in doc["materials"]:
        name = material["name"]
        if name in PICTURES and name in looks:
            uv = np.concatenate([piece.mesh.uv for piece in model.pieces if piece.look == name])
            low, high = uv.min(axis=0), uv.max(axis=0)
            image = picture(doc, blob, material["pbrMetallicRoughness"]["baseColorTexture"]["index"])
            box = (low[0] * image.width, low[1] * image.height, high[0] * image.width, high[1] * image.height)
            tall = PICTURES[name]
            wide = max(1, round(tall * (box[2] - box[0]) / (box[3] - box[1])))
            cuts[name] = (image.crop(tuple(round(v) for v in box)).resize((wide, tall), Image.LANCZOS), low, high)
    spots: dict[str, tuple[int, int, int, int]] = {}
    x = y = 0
    for name, (image, _, _) in cuts.items():
        if x + image.width + 2 * pad > width:
            x, y = 0, max(sy + sh for _, sy, _, sh in spots.values()) + 2 * pad
        spots[name] = (x + pad, y + pad, image.width, image.height)
        x += image.width + 2 * pad
    y = max((sy + sh + pad for _, sy, _, sh in spots.values()), default=0)
    plain = [look for look in looks if look not in cuts]
    for n, look in enumerate(plain):
        spots[look] = ((n % (width // cell)) * cell, y + (n // (width // cell)) * cell, cell, cell)
    height = y + -(-len(plain) // (width // cell)) * cell
    sheet = Image.new("RGB", (width, height), (128, 128, 128))
    for name, (image, _, _) in cuts.items():
        sx, sy, _, _ = spots[name]
        sheet.paste(
            Image.fromarray(np.pad(np.asarray(image), ((pad, pad), (pad, pad), (0, 0)), mode="edge")),
            (sx - pad, sy - pad),
        )
    for look in plain:
        sx, sy, _, _ = spots[look]
        sheet.paste(shade[look], (sx, sy, sx + cell, sy + cell))
    places = {look: (sx / width, sy / height, sw / width, sh / height) for look, (sx, sy, sw, sh) in spots.items()}
    for name, (_, low, high) in cuts.items():
        for piece in model.pieces:
            if piece.look == name:
                assert piece.mesh.uv is not None
                px, py, pw, ph = places[name]
                piece.mesh.uv = np.array([px, py]) + (piece.mesh.uv - low) / (high - low) * [pw, ph]
    print(f"atlas {width}x{height}: {len(cuts)} pictures, {len(plain)} colours")
    return sheet, places


def emit(name: str, corners: np.ndarray, uv: np.ndarray) -> tuple[int, int]:
    """Writes a part's mesh as the client reads it (render/models/Models.ts): counts (Uint32
    vertices, triangles), positions in centimetres (Int16), texture coordinates (Uint16, UV_UNIT
    to the repeat, v down the image, each triangle's brought down by whole repeats), triangles
    (Uint16) and unit normals (Int8). `corners` and `uv` are by triangle and corner. A corner's
    normal is that of the faces meeting at its spot that lie within CREASE of its own, so a board's
    edges are sharp and a barrel's side is round. Triangles are written wound the other way from
    the meshes here: the renderer takes a face for its front when its corners run clockwise."""
    cm = np.round(corners * 100).astype(np.int64)
    uv = uv - np.floor(uv.min(axis=1, keepdims=True))
    if uv.max() >= 16:
        raise SystemExit(f"{name}: a triangle spans {uv.max():.1f} repeats, too many for Uint16 coordinates")
    units = np.round(uv * UV_UNIT).astype(np.int64)
    flat = cm / 100
    face = np.cross(flat[:, 1] - flat[:, 0], flat[:, 2] - flat[:, 0])
    alive = np.linalg.norm(face, axis=1) > 1e-9
    cm, units, face = cm[alive], units[alive], face[alive]
    unit = face / np.linalg.norm(face, axis=1, keepdims=True)
    _, spot = np.unique(cm.reshape(-1, 3), axis=0, return_inverse=True)
    spot = spot.reshape(-1, 3)
    normals = np.empty((len(cm), 3, 3))
    order = np.argsort(spot.ravel(), kind="stable")
    starts = np.flatnonzero(np.r_[True, np.diff(spot.ravel()[order]) != 0, True])
    limit = np.cos(np.radians(CREASE))
    for a, b in pairwise(starts):
        faces = order[a:b] // 3
        for corner in order[a:b]:
            near = faces[unit[faces] @ unit[corner // 3] > limit]
            total = face[near].sum(axis=0)
            normals[corner // 3, corner % 3] = total / (np.linalg.norm(total) + 1e-12)
    packed = np.round(normals * 127).astype(np.int64)
    keys, index = np.unique(np.concatenate([cm, units, packed], axis=2).reshape(-1, 8), axis=0, return_inverse=True)
    if len(keys) > 65535:
        raise SystemExit(f"{name}: {len(keys)} vertices, too many for Uint16 triangles")
    out = OUT / f"{name}.bin"
    out.write_bytes(
        np.array([len(keys), len(cm)], dtype="<u4").tobytes()
        + keys[:, :3].astype("<i2").tobytes()
        + keys[:, 3:5].astype("<u2").tobytes()
        + index.reshape(-1, 3)[:, [0, 2, 1]].astype("<u2").tobytes()
        + keys[:, 5:].astype("i1").tobytes()
    )
    print(f"wrote {out.name}: {len(keys)} vertices, {len(cm)} triangles, {out.stat().st_size} bytes")
    return len(keys), len(cm)


# The parts, in the order they are drawn and listed: each one's texture, whether it repeats, how
# solid it is drawn if it is glass, and whether only its outside is drawn (the timber is all
# closed boards).
PARTS: dict[str, dict[str, object]] = {
    "roof": {"texture": "planks-dark", "wrap": True, "oneSided": True},
    "frame": {"texture": "planks", "wrap": True, "oneSided": True},
    "floor": {"texture": "floor", "wrap": True, "oneSided": True},
    "trim": {"texture": "atlas", "wrap": False},
    "glass": {"texture": "atlas", "wrap": False, "opacity": 0.3},
    "door-left": {"texture": "atlas", "wrap": False, "opacity": 0.4, "door": "left"},
    "door-right": {"texture": "atlas", "wrap": False, "opacity": 0.4, "door": "right"},
    "handle-left": {"texture": "atlas", "wrap": False, "door": "left"},
    "handle-right": {"texture": "atlas", "wrap": False, "door": "right"},
}


def write(model: Model, doc: dict, blob: bytes) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.iterdir():
        old.unlink()
    shade = colours(doc, blob)
    planks(shade["Bois_toit"], 1).save(OUT / "planks-dark.png", optimize=True)
    planks(shade["Bois_toit_2"], 2).save(OUT / "planks.png", optimize=True)
    planks(shade["Bois_parquet"], 3, ends=True).save(OUT / "floor.png", optimize=True)
    sheet, places = atlas(model, doc, blob)
    sheet.save(OUT / "atlas.png", optimize=True)
    total = 0
    for part, spec in PARTS.items():
        corners, uvs = [], []
        for piece in model.pieces:
            if piece.part != part:
                continue
            at = piece.mesh.points[piece.mesh.tris]
            if spec["wrap"]:
                uv = planked(piece, FLOOR_TILE if part == "floor" else TILE)
            elif piece.mesh.uv is not None and piece.look in PICTURES:
                uv = piece.mesh.uv[piece.mesh.tris]
            else:
                left, top, wide, tall = places[piece.look]
                uv = np.tile([left + wide / 2, top + tall / 2], (len(at), 3, 1))
            corners.append(at)
            uvs.append(uv)
        total += emit(part, np.concatenate(corners), np.concatenate(uvs))[1]
    print(
        f"{total} triangles; {sum(f.stat().st_size for f in OUT.iterdir())} bytes in {len(list(OUT.iterdir()))} files"
    )

    js = lambda v: "true" if v is True else "false" if v is False else f"'{v}'" if isinstance(v, str) else f"{v:g}"
    fields = lambda spec: ", ".join(f"{k}: {js(v)}" for k, v in spec.items())
    PARTS_TS.write_text(
        "\n".join(
            [
                "// Generated by scripts/krusty-krab-model.py from Mrlunettes' The Krusty Krab (Sketchfab,",
                "// CC BY-NC 4.0); don't edit. The Krusty Krab's parts: each one's mesh",
                "// (public/assets/models/krusty-krab/<name>.bin), its texture (<texture>.png beside it), whether",
                "// the texture repeats (coordinates run past 1) or is an atlas, how solid it's drawn if it's glass,",
                "// whether only its outside is drawn (the timber, all closed boards), and the leaf of the door it",
                "// hangs on, if it swings (content/krustyKrabProfile.ts).",
                "export interface KrustyKrabPart {",
                "  name: string;",
                "  texture: string;",
                "  wrap: boolean;",
                "  opacity?: number;",
                "  oneSided?: boolean;",
                "  door?: string;",
                "}",
                "",
                "export const KRUSTY_KRAB_PARTS: readonly KrustyKrabPart[] = [",
                *(f"  {{ name: '{part}', {fields(spec)} }}," for part, spec in PARTS.items()),
                "];",
                "",
            ]
        )
    )
    print(f"wrote {PARTS_TS}")

    num = lambda v: f"{round(float(v), 3) + 0.0:g}"
    row = lambda values: "[" + ", ".join(num(v) for v in values) + "]"
    everything = np.concatenate(
        [piece.mesh.points for piece in model.pieces if not piece.part.startswith(("door", "handle"))]
    )
    plinth = next(piece.mesh.points for piece in model.pieces if piece.part == "frame" and piece.look == "along")
    floor = max(piece.mesh.points[:, 1].max() for piece in model.pieces if piece.part == "floor")
    PROFILE_TS.write_text(
        "\n".join(
            [
                "// Generated by packages/client/scripts/krusty-krab-model.py from Mrlunettes' The Krusty Krab",
                "// (Sketchfab, CC BY-NC 4.0); don't edit. The Krusty Krab as the sim knows it",
                "// (content/krustyKrab.ts), in metres in the building's frame: its middle at the origin,",
                "// the ground at 0, its length along x and its door facing +z. `scale` is the metres to the",
                "// model's unit that puts Squidward's head a third of the way up the order window; `size` the",
                "// plinth's footprint (w along x, d along z) and the height of the arches; `top` the aerial's",
                "// tip; `floor` the dining room's boards. `boxes` is everything solid, each [x, z, y, w, d, h,",
                "// yaw] (its middle on the floor, its underside, its size, and its turn); `ramps` the roof's",
                "// leaning staves, each the wedge under its outer face, [lowX, lowZ, highX, highZ, y, w, h] (its",
                "// low and high edges' middles, its underside, its width along the building and its rise); and",
                "// `doors` the front door's two leaves (the pin, the way the leaf runs from it shut, from +x",
                "// toward +z, how far, how tall and thick, and how far it swings).",
                "export const KRUSTY_KRAB_PROFILE = {",
                f"  scale: {SCALE:.4f},",
                f"  size: {{ w: {num(np.ptp(plinth[:, 0]))}, d: {num(np.ptp(plinth[:, 2]))}, h: {num(max(p.mesh.points[:, 1].max() for p in model.pieces if p.part == 'frame'))} }},",
                f"  top: {num(everything[:, 1].max())},",
                f"  floor: {num(floor)},",
                "  boxes: [",
                *(f"    {row(box)}," for box in model.boxes),
                "  ],",
                "  ramps: [",
                *(f"    {row(ramp)}," for ramp in model.ramps),
                "  ],",
                "  doors: [",
                *(
                    line
                    for d in model.doors
                    for line in (
                        "    {",
                        f"      part: '{d.part}',",
                        f"      hinge: {row(d.hinge)},",
                        f"      bearing: {num(d.bearing)},",
                        f"      reach: {num(d.reach)},",
                        f"      height: {num(d.height)},",
                        f"      thickness: {num(WALL)},",
                        f"      swing: {num(d.swing)},",
                        "    },",
                    )
                ),
                "  ],",
                "} as const;",
                "",
            ]
        )
    )
    print(f"wrote {PROFILE_TS}: {len(model.boxes)} boxes, {len(model.ramps)} ramps, {len(model.doors)} door leaves")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    objs, doc, blob = load(sys.argv[1])
    print(
        f"scale {SCALE:.4f}; {len(objs)} objects, {sum(len(m) for o in objs.values() for m in o.meshes.values())} triangles"
    )
    write(build(objs), doc, blob)


if __name__ == "__main__":
    main()
