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
modal run modal-bots/app.py::spawn_bot \
  --bot observer \
  --room global \
  --seconds 30 \
  --lobby-url https://your-lobby.modal.run
```

To make the lobby URL the deployment default:

```bash
WORLD_LOBBY_URL=https://your-lobby.modal.run modal deploy modal-bots/app.py
```

The deployed function is named `spawn_bot` in the `kathir-world-bots` app.

## Python API

```python
from common import WorldState, connect

client = await connect(LOBBY_URL, "global", name="my-bot")
async with client:
    state = WorldState(client.welcome, client.room)
    async for message in client:
        state.apply(message)
```

The four reusable files are deliberately small:

```text
common/connection.py  lobby admission and authenticated WebSocket
common/deployment.py  shared Modal app and default image
common/protocol.py    typed world messages
common/state.py       current authoritative world state
bots/__init__.py      bot name registry
bots/observer_bot.py  observer behavior
app.py                generic `spawn_bot` Modal function
```

`connect` obtains a lobby ticket and authenticates the WebSocket with
`Modal-Authorization`. A 401/403 causes one fresh lobby admission attempt.
Session tokens and raw WebSockets stay inside `common/connection.py`.

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
