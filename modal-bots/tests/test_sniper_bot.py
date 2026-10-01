from __future__ import annotations

import json

from bots.sniper_bot import quarry
from common import Welcome, WorldState
from common.protocol import decode

from tests.helpers import player, welcome


def test_quarry_is_every_living_person_or_whoever_the_names_pick() -> None:
    message = decode(
        json.dumps(
            {
                **welcome(),
                "players": [
                    player("p1", "sniper-bot"),
                    player("p2", "Kathir"),
                    player("p3", "bob", dead=True),
                    {**player("p4", "circle-bot"), "bot": True},
                    player("p5", "katie"),
                ],
            }
        )
    )
    assert isinstance(message, Welcome)
    state = WorldState(message)

    assert {p.name for p in quarry(state, ())} == {"Kathir", "katie"}, "people only, never itself or the dead"
    assert {p.name for p in quarry(state, ("KAT",))} == {"Kathir", "katie"}, "any part of a name, any case"
    assert {p.name for p in quarry(state, ("circle", "bob"))} == {"circle-bot"}, "a named bot, but not the dead"
