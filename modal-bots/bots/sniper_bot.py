"""Climb to a lookout and snipe whoever comes into view.

How the sniper works. Every decision comes from the latest snapshot and the world map
(``common.world``); nothing is remembered about players between snapshots except who it is
already aiming at.

1. The rifle. It asks for one with ``/sniper`` when it joins and again whenever it isn't holding
   one (a rifle from chat lasts 45 s).

2. Who it's after, its quarry. Every living person, or with ``targets`` every living player (bots
   included) whose name contains one of them, in any case. Never itself.

3. Seeing. A quarry is in sight when nothing stands between the sniper's eye and the target's
   chest (``world.clear``, the same line a shot travels; cubes don't block). It checks the nearest
   few every SIGHT_EVERY ticks rather than everyone every tick, to stay cheap.

4. Shooting. With someone in sight it stops, scopes in and aims at their chest. It fires only
   once they've stayed in sight for a grace delay, a fresh random 3 to 10 ticks each time, so it
   never shoots the instant someone appears. After a shot it can't fire for COOLDOWN_SECONDS: it
   lets go of the scope and steps to a spot a few metres off (still watching), and each later
   shot waits out a new grace delay.

5. Moving. With nobody in sight it walks to a lookout, one of the map's high spots with a wide
   view (the tower's balconies, the terrace and the bridge), picked at random from the nearer
   ones, along ``world.path``: up the stair and over its rail where it has to. On open ground it
   weaves from side to side as it goes, so it's harder to hit. At the lookout it waits; after
   LOOKOUT_PATIENCE_SECONDS with nobody in sight it tries another.

6. Dying. Like every bot, a dead sniper stops sending input and lies there until the room drops
   its corpse, which ends the run.

It doesn't hunt anyone down, look for a better angle on someone it can't see, or dodge shots:
those are for smarter bots.
"""

from __future__ import annotations

import asyncio
import math
import random
import time
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any

from common import (
    Controls,
    Event,
    Player,
    RoomConnectionError,
    Route,
    Vec3,
    WorldMap,
    WorldState,
    connect,
    log_death,
    log_kill,
    log_message,
    run_input_loop,
)
from common.controls import TICK_RATE
from common.deployment import validate_duration
from common.world import EYE_HEIGHT

GRACE_TICKS = (3, 10)  # a target must stay in sight this long (inclusive range) before a shot
COOLDOWN_SECONDS = 3.0  # no shot for this long after one
SIGHT_EVERY = 3  # ticks between sight checks
SIGHT_CHECKS = 6  # the nearest this many quarry are checked for a clear line
CHEST_DROP = 0.5  # metres below the eye that it aims at: the middle of the body, an easy hit
LOOKOUT_CHOICES = 40  # a new lookout is one of this many nearest
LOOKOUT_PATIENCE_SECONDS = 8.0  # how long it waits at a lookout with nobody in sight
STEP_ASIDE = (2, 5)  # walking steps (map nodes, about a metre each) it moves off after a shot
WEAVE = 0.6  # how hard it weaves sideways on open ground, against 1 for walking forward
WEAVE_SECONDS = (0.4, 1.2)  # how long each weave lasts
RIFLE_RETRY_TICKS = TICK_RATE  # how long it waits for a /sniper to land before asking again


async def run_sniper_bot(
    room: str,
    name: str = "sniper-bot",
    seconds: float = 30,
    *,
    world: WorldMap,
    targets: tuple[str, ...] = (),
    lobby_url: str | None = None,
    direct_ws_url: str | None = None,
    spawn: Vec3 | None = None,
    avatar: str | None = None,
) -> dict[str, Any]:
    validate_duration(seconds)
    connect_started = time.monotonic()
    connection = await connect(
        lobby_url,
        room,
        name,
        direct_url=direct_ws_url,
        spawn=spawn,
        avatar=avatar,
    )
    connected_at = time.monotonic()
    state = WorldState(connection.welcome, connection.room)
    controls = Controls(connection)
    stop = asyncio.Event()
    inputs = asyncio.create_task(run_input_loop(controls, stop))
    sniper = Sniper(world, targets, name)
    completed = False
    rifle_asked = -RIFLE_RETRY_TICKS
    observed_until = connected_at

    log_message(name, "joined room", player_id=connection.id, room=connection.room, targets=list(targets))

    try:
        async with asyncio.timeout(seconds):
            while True:
                message = await connection.receive()
                state.apply(message)
                me = state.me
                if me is None:
                    break
                if isinstance(message, Event) and message.t == "kill":
                    victim = state.players.get(message.data["victim"])
                    shooter = state.players.get(message.data["shooter"])
                    if message.data["shooter"] == me.id:
                        sniper.kills += 1
                        log_kill(name, victim.name if victim else "?", item="sniper", headshot=message.data["headshot"])
                    elif message.data["victim"] == me.id:
                        log_death(name, shooter.name if shooter else "?", item=message.data["item"])
                if me.dead:
                    stop.set()  # as circle_bot: lie there until the room drops the corpse
                    continue
                if (me.item is None or me.item.id != "sniper") and state.tick - rifle_asked >= RIFLE_RETRY_TICKS:
                    rifle_asked = state.tick
                    await controls.command("sniper")
                sniper.decide(state, controls)
    except TimeoutError:
        completed = True
    except RoomConnectionError:
        pass
    finally:
        observed_until = time.monotonic()
        stop.set()
        inputs.cancel()
        with suppress(asyncio.CancelledError, RoomConnectionError):
            await inputs
        if connection.close_code is None:
            await connection.close(reason=f"{name} complete")

    observed_seconds = observed_until - connected_at
    log_message(name, "finished", completed=completed, shots=sniper.shots, kills=sniper.kills)
    return {
        "bot": name,
        "completed": completed,
        "observed_seconds": round(observed_seconds, 6),
        "connection_seconds": round(connected_at - connect_started, 6),
        "targets": list(targets),
        "shots": sniper.shots,
        "kills": sniper.kills,
        "last_tick": state.tick,
        "final_state": state.to_dict(),
    }


def quarry(state: WorldState, targets: tuple[str, ...]) -> list[Player]:
    """The living players the sniper goes after, nearest first: those whose names contain one of
    ``targets`` (any case), or every person when there are none."""
    me = state.me
    if me is None:
        return []
    wanted = [t.lower() for t in targets]

    def chosen(p: Player) -> bool:
        if p.id == me.id or p.dead:
            return False
        return any(w in p.name.lower() for w in wanted) if wanted else not p.bot

    return sorted(filter(chosen, state.players.values()), key=lambda p: _distance(me.pos, p.pos))


def chest(p: Player) -> Vec3:
    return Vec3(p.pos.x, p.pos.y - CHEST_DROP, p.pos.z)


@dataclass
class Sniper:
    """What the sniper is doing between snapshots; ``decide`` runs once per snapshot."""

    world: WorldMap
    targets: tuple[str, ...]
    name: str
    rng: random.Random = field(default_factory=random.Random)
    shots: int = 0
    kills: int = 0
    in_sight: str | None = None  # who it's aiming at, if anyone
    fire_at: int = 0  # the tick its grace delay on them ends
    ready_at: int = 0  # the tick its cooldown ends
    route: Route | None = None
    lookout: int | None = None  # where the route is going, when it's going to a lookout
    waiting_since: int | None = None  # when it got to its lookout
    weave: float = 0
    weave_until: int = 0
    _sighted: Player | None = None
    _next_sight_check: int = 0

    def decide(self, state: WorldState, controls: Controls) -> None:
        me = state.me
        assert me is not None
        tick = state.tick
        if tick >= self._next_sight_check:
            self._next_sight_check = tick + SIGHT_EVERY
            self._sighted = self._first_in_sight(state, me)
        target = state.players.get(self._sighted.id) if self._sighted else None
        if target is not None and target.dead:
            target = None
        if target is not None and tick >= self.ready_at:
            self._aim_and_fire(me, target, tick, controls)
            return
        controls.scope(False)
        if target is not None:
            # Cooling down: keep watching, and finish stepping aside if it was.
            controls.look_at(me.pos, chest(target))
            if self.route is None or not self.route.steer(me.pos, tick, controls):
                self.route = None
                controls.stop()
            return
        self.in_sight = None
        self._go_to_lookout(state, me, controls)

    def _first_in_sight(self, state: WorldState, me: Player) -> Player | None:
        """The nearest quarry with a clear line from the eye, the one it's aiming at first."""
        candidates = quarry(state, self.targets)[:SIGHT_CHECKS]
        candidates.sort(key=lambda p: p.id != self.in_sight)
        return next((p for p in candidates if self.world.clear(me.pos, chest(p))), None)

    def _aim_and_fire(self, me: Player, target: Player, tick: int, controls: Controls) -> None:
        controls.stop()
        controls.scope(True)
        controls.look_at(me.pos, chest(target))
        self.route = self.lookout = self.waiting_since = None
        if target.id != self.in_sight:
            self.in_sight = target.id
            self.fire_at = tick + self.rng.randint(*GRACE_TICKS)
            log_message(
                self.name, "target in sight", target=target.name, distance=round(_distance(me.pos, target.pos), 1)
            )
        holding = me.item is not None and me.item.id == "sniper"
        if tick < self.fire_at or not me.scoped or not holding:
            return
        controls.fire_once()
        self.shots += 1
        self.ready_at = tick + round(COOLDOWN_SECONDS * TICK_RATE)
        self.in_sight = None  # the next shot waits out a new grace delay
        log_message(self.name, "fired", target=target.name, distance=round(_distance(me.pos, target.pos), 1))
        self._step_aside(me, tick)

    def _step_aside(self, me: Player, tick: int) -> None:
        """Set off for a spot a few walking steps away, whichever way the map allows."""
        start = self.world.node_at(_feet(me))
        if start is None:
            return
        # Every walk of up to STEP_ASIDE[1] steps out from here, by where it ends.
        paths = {start: [start]}
        frontier = [start]
        for _ in range(STEP_ASIDE[1]):
            reached = []
            for i in frontier:
                for j in self.world.edges[i]:
                    if j not in paths:
                        paths[j] = [*paths[i], j]
                        reached.append(j)
            frontier = reached
        options = [path for path in paths.values() if len(path) > STEP_ASIDE[0]]
        if options:
            self.route = Route(self.world, self.rng.choice(options), tick)

    def _go_to_lookout(self, state: WorldState, me: Player, controls: Controls) -> None:
        tick = state.tick
        route = self.route
        if route is None or route.stuck(tick) or (route.done and self.lookout is None):
            self._plan(me, tick, keep=route is not None and route.stuck(tick))
            route = self.route
        if route is None:
            controls.stop()
            return
        if route.done:
            controls.stop()
            if self.waiting_since is None:
                self.waiting_since = tick
                log_message(self.name, "at lookout", node=route.goal)
            elif tick - self.waiting_since > LOOKOUT_PATIENCE_SECONDS * TICK_RATE:
                self._plan(me, tick, keep=False)
            return
        ahead = self.world.nodes[route.path[route.next]]
        controls.look_at(me.pos, Vec3(ahead.x, ahead.y + EYE_HEIGHT, ahead.z))
        route.steer(me.pos, tick, controls)
        self._weave(route, tick, controls)

    def _plan(self, me: Player, tick: int, *, keep: bool) -> None:
        """A route to the current lookout again (``keep``), or to a new one."""
        self.route = self.waiting_since = None
        start = self.world.node_at(_feet(me))
        if start is None or not self.world.lookouts:
            return
        if not keep or self.lookout is None:
            here = self.world.nodes[start]
            nearest = sorted(self.world.lookouts, key=lambda i: _distance(here, self.world.nodes[i]))
            others = [i for i in nearest[: LOOKOUT_CHOICES + 1] if i != self.lookout]
            self.lookout = self.rng.choice(others)
            log_message(self.name, "heading to lookout", node=self.lookout)
        path = self.world.path(start, self.lookout)
        if path is not None:
            self.route = Route(self.world, path, tick)

    def _weave(self, route: Route, tick: int, controls: Controls) -> None:
        """Turn some of the walk sideways, a random way for a random while, where the next spot is
        open floor (it walks to all eight neighbours), never on the stair or along a wall."""
        if route.done or len(self.world.edges[route.path[route.next]]) < 8:
            return
        if tick >= self.weave_until:
            self.weave = self.rng.choice((-WEAVE, 0, WEAVE))
            self.weave_until = tick + round(self.rng.uniform(*WEAVE_SECONDS) * TICK_RATE)
        forward, right = controls.forward, controls.right
        controls.move(forward=forward - right * self.weave, right=right + forward * self.weave)


def _feet(p: Player) -> Vec3:
    return Vec3(p.pos.x, p.pos.y - EYE_HEIGHT, p.pos.z)


def _distance(a: Vec3, b: Vec3) -> float:
    return math.dist((a.x, a.y, a.z), (b.x, b.y, b.z))
