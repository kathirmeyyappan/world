"""Builds render/avatars/<name>Model.ts and the avatar's texture from a rigged character on Sketchfab
(all CC BY 4.0), downloaded as a .glb:

    pip install numpy pillow fast_simplification
    python packages/client/scripts/avatar-model.py sulley path/to/sulley_monsters_inc.glb
    python packages/client/scripts/avatar-model.py mike path/to/mike_wazowski_monsters_inc.glb
    python packages/client/scripts/avatar-model.py spongebob path/to/spongebob_squarepants.glb
    python packages/client/scripts/avatar-model.py patrick path/to/patrick_star_fortnite.glb
    python packages/client/scripts/avatar-model.py squidward path/to/squidward_tentacles.glb
    python packages/client/scripts/avatar-model.py gary path/to/gary_spongebob.glb

Each is a skinned mesh (or a few) on a rig of a hundred-odd joints, or rigid parts on a tree of
nodes, with no animation. This poses it
in its bind pose, folds the rig down to the bones the avatar moves on their own (MODELS), giving
every vertex the weights it had on each bone's subtree (or, for a rigid part holding several limbs,
each limb its own bone), so the client can skin it on the GPU and the
joints bend instead of tearing, decimates the trunk where the model is over its budget, and turns it
into the avatar's frame (y up, facing +z, x to its right, feet at 0, `height` tall). Everything the
model draws goes into one mesh with one texture: the meshes are joined, and their textures (no
bigger than `texture_size`, tiled as far as their texture coordinates repeat them) and plain colours
are packed into one atlas, with the coordinates moved to match. It writes the vertices in
millimetres, the normals, texture coordinates, triangles and weights, base64-encoded, with each bone's
pivot (its joint in the bind pose), the right palm (where a held item goes) and a point on the back
(where the tank sits); and the atlas as a palette PNG, which looks the same at well under half the
size.
"""

from __future__ import annotations

import base64
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image
from glb import SMALL_PART, accessor, closed, components, decimate, local_matrix, name_of, pack_atlas, read_glb

CLIENT = Path(__file__).resolve().parents[1]

# A rig joint: its name (without the exporter's numeric suffix, see name_of) or, where the names
# didn't survive export, its index in the skin's joint list.
Joint = str | int


@dataclass(frozen=True)
class Piece:
    """One of the separate pieces of a rigid node's mesh, where it holds several limbs (four legs in
    one mesh): the one whose middle is on this side of the body in the avatar's frame, `x` to its
    right and `z` forward, each 1, -1 or 0 for either side."""

    node: Joint
    x: int = 0
    z: int = 0


@dataclass(frozen=True)
class Lower:
    """The lower part of another bone's piece, for a limb that bends: from `share` of the way up it
    on down, fading in over `blend` of its height so the skin bends there rather than tearing. It
    swings from the top of itself, like a piece."""

    of: str
    share: float = 0.5
    blend: float = 0.2


@dataclass(frozen=True)
class Band:
    """One of `count` bones laid along a node's length (its x, the forward of a rig that faces +x).
    Each vertex of the node takes the bones whose share of the length it is nearest to, blended with
    its neighbours, so a wave passing along the node bends it rather than tearing it."""

    node: Joint
    index: int
    count: int


@dataclass(frozen=True)
class Model:
    title: str  # the model's name on Sketchfab
    author: str
    height: float  # metres, feet to the top of the head
    # The avatar's bones and the rig joint each takes the subtree of, the piece of a node's mesh it
    # is, the lower part of a piece it is, or a band of a node. The first is the root: its joint is
    # only its pivot, and it takes every joint no other bone does. The order is the bone index the
    # vertices refer to; the avatar parents them.
    bones: tuple[tuple[str, Joint | Piece | Lower | Band], ...]
    torso: tuple[str, ...]  # the bones whose vertices are the trunk, for finding the back
    # The right hand and finger roots: a held item goes at their middle. Or the bone that is the
    # right arm, whose far end is the hand.
    palm: tuple[Joint, ...] | str
    # Colours for materials that have none in the file, by material name (sRGB 0 to 255).
    colours: dict[str, tuple[int, int, int]] = field(default_factory=dict)
    # Triangles to keep, give or take: the big closed parts (a trunk, a claw) are decimated to get
    # there, each losing the same share. Small parts (a face's) are kept whole, and so are open
    # shells (a shirt, a head that ends inside a collar), whose rims collapse inwards and open gaps,
    # unless `open_shells_too` says their rims are all hidden inside other parts.
    # None keeps the model as it is.
    budget: int | None = None
    open_shells_too: bool = False
    texture_size: int = 512  # px: a bigger texture is scaled down to this on its long side
    # Bones that swing from the top of their own geometry rather than from their joint: a stub leg
    # whose node sits partway down it. A piece and a lower part always do.
    hinges: tuple[str, ...] = ()
    # Bones that turn on the bottom of their own geometry: a head whose node is at its middle.
    necks: tuple[str, ...] = ()
    # A rig that faces +x (a snail's, its eyes forward) rather than +z: its right is then +z.
    facing_x: bool = False
    # A bone that is a shell on the back: the tank sits on the middle of its top, not on the shoulders.
    shell: str | None = None


BIPED_PALM = ("Bip001_R_Hand", "Bip001_R_Finger0", "Bip001_R_Finger1", "Bip001_R_Finger2")

MODELS = {
    "sulley": Model(
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
    "mike": Model(
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
    "spongebob": Model(
        "Spongebob SquarePants",
        "Jamessmartguy",
        1.9,
        (("body", 65), ("armL", 32), ("armR", 48), ("legL", 68), ("legR", 75)),
        ("body",),
        (50, 51, 54, 57),
        {"Tongue": (214, 96, 118)},
    ),
    "patrick": Model(
        "Patrick Star (Fortnite)",
        "NickBob",
        2.85,  # one and a half SpongeBobs, as on the show
        (
            ("body", "pelvis"),
            ("armL", "upperarm_l"),
            ("armR", "upperarm_r"),
            ("legL", "thigh_l"),
            ("legR", "thigh_r"),
        ),
        ("body",),
        ("hand_r",),
        budget=2000,
    ),
    # Not skinned: rigid parts on a tree of nodes named for what they are, so the joints are the
    # nodes. The right palm is node 34, the hand mesh's own node out in the claw.
    "krabs": Model(
        "Mr Krabs (Spongebob)",
        "Anthony Yanez",
        2.4,  # a quarter taller than SpongeBob, eyestalks and all
        (
            ("body", "Body"),
            ("armL", "Left_shoulder"),
            ("armR", "Right_shoulder"),
            ("legL", "Left_leg"),
            ("legR", "Right_leg"),
        ),
        ("body",),
        (34,),
        hinges=("legL", "legR"),
        texture_size=128,
    ),
    # Not skinned: rigid parts on a tree of nodes named for their shapes. The head (with the eyes
    # under it) is node 5, the shirt 10 and its collar 13; the four legs are one mesh on node 16 and
    # both arms one on node 19, so those bones are the pieces of them, and each tentacle's lower half
    # is a bone of its own so it bends. Every part is an open shell, with its rim inside the part it
    # meets.
    # Not skinned: a snail's rig of rigid parts on a tree of nodes. The soft body with its foot is
    # node 4, cut into five bones along its length so the foot can ripple; the shell on its back is
    # node 6 and the eyes on their stalks, at the front, node 5, turning on the bottom of the stalks.
    "gary": Model(
        "Gary (Spongebob)",
        "Anthony Yanez",
        0.63,  # a third of SpongeBob
        (
            ("body", 3),
            ("shell", 6),
            ("eyes", 5),
            ("foot0", Band(4, 0, 5)),
            ("foot1", Band(4, 1, 5)),
            ("foot2", Band(4, 2, 5)),
            ("foot3", Band(4, 3, 5)),
            ("foot4", Band(4, 4, 5)),
        ),
        ("body",),
        "eyes",
        necks=("eyes",),
        facing_x=True,
        shell="shell",
        texture_size=256,
    ),
    "squidward": Model(
        "Squidward Tentacles",
        "Super Tablé",
        3.2,  # taller than Patrick, as on the show
        (
            ("body", 10),
            ("head", 5),
            ("armL", Piece(19, x=-1)),
            ("armR", Piece(19, x=1)),
            ("legFL", Piece(16, x=-1, z=1)),
            ("legFR", Piece(16, x=1, z=1)),
            ("legBL", Piece(16, x=-1, z=-1)),
            ("legBR", Piece(16, x=1, z=-1)),
            ("footFL", Lower("legFL")),
            ("footFR", Lower("legFR")),
            ("footBL", Lower("legBL")),
            ("footBR", Lower("legBR")),
        ),
        ("body",),
        "armR",
        budget=3500,
        open_shells_too=True,
        texture_size=256,
        necks=("head",),
    ),
}


def main(name: str, glb: str) -> None:
    model = MODELS[name]
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

    if doc.get("skins"):
        skin = doc["skins"][0]
        joints = skin["joints"]
        inverse_bind = accessor(doc, blob, skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
    else:
        # Rigid parts, each a mesh on a node of the tree: every node is a joint, and a part follows
        # its own node wholly, so its skinning matrix is just the node's transform.
        joints = list(range(len(nodes)))
        inverse_bind = np.broadcast_to(np.eye(4), (len(nodes), 4, 4))
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
    # else to the root bone; a piece's bone takes it from whichever bone has its node.
    bone_names = [bone for bone, _ in model.bones]
    takes = {
        joint(ref): i
        for i, (_, ref) in enumerate(model.bones[1:], start=1)
        if not isinstance(ref, (Piece, Lower, Band))
    }
    pieces: dict[int, list[tuple[int, Piece]]] = {}  # a joint's pieces, with their bones
    lowers: dict[int, list[tuple[int, Lower]]] = {}  # a piece's bone's lower parts, with their bones
    bands: dict[int, list[tuple[int, Band]]] = {}  # a joint's bands, with their bones
    for i, (_, ref) in enumerate(model.bones):
        if isinstance(ref, Piece):
            pieces.setdefault(joint(ref.node), []).append((i, ref))
        elif isinstance(ref, Lower):
            lowers.setdefault(bone_names.index(ref.of), []).append((i, ref))
        elif isinstance(ref, Band):
            bands.setdefault(joint(ref.node), []).append((i, ref))
    # Each banded joint's extent in the rig: its x from end to end, its lowest y and its middle z.
    extents: dict[int, tuple[float, float, float, float]] = {}
    root = joint(model.bones[0][1])
    hip = transform(joints[root])[:3, 3]

    def bone_of(k: int) -> int:
        while k >= 0:
            if k in takes:
                return takes[k]
            k = joint_parent[k]
        return 0

    joint_bone = np.array([bone_of(k) for k in range(len(joints))])

    def pieces_of(k: int) -> list[tuple[int, Piece]]:
        while k >= 0:
            if k in pieces:
                return pieces[k]
            k = joint_parent[k]
        return []

    # Every primitive of every skinned mesh, posed, with its weights folded onto the avatar's bones.
    parts = []
    for index, node in enumerate(nodes):
        if "mesh" not in node:
            continue
        for prim in doc["meshes"][node["mesh"]]["primitives"]:
            attrs = prim["attributes"]
            p = accessor(doc, blob, attrs["POSITION"]).astype(np.float64)
            n = accessor(doc, blob, attrs["NORMAL"]).astype(np.float64)
            triangles = accessor(doc, blob, prim["indices"]).reshape(-1, 3).astype(np.int64)
            if "JOINTS_0" in attrs:
                j = accessor(doc, blob, attrs["JOINTS_0"]).astype(np.int64)
                w = accessor(doc, blob, attrs["WEIGHTS_0"]).astype(np.float64)
            else:
                j = np.full((len(p), 4), joint_index[index])
                w = np.c_[np.ones(len(p)), np.zeros((len(p), 3))]
                # A part its node mirrors (a negative scale) comes out wound inside out.
                if np.linalg.det(skinning[joint_index[index]][:3, :3]) < 0:
                    triangles = triangles[:, ::-1]
            homogeneous = np.c_[p, np.ones(len(p))]
            posed = np.zeros_like(p)
            posed_normals = np.zeros_like(n)
            folded = np.zeros((len(p), len(model.bones)))
            for k in range(4):
                m = skinning[j[:, k]]
                posed += w[:, k, None] * np.einsum("nij,nj->ni", m[:, :3, :], homogeneous)
                posed_normals += w[:, k, None] * np.einsum(
                    "nij,nj->ni", np.linalg.inv(m[:, :3, :3]).transpose(0, 2, 1), n
                )
                np.add.at(folded, (np.arange(len(p)), joint_bone[j[:, k]]), w[:, k])
            here = bands.get(joint_index[index], [])
            if here:
                # Hat weights over the node's length: a vertex at a band's share of it is that band's,
                # and between two shares it is split between them, so the weights always sum to one.
                lo, hi = posed[:, 0].min(), posed[:, 0].max()
                extents[joint_index[index]] = (lo, hi, posed[:, 1].min(), posed[:, 2].mean())
                count = here[0][1].count
                assert len(here) == count, f"node {index}: {len(here)} bands, {count} expected"
                t = np.clip((posed[:, 0] - lo) / (hi - lo), 0, 1) * (count - 1)
                share = np.clip(1 - np.abs(t[:, None] - np.arange(count)), 0, None)
                folded[:] = 0
                for i, band in here:
                    folded[:, i] = share[:, band.index]
            limbs = pieces_of(joint_index[index])
            for vertices in components({"positions": posed, "triangles": triangles}) if limbs else []:
                # The rig's left is +x, the avatar's right (see below).
                x, _, z = hip - posed[vertices].mean(axis=0)
                bones = [i for i, piece in limbs if piece.x * x >= 0 and piece.z * z <= 0]
                assert len(bones) == 1, f"node {index}: a piece at x {x:.2f}, z {-z:.2f} is {len(bones)} bones"
                folded[vertices] = 0
                folded[vertices, bones[0]] = 1
                for i, lower in lowers.get(bones[0], []):
                    ys = posed[vertices, 1]
                    height = ys.max() - ys.min()
                    cut = ys.min() + lower.share * height
                    share = np.clip((cut + (lower.blend * height) / 2 - ys) / (lower.blend * height), 0, 1)
                    folded[vertices, i] = share
                    folded[vertices, bones[0]] -= share
            parts.append(
                {
                    "positions": posed,
                    "normals": posed_normals,
                    "uvs": accessor(doc, blob, attrs["TEXCOORD_0"]).astype(np.float64),
                    "bones": folded,
                    "triangles": triangles,
                    "material": prim["material"],
                }
            )
    total = sum(len(part["triangles"]) for part in parts)
    if model.budget and model.budget < total:
        big = [
            part for part in parts if len(part["triangles"]) > SMALL_PART and (model.open_shells_too or closed(part))
        ]
        big_total = sum(len(part["triangles"]) for part in big)
        keep = (model.budget - total + big_total) / big_total
        for part in big:
            decimate(part, keep)
        print(f"decimated {total} triangles to {sum(len(part['triangles']) for part in parts)}")

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
    feet = posed[:, 1].min()
    scale = model.height / (posed[:, 1].max() - feet)
    # A biped faces +z with its left at +x, so mirroring x gives the avatar's frame. A rig that faces +x
    # has its right at +z, so its x and z swap (a reflection too, so the winding comes out the same).
    turn = np.array([[0, 0, 1], [0, 1, 0], [1, 0, 0]], dtype=np.float64) if model.facing_x else np.diag([-1.0, 1, 1])
    origin = np.array([hip[0], feet, hip[2]])

    def avatar(p: np.ndarray) -> np.ndarray:
        p = np.atleast_2d(p)
        return (p - origin) @ turn.T * scale

    posed = avatar(posed)
    posed_normals = posed_normals @ turn.T
    posed_normals /= np.linalg.norm(posed_normals, axis=1)[:, None]

    # Each vertex's four heaviest bones, their weights summing to 255.
    order = np.argsort(-folded, axis=1)[:, :4]
    bone_weights = np.take_along_axis(folded, order, axis=1)
    bone_weights /= bone_weights.sum(axis=1, keepdims=True)
    quantised = np.round(bone_weights * 255).astype(np.int64)
    quantised[:, 0] += 255 - quantised.sum(axis=1)  # the rounding error goes on the biggest weight
    print("bones per vertex:", np.bincount((bone_weights > 0.002).sum(axis=1))[1:])

    pivots = {
        bone: avatar(transform(joints[joint(ref)])[:3, 3])[0]
        for bone, ref in model.bones
        if not isinstance(ref, (Piece, Lower, Band))
    }
    # A band's pivot is on the ground under its share of the node, so the ripple bends from there.
    for bone, ref in model.bones:
        if isinstance(ref, Band):
            lo, hi, bottom, middle = extents[joint(ref.node)]
            x = lo + (hi - lo) * ref.index / (ref.count - 1)
            pivots[bone] = avatar(np.array([[x, bottom, middle]]))[0]
    # A hinge, a piece or a lower part swings from the middle of the top of its own geometry, a neck
    # turns on the middle of the bottom of its: the band within a twentieth of its height of that end.
    for bone, ref in model.bones:
        if bone not in model.hinges and bone not in model.necks and not isinstance(ref, (Piece, Lower)):
            continue
        own = posed[order[:, 0] == bone_names.index(bone)]
        top, bottom = own[:, 1].max(), own[:, 1].min()
        end = bottom if bone in model.necks else top
        pivots[bone] = own[abs(own[:, 1] - end) < (top - bottom) / 20].mean(axis=0)
        pivots[bone][1] = end
    if isinstance(model.palm, str):
        # The far end of the arm: the middle of what lies within a tenth of its length of its tip.
        own = posed[order[:, 0] == bone_names.index(model.palm)]
        reach = np.linalg.norm(own - pivots[model.palm], axis=1)
        palm = own[reach > reach.max() * 0.9].mean(axis=0)
    else:
        palm = avatar(np.mean([transform(joints[joint(ref)])[:3, 3] for ref in model.palm], axis=0))[0]
    if model.shell:
        # A shell on the back: the tank sits on the middle of its top.
        own = posed[order[:, 0] == bone_names.index(model.shell)]
        crown = own[own[:, 1] > own[:, 1].max() - 0.02]
        back = crown.mean(axis=0)
        back[1] = own[:, 1].max()
    else:
        # The tank hangs on the back a little below the shoulders: as far back as the trunk goes there.
        shoulder_y = (pivots["armL"][1] + pivots["armR"][1]) / 2 - 0.2
        trunk = np.isin(order[:, 0], [bone_names.index(b) for b in model.torso])
        back_z = posed[trunk & (abs(posed[:, 1] - shoulder_y) < 0.3)][:, 2].min() - 0.05
        back = np.array([0, shoulder_y, back_z])
    # Fallen on its back, the body lies this far up: as far as anything (the back of a big head) is
    # behind the root bone's pivot.
    lie = -posed[:, 2].min()

    atlas, uv = pack_atlas(doc, blob, uv, material, model.colours, model.texture_size)

    def b64(a: np.ndarray) -> str:
        return base64.b64encode(a.tobytes()).decode()

    def vec(v: np.ndarray) -> str:
        return "[" + ", ".join(f"{c + 0.0:.4f}".replace("-0.0000", "0.0000") for c in v) + "]"

    lines = [
        f"// Generated by packages/client/scripts/avatar-model.py from {model.author}'s {model.title}"
        " (Sketchfab, CC BY 4.0); don't edit.",
        "// One skinned mesh in the avatar's frame (metres: feet at 0, facing +z, x to its right): vertices in",
        "// millimetres (Int16 x, y, z), unit normals (Int8), texture coordinates (Uint16 over 0 to 1, v down the",
        "// image), triangles (Uint16) and, per vertex, the four bones it follows (Uint8 indices into `bones`) and",
        "// how much (Uint8, summing to 255); all base64. `bones` is each bone's pivot in metres, in index order.",
        "// `hand` is the right palm, `back` where the tank hangs, `lie` how high the hips lie when it is on its back.",
        f"export const {name.upper()}_MODEL = {{",
        f"  height: {model.height},",
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


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
