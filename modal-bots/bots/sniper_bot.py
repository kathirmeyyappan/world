"""Live in Tung Tung Tower and snipe whoever comes into view.

How the sniper works. Every decision comes from the latest snapshot and the world map
(``common.world``); about players it remembers only when it first saw each one and who it's
aiming at.

1. The rifle. It asks for one with ``/sniper`` when it joins, and again until it's holding one.

2. Who it's after, its quarry. Every living person, or with ``targets`` every living player (bots
   included) whose name contains one of them, in any case. Never itself, and never anyone it saw
   join less than SPAWN_GRACE_SECONDS ago (whoever was there when it joined counts as settled).

3. Seeing. A quarry is in sight when nothing stands between the sniper's eye and the target's
   chest (``world.clear``, the same line a shot travels; cubes don't block). It checks the nearest
   few every SIGHT_EVERY ticks, nearest first, so whoever is closest gets its attention.

4. Shooting. With someone in sight it watches them, walking or not, and fires once they've stayed
   in sight for a grace delay, a fresh random 3 to 10 ticks each time (counted from the end of its
   cooldown for a later shot). For the shot itself it stops and scopes in. It leads them from a
   read a few snapshots old (AIM_LAG_TICKS, a reaction time): where they were then, carried on at
   the speed they had, so standing still or moving steadily is fatal and darting or jumping about
   is how to dodge. It aims at a random spot on their hitbox (the
   map's, for their avatar): the chest 35% of the time, the head 15%, and 50% just past their side
   (AIM_ZONES). After a hit it can't fire for HIT_COOLDOWN_SECONDS, after a miss only
   MISS_COOLDOWN_SECONDS. After a shot from FAR or further it steps to the nearest spot within
   HIDE_RADIUS that its target can't see, if there is one, and comes back out to its lookout when
   it can fire again.

5. Moving. Whatever ``spawn`` it's given, it starts on one of the tower's four inside floors
   (``world.tower_inside``), and from there it always has one spot it's walking to or standing
   at. It picks a place first, by PLACES: the tower most of the time, a building's roof often, the
   terrace and the ways up to it now and then. There it takes the nearest of a sample of lookouts
   that sees one of its quarry, or when none does (they're indoors, say) the one nearest the
   nearest of them, so it waits over where they are. It follows ``world.path`` there (up the stair
   and over its rail where it has to) and stays. It moves to another floor, the same way, when it
   has gone PATIENCE_SECONDS at its spot with nobody in sight, or when something hurts it.

6. Dying. Like every bot, a dead sniper stops sending input and lies there until the room drops
   its corpse, which ends the run.

It doesn't chase anyone or lead its shots: those are for smarter bots.
"""

from __future__ import annotations

import asyncio
import math
import random
import time
from collections import deque
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

GRACE_TICKS = (3, 10)  # a target must stay in sight this long (inclusive range) before a shot
HIT_COOLDOWN_SECONDS = 3.0  # no shot for this long after one that hit
MISS_COOLDOWN_SECONDS = 1.0  # or this long after one that missed
# Its read of a target is this many snapshots old (a reaction time, inclusive range): it leads them
# from where and how fast they were going then. Anyone standing or moving steadily (creeping along
# scoped, strafing in a line) is where it aims; anyone who changed direction or jumped since isn't.
AIM_LAG_TICKS = (4, 7)
FAR = 30.0  # metres: after a shot from at least this far it ducks out of sight while it reloads
HIDE_RADIUS = 4.0  # metres round itself it looks for a spot its target can't see
SPAWN_GRACE_SECONDS = 5.0  # a player it saw join is left alone this long
SIGHT_EVERY = 3  # ticks between sight checks
SIGHT_CHECKS = 6  # the nearest this many quarry are checked for a clear line
CHEST_DROP = 0.5  # metres below the eye that it checks the line of sight to: the middle of the body
# Where each shot is aimed, and how often: the chest, the head, or just past the body's side.
AIM_ZONES = {"chest": 0.35, "head": 0.15, "miss": 0.5}
AIM_SPREAD = 0.8  # how far off the axis a shot on the body goes, as a share of the hitbox radius
MISS_BY = (0.1, 0.6)  # metres past the hitbox's side that a near miss goes
SPOT_CHOICES = 40  # spots it weighs when picking where to shoot from
SPOT_TARGETS = 4  # the nearest this many quarry a spot is checked against
# Where it looks for its next spot, and how often (world.places): the tower, a building, or
# elsewhere (the terrace and the bridges and staircases up to it, which it crosses to go between).
PLACES = {"tower": 0.55, "building": 0.30, "elsewhere": 0.15}
PATIENCE_SECONDS = 6.0  # how long it stands at a spot with nobody in sight before changing floors
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
    sniper = Sniper(world, targets, name, rng, seen=dict.fromkeys(state.players, -(10**9)))
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
                if isinstance(message, Event) and message.t == "hit":
                    if message.data["victim"] == me.id:
                        sniper.hurt = True
                    elif message.data["shooter"] == me.id:
                        sniper.landed()
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


def aim_point(origin: Vec3, target: Vec3, hitbox: Hitbox, zone: str, rng: random.Random) -> Vec3:
    """A random spot to shoot at from ``origin``, in one of AIM_ZONES on the hitbox of a player
    whose eyes are at ``target``: up its axis for the zone's height, and sideways across the line
    of fire (within AIM_SPREAD of the radius on the body, past the radius for a miss)."""
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
    dx, dz = target.x - origin.x, target.z - origin.z
    across = math.hypot(dx, dz) or 1.0
    return Vec3(target.x + dz / across * side, target.y - EYE_HEIGHT + height, target.z - dx / across * side)


@dataclass
class Sniper:
    """What the sniper is doing between snapshots; ``decide`` runs once per snapshot."""

    world: WorldMap
    targets: tuple[str, ...]
    name: str
    rng: random.Random = field(default_factory=random.Random)
    seen: dict[str, int] = field(default_factory=dict)  # player id: tick it first saw them
    shots: int = 0
    kills: int = 0
    hurt: bool = False  # something hit it since it last picked a spot
    in_sight: str | None = None  # who it's watching, if anyone
    last_in_sight: int = 0  # the tick it last had anyone in sight
    fire_at: int = 0  # the tick it may shoot them: its grace delay's end
    ready_at: int = 0  # the tick its cooldown ends
    spot: int | None = None  # the lookout it's walking to or standing at
    cover: int | None = None  # a spot nearby out of its last target's sight, while it reloads there
    last_shot: int = 0  # the tick it last fired
    seen_at: deque[dict[str, Vec3]] = field(default_factory=lambda: deque(maxlen=AIM_LAG_TICKS[1] + 3))
    route: Route | None = None
    arrived_at: int | None = None  # when it got to its spot
    replan_at: int = 0  # the tick it may pick a spot or find a way again (a second after the last)
    _sighted: Player | None = None
    _next_sight_check: int = 0

    def decide(self, state: WorldState, controls: Controls) -> None:
        me = state.me
        assert me is not None
        tick = state.tick
        self.seen_at.append({p.id: p.pos for p in state.players.values()})
        quarry = self._quarry(state, tick)
        if tick >= self._next_sight_check:
            self._next_sight_check = tick + SIGHT_EVERY
            self._sighted = self._first_in_sight(me, quarry)
        target = state.players.get(self._sighted.id) if self._sighted else None
        if target is not None and target.dead:
            target = None
        if target is not None:
            self.last_in_sight = tick
        self._plan(me, quarry, tick)
        # Look first: the walk is relative to it.
        if target is not None:
            controls.look_at(me.pos, chest(target))
        elif self.route is not None and not self.route.done:
            controls.look_at(me.pos, self.route.ahead(me.pos))
        if self.route is None or not self.route.steer(me.pos, tick, controls):
            controls.stop()
            if self.route is not None and self.arrived_at is None:
                self.arrived_at = tick
        if target is None:
            self.in_sight = None
            controls.scope(False)
        else:
            self._fire_when_ready(me, target, tick, controls)

    def _quarry(self, state: WorldState, tick: int) -> list[Player]:
        """Its quarry, nearest first, leaving out anyone it first saw too recently."""
        settled = SPAWN_GRACE_SECONDS * TICK_RATE
        return [p for p in quarry(state, self.targets) if tick - self.seen.setdefault(p.id, tick) >= settled]

    def _first_in_sight(self, me: Player, quarry: list[Player]) -> Player | None:
        """The nearest quarry with a clear line from the eye, the one it's watching first."""
        candidates = quarry[:SIGHT_CHECKS]
        candidates.sort(key=lambda p: p.id != self.in_sight)
        return next((p for p in candidates if self.world.clear(me.pos, chest(p))), None)

    def _fire_when_ready(self, me: Player, target: Player, tick: int, controls: Controls) -> None:
        """Start the grace delay on someone new; once it's over, stop, scope in and shoot."""
        if target.id != self.in_sight:
            self.in_sight = target.id
            self.fire_at = max(tick, self.ready_at) + self.rng.randint(*GRACE_TICKS)
            log_message(
                self.name, "target in sight", target=target.name, distance=round(_distance(me.pos, target.pos), 1)
            )
        standing = self.route is None or self.route.done
        if tick < self.fire_at:
            # Scoped while it waits if it isn't walking, so the shot needn't wait for the scope.
            controls.scope(standing)
            return
        controls.stop()
        controls.scope(True)
        holding = me.item is not None and me.item.id == "sniper"
        if not me.scoped or not holding:
            return
        zone = self.rng.choices(list(AIM_ZONES), weights=list(AIM_ZONES.values()))[0]
        controls.look_at(
            me.pos, aim_point(me.pos, self._lead(target), self.world.hitbox(target.avatar), zone, self.rng)
        )
        controls.fire_once()
        self.shots += 1
        self.last_shot = tick
        self.ready_at = tick + round(MISS_COOLDOWN_SECONDS * TICK_RATE)  # until it hears it hit
        self.fire_at = self.ready_at + self.rng.randint(*GRACE_TICKS)
        distance = _distance(me.pos, target.pos)
        log_message(self.name, "fired", target=target.name, aim=zone, distance=round(distance, 1))
        if distance >= FAR:
            self._take_cover(me, target, tick)

    def _lead(self, target: Player) -> Vec3:
        """Where it thinks the target's eyes are now: where it saw them AIM_LAG_TICKS ago, carried on
        at the speed they were going then."""
        lag = self.rng.randint(*AIM_LAG_TICKS)
        if len(self.seen_at) < lag + 2:
            return target.pos
        then = self.seen_at[-lag].get(target.id, target.pos)
        before = self.seen_at[-lag - 2].get(target.id, then)
        ticks = lag - 1  # from the old read to the newest snapshot
        return Vec3(
            then.x + (then.x - before.x) / 2 * ticks,
            then.y + (then.y - before.y) / 2 * ticks,
            then.z + (then.z - before.z) / 2 * ticks,
        )

    def landed(self) -> None:
        """Its last shot hit: wait out the longer cooldown from when it was fired."""
        self.ready_at = max(self.ready_at, self.last_shot + round(HIT_COOLDOWN_SECONDS * TICK_RATE))
        self.fire_at = self.ready_at + self.rng.randint(*GRACE_TICKS)

    def _take_cover(self, me: Player, target: Player, tick: int) -> None:
        """Step to the nearest spot within HIDE_RADIUS that the target can't see, if there is one,
        and wait there until it can fire again."""
        hidden = [
            i
            for i in self.world.nodes_near(_feet(me), HIDE_RADIUS)
            if not self.world.clear(_eye(self.world.nodes[i]), chest(target))
        ]
        start = self.world.node_at(_feet(me))
        if not hidden or start is None:
            return
        cover = min(hidden, key=lambda i: _distance(me.pos, _eye(self.world.nodes[i])))
        path = self.world.path(start, cover)
        if path is not None:
            self.cover, self.route, self.arrived_at = cover, Route(self.world, path, tick), None

    def _plan(self, me: Player, quarry: list[Player], tick: int) -> None:
        """Pick a spot when it has none, or another floor's when it has waited there too long with
        nobody in sight or been hurt; find a way again when it has none or is stuck."""
        if self.cover is not None:
            # Hiding while it reloads; once it can fire, back out to its spot for another look.
            if tick >= self.ready_at:
                self.cover = None
                self._route_to_spot(me, tick)
            return
        if tick < self.replan_at:
            return
        idle = self.arrived_at is not None and tick - max(self.arrived_at, self.last_in_sight) > (
            PATIENCE_SECONDS * TICK_RATE
        )
        if self.spot is None or idle or self.hurt:
            self._pick_spot(me, quarry, tick)
        elif self.route is None or self.route.stuck(tick):
            self._route_to_spot(me, tick)

    def _pick_spot(self, me: Player, quarry: list[Player], tick: int) -> None:
        """In a place picked by PLACES, the nearest of a sample of lookouts that sees one of its
        quarry, or with none that does the one nearest the nearest of them (a random one with nobody
        to go after), on a floor other than its spot's (any floor the first time)."""
        places = [p for p in PLACES if self.world.places.get(p)] or list(self.world.places)
        place = self.rng.choices(places, weights=[PLACES.get(p, 1.0) for p in places])[0]
        pool = list(self.world.places[place])
        floor = self._floor(self.spot) if self.spot is not None else None
        options = [i for i in pool if self._floor(i) != floor] or pool
        sample = self.rng.sample(options, min(SPOT_CHOICES, len(options)))
        wanted = quarry[:SPOT_TARGETS]
        seeing = [i for i in sample if any(self.world.clear(_eye(self.world.nodes[i]), chest(p)) for p in wanted)]
        if seeing:
            self.spot = min(seeing, key=lambda i: _distance(me.pos, _eye(self.world.nodes[i])))
        elif wanted:
            self.spot = min(sample, key=lambda i: _distance(wanted[0].pos, _eye(self.world.nodes[i])))
        else:
            self.spot = self.rng.choice(sample)
        self.hurt = False
        log_message(self.name, "heading to a lookout", node=self.spot, floor=self._floor(self.spot), sees=bool(seeing))
        self._route_to_spot(me, tick)

    def _floor(self, node: int) -> int:
        return round(self.world.nodes[node].y / FLOOR) * FLOOR

    def _route_to_spot(self, me: Player, tick: int) -> None:
        """A way from here to its spot; with none, it'll pick another spot."""
        self.route = self.arrived_at = None
        self.replan_at = tick + TICK_RATE
        start = self.world.node_at(_feet(me))
        path = self.world.path(start, self.spot) if start is not None and self.spot is not None else None
        if path is None:
            self.spot = None
        else:
            self.route = Route(self.world, path, tick)


def _eye(feet: Vec3) -> Vec3:
    return Vec3(feet.x, feet.y + EYE_HEIGHT, feet.z)


def _feet(p: Player) -> Vec3:
    return Vec3(p.pos.x, p.pos.y - EYE_HEIGHT, p.pos.z)


def _distance(a: Vec3, b: Vec3) -> float:
    return math.dist((a.x, a.y, a.z), (b.x, b.y, b.z))
