# Modal bots

Headless Python clients that join kathir world through the same lobby and Room
infrastructure as browser players.

## Observer

The first function is a bounded observer. It:

- resolves a room through the production lobby;
- authenticates the Room WebSocket;
- validates `welcome` and subsequent protocol messages;
- tracks authoritative players, cubes, ticks, and events; and
- returns a token-free structured report.

There is no spectator protocol. The observer joins visibly as a stationary
player, occupies one of the 32 seats, and can be attacked. It sends no gameplay
input, chat, or application-level ping messages. Standard WebSocket pong
responses are handled by the client library.

Run it directly on Modal:

```bash
modal run modal-bots/app.py::run_bot \
  --bot observer \
  --room global \
  --seconds 30
```

Configure the lobby URL once for the app:

```bash
modal secret create kathir-world-bots-config \
  WORLD_LOBBY_URL=https://your-lobby.modal.run
```

The deployed function is named `run_bot` in the `kathir-world-bots` app.

## Circle bot

The `circle` bot orbits the nearest live player at a 20 m radius. When alone, it orbits the world
origin instead:

```bash
modal run modal-bots/app.py \
  --bot circle \
  --room global \
  --seconds 30
```

## Python API

```python
from common import WorldState, connect

client = await connect(LOBBY_URL, "global", name="my-bot")
async with client:
    state = WorldState(client.welcome, client.room)
    async for message in client:
        state.apply(message)
```

Active bots use `Controls` and one 30 Hz sender:

```python
from common import Controls, run_input_loop

controls = Controls(client)
stop = asyncio.Event()
inputs = asyncio.create_task(run_input_loop(controls, stop))

controls.move(forward=1)
controls.look_at(state.me.pos, target.pos)
controls.jump()
controls.fire_once()
await controls.chat("hello")
await controls.command("sniper")
```

There is no generic network click. Use `read_cube` for the browser's cube-reading state and
`fire_once` or `shoot` for attack clicks.

The reusable files are deliberately small:

```text
common/connection.py  lobby admission and authenticated WebSocket
common/controls.py    movement, look, interaction, and 30 Hz input loop
common/deployment.py  shared Modal app and default image
common/logging.py     structured kill, death, and custom Modal logs
common/protocol.py    typed world messages
common/state.py       current authoritative world state
bots/__init__.py      bot name registry
bots/observer_bot.py  observer behavior
app.py                generic `run_bot` Modal function
```

`connect` obtains a lobby ticket and authenticates the WebSocket with
`Modal-Authorization`. A 401/403 causes one fresh lobby admission attempt.
Session tokens and raw WebSockets stay inside `common/connection.py`.

Bot events are structured JSON in Modal's normal function logs:

```python
from common import log_death, log_kill, log_message

log_kill("hunter", "alice", item="sniper")
log_death("hunter", "bob")
log_message("hunter", "target acquired", distance=12.5)
```

## Adding a bot

1. Add `bots/<name>_bot.py` with `run_<name>_bot(...)` matching `BotInvocation`.
2. Use only the shared connection, state, controls, and logging APIs.
3. Import it and add `<name>: run_<name>_bot` to `BOT_INVOCATIONS` in `bots/__init__.py`.
4. Add unit tests and a real local Node-server test using `direct_ws_url`.

The complete contract, lifecycle template, interaction semantics, and verification checklist are
in the repository's `CLAUDE.md` and `AGENTS.md`.

## Tests

Install the project and run its tests:

```bash
python -m pip install -e './modal-bots[test]'
python -m pytest modal-bots/tests
```

The normal suite starts the real local Node room server and exercises the
WebSocket contract without a browser.

The deployed Modal flow is opt-in because it creates or joins a real session:

```bash
RUN_MODAL_BOT_SMOKE=1 \
WORLD_LOBBY_URL=https://your-lobby.modal.run \
python -m pytest modal-bots/tests/test_production_smoke.py
```

Set `WORLD_SMOKE_ROOM` to choose a room other than `bot-smoke`.
