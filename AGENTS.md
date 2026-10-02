# kathir world agent guide

All repository rules in `CLAUDE.md` apply. Keep this guide synchronized with the
`Adding a Modal bot` section there.

## Architecture

`packages/shared` is the authoritative TypeScript simulation, protocol, content, and Room.
`packages/client` is the Babylon/Vite browser client. `packages/server` is the Node WebSocket
host. `infra` deploys the lobby and sessioned Room server. `modal-bots` contains external,
headless Python players.

Do not move game authority into a bot. Bots receive snapshots and submit the same input intent as
browser players.

## Creating a bot

Create `modal-bots/bots/<name>_bot.py` with exactly one registered behavior. It runs on one of the
bots app's two Modal workers: a dumb bot (circle, stalker, observer) on `run_dumb_bot`, satisfying
`DumbBotInvocation` in `modal-bots/bots/__init__.py`; a combat bot (the sniper) on
`run_combat_bot`, satisfying `CombatBotInvocation`, which adds the world map and `targets` (parts of
player names, any case; empty means every person). A bot that needs to see past walls, find a way
around, or take names from chat is a combat bot.

```python
async def run_example_bot(
    room: str,
    name: str,
    seconds: float,
    *,
    lobby_url: str | None,
    direct_ws_url: str | None = None,
    spawn: Vec3 | None = None,
    avatar: str | None = None,
) -> dict[str, Any]:
    ...
```

A combat bot also takes the world map and the names it goes after (`CombatBotInvocation`):

```python
async def run_example_bot(
    room: str,
    name: str,
    seconds: float,
    *,
    world: WorldMap,
    targets: tuple[str, ...] = (),
    lobby_url: str | None,
    direct_ws_url: str | None = None,
    spawn: Vec3 | None = None,
    avatar: str | None = None,
) -> dict[str, Any]:
    ...
```

Non-negotiable contract:

- Name the function `run_<name>_bot`.
- Call `validate_duration(seconds)`.
- Return a JSON-serializable dictionary.
- Use `lobby_url` in production and `direct_ws_url` only in local integration tests.
- Pass `spawn` and `avatar` straight through to `connect` (see the placement constraint below).
- Do not add a Modal decorator. Bots share the workers in `modal-bots/app.py`, which load the map
  once per container for combat bots.
- Do not return live sockets, tasks, dataclasses, or credentials.

Import and register it explicitly:

```python
from .example_bot import run_example_bot

DUMB_BOTS = {
    "example": run_example_bot,
    # ...
}
```

A combat bot goes in `COMBAT_BOTS` instead.

The key is the `--bot` value; the in-game player name is `<key>-bot` unless the caller names it
(`-n` in chat, `--name` with `modal run`). Do not implement dynamic discovery.
An ordinary bot requires no change to `app.py`.

## Mandatory shared APIs

Use:

- `connect` for lobby admission, redacted Modal session auth, WebSocket setup, retry, welcome
  validation, and close handling.
- `WorldState` for authoritative players, cubes, health, deaths, and tick;
  `state.nearest_player(people_only=...)` is the closest living player in a straight line.
- `Controls` for movement and interaction intent.
- `run_input_loop` for drift-free 30 Hz input frames.
- `log_kill`, `log_death`, and `log_message` for structured Modal logs.
- `load_world_map()` (`common/world.py`) for the world's structures and walkable ground, shared by
  every bot in the process: `world.clear(a, b)` is the sim's line of sight, and `world.node_at(feet)`
  and `world.path(start, goal)` find a way over a 1 m grid of standing spots, up the stair and over
  its rail where only a jump gets there. `Route(world, path, tick)` (`common/navigation.py`) walks
  it: `route.steer(me.pos, tick, controls)` on every snapshot after `look`, and plan again when
  `route.stuck(tick)`. `controls.walk_toward(origin, target)` moves toward a point whatever the look.
  `world.lookouts` are the high spots with a wide view (balconies, decks); `world.hitbox(avatar)` is
  what a shot at that avatar has to land in (head band included). All of it comes from the generated
  map, so after a change to structures, the outline, movement or an avatar, run `npm run bot-map`.

Never import `httpx` or `websockets` from a bot file. Never parse raw protocol JSON, copy lobby
logic, manage input sequence numbers, or log redirect URLs, session tokens, cookies, or auth
headers.

Initialize the runtime as follows:

```python
connection = await connect(
    lobby_url,
    room,
    name,
    direct_url=direct_ws_url,
    spawn=spawn,
    avatar=avatar,
)
state = WorldState(connection.welcome, connection.room)
controls = Controls(connection)
```

Apply each received message to `state` before choosing the next action.

## Controls

Bots express intent through:

```python
controls.move(forward=1, right=0)
controls.stop()
controls.look(yaw, pitch)
controls.look_at(state.me.pos, target.pos)
controls.jump()
controls.fire_once()
controls.shoot(True)
controls.shoot(False)
controls.scope(True)
controls.thrust(True)               # hold a worn jetpack's lift (after /jetpack)
controls.read_cube(cube_or_id)
await controls.chat("hello")
await controls.command("sniper")
```

Important semantics:

- Movement is normalized; forward/right are relative to current yaw.
- `jump` and `fire_once` last one frame; `fire_once` shoots where the bot looked when it was called.
- `shoot(True)` persists and is for held actions such as flamethrower fire.
- Tap weapons need a press frame followed by a release frame.
- Sniper firing requires persistent scope. A scoped player walks at 30% speed and can't jump.
- Use exactly one `run_input_loop` per connection. Do not send frames concurrently.
- There is no generic server-side click. Cube clicks become `reading`; use `read_cube`. Attack
  clicks become `shoot`; use `fire_once` or `shoot`. Sky clicks are client-only.

Active bots need concurrent receive and input tasks:

```python
stop = asyncio.Event()
inputs = asyncio.create_task(run_input_loop(controls, stop))
try:
    async with asyncio.timeout(seconds):
        while True:
            message = await connection.receive()
            state.apply(message)
            # Read state and update controls.
except TimeoutError:
    pass
finally:
    stop.set()
    inputs.cancel()
    with suppress(asyncio.CancelledError, RoomConnectionError):
        await inputs
    if connection.close_code is None:
        await connection.close(reason=f"{name} complete")
```

A dead browser player is dropped by the server after roughly thirteen seconds; a dead bot's seat
is kept until its run ends, so it lies there as a corpse. A death from `/kill-bots` has no kill
event, so react to `state.me.dead`, not to the event. A respawning bot must instead close, wait
for its policy's respawn delay, and reconnect. Reconnection creates a new player
ID; there is no resume protocol. Use `circle_bot.py` as the concrete reference for an active bot
with concurrent receive and input loops.

## State and policy constraints

- Server snapshots are 30 Hz and authoritative. Do not implement browser interpolation.
- Yaw `0` faces `+z`; positive pitch looks down; player position is eye position, in three
  dimensions: structures put players on floors, stairs and bridges, so `y` varies (feet are at
  `pos.y - 1.7`). Choose targets by straight-line distance, not `x`/`z` only; `look_at` aims in 3D.
- `Player.hearts` and `Player.kills` are the scoreboard.
- Snapshots carry the floating pickups (`state.pickups`); walking into a heart below full health
  gives back 3 hearts, up to 10, and a `big-heart` (left where someone died) all 10.
- Falls hurt by landing speed: slower than a 15 m drop from rest is free, as fast as an 80 m drop
  takes every heart, and damage rises linearly between, in half hearts (a jetpack that brakes the
  fall lands slower). That arrives as a `hit` with `shooter: None`, and a fatal fall as a `fell`
  event rather than `kill`.
- Look is client-authoritative. Movement, jumping, combat, damage, and death are server-owned.
- Snapshots reveal all players, and shots pass through cubes; only structures block them. Human-like
  reaction, visibility, aim error, and respawn delay must be explicit policy choices.
- Shots are lag-compensated: `Controls` sends the newest snapshot tick as `view`, and the server
  judges the shot against where targets were at that tick. Aim at the snapshot you have; don't lead.
- Bots are visible players and count against the 32-player room limit. `connect` joins with `bot=1`:
  `Player.bot` is true, the roster shows a robot icon, and a room with only bots left closes.
- A bot may choose where it spawns and how it looks: pass `spawn` (a feet position, `Vec3`) and
  `avatar` through to `connect`, which puts them on the join URL. The Room honours them for bots only,
  clamping the spot inside the world and standing the bot on the surface under it; the avatar is
  fixed for the run. Any avatar id works, including one with no chat command
  (`AVATARS[id].command` null) that people can't switch to.
- A bot can't join a room with no people in it: the lobby answers 409 and Node answers `no one here`,
  so a bot that spawns after everyone left never starts a room nothing would close. Local tests
  seat a person first with `connect(..., bot=False)`.

## Logging

Write sparse, meaningful events:

```python
log_kill(name, victim.name, item="sniper", headshot=True)
log_death(name, killer.name, item="gun")
log_message(name, "target acquired", target=target.id, distance=distance)
```

Do not log every snapshot or frame. Helpers emit one JSON object to stdout with `flush=True`, which
appears in Modal Function logs.

## Verification checklist

For every new bot:

1. Add policy/unit tests in `modal-bots/tests`.
2. Add a real local Node-server test using `direct_ws_url`.
3. Never hit deployed Modal from normal CI.
4. Run:

```bash
python -m pytest modal-bots/tests
ruff format --check modal-bots infra
ruff check modal-bots infra
mypy
npm run lint
npm run typecheck
npm test
```

5. If shared protocol/simulation behavior changes, update TypeScript and its tests first, then the
   Python mirror and contract tests.
6. Optionally smoke-test production in an isolated room:

```bash
RUN_MODAL_BOT_SMOKE=1 \
WORLD_LOBBY_URL=https://your-lobby.modal.run \
python -m pytest modal-bots/tests/test_production_smoke.py
```

Never use `global` for automated testing.

### Calling bots from chat

`/circle-bot`, `/stalker-bot` and `/sniper-bot` start a bot in the caller's room, on the ground
within 50 m of them (the `-bot` is optional where the bare word isn't already a command: `/circle`,
but `/sniper` is the rifle). Flags go in any order, each at most once, and each has a long form too
(`--time` for `-t`):

| Flag | Bots | Meaning |
| --- | --- | --- |
| `-t [seconds]` | all | how long it stays: 300 unless given, up to 3500 |
| `-n [name]` | all | what it plays as, instead of `<bot>-bot` |
| `-s [skin]` | all | how it looks: any skin's chat command (`elizabeth`, `tung`) |
| `--target [name substrings]` | combat | who it goes after: the words up to the next flag, each any part of a name |

So `/sniper-bot -t 120 -n hunter -s tung --target kat bob`. A bare word, an unknown or repeated
flag, or a missing or bad value gets the usage line instead. The flags are one table, `BOT_FLAGS` in
`packages/shared/src/sim/bots.ts`: `commands.ts` parses it and the usage lines and commands menu are
written from it, so a new flag is a row there and a case in the parser. Names are taken as given,
tags and all: a bot named `GUNNER` holds a gun for good, like a person would.

`/kill-bots` drops every living bot in the room dead where it stands, with no kill event; each
corpse is removed like any bot's, which closes its connection and ends its run.

The registry is `bots.ts` (id, player name, worker, blurb), which also fills the commands menu. The
Room validates (people only, a free seat, host must have a spawner) and calls `RoomOptions.spawnBot`
with a `BotRequest` for the bot's worker; `packages/server/src/bots.ts` implements it as one POST to
`BOT_SPAWNER_URL/<worker>`, the localhost sidecar `infra/bot_sidecar.py` that the Room container's
Python process runs. The sidecar spawns the worker's function (`BOTS_FUNCTIONS` in
`infra/config.py`: `run_dumb_bot` or `run_combat_bot`, each looked up once) with `{bot, room,
seconds}`, the request's `name` and placement (`spawn`, `avatar`) and, for a combat bot, `targets`,
using the container's own Modal credentials; Node never holds a token. A bot called from chat
therefore needs a row in `bots.ts` as well as its Python module; one without a row (the observer) is
started only with `modal run`.

Rooms also start with bots: the first person to join brings the line-up from
`packages/shared/src/sim/defaultBots.ts` (`defaultBotsFor(room)`: two circle bots anywhere, and a
Tung Tung Tung Sahur stalker in the middle of each of the tower's lower three floors), all staying 3500 s. Each entry may carry a
`BotPlacement` (`spawn`, a feet position, and `avatar`); edit that function for per-room profiles.
The Room spawns them once, with `caller: 'room'`.

## Modal configuration

- `kathir-world-bots-config` must contain `WORLD_LOBBY_URL`.
- Run:
  `modal run modal-bots/app.py --bot <registry-key> --room <room> --seconds <n>`, which picks the
  bot's worker (`--name` renames it, and `--target kat,bob` aims a combat bot).
- Both workers share the default image, Secret, CPU, and timeout.
- Bots run many to a container: the workers are async, so up to `MAX_BOTS_PER_CONTAINER` bots share
  one event loop, the autoscaler adds a container past `TARGET_BOTS_PER_CONTAINER`, and
  `MAX_BOT_CONTAINERS` bounds the fleet. A bot must never block the loop (no sync sleeps or I/O).
- A GPU bot or one requiring materially different dependencies/resources should use a separate
  worker rather than conditional resource logic in the existing ones.
- Add dependencies to both `modal-bots/pyproject.toml` and `bot_image` in
  `modal-bots/common/deployment.py`, then execute a real `modal run`.

## Formatting and type checks

CI fails on any of these, so run them before pushing:

- `npm run format` (Prettier: TS, CSS, HTML, JSON) and `ruff format modal-bots infra` (Python).
- `npm run lint` checks formatting and bans explicit `any` and `@ts-` comments; `npm run typecheck` is
  strict `tsc`. Type the thing instead of casting around it: no `as unknown as`.
- `mypy` from the repo root is strict over `modal-bots/` and `infra/`. `Any` is for JSON at the wire,
  nowhere else.

## Tests

Don't overtest; the suite is already near the point of bloat. Before adding a test:

- Test behavior that would break silently and isn't covered yet. One test per behavior, and
  extend an existing test or fixture before writing a new one.
- Skip tests for copy, styling, constants, and one-line wiring; check those by running the app.
- Measurement, load, and screenshot scripts are throwaway: keep them in the scratchpad, report
  their numbers in the PR, and don't commit them.
- If a change seems to need many new tests, the change is probably too big.

## Comments

Comments are welcome; the rule is about who they're written for. Write them for someone reading
the code cold, long after the conversation or PR that produced it: say what a function, constant or
block is and why it has to be that way (`// The middle of a node and everything under it, in world
space` is the kind to keep). Don't narrate the change or answer the request that prompted it.

- No history or contrast with the old behavior: "now", "instead of", "rather than just", "no longer",
  "used to", "on purpose", "as requested". That belongs in the commit message and PR description.
- Comment what the code can't say itself: units, invariants, constraints, and the reason behind a
  non-obvious choice. Skip comments that restate the line below them.

## World geometry

Buildings, walls, platforms, ramps and terrain are structures: plain data listed in
`packages/shared/src/content/structures.ts`, with kinds and authoring helpers (`wall`, `ramp`,
`stairs`, `building`, `terrain`, and the round pieces `roundWall`, `spiralStairs`, `roundFloor`) in
`packages/shared/src/sim/structures.ts`. The sim collides with them through
`sim/collision.ts` (standing, walls, ceilings, line of sight) and the client draws the same list
(`render/Structures.ts`), so adding an entry is the whole job. Nothing about structures goes over the
wire: server and client both build the world from that file.

### Adding structures

- Use the helpers rather than hand-computing yaw and centres: `wall(a, b, h)` runs between two floor
  points, `ramp(low, high, h, w)` rises from `low` to `high`, `stairs(bottom, top, h, w)` is solid
  steps players walk up without jumping (the camera eases over each), `building({...})` is four
  walls, a doorway and a roof, and `terrain({ height })` samples a function. The round pieces:
  `roundWall` (straight segments at any base height, with gaps for doors and windows), `spiralStairs`
  (with an optional inner rail so players can't step off the inside) and `roundFloor` (gap-free rings,
  with an optional hole for a stair coming up from below, or only an outer ring for a balcony). Write raw `{ kind: 'box', ... }` only for simple platforms
  and pillars.
- A landmark gets its own content file exporting its list (Tung Tung Tower is `content/tower.ts`,
  `TUNG_TUNG_TOWER`), with its dimensions as named constants at the top and a comment per group of
  pieces; `content/structures.ts` just spreads the landmarks together. A piece you'll reuse (a
  staircase, a round wall) is a function returning `Structure[]` in `sim/structures.ts`.
- Coordinates are world metres, yaw 0 facing +z. The playable outline is `WORLD_SHAPE` in
  `sim/world.ts`: the main disc (r 50 at the origin), the annex (r 30 at x 112) and the bridge between
  them. Players are clamped 1 m inside it no matter what, so keep structures inside too.
- Size things to the player: eyes at 1.7 m, head at 2.0 m, radius 0.35 m, steps up to 0.5 m climb on
  their own, and a running jump lands on tops up to about 1.9 m (make anything meant to stop a jump
  2.1 m or taller). Doorways at least 1.2 m wide and 2.2 m tall; ramps no steeper than about 30°;
  walls at least 0.3 m thick.
- Spawns land in the main disc only (`SPAWN_AREA`, a region; see below), standing on the ground
  (or anything within a step of it) with headroom, so a building's ground floor there can be a spawn
  point and roofs, decks and wall tops never are. Info cubes wander the main disc at about 3 m and
  pass through structures, so tall pieces there will have cubes floating through them.
- Seal what players walk on: a floor with gaps drops people through it. Give each floor a single
  hole where its stair arrives (`roundFloor`'s `hole`), and leave headroom over the flight below it:
  the hole has to cover the stretch where the stair is within about 2.7 m of the floor above.
- Terrain: keep edge heights at 0 so it meets the floor (no side walls are drawn), and keep sample
  grids modest (the default is one sample every 2 m); every sample is a vertex.
- Looks: set `material` to a pixel texture (`brick`, `wood`, `red-tile`, `flagstone`; each is a
  painter in `packages/client/src/render/structureMaterials.ts`, and a new one is another painter
  there). `color` is a flat fallback. Structures are unlit and shaded by face direction, so they look
  the same inside and out; don't reach for lights.
- Coplanar faces: two faces that overlap in the same plane and point the same way z-fight, and the
  flicker shows wherever they paint different pixels. Structure textures are mapped from the world
  origin, so pieces of one look (with `worldTop` for their tops) paint identical pixels there, which
  is what lets the helpers overlap their joints. Anywhere else (two looks, or tops mapped in each
  piece's frame) keep faces out of one plane: drop one piece a couple of centimetres (a door sill
  under a floor, a stair's landing step, a bridge deck under a balcony) or stand it on the other
  rather than beside it (a stair's rail posts). The same goes for anything else the client draws:
  never lay a decal, glow or second mesh exactly on a surface.
- Client cost: the renderer merges pieces with the same look in the same 48 m square into one mesh,
  so draw calls stay in the tens however many pieces there are. The tower's 1,444 pieces render as 19
  meshes, and a world-spanning raycast costs about 15 µs. Check both numbers in the PR when a
  landmark adds a lot.

### Regions and pickups

- A region (`sim/regions.ts`) is a disc, a ring (a disc with a hole) or an axis-aligned rectangle on a
  floor at height `y`.
  Landmarks export theirs (the tower's `TUNG_TUNG_TOWER_LEVELS` and `TUNG_TUNG_TERRACE`) and
  `content/regions.ts` names the ones the game uses (`MAIN_AREA`, `TERRACE`, `TOWER_LEVELS`,
  `SPAWN_AREA`). Anything that spawns somewhere picks its spot with `randomPointInRegion`, so
  reshape a place where it's defined, never at the spawner.
- Pickups (`sim/pickups.ts`) float in the pickup areas listed in `content/pickups.ts`: a region, a
  kind, how many, and how often one comes back. What's where is that list alone, plus drops:
  `dropPickup` leaves one at a spot, in no area, where it stays until taken and never comes back. A
  dead player's body leaves `CORPSE_DROP` (a big heart, twice the size, back to full health) on
  whatever it was lying on when its seat is dropped.
- A new kind is a row in `PICKUPS` (float height, reach, and `use(player)`, which applies its effect
  and returns false when it's no use to them, so it stays) plus a shape in `render/Pickups.ts`; the
  `Record<PickupKind, …>` there makes the compiler ask. The Room, the wire and the Python mirror
  already carry every kind.
- Pickups pass through structures like cubes, so keep a region clear of stairs and walls at the
  pickup's height. Test a new kind's effect once in `room.test.ts`; content changes need no test.

### Checking a change

Structures are content, so don't add a test per structure. Run `npm run dev`, walk the new pieces in
a browser, and put screenshots in the PR. Headless, `window.__world.debug()` gives your position, and
in dev `window.__game.correction.length()` should stay at 0 while you walk over them (anything else
means prediction and the server disagree). A new kind is different: add a case in `surfaceOf` and in
the client's `build` (the compiler asks for both), a check in `validateStructure` for any new fields,
and one test of its surface in `packages/shared/test/sim.test.ts`.

Bots read the world from `modal-bots/common/world_map.json.gz`, which `npm run bot-map` builds with
the real sim (`sim/botMap.ts`, about ten seconds): the structures, the walkable graph, the lookouts,
and every avatar's hitbox. Rebuild it and commit the new map with the change whenever any of those
inputs move: a structure or landmark added or changed, the world's outline, the player's body or
movement constants, or an avatar added or its hitbox resized. A test in `sim.test.ts` fails until
you do (the map carries a fingerprint of all of them).

Cubes don't know about structures, and the minimap shows only the footprints in
`content/landmarks.ts` (grey on the floor): list a landmark's there when it's worth navigating by.

## Pull requests

Anything visual requires desktop and, for HUD changes, mobile screenshots in the PR description,
stored on the orphan `screenshots` branch as documented in `CLAUDE.md`.
