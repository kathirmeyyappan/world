# kathir world

Babylon.js multiplayer 3D playground. `packages/shared` is the pure sim + protocol + Room,
`packages/client` the Vite renderer, `packages/server` the Node host, `infra/` the Modal deploy.

## Pull requests

- Anything visual gets screenshots in the PR description. Push the images to the orphan
  `screenshots` branch under `pr-<number>/` and embed each one in the description as an image,
  `![alt](https://raw.githubusercontent.com/kathirmeyyappan/world/screenshots/pr-<number>/<file>.png)`,
  so it renders inline rather than as a bare link.
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
`stairs`, `building`, `terrain`, and the round pieces `roundWall`, `spiralStairs`, `roundFloor`) in
`packages/shared/src/sim/structures.ts`. The sim collides with them through
`sim/collision.ts` (standing, walls, ceilings, line of sight) and the client draws the same list
(`render/Structures.ts`), so adding an entry is the whole job. Nothing about structures goes over the
wire: server and client both build the world from that file.

### Adding structures

- Use the helpers rather than hand-computing yaw and centres: `wall(a, b, h)` runs between two floor
  points, `ramp(low, high, h, w)` rises from `low` to `high`, `ladder(foot, y, top, yaw)` stands a
  ladder on `foot` up to `top` (see Ladders below), `stairs(bottom, top, h, w)` is solid
  steps players walk up without jumping (the camera eases over each; with `thickness` and `rail`,
  a railed flight in the air, like the staircases up to the terrace), `building({...})` is four
  walls, a doorway and a roof, and `terrain({ height })` samples a function. The round pieces:
  `roundWall` (straight segments at any base height, with gaps for doors and windows), `spiralStairs`
  (with an optional inner rail so players can't step off the inside) and `roundFloor` (gap-free rings,
  with an optional hole for a stair coming up from below, ending exactly where the stair does, and
  with `inner` only the ring outside it, for a balcony or a roof open in the middle). Write raw `{ kind: 'box', ... }` only for simple platforms
  and pillars.
- A landmark gets its own content file exporting its list (Tung Tung Tower is `content/tower.ts`,
  `TUNG_TUNG_TOWER`), with its dimensions as named constants at the top and a comment per group of
  pieces; `content/structures.ts` just spreads the landmarks together. Tung Tung Tower and Buildings
  2 to 4 (`content/buildings.ts`) are all one round keep (`content/keep.ts`): a layout of four
  floors (each one's doors and where its flight starts), stacked from the ground and turned to face
  the way in. The tower stacks all four and a building stands one of them alone (Building 2 the
  ground floor, Building 3 the first), so a floor is the same room in both, stair and murals alike;
  change a floor there and both follow. Building 4 stands a bare keep until it gets a structure of
  its own.
  Building 1 is SpongeBob's house (`content/pineapple.ts`), two models the client draws (see Models
  below) on a dune of sand: the pineapple outside and, behind a door you click, the rooms of the
  game inside (living room, closet, kitchen, bathroom, the bedroom upstairs, the library on top; the
  living room's side door, painted shut in the model, is dug through to the dune), joined by a stair
  of the sim's round the back of the house (out of the kitchen's back door, clear of the shell with
  rails both sides, up to a balcony at the hall's door); upstairs a corridor runs from that door
  along the bedroom and round the bathroom, walled off from the rest of the hall, the ground
  floor's closet and bathroom are copied off the bedroom, and a straight stair of solid steps
  climbs from the corridor's end through the hall's ceiling to a hole in the library's floor, open
  along the corridor and walled both sides and roofed over from where the corridor's wall meets it
  (`house_interior.py` lays it out, the sim stands its steps); high in the library's wall a round
  hatch opens onto a railed platform, with a slide curving down from it along the wall to the floor,
  as the show has them (the generator cuts the wall, builds the tube, the door, the platform and the
  slide's trough, and gives the sim the slide as ramps);
  through it a brick lobby outside the wall, where a flight winds up each way to a gallery round
  the plastered cylinder standing on the library's ceiling, with doorways into it, and inside the
  attic stair spirals up through the crown to a railed deck on top (`content/pineapple.ts` stands
  all of that from the profile, in the hollow top of the shell);
  the sim collides with boxes cut from every surface of the rooms, hidden rings for the shell,
  walls along the flat faces carved round its doors, and the path's flagstones as ramps lying with
  the dune.
  The terrace (`content/terrace.ts`) is reached from the keeps:
  the tower's sky bridge, and a staircase from each keep's roof. A piece you'll reuse (a
  staircase, a round wall) is a function returning `Structure[]` in `sim/structures.ts`.
- Coordinates are world metres, yaw 0 facing +z. The playable outline is `WORLD_SHAPE` in
  `sim/world.ts`, with its parts in `sim/outline.ts`: the main disc (r 50 at the origin), the annex
  (r 30 at x 112) and the bridge between them, the four buildings' grounds and paths (the annex
  and that bridge turned round the main disc to 90°, 150°, 210° and 270°), and an arc through all
  four grounds, twice a path's width. A part is a disc, a straight `bridge` or a curved `arc`. Players are clamped 1 m inside it no matter what, so keep structures inside too.
- Size things to the player: eyes at 1.7 m, head at 2.0 m, radius 0.35 m, steps up to 0.5 m climb on
  their own, and a running jump lands on tops up to about 1.9 m (make anything meant to stop a jump
  2.1 m or taller). Doorways at least 1.2 m wide and 2.2 m tall; ramps no steeper than about 30°;
  walls at least 0.3 m thick.
- Spawns land in `SPAWN_AREAS` (`content/regions.ts`: the middle of the main area and its side facing
  the tower), each as likely, standing on the ground (or anything within a step
  of it) with headroom, so a building's ground floor can be a spawn point and roofs, decks and wall
  tops never are. Info cubes wander the main disc at about 3 m and
  pass through structures, so tall pieces there will have cubes floating through them.
- Seal what players walk on: a floor with gaps drops people through it. Give each floor a single
  hole where its stair arrives (`roundFloor`'s `hole`), and leave headroom over the flight below it:
  the hole has to cover the stretch where the stair is within about 2.7 m of the floor above.
- Terrain: keep edge heights at 0 so it meets the floor (no side walls are drawn), and keep sample
  grids modest (the default is one sample every 2 m); every sample is a vertex.
- Looks: set `material` to a pixel texture (`brick`, `wood`, `red-tile`, `flagstone`, `sand`,
  `plaster`; each is a painter in `packages/client/src/render/structureMaterials.ts`, and a new
  one is another painter there). `color` is a flat fallback. Structures are unlit and shaded by face direction, so
  they look the same inside and out; don't reach for lights. `hidden` pieces are collided with but
  never drawn: the shape of something the client draws its own way.
- Coplanar faces: two faces that overlap in the same plane and point the same way z-fight, and the
  flicker shows wherever they paint different pixels. Structure textures are mapped from the world
  origin, so pieces of one look (with `worldTop` for their tops) paint identical pixels there, which
  is what lets the helpers overlap their joints. Anywhere else (two looks, or tops mapped in each
  piece's frame) keep faces out of one plane: drop one piece a couple of centimetres (a door sill
  under a floor, a stair's landing step, a bridge deck under a balcony, a wall or flight under a
  floor of another look stopping inside its slab) or stand it on the other rather than beside it
  (a stair's rail posts); where pieces of a plank look have to overlap (the deck's sectors), set
  `worldTop: true` on them so their tops map alike. The same goes for anything else the client
  draws: never lay a decal, glow or second mesh exactly on a surface.
- Client cost: the renderer merges pieces with the same look in the same 48 m square into one mesh,
  so draw calls stay in the tens however many pieces there are. The world's 11,913 pieces (5,576
  drawn; the house's rooms are 3,937 hidden boxes and its shell 2,400 hidden ring pieces) render as
  77 meshes (about 15 in view at once), and a raycast tries the pieces a stretch of grid cells at a
  time, so one across open floor costs a few µs and one through the house about 130 µs. The sim's
  grid has height bands as well as cells, so a walker's tick pays only for the pieces at its own
  height (about 70 µs inside the house). Check both numbers in the PR when a landmark adds a lot.
  Everything heavy is streamed in through `render/Loader.ts` (see Models below).

### Ladders

A ladder (`sim/structures.ts` `ladder`, kind `ladder`) is an upright frame of two rails and rungs,
`LADDER_WIDTH` across and `LADDER_GIRTH` through, climbed from either of its faces (its local ±z);
to everything else it is a thin box, and it never frosts. A walker holding forward (W) within
`LADDER_REACH` of a face, between the rails, facing it, takes hold (`walker.ts` `takeHold`,
`PlayerState.climb`: the piece and the face, ±1) and climbs at `CLIMB_SPEED` on W and S, nothing
pulling it down: holding up at the top steps it over onto whatever is beyond the ladder there (so
the library's ladder, against the hatch platform's rail, tops out at the rail's top and lands you
on the rail), holding down at the foot, or onto anything under the feet, steps it off, a jump is
straight up and off (hold forward on the way down to take hold again), and A or D (the `swap-left`
and `swap-right` actions; the touch SWAP button is A's) goes round to the other face by the
ladder's left or its right, where a body fits there (where it doesn't, a rail at the top say,
taking hold from that side goes through to the face with room); `climb.way` keeps which way, for
the swing. Fitting is the whole body, its width and all (`Structures.fits` with the body's
radius), and the climb itself goes only as far as the body fits, so a face under a floor is climbed
only up to the floor's underside and no swap goes through a rail standing against the ladder.
Weapons work as on the ground. The look is client-authoritative, so the client holds it within a
quarter turn of facing the ladder while climbing and turns it round with a swap (`Game.holdLook`),
the camera swinging after it; every avatar on foot squares up to the rungs, steps them with
whatever legs it has and reaches up with its free hand, points its weapon arm where the look goes,
and swings half a turn round the ladder on a swap (`render/avatars/Walker.ts`). Bots' map treats a
ladder as a wall.
The one ladder stands in the library (`content/pineapple.ts`), from the floor to the hatch's
platform, since the slide is no way up.

### Surfaces and frost

A structure's `material` is its look; its `surface` (`sim/surfaces.ts`) is what it's like underfoot:
`hard`, `sand` or `ice`, named on the piece or implied by its material (`MATERIAL_SURFACES`: sand
is sand, everything else hard; the bare floor is hard). A `SurfaceSpec` is its `grip` (m/s², how
fast the feet can change the walk's velocity; `Infinity` is a sure footing, where the walk goes
exactly where the keys send it, as every surface did before) and its `footfall` (what a step on it
sounds like: `thud` or `crunch`). On a footing with finite grip the walker keeps its momentum
(`PlayerState.vx`, `vz`): the feet push toward the keys at the grip, never past the walk's speed,
slow it at that rate with none held, and gravity pulls it down any slope harder than they can hold
(`walker.ts` `slide`, capped at `SLIDE_SPEED`), so an icy 15° slope can't be climbed and the
library's slide is ridden. The keys steer the walk in the air as on the ground, unless it was
thrown (`PlayerState.thrown`, `walker.ts` `throwWalker`): a throw joins a velocity to the walk's
and, until it lands, leaves the keys only the throw's grip to bend the flight with. Ice throws:
it pushes back only square to itself, so a jump off it goes along the ice's normal (straight up
on the flat, partly downhill on a slope) with what the walk had, stepping off it is a throw too,
and both leave the keys the ice's grip, so a hop up a steep icy slope is thrown back down while a
shallow one can be hopped up. A weapon's knockback or a bounce is a `throwWalker` call with the
grip it leaves. A jetpack's thrust is something to push against, so it steers through any throw. `Structures.footing(x, z, reach)` is the ground, its piece, its surface
and its slope at a spot, and the client's `Footsteps` asks it at each footfall for the sound
(`FOOTFALLS` there maps a footfall to its recordings; a gait with sounds of its own keeps them).
The legs, footsteps and head bob are paced by `PlayerState.walk`, how fast the feet walk: the
keys' walk on a slippery footing (feet scrabbling on ice at full pace while the body crawls, and
standing still while it slides), the body's own anywhere else (none against a wall).
A new surface is a row in `SURFACES`, and with a new footfall, its sounds in the client. On a
slippery footing a tick the server runs without a frame (one arriving late) moves the walk too,
so `correction` can show a tick's worth of slide there; on a sure footing it stays 0.

Frost (`sim/frost.ts`) is ice laid over surfaces by an ice spray and melted by fire, kept by the
Room like the doors (`Structures.frost`, its own per room) and sent to every client (`welcome.frost`,
then `frost` messages with the cells that turned). It lies in `FROST_CELL` squares on a grid from
the corner of each face of a piece (its top, underside and four sides, numbered 0 to 5; the floor
from the origin, as piece `FLOOR`), a cell on the wire as `[piece, face, i, j]`. A frosted top is ice
underfoot whatever the piece is made of, under the spot or under any of the body's width round it,
so a hole smaller than a body doesn't catch a slide, and on whichever of the pieces whose tops meet
in one plane there the spray landed on (the house's hidden floor boxes lie in the dune's sand). On every shot of a hold weapon with an
element the Room casts `sprayFrost`: a dozen rays spread over the cone (a low-discrepancy sequence,
each shot's between the last ones'), each landing (`Structures.touch`, which says which face)
turning the cells under its blot on that face (`Blot`: `SPLAT` across at the least, `SPREAD` of
the spray's width where it lands, and drawn out along the ray where it meets the face at a glancing
angle, as a spray skimming the floor does), so a shot or two frosts the patch in front of you
solid and a level spray lays a long tongue along the ground. Doors never frost (they swing); hidden
pieces do, so the house's rooms frost where the model draws them. Frost never thaws by itself; past
`MAX_FROST` cells the oldest melt. The client draws every cell as a crust a hair off its face
(`render/Frost.ts`, from `frostQuad`, merged by region like the structures and rebuilt the frame
after a change): a translucent glaze with crystals that glint and twinkle, the surface showing
through it.

### Models and doors

A landmark too shapely for boxes is a model: a mesh the client draws from files in
`packages/client/public/assets/models/<model>/`, its meshes and textures together, written by a
script in `packages/client/scripts/` (`house-model.py` makes the pineapple from two Sketchfab
GLBs: the outside turned afresh as a smooth lathe through one model's rings, flattened into an
upright face round each door, with a steel vestibule behind the front doorway and its door a flat
slab on a pin at its edge; and inside, the other model's rooms at half scale, in their own textures packed
into one atlas, with the hall round the bedroom and the stairwell up into the library built to join
them, `house_interior.py`; both written out mirrored in x, glTF's frame being right-handed and
Babylon's left-handed) along with a profile of its shape for the sim (`content/pineappleProfile.ts`:
the shell's rings, the levels, the stairs and every door) and the boxes the rooms are cut into on a
quarter-metre grid (`content/pineappleInterior.ts`, floors, walls and furniture alike). The sim never
sees a mesh: the content stands those as `hidden` structures (`content/pineapple.ts`, with rings for
the solid shell round the rooms) and the renderer skips them, so what you bump into is the
generator's to keep true to the models. `render/models/Models.ts` fetches each part listed in
`render/models/pineappleParts.ts` (generated too) and hangs it where the content's placement says,
a door's on a node at its pin.

Nothing is fetched at startup. `render/Loader.ts` streams the world in: anything heavy that stands
somewhere (a region's structure meshes to build, a model part to fetch) registers with where it is,
and each frame the nearest thing not yet begun is begun, so the player is in the world at once and
it fills in round them nearest first, the far side within a second or two. Nothing waits on
distance (a scope sees the far side as sharp as the near); the loader only sets the order. Register
a new model or any big build with it rather than loading it in the constructor.

A door (`sim/doors.ts`) is a slab on a hinge, shut or swung open, kept by the Room for everyone:
`doorPieces` makes its two hidden structures (where it stands shut, where it stands open), each
marked with the door and its state, and `Structures.setDoor` turns them on and off, so collision
and line of sight follow the door and prediction agrees. A click on a door within `DOOR_REACH`
sends `InputFrame.use`; the Room checks the look reaches that door, swings it, and broadcasts
`door`, which clients apply to their `WORLD_STRUCTURES` and to the model's door node (the swing
plays over `DOOR_SWING_SECONDS`). Bots' map leaves doors out, so they walk as if every door stood
open. A Room keeps its own `Structures` for this; the client's `WORLD_STRUCTURES` is its page's.

### Wall frames

Murals hung inside a round room (the tower's floors) are listed per floor in
`packages/shared/src/content/towerFrames.ts`, and each floor's hang in both the tower's room
(`TUNG_TUNG_TOWER_ROOMS`) and the building that is that floor alone (`BUILDING_ROOMS`). Each is an
`angle` in degrees from the main entrance (to your right as you stand in the middle facing it), a `height` in
metres, and what it `show`s (an image's path, or a live `widget` by name; its aspect; and the
`line` typed out while you look at it), with `crt: true` to play it like an old screen (faint bands
rolling down it and a little static, animated by CSS alone). The width is height times aspect, and every frame is centred halfway up its storey (the
room's `middle`: 10 m up on the ground floor).
`layoutWallFrame` (`sim/wallFrames.ts`) lays one out as a flat panel per wall segment it crosses, a
few centimetres off the brick, and throws if it doesn't fit between floor and ceiling, comes down
over a doorway, or crosses the stair (whose steps must pass well under it or over it);
a test hangs every listed frame, so a bad one fails CI. Only the client draws them
(`render/WallFrames.ts`, picture on a wood border); nothing collides with them and they're not
structures, so the bot map doesn't change. The browser draws each frame's picture at full
resolution (and without the scene's tone mapping) in a layer under the 3D view, one slice per wall
panel, seen through a hole the frame's mesh cuts in the depth buffer (`render/CrispPanels.ts`), so
it stays sharp while walls and players still cover it.

A widget is a copy of one at widgets.kathirm.com that the client draws itself
(`packages/client/src/widgets/`): it fetches the same data the web widget does and paints the same
layout onto a canvas, fetching and animating only while its frame is in view. One longer than its
frame (the anime activity list, floor to ceiling on the tower's first floor and in Building 3)
lays out as a page and scrolls with the mouse wheel while you look at it (`Widget.scroll`). A new
one is a name in `WidgetName` (`sim/wallFrames.ts`) and a factory in `WIDGETS`; its data source has
to allow the game's origin (CORS), and any image it paints has to come with CORS headers too, or
the canvas can't become the frame's texture from afar.

### Regions and pickups

- A region (`sim/regions.ts`) is a disc, a ring (a disc with a hole) or an axis-aligned rectangle on a
  floor at height `y`.
  Landmarks export theirs (a keep's `levels`: each floor inside its stair and its roof, so the
  tower's `TUNG_TUNG_TOWER_LEVELS` and the buildings' `BUILDING_LEVELS`; the terrace's
  `TERRACE_DECK`) and `content/regions.ts` names the ones the game uses (`MAIN_AREA`, `TERRACE`,
  `TOWER_LEVELS`, `BUILDING_LEVELS`, `SPAWN_AREAS`). Anything that spawns somewhere picks its spot with `randomPointInRegion`, so
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
the real sim (`sim/botMap.ts`, about a minute): the structures, the walkable graph, the lookouts,
and every avatar's hitbox. Rebuild it and commit the new map with the change whenever any of those
inputs move: a structure or landmark added or changed, the world's outline, the player's body or
movement constants, or an avatar added or its hitbox resized. A test in `sim.test.ts` fails until
you do (the map carries a fingerprint of all of them).

Cubes don't know about structures, and the minimap shows only the footprints in
`content/landmarks.ts` (grey on the floor, a disc's `rings` drawn inside it: Tung Tung Tower has one
per floor above the ground), and with your feet past `HIGH_UP` (35 m) `HIGH_LANDMARKS` too: the
terrace, the sky bridge and the staircases. List a landmark's there when it's worth navigating by.

## Avatars

An avatar is a row in `AVATARS` (`packages/shared/src/sim/avatars.ts`: name tag, command, eye
height, hitbox) and a builder in `packages/client/src/render/avatars/` (`WALKERS` in `index.ts`,
which the compiler asks for). Everyone on foot is a `Figure` (`render/avatars/Walker.ts`): the
builder makes the avatar's parts under the base node and says which plays which role (what tips
with the look, a head, the legs, the free arm, the weapon arm with its grip and the way it reaches
in the model) and the numbers its walk takes (swings, bob, sway, how it lies dead), and
`WalkerAvatar` poses every figure the same way: standing, walking, aiming what it holds, falling,
climbing a ladder and lying dead. Motion is written there once, for all of them, and an avatar's
own touches (a tail, a twitch, feet that lift) are its `extra` hook. A body that differs by a
number (how far a leg swings, a two-part tentacle, no legs at all) is still a figure; one that
differs by a rule (a sidestep, a slither, tentacles wrapping the rungs) extends `WalkerAvatar` and
overrides that one phase (`walk`, `climb`, `lie` or `aim`), registered in `WALKERS` by its class,
and the walker never asks which avatar it is posing. A Sketchfab
model goes through `packages/client/scripts/avatar-model.py` into a `<name>Model.ts` and a texture
atlas (`public/assets/textures/avatars/<id>.png`, listed in `SKINNED` in `render/avatars/index.ts` so
it's fetched at startup); a trunk on two arms and two legs is a `BodySpec` (`Body.ts`). Rebuild the bot map after
adding one, and keep it as cheap as the ones there (triangles, one mesh, a small atlas), with the
numbers in the PR.

Its walk is a row in `GAITS` (`render/avatars/gaits.ts`): the metres between its footfalls, which pace
its step sounds and its limbs alike, what a footfall sounds like (the thuds, a bar of its own sounds,
or a loop), and the sounds' pitch; the swing of its limbs is the renderer's. Ask for each when adding
one.

Craft a character with love: look at it in every state before the PR, and put the shots in it.
Standing, walking, holding and aiming each weapon, firing, hit, dead, on a ladder; from the front,
the side and behind; and your own body in third person. The model's bind pose decides how the arms
hang (`armsDown`) and where the palm is (`model.hand`), and a held gun has to sit in the hand with
its barrel along the look: the weapon arm is turned from its `reach` (shoulder to hand as the model
holds it) to the look, and the grip at its hand turned so the barrel runs that way.

## Player classes

A class is what kind of body a player has (`packages/shared/src/sim/classes.ts`): every avatar names
one (`AVATARS[id].class`), and `stepPlayer` applies the look and the held item every class shares,
then the class's own `step`. A `ClassSpec` carries everything the Room, the client and the bots need
to treat the class on its own terms: a full life and its HUD rows, whether it takes the kit (weapons
by command, gear, `/speedy`), whether bots may wear it, how long its dead body stays in the room
(outliving the socket), its own tap actions on keys of their own (reported in `InputFrame.actions`
like an item's and announced by the Room as `action` messages), whether it `fits` where a player is
switching into it, `enter`/`exit` for its own state on `PlayerState`, its `hitShape` for shots (a
capsule or spheres, `combat.ts`), and where a dead one `lies` for the hearts it leaves. The walker
(`walker.ts`) is everyone on foot; the dragon (`dragon.ts`) is a head sphere flying where its rider
looks with a spine of points following it, kept 5 m up and too big for a door, its head turned
toward the look only as far as the neck lets it, breathing a wide cone where the head points
(`firebreath`, the look's own item) and roaring on A, S and D; a new one climbs straight out of the
ground, head up, until its whole spine is out. Its rules and numbers are constants at the top of
that file. `becomeAvatar` (`player.ts`) is the one way a player changes
look: a new class is a new body at the same eye point, with hearts in proportion.

A new look in a class is a row in `AVATARS` (with `item` for one that comes with its own weapon,
`regen` for 5 hearts back every 7 s, `hidden` to keep it out of the menu). A new class is a spec
and its sim in a file of its own, a case in `PlayerClass`, and a row in `CLASSES`; nothing else
has to know it exists, except the client's `createAvatar` for how it's drawn and `VIEWS`
(`game/View.ts`) for how it's seen. The dragon is drawn by `render/avatars/Dragon.ts` from a model
`scripts/dragon-model.py` rigs along the spine (its docstring says how); the GLB helpers both
model scripts share are in `scripts/glb.py`. Its roars are `ACTION_SOUNDS` in `audio/Sfx.ts`, and
its theme and the cry it rises with are rows there too.

## Weapons

A weapon is a row in `ITEMS` (`packages/shared/src/sim/items.ts`: range, damage, cooldown, its
actions and their keys, the shape of its fire, its `element` and its tank), a shape in the client's
`render/Weapons.ts`, and a sound in `audio/Sfx.ts` (`ITEM_SOUNDS`). A hold weapon with an element
gets its tank on the back and its jet at the nozzle from that alone, on every avatar and in the
viewmodel (`render/Jet.ts`: blocks of fire, or for ice the "+" crystals of a corpse's poof, drawn as
one particle system). What a hit does besides its damage is the Room's (`room.ts`, `applyActions`;
a hit that throws its victim is a `throwWalker` there, see Surfaces and frost):
ice chills for `CHILL_SECONDS` from the last touch (`sim/constants.ts`), a walk at
`CHILLED_SPEED_MULTIPLIER` counted down in `stepPlayer`, so prediction agrees, and fire's touch
thaws it at once, as it melts frost (see Surfaces and frost). On the client
`HitFlash` frosts a chilled body over, and `ui/Condition.ts` shows the chilled player the counter
with the view frosted.

## Adding a Modal bot

Keep this section synchronized with `AGENTS.md`. A bot is a headless Python client in
`modal-bots/bots/`; it joins the same authoritative Room as browser players and receives the
same WebSocket protocol. It has no renderer, browser interpolation, or visual picking.

### Required contract

A bot runs on one of the bots app's two Modal workers, and its signature is what that worker gives
it. A dumb bot (circle, stalker, observer) runs on `run_dumb_bot` and satisfies `DumbBotInvocation`
in `modal-bots/bots/__init__.py`; a combat bot (the sniper) runs on `run_combat_bot` and satisfies
`CombatBotInvocation`, which adds the world map and `targets`, the parts of player names it goes
after (any case; empty means every person). Make a bot a combat bot when it needs to see past walls
or find a way around, or takes names from chat.

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

- Put it in `modal-bots/bots/<name>_bot.py` and call it `run_<name>_bot`.
- Call `validate_duration(seconds)` before starting work.
- Return a JSON-serializable dictionary. Never return a live connection, dataclass, task, or token.
- `lobby_url` is used in production. `direct_ws_url` exists only for local tests.
- Pass `spawn` and `avatar` straight through to `connect` (see the placement fact below).
- Do not add a Modal decorator to a bot. The workers in `modal-bots/app.py` choose a registered
  invocation, supply the lobby URL from the `kathir-world-bots-config` Secret and, for a combat
  bot, load the map once per container.

Register the function explicitly in `modal-bots/bots/__init__.py`:

```python
from .example_bot import run_example_bot

DUMB_BOTS = {
    "example": run_example_bot,
    # ...
}
```

A combat bot goes in `COMBAT_BOTS` instead.

The registry key is the `--bot` CLI value; the in-game player name is `<key>-bot` unless the caller
names it (`-n` in chat, `--name` with `modal run`). Do not use dynamic module
discovery: an explicit registry is easier to audit and gives invalid names a deterministic error.
No change to `app.py` should be needed for an ordinary bot.

### Use the shared runtime

Bots must use the modules under `modal-bots/common/`:

- `connect(...)` owns lobby admission, session-token redaction, authenticated WebSocket setup,
  one retry on stale authentication, welcome validation, JSON transport, and clean close.
- `WorldState(connection.welcome, connection.room)` owns the latest authoritative players, cubes,
  health, deaths, and server tick. Apply every received message before making the next decision.
  `state.nearest_player(people_only=...)` is the closest living player in a straight line.
- `Controls(connection)` owns input sequence numbers and persistent input intent.
- `run_input_loop(controls, stop)` sends that intent at the server's 30 Hz tick rate without drift.
- `log_kill`, `log_death`, and `log_message` write structured JSON to Modal's normal function logs.
- `load_world_map()` (`common/world.py`) is the world's structures and walkable ground, shared by
  every bot in the process. `world.clear(a, b)` is the sim's line of sight (what a shot can pass);
  `world.node_at(feet)` and `world.path(start, goal)` find a way between the spots a player can
  stand on a 1 m grid, up the stair and over the rail where only a jump gets there.
  `Route(world, path, tick)` (`common/navigation.py`) walks it: call `route.steer(me.pos, tick,
  controls)` on every snapshot after `look`, and plan again when `route.stuck(tick)`.
  `controls.walk_toward(origin, target)` moves toward a point whichever way the bot is looking.
  `world.lookouts` are the high spots with a wide view (balconies, decks), `world.places` the
  same by where they are (`tower`, `building` or `elsewhere`), `world.insides` the floors inside
  the tower's and the keeps' walls and `world.indoors` every spot within those walls (the stairs
  too), and `world.hitbox(avatar)` is what a shot at that avatar has to land in (head band included).

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
controls.fire_once()                # one press frame, aimed where it looks now; the next releases it
controls.shoot(True)                # persistent hold, e.g. flamethrower
controls.shoot(False)
controls.scope(True)
controls.thrust(True)               # hold a worn jetpack's lift (after /jetpack)
controls.read_cube(cube_or_id)
await controls.chat("hello")
await controls.command("sniper")    # sends /sniper
```

There is no generic server-side click message. Browser cube clicks are local visual picking and
become the `reading` field; use `read_cube`. Attack clicks become the `shoot` action; use
`fire_once` or `shoot`. Sky-object clicks are entirely client-side and have no server interaction.

Tap weapons require a press frame followed by a release frame. Hold weapons require `shoot` on
every frame. Sniper shots require scope to remain enabled, and a scoped player walks at 30% speed
and can't jump. Run exactly one input loop per connection; never call `send_input()` concurrently
from multiple tasks.

### Active-bot lifecycle

An active bot generally has one receive loop and one input task:

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
`circle_bot.py` does). A death from `/kill-bots` has no kill event, so react to `state.me.dead`,
not to the event. A bot that should respawn instead must close, wait for the chosen respawn
delay, and call `connect` again. Reconnection creates a fresh player ID; there is no resume
protocol.

### State and combat facts

- Snapshots arrive at 30 Hz and contain exact global player and cube state. Bots do not need
  browser interpolation.
- Look is client-authoritative; movement, jumping, shooting, damage, and death are
  server-authoritative.
- `Player.pos` is the body's eye point, 1.7 m up whatever the avatar, in three dimensions: structures
  put players on floors, stairs and bridges, so `y` varies (feet are at `pos.y - 1.7`). Use
  straight-line distance, not `x`/`z` only, when choosing targets. Yaw `0` faces `+z`; positive pitch
  looks down, and `look_at` aims in 3D. An avatar's own eyes (`AVATARS[id].eye`;
  `world.eye_of(player)`) may sit higher or lower, and its wearer looks and shoots from there, so aim
  from `world.eye_of(me)`.
- `Player.hearts` and `Player.kills` are the scoreboard; `Player.dead` stays true until the
  server drops the seat.
- Snapshots carry the floating pickups (`state.pickups`); walking into a heart below full health
  gives back 3 hearts, up to 10, and a `big-heart` (left where someone died) all 10.
- Falls hurt by landing speed: slower than a 15 m drop from rest is free, as fast as an 80 m drop
  takes every heart, and damage rises linearly between, in half hearts (a jetpack that brakes the
  fall lands slower). That arrives as a `hit` with `shooter: None`, and a fatal fall as a `fell`
  event rather than `kill`.
- Snapshots reveal players globally, and shots pass through cubes; only structures block them. Perfect aim
  can therefore be much stronger than a human player. Fairness constraints such as field of view,
  reaction delay, aim error, and respawn delay belong in bot policy, not in connection code.
- Shots are lag-compensated: `Controls` sends the newest snapshot tick as `view`, and the server
  judges the shot against where targets were at that tick (`packages/shared/src/sim/rewind.ts`,
  at most `MAX_REWIND_TICKS` back). Aim at the snapshot you have; don't lead.
- A room seats 64 players, at most 32 of them bots. A bot is a visible player and occupies a seat. `connect` joins with
  `bot=1`, so `Player.bot` is true for every bot, the roster shows a robot icon, and a room with only
  bots left closes like an empty one (the server disconnects them).
- A bot may choose where it spawns and how it looks: pass `spawn` (a feet position, `Vec3`) and
  `avatar` through to `connect`, which puts them on the join URL. The Room honours them for bots only,
  clamping the spot inside the world and standing the bot on anything within a step of it, or
  leaving it in the air there to fall (and take the fall's damage); the avatar is
  fixed for the run. Any avatar whose class takes bots works (`classes.ts`; a dragon's is refused),
  including one with no chat command (`AVATARS[id].command` null) that people can't switch to.
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

`/circle-bot`, `/stalker-bot` and `/sniper-bot` start a bot in the caller's room, within 50 m
of them across the floor and at their height: on whatever is there within a step, or in the air to
fall from, never inside a wall. The sniper ignores the spot and starts indoors, in the tower or a keep. The `-bot` is optional where the bare word
isn't already a command (`/circle`, but `/sniper` is the rifle). Flags go in any order, each at most once, and each has a long form too
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
`packages/shared/src/sim/defaultBots.ts` (`defaultBotsFor(room, rng)`: two circle bots anywhere, each in a different look drawn from `CIRCLE_LOOKS`, and a
Tung Tung Tung Sahur stalker in the middle of each of the tower's lower three floors), all staying 3500 s. Each entry may carry a
`BotPlacement` (`spawn`, a feet position, and `avatar`); edit that function for per-room profiles.
The Room spawns them once, with `caller: 'room'`.

### Modal and dependency constraints

- Configure the lobby once with the Modal Secret `kathir-world-bots-config`, containing
  `WORLD_LOBBY_URL`.
- Run a bot with
  `modal run modal-bots/app.py --bot <registry-key> --room <room> --seconds <n>`, which picks the
  bot's worker (`--name` renames it, and `--target kat,bob` aims a combat bot).
- Both workers share the same image, CPU allocation, Secret, and timeout, and run many bots to a
  container: they're async, so up to `MAX_BOTS_PER_CONTAINER` bots share one
  event loop, the autoscaler adds a container past `TARGET_BOTS_PER_CONTAINER`, and
  `MAX_BOT_CONTAINERS` bounds the fleet. A bot must never block the loop (no sync sleeps or I/O).
  If a bot truly needs a GPU, different dependencies, or a different timeout, define a separate
  Modal worker intentionally rather than adding conditionals to the existing ones.
- When adding a Python dependency, update both `modal-bots/pyproject.toml` and `bot_image` in
  `modal-bots/common/deployment.py`, then verify an actual `modal run`.
