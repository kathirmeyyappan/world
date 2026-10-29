"""Builds render/avatars/<name>Model.ts and the avatar's texture from one of Guilherme Navarro's
Monsters, Inc. models on Sketchfab (CC BY 4.0), downloaded as a .glb:

    pip install numpy pillow
    python packages/client/scripts/monster-model.py sulley path/to/sulley_monsters_inc.glb
    python packages/client/scripts/monster-model.py mike path/to/mike_wazowski_monsters_inc.glb

Each is one skinned mesh on a full Biped rig (a hundred-odd joints, no animation). This poses it in
its bind pose, turns it into the avatar's frame (y up, facing +z, x to its right, feet at 0, HEIGHT
tall) and folds the rig down to the bones the avatar moves on their own (MONSTERS), giving every
vertex the weights it had on each bone's subtree, so the client can skin it on the GPU and the joints
bend instead of tearing. It writes the vertices in millimetres, the normals, texture coordinates,
triangles and weights, base64-encoded, with each bone's pivot (its joint in the bind pose), the right
palm (where a held item goes) and a point on the back (where the tank sits); and the 512 px texture as
a palette PNG, which looks the same at well under half the size.
"""

from __future__ import annotations

import base64
import io
import json
import struct
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

CLIENT = Path(__file__).resolve().parents[1]
PELVIS = "Bip001_Spine"  # the Biped's pelvis-level spine root
PALM = ["Bip001_R_Hand", "Bip001_R_Finger0", "Bip001_R_Finger1", "Bip001_R_Finger2"]


@dataclass(frozen=True)
class Monster:
    title: str  # the model's name on Sketchfab
    height: float  # metres, feet to the top of the head
    # The avatar's bones and the rig joint whose subtree each takes over (None: whatever is left,
    # the pelvis). The order is the bone index the vertices refer to; the avatar parents them.
    bones: tuple[tuple[str, str | None], ...]
    torso: tuple[str, ...]  # the bones whose vertices are the trunk, for finding the back


MONSTERS = {
    "sulley": Monster(
        "Sulley",
        2.6,
        (
            ("hips", None),
            ("chest", "Bip001_Spine1"),
            ("head", "Bip001_Neck"),
            ("armL", "Bip001_L_UpperArm"),
            ("armR", "Bip001_R_UpperArm"),
            ("legL", "Bip001_L_Thigh"),
            ("legR", "Bip001_R_Thigh"),
            ("tail", "Bip001_Tail"),
        ),
        ("hips", "chest"),
    ),
    "mike": Monster(
        "Mike Wazowski",
        1.4,
        (
            ("ball", None),
            ("armL", "Bip001_L_UpperArm"),
            ("armR", "Bip001_R_UpperArm"),
            ("legL", "Bip001_L_Thigh"),
            ("legR", "Bip001_R_Thigh"),
        ),
        ("ball",),
    ),
}


def main(name: str, glb: str) -> None:
    monster = MONSTERS[name]
    out = CLIENT / f"src/render/avatars/{name}Model.ts"
    texture_out = CLIENT / f"public/assets/textures/avatars/{name}.png"

    doc, blob = read_glb(Path(glb).read_bytes())
    prim = doc["meshes"][0]["primitives"][0]
    attrs = prim["attributes"]
    positions = accessor(doc, blob, attrs["POSITION"]).astype(np.float64)
    normals = accessor(doc, blob, attrs["NORMAL"]).astype(np.float64)
    uvs = accessor(doc, blob, attrs["TEXCOORD_0"]).astype(np.float64)
    joints = accessor(doc, blob, attrs["JOINTS_0"]).astype(np.int64)
    weights = accessor(doc, blob, attrs["WEIGHTS_0"]).astype(np.float64)
    triangles = accessor(doc, blob, prim["indices"]).reshape(-1, 3).astype(np.int64)

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
    inverse_bind = accessor(doc, blob, skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
    skinning = np.array([transform(j) @ inverse_bind[k] for k, j in enumerate(skin["joints"])])
    names = [name_of(nodes[j]["name"]) for j in skin["joints"]]
    assert len(set(names)) == len(names), "joint names clash once their suffixes are stripped"
    joint_at = {name: transform(j)[:3, 3] for name, j in zip(names, skin["joints"])}

    homogeneous = np.c_[positions, np.ones(len(positions))]
    posed = np.zeros((len(positions), 3))
    posed_normals = np.zeros((len(positions), 3))
    for k in range(4):
        m = skinning[joints[:, k]]
        posed += weights[:, k, None] * np.einsum("nij,nj->ni", m[:, :3, :], homogeneous)
        posed_normals += weights[:, k, None] * np.einsum(
            "nij,nj->ni", np.linalg.inv(m[:, :3, :3]).transpose(0, 2, 1), normals
        )

    # The rig's left is +x; the avatar's right is +x (it faces +z, as the rig does). Mirroring x also
    # swaps right- for left-handed axes, so the triangles' winding already faces out in Babylon's
    # left-handed frame.
    hip = joint_at[PELVIS]
    feet = posed[:, 1].min()
    scale = monster.height / (posed[:, 1].max() - feet)

    def avatar(p: np.ndarray) -> np.ndarray:
        p = np.atleast_2d(p)
        return np.stack([-(p[:, 0] - hip[0]), p[:, 1] - feet, p[:, 2] - hip[2]], axis=1) * scale

    posed = avatar(posed)
    posed_normals *= [-1, 1, 1]
    posed_normals /= np.linalg.norm(posed_normals, axis=1)[:, None]

    # Fold the rig onto the avatar's bones: a joint belongs to the first bone whose subtree holds it.
    joint_parent = {
        name: name_of(nodes[parent[j]]["name"]) if j in parent else None for name, j in zip(names, skin["joints"])
    }
    takes = {root: i for i, (_, root) in enumerate(monster.bones) if root}

    def bone_of(joint: str | None) -> int:
        while joint is not None:
            if joint in takes:
                return takes[joint]
            joint = joint_parent.get(joint)
        return 0

    joint_bone = np.array([bone_of(name) for name in names])
    folded = np.zeros((len(positions), len(monster.bones)))
    for k in range(4):
        np.add.at(folded, (np.arange(len(positions)), joint_bone[joints[:, k]]), weights[:, k])
    order = np.argsort(-folded, axis=1)[:, :4]
    bone_weights = np.take_along_axis(folded, order, axis=1)
    bone_weights /= bone_weights.sum(axis=1, keepdims=True)
    quantised = np.round(bone_weights * 255).astype(np.int64)
    quantised[:, 0] += 255 - quantised.sum(axis=1)  # the rounding error goes on the biggest weight
    print("bones per vertex:", np.bincount((bone_weights > 0).sum(axis=1))[1:])

    bone_names = [name for name, _ in monster.bones]
    pivots = {name: avatar(joint_at[root or PELVIS])[0] for name, root in monster.bones}
    palm = avatar(np.mean([joint_at[j] for j in PALM], axis=0))[0]
    # The tank hangs on the back a little below the shoulders: as far back as the trunk goes there.
    shoulder_y = (pivots["armL"][1] + pivots["armR"][1]) / 2 - 0.2
    trunk = np.isin(order[:, 0], [bone_names.index(b) for b in monster.torso])
    back_z = posed[trunk & (abs(posed[:, 1] - shoulder_y) < 0.3)][:, 2].min() - 0.05
    back = np.array([0, shoulder_y, back_z])
    # Fallen on its back, the body lies this far up: how far the back is behind the root bone's pivot.
    lie = -posed[order[:, 0] == 0][:, 2].min()

    def b64(a: np.ndarray) -> str:
        return base64.b64encode(a.tobytes()).decode()

    def vec(v: np.ndarray) -> str:
        return "[" + ", ".join(f"{c + 0.0:.4f}".replace("-0.0000", "0.0000") for c in v) + "]"

    lines = [
        f"// Generated by packages/client/scripts/monster-model.py from Guilherme Navarro's {monster.title}"
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
        f"  uvs: '{b64(np.round(uvs * 65535).astype('<u2'))}',",
        f"  indices: '{b64(triangles.astype('<u2'))}',",
        f"  boneIndices: '{b64(order.astype('u1'))}',",
        f"  boneWeights: '{b64(quantised.astype('u1'))}',",
        "} as const;",
        "",
    ]
    out.write_text("\n".join(lines))
    print(f"{len(triangles)} triangles, {len(positions)} vertices; wrote {out} ({out.stat().st_size} bytes)")

    image = doc["images"][0]
    view = doc["bufferViews"][image["bufferView"]]
    png = blob[view.get("byteOffset", 0) : view.get("byteOffset", 0) + view["byteLength"]]
    texture_out.parent.mkdir(parents=True, exist_ok=True)
    Image.open(io.BytesIO(png)).convert("RGB").quantize(256, dither=Image.Dither.FLOYDSTEINBERG).save(
        texture_out, optimize=True
    )
    print(f"wrote {texture_out} ({texture_out.stat().st_size} bytes, from {len(png)})")


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
