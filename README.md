# kathir world

A small multiplayer 3D playground. Walk around, click the floating cubes to learn a bit about me,
and see whoever else is in the room.

https://github.com/user-attachments/assets/8e9db70c-1969-447f-aa85-abbf5abb1a5d

## Run it locally

```bash
npm install
npm run dev        # room server on :8787 + Vite client on :5173
```

Open http://localhost:5173 in two tabs, join the same room code, and you're in multiplayer.
Invite links look like `http://localhost:5173/?room=<code>`; add `&name=<name>` to skip the form.

Useful while iterating:

```bash
npm run typecheck                  # all packages
npm test                           # sim + room unit tests, and a real-server integration test
npm run e2e                        # two headless browsers in one room (needs Chromium; set CHROMIUM_PATH if not default)
SIM_LATENCY_MS=120 SIM_JITTER_MS=40 npm run dev:server   # watch prediction/reconciliation under lag
```

## Layout

```
packages/shared    @world/shared   pure TS: sim (movement, cubes), protocol, Room host, cube content
packages/client    @world/client   Vite + Babylon: home screen, rendering, input, prediction, interpolation, HUD
packages/server    @world/server   Node: WebSocket room server, one process hosts many rooms
modal/app.py                       Lobby + sessioned Room servers on Modal (not wired up yet)
docs/                              architecture diagrams
```

`packages/shared` has no DOM or Node dependencies on purpose: the same `stepPlayer` runs on the
server (authoritative) and in the browser (prediction), which is what lets reconciliation be exact.

## How multiplayer works

- The client samples input at 30 Hz into numbered `InputFrame`s, applies each one locally right
  away (prediction), and sends it to the room.
- The room ticks at 30 Hz, applies each player's queued frames with the shared sim, steps the cubes,
  and broadcasts a snapshot of everyone.
- On each snapshot the client rewinds its own player to the server's state and replays the frames
  the server hasn't acknowledged yet. Any residual difference is smoothed out over ~60 ms.
- Remote players and cubes are rendered 3 ticks behind the newest snapshot, interpolating between
  the two snapshots that bracket that time.
- Look direction is client-authoritative; movement and jumping are server-authoritative.

Rooms are keyed by the `x-modal-server-session-id` header the Modal proxy stamps on the WebSocket
upgrade, or by `?room=` when the server runs bare. `docs/multiplayer-flow.png` shows the full
request and token flow for the hosted setup. If the page is served somewhere without a lobby
(GitHub Pages, for now), the home screen offers an offline mode that hosts a room in-page.
