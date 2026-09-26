# kathir world

Started as a gamified personal portfolio that only ran on client, and then turned into brainrot after I got my hands on Modal compute. Join with friends and have fun.

---

### Run it locally

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

### Layout

```
packages/shared    @world/shared   pure TS: sim (movement, cubes), protocol, Room host, cube content
packages/client    @world/client   Vite + Babylon: home screen, rendering, input, prediction, interpolation, HUD
packages/server    @world/server   Node: WebSocket room server, one process hosts many rooms
infra/                             Modal: lobby web function + sessioned Room server (Python package)
docs/                              architecture diagrams
```

`packages/shared` has no DOM or Node dependencies on purpose: the same `stepPlayer` runs on the
server (authoritative) and in the browser (prediction), which is what lets reconciliation be exact.

### How multiplayer works

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
upgrade, or by `?room=` when the server runs bare. `docs/join-flow.png` shows how a player gets into a hosted room; `docs/client-timeline.png` shows how the client interleaves frames and snapshots.

### Hosting

The backend is a Modal App in `infra/`: a `lobby` web function and a sessioned `Room` server that
runs the Node room server and also serves the built client. See `docs/join-flow.png`.

```bash
pip install -r infra/requirements.txt   # needs a client with @modal.sessioned(), see the file
modal serve -m infra.app                # or modal deploy -m infra.app
```

Joining goes through a redirect: `GET <lobby>/join/<room>?name=<name>` starts a session and sends
the browser to the Room host with the session token in the URL. Modal's proxy swaps that for a
host-bound cookie, the Room's Node process serves the page, and the game's WebSocket is then
same-origin so the cookie covers it. The page therefore runs on the Room host while playing.

GitHub Pages (`.github/workflows/deploy.yml`) keeps serving a copy of the client at
world.kathirm.com as a launcher: set the `LOBBY_URL` repository variable to the lobby's URL and
its join buttons navigate to the lobby. Without it, that copy offers offline mode only.
