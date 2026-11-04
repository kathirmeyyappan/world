// SpongeBob's house: the pineapple on Building 1's grounds (sim/outline.ts), its door facing back
// down the path in, on a dune of sand. The house itself is a model only the client draws
// (render/models/Models.ts); the sim knows it by its profile (content/pineappleProfile.ts, written
// with the model by scripts/house-model.py) and collides with structures stood inside its skin,
// never drawn: rings of wall between the room's upright wall and the shell's leaning skin up to the
// ceiling, left out where the shell flattens into the face round the door, and solid slabs above
// it; in the face's place, the jambs either side of the doorway and the lintel over it. The dune
// rises from the grounds' edge to a flat top the house sits on, and bulges a little round it; its
// sand is the ground floor, as in the show. The door hangs in the doorway (sim/doors.ts).
//
// Inside, the house is a round room like a keep's (content/keep.ts): a flight winds half a turn up
// the wall from the side of the room round the back to the first floor, a wooden slab run into
// the wall and open where the flight arrives, and the ground floor hangs the tower's ground-floor
// murals (content/towerFrames.ts), its storey tall enough for them. The first floor is a lower
// room under the net ceiling.
import { roundFloor, roundWall, spiralStairs, terrain, type Box, type Structure } from '../sim/structures';
import { doorPieces, type DoorSpec } from '../sim/doors';
import { BUILDING_GROUNDS } from '../sim/outline';
import type { Region } from '../sim/regions';
import type { RoundRoom } from '../sim/wallFrames';
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
const ROOM = SHAPE.room; // the room's wall, upright
const STOREY = 20; // metres: the first floor's top above the ground, a keep's storey, so the murals clear the flight
const SLAB = 0.5; // the first floor's thickness
const STAIR_WIDTH = 3.75; // a keep's
const STAIR_INNER = ROOM - STAIR_WIDTH;
const STAIR_HOLE = (35 * Math.PI) / 180; // the floor is open over the last 35° of the flight, where it's within 3 m
const RAIL = 1; // height of the posts along the flight's inner edge
const SILL = 0.02; // the flight sits this far below the floor it meets, so no two tops share a height
const SEGMENTS = 32; // straight pieces in each collision ring
const RING_MARGIN = 0.1; // metres a collision ring keeps inside the skin
const WALL_SEGMENTS = 72; // straight pieces the model's wall is turned in, which frames hang on

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

// The flight, climbing from the side of the room round the back, over the door, to the first
// floor: from 135° round from the entrance (to your right, facing it from the middle) to 315°,
// as a keep's ground floor's does, so the murals hung there hang here just the same.
const STAIR_START = ENTRANCE - (3 * Math.PI) / 4;
const STAIR_END = STAIR_START + Math.PI;

// The ground floor as a round room, for the murals (sim/wallFrames.ts): the wall as the collision
// rings stand it, the doorway its one door, the flight leaving it.
export const PINEAPPLE_ROOM: RoundRoom = {
  x: X,
  z: Z,
  floor: DUNE_HEIGHT,
  ceiling: DUNE_HEIGHT + STOREY - SLAB,
  middle: DUNE_HEIGHT + STOREY / 2,
  wall: { r: ROOM + 1, thickness: 2, segments: WALL_SEGMENTS },
  entrance: ENTRANCE,
  doors: [{ angle: ENTRANCE, width: 2 * Math.asin(SHAPE.doorway.width / 2 / ROOM), top: SHAPE.doorway.height }],
  stair: { from: STAIR_START, climb: STOREY / Math.PI },
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

// The shell, band by band between its rings: below the ceiling, a ring of wall from the room's
// wall out to just inside the skin; above it, solid. All unseen: the model is the shell's look.
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
  const outer = Math.min(r0, r1) - RING_MARGIN;
  return roundWall({
    x: X,
    z: Z,
    r: (outer + ROOM) / 2,
    thickness: outer - ROOM,
    y: DUNE_HEIGHT + y0,
    h: Math.min(y1, SHAPE.ceiling) - y0,
    segments: SEGMENTS,
    gaps: faced(y0, Math.min(y1, SHAPE.ceiling), (outer + ROOM) / 2),
    hidden: true,
  });
});

// The face as the sim sees it, in the house's frame: slabs of wall from the face's plane back to
// the room's wall, the jambs either side of the doorway (two each, so their backs keep to the
// round wall) and the lintel over it.
const slab = (x0: number, x1: number, bottom: number, top: number): Box => {
  const depth = SHAPE.face.z - Math.sqrt(ROOM * ROOM - Math.max(x0 * x0, x1 * x1)) + 0.05;
  return {
    kind: 'box',
    ...placed((x0 + x1) / 2, SHAPE.face.z - depth / 2),
    yaw: YAW,
    w: Math.abs(x1 - x0),
    d: depth,
    h: top - bottom,
    y: DUNE_HEIGHT + bottom,
    hidden: true,
  };
};
const JAMB = (SHAPE.face.halfWidth - SHAPE.doorway.width / 2) / 2;
const face: Structure[] = [
  ...[-1, 1].flatMap((side) => {
    const edge = (SHAPE.doorway.width / 2) * side;
    return [
      slab(edge, edge + JAMB * side, 0, SHAPE.face.top),
      slab(edge + JAMB * side, edge + 2 * JAMB * side, 0, SHAPE.face.top),
    ];
  }),
  slab(-SHAPE.doorway.width / 2, SHAPE.doorway.width / 2, SHAPE.doorway.height, SHAPE.face.top),
];

// The flight and the first floor, a keep's.
const stair = spiralStairs({
  x: X,
  z: Z,
  inner: STAIR_INNER,
  outer: ROOM + 0.05, // into the wall, so there's no gap at its foot
  bottom: DUNE_HEIGHT - SILL,
  rise: STOREY,
  turns: 0.5,
  start: STAIR_START,
  rail: RAIL,
  material: 'wood',
});
const upstairs = roundFloor({
  x: X,
  z: Z,
  r: ROOM + 0.3,
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
