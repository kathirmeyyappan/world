"""Builds render/avatars/dragonModel.ts and the dragon's texture from roboguts's TotK Light Dragon
(Sketchfab, CC BY-NC 4.0), downloaded as a .glb:

    pip install numpy pillow pyfqmr fast_simplification
    python packages/client/scripts/dragon-model.py path/to/totk_light_dragon.glb

The model is rigid parts, posed in a long curve, with no rig. This finds the body's centreline (the
Body part is one shell: how far along it each vertex is, walking the mesh from the neck, says where
on the curve it sits), measures the whole thing so the spine the sim moves (sim/dragon.ts: a point
every SPINE_SPACING behind the eyes, SPINE_POINTS of them) runs from the eyes to just short of the
tail's tip, and puts a bone at the eyes and one at each spine point, each a frame on the curve with
its forward toward the head and its up toward the dorsal spines. Every vertex of the body follows
the two bones either side of its place on the curve; the head, eyes, lashes and horns follow the
head bone alone, so the head turns in one piece, except the lower jaw, which gets a bone of its own
at its hinge so the mouth can open. The head and the mane round it are a mesh of their
own, hidden for its rider's view from the eyes. Each part is decimated to its share of the budget with its open edges kept, the textures
are packed into one atlas, and it writes both meshes as monster-model.py does, with the bones' rest
frames and where the mouth is (the breath starts there), in the dragon's frame: metres, the eyes at
the origin, mirrored in x like the other models.
"""

from __future__ import annotations

import base64
import heapq
import sys
from pathlib import Path

import numpy as np
import pyfqmr
from PIL import Image
from glb import accessor, local_matrix, pack_atlas, read_glb

CLIENT = Path(__file__).resolve().parents[1]
TITLE, AUTHOR = "TotK Light Dragon", "roboguts"

# The sim's spine (packages/shared/src/sim/dragon.ts), which the bones sit on.
SPINE_POINTS = 20
SPINE_SPACING = 1.5
TAIL = 1.5  # metres of tail past the last bone, rigid with it
JAW_BONE = SPINE_POINTS + 1  # after the spine's bones
BONES = JAW_BONE + 1
# The lower jaw: the head's vertices under the lip line and ahead of the hinge. The model's mouth is
# shut, so the line is a guess at where the lips meet: from the hinge (metres forward of and up from
# the eyes, in the head bone's frame, below and behind the eye) straight to the snout's tip. A band
# JAW_BLEND wide along it and at the hinge is shared with the head.
JAW_HINGE = (-0.15, -0.42)
JAW_BLEND = 0.05

RIGID_PARTS = ("Head", "Eyes", "Eyeashes", "Horns")  # one piece with the head bone
HEAD_MESH = (*RIGID_PARTS, "Mane")  # round the head, so hidden with it; the mane's roots follow the neck
SKIP_PARTS = ("Master sword",)
# Triangles each part is cut down to, give or take; the face is kept whole.
BUDGET = {
    "Body": 3500,
    "Belly and Legs": 4500,
    "Mane": 4500,
    "Horns": 1000,
    "Eyes": 400,
    "Eyeashes": 400,
    "Spines": 700,
}
# Parts whose open edges may move as they're cut: strands of hair, all edge, which would otherwise
# barely shrink; a plate or the body keeps its outline.
FREE_EDGES = {"Mane"}
PIECE_WHOLE = 60  # triangles: a piece with no more is kept as it is
PIECE_FLOOR = 24  # the fewest a bigger piece is cut down to
TEXTURE_SIZE = 512
CURVE_STEP = 2.0  # model units of geodesic distance per centreline sample
SAMPLE = 0.25  # metres between the resampled curve's points


def main(glb: str) -> None:
    out = CLIENT / "src/render/avatars/dragonModel.ts"
    texture_out = CLIENT / "public/assets/textures/avatars/light-dragon.png"
    doc, blob = read_glb(Path(glb).read_bytes())
    nodes = doc["nodes"]
    parent = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}
    world: dict[int, np.ndarray] = {}

    def transform(i: int) -> np.ndarray:
        if i not in world:
            m = local_matrix(nodes[i])
            world[i] = transform(parent[i]) @ m if i in parent else m
        return world[i]

    # Every part, posed, named for the group node over it (Body_2 is "Body").
    parts = []
    for index, node in enumerate(nodes):
        if "mesh" not in node:
            continue
        group = nodes[parent[index]]["name"].rsplit("_", 1)[0]
        if group in SKIP_PARTS:
            continue
        m = transform(index)
        for prim in doc["meshes"][node["mesh"]]["primitives"]:
            attrs = prim["attributes"]
            p = accessor(doc, blob, attrs["POSITION"]).astype(np.float64)
            n = accessor(doc, blob, attrs["NORMAL"]).astype(np.float64)
            triangles = accessor(doc, blob, prim["indices"]).reshape(-1, 3).astype(np.int64)
            if np.linalg.det(m[:3, :3]) < 0:
                triangles = triangles[:, ::-1]
            parts.append(
                {
                    "group": group,
                    "positions": np.c_[p, np.ones(len(p))] @ m.T[:, :3],
                    "normals": n @ np.linalg.inv(m[:3, :3]),
                    "uvs": accessor(doc, blob, attrs["TEXCOORD_0"]).astype(np.float64),
                    "triangles": triangles,
                    "material": prim["material"],
                }
            )
    eyes = np.mean([p["positions"].mean(axis=0) for p in parts if p["group"] == "Eyes"], axis=0)
    body = next(p for p in parts if p["group"] == "Body")
    curve = smoothed(centreline(body, eyes))

    # The dragon's frame: metres, the eyes at the origin, x mirrored (see monster-model.py), the
    # spine and tail just covering the curve.
    scale = (SPINE_POINTS * SPINE_SPACING + TAIL) / np.linalg.norm(np.diff(curve, axis=0), axis=1).sum()

    def frame(p: np.ndarray) -> np.ndarray:
        p = np.atleast_2d(p)
        return np.stack([-(p[:, 0] - eyes[0]), p[:, 1] - eyes[1], p[:, 2] - eyes[2]], axis=1) * scale

    curve = resample(frame(curve), SAMPLE)
    for part in parts:
        part["positions"] = frame(part["positions"])
        part["normals"] = part["normals"] * [-1, 1, 1]
        part["normals"] /= np.linalg.norm(part["normals"], axis=1)[:, None]
    print(f"{len(curve) * SAMPLE:.1f} m from the eyes to the tail's tip, {scale:.4f} m per unit")

    # Where along the curve each vertex sits, and so which bones it follows.
    spines = next(p for p in parts if p["group"] == "Spines")
    frames = bone_frames(curve, spines["positions"])
    # The mouth: the lower jaw's tip, the farthest forward the head goes below the eyes.
    head = next(p for p in parts if p["group"] == "Head")
    forward = frames[0, 9:12]
    low = head["positions"][head["positions"][:, 1] < 0]
    mouth = low[np.argmax(low @ forward)]
    print("mouth", np.round(mouth, 2))
    for part in parts:
        if part["group"] in RIGID_PARTS:
            part["bones"] = np.zeros((len(part["positions"]), BONES))
            jaw = jaw_share(part["positions"], frames[0], mouth) if part["group"] == "Head" else 0
            part["bones"][:, 0] = 1 - jaw
            part["bones"][:, JAW_BONE] = jaw
            continue
        along = nearest(part["positions"], curve) * SAMPLE / SPINE_SPACING
        first = np.minimum(np.floor(along).astype(int), JAW_BONE - 1)
        second = np.minimum(first + 1, JAW_BONE - 1)
        w = np.where(second > first, along - first, 0)
        bones = np.zeros((len(along), BONES))
        np.put_along_axis(bones, first[:, None], (1 - w)[:, None], axis=1)
        np.add.at(bones, (np.arange(len(along)), second), w)
        part["bones"] = bones
    for i in (0, 1, 2, 5, 10, 15, 20, JAW_BONE):
        f = frames[i]
        print(f"bone {i:2d} at {np.round(f[:3], 2)} up {np.round(f[6:9], 2)} forward {np.round(f[9:12], 2)}")
    print("head spans", np.round(head["positions"].min(axis=0), 2), np.round(head["positions"].max(axis=0), 2))

    total = sum(len(p["triangles"]) for p in parts)
    for group, budget in BUDGET.items():
        own = [p for p in parts if p["group"] == group]
        count = sum(len(p["triangles"]) for p in own)
        for part in own:
            decimate(part, round(budget * len(part["triangles"]) / count), group not in FREE_EDGES)
        print(f"{group}: {count} triangles to {sum(len(p['triangles']) for p in own)}")
    print(f"decimated {total} triangles to {sum(len(p['triangles']) for p in parts)}")

    uv = np.vstack([p["uvs"] for p in parts])
    material = np.concatenate([np.full(len(p["uvs"]), p["material"]) for p in parts])
    atlas, uv = pack_atlas(doc, blob, uv, material, {}, TEXTURE_SIZE)
    base = 0
    for part in parts:
        part["uvs"] = uv[base : base + len(part["uvs"])]
        base += len(part["uvs"])

    def vec(v: np.ndarray) -> str:
        return "[" + ", ".join(f"{c + 0.0:.4f}".replace("-0.0000", "0.0000") for c in v) + "]"

    lines = [
        f"// Generated by packages/client/scripts/dragon-model.py from {AUTHOR}'s {TITLE} (Sketchfab,"
        " CC BY-NC 4.0); don't edit.",
        "// Two skinned meshes in the dragon's frame (metres, the eyes at the origin, x to its right): the head and",
        "// the body, each with vertices in millimetres (Int16 x, y, z), unit normals (Int8), texture coordinates",
        "// (Uint16 over 0 to 1, v down the image), triangles (Uint16) and, per vertex, the two bones it follows",
        "// (Uint8) and the first's share of it (Uint8 of 255); all base64. `frames` is each bone's rest pose in index",
        "// order (its position, then its right, up and forward unit vectors): bone 0 at the eyes, bone i on the",
        "// body's centreline i spine points back, and the last the lower jaw's, at its hinge, with the head's axes.",
        "// `mouth` is the lower jaw's tip, where the breath starts.",
        "export const DRAGON_MODEL = {",
        f"  mouth: {vec(mouth)},",
        "  frames: [",
        *(f"    {', '.join(f'{c + 0.0:.4f}' for c in f)}," for f in frames),
        "  ],",
        *mesh_lines("head", [p for p in parts if p["group"] in HEAD_MESH]),
        *mesh_lines("body", [p for p in parts if p["group"] not in HEAD_MESH]),
        "} as const;",
        "",
    ]
    out.write_text("\n".join(lines))
    print(f"wrote {out} ({out.stat().st_size} bytes)")
    texture_out.parent.mkdir(parents=True, exist_ok=True)
    atlas.quantize(256, dither=Image.Dither.FLOYDSTEINBERG).save(texture_out, optimize=True)
    print(f"wrote {texture_out} ({atlas.size[0]}x{atlas.size[1]}, {texture_out.stat().st_size} bytes)")


def mesh_lines(name: str, parts: list[dict]) -> list[str]:
    """One mesh's arrays from its parts, joined, as lines of the model file."""
    positions = np.vstack([p["positions"] for p in parts])
    normals = np.vstack([p["normals"] for p in parts])
    uvs = np.vstack([p["uvs"] for p in parts])
    bones = np.vstack([p["bones"] for p in parts])
    triangles, base = [], 0
    for p in parts:
        triangles.append(p["triangles"] + base)
        base += len(p["positions"])
    triangles = np.vstack(triangles)
    assert len(positions) < 65536, f"{name}: {len(positions)} vertices"
    order = np.argsort(-bones, axis=1)[:, :2]
    weights = np.take_along_axis(bones, order, axis=1)
    split = np.round(weights[:, 0] / weights.sum(axis=1) * 255).astype(np.int64)
    print(f"{name}: {len(triangles)} triangles, {len(positions)} vertices")

    def b64(a: np.ndarray) -> str:
        return base64.b64encode(a.tobytes()).decode()

    return [
        f"  {name}: {{",
        f"    positions: '{b64(np.round(positions * 1000).astype('<i2'))}',",
        f"    normals: '{b64(np.round(normals * 127).astype('i1'))}',",
        f"    uvs: '{b64(np.round(uvs * 65535).astype('<u2'))}',",
        f"    indices: '{b64(triangles.astype('<u2'))}',",
        f"    bones: '{b64(order.astype('u1'))}',",
        f"    split: '{b64(split.astype('u1'))}',",
        "  },",
    ]


def centreline(body: dict, eyes: np.ndarray) -> np.ndarray:
    """The body's centreline as points from the eyes to the tail's tip: along the mesh from the
    neck (its vertices nearest the eyes), every CURVE_STEP of distance walked, the middle of the
    vertices that far along."""
    points, welded = np.unique(np.round(body["positions"], 4), axis=0, return_inverse=True)
    corners = welded.ravel()[body["triangles"]]
    edges = np.concatenate([corners[:, [0, 1]], corners[:, [1, 2]], corners[:, [2, 0]]])
    lengths = np.linalg.norm(points[edges[:, 0]] - points[edges[:, 1]], axis=1)
    adjacent: list[list[tuple[int, float]]] = [[] for _ in range(len(points))]
    for (a, b), length in zip(edges, lengths):
        adjacent[a].append((b, length))
        adjacent[b].append((a, length))
    distance = np.full(len(points), np.inf)
    queue: list[tuple[float, int]] = []
    for seed in np.argsort(np.linalg.norm(points - eyes, axis=1))[:20]:
        distance[seed] = 0
        queue.append((0.0, int(seed)))
    while queue:
        d, a = heapq.heappop(queue)
        if d > distance[a]:
            continue
        for b, length in adjacent[a]:
            if d + length < distance[b]:
                distance[b] = d + length
                heapq.heappush(queue, (d + length, b))
    curve = [eyes]
    for start in np.arange(0, distance.max(), CURVE_STEP):
        along = (distance >= start) & (distance < start + CURVE_STEP)
        if along.sum() >= 4:
            curve.append(points[along].mean(axis=0))
    return np.array(curve)


def smoothed(curve: np.ndarray) -> np.ndarray:
    """The curve with its wobble taken out (the middle of a thick bend's vertices lies off the
    curve), its ends where they were."""
    for _ in range(3):
        curve = np.vstack([curve[:1], (curve[:-2] + 2 * curve[1:-1] + curve[2:]) / 4, curve[-1:]])
    return curve


def resample(curve: np.ndarray, step: float) -> np.ndarray:
    """The curve as points `step` apart along it, from its first point to its last."""
    along = np.r_[0, np.cumsum(np.linalg.norm(np.diff(curve, axis=0), axis=1))]
    at = np.arange(0, along[-1], step)
    return np.stack([np.interp(at, along, curve[:, k]) for k in range(3)], axis=1)


def nearest(points: np.ndarray, curve: np.ndarray) -> np.ndarray:
    """The index of the curve point nearest each point."""
    found = np.empty(len(points), dtype=int)
    for start in range(0, len(points), 2000):
        chunk = points[start : start + 2000]
        found[start : start + 2000] = np.argmin(np.linalg.norm(chunk[:, None, :] - curve[None, :, :], axis=2), axis=1)
    return found


def jaw_share(positions: np.ndarray, head: np.ndarray, mouth: np.ndarray) -> np.ndarray:
    """How much of each vertex the lower jaw's bone carries: all of it under the lip line and ahead
    of the hinge, none above or behind, fading across JAW_BLEND either side of both."""
    forward = (positions - head[:3]) @ head[9:12]
    up = (positions - head[:3]) @ head[6:9]
    tip_forward, tip_up = (mouth - head[:3]) @ head[9:12], (mouth - head[:3]) @ head[6:9]
    hinge_forward, hinge_up = JAW_HINGE
    lip = hinge_up + (forward - hinge_forward) * (tip_up - hinge_up) / (tip_forward - hinge_forward)
    under = np.clip((lip + JAW_BLEND / 2 - up) / JAW_BLEND, 0, 1)
    ahead = np.clip((forward - hinge_forward + JAW_BLEND / 2) / JAW_BLEND, 0, 1)
    return under * ahead


def bone_frames(curve: np.ndarray, spines: np.ndarray) -> np.ndarray:
    """Each bone's rest frame: on the curve SPINE_SPACING apart from the eyes, forward along it
    toward the head, up toward the dorsal spines there (carried on from the bone before where
    there are none), right across; then the jaw's, the head's turned about its hinge. Rows of
    position, right, up, forward."""
    per_bone = SPINE_SPACING / SAMPLE
    where = nearest(spines, curve) / per_bone
    frames = []
    up = np.array([0.0, 1.0, 0.0])
    for i in range(JAW_BONE):
        at = min(int(round(i * per_bone)), len(curve) - 1)
        back = min(at + 2, len(curve) - 1)
        front = max(at - 2, 0)
        forward = curve[front] - curve[back]
        forward /= np.linalg.norm(forward)
        near = spines[np.abs(where - i) < 1]
        if len(near) >= 5:
            up = (near - curve[at]).mean(axis=0)
        up = up - forward * (forward @ up)
        up /= np.linalg.norm(up)
        right = np.cross(up, forward)
        frames.append(np.concatenate([curve[at], right, up, forward]))
    head = frames[0]
    jaw = head.copy()
    jaw[:3] = head[:3] + head[9:12] * JAW_HINGE[0] + head[6:9] * JAW_HINGE[1]
    frames.append(jaw)
    return np.array(frames)


def decimate(part: dict, target: int, keep_edges: bool) -> None:
    """Cuts a part down to about `target` triangles, piece by piece: each run of mesh joined at the
    vertices (a belly plate, a strand of mane, the body) keeps its share of the part, never fewer
    than PIECE_FLOOR triangles so a small plate keeps its shape, and one of PIECE_WHOLE or fewer is
    kept as it is. The collapses are quadric ones over the piece with vertices at one spot facing one way taken
    as one (so a texture seam closes up with everything else, while a two-sided sheet stays two
    sheets) that keep its open edges where they are (`keep_edges`).
    Each new vertex then takes its texture coordinates, normal and bones from the original nearest
    it on the same island of the texture as the rest of its triangle, so a face never stretches
    across a seam."""
    positions, triangles = part["positions"], part["triangles"]
    # Vertices at one spot facing the same way are one: a seam's doubled vertices, but not the two
    # sides of a strand of mane or a fin, which would collapse into nothing.
    spots = np.c_[np.round(positions, 4), np.round(part["normals"], 1)]
    spots, welded = np.unique(spots, axis=0, return_inverse=True)
    points = spots[:, :3]
    welded = welded.ravel()
    piece = components(welded[triangles], len(points))[welded]  # by vertex, seams joined
    island = components(triangles, len(positions))  # by vertex, seams apart
    keep = target / len(triangles)
    pieces = {"positions": [], "normals": [], "uvs": [], "bones": [], "triangles": []}
    base = 0
    for label in np.unique(piece):
        own = np.flatnonzero(piece[triangles[:, 0]] == label)
        tris = triangles[own]
        vertices = np.unique(tris)
        local = {v: k for k, v in enumerate(vertices)}
        if len(tris) <= PIECE_WHOLE:
            stand_in = vertices
            new_triangles = np.vectorize(local.get)(tris)
            new_positions = positions[vertices]
        else:
            # The piece welded, cut down, and each corner given back a side of the texture.
            wp, wi = np.unique(welded[vertices], return_inverse=True)
            simplifier = pyfqmr.Simplify()
            simplifier.setMesh(points[wp], wi.ravel()[np.vectorize(local.get)(tris)])
            simplifier.simplify_mesh(
                target_count=max(PIECE_FLOOR, round(len(tris) * keep)),
                aggressiveness=7,
                preserve_border=keep_edges,
                verbose=0,
            )
            cut_points, cut_tris, _ = simplifier.getMesh()
            cut_tris = cut_tris.astype(np.int64)
            middle = nearest(cut_points[cut_tris].mean(axis=1), positions[vertices])
            side = island[vertices[middle]]  # each cut triangle's island: its middle's nearest original's
            corners = np.empty_like(cut_tris)
            for c in range(3):
                for s in np.unique(side):
                    rows = np.flatnonzero(side == s)
                    candidates = vertices[island[vertices] == s]
                    corners[rows, c] = candidates[nearest(cut_points[cut_tris[rows, c]], positions[candidates])]
            keys, new_triangles = np.unique(
                np.stack([cut_tris.ravel(), corners.ravel()], axis=1), axis=0, return_inverse=True
            )
            new_triangles = new_triangles.reshape(-1, 3)
            new_positions = cut_points[keys[:, 0]]
            stand_in = keys[:, 1]
        pieces["positions"].append(new_positions)
        for key in ("normals", "uvs", "bones"):
            pieces[key].append(part[key][stand_in])
        pieces["triangles"].append(new_triangles + base)
        base += len(new_positions)
    for key, chunks in pieces.items():
        part[key] = np.vstack(chunks)


def components(triangles: np.ndarray, count: int) -> np.ndarray:
    """A label per vertex (of `count`): which connected run of the triangles it is in."""
    parent = np.arange(count)

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for a, b in np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]]]):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    return np.array([find(a) for a in range(count)])


if __name__ == "__main__":
    main(sys.argv[1])
