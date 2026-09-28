from __future__ import annotations

import json

import pytest

from common.protocol import Event, ProtocolError, Snapshot, Welcome, decode, to_dict
from tests.helpers import cube, player, welcome


def test_decodes_world_messages() -> None:
    joined = decode(json.dumps(welcome()))
    assert isinstance(joined, Welcome)
    assert joined.id == "p1"
    assert joined.room == "opaque-modal-session"
    assert joined.players[0].pos.y == 1.7
    assert joined.cubes[0].id == "aws"

    snapshot = decode(
        json.dumps(
            {"t": "snap", "tick": 43, "players": [player()], "cubes": [cube()]}
        )
    )
    assert isinstance(snapshot, Snapshot)
    assert snapshot.tick == 43
    assert to_dict(snapshot.players[0])["last_seq"] == 0


@pytest.mark.parametrize("kind", ["join", "leave", "chat", "hit", "kill", "future"])
def test_non_snapshot_messages_are_events(kind: str) -> None:
    message = decode(json.dumps({"t": kind, "value": 1}))
    assert isinstance(message, Event)
    assert message.t == kind
    assert message.data["value"] == 1


@pytest.mark.parametrize(
    "payload",
    [
        "not json",
        "[]",
        "{}",
        '{"t":"snap","tick":1,"players":[]}',
        '{"t":"pong","at":NaN}',
    ],
)
def test_rejects_malformed_messages(payload: str) -> None:
    with pytest.raises(ProtocolError):
        decode(payload)
