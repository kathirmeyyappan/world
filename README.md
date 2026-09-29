# World mechanics: how the world is built, and what changes for a bigger one

Context for an agent about to work on world size, terrain, buildings, obstacles, line of sight or
procedural generation in kathir world.

> **This may be out of date.** It was written against `main` at `9d32488` (2026-09-29). Treat
> every file path, line number, constant and measurement as a claim to re-check, not a fact.
> Before relying on a section, open the files it names, and grep for the symbols
> (`WORLD_SHAPE`, `worldShape`, `clampToWorld`, `worldDistance`, `EYE_HEIGHT`, `isGrounded`,
> `resolveFire`, `MAX_DISCS`). Also check `git log --oneline -- packages/shared/src/sim` for
> anything newer. If the code disagrees with this file, the code wins. Tell Kathir what drifted.
>
> Known in flight when this was written: PR #64 (`kathir/lag-compensation`, adds
> `packages/shared/src/sim/rewind.ts` and `InputFrame.view`) was open, not merged.

## The mental model in one paragraph

The world is **code, not data**. `WORLD_SHAPE` (`packages/shared/src/sim/world.ts`) is a
hard-coded list of discs and bridges. It is compiled into both the server (Node) and the client
(browser), and it never travels over the wire. Everything that cares about the world asks one
primitive: a 2D signed distance to the outline (`worldDistance`, negative inside). The floor is
flat at y = 0. There is no vertical geometry players can collide with. Combat ignores the world
entirely. Snapshots carry players and cubes only. As a result, map size is invisible to the
protocol and to bandwidth. Terrain and buildings are a **simulation** change (movement, collision,
line of sight) plus a **rendering** change. They are not a protocol change.

## Where the world comes from

- **Shape**
  - `WORLD_SHAPE` holds a main disc (0, 0, r 50), an annex disc (112, 0, r 30) and a bridge from
    (40, 0) to (92, 0), half-width 4.
  - `WorldPart = Disc | Bridge`.
- **Server** (`packages/server/src/index.ts`)
  - Builds one `Room` per session key: the `x-modal-server-session-id` header, or `?room=`
    locally.
  - The Room is built with `seed: hashSeed(key)`.
  - `Room` accepts `opts.worldShape`, but production never passes it, so production always uses
    `WORLD_SHAPE`.
- **Client** (`packages/client/src/game/Game.ts`)
  - Uses `WORLD_SHAPE` directly for `Environment`, `Minimap` and `Prediction`, and for sky
    placement.
  - It does **not** read the Room's `worldShape`, so a per-room shape passed to the Room would
    desync prediction and rendering today.
  - `Environment` and `Minimap` are built in the `Game` **constructor**, before `welcome`
    arrives. A seed-derived world would have to be built on `welcome` instead.
- **Seeds**
  - The Room's `rng` (`createRng(seed)`, mulberry32) drives cube layout, cube wandering and
    spawn points.
  - The client seeds the sky with `createRng(hashSeed(welcome.room))`. `welcome.room` is the
    Room id, which is the same key the server hashed. So **both sides can already derive the
    same seed without a protocol change**.
  - Use a separate stream for world generation (`createRng(hashSeed(roomId))`), not the Room's
    `rng`, because cubes and spawns consume that one.
  - Offline mode is `LocalConnection` in `packages/client/src/net/Connection.ts`. It creates
    `new Room('offline')` with a random seed, but the client hashes `'offline'`. Pass the seed
    if generation depends on it.
- **Bots** (`modal-bots/`) have no copy of the world. `circle_bot.py` orbits the nearest player,
  or (0, 0), at 12 m and relies on the server's clamp to keep it inside.

## Every consumer of the world, and its assumptions

### Shared sim (runs on the server authoritatively and in the browser for prediction)

| Where | What it does | Assumption that breaks with terrain or buildings |
|---|---|---|
| `sim/world.ts` `worldDistance`, `partDistance` | Min over all parts of a 2D SDF | O(parts) per call. Fine for a few parts, slow for hundreds. |
| `sim/world.ts` `clampToWorld` | Pushes a point onto the inset edge of the part it's deepest in | 2D only. Only the outline exists, with no interior obstacles. |
| `sim/world.ts` `randomPointInWorld` | Area-weighted point in a **disc** (bridges never chosen) | Only knows discs. Knows nothing of occupied space. |
| `sim/player.ts` `stepPlayer` | Gravity, jump, move, then `clampToWorld` **only when there is movement input** | Floor is `y = EYE_HEIGHT` everywhere (`pos.y < EYE_HEIGHT` snaps up). `isGrounded` is `pos.y <= EYE_HEIGHT`. No step-up, slopes, ceilings or walls. |
| `sim/cubes.ts` | All cubes live in `worldDiscs(shape)[0]` ("main disc"), wander there, clamped with an 8 m margin | Cubes float at absolute `CUBE_BASE_Y = 3`, not relative to the ground. Their home is hard-wired to the first disc. |
| `room.ts` `spawnPoint` | `randomPointInWorld` with a 3 m wall margin, 4 m from cubes, `y = EYE_HEIGHT` | Would spawn inside buildings or under terrain. |
| `sim/combat.ts` `resolveFire` / `findHit` / `findConeHits` | Ray vs capsules (hitscan), or angle test (cone) | **No world occlusion at all**: shots go through anything. Ranges: gun 20, flamethrower cone 10 (±22.5°), sniper **500 m**. |
| `sim/health.ts` | Capsule from `eye - EYE_HEIGHT` to `eye + 0.3`, head is the top 0.5 | Fine on terrain, since it's relative to the eye. |
| `sim/constants.ts` | `WORLD_RADIUS = 50` (defined but unused), `PLAYER_PADDING = 1`, `MOVE_SPEED = 8`, `GRAVITY = 20`, `JUMP_VELOCITY = 8` | — |

The client runs the same `resolveFire` every frame for the red crosshair (`Game.ts`, `frame()`).
Any line-of-sight change must reach both the Room and that call, or the crosshair will lie.

### Client rendering (`packages/client/src/render/`)

| Where | What it does | Scaling limit or assumption |
|---|---|---|
| `Environment.ts` `createGround` | **One quad** (`span × 6`) with a shader that draws the grid and edge glow per pixel from the SDF | The floor is flat at y = 0 by construction. |
| `shaders.ts` `WORLD_SDF` | GLSL mirror of `worldDistance` | **Hard cap `MAX_DISCS = 4`, `MAX_BRIDGES = 4`** (uniform arrays). Past that, `console.warn` and a wrong floor. |
| `Environment.ts` `createWall` | Ribbon along the outline: 16 m tall, sampled every 0.8 m, revealed within 16 m | Build is O(samples × parts). It starts at y = 0, so on terrain it would float or be buried. |
| `Environment.ts` `createSky` | Sphere of diameter `span × 15`, `infiniteDistance` | Fine. |
| `Engine.ts` | EXP2 fog 0.012 (players fade past ~50 m); render at 1/2 resolution (1/2.5 on touch); glow layer; MSAA 4 + bloom + FXAA | **`camera.maxZ` is never set** (Babylon default 10000), so nothing is distance-culled. The ground shader has its own fog term (`0.00035 × fogScale`). |
| `SkyObject.ts` | Billboards 15–85 m outside the edge, y 25–70, seeded | Depends on `worldBounds`, so it re-places for any shape. |
| `CubeMesh.ts` | 1.8 m boxes positioned from snapshots | Fine. |
| `avatars/Standard.ts`, `Elizabeth.ts` | Root at feet = `pos.y - EYE_HEIGHT` (Elizabeth hard-codes `1.7`), blob shadow at feet + 0.02 | Follows the player vertically. Shadows float or clip on slopes. |
| `Game.ts` `updateHover` | `scene.pickWithRay`, 400 m, filtered to meshes named `cube-` or `sky-`. Cubes are selectable within 25 m. | Scenery must set `isPickable = false`. Babylon also picks on pointer moves unless told not to. Picks would go through buildings. |
| `Game.ts` scope | FOV 1.2 → 0.3; fog thinned to 5% while scoped | Long sight lines across a big map are allowed by design. |

### Client UI and net

| Where | What it does | Scaling limit |
|---|---|---|
| `ui/Minimap.ts` | 112 × 112 canvas. Calls `worldDistance` per pixel **every frame**. NEAR view is ±26 m and rotates; WORLD view fits `worldBounds`. | CPU is 12.5k × parts per frame. At 40× the area, WORLD view is several metres per pixel. Pre-render the static layer. |
| `net/Prediction.ts` | Replays unacknowledged frames through `stepPlayer(…, shape)` on every snapshot | Needs the same world as the server, bit for bit, or it pops (see Determinism). |
| `net/Interpolation.ts` | Remote players and cubes, 3 ticks behind, lerped | Fine. Teleports or elevators show as lerp streaks unless flagged. |
| `Game.ts` reconciliation | Corrections under 3 m are smoothed over about 60 ms; above that it snaps | A collision mismatch shows up as jitter against walls. |

### Protocol, bandwidth and server

- The wire format is `packages/shared/src/protocol.ts`: JSON, a full `snap` every tick (30 Hz)
  with every `PlayerState` and every cube. There is no world data and no deltas.
- **Measured** (scratch script, `Room` with 32 players): a snapshot is 10.6 KB. That's 298 B per
  player, plus 937 B for the 7 cubes.
  - About 320 KB/s down per client.
  - About 10 MB/s egress for a full room.
  - Map size doesn't change any of it.
- Node calls `JSON.stringify` once **per recipient** per message (`packages/server/src/index.ts`,
  `ws.send(JSON.stringify(msg))`).
- Dynamic world state (doors, destructibles, moving platforms) would be the first thing to add to
  snapshots. At that point consider per-client interest filtering or deltas.
- Python bots mirror the protocol in `modal-bots/common/protocol.py`.
  - `_pick` ignores extra fields, so adding fields is safe for them.
  - A **removed or renamed** field raises there.
  - Per CLAUDE.md: change the TypeScript first, then the Python mirror and its contract tests.
- The Room ticks with `setInterval` at 30 Hz, so it has a 33 ms budget. One Node process can host
  several rooms. Per-player collision must be O(nearby), not O(world).

## Invariants any world change must keep

1. **`packages/shared` stays pure**: no DOM, no Node, no Babylon, no time reads, no
   `Math.random` in sim paths. `stepPlayer` must give the same answer on server and client, or
   prediction fights reconciliation.
2. **Determinism across engines.** The server is V8; clients may be SpiderMonkey (Firefox) or
   JavaScriptCore (Safari). The spec lets `Math.sin` and friends differ in the last bits.
   - Today that drift is invisible because the floor is flat and the clamp is smooth.
   - Discontinuous terrain (step edges, collision boundaries) can amplify tiny differences into
     visible pops.
   - Prefer generation from integer or hash maths (`hashSeed`, `mulberry32`, lattice noise with
     `Math.imul`) and store generated geometry as plain numbers.
3. **One source of truth for geometry.** Movement, spawns, cubes, combat line of sight, the
   client crosshair, rendering and the minimap must all read the same generated world object.
   Don't let the shader, minimap or Python grow their own copies without a contract test.
   The GLSL SDF mirror is the cautionary example.
4. **The protocol stays world-free if possible.** Derive the world from `welcome.room` via
   `hashSeed`. Add a `seed` or `worldVersion` field to `welcome` only if generation must be
   decoupled from the room id. A world-version mismatch between a cached client and a new server
   is otherwise silent.
5. **Look stays client-authoritative. Movement, collision, shooting and damage stay
   server-authoritative.** Line of sight belongs in `resolveFire` on the server. With lag
   compensation (#64), targets are rewound but static world geometry doesn't need rewinding.
   Moving geometry would.

## What a bigger world with terrain and buildings actually needs

Ordered roughly by risk. None of it requires touching the lobby, `infra/`, Modal config or
`Interpolation`.

1. **World model and generation (shared)**
   - Add a generated `World` object alongside or replacing `WorldPart[]`:
     - the walkable outline (keep the SDF)
     - `groundHeight(x, z)` (heightfield or seeded noise)
     - static solids (AABBs or oriented boxes to start)
   - Put the solids in a spatial hash or uniform grid.
   - Generate from `createRng(hashSeed(roomId))`.
   - Keep `WORLD_SHAPE` as the default or fixture so tests stay cheap.
2. **Movement (`sim/player.ts`)**
   - Replace the `y = EYE_HEIGHT` floor with `groundHeight + EYE_HEIGHT`.
   - Redefine `isGrounded` (it also gates jump).
   - Add a step-up height and a max walkable slope.
   - Resolve capsule vs solids (slide along faces, like `clampToWorld` does against the outline).
   - Clamp even without movement input, since terrain can move you.
3. **Line of sight (`sim/combat.ts`)**
   - Hitscan: stop the ray at the first solid or terrain hit (ray-march the heightfield, slab-test
     the boxes).
   - Cone: add a line-of-sight check per target.
   - Pass the world into `resolveFire` on both the Room and the `Game.ts` crosshair call.
   - Revisit the sniper's 500 m range against the new map span.
4. **Placement**
   - `spawnPoint`: on the ground, outside solids, with clearance.
   - Cubes: `CUBE_BASE_Y` relative to the ground, and a home that isn't "the first disc".
   - Sky objects: already follow `worldBounds`.
5. **Rendering**
   - Replace the SDF ground shader with a real terrain mesh, or at least bake the outline into a
     texture, since the 4 + 4 uniform cap is the first wall you hit.
   - Build static geometry once, merged per chunk (`Mesh.MergeMeshes` or thin instances), with
     `freezeWorldMatrix()`, frozen materials and `isPickable = false`.
   - Set `camera.maxZ` near the fog distance so frustum culling drops far chunks for free. Keep
     the scope's thinned fog in mind.
   - Put the boundary wall and avatar shadows on the terrain height.
   - Only reach for LOD or streaming chunks if the world is far bigger than 40× or very dense. It
     is all loaded at join, so generation time adds to the loading screen.
6. **Minimap**: render the static floor and buildings once to an offscreen canvas. Per frame, just
   blit it and draw markers.
7. **Bots**
   - With obstacles, `circle_bot`'s straight-line steering will get stuck.
   - Options:
     - stuck detection plus random re-steer (no world knowledge)
     - a Python port of generation with a contract test against the TypeScript output
     - a precomputed nav grid shipped with the bot image
   - Bot aim should respect the same line of sight (the fairness notes in CLAUDE.md).
8. **Tests**
   - `packages/shared/test/sim.test.ts` and `room.test.ts` hard-code the current shape. For
     example, `worldDistance(56, 10) > 0` asserts the gap beside the bridge.
   - Keep them on the fixture shape.
   - Add one test per new behaviour (step-up, wall slide, line-of-sight block, spawn clearance,
     same generated world on both sides). CLAUDE.md asks not to overtest.

## How to check work

- `npm run lint && npm run typecheck && npm test`, plus `python -m pytest modal-bots/tests`, `ruff`
  and `mypy` (see CLAUDE.md).
- `npm run dev`, then open two tabs on the same `?room=`.
- `SIM_LATENCY_MS=120 SIM_JITTER_MS=40 npm run dev:server` shows prediction pops against walls
  under lag. That's the best early warning for a determinism or collision mismatch.
- Headless Chromium (Playwright, swiftshader flags, `/opt/pw-browsers/chromium`):
  - `window.__world.debug()` gives position, remotes and sky.
  - `setLook(yaw, pitch)` aims.
  - `window.__game` is available in dev builds.
- Measure frame time and snapshot size in scratch scripts. Report the numbers in the PR and don't
  commit the scripts.
