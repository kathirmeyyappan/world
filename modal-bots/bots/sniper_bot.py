"""Live in Tung Tung Tower and snipe whoever comes into view.

How the sniper works. Every decision comes from the latest snapshot and the world map
(``common.world``); about players it remembers only when it first saw each one and who it's
aiming at.

1. The rifle. It asks for one with ``/sniper`` when it joins and again whenever it isn't holding
   one (a rifle from chat lasts 45 s).

2. Who it's after, its quarry. Every living person, or with ``targets`` every living player (bots
   included) whose name contains one of them, in any case. Never itself, and never anyone it saw
   join less than SPAWN_GRACE_SECONDS ago (whoever was there when it joined counts as settled).

3. Seeing. A quarry is in sight when nothing stands between the sniper's eye and the target's
   chest (``world.clear``, the same line a shot travels; cubes don't block). It checks the nearest
   few every SIGHT_EVERY ticks, nearest first, so whoever is closest gets its attention.

4. Shooting. With someone in sight it stops, scopes in and aims at their chest. It fires only
   once they've stayed in sight for a grace delay, a fresh random 5 to 25 ticks each time (counted
   from the end of its cooldown for a later shot), so it never shoots the instant someone appears.
   Each shot is aimed afresh at a random spot on their hitbox (the map's, for their avatar): the
   chest 40% of the time, the head 20%, and 40% just past their side, a near miss (AIM_ZONES).
   Aim is at the snapshot, so a target that moves in the meantime can still turn a hit into a
   miss or the other way round. After a shot it can't fire for COOLDOWN_SECONDS, and it holds
   still, scoped, while it waits.

5. Moving. Whatever ``spawn`` it's given, it starts on one of the tower's four inside floors
   (``world.tower_inside``). With nobody in sight it picks one spot to shoot from and walks there
   along ``world.path`` (up the stair and over its rail where it has to), without second thoughts
   on the way:
   - with quarry within NEARBY of it, a spot close by (NEAR_SEARCH) that sees one of them;
   - otherwise the nearest of a sample of lookouts (balconies, the terrace, the bridge) that sees
     one of its quarry;
   - and with no such spot, a lookout on another floor, to try there.
   It picks again only when it has stood at its spot for PATIENCE_SECONDS with nobody in sight,
   when someone new comes near, after a kill, or when it can't find a way to the spot; never
   more than once a second.

6. Dying. Like every bot, a dead sniper stops sending input and lies there until the room drops
   its corpse, which ends the run.

It doesn't chase anyone, lead its shots, or dodge: those are for smarter bots.
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
COOLDOWN_SECONDS = 5.0  # no shot for this long after one
SPAWN_GRACE_SECONDS = 10.0  # a player it saw join is left alone this long
SIGHT_EVERY = 3  # ticks between sight checks
SIGHT_CHECKS = 6  # the nearest this many quarry are checked for a clear line
CHEST_DROP = 0.5  # metres below the eye that it checks the line of sight to: the middle of the body
# Where each shot is aimed, and how often: the chest, the head, or just past the body's side.
AIM_ZONES = {"chest": 0.4, "head": 0.2, "miss": 0.4}
AIM_SPREAD = 0.8  # how far off the axis a shot on the body goes, as a share of the hitbox radius
MISS_BY = (0.1, 0.6)  # metres past the hitbox's side that a near miss goes
NEARBY = 25.0  # metres: quarry this close decide where it goes next
NEAR_SEARCH = 12.0  # metres round itself it looks for a spot that sees someone nearby
SPOT_CHOICES = 40  # spots it weighs when picking where to shoot from
SPOT_TARGETS = 4  # the nearest this many quarry a spot is checked against
PATIENCE_SECONDS = 6.0  # how long it stands at a spot with nobody in sight before moving on
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
                        sniper.spot = None  # pick somewhere to shoot from afresh
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
    seen: dict[str, int] = field(default_factory=dict)  # player id: tick it first saw them
    shots: int = 0
    kills: int = 0
    in_sight: str | None = None  # who it's aiming at, if anyone
    fire_at: int = 0  # the tick it may shoot them: its grace delay's end
    ready_at: int = 0  # the tick its cooldown ends
    spot: int | None = None  # the node it's walking to or standing on, to shoot from
    route: Route | None = None
    arrived_at: int | None = None  # when it got to its spot
    near_ids: frozenset[str] = frozenset()  # who was nearby when it picked its spot
    replan_at: int = 0  # the tick it may pick a spot or find a way again (a second after the last)
    _sighted: Player | None = None
    _next_sight_check: int = 0

    def decide(self, state: WorldState, controls: Controls) -> None:
        me = state.me
        assert me is not None
        tick = state.tick
        quarry = self._quarry(state, tick)
        if tick >= self._next_sight_check:
            self._next_sight_check = tick + SIGHT_EVERY
            self._sighted = self._first_in_sight(me, quarry)
        target = state.players.get(self._sighted.id) if self._sighted else None
        if target is not None and not target.dead:
            self._aim_and_fire(me, target, tick, controls)
            return
        self.in_sight = None
        controls.scope(False)
        self._reposition(me, quarry, tick, controls)

    def _quarry(self, state: WorldState, tick: int) -> list[Player]:
        """Its quarry, nearest first, leaving out anyone it first saw too recently."""
        settled = SPAWN_GRACE_SECONDS * TICK_RATE
        return [p for p in quarry(state, self.targets) if tick - self.seen.setdefault(p.id, tick) >= settled]

    def _first_in_sight(self, me: Player, quarry: list[Player]) -> Player | None:
        """The nearest quarry with a clear line from the eye, the one it's aiming at first."""
        candidates = quarry[:SIGHT_CHECKS]
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

    def _reposition(self, me: Player, quarry: list[Player], tick: int, controls: Controls) -> None:
        """Walk to its spot, picking one when it has none, has waited there long enough, or someone
        new has come near; or stand at it."""
        near = frozenset(p.id for p in quarry if _distance(me.pos, p.pos) < NEARBY)
        waited = self.arrived_at is not None and tick - self.arrived_at > PATIENCE_SECONDS * TICK_RATE
        if tick >= self.replan_at:
            if self.spot is None or waited or near - self.near_ids:
                self._pick_spot(me, quarry, near, tick)
            elif self.route is None or self.route.stuck(tick):
                self._route_to_spot(me, tick)
        if self.route is None or self.route.done:
            controls.stop()
            if self.route is not None and self.arrived_at is None:
                self.arrived_at = tick
            return
        controls.look_at(me.pos, self.route.ahead(me.pos))
        self.route.steer(me.pos, tick, controls)

    def _pick_spot(self, me: Player, quarry: list[Player], near: frozenset[str], tick: int) -> None:
        """The nearest of a sample of spots that sees someone: round itself for quarry nearby, the
        lookouts otherwise; failing both, a lookout on another floor."""
        self.near_ids = near
        if near:
            options, wanted = self.world.nodes_near(_feet(me), NEAR_SEARCH), [p for p in quarry if p.id in near]
        else:
            options, wanted = list(self.world.lookouts), quarry
        wanted = wanted[:SPOT_TARGETS]
        sample = self.rng.sample(options, min(SPOT_CHOICES, len(options)))
        seeing = [i for i in sample if any(self.world.clear(_eye(self.world.nodes[i]), chest(p)) for p in wanted)]
        if seeing:
            self.spot = min(seeing, key=lambda i: _distance(me.pos, _eye(self.world.nodes[i])))
        else:
            self.spot = self._lookout_elsewhere()
        log_message(self.name, "heading to a spot", node=self.spot, sees=bool(seeing), near=len(near))
        self._route_to_spot(me, tick)

    def _lookout_elsewhere(self) -> int:
        """A random lookout on a floor other than its spot's (any floor if it has none yet)."""
        floor = self._floor(self.spot) if self.spot is not None else None
        floors = sorted({self._floor(i) for i in self.world.lookouts})
        other = self.rng.choice([f for f in floors if f != floor] or floors)
        return self.rng.choice([i for i in self.world.lookouts if self._floor(i) == other])

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
