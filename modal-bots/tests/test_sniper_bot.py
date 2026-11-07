from __future__ import annotations

import json
import random
from types import SimpleNamespace

from bots.sniper_bot import Sniper, quarry
from common import Controls, Welcome, WorldState
from common.protocol import decode
from common.world import load_world_map

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
    assert quarry(state, ("SNIPER",)) == [], "targets that match its own name still leave it out"


def test_sniper_fires_only_on_a_target_in_range_or_once_hit() -> None:
    """Someone 35 m off in plain view is watched, not shot; 20 m off, or anyone after a hit on
    the sniper, is shot once the grace delay has passed."""
    world = load_world_map()

    def scene(target_x: float) -> tuple[WorldState, Controls]:
        rifle = {"id": "sniper", "locked": False, "fuel": None}
        me = {**player("p1", "sniper-bot"), "item": rifle, "scoped": True, "pos": {"x": 0, "y": 1.7, "z": 0}}
        kat = {**player("p2", "Kathir"), "pos": {"x": target_x, "y": 1.7, "z": 0}}
        message = decode(json.dumps({**welcome(), "players": [me, kat]}))
        assert isinstance(message, Welcome)
        return WorldState(message), Controls(SimpleNamespace(welcome=message, id="p1"))

    def shoots(state: WorldState, controls: Controls, sniper: Sniper, ticks: int = 20) -> bool:
        for _ in range(ticks):
            state.tick += 1
            sniper.decide(state, controls)
            if controls._shoot_once:
                return True
        return False

    far = Sniper(world, (), "sniper-bot", random.Random(1), seen=dict.fromkeys(("p1", "p2"), -(10**9)))
    state, controls = scene(35)
    assert not shoots(state, controls, far), "35 m off in plain view: watched, not shot"
    assert far.in_sight == "p2", "but kept in its sights"

    near = Sniper(world, (), "sniper-bot", random.Random(1), seen=dict.fromkeys(("p1", "p2"), -(10**9)))
    state, controls = scene(20)
    assert shoots(state, controls, near), "20 m off: shot"

    hit = Sniper(world, (), "sniper-bot", random.Random(1), seen=dict.fromkeys(("p1", "p2"), -(10**9)))
    state, controls = scene(35)
    hit.hurt_at = state.tick
    assert shoots(state, controls, hit), "35 m off but it has just been hit: shot back"
