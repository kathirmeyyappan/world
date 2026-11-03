"""Builds the pineapple house (SpongeBob's) for the world from penqin's Sketchfab model: the client's
meshes (public/assets/models/pineapple-<part>.bin, fetched when a player comes near) and textures,
and the sim's content/pineappleProfile.ts.

    python packages/client/scripts/house-model.py path/to/spongebobs_house.glb

The model is a single skin: the pineapple's shell (a coarse lathe, open at the ground and at the
crown), a door panel with a porthole, three portholes in the wall, a chimney, the leaves, and the
rivets on all of those, over a dirt plane with a path of stones and flowers. Only the house is kept,
scaled so the shell's belly is OUTER round like the keep it replaces (its door then stands twenty
metres tall), and made into a building in three parts: the doorway is cut out of the shell where
the door panel stood, the shell gets an inner skin WALL inside it up to a flat ceiling
at CEILING with the reveal round the doorway between the two, whatever the portholes and chimney
poked through the wall is trimmed, and the crown is capped; the inner skin is a part of its own,
papered in bamboo (a tile painted here) rather than textured from the model; and the door panel is
a part of its own too, hung on its left edge with a plank back painted on, for the sim to swing
(content/pineapple.ts). The profile the sim collides with (the shell's rings, the doorway and its
door, the ceiling) comes from the same mesh.
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from glb import accessor, components, local_matrix, read_glb

OUTER = 20.0  # metres: the shell's radius at its widest, the keep's (content/keep.ts)
WALL = 2.0  # metres: how thick the shell is made
DOOR_SLAB = 0.12  # model units back from the door's face that the swinging slab is cut at
CEILING_RING = 4  # the shell's lathe ring (from the ground) the ceiling is hung at
TEXTURE_SIZE = 1024
WALLPAPER_TILE = 3.0  # metres of wall one repeat of the bamboo paper covers
CLIENT = Path(__file__).resolve().parents[1]
MODELS_OUT = CLIENT / "public/assets/models"
TEXTURE_OUT = CLIENT / "public/assets/textures/models/pineapple.png"
WALLPAPER_OUT = CLIENT / "public/assets/textures/models/wallpaper.png"
PROFILE_OUT = CLIENT.parent / "shared/src/content/pineappleProfile.ts"
# Plain colours painted into the texture's spare corner, for the surfaces the model doesn't have.
SWATCHES = {"reveal": (214, 180, 96), "ceiling": (121, 85, 48), "crown": (138, 107, 42)}
PLANKS = (TEXTURE_SIZE - 160, 240, TEXTURE_SIZE - 16, 456)  # where the door's plank back is painted


def main(path: str) -> None:
    doc, blob = read_glb(Path(path).read_bytes())
    house = load_mesh(doc, blob, "Circle.001_0")
    points, uv, tris = house["positions"], house["uvs"], house["triangles"]
    parts = components({"positions": points, "triangles": tris})
    owner = np.zeros(len(points), int)
    for k, verts in enumerate(parts):
        owner[verts] = k
    of = owner[tris[:, 0]]
    sizes = np.bincount(of, minlength=len(parts))
    shell = int(np.argmax(sizes))
    bounds = {k: (points[v].min(axis=0), points[v].max(axis=0)) for k, v in enumerate(parts)}
    # The door panel: the one part standing on the ground at the front, with its porthole and rivets;
    # none of them is kept, only the opening its outline makes.
    door = next(k for k in range(len(parts)) if k != shell and bounds[k][0][1] < 0.05 and bounds[k][1][2] > 0.8)
    (dx0, _, _), (dx1, door_top, _) = bounds[door]
    on_door = [
        k
        for k in range(len(parts))
        if k != shell and bounds[k][0][2] > 0.8 and bounds[k][0][0] >= dx0 - 0.02 and bounds[k][1][0] <= dx1 + 0.02
    ]
    rings = lathe_rings(points[parts[shell]])
    ceiling = rings[CEILING_RING][0]
    print(f"shell: {sizes[shell]} triangles, {len(rings)} rings; door {dx1 - dx0:.2f} wide, {door_top:.2f} tall")

    s = scale_for(rings)
    t = WALL / s
    # The shell, cut round the door, with its reveal, ceiling and crown cap; the portholes, chimney
    # and leaves as they are, but for what reached inside the inner skin.
    hole = arch(dx0, dx1, door_top)
    front, rest = cut_hole(points, uv, tris[of == shell], hole)
    outside = MeshBuilder()
    outside.add(front + rest, "texture")
    outside.add(reveal(front, hole, t), "reveal")
    outside.add(disc(outer_ring(front + rest, ceiling), (0, ceiling, 0), down=True), "ceiling")
    outside.add(disc(outer_ring(front + rest, rings[-1][0]), (0, rings[-1][0], 0), down=False), "crown")
    for k in range(len(parts)):
        if k == shell or k in on_door:
            continue
        keep = [tri for tri in triangles(points, uv, tris[of == k]) if not all(inside(p, rings, t) for p, _ in tri)]
        outside.add(keep, "texture")
    # The inner skin: the shell up to the ceiling, WALL inward, papered round and up.
    inside_ = MeshBuilder()
    inner_tris = [tri for tri in front + rest if all(p[1] <= ceiling + 0.03 for p, _ in tri)]
    inside_.add([[(inward(p, t), q) for p, q in reversed(tri)] for tri in inner_tris], "paper")
    # The door: the panel's front slab (its frame runs back into the wall, and that stays behind),
    # its porthole and rivets, about the hinge at its left edge, backed with planks.
    front_face = points[parts[door]][:, 2].max()
    slab = [
        tri
        for k in on_door
        for tri in triangles(points, uv, tris[of == k])
        if all(p[2] >= front_face - DOOR_SLAB for p, _ in tri)
    ]
    panel = np.array([p for tri in slab for p, _ in tri])
    hinge = panel[np.argmin(panel[:, 0])].copy()
    hinge[1] = 0
    door_part = MeshBuilder()
    door_part.add([[(p - hinge, q) for p, q in tri] for tri in slab], "texture")
    door_part.add(door_back(panel, hinge), "planks")

    atlas, swatch_uv = paint_atlas(doc, blob)
    atlas.quantize(256, dither=Image.Dither.FLOYDSTEINBERG).save(TEXTURE_OUT, optimize=True)
    paint_wallpaper().save(WALLPAPER_OUT, optimize=True)
    MODELS_OUT.mkdir(parents=True, exist_ok=True)
    emit_part("shell", outside, s, swatch_uv)
    emit_part("inside", inside_, s, swatch_uv, paper=(rings, s))
    emit_part("door", door_part, s, swatch_uv)
    emit_profile(rings, s, (dx0, dx1, door_top), panel, hinge, ceiling)


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
    """The shell's rings, lowest first: each one's height and mean radius about the y axis."""
    ys = np.sort(shell[:, 1])
    groups: list[list[float]] = [[ys[0]]]
    for y in ys[1:]:
        (groups[-1] if y - groups[-1][-1] < 0.1 else groups.append([y]) or groups[-1]).append(y)
    rings = []
    for g in groups:
        band = shell[(shell[:, 1] >= g[0] - 1e-9) & (shell[:, 1] <= g[-1] + 1e-9)]
        rings.append((float(np.mean(g)), float(np.hypot(band[:, 0], band[:, 2]).mean())))
    return rings


def scale_for(rings: list[tuple[float, float]]) -> float:
    return OUTER / max(r for _, r in rings)


def radius_at(rings: list[tuple[float, float]], y: float) -> float:
    ys, rs = zip(*rings)
    return float(np.interp(y, ys, rs))


def inside(p: np.ndarray, rings: list[tuple[float, float]], t: float) -> bool:
    """Whether a point is within the inner skin: under the ceiling and short of it by the wall."""
    return p[1] < rings[CEILING_RING][0] and np.hypot(p[0], p[2]) < radius_at(rings, p[1]) - t - 0.01


def inward(p: np.ndarray, t: float) -> np.ndarray:
    r = np.hypot(p[0], p[2])
    return np.array([p[0] * (1 - t / r), p[1], p[2] * (1 - t / r)])


Corner = tuple[np.ndarray, np.ndarray]  # position, texture coordinates
Triangle = list[Corner]


def triangles(points: np.ndarray, uv: np.ndarray, tris: np.ndarray) -> list[Triangle]:
    return [[(points[i], uv[i]) for i in tri] for tri in tris]


def arch(x0: float, x1: float, top: float, steps: int = 14) -> list[tuple[float, float]]:
    """The doorway's outline in the wall's (x, y) plane, counter-clockwise: an arch on a rectangle,
    reaching below the ground so the opening runs out the bottom of the shell."""
    r = (x1 - x0) / 2
    cx, cy = (x0 + x1) / 2, top - r
    outline = [(x0, -0.1), (x1, -0.1), (x1, cy)]
    outline += [(cx + r * np.cos(a), cy + r * np.sin(a)) for a in np.linspace(0, np.pi, steps + 1)[1:-1]]
    return outline + [(x0, cy)]


def cut_hole(points: np.ndarray, uv: np.ndarray, tris: np.ndarray, hole: list[tuple[float, float]]) -> tuple[list[Triangle], list[Triangle]]:
    """The shell's triangles with the doorway taken out of the front ones (the hole is convex, so
    what's left of a triangle is the pieces outside each of its edges and inside the ones before),
    and the rest untouched."""
    front: list[Triangle] = []
    rest: list[Triangle] = []
    for tri in triangles(points, uv, tris):
        if not all(p[2] > 0 for p, _ in tri) or all(p[1] > hole[-1][1] + 0.5 for p, _ in tri):
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
    return [t for t in tris if area(t) > 1e-10]


def area(tri: Triangle) -> float:
    a, b, c = (p for p, _ in tri)
    return float(np.linalg.norm(np.cross(b - a, c - a))) / 2


def on_outline(p: np.ndarray, hole: list[tuple[float, float]]) -> bool:
    """Whether a point of the front wall lies on the doorway's outline (above the ground)."""
    if p[1] < 0.01:
        return False
    for i in range(len(hole)):
        a, b = np.array(hole[i]), np.array(hole[(i + 1) % len(hole)])
        d = b - a
        f = np.clip(((p[:2][[0, 1]] - a) @ d) / (d @ d), 0, 1)
        if np.linalg.norm(a + d * f - p[[0, 1]]) < 1e-5:
            return True
    return False


def reveal(front: list[Triangle], hole: list[tuple[float, float]], t: float) -> list[Triangle]:
    """The doorway's jambs and arch: a strip from each edge of the hole on the outer skin to the same
    edge on the inner, facing into the opening."""
    centre = np.array([(hole[0][0] + hole[1][0]) / 2, hole[-1][1] / 2, 0.0])
    strips: list[Triangle] = []
    for tri in front:
        for k in range(3):
            p, q = tri[k][0], tri[(k + 1) % 3][0]
            if not (on_outline(p, hole) and on_outline(q, hole)) or abs(p[1] - q[1]) + abs(p[0] - q[0]) < 1e-9:
                continue
            swatch = np.array([0.0, 0.0])
            pi, qi = inward(p, t), inward(q, t)
            for tri2 in ([(p, swatch), (q, swatch), (qi, swatch)], [(p, swatch), (qi, swatch), (pi, swatch)]):
                a, b, c = (v for v, _ in tri2)
                if np.cross(b - a, c - a) @ (centre - (a + b + c) / 3) < 0:
                    tri2 = [tri2[0], tri2[2], tri2[1]]
                strips.append(tri2)
    return strips


def door_back(panel: np.ndarray, hinge: np.ndarray) -> list[Triangle]:
    """A flat arch the panel's size behind it (in its own frame, about the hinge), planked, facing the
    room: the panel is skinned on the outside only."""
    x0, x1 = panel[:, 0].min() - hinge[0], panel[:, 0].max() - hinge[0]
    top = panel[:, 1].max()
    z = panel[:, 2].min() - hinge[2]
    outline = arch(x0, x1, top)
    outline[0] = (x0, 0.0)
    outline[1] = (x1, 0.0)
    pts = [np.array([x, y, z]) for x, y in outline]
    centre = np.array([(x0 + x1) / 2, top / 2, z])
    uvs = [np.array([(x - x0) / (x1 - x0), 1 - y / top]) for x, y in outline]
    tris = []
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        tri = [(centre, np.array([0.5, 0.5])), (a, uvs[i]), (b, uvs[(i + 1) % len(pts)])]
        if np.cross(a - centre, b - centre)[2] > 0:  # must face -z, into the house
            tri = [tri[0], tri[2], tri[1]]
        tris.append(tri)
    return tris


def outer_ring(tris: list[Triangle], y: float) -> list[np.ndarray]:
    """The shell's vertices on the ring at height y, round in angle order."""
    seen: dict[tuple[float, float, float], np.ndarray] = {}
    for tri in tris:
        for p, _ in tri:
            if abs(p[1] - y) < 0.05:
                seen[tuple(np.round(p, 5))] = p
    return sorted(seen.values(), key=lambda p: np.arctan2(p[0], p[2]))


def disc(ring: list[np.ndarray], centre: tuple[float, float, float], down: bool) -> list[Triangle]:
    """A fan over a ring, facing down (a ceiling) or up (a cap)."""
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


class MeshBuilder:
    """Collects triangles by surface: textured from the model, a swatch of plain colour, the planks
    region or the bamboo paper (coordinates worked out from where the vertex is)."""

    def __init__(self) -> None:
        self.tris: list[tuple[Triangle, str]] = []

    def add(self, tris: list[Triangle], surface: str) -> None:
        self.tris += [(t, surface) for t in tris]


def paint_atlas(doc: dict, blob: bytes) -> tuple[Image.Image, dict[str, np.ndarray]]:
    """The model's texture at TEXTURE_SIZE, with the swatches and the door's planks painted into its
    empty right-hand strip; and each swatch's texture coordinates (its middle)."""
    import io

    image = next(
        doc["images"][doc["textures"][m["extensions"]["KHR_materials_pbrSpecularGlossiness"]["diffuseTexture"]["index"]]["source"]]
        for m in doc["materials"]
        if m["name"] == "home"
    )
    view = doc["bufferViews"][image["bufferView"]]
    atlas = Image.open(io.BytesIO(blob[view["byteOffset"] : view["byteOffset"] + view["byteLength"]])).convert("RGB")
    atlas = atlas.resize((TEXTURE_SIZE, TEXTURE_SIZE), Image.Resampling.LANCZOS)
    swatch_uv: dict[str, np.ndarray] = {}
    for i, (name, colour) in enumerate(SWATCHES.items()):
        box = (TEXTURE_SIZE - 64, 16 + i * 64, TEXTURE_SIZE - 16, 64 + i * 64)
        atlas.paste(Image.new("RGB", (48, 48), colour), box[:2])
        swatch_uv[name] = np.array([(box[0] + box[2]) / 2 / TEXTURE_SIZE, (box[1] + box[3]) / 2 / TEXTURE_SIZE])
    atlas.paste(paint_planks(PLANKS[2] - PLANKS[0], PLANKS[3] - PLANKS[1]), PLANKS[:2])
    return atlas, swatch_uv


def paint_planks(w: int, h: int) -> Image.Image:
    """Upright planks of warm wood with dark seams, a brace across the bottom, and the porthole's
    ring in the upper middle, as the door's inside: a few pixels per plank, like the world's textures."""
    rng = np.random.default_rng(4)
    img = Image.new("RGB", (w, h))
    px = img.load()
    shades = [(150, 103, 52), (138, 94, 47), (160, 112, 60), (144, 98, 50)]
    plank = max(8, w // 6)
    for x in range(w):
        colour = shades[(x // plank) % len(shades)]
        for y in range(h):
            seam = x % plank == plank - 1
            grain = rng.random() < 0.07
            px[x, y] = (70, 45, 22) if seam else ((120, 80, 40) if grain else colour)
    brace_top = int(h * 0.72)
    for x in range(w):
        for y in range(brace_top, min(h, brace_top + max(6, h // 14))):
            px[x, y] = (54, 76, 140) if (x // 3 + y // 3) % 7 else (38, 52, 100)
    cx, cy, r = w // 2, int(h * 0.3), int(w * 0.18)
    for x in range(w):
        for y in range(h):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d < r * 0.72:
                px[x, y] = (116, 92, 150)
            elif d < r:
                px[x, y] = (92, 110, 180) if int(d) % 3 else (60, 76, 140)
    return img


def paint_wallpaper(size: int = 64) -> Image.Image:
    """One repeat of the house's bamboo paper: sea-blue, with stalks of a lighter blue standing up it,
    each a stack of segments with a dark joint between, so it tiles both ways."""
    rng = np.random.default_rng(11)
    img = Image.new("RGB", (size, size), (74, 170, 220))
    px = img.load()
    for stalk in range(5):
        x0 = int(stalk * size / 5 + rng.integers(0, 4))
        width = int(rng.integers(5, 8))
        phase = int(rng.integers(0, 16))
        for y in range(size):
            joint = (y + phase) % 16 == 0
            for i in range(width):
                x = (x0 + i) % size
                edge = i == 0 or i == width - 1
                px[x, y] = (46, 130, 186) if joint or edge else ((118, 204, 240) if i == 1 else (96, 190, 234))
    return img


def emit_part(name: str, mesh: MeshBuilder, s: float, swatch_uv: dict[str, np.ndarray], paper: tuple | None = None) -> None:
    """One part's mesh at world scale as public/assets/models/pineapple-<name>.bin: vertex and
    triangle counts (Uint32), then positions in centimetres (Int16), texture coordinates (Uint16,
    4096 to the repeat, v down the image), triangles (Uint16) and unit normals (Int8), normals last
    so nothing needs padding. Vertices at one spot share a normal whatever their coordinates."""
    positions, uvs, indices = [], [], []
    index: dict[tuple, int] = {}
    for tri, surface in mesh.tris:
        for p, q in tri:
            if surface == "texture":
                uv = q
            elif surface == "planks":
                uv = np.array([PLANKS[0] + q[0] * (PLANKS[2] - PLANKS[0]), PLANKS[1] + q[1] * (PLANKS[3] - PLANKS[1])]) / TEXTURE_SIZE
            elif surface == "paper":
                rings, scale = paper
                # Round the house a whole number of repeats, so the paper meets itself at the back.
                around = round(2 * np.pi * np.mean([r for _, r in rings[: CEILING_RING + 1]]) * scale / WALLPAPER_TILE)
                uv = np.array([np.arctan2(p[0], p[2]) / (2 * np.pi) * around, -p[1] * scale / WALLPAPER_TILE])
            else:
                uv = swatch_uv[surface]
            key = (*np.round(p * s * 100).astype(int), *np.round(uv * 4096).astype(int))
            if key not in index:
                index[key] = len(positions)
                positions.append(p * s)
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
    uv -= np.floor(uv.min(axis=0))  # whole repeats off, so wrapped coordinates start near 0
    out = MODELS_OUT / f"pineapple-{name}.bin"
    out.write_bytes(
        np.array([len(pos), len(idx)], dtype="<u4").tobytes()
        + np.round(pos * 100).astype("<i2").tobytes()
        + np.round(np.clip(uv, 0, 15.999) * 4096).astype("<u2").tobytes()
        + idx.astype("<u2").tobytes()
        + np.round(normals * 127).astype("i1").tobytes()
    )
    print(f"wrote {out} ({len(pos)} vertices, {len(idx)} triangles, {out.stat().st_size} bytes)")


def emit_profile(
    rings: list[tuple[float, float]],
    s: float,
    doorway: tuple[float, float, float],
    panel: np.ndarray,
    hinge: np.ndarray,
    ceiling: float,
) -> None:
    x0, x1, top = doorway
    lines = [
        "// Generated by packages/client/scripts/house-model.py; don't edit. The pineapple house's shape for",
        "// the sim (content/pineapple.ts), in metres in the house's frame (the door facing +z): the shell's",
        "// rings from the ground up (height, radius), the doorway cut in its front and the door that hangs",
        "// in it (its hinge, on the ground at the panel's left edge, how far it reaches from there, how tall",
        "// and thick it is, and where its middle stands from the hinge when shut), how far above the ground",
        "// the flat ceiling is, and the wall's thickness.",
        "export const PINEAPPLE_PROFILE = {",
        f"  rings: [{', '.join(f'[{y * s:.2f}, {r * s:.2f}]' for y, r in rings)}],",
        f"  doorway: {{ width: {(x1 - x0) * s:.2f}, height: {top * s:.2f} }},",
        "  door: {",
        f"    hinge: [{hinge[0] * s:.2f}, {hinge[2] * s:.2f}],",
        f"    reach: {(panel[:, 0].max() - hinge[0]) * s:.2f},",
        f"    height: {panel[:, 1].max() * s:.2f},",
        f"    thickness: {(panel[:, 2].max() - panel[:, 2].min()) * s:.2f},",
        f"    middle: [{(panel[:, 0].mean() - hinge[0]) * s:.2f}, {(panel[:, 2].mean() - hinge[2]) * s:.2f}],",
        "  },",
        f"  ceiling: {ceiling * s:.2f},",
        f"  wall: {WALL},",
        "} as const;",
        "",
    ]
    PROFILE_OUT.write_text("\n".join(lines))
    print(f"wrote {PROFILE_OUT}: scale {s:.3f}, rings {[(round(y * s, 1), round(r * s, 1)) for y, r in rings]}")


if __name__ == "__main__":
    main(sys.argv[1])
