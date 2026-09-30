# kathir world

Babylon.js multiplayer 3D playground. `packages/shared` is the pure sim + protocol + Room,
`packages/client` the Vite renderer, `packages/server` the Node host, `infra/` the Modal deploy.

## Pull requests

- Anything visual gets screenshots in the PR description. Push the images to the orphan
  `screenshots` branch under `pr-<number>/` and link them with
  `https://raw.githubusercontent.com/kathirmeyyappan/world/screenshots/pr-<number>/<file>.png`.
  Capture them headless (Playwright with the swiftshader flags; `window.__world.debug()` and
  `setLook()` are exposed for scripting) and include a mobile shot when the HUD changes.
- Architecture diagrams live in `docs/` with their SVG-in-HTML sources in `docs/src/`. When a flow
  changes, edit the source and re-render the PNG with headless Chromium at 2x (a 1560 px viewport,
  `deviceScaleFactor: 2`, full page).

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
`stairs`, `building`, `terrain`) in `packages/shared/src/sim/structures.ts`. The sim collides with them through
`sim/collision.ts` (standing, walls, ceilings, line of sight) and the client draws the same list
(`render/Structures.ts`), so adding an entry is the whole job. Nothing about structures goes over the
wire: server and client both build the world from that file.

### Adding structures

- Use the helpers rather than hand-computing yaw and centres: `wall(a, b, h)` runs between two floor
  points, `ramp(low, high, h, w)` rises from `low` to `high`, `stairs(bottom, top, h, w)` is solid
  steps players walk up without jumping (the camera eases over each), `building({...})` is four
  walls, a doorway and a roof, and `terrain({ height })` samples a function. Write raw
  `{ kind: 'box', ... }` only for simple platforms and pillars.
- Group entries by place, one short comment per group saying what it is (`// the annex watchtower`).
  A composite you'll reuse (a staircase, a bridge rail) is a function returning `Structure[]` in
  `sim/structures.ts` next to `building`; a one-off stays inline in the content file.
- Coordinates are world metres, yaw 0 facing +z. The playable outline is `WORLD_SHAPE` in
  `sim/world.ts`: the main disc (r 50 at the origin), the annex (r 30 at x 112) and the bridge between
  them. Players are clamped 1 m inside it no matter what, so keep structures inside too.
- Size things to the player: eyes at 1.7 m, head at 2.0 m, radius 0.35 m, steps up to 0.5 m climb on
  their own, and a running jump lands on tops up to about 1.9 m (make anything meant to stop a jump
  2.1 m or taller). Doorways at least 1.2 m wide and 2.2 m tall; ramps no steeper than about 30°;
  walls at least 0.3 m thick.
- Spawns stand on the highest surface at a random point, so rooftops are spawn points: don't build a
  roof players can't get down from. Info cubes wander the main disc at about 3 m and pass through
  structures, so tall pieces there will have cubes floating through them.
- Terrain: keep edge heights at 0 so it meets the floor (no side walls are drawn), and keep sample
  grids modest (the default is one sample every 2 m); every sample is a vertex.
- Colours: pass `color` to stand out; the defaults are dark and every box and ramp gets accent edges.
- Scale: collision queries use a spatial grid, but a shot's ray (and the crosshair, every frame)
  checks every structure. Hundreds are fine; thousands need a grid-walking raycast first.

### Checking a change

Structures are content, so don't add a test per structure. Run `npm run dev`, walk the new pieces in
a browser, and put screenshots in the PR. Headless, `window.__world.debug()` gives your position, and
in dev `window.__game.correction.length()` should stay at 0 while you walk over them (anything else
means prediction and the server disagree). A new kind is different: add a case in `surfaceOf` and in
the client's `build` (the compiler asks for both), a check in `validateStructure` for any new fields,
and one test of its surface in `packages/shared/test/sim.test.ts`.

Cubes and the minimap don't know about structures yet.

## Adding a Modal bot

Keep this section synchronized with `AGENTS.md`. A bot is a headless Python client in
`modal-bots/bots/`; it joins the same authoritative Room as browser players and receives the
same WebSocket protocol. It has no renderer, browser interpolation, or visual picking.

### Required contract

Every registry entry must satisfy `BotInvocation` in `modal-bots/bots/__init__.py`:

```python
async def run_example_bot(
    room: str,
    name: str,
    seconds: float,
    *,
    lobby_url: str | None,
    direct_ws_url: str | None = None,
) -> dict[str, Any]:
    ...
```

- Put it in `modal-bots/bots/<name>_bot.py` and call it `run_<name>_bot`.
- Call `validate_duration(seconds)` before starting work.
- Return a JSON-serializable dictionary. Never return a live connection, dataclass, task, or token.
- `lobby_url` is used in production. `direct_ws_url` exists only for local tests.
- Do not add a Modal decorator to a bot. `modal-bots/app.py::run_bot` is the one shared Modal
  worker; it chooses a registered invocation and supplies the lobby URL from the
  `kathir-world-bots-config` Secret.

Register the function explicitly in `modal-bots/bots/__init__.py`:

```python
from .example_bot import run_example_bot

BOT_INVOCATIONS = {
    "example": run_example_bot,
    # ...
}
```

The registry key is the `--bot` CLI value; the in-game player name is `<key>-bot`. Do not use dynamic module
discovery: an explicit registry is easier to audit and gives invalid names a deterministic error.
No change to `app.py` should be needed for an ordinary bot.

### Use the shared runtime

Bots must use the modules under `modal-bots/common/`:

- `connect(...)` owns lobby admission, session-token redaction, authenticated WebSocket setup,
  one retry on stale authentication, welcome validation, JSON transport, and clean close.
- `WorldState(connection.welcome, connection.room)` owns the latest authoritative players, cubes,
  health, deaths, and server tick. Apply every received message before making the next decision.
- `Controls(connection)` owns input sequence numbers and persistent input intent.
- `run_input_loop(controls, stop)` sends that intent at the server's 30 Hz tick rate without drift.
- `log_kill`, `log_death`, and `log_message` write structured JSON to Modal's normal function logs.

Bot files must not import `httpx` or `websockets`, parse raw JSON, copy lobby/token code, manage
`InputFrame.seq`, or log a token-bearing redirect or authorization header.

### Controls and interactions

Use `Controls` instead of constructing client messages:

```python
controls.move(forward=1, right=0)   # values are normalized to the unit circle
controls.stop()
controls.look(yaw, pitch)
controls.look_at(state.me.pos, target.pos)
controls.jump()                     # one input frame
controls.fire_once()                # one press frame; the next frame releases it
controls.shoot(True)                # persistent hold, e.g. flamethrower
controls.shoot(False)
controls.scope(True)
controls.read_cube(cube_or_id)
await controls.chat("hello")
await controls.command("sniper")    # sends /sniper
```

There is no generic server-side click message. Browser cube clicks are local visual picking and
become the `reading` field; use `read_cube`. Attack clicks become the `shoot` action; use
`fire_once` or `shoot`. Sky-object clicks are entirely client-side and have no server interaction.

Tap weapons require a press frame followed by a release frame. Hold weapons require `shoot` on
every frame. Sniper shots require scope to remain enabled. Run exactly one input loop per
connection; never call `send_input()` concurrently from multiple tasks.

### Active-bot lifecycle

An active bot generally has one receive loop and one input task:

```python
connection = await connect(
    lobby_url,
    room,
    name,
    direct_url=direct_ws_url,
)
state = WorldState(connection.welcome, connection.room)
controls = Controls(connection)
stop = asyncio.Event()
inputs = asyncio.create_task(run_input_loop(controls, stop))

try:
    async with asyncio.timeout(seconds):
        while True:
            message = await connection.receive()
            state.apply(message)
            # Read state and update controls here.
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

The observer is intentionally simpler because it never sends input. Use `circle_bot.py` as the
reference for an active receive loop plus 30 Hz input task. Browser clients respawn by reloading
after ten seconds and the server drops their seat after roughly thirteen; a dead bot's seat is
kept, so its corpse lies there until its run ends (stop the input task and keep receiving, as
`circle_bot.py` does). A bot that should respawn instead must close, wait for the chosen respawn
delay, and call `connect` again. Reconnection creates a fresh player ID; there is no resume
protocol.

### State and combat facts

- Snapshots arrive at 30 Hz and contain exact global player and cube state. Bots do not need
  browser interpolation.
- Look is client-authoritative; movement, jumping, shooting, damage, and death are
  server-authoritative.
- `Player.pos` is eye position. Yaw `0` faces `+z`; positive pitch looks down.
- `Player.hearts` and `Player.kills` are the scoreboard; `Player.dead` stays true until the
  server drops the seat.
- Snapshots reveal players globally, and shots pass through cubes; only structures block them. Perfect aim
  can therefore be much stronger than a human player. Fairness constraints such as field of view,
  reaction delay, aim error, and respawn delay belong in bot policy, not in connection code.
- Shots are lag-compensated: `Controls` sends the newest snapshot tick as `view`, and the server
  judges the shot against where targets were at that tick (`packages/shared/src/sim/rewind.ts`,
  at most `MAX_REWIND_TICKS` back). Aim at the snapshot you have; don't lead.
- Room capacity is 32 players. A bot is a visible player and occupies a seat. `connect` joins with
  `bot=1`, so `Player.bot` is true for every bot, the roster shows a robot icon, and a room with only
  bots left closes like an empty one (the server disconnects them).
- A bot can't join a room with no people in it: the lobby answers 409 and Node answers `no one here`,
  so a bot that spawns after everyone left never starts a room nothing would close. Local tests
  seat a person first with `connect(..., bot=False)`.

### Logging

Log meaningful behavior where it occurs:

```python
log_kill(name, victim.name, item="sniper", headshot=True)
log_death(name, killer.name, item="gun")
log_message(name, "target acquired", target=target.id, distance=distance)
```

Do not log every snapshot or input frame. Modal already timestamps stdout; the logging helpers use
`print(..., flush=True)` and emit one searchable JSON object per event.

### Tests required for a new bot

1. Add fast policy/unit tests under `modal-bots/tests/`.
2. Exercise movement and message flow against the real local Node server using
   `direct_ws_url`; do not use a browser.
3. Keep production access opt-in. Never create Modal sessions in normal CI.
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

5. If protocol or simulation behavior changes, update the TypeScript source of truth and its tests
   first, then update the Python mirror and contract tests.

The production smoke test is:

```bash
RUN_MODAL_BOT_SMOKE=1 \
WORLD_LOBBY_URL=https://your-lobby.modal.run \
python -m pytest modal-bots/tests/test_production_smoke.py
```

Use an isolated room such as `bot-smoke`, not `global`, for automated or manual tests.

### Calling bots from chat

`/circle-bot [seconds]` and `/observer-bot [seconds]` (the `-bot` suffix is optional) start a bot in
the caller's room; seconds default to 300 and cap at 3500. The registry for that is
`packages/shared/src/sim/bots.ts` (id, player name, blurb), which also fills the commands menu.
The Room validates (people only, a free seat, host must have a spawner) and calls `RoomOptions.spawnBot`; `packages/server/src/bots.ts` implements it as one POST
to `BOT_SPAWNER_URL`, the localhost sidecar `infra/bot_sidecar.py` that the Room container's Python
process runs. The sidecar spawns `kathir-world-bots/run_bot` with `{bot, room, seconds}` using the
container's own Modal credentials; Node never holds a token. A new bot therefore needs a row in
`bots.ts` as well as its Python module.

Rooms also start with bots: the first person to join brings the line-up from
`packages/shared/src/sim/defaultBots.ts` (`defaultBotsFor(room)`, two circle bots for now). Edit that
function for per-room profiles; the Room spawns them once, with `caller: 'room'`.

### Modal and dependency constraints

- Configure the lobby once with the Modal Secret `kathir-world-bots-config`, containing
  `WORLD_LOBBY_URL`.
- Run a bot with
  `modal run modal-bots/app.py --bot <registry-key> --room <room> --seconds <n>`.
- All bots registered under `run_bot` share the same image, CPU allocation, Secret, and timeout,
  and run many to a container: `run_bot` is async, so up to `MAX_BOTS_PER_CONTAINER` bots share one
  event loop, the autoscaler adds a container past `TARGET_BOTS_PER_CONTAINER`, and
  `MAX_BOT_CONTAINERS` bounds the fleet. A bot must never block the loop (no sync sleeps or I/O).
  If a bot truly needs a GPU, different dependencies, or a different timeout, define a separate
  Modal worker intentionally rather than adding conditionals to `run_bot`.
- When adding a Python dependency, update both `modal-bots/pyproject.toml` and `bot_image` in
  `modal-bots/common/deployment.py`, then verify an actual `modal run`.
