"""Small typed view of the game's JSON protocol."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, fields
from typing import Any, Mapping, TypeAlias, TypeVar


class ProtocolError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class Vec3:
    x: float
    y: float
    z: float


@dataclass(frozen=True, slots=True)
class Item:
    id: str
    left: float
    permanent: bool
    fuel: float | None


@dataclass(frozen=True, slots=True)
class Player:
    id: str
    name: str
    color: str
    pos: Vec3
    vy: float
    yaw: float
    pitch: float
    last_seq: int
    reading: str | None
    boost: float
    item: Item | None
    scoped: bool
    firing: bool
    avatar: str
    avatar_left: float | None
    hearts: float
    kills: int
    dead: bool


@dataclass(frozen=True, slots=True)
class Cube:
    id: str
    x: float
    y: float
    z: float
    rx: float
    ry: float


@dataclass(frozen=True, slots=True)
class Welcome:
    id: str
    room: str
    tick: int
    players: tuple[Player, ...]
    cubes: tuple[Cube, ...]
    t: str = "welcome"


@dataclass(frozen=True, slots=True)
class Snapshot:
    tick: int
    players: tuple[Player, ...]
    cubes: tuple[Cube, ...]
    t: str = "snap"


@dataclass(frozen=True, slots=True)
class Event:
    """Any non-snapshot event, including future server message types."""

    t: str
    data: Mapping[str, Any]


Message: TypeAlias = Welcome | Snapshot | Event


def decode(payload: str | bytes) -> Message:
    try:
        data = json.loads(payload, parse_constant=_invalid_constant)
        if not isinstance(data, dict) or not isinstance(data.get("t"), str):
            raise ProtocolError("message must be an object with a string 't'")
        if data["t"] == "welcome":
            return Welcome(
                id=data["id"],
                room=data["room"],
                tick=data["tick"],
                players=tuple(player(value) for value in data["players"]),
                cubes=tuple(cube(value) for value in data["cubes"]),
            )
        if data["t"] == "snap":
            return Snapshot(
                tick=data["tick"],
                players=tuple(player(value) for value in data["players"]),
                cubes=tuple(cube(value) for value in data["cubes"]),
            )
        return Event(t=data["t"], data=data)
    except ProtocolError:
        raise
    except (json.JSONDecodeError, UnicodeDecodeError, KeyError, TypeError, ValueError) as exc:
        raise ProtocolError("malformed server message") from exc


T = TypeVar("T")


def _pick(cls: type[T], data: Mapping[str, Any]) -> T:
    """Build a dataclass from the wire fields it knows about. Extra fields the server adds
    later are ignored; missing ones still fail, so a real protocol break is still caught."""
    return cls(**{f.name: data[f.name] for f in fields(cls)})  # type: ignore[arg-type]


def player(data: Mapping[str, Any]) -> Player:
    item_data = data["item"]
    return Player(
        id=data["id"],
        name=data["name"],
        color=data["color"],
        pos=_pick(Vec3, data["pos"]),
        vy=data["vy"],
        yaw=data["yaw"],
        pitch=data["pitch"],
        last_seq=data["lastSeq"],
        reading=data["reading"],
        boost=data["boost"],
        item=None if item_data is None else _pick(Item, item_data),
        scoped=data["scoped"],
        firing=data["firing"],
        avatar=data["avatar"],
        avatar_left=data["avatarLeft"],
        hearts=data["hearts"],
        kills=data["kills"],
        dead=data["dead"],
    )


def cube(data: Mapping[str, Any]) -> Cube:
    return _pick(Cube, data)


def to_dict(value: Player | Cube) -> dict[str, Any]:
    return asdict(value)


def _invalid_constant(value: str) -> None:
    raise ProtocolError(f"invalid JSON constant {value}")
