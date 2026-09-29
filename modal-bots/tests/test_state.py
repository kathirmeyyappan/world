from __future__ import annotations

import json

from common import Welcome, WorldState
from common.protocol import Message, decode

from tests.helpers import cube, player, welcome


def message(payload: dict[str, object]) -> Message:
    return decode(json.dumps(payload))


def test_reduces_snapshots_and_roster_events() -> None:
    initial = message(welcome())
    assert isinstance(initial, Welcome)
    state = WorldState(initial, "public-code")

    state.apply(message({"t": "join", "p": player("p2", "alice")}))
    assert set(state.players) == {"p1", "p2"}

    state.apply(
        message(
            {
                "t": "snap",
                "tick": 43,
                "players": [player("p1"), player("p2", "alice")],
                "cubes": [cube("notion")],
            }
        )
    )
    assert state.tick == 43
    assert set(state.cubes) == {"notion"}

    state.apply(message({"t": "leave", "id": "p2", "name": "alice"}))
    assert set(state.players) == {"p1"}
    assert state.requested_room == "public-code"
    assert state.session_room == "opaque-modal-session"


def test_applies_combat_events_before_next_snapshot() -> None:
    initial = message(welcome())
    assert isinstance(initial, Welcome)
    state = WorldState(initial, "public-code")

    state.apply(
        message(
            {
                "t": "hit",
                "shooter": "p2",
                "victim": "p1",
                "damage": 10,
                "headshot": True,
                "hearts": 0,
            }
        )
    )
    assert state.me is not None
    assert state.me.hearts == 0
    assert state.me.dead

    report = state.to_dict()
    assert report["requested_room"] == "public-code"
    assert report["players"][0]["dead"] is True
