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

Create `modal-bots/bots/<name>_bot.py` with exactly one registered behavior:

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

This signature must satisfy `BotInvocation` in `modal-bots/bots/__init__.py`.

Non-negotiable contract:

- Name the function `run_<name>_bot`.
- Call `validate_duration(seconds)`.
- Return a JSON-serializable dictionary.
- Use `lobby_url` in production and `direct_ws_url` only in local integration tests.
- Do not add a Modal decorator. Ordinary bots share `modal-bots/app.py::run_bot`.
- Do not return live sockets, tasks, dataclasses, or credentials.

Import and register it explicitly:

```python
from .example_bot import run_example_bot

BOT_INVOCATIONS = {
    "example": run_example_bot,
    # existing bots...
}
```

The key is the `--bot` value; the in-game player name is `<key>-bot`. Do not implement dynamic discovery.
An ordinary bot requires no change to `app.py`.

## Mandatory shared APIs

Use:

- `connect` for lobby admission, redacted Modal session auth, WebSocket setup, retry, welcome
  validation, and close handling.
- `WorldState` for authoritative players, cubes, health, deaths, and tick.
- `Controls` for movement and interaction intent.
- `run_input_loop` for drift-free 30 Hz input frames.
- `log_kill`, `log_death`, and `log_message` for structured Modal logs.

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
controls.read_cube(cube_or_id)
await controls.chat("hello")
await controls.command("sniper")
```

Important semantics:

- Movement is normalized; forward/right are relative to current yaw.
- `jump` and `fire_once` last one frame.
- `shoot(True)` persists and is for held actions such as flamethrower fire.
- Tap weapons need a press frame followed by a release frame.
- Sniper firing requires persistent scope.
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

A dead player is closed by the server after roughly thirteen seconds. A respawning bot must stop
input, close, wait for its policy's respawn delay, and reconnect. Reconnection creates a new player
ID; there is no resume protocol. Use `circle_bot.py` as the concrete reference for an active bot
with concurrent receive and input loops.

## State and policy constraints

- Server snapshots are 30 Hz and authoritative. Do not implement browser interpolation.
- Yaw `0` faces `+z`; positive pitch looks down; player position is eye position.
- `Player.hearts` and `Player.kills` are the scoreboard.
- Look is client-authoritative. Movement, jumping, combat, damage, and death are server-owned.
- Snapshots reveal all players and combat currently has no wall/cube occlusion. Human-like
  reaction, visibility, aim error, and respawn delay must be explicit policy choices.
- Bots are visible players and count against the 32-player room limit. `connect` joins with `bot=1`:
  `Player.bot` is true, the roster shows a robot icon, and a room with only bots left closes.

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
ruff check modal-bots
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

`/circle-bot [seconds]` and `/observer-bot [seconds]` (the `-bot` suffix is optional) start a bot in
the caller's room; seconds default to 300 and cap at 3500. The registry for that is
`packages/shared/src/sim/bots.ts` (id, player name, blurb), which also fills the commands menu.
The Room validates (people only, at most `MAX_BOTS_PER_ROOM` seated or pending, host must have a
spawner) and calls `RoomOptions.spawnBot`; `packages/server/src/bots.ts` implements it as one POST
to `BOT_SPAWNER_URL`, the localhost sidecar `infra/bot_sidecar.py` that the Room container's Python
process runs. The sidecar spawns `kathir-world-bots/run_bot` with `{bot, room, seconds}` using the
container's own Modal credentials; Node never holds a token. A new bot therefore needs a row in
`bots.ts` as well as its Python module.

## Modal configuration

- `kathir-world-bots-config` must contain `WORLD_LOBBY_URL`.
- Run:
  `modal run modal-bots/app.py --bot <registry-key> --room <room> --seconds <n>`.
- Registered bots share the default image, Secret, CPU, and timeout.
- A GPU bot or one requiring materially different dependencies/resources should use a separate
  worker rather than conditional resource logic in `run_bot`.
- Add dependencies to both `modal-bots/pyproject.toml` and `bot_image` in
  `modal-bots/common/deployment.py`, then execute a real `modal run`.

## Pull requests

Anything visual requires desktop and, for HUD changes, mobile screenshots in the PR description,
stored on the orphan `screenshots` branch as documented in `CLAUDE.md`.
