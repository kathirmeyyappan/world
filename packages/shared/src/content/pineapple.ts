// SpongeBob's house: the pineapple on Building 1's grounds (sim/outline.ts), its door facing back
// down the path in, on a dune of sand. The house is two models only the client draws
// (render/models/Models.ts): the pineapple outside and the rooms inside, both written by
// scripts/house-model.py with the profile the sim knows them by (content/pineappleProfile.ts) and
// the boxes it collides with inside (content/pineappleInterior.ts: every surface of the rooms and
// what's in them, cut on a grid, so a couch is something to stand on). Round the rooms the shell is
// solid, as hidden rings: the whole thickness outside the ground floor's rooms, a seal just inside
// the skin above them, the library's wall, and everything above the library; open only at the
// doorway and the vestibule behind it, and at the library's door. The dune rises from the grounds'
// edge to a flat top the house sits on, and bulges a little round it; the rooms' sand floor lies
// on it.
//
// Inside, the rooms are the game's (Battle for Bikini Bottom): the living room through the front
// door, the closet off it, the kitchen behind, the bathroom off the kitchen, the bedroom upstairs
// over the kitchen, and the library on top. A spiral stair in the living room climbs through its
// ceiling to a stair hall, off which a corridor runs to the bedroom's door and a stairwell climbs
// by a straight flight to the landing before the library's door. Every door swings
// (sim/doors.ts), the front one outward, the rooms' into the room each closes.
import { roundFloor, roundWall, spiralStairs, stairs, terrain, type Box, type Structure } from '../sim/structures';
import { doorPieces, type DoorSpec } from '../sim/doors';
import { BUILDING_GROUNDS } from '../sim/outline';
import type { Region } from '../sim/regions';
import type { Disc } from '../sim/world';
import { PINEAPPLE_BOXES } from './pineappleInterior';
import { PINEAPPLE_PROFILE as SHAPE } from './pineappleProfile';

const GROUND = BUILDING_GROUNDS[0];
const X = GROUND.x;
const Z = GROUND.z;
if (SHAPE.dune.foot !== GROUND.r) throw new Error('the house model laid its dune for other grounds');
export const DUNE_HEIGHT = SHAPE.dune.height; // metres the dune's flat top, and the house's floor, stand above the floor
const GROUND_CORE = 13.3; // radius the shell is solid from on the ground floor: just outside the rooms' outer wall
const SEAL = 0.4; // metres inside the skin the seal above the ground floor begins: just behind the hall's wall
const RAIL = 1; // height of the posts along a flight's edge
const RAIL_WIDTH = 0.2; // and the landing's, across
const SILL = 0.02; // a flight sits this far below the floor it meets, so no two tops share a height
const SEGMENTS = 32; // straight pieces in each collision ring
const RING_MARGIN = 0.1; // metres a collision ring keeps inside the skin

// The door faces the way in; the model's door faces its +z, so it's turned to match.
const ENTRANCE = Math.atan2(-Z, -X);
export const PINEAPPLE_PLACEMENT = { x: X, y: DUNE_HEIGHT, z: Z, yaw: Math.PI / 2 - ENTRANCE };
const YAW = PINEAPPLE_PLACEMENT.yaw;
// A point in the house's frame (metres, the door facing +z) in the world.
const placed = (lx: number, lz: number) => ({
  x: X + lx * Math.cos(YAW) + lz * Math.sin(YAW),
  z: Z - lx * Math.sin(YAW) + lz * Math.cos(YAW),
});
// An angle in the house's frame, from +x toward +z, in the world; and a bearing there, from +z
// toward +x, as a world angle.
const turned = (angle: number) => angle - YAW;
const bearing = (b: number) => ENTRANCE - b;
// The shell's radius at a height, between the profile's rings.
const skin = (y: number): number => {
  const rings = SHAPE.rings;
  for (let i = 1; i < rings.length; i++) {
    const [y0, r0] = rings[i - 1];
    const [y1, r1] = rings[i];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return rings[rings.length - 1][1];
};

export const PINEAPPLE_DOORS: DoorSpec[] = SHAPE.doors.map((d) => ({
  id: d.id,
  hinge: placed(d.hinge[0], d.hinge[1]),
  y: DUNE_HEIGHT + d.y,
  bearing: turned(d.bearing),
  reach: d.reach,
  height: d.height,
  thickness: d.thickness,
  swing: d.swing,
}));
export const PINEAPPLE_DOOR = PINEAPPLE_DOORS.find((d) => d.id === 'front')!;
export const PINEAPPLE_FOOTPRINT: Disc = { kind: 'disc', x: X, z: Z, r: Math.max(...SHAPE.rings.map(([, r]) => r)) };
// A spot on each level for placing things (content/regions.ts): the living room, the corridor
// upstairs, and the library.
const { levels } = SHAPE;
export const PINEAPPLE_LEVELS: Region[] = [
  { kind: 'disc', ...placed(3.5, 10), r: 2.5, y: DUNE_HEIGHT },
  { kind: 'disc', ...placed(2.2, -3), r: 1.5, y: DUNE_HEIGHT + levels.hall },
  { kind: 'disc', x: X, z: Z, r: 8, y: DUNE_HEIGHT + levels.library },
];

// What's open through the shell between two heights above the floor: the doorway and the vestibule
// behind it, and the library's doorway, each as a gap in a ring.
const DOORWAY = { bearing: 0, width: SHAPE.doorway.width + 0.6, bottom: 0, top: SHAPE.doorway.height + 0.4 };
const LIBRARY_DOOR = { bearing: 0, width: 2.4, bottom: levels.library, top: levels.library + 3.2 };
const openings = (bottom: number, top: number) =>
  [DOORWAY, LIBRARY_DOOR]
    .filter((g) => g.bottom < top && g.top > bottom)
    .map((g) => ({
      angle: bearing(g.bearing),
      width: g.width,
      bottom: DUNE_HEIGHT + Math.max(bottom, g.bottom),
      top: DUNE_HEIGHT + Math.min(top, g.top),
    }));

// The shell, band by band between its rings and the levels where what's inside changes, all
// unseen (the model is the shell's look). Each band is a ring from where the solid begins out to
// just inside the skin, with the openings left out of it: the whole thickness outside the ground
// floor's rooms, then only a seal inside the skin, behind the hall's wall and the landing's; the
// library's wall is a ring of its own, and above the library the shell is solid through.
const landingTop = levels.library + SHAPE.landing.height;
const edges = [...new Set([...SHAPE.rings.map(([y]) => y), levels.hall, levels.library, landingTop, levels.top])].sort(
  (a, b) => a - b,
);
const ring = (inner: number, outer: number, y0: number, y1: number): Box[] =>
  roundWall({
    x: X,
    z: Z,
    r: (outer + inner) / 2,
    thickness: outer - inner,
    y: DUNE_HEIGHT + y0,
    h: y1 - y0,
    segments: SEGMENTS,
    gaps: openings(y0, y1),
    hidden: true,
  });
const shell: Structure[] = edges.slice(1).flatMap((y1, i): Structure[] => {
  const y0 = edges[i];
  const outer = Math.min(skin(y0), skin(y1)) - RING_MARGIN;
  if (y0 >= levels.top)
    return roundFloor({ x: X, z: Z, r: outer, y: DUNE_HEIGHT + y1, thickness: y1 - y0, hidden: true });
  if (y0 < levels.hall) return ring(GROUND_CORE, outer, y0, y1);
  if (y0 < landingTop) return ring(outer - SEAL, outer, y0, y1);
  const [, inner, wall] = SHAPE.library.reduce((band, next) => (next[0] <= y0 ? next : band), SHAPE.library[0]);
  return [...ring(inner, wall, y0, y1), ...ring(outer - SEAL, outer, y0, y1)];
});

// The rooms and everything in them.
const rooms: Box[] = PINEAPPLE_BOXES.map(([x, z, y, w, d, h]) => ({
  kind: 'box',
  ...placed(x, z),
  yaw: YAW,
  w,
  d,
  h,
  y: DUNE_HEIGHT + y,
  hidden: true,
}));

// The spiral up from the living room, and the flight up the stairwell.
const { spiral, flight } = SHAPE;
const flights: Box[] = [
  ...spiralStairs({
    ...placed(spiral.x, spiral.z),
    inner: spiral.inner,
    outer: spiral.outer,
    bottom: DUNE_HEIGHT - SILL,
    rise: levels.hall,
    turns: spiral.turns,
    start: turned(spiral.start),
    rail: RAIL,
    material: 'wood',
  }),
  ...stairs(placed(...flight.from), placed(...flight.to), levels.library - levels.hall, flight.width, {
    y: DUNE_HEIGHT + levels.hall - SILL,
    thickness: 0.3,
    rail: RAIL,
    material: 'wood',
  }),
  ...landingRails(),
];

// Rails round the flight's slot in the landing's floor, along its sides and across its foot (its
// head is where the flight arrives, railed by the flight's own), standing a hair above the floor.
function landingRails(): Box[] {
  const [x0, x1, z0, z1] = flight.slot;
  const y = DUNE_HEIGHT + levels.library + 0.03;
  const w = RAIL_WIDTH;
  const rail = (x: number, z: number, along: number, across: number): Box => ({
    kind: 'box',
    ...placed(x, z),
    y,
    yaw: YAW,
    w: along,
    d: across,
    h: RAIL,
    material: 'wood',
  });
  return [
    rail((x0 + x1) / 2, z0 - w / 2, x1 - x0, w),
    rail((x0 + x1) / 2, z1 + w / 2, x1 - x0, w),
    rail(x0 - w / 2, (z0 + z1) / 2, w, z1 - z0 + 2 * w),
  ];
}

// Flat on top, down to the floor by the grounds' edge, never steeper than a walk; its underside a
// hair under the floor, so its rim and corners (the grounds are round, it is square) stay out of
// sight beneath it. Heights are over the underside. The same hill the model's garden was laid on.
const { dune: hill } = SHAPE;
const dune = terrain({
  x: X,
  z: Z,
  w: 2 * hill.foot,
  d: 2 * hill.foot,
  y: -0.05,
  material: 'sand',
  height: (lx, lz) => {
    const out = Math.hypot(lx, lz);
    const t = Math.max(0, Math.min(1, (hill.foot - out) / (hill.foot - hill.top)));
    const slope = t * t * (3 - 2 * t);
    const bulge = Math.sin(hill.bulges * Math.atan2(lz, lx)) * Math.sin(Math.PI * t);
    return (hill.height + 0.05) * slope + hill.bulge * bulge;
  },
});

export const PINEAPPLE_HOUSE: Structure[] = [
  dune,
  ...shell,
  ...rooms,
  ...PINEAPPLE_DOORS.flatMap((d) => doorPieces(d)),
  ...flights,
];
