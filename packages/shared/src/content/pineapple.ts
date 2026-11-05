// SpongeBob's house: the pineapple on Building 1's grounds (sim/outline.ts), its door facing back
// down the path in, on a dune of sand. The house is two models only the client draws
// (render/models/Models.ts): the pineapple outside and the rooms inside, both written by
// scripts/house-model.py with the profile the sim knows them by (content/pineappleProfile.ts) and
// the boxes it collides with inside (content/pineappleInterior.ts: every surface of the rooms and
// what's in them, cut on a grid, so a couch is something to stand on). Round the rooms the shell is
// solid, as hidden rings: the whole thickness outside the ground floor's rooms, a seal just inside
// the skin above them, and from the library's wall out above its floor; open only at the doorway
// and the vestibule behind it, and at the back door and the hall's. The dune rises from the
// grounds' edge to a flat top the house sits on, and bulges a little round it; the rooms' sand
// floor lies on it.
//
// Inside, the rooms are the game's (Battle for Bikini Bottom): the living room through the front
// door, the closet off it, the kitchen behind, the bathroom off the kitchen, the bedroom upstairs
// over the kitchen, and the library on top. A stair round the back of the house climbs from the
// kitchen's back door, standing clear of the shell with rails both sides, to a balcony at the
// hall's door. Upstairs a corridor runs from that door round the bedroom, walled off from the rest
// of the hall; the ground floor's closet and bathroom are copied off the bedroom; and a stair
// walled both sides curves up from the corridor's end through the hall's ceiling and a hole in the
// library's floor. Every door swings (sim/doors.ts), the front
// one and the back door outward, the rooms' into the room each closes; each outside door hangs in
// a flat upright face carved into the shell. The path's flagstones lie on the sand, to step on.
import { ramp, roundFloor, roundWall, terrain, wall, type Box, type Structure } from '../sim/structures';
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
const SEGMENTS = 32; // straight pieces in each collision ring

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
  { kind: 'disc', ...placed(-3.5, 10), r: 2.5, y: DUNE_HEIGHT },
  { kind: 'disc', ...placed(14, -4), r: 1.5, y: DUNE_HEIGHT + levels.hall },
  { kind: 'disc', x: X, z: Z, r: 8, y: DUNE_HEIGHT + levels.library },
];

// What's open through the shell's rings between two heights above the floor: the doorways (the
// back door's and the hall's; each `width` metres across at the ring's radius) and the flat faces
// round the doors, which have walls of their own (`faceWalls`), each as a gap.
const openings = (bottom: number, top: number, r: number) =>
  [...SHAPE.doorways.map((g) => ({ ...g, arc: g.width / r })), ...SHAPE.faces]
    .filter((g) => g.bottom < top && g.top > bottom)
    .map((g) => ({
      angle: bearing(g.bearing),
      width: g.arc,
      bottom: DUNE_HEIGHT + Math.max(bottom, g.bottom),
      top: DUNE_HEIGHT + Math.min(top, g.top),
    }));

// The shell, band by band between its rings and the levels where what's inside changes, all
// unseen (the model is the shell's look). Each band is a ring from where the solid begins out to
// the skin where it stands outermost in the band (so nothing stands inside it), with the openings
// left out of it: the whole thickness outside the ground floor's rooms, then only a seal inside
// the skin, behind the hall's wall; from the library's floor up, solid from its wall's inside out
// to the skin (nothing stands between them), and above the library solid through. Where the skin
// is flattened into a face round a door the rings are open and the face's own wall stands, chord
// by chord.
const edges = [...new Set([...SHAPE.rings.map(([y]) => y), levels.hall, levels.library, levels.top])].sort(
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
    gaps: openings(y0, y1, (outer + inner) / 2),
    hidden: true,
  });
const face: Box[] = SHAPE.faceWalls.map(([x1, z1, x2, z2, y0, y1]) => ({
  ...wall(placed(x1, z1), placed(x2, z2), y1 - y0, SHAPE.faceThickness, DUNE_HEIGHT + y0),
  hidden: true,
}));
const shell: Structure[] = edges.slice(1).flatMap((y1, i): Structure[] => {
  const y0 = edges[i];
  const outer = Math.max(skin(y0), skin(y1));
  if (y0 >= levels.top)
    return roundFloor({ x: X, z: Z, r: outer, y: DUNE_HEIGHT + y1, thickness: y1 - y0, hidden: true });
  if (y0 < levels.hall) return ring(GROUND_CORE, outer, y0, y1);
  if (y0 < levels.library) return ring(outer - SEAL, outer, y0, y1);
  const [, inner] = SHAPE.library.reduce((band, next) => (next[0] <= y0 ? next : band), SHAPE.library[0]);
  return ring(inner, outer, y0, y1);
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

// The stair round the back, from the kitchen's back door up to the platform at the hall's door,
// and the stairwell from the corridor's end upstairs round to the library, each piece a box.
type Piece = readonly [number, number, number, number, number, number, number];
const piece = ([x, z, y, w, d, h, yaw]: Piece): Box => ({
  kind: 'box',
  ...placed(x, z),
  y: DUNE_HEIGHT + y,
  yaw: YAW + yaw,
  w,
  d,
  h,
  material: 'wood',
});
const flights: Box[] = [...SHAPE.stair.map(piece), ...SHAPE.stairwell.map(piece)];

// The path's flagstones, a hair above the sand, each a ramp lying with the dune's slope, so a
// walker steps on and off them where the model draws them.
const stones: Structure[] = SHAPE.stones.map(([lx, lz, hx, hz, y, w, h]) => ({
  ...ramp(placed(lx, lz), placed(hx, hz), h, w, DUNE_HEIGHT + y),
  hidden: true,
}));

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
  height: (ox, oz) => {
    // The terrain samples at offsets in the world's axes; the hill is shaped in the house's frame,
    // the one the garden is laid on it in (scripts/house-model.py, with this same hill).
    const lx = ox * Math.cos(YAW) - oz * Math.sin(YAW);
    const lz = ox * Math.sin(YAW) + oz * Math.cos(YAW);
    const out = Math.hypot(lx, lz);
    const t = Math.max(0, Math.min(1, (hill.foot - out) / (hill.foot - hill.top)));
    const slope = t * t * (3 - 2 * t);
    const bulge = Math.sin(hill.bulges * Math.atan2(lz, lx)) * Math.sin(Math.PI * t);
    return (hill.height + 0.05) * slope + hill.bulge * bulge;
  },
});

export const PINEAPPLE_HOUSE: Structure[] = [
  dune,
  ...stones,
  ...shell,
  ...face,
  ...rooms,
  ...PINEAPPLE_DOORS.flatMap((d) => doorPieces(d)),
  ...flights,
];
