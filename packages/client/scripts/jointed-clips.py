"""Builds render/avatars/marioClips.ts: how Mario moves, as Super Mario 64 moved him.

    pip install numpy pillow fast_simplification
    python packages/client/scripts/jointed-clips.py path/to/mario64.glb

The source is the Nostalgia64 Project's "Mario - Super Mario 64 (Rigged, Animated)" on Sketchfab,
downloaded as a .glb: the game's own Mario on the game's own skeleton (a pelvis, a torso, a head,
and an arm and a leg a side of three bones each, every bone running along its own +x) with the
game's animations, 30 frames a second. This takes the handful a body on foot needs (CLIPS) and
writes each for a jointed body's skeleton (render/avatars/Jointed.ts), which stands in a T-pose
with every bone unturned.

A bone is carried over by how far it has turned in the world from where it would be in that
T-pose. The source has no T-pose, but it has an A-pose (standing, arms down and out), so each of
its bones' T-pose is its A-pose turned the short way to where the T-pose points that bone (an arm
straight out to its side, a leg straight down). The jointed body's chest takes the source's torso
and its spine half of it. The hips ride where the source's pelvis does, measured from standing
straight and in leg lengths, so a longer-legged body bobs as far for its size, and each frame is
then stood on the ground: lifted or dropped so the foot bearing the weight is as far off the floor
as the source's is, the two bodies' legs not being cut alike. A stride is turned round to start as
its right foot comes down, which is where the footsteps count a stride from.

Each clip is written as its frames' hips (x, y, z in thousandths of a leg, Int16) and bones'
turns (x, y, z, w quaternions, Int16 over 32767) in BONES' order, base64.
"""

from __future__ import annotations

import base64
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from glb import accessor, read_glb

CLIENT = Path(__file__).resolve().parents[1]
FPS = 30

# The jointed body's bones that a clip turns, in the order a frame lists them, each with its parent
# and the source's bone it takes (its node's name in the file).
BONES: tuple[tuple[str, str | None, str], ...] = (
    ("hips", None, "002-rotate_36"),
    ("spine", "hips", "000-offset.001_35"),
    ("chest", "spine", "000-offset.001_35"),
    ("head", "chest", "000-offset.002_17"),
    ("armL", "chest", "000-offset.003_24"),
    ("forearmL", "armL", "000-offset.004_23"),
    ("handL", "forearmL", "000-offset.005_21"),
    ("armR", "chest", "000-offset.006_33"),
    ("forearmR", "armR", "000-offset.007_32"),
    ("handR", "forearmR", "000-offset.008_30"),
    ("legL", "hips", "000-offset.009_39"),
    ("shinL", "legL", "000-offset.010_38"),
    ("footL", "shinL", "000-offset.011_37"),
    ("legR", "hips", "000-offset.012_46"),
    ("shinR", "legR", "000-offset.013_45"),
    ("footR", "shinR", "000-offset.014_44"),
)
# Where the T-pose points the bones the A-pose holds another way, in the source's frame (y up,
# facing +z, its left at +x).
T_POSE = {
    "armL": (1, 0, 0),
    "forearmL": (1, 0, 0),
    "handL": (1, 0, 0),
    "armR": (-1, 0, 0),
    "forearmR": (-1, 0, 0),
    "handR": (-1, 0, 0),
    "legL": (0, -1, 0),
    "shinL": (0, -1, 0),
    "legR": (0, -1, 0),
    "shinR": (0, -1, 0),
}
A_POSE = "14 - A pose"


@dataclass(frozen=True)
class Clip:
    source: str  # the animation's name in the file
    first: int  # its frames of the source's, first to last
    last: int
    every: int = 1  # every how many of them are kept
    stride: bool = False  # a walk's cycle: turned round to start as the right foot comes down


CLIPS = {
    "idle": Clip("197 - Idle head center", 0, 29),
    "walk": Clip("72 - Walking", 0, 75, 2, stride=True),
    "run": Clip("114/115 - Running/Running (unused)", 0, 71, 2, stride=True),
    "jump": Clip("77/78 - Single jump/Land from single jump", 0, 12),
    "fall": Clip("86/87 - General fall/General land", 4, 4),
    "land": Clip("77/78 - Single jump/Land from single jump", 24, 37),
    "leap": Clip("19 - Fast longjump", 0, 22),
}


def turn(q: np.ndarray) -> np.ndarray:
    """A quaternion (x, y, z, w) as a rotation matrix."""
    x, y, z, w = q
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def quaternion(m: np.ndarray) -> np.ndarray:
    """A rotation matrix as a quaternion (x, y, z, w), w positive."""
    w = np.sqrt(max(0.0, 1 + m[0, 0] + m[1, 1] + m[2, 2])) / 2
    x = np.sqrt(max(0.0, 1 + m[0, 0] - m[1, 1] - m[2, 2])) / 2
    y = np.sqrt(max(0.0, 1 - m[0, 0] + m[1, 1] - m[2, 2])) / 2
    z = np.sqrt(max(0.0, 1 - m[0, 0] - m[1, 1] + m[2, 2])) / 2
    x, y, z = np.copysign(x, m[2, 1] - m[1, 2]), np.copysign(y, m[0, 2] - m[2, 0]), np.copysign(z, m[1, 0] - m[0, 1])
    q = np.array([x, y, z, w])
    return q / np.linalg.norm(q)


def shortest(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """The rotation that takes unit vector `a` to unit vector `b` the short way."""
    v = np.cross(a, b)
    c = float(a @ b)
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + k + k @ k / (1 + c)


def halfway(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """The rotation halfway between two."""
    qa, qb = quaternion(a), quaternion(b)
    if qa @ qb < 0:
        qb = -qb
    return turn((qa + qb) / np.linalg.norm(qa + qb))


class Source:
    """The file's skeleton and animations: where each node is in the world at a frame of one."""

    def __init__(self, path: str) -> None:
        self.doc, self.blob = read_glb(Path(path).read_bytes())
        self.nodes = self.doc["nodes"]
        self.parent = {c: i for i, n in enumerate(self.nodes) for c in n.get("children", [])}
        self.named = {n.get("name"): i for i, n in enumerate(self.nodes)}
        self.animations = {a["name"]: a for a in self.doc["animations"]}
        self.keys: dict[str, dict[int, dict[str, tuple[np.ndarray, np.ndarray, str]]]] = {}

    def channels(self, name: str) -> dict[int, dict[str, tuple[np.ndarray, np.ndarray, str]]]:
        if name not in self.keys:
            animation = self.animations[name]
            out: dict[int, dict[str, tuple[np.ndarray, np.ndarray, str]]] = {}
            for channel in animation["channels"]:
                sampler = animation["samplers"][channel["sampler"]]
                out.setdefault(channel["target"]["node"], {})[channel["target"]["path"]] = (
                    accessor(self.doc, self.blob, sampler["input"]).ravel().astype(float),
                    accessor(self.doc, self.blob, sampler["output"]).astype(float),
                    sampler.get("interpolation", "LINEAR"),
                )
            self.keys[name] = out
        return self.keys[name]

    def pose(self, name: str, time: float) -> dict[str, np.ndarray]:
        """Each of the body's bones in the world (4x4, its turn's columns unit) `time` into an animation."""
        channels = self.channels(name)
        world: dict[int, np.ndarray] = {}

        def local(i: int) -> np.ndarray:
            node = self.nodes[i]
            if "matrix" in node:
                return np.array(node["matrix"], float).reshape(4, 4).T
            at = {
                "translation": np.array(node.get("translation", [0, 0, 0]), float),
                "rotation": np.array(node.get("rotation", [0, 0, 0, 1]), float),
                "scale": np.array(node.get("scale", [1, 1, 1]), float),
            }
            for path, (times, values, how) in channels.get(i, {}).items():
                k = int(np.clip(np.searchsorted(times, time, side="right") - 1, 0, len(times) - 1))
                k2 = min(len(times) - 1, k + 1)
                f = 0.0 if times[k2] == times[k] or how == "STEP" else float(np.clip((time - times[k]) / (times[k2] - times[k]), 0, 1))
                a, b = values[k], values[k2]
                if path == "rotation" and a @ b < 0:
                    b = -b
                at[path] = a + (b - a) * f
            m = np.eye(4)
            m[:3, :3] = turn(at["rotation"] / np.linalg.norm(at["rotation"])) * at["scale"]
            m[:3, 3] = at["translation"]
            return m

        def placed(i: int) -> np.ndarray:
            if i not in world:
                world[i] = placed(self.parent[i]) @ local(i) if i in self.parent else local(i)
            return world[i]

        out = {}
        for bone, _, node in BONES:
            m = placed(self.named[node]).copy()
            m[:3, :3] /= np.linalg.norm(m[:3, :3], axis=0)
            out[bone] = m
        return out


def main(glb: str) -> None:
    source = Source(glb)
    model = (CLIENT / "src/render/avatars/marioModel.ts").read_text()
    pivot = {
        bone: np.array([float(v) for v in at.split(",")])
        for bone, at in re.findall(r"^    (\w+): \[([^\]]+)\],$", model, re.M)
    }
    thigh = float(np.linalg.norm(pivot["shinR"] - pivot["legR"]))
    shin = float(np.linalg.norm(pivot["footR"] - pivot["shinR"]))

    # Each source bone's turn in the T-pose, and what a leg and standing on the ground are to it.
    stood = source.pose(A_POSE, 0)
    reference = {}
    for bone, _, _ in BONES:
        was = stood[bone][:3, :3]
        reference[bone] = shortest(was[:, 0], np.array(T_POSE[bone], float)) @ was if bone in T_POSE else was
    leg = float(np.linalg.norm(stood["footR"][:3, 3] - stood["legR"][:3, 3]))
    ground = float(stood["footR"][1, 3])
    scale = (thigh + shin) / leg

    # The source's left is +x and the jointed body's right is +x: a mirror in x, under which a
    # turn R is M R M.
    mirror = np.diag([-1.0, 1, 1])
    parents = {bone: parent for bone, parent, _ in BONES}

    def frame(name: str, k: int) -> tuple[np.ndarray, np.ndarray, tuple[float, float]]:
        """The hips (in legs, from standing straight) and each bone's turn in its parent, a frame
        of an animation; and how far off the ground the source's ankles are, left and right."""
        pose = source.pose(name, k / FPS)
        world = {bone: mirror @ pose[bone][:3, :3] @ reference[bone].T @ mirror for bone, _, _ in BONES}
        world["spine"] = halfway(world["hips"], world["chest"])
        hips = mirror @ (pose["hips"][:3, 3] - stood["hips"][:3, 3]) * scale
        # Stood on the ground: the foot bearing the weight as far off it as the source's is.
        wanted, error = [], []
        for side in ("L", "R"):
            ankle = (
                pivot["hips"]
                + hips
                + world["hips"] @ (pivot[f"leg{side}"] - pivot["hips"])
                + world[f"leg{side}"] @ np.array([0, -thigh, 0])
                + world[f"shin{side}"] @ np.array([0, -shin, 0])
            )
            off = (pose[f"foot{side}"][1, 3] - ground) * scale
            wanted.append(off)
            error.append(pivot[f"foot{side}"][1] + off - ankle[1])
        weight = np.exp(-np.array(wanted) / 0.04)
        hips[1] += float(weight @ np.array(error) / weight.sum())
        turns = np.array([quaternion(world[parents[b]].T @ world[b] if parents[b] else world[b]) for b, _, _ in BONES])
        return hips / (thigh + shin), turns, (wanted[0], wanted[1])

    lines = [
        "// Generated by packages/client/scripts/jointed-clips.py from the Nostalgia64 Project's Mario - Super Mario 64"
        " (Rigged, Animated) (Sketchfab); don't edit.",
        "// Super Mario 64's own animations, carried onto a jointed body's skeleton (Jointed.ts). Each clip is its",
        "// frames, `fps` a second: `hips` where the hips are from standing straight (Int16 x, y, z in thousandths of a",
        "// leg's length) and `turns` each bone's turn in its parent, in `bones`' order (Int16 x, y, z, w over 32767);",
        "// both base64. A stride starts as the right foot comes down, and its left comes down halfway.",
        "export const MARIO_CLIPS = {",
        f"  bones: [{', '.join(repr(b) for b, _, _ in BONES)}],",
    ]
    for name, clip in CLIPS.items():
        frames = [frame(clip.source, k) for k in range(clip.first, clip.last + 1)]
        if clip.stride:
            # The right foot comes down on the first frame it's on the ground after being off it.
            right = np.array([f[2][1] for f in frames])
            down = right < 0.02
            start = next(k for k in range(len(frames)) if down[k] and not down[k - 1])
            frames = frames[start:] + frames[:start]
            left = np.array([f[2][0] for f in frames]) < 0.02
            other = next(k for k in range(1, len(frames)) if left[k] and not left[k - 1])
            print(f"{name}: right foot down on source frame {clip.first + start}, left {other / len(frames):.2f} of the way on")
        frames = frames[:: clip.every]
        turns = np.array([f[1] for f in frames])
        for k in range(1, len(turns)):  # each bone's turn on the same side of the sphere as its last
            flip = np.sum(turns[k] * turns[k - 1], axis=1) < 0
            turns[k][flip] *= -1
        hips = np.array([f[0] for f in frames])
        lines += [
            f"  {name}: {{",
            f"    fps: {FPS / clip.every:g},",
            f"    frames: {len(frames)},",
            f"    hips: '{base64.b64encode(np.round(hips * 1000).astype('<i2').tobytes()).decode()}',",
            f"    turns: '{base64.b64encode(np.round(turns * 32767).astype('<i2').tobytes()).decode()}',",
            "  },",
        ]
        print(f"{name}: {len(frames)} frames, hips {hips.min(axis=0).round(2)} to {hips.max(axis=0).round(2)} legs")
    lines += ["} as const;", ""]
    out = CLIENT / "src/render/avatars/marioClips.ts"
    out.write_text("\n".join(lines))
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main(sys.argv[1])
