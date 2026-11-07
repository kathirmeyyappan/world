from __future__ import annotations

import json
import random
from types import SimpleNamespace

from bots.sniper_bot import Sniper, quarry
from common import Controls, Welcome, WorldState
from common.navigation import Route
from common.protocol import Player, decode
from common.world import EYE_HEIGHT, load_world_map

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
        return WorldState(message), Controls(SimpleNamespace(welcome=message, id="p1"))  # type: ignore[arg-type]

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


def test_sniper_wants_speedy_only_outdoors_with_a_long_way_ahead() -> None:
    """On a way from a tower floor to a keep's: no /speedy inside the tower, one as it steps out
    with the main disc still to cross, none once it's sped up or at the keep's door."""
    world = load_world_map()
    path = world.path(world.nodes_in(world.insides[0])[0], world.nodes_in(world.insides[-1])[0])
    assert path is not None
    outdoors = [k for k, i in enumerate(path) if i not in world.indoors]
    sniper = Sniper(world, (), "sniper-bot", random.Random(1))
    route = Route(world, path, 0)
    sniper.route = route

    def me_at(k: int, boost: float = 0) -> Player:
        """The sniper standing on the path's k-th node, with the route there."""
        route.next = k + 1
        node = world.nodes[path[k]]
        me = {**player("p1", "sniper-bot"), "pos": {"x": node.x, "y": node.y + EYE_HEIGHT, "z": node.z}, "boost": boost}
        message = decode(json.dumps({**welcome(), "players": [me]}))
        assert isinstance(message, Welcome)
        state = WorldState(message)
        assert state.me is not None
        return state.me

    assert not sniper.wants_speed(me_at(0)), "inside the tower: its stair is walked at the walk's own pace"
    assert sniper.wants_speed(me_at(outdoors[0])), "out of the door with the main disc to cross"
    assert not sniper.wants_speed(me_at(outdoors[0], boost=20)), "not while it's sped up"
    assert not sniper.wants_speed(me_at(outdoors[-1])), "at the keep's door: nothing left in the open"
