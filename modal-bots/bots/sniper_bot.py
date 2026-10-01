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
   once they've stayed in sight for a grace delay, a fresh random 5 to 25 ticks each time (counted
   from the end of its cooldown for a later shot), so it never shoots the instant someone appears.
   Each shot is aimed afresh at a random spot on their hitbox (the map's, for their avatar): the
   chest 40% of the time, the head 20%, and 40% just past their side, a near miss (AIM_ZONES).
   Aim is at the snapshot, so a target that moves in the meantime can still turn a hit into a
   miss or the other way round. After a shot it can't fire for COOLDOWN_SECONDS, and it holds
   still, scoped, while it waits.

5. Moving. It lives in the tower: whatever ``spawn`` it's given, it starts out at a random spot
   on one of the tower's four inside floors (``world.tower_inside``). With nobody in sight it walks
   to a lookout, one of the map's high spots with a wide view (the tower's balconies, the terrace
   and the bridge), on a floor picked at random and then a spot on it at random, along
   ``world.path``: up the stair and over its rail where it has to. Once there it stays, until it
   makes a kill: then it picks a lookout on another floor and moves there, so it never camps one
   spot for good.

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
from common.world import EYE_HEIGHT, Hitbox

GRACE_TICKS = (5, 25)  # a target must stay in sight this long (inclusive range) before a shot
COOLDOWN_SECONDS = 3.0  # no shot for this long after one
SIGHT_EVERY = 3  # ticks between sight checks
SIGHT_CHECKS = 6  # the nearest this many quarry are checked for a clear line
CHEST_DROP = 0.5  # metres below the eye that it checks the line of sight to: the middle of the body
# Where each shot is aimed, and how often: the chest, the head, or just past the body's side.
AIM_ZONES = {"chest": 0.4, "head": 0.2, "miss": 0.4}
AIM_SPREAD = 0.8  # how far off the axis a shot on the body goes, as a share of the hitbox radius
MISS_BY = (0.1, 0.6)  # metres past the hitbox's side that a near miss goes
FLOOR = 10  # metres: lookouts closer in height than this are one floor (the bridge's deck and rail)
START_MARGIN = 1.5  # metres it starts in from the edge of a tower floor's open disc
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
    rng = random.Random()
    # Its home is the tower, so it starts inside it wherever it was called from (``spawn`` unused).
    start = rng.choice(world.tower_inside).random_point(START_MARGIN, rng)
    connect_started = time.monotonic()
    connection = await connect(
        lobby_url,
        room,
        name,
        direct_url=direct_ws_url,
        spawn=start,
        avatar=avatar,
    )
    connected_at = time.monotonic()
    state = WorldState(connection.welcome, connection.room)
    controls = Controls(connection)
    stop = asyncio.Event()
    inputs = asyncio.create_task(run_input_loop(controls, stop))
    sniper = Sniper(world, targets, name, rng)
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
                        sniper.move_floors()
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


def aim_point(origin: Vec3, target: Player, hitbox: Hitbox, zone: str, rng: random.Random) -> Vec3:
    """A random spot to shoot at from ``origin``, in one of AIM_ZONES on the target's hitbox: up
    its axis for the zone's height, and sideways across the line of fire (within AIM_SPREAD of the
    radius on the body, past the radius for a miss)."""
    neck = hitbox.top - hitbox.head  # where the head band starts, above the feet
    if zone == "head":
        height = rng.uniform(neck + 0.05, hitbox.top - 0.05)
        side = rng.uniform(-AIM_SPREAD, AIM_SPREAD) * hitbox.radius
    elif zone == "chest":
        height = rng.uniform(0.5 * neck, neck - 0.1)
        side = rng.uniform(-AIM_SPREAD, AIM_SPREAD) * hitbox.radius
    else:
        height = rng.uniform(0.3 * neck, hitbox.top)
        side = rng.choice((-1, 1)) * (hitbox.radius + rng.uniform(*MISS_BY))
    dx, dz = target.pos.x - origin.x, target.pos.z - origin.z
    across = math.hypot(dx, dz) or 1.0
    return Vec3(
        target.pos.x + dz / across * side, target.pos.y - EYE_HEIGHT + height, target.pos.z - dx / across * side
    )


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
    fire_at: int = 0  # the tick it may shoot them: its grace delay's end
    ready_at: int = 0  # the tick its cooldown ends
    lookout: int | None = None  # the node it's walking to, or standing on
    route: Route | None = None
    _sighted: Player | None = None
    _next_sight_check: int = 0
    _plan_at: int = 0  # the tick it may look for a way again after finding none

    def decide(self, state: WorldState, controls: Controls) -> None:
        me = state.me
        assert me is not None
        tick = state.tick
        if tick >= self._next_sight_check:
            self._next_sight_check = tick + SIGHT_EVERY
            self._sighted = self._first_in_sight(state, me)
        target = state.players.get(self._sighted.id) if self._sighted else None
        if target is not None and not target.dead:
            self._aim_and_fire(me, target, tick, controls)
            return
        self.in_sight = None
        controls.scope(False)
        self._walk_to_lookout(me, tick, controls)

    def _first_in_sight(self, state: WorldState, me: Player) -> Player | None:
        """The nearest quarry with a clear line from the eye, the one it's aiming at first."""
        candidates = quarry(state, self.targets)[:SIGHT_CHECKS]
        candidates.sort(key=lambda p: p.id != self.in_sight)
        return next((p for p in candidates if self.world.clear(me.pos, chest(p))), None)

    def _aim_and_fire(self, me: Player, target: Player, tick: int, controls: Controls) -> None:
        controls.stop()
        controls.scope(True)
        controls.look_at(me.pos, chest(target))
        if target.id != self.in_sight:
            self.in_sight = target.id
            self.fire_at = max(tick, self.ready_at) + self.rng.randint(*GRACE_TICKS)
            log_message(
                self.name, "target in sight", target=target.name, distance=round(_distance(me.pos, target.pos), 1)
            )
        holding = me.item is not None and me.item.id == "sniper"
        if tick < self.fire_at or not me.scoped or not holding:
            return
        zone = self.rng.choices(list(AIM_ZONES), weights=list(AIM_ZONES.values()))[0]
        controls.look_at(me.pos, aim_point(me.pos, target, self.world.hitbox(target.avatar), zone, self.rng))
        controls.fire_once()
        self.shots += 1
        self.ready_at = tick + round(COOLDOWN_SECONDS * TICK_RATE)
        self.fire_at = self.ready_at + self.rng.randint(*GRACE_TICKS)
        log_message(self.name, "fired", target=target.name, aim=zone, distance=round(_distance(me.pos, target.pos), 1))

    def _walk_to_lookout(self, me: Player, tick: int, controls: Controls) -> None:
        """Head for its lookout (picking one the first time), or stand there once arrived."""
        if (self.route is None and tick >= self._plan_at) or (self.route is not None and self.route.stuck(tick)):
            self._plan(me, tick)
        if self.route is None or self.route.done:
            controls.stop()
            return
        controls.look_at(me.pos, self.route.ahead(me.pos))
        self.route.steer(me.pos, tick, controls)

    def move_floors(self) -> int:
        """Pick a lookout on a random floor other than the one it's on (any floor the first time),
        and set off for it on the next snapshot with nobody in sight. Returns the lookout."""
        floor = self._floor(self.lookout) if self.lookout is not None else None
        floors = sorted({self._floor(i) for i in self.world.lookouts})
        new = self.rng.choice([f for f in floors if f != floor] or floors)
        self.lookout = self.rng.choice([i for i in self.world.lookouts if self._floor(i) == new])
        self.route = None
        log_message(self.name, "heading to lookout", floor=new, node=self.lookout)
        return self.lookout

    def _floor(self, node: int) -> int:
        return round(self.world.nodes[node].y / FLOOR) * FLOOR

    def _plan(self, me: Player, tick: int) -> None:
        """A route from here to its lookout, choosing one if it has none yet. With no way there,
        it tries again in a second."""
        self.route = None
        self._plan_at = tick + TICK_RATE
        start = self.world.node_at(_feet(me))
        if start is None or not self.world.lookouts:
            return
        lookout = self.lookout if self.lookout is not None else self.move_floors()
        path = self.world.path(start, lookout)
        if path is not None:
            self.route = Route(self.world, path, tick)


def _feet(p: Player) -> Vec3:
    return Vec3(p.pos.x, p.pos.y - EYE_HEIGHT, p.pos.z)


def _distance(a: Vec3, b: Vec3) -> float:
    return math.dist((a.x, a.y, a.z), (b.x, b.y, b.z))
