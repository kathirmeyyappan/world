from __future__ import annotations

from typing import Any


def player(
    player_id: str = "p1",
    name: str = "observer",
    *,
    hearts: float = 10,
    dead: bool = False,
) -> dict[str, Any]:
    return {
        "id": player_id,
        "name": name,
        "color": "#64b5f6",
        "pos": {"x": 1, "y": 1.7, "z": 2},
        "vy": 0,
        "yaw": 0,
        "pitch": 0,
        "lastSeq": 0,
        "reading": None,
        "boost": 0,
        "item": None,
        "scoped": False,
        "firing": False,
        "avatar": "standard",
        "avatarLocked": False,
        "hearts": hearts,
        "kills": 0,
        "bot": False,
        "dead": dead,
    }


def cube(cube_id: str = "aws") -> dict[str, Any]:
    return {
        "id": cube_id,
        "x": 5,
        "y": 3,
        "z": -4,
        "rx": 0.1,
        "ry": 0.2,
    }


def welcome() -> dict[str, Any]:
    return {
        "t": "welcome",
        "id": "p1",
        "room": "opaque-modal-session",
        "tick": 42,
        "players": [player()],
        "cubes": [cube()],
    }
