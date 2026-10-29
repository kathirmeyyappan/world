"""Builds render/avatars/<name>Model.ts and the avatar's texture from a rigged character on Sketchfab
(all CC BY 4.0), downloaded as a .glb:

    pip install numpy pillow
    python packages/client/scripts/monster-model.py sulley path/to/sulley_monsters_inc.glb
    python packages/client/scripts/monster-model.py mike path/to/mike_wazowski_monsters_inc.glb
    python packages/client/scripts/monster-model.py spongebob path/to/spongebob_squarepants.glb

Each is a skinned mesh (or a few) on a rig of a hundred-odd joints, with no animation. This poses it
in its bind pose, folds the rig down to the bones the avatar moves on their own (MONSTERS), giving
every vertex the weights it had on each bone's subtree, so the client can skin it on the GPU and the
joints bend instead of tearing, and turns it into the avatar's frame (y up, facing +z, x to its right,
feet at 0, `height` tall). Everything the model draws goes into one mesh with one texture: the meshes
are joined, and their textures (tiled as far as their texture coordinates repeat them) and plain
colours are packed into one atlas, with the coordinates moved to match. It writes the vertices in
millimetres, the normals, texture coordinates, triangles and weights, base64-encoded, with each bone's
pivot (its joint in the bind pose), the right palm (where a held item goes) and a point on the back
(where the tank sits); and the atlas as a palette PNG, which looks the same at well under half the
size.
"""

from __future__ import annotations

import base64
import io
import json
import math
import struct
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

CLIENT = Path(__file__).resolve().parents[1]

# A rig joint: its name (without the exporter's numeric suffix, see name_of) or, where the names
# didn't survive export, its index in the skin's joint list.
Joint = str | int


@dataclass(frozen=True)
class Monster:
    title: str  # the model's name on Sketchfab
    author: str
    height: float  # metres, feet to the top of the head
    # The avatar's bones and the rig joint each takes the subtree of. The first is the root: its
    # joint is only its pivot, and it takes every joint no other bone does. The order is the bone
    # index the vertices refer to; the avatar parents them.
    bones: tuple[tuple[str, Joint], ...]
    torso: tuple[str, ...]  # the bones whose vertices are the trunk, for finding the back
    palm: tuple[Joint, ...]  # the right hand and finger roots: a held item goes at their middle
    # Colours for materials that have none in the file, by material name (sRGB 0 to 255).
    colours: dict[str, tuple[int, int, int]] = field(default_factory=dict)


BIPED_PALM = ("Bip001_R_Hand", "Bip001_R_Finger0", "Bip001_R_Finger1", "Bip001_R_Finger2")

MONSTERS = {
    "sulley": Monster(
        "Sulley",
        "Guilherme Navarro",
        2.6,
        (
            ("hips", "Bip001_Spine"),  # the Biped's pelvis-level spine root
            ("chest", "Bip001_Spine1"),
            ("head", "Bip001_Neck"),
            ("armL", "Bip001_L_UpperArm"),
            ("armR", "Bip001_R_UpperArm"),
            ("legL", "Bip001_L_Thigh"),
            ("legR", "Bip001_R_Thigh"),
            ("tail", "Bip001_Tail"),
        ),
        ("hips", "chest"),
        BIPED_PALM,
    ),
    "mike": Monster(
        "Mike Wazowski",
        "Guilherme Navarro",
        1.4,
        (
            ("body", "Bip001_Spine"),
            ("armL", "Bip001_L_UpperArm"),
            ("armR", "Bip001_R_UpperArm"),
            ("legL", "Bip001_L_Thigh"),
            ("legR", "Bip001_R_Thigh"),
        ),
        ("body",),
        BIPED_PALM,
    ),
    # The joint names are mostly mangled in this file, so the rig is read by index: 65 is the pelvis
    # the legs hang from, 32 and 48 the upper arms where they leave the body, 68 and 75 the thighs,
    # 50 the right hand with 51, 54 and 57 its fingers.
    "spongebob": Monster(
        "Spongebob SquarePants",
        "Jamessmartguy",
        1.9,
        (("body", 65), ("armL", 32), ("armR", 48), ("legL", 68), ("legR", 75)),
        ("body",),
        (50, 51, 54, 57),
        {"Tongue": (214, 96, 118)},
    ),
}

SWATCH = 8  # px: the square a plain colour gets in the atlas
GUTTER = 8  # px between the atlas's regions, so their mipmaps bleed into nothing that's used


def main(name: str, glb: str) -> None:
    monster = MONSTERS[name]
    out = CLIENT / f"src/render/avatars/{name}Model.ts"
    texture_out = CLIENT / f"public/assets/textures/avatars/{name}.png"
    doc, blob = read_glb(Path(glb).read_bytes())

    # The rig in the bind pose: each joint's transform in the scene, and the skinning matrix that
    # takes a vertex from the mesh's space to the scene through it.
    nodes = doc["nodes"]
    parent = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}
    world: dict[int, np.ndarray] = {}

    def transform(i: int) -> np.ndarray:
        if i not in world:
            m = local_matrix(nodes[i])
            world[i] = transform(parent[i]) @ m if i in parent else m
        return world[i]

    skin = doc["skins"][0]
    joints = skin["joints"]
    inverse_bind = accessor(doc, blob, skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
    skinning = np.array([transform(j) @ inverse_bind[k] for k, j in enumerate(joints)])
    names = [name_of(nodes[j]["name"]) for j in joints]
    joint_index = {j: k for k, j in enumerate(joints)}
    joint_parent = [joint_index.get(parent.get(j), -1) for j in joints]

    def joint(ref: Joint) -> int:
        if isinstance(ref, int):
            return ref
        assert names.count(ref) == 1, f"{ref}: {names.count(ref)} joints of that name"
        return names.index(ref)

    # Fold the rig onto the avatar's bones: a joint belongs to the first bone whose subtree holds it,
    # else to the root bone.
    takes = {joint(ref): i for i, (_, ref) in enumerate(monster.bones[1:], start=1)}

    def bone_of(k: int) -> int:
        while k >= 0:
            if k in takes:
                return takes[k]
            k = joint_parent[k]
        return 0

    joint_bone = np.array([bone_of(k) for k in range(len(joints))])

    # Every primitive of every skinned mesh, posed, with its weights folded onto the avatar's bones.
    parts = []
    for node in nodes:
        if "mesh" not in node:
            continue
        for prim in doc["meshes"][node["mesh"]]["primitives"]:
            attrs = prim["attributes"]
            p = accessor(doc, blob, attrs["POSITION"]).astype(np.float64)
            n = accessor(doc, blob, attrs["NORMAL"]).astype(np.float64)
            j = accessor(doc, blob, attrs["JOINTS_0"]).astype(np.int64)
            w = accessor(doc, blob, attrs["WEIGHTS_0"]).astype(np.float64)
            homogeneous = np.c_[p, np.ones(len(p))]
            posed = np.zeros_like(p)
            posed_normals = np.zeros_like(n)
            folded = np.zeros((len(p), len(monster.bones)))
            for k in range(4):
                m = skinning[j[:, k]]
                posed += w[:, k, None] * np.einsum("nij,nj->ni", m[:, :3, :], homogeneous)
                posed_normals += w[:, k, None] * np.einsum(
                    "nij,nj->ni", np.linalg.inv(m[:, :3, :3]).transpose(0, 2, 1), n
                )
                np.add.at(folded, (np.arange(len(p)), joint_bone[j[:, k]]), w[:, k])
            parts.append(
                {
                    "positions": posed,
                    "normals": posed_normals,
                    "uvs": accessor(doc, blob, attrs["TEXCOORD_0"]).astype(np.float64),
                    "bones": folded,
                    "triangles": accessor(doc, blob, prim["indices"]).reshape(-1, 3).astype(np.int64),
                    "material": prim["material"],
                }
            )
    # Joined into one mesh, each vertex noting its material.
    posed = np.vstack([part["positions"] for part in parts])
    posed_normals = np.vstack([part["normals"] for part in parts])
    uv = np.vstack([part["uvs"] for part in parts])
    folded = np.vstack([part["bones"] for part in parts])
    material = np.concatenate([np.full(len(part["positions"]), part["material"]) for part in parts])
    triangles, base = [], 0
    for part in parts:
        triangles.append(part["triangles"] + base)
        base += len(part["positions"])
    triangles = np.vstack(triangles)

    # The rig's left is +x; the avatar's right is +x (it faces +z, as the rig does). Mirroring x also
    # swaps right- for left-handed axes, so the triangles' winding already faces out in Babylon's
    # left-handed frame.
    root = joint(monster.bones[0][1])
    hip = transform(joints[root])[:3, 3]
    feet = posed[:, 1].min()
    scale = monster.height / (posed[:, 1].max() - feet)

    def avatar(p: np.ndarray) -> np.ndarray:
        p = np.atleast_2d(p)
        return np.stack([-(p[:, 0] - hip[0]), p[:, 1] - feet, p[:, 2] - hip[2]], axis=1) * scale

    posed = avatar(posed)
    posed_normals *= [-1, 1, 1]
    posed_normals /= np.linalg.norm(posed_normals, axis=1)[:, None]

    # Each vertex's four heaviest bones, their weights summing to 255.
    order = np.argsort(-folded, axis=1)[:, :4]
    bone_weights = np.take_along_axis(folded, order, axis=1)
    bone_weights /= bone_weights.sum(axis=1, keepdims=True)
    quantised = np.round(bone_weights * 255).astype(np.int64)
    quantised[:, 0] += 255 - quantised.sum(axis=1)  # the rounding error goes on the biggest weight
    print("bones per vertex:", np.bincount((bone_weights > 0.002).sum(axis=1))[1:])

    bone_names = [bone for bone, _ in monster.bones]
    pivots = {bone: avatar(transform(joints[joint(ref)])[:3, 3])[0] for bone, ref in monster.bones}
    palm = avatar(np.mean([transform(joints[joint(ref)])[:3, 3] for ref in monster.palm], axis=0))[0]
    # The tank hangs on the back a little below the shoulders: as far back as the trunk goes there.
    shoulder_y = (pivots["armL"][1] + pivots["armR"][1]) / 2 - 0.2
    trunk = np.isin(order[:, 0], [bone_names.index(b) for b in monster.torso])
    back_z = posed[trunk & (abs(posed[:, 1] - shoulder_y) < 0.3)][:, 2].min() - 0.05
    back = np.array([0, shoulder_y, back_z])
    # Fallen on its back, the body lies this far up: how far the back is behind the root bone's pivot.
    lie = -posed[order[:, 0] == 0][:, 2].min()

    atlas, uv = pack_atlas(doc, blob, monster, uv, material)

    def b64(a: np.ndarray) -> str:
        return base64.b64encode(a.tobytes()).decode()

    def vec(v: np.ndarray) -> str:
        return "[" + ", ".join(f"{c + 0.0:.4f}".replace("-0.0000", "0.0000") for c in v) + "]"

    lines = [
        f"// Generated by packages/client/scripts/monster-model.py from {monster.author}'s {monster.title}"
        " (Sketchfab, CC BY 4.0); don't edit.",
        "// One skinned mesh in the avatar's frame (metres: feet at 0, facing +z, x to its right): vertices in",
        "// millimetres (Int16 x, y, z), unit normals (Int8), texture coordinates (Uint16 over 0 to 1, v down the",
        "// image), triangles (Uint16) and, per vertex, the four bones it follows (Uint8 indices into `bones`) and",
        "// how much (Uint8, summing to 255); all base64. `bones` is each bone's pivot in metres, in index order.",
        "// `hand` is the right palm, `back` where the tank hangs, `lie` how high the hips lie when it is on its back.",
        f"export const {name.upper()}_MODEL = {{",
        f"  height: {monster.height},",
        f"  hand: {vec(palm)},",
        f"  back: {vec(back)},",
        f"  lie: {lie:.4f},",
        "  bones: {",
        *(f"    {bone}: {vec(pivots[bone])}," for bone in bone_names),
        "  },",
        f"  positions: '{b64(np.round(posed * 1000).astype('<i2'))}',",
        f"  normals: '{b64(np.round(posed_normals * 127).astype('i1'))}',",
        f"  uvs: '{b64(np.round(uv * 65535).astype('<u2'))}',",
        f"  indices: '{b64(triangles.astype('<u2'))}',",
        f"  boneIndices: '{b64(order.astype('u1'))}',",
        f"  boneWeights: '{b64(quantised.astype('u1'))}',",
        "} as const;",
        "",
    ]
    out.write_text("\n".join(lines))
    print(f"{len(triangles)} triangles, {len(posed)} vertices; wrote {out} ({out.stat().st_size} bytes)")

    texture_out.parent.mkdir(parents=True, exist_ok=True)
    atlas.quantize(256, dither=Image.Dither.FLOYDSTEINBERG).save(texture_out, optimize=True)
    print(f"wrote {texture_out} ({atlas.size[0]}x{atlas.size[1]}, {texture_out.stat().st_size} bytes)")


def pack_atlas(
    doc: dict, blob: bytes, monster: Monster, uv: np.ndarray, material: np.ndarray
) -> tuple[Image.Image, np.ndarray]:
    """One image for every material: each texture tiled over the whole-number range its coordinates
    span (so repeats bake in and nothing wraps), each plain colour a swatch; laid out in a row, with
    the coordinates moved into their region. A model with one texture and no repeats gets it back as
    it is."""
    regions: list[
        tuple[Image.Image, np.ndarray, float, float, float, float]
    ] = []  # image, vertices, u0, v0, u span, v span
    textures = doc.get("textures", [])
    by_texture: dict[int, list[int]] = {}
    for m, mat in enumerate(doc["materials"]):
        texture = mat.get("pbrMetallicRoughness", {}).get("baseColorTexture", {}).get("index")
        if texture is None:
            colour = monster.colours.get(mat["name"])
            if colour is None:
                factor = mat.get("pbrMetallicRoughness", {}).get("baseColorFactor", [1, 1, 1, 1])
                colour = tuple(round(c ** (1 / 2.2) * 255) for c in factor[:3])
                print(f"material {mat['name']} has no texture; using {colour}")
            vertices = np.flatnonzero(material == m)
            if len(vertices):
                regions.append((Image.new("RGB", (SWATCH, SWATCH), colour), vertices, 0.5, 0.5, 0, 0))
        else:
            by_texture.setdefault(texture, []).append(m)
    for texture, mats in by_texture.items():
        vertices = np.flatnonzero(np.isin(material, mats))
        view = doc["bufferViews"][doc["images"][textures[texture]["source"]]["bufferView"]]
        image = Image.open(io.BytesIO(blob[view["byteOffset"] : view["byteOffset"] + view["byteLength"]])).convert(
            "RGB"
        )
        u0, v0 = (math.floor(c) for c in uv[vertices].min(axis=0))
        u1, v1 = (math.ceil(c) for c in uv[vertices].max(axis=0))
        u1, v1 = max(u1, u0 + 1), max(v1, v0 + 1)
        tiled = Image.new("RGB", (image.width * (u1 - u0), image.height * (v1 - v0)))
        for i in range(u1 - u0):
            for j in range(v1 - v0):
                tiled.paste(image, (i * image.width, j * image.height))
        regions.append((tiled, vertices, u0, v0, u1 - u0, v1 - v0))
    if len(regions) == 1 and regions[0][4] == 1 and regions[0][5] == 1:
        image, _, u0, v0, _, _ = regions[0]
        return image, uv - [u0, v0]

    width = sum(r[0].width for r in regions) + GUTTER * (len(regions) - 1)
    height = max(r[0].height for r in regions)
    atlas = Image.new("RGB", (width, height), (128, 128, 128))
    placed = uv.copy()
    x = 0
    for image, vertices, u0, v0, du, dv in regions:
        atlas.paste(image, (x, 0))
        if du:
            placed[vertices] = ((uv[vertices] - [u0, v0]) / [du, dv] * image.size + [x, 0]) / atlas.size
        else:
            placed[vertices] = np.array([x + SWATCH / 2, SWATCH / 2]) / atlas.size
        x += image.width + GUTTER
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


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
