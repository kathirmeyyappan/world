# kathir world

Babylon.js multiplayer 3D playground. `packages/shared` is the pure sim + protocol + Room,
`packages/client` the Vite renderer, `packages/server` the Node host, `infra/` the Modal deploy.

## Pull requests

- Anything visual gets screenshots in the PR description. Push the images to the orphan
  `screenshots` branch under `pr-<number>/` and link them with
  `https://raw.githubusercontent.com/kathirmeyyappan/world/screenshots/pr-<number>/<file>.png`.
  Capture them headless (Playwright with the swiftshader flags; `window.__world.debug()` and
  `setLook()` are exposed for scripting) and include a mobile shot when the HUD changes.

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
after ten seconds; the server closes a dead client after roughly thirteen seconds. A bot that
should respawn must detect `state.me.dead`, stop its input task, close, wait for the chosen respawn
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
- Snapshots reveal players globally and current combat has no wall or cube occlusion. Perfect aim
  can therefore be much stronger than a human player. Fairness constraints such as field of view,
  reaction delay, aim error, and respawn delay belong in bot policy, not in connection code.
- Room capacity is 32 players. A bot is a visible player and occupies a seat. `connect` joins with
  `bot=1`, so `Player.bot` is true for every bot, the roster shows a robot icon, and a room with only
  bots left closes like an empty one (the server disconnects them).

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
ruff check modal-bots
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
The Room validates (people only, at most `MAX_BOTS_PER_ROOM` seated or pending, host must have a
spawner) and calls `RoomOptions.spawnBot`; `packages/server/src/bots.ts` implements it as one POST
to `BOT_SPAWNER_URL`, the localhost sidecar `infra/bot_sidecar.py` that the Room container's Python
process runs. The sidecar spawns `kathir-world-bots/run_bot` with `{bot, room, seconds}` using the
container's own Modal credentials; Node never holds a token. A new bot therefore needs a row in
`bots.ts` as well as its Python module.

### Modal and dependency constraints

- Configure the lobby once with the Modal Secret `kathir-world-bots-config`, containing
  `WORLD_LOBBY_URL`.
- Run a bot with
  `modal run modal-bots/app.py --bot <registry-key> --room <room> --seconds <n>`.
- All bots registered under `run_bot` share the same image, CPU allocation, Secret, and timeout.
  If a bot truly needs a GPU, different dependencies, or a different timeout, define a separate
  Modal worker intentionally rather than adding conditionals to `run_bot`.
- When adding a Python dependency, update both `modal-bots/pyproject.toml` and `bot_image` in
  `modal-bots/common/deployment.py`, then verify an actual `modal run`.
