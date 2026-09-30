# Modal bots

Headless Python players. They join through the same lobby and Room as browsers and speak the
same WebSocket protocol; there is no spectator mode, so a bot is a visible player with a seat.

## Run one

```bash
modal secret create kathir-world-bots-config WORLD_LOBBY_URL=https://your-lobby.modal.run   # once
modal run modal-bots/app.py --bot observer --room global --seconds 30
modal run modal-bots/app.py --bot circle --room global --seconds 30
```

Or from the game's chat: `/circle-bot 60`, `/stalker-bot` (300 s by default, 3500 max). The room
server spawns the same `run_bot` function; see `CLAUDE.md`.

- `observer` joins, stands still, and returns a report of what it saw. `modal run` only.
- `circle` orbits the nearest live player at 6 m, or the world origin when alone.
- `stalker` stands still and turns to face the nearest person.

## Add one

Create `bots/<name>_bot.py` with `run_<name>_bot(...)`, register it in `bots/__init__.py`, and
build on `common/` (`connect`, `WorldState`, `Controls`, `run_input_loop`, the log helpers).
The contract, lifecycle and checklist are in the repository's `CLAUDE.md` and `AGENTS.md`.

## Tests

```bash
python -m pip install -e './modal-bots[test]'
python -m pytest modal-bots/tests
```

The suite starts the real local Node room server; nothing touches Modal. The deployed flow is
opt-in:

```bash
RUN_MODAL_BOT_SMOKE=1 WORLD_LOBBY_URL=https://your-lobby.modal.run python -m pytest modal-bots/tests/test_production_smoke.py
```
