"""What the model scripts share: reading a .glb, decimating a part, packing an atlas."""

from __future__ import annotations

import io
import json
import math
import struct

import fast_simplification
import numpy as np
from PIL import Image

SEAM = 0.1  # texture coordinates further apart than this are on different sides of a seam
SMALL_PART = 100  # triangles: a part with no more is kept whole when the model is decimated
SWATCH = 8  # px: the square a plain colour gets in the atlas
GUTTER = 8  # px between the atlas's regions
PAD = 16  # px of each region's own edge repeated round it: what the coarser mipmaps blend into its rim
MAX_ATLAS_WIDTH = 2048  # px: an atlas wider than this wraps onto another row


def closed(part: dict) -> bool:
    """Whether a part is a closed shell: every edge, with vertices at one spot taken as one, is
    shared by two triangles."""
    _, welded = np.unique(np.round(part["positions"], 5), axis=0, return_inverse=True)
    corners = welded.ravel()[part["triangles"]]
    edges = np.sort(np.concatenate([corners[:, [0, 1]], corners[:, [1, 2]], corners[:, [2, 0]]]), axis=1)
    _, counts = np.unique(edges, axis=0, return_counts=True)
    return bool(np.all(counts == 2))


def components(part: dict) -> list[np.ndarray]:
    """The separate pieces of a part, as the vertex indices of each: a triangle's corners are joined,
    as are vertices at one spot."""
    _, welded = np.unique(np.round(part["positions"], 5), axis=0, return_inverse=True)
    welded = welded.ravel()
    parent = list(range(welded.max() + 1))

    def root(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for a, b, c in welded[part["triangles"]].tolist():
        parent[root(b)] = root(a)
        parent[root(c)] = root(a)
    roots = np.array([root(a) for a in welded.tolist()])
    return [np.flatnonzero(roots == r) for r in np.unique(roots)]


def decimate(part: dict, keep: float) -> None:
    """Collapses a part's edges (quadric error, so the shape holds) until about `keep` of its
    triangles are left. Vertices at one spot are welded for the collapsing, so a texture seam (whose
    vertices come doubled, one per side) closes up with everything else; each corner of a surviving
    triangle then stands where its vertex ended up but keeps the texture coordinates and normal of
    the original closest to that spot on its own side of any seam, and the weights of them all."""
    welded_points, welded = np.unique(np.round(part["positions"], 5), axis=0, return_inverse=True)
    welded = welded.ravel()
    points = welded_points.astype(np.float32)
    faces = welded[part["triangles"]].astype(np.int64)
    _, _, collapses = fast_simplification.simplify(points, faces, target_reduction=1 - keep, return_collapses=True)
    kept_points, _, mapping = fast_simplification.replay_simplification(points, faces, collapses)
    ended = mapping[welded]  # each original vertex's new one
    corners = ended[part["triangles"]]
    alive = (corners[:, 0] != corners[:, 1]) & (corners[:, 1] != corners[:, 2]) & (corners[:, 0] != corners[:, 2])
    originals = part["triangles"][alive]
    corners = corners[alive]

    # The originals that ended up in each new vertex, to pick a corner's stand-in from.
    by_new = np.argsort(ended, kind="stable")
    starts = np.searchsorted(ended[by_new], np.arange(len(kept_points) + 1))
    uvs = part["uvs"]
    stand_in = np.empty_like(originals)
    for f in range(len(originals)):
        for c in range(3):
            original, new = originals[f, c], corners[f, c]
            candidates = by_new[starts[new] : starts[new + 1]]
            same_side = candidates[np.linalg.norm(uvs[candidates] - uvs[original], axis=1) < SEAM]
            distance = np.linalg.norm(part["positions"][same_side] - kept_points[new], axis=1)
            stand_in[f, c] = same_side[np.argmin(distance)]
    keys, triangles = np.unique(np.stack([corners.ravel(), stand_in.ravel()], axis=1), axis=0, return_inverse=True)
    part["triangles"] = triangles.reshape(-1, 3)
    part["positions"] = kept_points[keys[:, 0]].astype(np.float64)
    for key in ("normals", "uvs"):
        part[key] = part[key][keys[:, 1]]
    # One set of weights per spot, whichever side of a seam a vertex is on, or the seam opens up
    # as soon as a bone turns.
    weights = np.zeros((len(kept_points), part["bones"].shape[1]))
    np.add.at(weights, keys[:, 0], part["bones"][keys[:, 1]])
    part["bones"] = (weights / np.bincount(keys[:, 0], minlength=len(kept_points))[:, None])[keys[:, 0]]


def pack_atlas(
    doc: dict,
    blob: bytes,
    uv: np.ndarray,
    material: np.ndarray,
    colours: dict[str, tuple[int, int, int]],
    texture_size: int,
) -> tuple[Image.Image, np.ndarray]:
    """One image for every material any vertex uses: each texture, no bigger than `texture_size`
    on its long side, tiled over the whole-number range its coordinates span (so repeats bake in and
    nothing wraps; a span that fits one tile but straddles a whole number gets the image rolled round
    to it instead), each plain colour a swatch (`colours` for materials with none in the file); laid
    out in rows no wider than MAX_ATLAS_WIDTH, with the coordinates moved into their region. A model
    with one texture and no repeats gets it back as it is."""
    regions: list[
        tuple[Image.Image, np.ndarray, float, float, float, float]
    ] = []  # image, vertices, u0, v0, u span, v span
    textures = doc.get("textures", [])
    by_texture: dict[int, list[int]] = {}
    for m, mat in enumerate(doc["materials"]):
        texture = mat.get("pbrMetallicRoughness", {}).get("baseColorTexture", {}).get("index")
        if texture is None:
            vertices = np.flatnonzero(material == m)
            if len(vertices) == 0:
                continue
            colour = colours.get(mat["name"])
            if colour is None:
                factor = mat.get("pbrMetallicRoughness", {}).get("baseColorFactor", [1, 1, 1, 1])
                colour = tuple(round(c ** (1 / 2.2) * 255) for c in factor[:3])
                print(f"material {mat['name']} has no texture; using {colour}")
            regions.append((Image.new("RGB", (SWATCH, SWATCH), colour), vertices, 0.5, 0.5, 0, 0))
        else:
            by_texture.setdefault(texture, []).append(m)
    for texture, mats in by_texture.items():
        vertices = np.flatnonzero(np.isin(material, mats))
        if len(vertices) == 0:
            continue
        view = doc["bufferViews"][doc["images"][textures[texture]["source"]]["bufferView"]]
        image = Image.open(io.BytesIO(blob[view["byteOffset"] : view["byteOffset"] + view["byteLength"]])).convert(
            "RGB"
        )
        extrema = image.getextrema()
        if all(low == high for low, high in extrema):
            # One colour all over: a swatch is the same thing in 64 pixels.
            colour = tuple(low for low, _ in extrema)
            regions.append((Image.new("RGB", (SWATCH, SWATCH), colour), vertices, 0.5, 0.5, 0, 0))
            continue
        if max(image.size) > texture_size:
            shrink = texture_size / max(image.size)
            image = image.resize((round(image.width * shrink), round(image.height * shrink)), Image.LANCZOS)
        low, high = uv[vertices].min(axis=0), uv[vertices].max(axis=0)
        if all(high - low <= 1 + 1e-3):
            # The texture repeats, so rolling it round by the fraction the span starts at puts the
            # whole span on one copy.
            pixels = np.roll(
                np.asarray(image), (-round((low[1] % 1) * image.height), -round((low[0] % 1) * image.width)), (0, 1)
            )
            regions.append((Image.fromarray(pixels), vertices, float(low[0]), float(low[1]), 1, 1))
            continue
        u0, v0 = (math.floor(c) for c in low)
        u1, v1 = (math.ceil(c) for c in high)
        u1, v1 = max(u1, u0 + 1), max(v1, v0 + 1)
        tiled = Image.new("RGB", (image.width * (u1 - u0), image.height * (v1 - v0)))
        for i in range(u1 - u0):
            for j in range(v1 - v0):
                tiled.paste(image, (i * image.width, j * image.height))
        regions.append((tiled, vertices, u0, v0, u1 - u0, v1 - v0))
    if len(regions) == 1 and regions[0][4] == 1 and regions[0][5] == 1:
        image, _, u0, v0, _, _ = regions[0]
        return image, uv - [u0, v0]

    # Shelves: regions go along a row until the next wouldn't fit, then start another under it.
    # Each sits in a border of its own edge pixels, so the coarser mipmaps (which average across
    # neighbours) don't blend another region's colours into its rim.
    spots: list[tuple[int, int]] = []
    x = y = row_height = 0
    for image, *_ in regions:
        if x and x + image.width + 2 * PAD > MAX_ATLAS_WIDTH:
            x, y, row_height = 0, y + row_height + GUTTER, 0
        spots.append((x, y))
        x += image.width + 2 * PAD + GUTTER
        row_height = max(row_height, image.height + 2 * PAD)
    width = max(x + image.width + 2 * PAD for (x, _), (image, *_) in zip(spots, regions))
    height = y + row_height
    atlas = Image.new("RGB", (width, height), (128, 128, 128))
    placed = uv.copy()
    for (x, y), (image, vertices, u0, v0, du, dv) in zip(spots, regions):
        atlas.paste(Image.fromarray(np.pad(np.asarray(image), ((PAD, PAD), (PAD, PAD), (0, 0)), mode="edge")), (x, y))
        if du:
            placed[vertices] = ((uv[vertices] - [u0, v0]) / [du, dv] * image.size + [x + PAD, y + PAD]) / atlas.size
        else:
            placed[vertices] = np.array([x + PAD + SWATCH / 2, y + PAD + SWATCH / 2]) / atlas.size
    print(f"atlas {width}x{height} from {len(regions)} regions")
    return atlas, placed


def read_glb(data: bytes) -> tuple[dict, bytes]:
    """The JSON document and the binary buffer of a .glb."""
    chunks = []
    offset = 12
    while offset < len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        chunks.append((kind, data[offset : offset + length]))
        offset += length
    return json.loads(chunks[0][1]), chunks[1][1]


def accessor(doc: dict, blob: bytes, index: int) -> np.ndarray:
    """An accessor's data as an array of its count by its component count."""
    acc = doc["accessors"][index]
    view = doc["bufferViews"][acc["bufferView"]]
    dtype = {5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4"}[acc["componentType"]]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[acc["type"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride", width * np.dtype(dtype).itemsize)
    rows = np.frombuffer(blob, np.uint8, stride * (acc["count"] - 1) + width * np.dtype(dtype).itemsize, start)
    strided = np.lib.stride_tricks.as_strided(rows, (acc["count"], width * np.dtype(dtype).itemsize), (stride, 1))
    return np.frombuffer(np.ascontiguousarray(strided).tobytes(), dtype).reshape(acc["count"], width)


def local_matrix(node: dict) -> np.ndarray:
    """A node's transform relative to its parent, as a column-vector matrix."""
    if "matrix" in node:
        return np.array(node["matrix"]).reshape(4, 4).T
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    m = np.eye(4)
    m[:3, :3] = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    m[:3, :3] *= node.get("scale", [1, 1, 1])
    m[:3, 3] = node.get("translation", [0, 0, 0])
    return m


def name_of(node_name: str) -> str:
    """A rig joint's name without the exporter's numeric suffix: Bip001_L_Thigh_02 is Bip001_L_Thigh."""
    stem, _, suffix = node_name.rpartition("_")
    return stem if suffix.isdigit() else node_name
