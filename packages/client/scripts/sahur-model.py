"""Builds render/avatars/sahurModel.ts from a sculpt of Tung Tung Tung Sahur (an STL, z up, facing -y,
standing on a display base).

    pip install numpy trimesh fast-simplification networkx scipy
    python packages/client/scripts/sahur-model.py path/to/tungtungtungsahur.stl

It drops the base, decimates to TRIANGLES (the avatar budget: a few times Elizabeth's 1,200), turns the
sculpt into the avatar's frame (y up, facing +z, feet at 0, HEIGHT tall), splits it into the parts the
avatar moves on their own (the body with its left arm, the right arm, the bat, each leg), and writes
each part's vertices in millimetres relative to its pivot, its triangles, and a cavity shade per vertex
(how far the surface there curves in: mouth lines, eye sockets, the sides of the nose), base64-encoded.
Skin colour and normals are worked out when the avatar is built. Eyeballs are not taken from the
sculpt; the avatar adds its own at EYES.

The right arm is a ridge the sculpt runs down the log's right-front, from the shoulder to the hand on
the bat, one skin with the log. It is cut off along the crease where it meets the log (the faces that
stand ARM_RIDGE out past the log's round at their height), and the seam is closed on both sides: the
arm gets a flat underside at the crease, the log a socket SOCKET_DEPTH into it (its floor the same
triangles, so nothing lies in one plane with the arm hanging), and the arm can be raised on its own.
`split_arm` and `emit` only need numpy: `scripts/` tools apply them to a model already written.
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path

import numpy as np

TRIANGLES = 2500
HEIGHT = 3.2  # metres, feet to the top of the head
BASE_TOP = 8.05  # sculpt units: the top of the display base the figure stands on
HIP_Z = 44.5  # sculpt units: faces below this (and not the bat) are legs
HAND = np.array([-10.5, 5.0, 44.0])  # sculpt units: the right hand, where it grips the bat
BAT_TIP = np.array([-15.0, -22.0, 10.0])
EYES = [np.array([-7.0, 2.4, 104.5]), np.array([7.0, 2.4, 104.5])]  # eyeball centres
EYE_RADIUS = 4.0
# The right arm, in the avatar's frame: the degrees round the log it hangs in (from the front, toward
# the right; the elbow sticks out behind), the heights it runs between, and how far its ridge stands
# out past the log's round.
ARM_SECTOR = (25.0, 165.0)
LEFT_ARM_SECTOR = (-165.0, -50.0)
ARM_HEIGHTS = (0.85, 2.25)
ARM_RIDGE = 0.025  # metres
HAND_REACH = 0.2  # metres from the hand: the fist and the bat's end in it go with the arm whatever else they're near
SOCKET_DEPTH = 0.02  # metres into the log the socket under the arm goes
BAND = 0.08  # metres up and down of a height the log's round is fitted over
ROUND_BIN = 10.0  # degrees: the round is fitted through the outermost vertex in each
OUT = Path(__file__).resolve().parents[1] / "src/render/avatars/sahurModel.ts"


def main(stl: str) -> None:
    import fast_simplification
    import trimesh

    mesh = trimesh.load(stl)
    v, f = mesh.vertices, mesh.faces
    mesh = trimesh.Trimesh(v, f[~(v[f][:, :, 2] <= BASE_TOP).all(axis=1)], process=True)
    mesh.remove_unreferenced_vertices()
    v, f = fast_simplification.simplify(
        mesh.vertices.astype(np.float32), mesh.faces.astype(np.int64), target_reduction=1 - TRIANGLES / len(mesh.faces)
    )
    mesh = trimesh.Trimesh(v, f, process=True)
    v, f = mesh.vertices, mesh.faces
    centroids = v[f].mean(axis=1)
    cavity = cavities(mesh)

    # The bat: whatever stays joined to its tip once the faces round the gripping hand are set aside.
    near_hand = np.linalg.norm(centroids - HAND, axis=1) < 5
    rest = trimesh.Trimesh(v, f[~near_hand], process=False)
    parts = trimesh.graph.connected_component_labels(rest.face_adjacency, node_count=len(rest.faces))
    tip_face = int(np.argmin(np.linalg.norm(rest.triangles_center - BAT_TIP, axis=1)))
    bat = np.zeros(len(f), bool)
    bat[np.flatnonzero(~near_hand)[parts == parts[tip_face]]] = True
    low = (centroids[:, 2] < HIP_Z) & ~bat
    # The sculpt's right is -x; the avatar's right is +x (it faces +z with x to its right).
    leg_r = low & (centroids[:, 0] < 0)
    leg_l = low & (centroids[:, 0] >= 0)
    body = ~(bat | leg_l | leg_r)

    scale = HEIGHT / (v[:, 2].max() - BASE_TOP)
    centre_y = 15.0  # the log's centre line, front to back, in sculpt units

    def avatar(p: np.ndarray) -> np.ndarray:
        """Sculpt units to avatar metres: y up, facing +z, feet at 0, centred on the log."""
        p = np.atleast_2d(p)
        return np.stack([-p[:, 0], p[:, 2] - BASE_TOP, -(p[:, 1] - centre_y)], axis=1) * scale

    points = avatar(v)
    hip_y = float(avatar(np.array([0, 0, HIP_Z]))[0, 1])
    pivots = {
        "body": np.array([0, hip_y, 0]),
        "bat": avatar(HAND)[0],
        "legL": np.array([float(points[f[leg_l]].reshape(-1, 3).mean(axis=0)[0]), hip_y, 0]),
        "legR": np.array([float(points[f[leg_r]].reshape(-1, 3).mean(axis=0)[0]), hip_y, 0]),
    }
    points, cavity, body_faces, leg_r_faces, arm_faces, pivots["armR"] = split_arm(
        points, cavity, f[body], f[leg_r], avatar(HAND)[0]
    )
    # Mirroring x also swaps right- for left-handed axes, so the sculpt's winding already faces out in
    # Babylon's left-handed frame.
    emit(
        {"body": body_faces, "armR": arm_faces, "bat": f[bat], "legL": f[leg_l], "legR": leg_r_faces},
        points,
        cavity,
        pivots,
        hip_y,
        avatar(HAND)[0],
        [avatar(e)[0] for e in EYES],
        EYE_RADIUS * scale,
    )


def split_arm(
    points: np.ndarray, cavity: np.ndarray, body: np.ndarray, leg: np.ndarray, hand: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """The points and cavities with the rim and floor of the socket added, then the body's faces as
    the log (its socket under the arm), the right leg's without the bottom of the fist (which the hip plane cut
    through), the right arm (with its underside closed), and the arm's pivot: the top of the seam,
    where it leaves the shoulder."""
    pool = np.vstack([body, leg])
    of_leg = np.arange(len(pool)) >= len(body)
    candidate = np.zeros(len(pool), bool)
    candidate[: len(body)] = ridge_faces(points, body)
    candidate |= np.linalg.norm(points[pool].mean(axis=1) - hand, axis=1) < HAND_REACH
    arm = components(pool, candidate)[0]
    for hole in components(pool, ~arm)[1:]:
        # A crease in the arm that doesn't stand out is still arm; the leg, cut off at the hip, isn't.
        if hole.sum() < arm.sum():
            arm |= hole
    loops = [flatten(points, loop) for loop in seam_loops(pool, arm)]
    # Each seam vertex twice more: on the rim again, for the arm's underside and the socket's wall
    # (their own vertices, so the crease stays a sharp edge rather than a smoothed one, and a face
    # that happens to lie in one plane with the skin shares no normals with it), and SOCKET_DEPTH
    # toward the log's axis for the socket's floor.
    seam = sorted({k for loop, _ in loops for k in loop})
    rim = {k: len(points) + i for i, k in enumerate(seam)}
    floor = {k: len(points) + len(seam) + i for i, k in enumerate(seam)}
    points = np.vstack([points, points[seam], points[seam] - radial(points[seam]) * SOCKET_DEPTH])
    cavity = np.concatenate([cavity, cavity[seam], cavity[seam]])
    body_fill, arm_fill = [], []
    for loop, flat in loops:
        for t in cap(loop, flat):
            lid = (rim[t[0]], rim[t[1]], rim[t[2]])
            arm_fill.append(oriented(points, lid, -radial(points[list(lid)].mean(axis=0))))
            sunk = (floor[t[0]], floor[t[1]], floor[t[2]])
            body_fill.append(oriented(points, sunk, radial(points[list(sunk)].mean(axis=0))))
        # The socket's wall, facing in across it: in the loop laid flat (counter-clockwise), that's to
        # the left along each edge.
        for i in range(len(loop)):
            a, b = loop[i], loop[(i + 1) % len(loop)]
            step = flat[(i + 1) % len(loop)] - flat[i]
            mid = points[[a, b]].mean(axis=0)
            angle = np.arctan2(mid[0], mid[2])
            inward = -step[1] * np.array([np.cos(angle), 0, -np.sin(angle)]) + step[0] * np.array([0, 1, 0])
            body_fill.append(oriented(points, (rim[a], rim[b], floor[b]), inward))
            body_fill.append(oriented(points, (rim[a], floor[b], floor[a]), inward))
    top = points[seam][points[seam][:, 1] > points[seam][:, 1].max() - 0.06].mean(axis=0)
    fill = np.array(body_fill, dtype=pool.dtype).reshape(-1, 3)
    body_faces = np.vstack([pool[~arm & ~of_leg], fill])
    arm_faces = np.vstack([pool[arm], np.array(arm_fill, dtype=pool.dtype).reshape(-1, 3)])
    print(
        f"arm: {int(arm.sum())} faces cut along {len(loops)} seam(s); {len(arm_fill)} close it, {len(fill)} make the socket"
    )
    return points, cavity, body_faces, pool[~arm & of_leg], arm_faces, top


def radial(p: np.ndarray) -> np.ndarray:
    """Unit vectors straight out from the log's axis (x and z 0) at points: (n, 3) or (3,)."""
    flat = np.atleast_2d(p) * np.array([1, 0, 1])
    out = flat / np.linalg.norm(flat, axis=1, keepdims=True)
    return out if p.ndim == 2 else out[0]


def ridge_faces(points: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """The faces that stand ARM_RIDGE out past the log's round, in the arm's sector and heights. The
    round at a height is a circle fitted to the log's skin near it, outside both arms' sectors."""
    centroids = points[faces].mean(axis=1)
    angles = np.degrees(np.arctan2(points[:, 0], points[:, 2]))
    used = np.zeros(len(points), bool)
    used[faces] = True
    clear = used & ~in_sector(angles, ARM_SECTOR) & ~in_sector(angles, LEFT_ARM_SECTOR)
    rounds: dict[int, tuple[float, float, float]] = {}
    arm = np.zeros(len(faces), bool)
    for i, (x, y, z) in enumerate(centroids):
        a = np.degrees(np.arctan2(x, z))
        if not (ARM_HEIGHTS[0] < y < ARM_HEIGHTS[1] and in_sector(np.array([a]), ARM_SECTOR)[0]):
            continue
        key = round(y * 100)
        if key not in rounds:
            band = clear & (np.abs(points[:, 1] - y) < BAND)
            rounds[key] = log_round(points[band][:, [0, 2]], angles[band])
        cx, cz, r = rounds[key]
        arm[i] = np.hypot(x - cx, z - cz) - r > ARM_RIDGE
    return arm


def in_sector(angles: np.ndarray, sector: tuple[float, float]) -> np.ndarray:
    return (angles >= sector[0]) & (angles <= sector[1])


def log_round(xz: np.ndarray, angles: np.ndarray) -> tuple[float, float, float]:
    """The log's skin at a height as a circle (centre x, centre z, radius): a least-squares fit through
    the outermost vertex in each ROUND_BIN degrees round the axis, so what's inside the log (the hip
    cavity, the top of the legs) doesn't pull the round in."""
    radius = np.hypot(xz[:, 0], xz[:, 1])
    outer = []
    for b in np.unique(np.floor(angles / ROUND_BIN)):
        in_bin = np.flatnonzero(np.floor(angles / ROUND_BIN) == b)
        outer.append(in_bin[np.argmax(radius[in_bin])])
    rim = xz[outer]
    a = np.column_stack([2 * rim[:, 0], 2 * rim[:, 1], np.ones(len(rim))])
    (cx, cz, k), *_ = np.linalg.lstsq(a, (rim**2).sum(axis=1), rcond=None)
    return float(cx), float(cz), float(np.sqrt(max(k + cx * cx + cz * cz, 0)))


def edges_of(faces: np.ndarray) -> np.ndarray:
    """Each face's three edges, lowest vertex first: (faces, 3, 2)."""
    e = np.stack([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]], axis=1)
    return np.sort(e, axis=2)


def components(faces: np.ndarray, mask: np.ndarray) -> list[np.ndarray]:
    """The faces in `mask` grouped by what they're joined to edge to edge, biggest group first, each
    as a mask over `faces`."""
    picked = np.flatnonzero(mask)
    neighbours: dict[int, set[int]] = {int(k): set() for k in picked}
    by_edge: dict[tuple[int, int], list[int]] = {}
    for k in picked:
        for e in edges_of(faces[[k]])[0]:
            by_edge.setdefault((int(e[0]), int(e[1])), []).append(int(k))
    for shared in by_edge.values():
        for a in shared:
            for b in shared:
                if a != b:
                    neighbours[a].add(b)
    seen: set[int] = set()
    groups: list[np.ndarray] = []
    for start in neighbours:
        if start in seen:
            continue
        group, stack = set(), [start]
        while stack:
            k = stack.pop()
            if k in group:
                continue
            group.add(k)
            stack.extend(neighbours[k] - group)
        seen |= group
        out = np.zeros(len(faces), bool)
        out[list(group)] = True
        groups.append(out)
    return sorted(groups, key=lambda g: -int(g.sum()))


def seam_loops(faces: np.ndarray, arm: np.ndarray) -> list[list[int]]:
    """The seam between the arm and the rest as closed loops of vertices: the edges with one face on
    each side, chained end to end. The arm must not reach an open edge of `faces`, or its seam
    can't close."""
    by_edge: dict[tuple[int, int], list[bool]] = {}
    for k, es in enumerate(edges_of(faces)):
        for e in es:
            by_edge.setdefault((int(e[0]), int(e[1])), []).append(bool(arm[k]))
    seam = [e for e, sides in by_edge.items() if len(sides) == 2 and sides[0] != sides[1]]
    links: dict[int, list[int]] = {}
    for a, b in seam:
        links.setdefault(a, []).append(b)
        links.setdefault(b, []).append(a)
    loops: list[list[int]] = []
    left = {e for e in seam}
    while left:
        a, b = next(iter(left))
        loop, prev, cur = [a], a, b
        left.discard((a, b))
        while cur != a:
            loop.append(cur)
            nxt = next((n for n in links[cur] if n != prev and (min(cur, n), max(cur, n)) in left), None)
            if nxt is None:
                break
            left.discard((min(cur, nxt), max(cur, nxt)))
            prev, cur = cur, nxt
        loops.append(loop)
    return loops


def flatten(points: np.ndarray, loop: list[int]) -> tuple[list[int], np.ndarray]:
    """The seam loop laid flat round the log (distance round it, height) and turned counter-clockwise
    there: it lies on the log, so laid flat it's a simple polygon."""
    p = points[loop]
    around = np.unwrap(np.arctan2(p[:, 0], p[:, 2])) * np.hypot(p[:, 0], p[:, 2]).mean()
    flat = np.column_stack([around, p[:, 1]])
    return (loop[::-1], flat[::-1]) if polygon_area(flat) < 0 else (list(loop), flat)


def cap(loop: list[int], flat: np.ndarray) -> list[tuple[int, int, int]]:
    """A counter-clockwise loop laid flat, closed with triangles between its own vertices (ear
    clipping)."""
    order = list(range(len(loop)))
    tris: list[tuple[int, int, int]] = []
    while len(order) > 3:
        for k in range(len(order)):
            a, b, c = order[k - 1], order[k], order[(k + 1) % len(order)]
            if polygon_area(flat[[a, b, c]]) <= 0:
                continue
            if any(inside(flat[d], flat[a], flat[b], flat[c]) for d in order if d not in (a, b, c)):
                continue
            tris.append((loop[a], loop[b], loop[c]))
            del order[k]
            break
        else:
            # A kink the projection folded over: clip the sharpest corner regardless and carry on.
            corners = [
                polygon_area(flat[[order[i - 1], order[i], order[(i + 1) % len(order)]]]) for i in range(len(order))
            ]
            k = int(np.argmin(corners))
            tris.append((loop[order[k - 1]], loop[order[k]], loop[order[(k + 1) % len(order)]]))
            del order[k]
    tris.append((loop[order[0]], loop[order[1]], loop[order[2]]))
    return [t for t in tris if len(set(t)) == 3]


def polygon_area(xy: np.ndarray) -> float:
    """Signed (shoelace) area: positive counter-clockwise."""
    x, y = xy[:, 0], xy[:, 1]
    return float(0.5 * (x @ np.roll(y, -1) - y @ np.roll(x, -1)))


def inside(d: np.ndarray, a: np.ndarray, b: np.ndarray, c: np.ndarray) -> bool:
    """Whether `d` is strictly inside the counter-clockwise triangle a, b, c."""
    return all(polygon_area(np.array([u, v, d])) > 1e-12 for u, v in ((a, b), (b, c), (c, a)))


def oriented(points: np.ndarray, tri: tuple[int, int, int], direction: np.ndarray) -> tuple[int, int, int]:
    """`tri` wound to face along `direction`. The sculpt's winding is mirrored into a left-handed
    frame, so a face reads outward where its cross product points in."""
    a, b, c = points[list(tri)]
    return tri if float(np.cross(b - a, c - a) @ direction) < 0 else (tri[0], tri[2], tri[1])


def emit(
    faces: dict[str, np.ndarray],
    points: np.ndarray,
    cavity: np.ndarray,
    pivots: dict[str, np.ndarray],
    hip_y: float,
    hand: np.ndarray,
    eyes: list[np.ndarray],
    eye_radius: float,
) -> None:
    """Writes the model: each part's faces (into `points`, metres in the avatar's frame) relative to its
    pivot."""
    lines = [
        "// Generated by packages/client/scripts/sahur-model.py from a sculpt of Tung Tung Tung Sahur; don't edit.",
        "// Each part: vertices in millimetres relative to its pivot (Int16 x, y, z), triangles (Uint16),",
        "// both base64. Pivots, the hand and the eyes are in metres in the avatar's frame (feet at 0, facing +z).",
        "export const SAHUR_MODEL = {",
        f"  height: {HEIGHT},",
        f"  hip: {hip_y:.4f},",
        f"  hand: [{', '.join(f'{c:.4f}' for c in hand)}],",
        f"  eyes: [{', '.join('[' + ', '.join(f'{c:.4f}' for c in e) + ']' for e in eyes)}],",
        f"  eyeRadius: {eye_radius:.4f},",
        "  parts: {",
    ]
    for name, part in faces.items():
        used, inverse = np.unique(part, return_inverse=True)
        positions = np.round((points[used] - pivots[name]) * 1000).astype("<i2")
        triangles = inverse.reshape(-1, 3).astype("<u2")
        shades = np.round(cavity[used] * 255).astype(np.uint8)
        lines += [
            f"    {name}: {{",
            f"      pivot: [{', '.join(f'{c:.4f}' for c in pivots[name])}],",
            f"      positions: '{base64.b64encode(positions.tobytes()).decode()}',",
            f"      indices: '{base64.b64encode(triangles.tobytes()).decode()}',",
            f"      cavity: '{base64.b64encode(shades.tobytes()).decode()}',",
            "    },",
        ]
        print(f"{name}: {len(part)} triangles, {len(used)} vertices")
    lines += ["  },", "} as const;", ""]
    OUT.write_text("\n".join(lines))
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


def cavities(mesh: object) -> np.ndarray:
    """0 to 1 per vertex: how much its neighbours rise above its tangent plane, i.e. how deep a crease
    it sits in. Flat and bulging surface is 0."""
    normals = mesh.vertex_normals  # type: ignore[attr-defined]
    vertices = mesh.vertices  # type: ignore[attr-defined]
    out = np.zeros(len(vertices))
    for i, neighbours in enumerate(mesh.vertex_neighbors):  # type: ignore[attr-defined]
        if not neighbours:
            continue
        d = vertices[neighbours] - vertices[i]
        lengths = np.linalg.norm(d, axis=1) + 1e-9
        out[i] = np.mean((d @ normals[i]) / lengths)
    return np.clip(out / 0.35, 0, 1)


if __name__ == "__main__":
    main(sys.argv[1])
