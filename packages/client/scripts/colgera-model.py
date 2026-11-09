"""Builds render/avatars/colgeraModel.ts and the Colgera texture from the Tears of the Kingdom
Colgera rip (Qw2's, at the Models Resource), unpacked into a folder:

    pip install numpy pillow fast_simplification
    python packages/client/scripts/colgera-model.py path/to/Colgera

The rip is the game's own model and rig, in Collada (colgera.dae; the FBX is the same thing):
every piece of the body (a ring of shell, a stretch of spine, a wing's finger, an arm's segment,
the head, the jaw) is a rigid mesh bound to one joint of a skeleton that runs straight down the
body, Spine_1 to Spine_19 and the tail, the wing membranes alone skinned over the fingers'
joints; the spiky crown each ring wears is a file of its own (Weakpoint/colgera_weakpoint_spike.dae,
a ring of spikes round the origin), stood on each ring's Spike node. This puts every vertex where
the rig's bind pose has it and turns the skeleton into the dragon's (sim/dragon.ts): a spine point
at each joint along the body, so the sim's links are the rig's joint spacings (a ring segment's
long, the spine's short; the shape goes in AVATARS by hand, from what this prints), and a bone per
link at its middle, lying along it, carrying every piece hung on the joint at the link's head (a
ring segment's shell, crown and clavicles with its stretch of spine, so they turn as one piece);
the head and everything on it (the eyes, the scissor mandibles) is bone 0, at the eyes, the jaw
hangs on it at its hinge, and each wing (four pairs, the arm's segments and that side of the pair's
membrane) hangs on its link's bone at its shoulder, for the renderer to flap. The rig's bind pose is the body drawn out to its full length; the game
carries Colgera with the thin stretches of spine between the rings telescoped, so those links are
THIN of the rig's spacing and each piece moves up the body with its link, nesting as the rig means
them to (each overlaps the next), while the rings keep their length; that telescoped body is the
model's rest pose. Each piece keeps its own texture (the body's, the
wings' or the spikes'), packed into one atlas with a swatch for each plain colour (the eyes), and
the model is written as dragon-model.py writes the light dragon's, in the dragon's frame: metres,
the eyes at the origin, x to its right (mirrored, the rip being right-handed), the body down -z.
SCALE is the rip's unit in metres; everything the sim needs of the body (links, radii) is printed
in metres at the end.
"""

from __future__ import annotations

import base64
import sys
import xml.etree.ElementTree as ET
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple

import numpy as np
from glb import SWATCH, Region, decimate, pack_regions, swatch, textured
from PIL import Image

CLIENT = Path(__file__).resolve().parents[1]
NS = "{http://www.collada.org/2005/11/COLLADASchema}"
SCALE = 0.15  # metres per unit of the rip: a 25 m body, a 22 m wingspan
THIN = 0.55  # how much of the rig's spacing a link of thin spine keeps; a ring's link keeps all of it

# The joints the sim's spine runs through, head to tail: a spine point at each after the eyes, and
# the tail's tip past the last. A piece follows the link from the joint it hangs on (or the joint
# its own hangs on, down the rig) to the next.
CHAIN = [f"Spine_{i}" for i in range(1, 20)] + ["Tail_1", "Tail_2"]
RINGS = {"A": "Spine_1", "B": "Spine_6", "C": "Spine_16"}  # each ring segment starts at its joint
WINGS = ["A", "B", "C", "D"]  # the wing pairs, head to tail; Arm_X_1_L is the left one's shoulder
HEAD_JOINTS = {"Head", "Scissor_L", "Scissor_R"}  # one rigid piece with the eyes
PAIRED = {"Tail_1_L": "Tail_1", "Tail_1_R": "Tail_1", "Tail_2_L": "Tail_2", "Tail_2_R": "Tail_2"}
PAIRED_JOINT = {"Tail_1": "Tail_1_L", "Tail_2": "Tail_2_L"}  # the tail's joints come in pairs, side by side
NECK_LINK = {"Neck": 0}  # the neck sits on the first link, from the eyes to Spine_1
HEAD_MESH = ("Head", "Jaw", "Eyeball", "Eye_P", "Scissor")  # hidden for its rider's view from the eyes


class Look(NamedTuple):
    """How a material is painted: an image of the rip, drawn `lift` times as bright (ice in the
    night sky, not slate) and tinted, over `under` where it's clear, or a plain colour; and what of
    it shines in the dark (the glow atlas): an image (its emission map, over black) or a colour,
    `shine` times as bright (a colour's worth, to tint it), or nothing."""

    paint: str | tuple[int, int, int]
    lift: float = 1.0
    tint: tuple[float, float, float] = (1.0, 1.0, 1.0)
    under: tuple[int, int, int] = (0, 0, 0)
    glow: str | tuple[int, int, int] | None = None
    shine: float | tuple[float, float, float] = 1.0


# How much of its own paint a skin with a glow map gives off as light, baked into the map (a skin
# without one lights itself by render/avatars/skinned.ts GLOW, through its paint, which leaves it
# all but unshaded): enough that the lit side is as bright as that and the shaded side a little
# dimmer, so the body has some shape.
SELF_LIGHT = 0.75
BODY_ALB = "Enemy_DungeonBoss_Rito_Body_Alb.png"
BODY_EMM = "Enemy_DungeonBoss_Rito_Body_Emm.png"  # the veins of light through the ice
WING_ALB = "Enemy_DungeonBoss_Rito_Wing_Alb.png"
ICE_ALB = "Weakpoint/Enemy_DungeonBoss_Rito_Weakpoint_Ice_Alb.png"  # the plates over the rings' hollows
EYE = "Cmn_Enemy_DungeonBoss_Eye_Emc.png"  # the eyes' light, a slit of orange
SOCKET = (36, 40, 52)
CRYSTAL = (190, 40, 255)  # the weak point's glowing heart
VEINS = (0.35, 0.5, 0.65)  # the veins shine this much, in ice blue: a glimmer, not a lamp
EYES = 1.5  # the eyes shine past white, so they bloom
TEXTURES: dict[str, Look] = {
    "Mt_Enemy_DungeonBoss_Rito_Body": Look(BODY_ALB, lift=1.3, glow=BODY_EMM, shine=VEINS),
    "Mt_Enemy_DungeonBoss_Rito_Body_Red": Look(BODY_ALB, lift=1.3, glow=BODY_EMM, shine=VEINS),
    "Mt_Enemy_DungeonBoss_Rito_Body_Black": Look(BODY_ALB, lift=1.3, glow=BODY_EMM, shine=VEINS),
    "Mt_Enemy_DungeonBoss_Rito_Wing_A": Look(WING_ALB, lift=1.3),
    "Mt_Enemy_DungeonBoss_Rito_Wing_B": Look(WING_ALB, lift=1.3),
    "Mt_Enemy_DungeonBoss_Rito_Wing_C": Look(WING_ALB, lift=1.3),
    "Mt_Enemy_DungeonBoss_Rito_Wing_D": Look(WING_ALB, lift=1.3),
    "Mt_Spike_01": Look(
        "Weakpoint/Enemy_DungeonBoss_Rito_Spike_Alb.png",
        lift=1.9,
        glow="Weakpoint/Enemy_DungeonBoss_Rito_Spike_Emm.png",
        shine=VEINS,
    ),
    "Mt_Weakpoint": Look("Weakpoint/Enemy_DungeonBoss_Rito_Weakpoint_Alb.png", lift=1.2),  # the crystal's dark face
    "Mt_Weakpoint_RedA": Look(CRYSTAL, glow=CRYSTAL, shine=1.2),
    "Mt_Weakpoint_RedB": Look((235, 130, 255), glow=(235, 130, 255), shine=1.2),
    # The ice over each hollow, top and bottom: the rip's slate-grey marble lifted to a pale
    # lavender, with the crystal's glow showing through it (the client draws it translucent).
    "Mt_Weakpoint_Down_00": Look(ICE_ALB, lift=2.6, tint=(1.0, 0.96, 1.08)),
    "Mt_Weakpoint_Up_00": Look(ICE_ALB, lift=2.6, tint=(1.0, 0.96, 1.08)),
    "Mt_Eye_OutSide": Look(SOCKET),  # the sockets
    "Mt_Eye": Look(EYE, under=SOCKET, glow=EYE, shine=EYES),
    "Mt_Eye_1": Look(EYE, under=SOCKET, glow=EYE, shine=EYES),
    "Mt_Eye_2": Look(EYE, under=SOCKET, glow=EYE, shine=EYES),
    "Mt_Eye_3": Look(EYE, under=SOCKET, glow=EYE, shine=EYES),
    "Mt_Eye_4": Look(EYE, under=SOCKET, glow=EYE, shine=EYES),
}
TEXTURE_SIZE = 512
# What each piece is cut down to, by the start of its name: triangles, or the share of its own it
# keeps; the rest (the head, the jaw) keep theirs.
BUDGET = {
    "Eyeball": 300,
    "Arm": 0.4,
    "Clavicle": 0.5,
    "Wing_A_": 0.45,
    "Wing_B_": 0.45,
    "Wing_C_": 0.45,
    "Wing_D_": 0.45,
    "Spine": 0.55,
    "Shell": 0.55,
    "Scissor": 0.6,
    "Tail": 0.7,
    "Crown": 0.3,
    "Plate": 0.35,
    "Ice": 0.5,
}


def main(folder: str) -> None:
    out = CLIENT / "src/render/avatars/colgeraModel.ts"
    texture_out = CLIENT / "public/assets/textures/avatars/colgera.png"
    rip = Path(folder)
    doc = ET.parse(rip / "colgera.dae").getroot()
    joints, parents, _ = read_skeleton(doc)
    parts = read_parts(doc, lambda name, skin_joints: link_of(name, skin_joints, parents))
    # The crowns and the crystals: the ring of spikes stood on each ring segment's Spike node and
    # the weak point's crystal plate on its Weakpoint node, in the hollow of its underside, each
    # one piece with the ring until the sim says the crystal is shot out.
    crown = ET.parse(rip / "Weakpoint/colgera_weakpoint_spike.dae").getroot()
    spikes = [p for p in read_parts(crown, lambda name, _: None) if p["name"].startswith("Spike_")]
    plate = ET.parse(rip / "Weakpoint/colgera_weakpoint.dae").getroot()
    crystals = read_parts(plate, lambda name, _: None)
    # The ice sealing each hollow, under the crystal and over it, on the ring's Ice nodes: the rip
    # has each at three stages of cracking (00 whole), the cracks a mesh of their own, left out.
    ice = {}
    for face in ("Down", "Up"):
        doc_ice = ET.parse(rip / f"Weakpoint/colgera_weakpoint_{face.lower()}.dae").getroot()
        ice[face] = [
            p for p in read_parts(doc_ice, lambda name, _: None) if p["material"] == f"Mt_Weakpoint_{face}_00-material"
        ]
        assert ice[face], f"no whole ice plate for the {face} of a hollow"
    for ring, joint in RINGS.items():
        link = CHAIN.index(joint) + 1
        for kind, pieces, node in (
            ("Crown", spikes, f"Spike_{ring}"),
            ("Plate", crystals, f"Weakpoint_{ring}"),
            ("IceDown", ice["Down"], f"Ice_{ring}_Down"),
            ("IceUp", ice["Up"], f"Ice_{ring}_Up"),
        ):
            at = joints[node][:3, 3]
            for piece in pieces:
                parts.append(
                    {
                        **piece,
                        "name": f"{kind}_{ring}_{piece['name']}",
                        "link": link,
                        "positions": piece["positions"] + at,
                    }
                )
    eyes = np.vstack([p["positions"] for p in parts if p["name"].startswith("Eyeball")]).mean(axis=0)
    # The chain's joints along the body, as distance behind the eyes: the rip's world runs +y down
    # the body (its up is +z), so a joint's y past the eyes' is how far back it is. The rig's
    # stations place the pieces; the sim's are those with the thin stretches telescoped.
    along = {name: joints[PAIRED_JOINT.get(name, name)][1, 3] - eyes[1] for name in CHAIN}
    tip = max(p["positions"][:, 1].max() for p in parts if p["name"].startswith("Tail_2")) - eyes[1]
    rig_stations = [0.0] + [along[name] for name in CHAIN] + [tip]  # the eyes, each spine point, the tip
    rig_links = np.diff(rig_stations)
    ring_links = [CHAIN.index(joint) + 1 for joint in RINGS.values()]
    links = np.array([link if k in ring_links else link * THIN for k, link in enumerate(rig_links)]) * SCALE
    stations = np.r_[0, np.cumsum(links)]

    def frame(p: np.ndarray) -> np.ndarray:
        """The rip's world to the dragon's frame: x to its right, y up, z forward, from the eyes."""
        p = np.atleast_2d(p) - eyes
        return np.stack([-p[:, 0], p[:, 2], -p[:, 1]], axis=1) * SCALE

    # Each piece moves up the body with its link, so the rest pose is the telescoped body itself.
    rig_middle = [(rig_stations[k] + rig_stations[k + 1]) / 2 * SCALE for k in range(len(links))]
    middle = [(stations[k] + stations[k + 1]) / 2 for k in range(len(links))]
    for part in parts:
        part["positions"] = frame(part["positions"])
        if part["link"] is not None:
            part["positions"][:, 2] += rig_middle[part["link"]] - middle[part["link"]]
        part["normals"] = part["normals"] * [-1, 1, -1]
        part["triangles"] = part["triangles"][:, ::-1]  # mirrored: the winding turns round
    assert all(p["positions"][:, 2].max() > 0 for p in parts if p["name"] == "Head_Shape"), (
        "the snout ahead of the eyes"
    )
    assert all(p["positions"][:, 1].mean() > 0 for p in parts if p["name"].startswith("Shell")), (
        "the shells on the back"
    )
    assert next(p for p in parts if p["name"] == "Clavicle_A_L_Shape")["positions"][:, 0].mean() < 0, "the left to -x"
    assert all(p["positions"][:, 1].min() > 0 for p in parts if p["name"].startswith("Crown")), (
        "the crowns on the rings"
    )
    assert all(p["positions"][:, 1].mean() < -0.2 for p in parts if p["name"].startswith("IceDown")), (
        "the ice under each hollow"
    )
    assert all(p["positions"][:, 1].mean() > 0.2 for p in parts if p["name"].startswith("IceUp")), (
        "the ice over each hollow"
    )

    # The bones: the eyes, the jaw at its hinge, one per link at its middle, lying along the
    # straight body, and one per wing at its shoulder, hung on its link's; every piece bound
    # rigidly to its own. Rows of position, right, up, forward.
    axes = np.array([1.0, 0, 0, 0, 1, 0, 0, 0, 1])
    jaw_hinge = frame(joints["Jaw"][:3, 3])[0]
    frames = [np.r_[0, 0, 0, axes], np.r_[jaw_hinge, axes]]
    parent_bones: list[int | None] = [None, 0]
    for k in range(len(links)):
        frames.append(np.r_[0, 0, -middle[k], axes])
        parent_bones.append(None)
    wings = []
    for pair, letter in enumerate(WINGS):
        for side, sign in (("L", -1), ("R", 1)):
            shoulder_joint = f"Arm_{letter}_1_{side}"
            link = link_of(shoulder_joint, [shoulder_joint], parents)
            assert link is not None
            shoulder = frame(joints[shoulder_joint][:3, 3])[0]
            shoulder[2] += rig_middle[link] - middle[link]  # telescoped up the body with its link
            assert shoulder[0] * sign > 0, f"{shoulder_joint}'s shoulder on its own side"
            wings.append(
                {
                    "bone": len(frames),
                    "pivot": shoulder - frames[link + 2][:3],
                    "side": sign,
                    "pair": pair,
                    "pieces": f"Arm_{letter}_",
                    "membrane": f"Wing_{letter}_",
                    "suffix": f"_{side}",
                }
            )
            frames.append(np.r_[shoulder, axes])
            parent_bones.append(link + 2)
    frames = np.array(frames)
    bones = len(frames)
    for part in parts:
        part["bones"] = np.zeros((len(part["positions"]), bones))
        part["bones"][:, 1 if part["name"].startswith("Jaw") else 0 if part["link"] is None else part["link"] + 2] = 1
        for wing in wings:
            # An arm's segments are the wing's; the pair's membrane goes to the side each of its
            # vertices is weighted to.
            if part["name"].startswith(wing["pieces"]) and part["name"].split("_")[3] == wing["suffix"][1:]:
                part["bones"][:] = 0
                part["bones"][:, wing["bone"]] = 1
            elif part["name"].startswith(wing["membrane"]):
                on_side = [j.endswith(wing["suffix"]) for j in part["joints"]]
                mine = part["weights"][:, on_side].sum(axis=1) > 0.5
                part["bones"][mine] = 0
                part["bones"][mine, wing["bone"]] = 1
    assert all(len(p["name"].split("_")) == 5 for p in parts if p["name"].startswith("Arm_")), "Arm_X_n_side_Shape"
    # The mouth: the lower jaw's tip, the farthest forward it goes on the middle line.
    jaw = np.vstack([p["positions"] for p in parts if p["name"].startswith("Jaw")])
    jaw = jaw[np.abs(jaw[:, 0]) < 0.2]
    mouth = jaw[np.argmax(jaw[:, 2])]

    total = sum(len(p["triangles"]) for p in parts)
    for part in parts:
        budget = next((b for prefix, b in BUDGET.items() if part["name"].startswith(prefix)), None)
        if budget is not None:
            keep = budget if budget < 1 else budget / len(part["triangles"])
            if keep < 1:
                decimate(part, keep)
    print(f"decimated {total} triangles to {sum(len(p['triangles']) for p in parts)}")

    # Two atlases laid out alike: each image of the rip once, for every vertex painted with it,
    # and a swatch per plain colour; and the glow map, what shines in the dark (the eyes, the
    # crystals, the veins) over SELF_LIGHT of the paint, region for region.
    uv = np.vstack([p["uvs"] for p in parts])
    material = np.concatenate([np.repeat(p["material"], len(p["positions"])) for p in parts])
    regions: list[Region] = []
    glow_regions: list[Region] = []
    by_look: dict[Look, list[int]] = {}
    for m in np.unique(material):
        by_look.setdefault(TEXTURES[m.removesuffix("-material")], []).extend(np.flatnonzero(material == m).tolist())
    for look, vertices in by_look.items():
        paint = painted(rip, look)
        shine = shining(rip, look, paint.size)
        if isinstance(look.paint, str):
            regions.append(textured(paint, uv, np.array(vertices), TEXTURE_SIZE, flat_ok=False))
            glow_regions.append(textured(shine, uv, np.array(vertices), TEXTURE_SIZE, flat_ok=False))
        else:
            regions.append(swatch(look.paint, np.array(vertices)))
            glow_regions.append(swatch(shine.getpixel((0, 0)), np.array(vertices)))
    atlas, uv = pack_regions(regions, uv)
    glow_atlas, _ = pack_regions(glow_regions, uv)
    assert glow_atlas.size == atlas.size, "the glow map laid out like the atlas"
    base = 0
    for part in parts:
        part["uvs"] = uv[base : base + len(part["uvs"])]
        base += len(part["uvs"])

    def vec(v: np.ndarray) -> str:
        return "[" + ", ".join(f"{c + 0.0:.4f}".replace("-0.0000", "0.0000") for c in v) + "]"

    along_bones = ["0.0000", "null"] + [f"{m:.4f}" for m in middle] + ["null"] * len(wings)
    lines = [
        "// Generated by packages/client/scripts/colgera-model.py from the Tears of the Kingdom Colgera rip; don't edit.",
        "// A dragon model (render/avatars/dragons.ts, DragonModel): skinned meshes in the dragon's frame (metres, the",
        "// eyes at the origin, x to its right): the head, the body, and each ring's crown and crystal (`weak`, in the",
        "// order of the sim's weak points), each with vertices in millimetres (Int16 x, y,",
        "// z), unit normals (Int8), texture coordinates (Uint16 over 0 to 1, v down the image), triangles (Uint16) and,",
        "// per vertex, the two bones it follows (Uint8) and the first's share of it (Uint8 of 255); all base64. A bone",
        "// sits on the spine `along` metres behind the eyes (bone 0 at them, the rest each at the middle of a link of",
        "// the sim's spine, carrying the pieces on it), or hangs on its `parent` with `along` null (the jaw, on the",
        "// head; each wing, on its link's bone at the shoulder, listed in `wings` with its pivot in that bone's frame,",
        "// its side and its pair); `neck` is how many bones behind the head lie on the neck's curve (none: the pieces",
        "// are rigid), `jaw` the lower jaw's bone. `frames` is each bone's rest pose in index order (its position, then",
        "// its right, up and forward unit vectors), and `mouth` the lower jaw's tip, where the breath starts.",
        "export const COLGERA_MODEL = {",
        f"  mouth: {vec(mouth)},",
        "  neck: 0,",
        "  jaw: 1,",
        f"  along: [{', '.join(along_bones)}],",
        f"  parent: [{', '.join('null' if b is None else str(b) for b in parent_bones)}],",
        "  wings: [",
        *(
            f"    {{ bone: {w['bone']}, pivot: {vec(w['pivot'])}, side: {w['side']}, pair: {w['pair']} }},"
            for w in wings
        ),
        "  ],",
        "  frames: [",
        *(f"    {', '.join(f'{c + 0.0:.4f}' for c in f)}," for f in frames),
        "  ],",
        *mesh_lines("head", [p for p in parts if p["name"].startswith(HEAD_MESH)]),
        "  maw: null,",
        *mesh_lines("body", [p for p in parts if not p["name"].startswith((*HEAD_MESH, "Crown", "Plate", "Ice"))]),
        "  weak: [",
        *(
            line
            for ring in RINGS
            for line in (
                "    {",
                *mesh_lines("crown", [p for p in parts if p["name"].startswith(f"Crown_{ring}_")], "      "),
                *mesh_lines("plate", [p for p in parts if p["name"].startswith(f"Plate_{ring}_")], "      "),
                *mesh_lines(
                    "ice", [p for p in parts if p["name"].startswith((f"IceDown_{ring}_", f"IceUp_{ring}_"))], "      "
                ),
                "    },",
            )
        ),
        "  ],",
        "} as const;",
        "",
    ]
    out.write_text("\n".join(lines))
    print(f"wrote {out} ({out.stat().st_size} bytes)")
    texture_out.parent.mkdir(parents=True, exist_ok=True)
    atlas.quantize(256, dither=Image.Dither.FLOYDSTEINBERG).save(texture_out, optimize=True)
    print(f"wrote {texture_out} ({atlas.size[0]}x{atlas.size[1]}, {texture_out.stat().st_size} bytes)")
    glow_out = texture_out.with_name("colgera-glow.png")
    glow_atlas.quantize(256, dither=Image.Dither.FLOYDSTEINBERG).save(glow_out, optimize=True)
    print(f"wrote {glow_out} ({glow_out.stat().st_size} bytes)")

    # What the sim's shape needs (AVATARS, sim/avatars.ts), in metres.
    print("links:", ", ".join(f"{link:.2f}" for link in links), f"({links.sum():.1f} m of body)")
    head = np.vstack([p["positions"] for p in parts if p["name"] == "Head_Shape"])
    widest = max(np.ptp(p["positions"][:, 0]) for p in parts if p["name"].startswith(("Spine", "Shell")))
    wings = max(np.ptp(p["positions"][:, 0]) for p in parts if p["name"].startswith("Wing"))
    print(
        f"head {np.ptp(head[:, 0]):.1f} m across; the body's widest piece {widest:.1f} m; wingspan {wings:.1f} m;"
        f" the mouth at {np.round(mouth, 2)}"
    )


def painted(rip: Path, look: Look) -> Image.Image:
    """A look's paint as an image: the rip's, over `under` where it's clear, lifted and tinted; a
    plain colour as a swatch-sized square of it."""
    if isinstance(look.paint, tuple):
        return Image.new("RGB", (SWATCH, SWATCH), look.paint)
    image = Image.open(rip / look.paint).convert("RGBA")
    under = Image.new("RGBA", image.size, (*look.under, 255))
    flat = np.asarray(Image.alpha_composite(under, image).convert("RGB"), dtype=np.float64)
    return Image.fromarray(np.clip(flat * look.lift * np.array(look.tint), 0, 255).astype(np.uint8))


def shining(rip: Path, look: Look, size: tuple[int, int]) -> Image.Image:
    """What of a look shines, as an image the size of its paint: its glow (an emission map over
    black, or a colour), `shine` times as bright, over SELF_LIGHT of the paint."""
    base = np.asarray(painted(rip, look).resize(size), dtype=np.float64) * SELF_LIGHT
    if isinstance(look.glow, str):
        image = Image.open(rip / look.glow).convert("RGBA")
        over_black = Image.alpha_composite(Image.new("RGBA", image.size, (0, 0, 0, 255)), image).convert("RGB")
        glow = np.asarray(over_black.resize(size), dtype=np.float64) * np.array(look.shine)
    elif look.glow is not None:
        glow = np.full((size[1], size[0], 3), np.array(look.glow, dtype=np.float64) * np.array(look.shine))
    else:
        glow = np.zeros((size[1], size[0], 3))
    return Image.fromarray(np.clip(base + glow, 0, 255).astype(np.uint8))


def read_parts(doc: ET.Element, link_of_piece: Callable[[str, list[str]], int | None]) -> list[dict]:
    """Every piece the file draws, posed: its vertices where the rig's bind pose puts them in the
    rip's world (the skinning formula, with every joint at its bind pose), with its normals, texture
    coordinates, triangles, material and which link of the sim's spine it lies on."""
    geometries = read_geometries(doc)
    skins = read_skins(doc)
    joints, _, armature = read_skeleton(doc)
    parts = []
    for node in doc.find(NS + "library_visual_scenes").iter(NS + "node"):
        inst = node.find(NS + "instance_controller")
        if inst is None or node.get("id", "").endswith("_UV_1"):  # the same piece with another UV set
            continue
        skin = skins[inst.get("url")[1:]]
        geometry = geometries[skin["geometry"]]
        name = node.get("id").split("__")[0]
        materials = {im.get("symbol"): im.get("target")[1:] for im in inst.iter(NS + "instance_material")}
        place = np.zeros((len(geometry["positions"]), 4, 4))
        weights = skin["weights"][geometry["position_index"]]  # the rip weights each position, not each corner
        for j, joint in enumerate(skin["joints"]):
            matrix = armature @ joints[joint] @ skin["inverse_bind"][j] @ skin["bind_shape"]
            place += weights[:, j][:, None, None] * matrix[None]
        positions = np.einsum("nij,nj->ni", place, np.c_[geometry["positions"], np.ones(len(geometry["positions"]))])
        normals = np.einsum("nij,nj->ni", place[:, :3, :3], geometry["normals"])
        parts.append(
            {
                "name": name,
                "link": link_of_piece(name, skin["joints"]),
                "positions": positions[:, :3],
                "normals": normals / np.linalg.norm(normals, axis=1)[:, None],
                "uvs": geometry["uvs"],
                "triangles": geometry["triangles"],
                "material": materials[geometry["material"]],
                "joints": skin["joints"],
                "weights": weights,
            }
        )
    return parts


def mesh_lines(name: str, parts: list[dict], indent: str = "  ") -> list[str]:
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
    assert np.abs(positions).max() < 32.767, f"{name}: a vertex past what millimetres in an Int16 reach"
    order = np.argsort(-bones, axis=1)[:, :2]
    weights = np.take_along_axis(bones, order, axis=1)
    split = np.round(weights[:, 0] / weights.sum(axis=1) * 255).astype(np.int64)
    print(f"{name}: {len(triangles)} triangles, {len(positions)} vertices")

    def b64(a: np.ndarray) -> str:
        return base64.b64encode(a.tobytes()).decode()

    return [
        f"{indent}{name}: {{",
        f"{indent}  positions: '{b64(np.round(positions * 1000).astype('<i2'))}',",
        f"{indent}  normals: '{b64(np.round(normals * 127).astype('i1'))}',",
        f"{indent}  uvs: '{b64(np.round(uvs * 65535).astype('<u2'))}',",
        f"{indent}  indices: '{b64(triangles.astype('<u2'))}',",
        f"{indent}  bones: '{b64(order.astype('u1'))}',",
        f"{indent}  split: '{b64(split.astype('u1'))}',",
        f"{indent}}},",
    ]


def link_of(name: str, skin_joints: list[str], parents: dict[str, str | None]) -> int | None:
    """Which link of the sim's spine a piece lies on: from the chain joint its own joint hangs on
    (walking up the rig) to the next; None for a piece of the head. A membrane skinned over many
    joints lies on the link they all hang on."""
    links = set()
    for joint in skin_joints:
        if joint in HEAD_JOINTS or name.startswith("Jaw"):
            return None
        if joint in NECK_LINK:
            links.add(NECK_LINK[joint])
            continue
        at: str | None = PAIRED.get(joint, joint)
        while at is not None and at not in CHAIN:
            at = parents[at]
            at = PAIRED.get(at, at) if at else at
        assert at is not None, f"{name}: {joint} hangs on no chain joint"
        links.add(CHAIN.index(at) + 1)  # link 0 runs from the eyes to Spine_1
    assert len(links) == 1, f"{name} spans links {links}"
    return links.pop()


def read_geometries(doc: ET.Element) -> dict[str, dict]:
    """Each geometry's corners welded into vertices (one per distinct position, normal and
    texture coordinate), with its triangles and their material symbol (a piece is one material)."""
    out = {}
    for geometry in doc.iter(NS + "geometry"):
        mesh = geometry.find(NS + "mesh")
        sources = {
            s.get("id"): np.array(s.find(NS + "float_array").text.split(), dtype=float).reshape(
                -1, int(s.find(NS + "technique_common/" + NS + "accessor").get("stride"))
            )
            for s in mesh.findall(NS + "source")
        }
        vertices = mesh.find(NS + "vertices")
        position_source = next(i.get("source")[1:] for i in vertices if i.get("semantic") == "POSITION")
        (tris,) = mesh.findall(NS + "triangles")
        inputs = {i.get("semantic"): (int(i.get("offset")), i.get("source")[1:]) for i in tris.findall(NS + "input")}
        stride = max(o for o, _ in inputs.values()) + 1
        p = np.array(tris.find(NS + "p").text.split(), dtype=int).reshape(-1, stride)
        normal_source = inputs["NORMAL"][1]
        uv_source = inputs["TEXCOORD"][1]
        # (position index, normal index, uv index) per corner, welded into vertices
        corners = np.c_[p[:, inputs["VERTEX"][0]], p[:, inputs["NORMAL"][0]], p[:, inputs["TEXCOORD"][0]]]
        keys, welded = np.unique(corners, axis=0, return_inverse=True)
        out[geometry.get("id")] = {
            "position_index": keys[:, 0],
            "positions": sources[position_source][keys[:, 0]],
            "normals": sources[normal_source][keys[:, 1]],
            "uvs": sources[uv_source][keys[:, 2]][:, :2] * [1, -1] + [0, 1],  # Collada's v runs up the image
            "triangles": welded.ravel().reshape(-1, 3),
            "material": tris.get("material"),
        }
    return out


def read_skins(doc: ET.Element) -> dict[str, dict]:
    """Each skin controller: its geometry, bind shape matrix, joints with their inverse bind
    matrices, and every vertex's weight on every joint (rows sum to 1)."""
    out = {}
    for controller in doc.iter(NS + "controller"):
        skin = controller.find(NS + "skin")
        sources = {s.get("id"): s for s in skin.findall(NS + "source")}
        joints = inverse_bind = None
        for inp in skin.find(NS + "joints"):
            source = sources[inp.get("source")[1:]]
            if inp.get("semantic") == "JOINT":
                joints = source.find(NS + "Name_array").text.split()
            if inp.get("semantic") == "INV_BIND_MATRIX":
                inverse_bind = np.array(source.find(NS + "float_array").text.split(), dtype=float).reshape(-1, 4, 4)
        vw = skin.find(NS + "vertex_weights")
        offsets = {i.get("semantic"): (int(i.get("offset")), i.get("source")[1:]) for i in vw.findall(NS + "input")}
        weight_values = np.array(sources[offsets["WEIGHT"][1]].find(NS + "float_array").text.split(), dtype=float)
        counts = np.array(vw.find(NS + "vcount").text.split(), dtype=int)
        v = np.array(vw.find(NS + "v").text.split(), dtype=int).reshape(-1, 2)
        weights = np.zeros((len(counts), len(joints)))
        at = 0
        for vertex, count in enumerate(counts):
            for joint, w in v[at : at + count]:
                weights[vertex, joint] += weight_values[w]
            at += count
        weights /= weights.sum(axis=1, keepdims=True)
        out[controller.get("id")] = {
            "geometry": skin.get("source")[1:],
            "bind_shape": np.array(skin.find(NS + "bind_shape_matrix").text.split(), dtype=float).reshape(4, 4),
            "joints": joints,
            "inverse_bind": inverse_bind,
            "weights": weights,
        }
    return out


def read_skeleton(doc: ET.Element) -> tuple[dict[str, np.ndarray], dict[str, str | None], np.ndarray]:
    """Every joint's bind pose in the rip's world (its node's matrix under its parents', the
    armature's included), its parent joint, and the armature's own matrix, which the pieces are
    instanced under."""
    joints: dict[str, np.ndarray] = {}
    parents: dict[str, str | None] = {}
    nodes: dict[str, np.ndarray] = {}

    def walk(node: ET.Element, above: np.ndarray, parent: str | None) -> None:
        matrix = node.find(NS + "matrix")
        world = above @ (np.array(matrix.text.split(), dtype=float).reshape(4, 4) if matrix is not None else np.eye(4))
        name = node.get("name") or node.get("id")
        nodes[name] = world
        if node.get("type") == "JOINT":
            joints[name] = world
            parents[name] = parent
            parent = name
        for child in node.findall(NS + "node"):
            walk(child, world, parent)

    for node in doc.find(NS + "library_visual_scenes/" + NS + "visual_scene").findall(NS + "node"):
        walk(node, np.eye(4), None)
    return joints, parents, nodes["Armature"]


if __name__ == "__main__":
    main(sys.argv[1])
