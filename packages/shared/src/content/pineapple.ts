// SpongeBob's house: the pineapple on Building 1's grounds (sim/outline.ts), its door facing back
// down the path in, on a dune of sand. The house itself is a model only the client draws
// (render/models/Models.ts); the sim knows it by its profile (content/pineappleProfile.ts, written
// with the model by scripts/house-model.py) and collides with structures stood inside its skin,
// never drawn: rings of wall following the shell's curve up to the ceiling, left out where the
// shell flattens into the upright face round the door, and solid slabs above it; in the face's
// place, the jambs either side of the doorway and the lintel over it. The dune rises from the
// grounds' edge to a flat top the house sits on, and bulges a little round it; its sand is the
// ground floor, as in the show. The door hangs in the doorway (sim/doors.ts). A wooden flight
// winds half a turn up the back of the room against the wall to the first floor, a wooden slab
// run into the wall and open where the flight arrives.
import { roundFloor, roundWall, spiralStairs, terrain, type Box, type Structure } from '../sim/structures';
import { doorPieces, type DoorSpec } from '../sim/doors';
import { BUILDING_GROUNDS } from '../sim/outline';
import type { Region } from '../sim/regions';
import type { Disc } from '../sim/world';
import { PINEAPPLE_PROFILE as SHAPE } from './pineappleProfile';

const GROUND = BUILDING_GROUNDS[0];
const X = GROUND.x;
const Z = GROUND.z;
export const DUNE_HEIGHT = 3; // metres the dune's flat top, and the house's floor, stand above the floor
const DUNE_TOP = SHAPE.rings[0][1] + 1; // radius of the flat top: just past the shell's foot
const DUNE_FOOT = GROUND.r; // where the dune meets the floor: the grounds' edge
const DUNE_BULGES = 5; // soft mounds round the slope
const BULGE = 0.5; // metres they rise and fall by
const SEGMENTS = 32;
export const STOREY = 10; // metres: the first floor's top above the ground
const SLAB = 0.5; // the first floor's thickness
const STAIR_INNER = 10; // metres from the axis: the flight's inner edge
const STAIR_CLEAR = 0.15; // metres its outer edge keeps from the wall
const STAIR_TURNS = 0.5;
const STEP_RISE = 0.25;
const STEP = 0.3; // a step's thickness: a flight in the air, with headroom beneath it
const STAIR_HOLE = (60 * Math.PI) / 180; // the floor is open over the last 60° of the flight, where it's within 3 m
const RAIL = 1; // height of the posts along the flight's inner edge
const SILL = 0.02; // the flight sits this far below the floor it meets, so no two tops share a height
const RING_MARGIN = 0.1; // metres a collision ring keeps inside each face of the skin
const MIN_RING = 0.5; // metres: the thinnest ring worth standing; a band is split until its rings are

// The door faces the way in; the model's door faces its +z, so it's turned to match.
const ENTRANCE = Math.atan2(-Z, -X);
export const PINEAPPLE_PLACEMENT = { x: X, y: DUNE_HEIGHT, z: Z, yaw: Math.PI / 2 - ENTRANCE };
const YAW = PINEAPPLE_PLACEMENT.yaw;
// A point in the house's frame (metres, the door facing +z) in the world.
const placed = (lx: number, lz: number) => ({
  x: X + lx * Math.cos(YAW) + lz * Math.sin(YAW),
  z: Z - lx * Math.sin(YAW) + lz * Math.cos(YAW),
});

// The door swings outward on the hinge at its left edge, square to the doorway, to stand at its
// side.
export const DOOR_SWING = Math.PI / 2;
export const PINEAPPLE_DOOR: DoorSpec = {
  id: 'pineapple',
  hinge: placed(SHAPE.door.hinge[0], SHAPE.door.hinge[1]),
  y: DUNE_HEIGHT,
  bearing: -YAW, // the house's +x, where the slab runs from the hinge
  reach: SHAPE.door.reach,
  height: SHAPE.door.height,
  thickness: SHAPE.door.thickness,
  swing: DOOR_SWING,
};
export const PINEAPPLE_FOOTPRINT: Disc = { kind: 'disc', x: X, z: Z, r: Math.max(...SHAPE.rings.map(([, r]) => r)) };
// Each floor inside the flight, for placing things (content/regions.ts).
export const PINEAPPLE_LEVELS: Region[] = [0, STOREY].map((y) => ({
  kind: 'disc',
  x: X,
  z: Z,
  r: STAIR_INNER - 0.5,
  y: DUNE_HEIGHT + y,
}));

// The room's wall at a height above the ground: the shell's radius there, less the wall.
const roomRadius = (y: number) => {
  const i = Math.max(
    1,
    SHAPE.rings.findIndex(([ring]) => ring >= y),
  );
  const [y0, r0] = SHAPE.rings[i - 1];
  const [y1, r1] = SHAPE.rings[i];
  return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0) - SHAPE.wall;
};

// The flat face's share of a band of wall between two heights above the floor, if it reaches it.
const faced = (bottom: number, top: number, r: number) =>
  bottom < SHAPE.face.top
    ? [
        {
          angle: ENTRANCE,
          width: 2 * Math.asin(SHAPE.face.halfWidth / r),
          bottom: DUNE_HEIGHT + bottom,
          top: DUNE_HEIGHT + Math.min(top, SHAPE.face.top),
        },
      ]
    : [];

// The shell, band by band between its rings: below the ceiling, rings of wall inside the skin, each
// band split until a straight ring fits the sloping skin with MIN_RING to spare; above it, solid.
// All unseen: the model is the shell's look.
const shell: Structure[] = SHAPE.rings.slice(1).flatMap(([y1, r1], i) => {
  const [y0, r0] = SHAPE.rings[i];
  if (y0 >= SHAPE.ceiling - 1e-6)
    return roundFloor({
      x: X,
      z: Z,
      r: Math.min(r0, r1) - RING_MARGIN,
      y: DUNE_HEIGHT + y1,
      thickness: y1 - y0,
      hidden: true,
    });
  const parts = Math.max(1, Math.ceil(Math.abs(r1 - r0) / (SHAPE.wall - 2 * RING_MARGIN - MIN_RING)));
  return Array.from({ length: parts }, (_, k) => {
    const [ya, yb] = [y0 + ((y1 - y0) * k) / parts, y0 + ((y1 - y0) * (k + 1)) / parts];
    const [ra, rb] = [r0 + ((r1 - r0) * k) / parts, r0 + ((r1 - r0) * (k + 1)) / parts];
    const outer = Math.min(ra, rb) - RING_MARGIN;
    const inner = Math.max(ra, rb) - SHAPE.wall + RING_MARGIN;
    return roundWall({
      x: X,
      z: Z,
      r: (outer + inner) / 2,
      thickness: outer - inner,
      y: DUNE_HEIGHT + ya,
      h: yb - ya,
      segments: SEGMENTS,
      gaps: faced(ya, yb, (outer + inner) / 2),
      hidden: true,
    });
  }).flat();
});

// The face as the sim sees it, in the house's frame: a slab of wall from the face's plane back
// toward the room. The jambs either side of the doorway reach the room's wall at the foot, and
// are thinner above, where the room's wall leans away from the face; the lintel over the doorway
// is thin like them. Nothing below the ceiling stands within a step of a player's head, so the
// hollow behind the thin parts is never felt.
const slab = (lx: number, depth: number, w: number, bottom: number, top: number): Box => ({
  kind: 'box',
  ...placed(lx, SHAPE.face.z - depth / 2),
  yaw: YAW,
  w,
  d: depth,
  h: top - bottom,
  y: DUNE_HEIGHT + bottom,
  hidden: true,
});
const JAMB = SHAPE.face.halfWidth - SHAPE.doorway.width / 2;
const JAMB_AT = SHAPE.doorway.width / 2 + JAMB / 2;
const face: Structure[] = [
  ...[-1, 1].flatMap((side) => [
    slab(side * JAMB_AT, 1.6, JAMB, 0, 2.2),
    slab(side * JAMB_AT, 0.8, JAMB, 2.2, SHAPE.face.top),
  ]),
  slab(0, 0.8, SHAPE.doorway.width, SHAPE.doorway.height, SHAPE.face.top),
];

// The flight, climbing from the side of the room round the back to the first floor: a keep's stair
// (content/keep.ts), but with its outer edge following the wall as it leans out.
const STAIR_START = ENTRANCE + Math.PI / 2;
const STAIR_END = STAIR_START + STAIR_TURNS * 2 * Math.PI;
const stair = spiralStairs({
  x: X,
  z: Z,
  inner: STAIR_INNER,
  outer: (climbed) => roomRadius(climbed) - STAIR_CLEAR,
  bottom: DUNE_HEIGHT - SILL, // so the top step (and the rail post on it) sits just under the floor
  rise: STOREY,
  turns: STAIR_TURNS,
  start: STAIR_START,
  thickness: STEP,
  stepRise: STEP_RISE,
  rail: RAIL,
  material: 'wood',
});
const upstairs = roundFloor({
  x: X,
  z: Z,
  r: roomRadius(STOREY) + 0.1,
  y: DUNE_HEIGHT + STOREY,
  thickness: SLAB,
  hole: { inner: STAIR_INNER, from: STAIR_END - STAIR_HOLE, to: STAIR_END },
  material: 'wood',
});

// Flat on top, down to the floor by the grounds' edge, never steeper than a walk; its underside a
// hair under the floor, so its rim and corners (the grounds are round, it is square) stay out of
// sight beneath it. Heights are over the underside.
const dune = terrain({
  x: X,
  z: Z,
  w: 2 * DUNE_FOOT,
  d: 2 * DUNE_FOOT,
  y: -0.05,
  material: 'sand',
  height: (lx, lz) => {
    const out = Math.hypot(lx, lz);
    const t = Math.max(0, Math.min(1, (DUNE_FOOT - out) / (DUNE_FOOT - DUNE_TOP)));
    const slope = t * t * (3 - 2 * t);
    const bulge = Math.sin(DUNE_BULGES * Math.atan2(lz, lx)) * Math.sin(Math.PI * t);
    return (DUNE_HEIGHT + 0.05) * slope + BULGE * bulge;
  },
});

export const PINEAPPLE_HOUSE: Structure[] = [
  dune,
  ...shell,
  ...face,
  ...doorPieces(PINEAPPLE_DOOR),
  ...stair,
  ...upstairs,
];
