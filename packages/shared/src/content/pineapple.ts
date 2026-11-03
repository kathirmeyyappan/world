// SpongeBob's house: the pineapple on Building 1's grounds (sim/outline.ts), its door facing back
// down the path in, on a dune of sand. The house itself is a model only the client draws
// (render/models/Models.ts); the sim knows it by its profile (content/pineappleProfile.ts, written
// with the model by scripts/house-model.py) and collides with structures stood inside its skin,
// never drawn: rings of wall following the shell's curve up to the ceiling, the doorway open in
// them, solid slabs above it, and a wooden floor between the walls. The dune
// rises from the grounds' edge to a flat top the house sits on, and bulges a little round it. The
// door hangs in the doorway (sim/doors.ts), and the furniture of the show's front room stands
// inside, built from boxes: the armchair on its life ring, the side table, the couch of rolled
// bamboo on its blue bed.
import { roundFloor, roundWall, terrain, wall, type Box, type Structure } from '../sim/structures';
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
const RING_MARGIN = 0.1; // metres a collision ring keeps inside each face of the skin
const MIN_RING = 0.5; // metres: the thinnest ring worth standing; a band is split until its rings are
const FLOOR = 0.1; // the wooden floor's thickness

// The door faces the way in; the model's door faces its +z, so it's turned to match.
const ENTRANCE = Math.atan2(-Z, -X);
export const PINEAPPLE_PLACEMENT = { x: X, y: DUNE_HEIGHT, z: Z, yaw: Math.PI / 2 - ENTRANCE };
const YAW = PINEAPPLE_PLACEMENT.yaw;
// A point in the house's frame (metres, the door facing +z) in the world.
const placed = (lx: number, lz: number) => ({
  x: X + lx * Math.cos(YAW) + lz * Math.sin(YAW),
  z: Z - lx * Math.sin(YAW) + lz * Math.cos(YAW),
});
const FLOOR_TOP = DUNE_HEIGHT + 0.1; // the wooden floor's top

// The door swings outward on the hinge at its left edge, through a little more than a right angle,
// to stand beside the doorway.
export const DOOR_SWING = (100 * Math.PI) / 180;
export const PINEAPPLE_DOOR: DoorSpec = {
  id: 'pineapple',
  hinge: placed(SHAPE.door.hinge[0], SHAPE.door.hinge[1] + SHAPE.door.middle[1]),
  y: DUNE_HEIGHT,
  bearing: -YAW, // the house's +x, where the slab runs from the hinge
  reach: SHAPE.door.reach,
  height: SHAPE.door.height,
  thickness: SHAPE.door.thickness,
  swing: DOOR_SWING,
};
export const PINEAPPLE_FOOTPRINT: Disc = { kind: 'disc', x: X, z: Z, r: Math.max(...SHAPE.rings.map(([, r]) => r)) };
// The floor inside the walls, for placing things (content/regions.ts).
export const PINEAPPLE_LEVELS: Region[] = [
  { kind: 'disc', x: X, z: Z, r: SHAPE.rings[0][1] - SHAPE.wall - 1, y: DUNE_HEIGHT + FLOOR },
];

// The doorway's share of a band of wall between two heights above the floor, if it reaches it.
const doorway = (bottom: number, top: number, r: number) =>
  bottom < SHAPE.doorway.height
    ? [
        {
          angle: ENTRANCE,
          width: 2 * Math.asin(SHAPE.doorway.width / 2 / r),
          bottom: DUNE_HEIGHT + bottom,
          top: DUNE_HEIGHT + Math.min(top, SHAPE.doorway.height),
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
      gaps: doorway(ya, yb, (outer + inner) / 2),
      hidden: true,
    });
  }).flat();
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

// The front room, in the house's frame: a few times a person's size, like the house.
const RED = '#d8402a';
const CREAM = '#efe6d2';
const BLUE = '#2f55c4';
const GREEN = '#64b23c';
const ORANGE = '#e3772b';
const BROWN = '#7a4a22';
const DARK = '#3b2a1a';
const box = (lx: number, lz: number, w: number, d: number, h: number, y: number, color: string): Box => ({
  kind: 'box',
  ...placed(lx, lz),
  yaw: YAW,
  w,
  d,
  h,
  y: FLOOR_TOP + y,
  color,
});
// A ring of `count` straight pieces round (lx, lz), coloured in turn from `colors`.
const ring = (
  lx: number,
  lz: number,
  r: number,
  h: number,
  thickness: number,
  count: number,
  colors: string[],
): Box[] =>
  Array.from({ length: count }, (_, k) => {
    const a = ((k - 0.52) / count) * 2 * Math.PI;
    const b = ((k + 0.52) / count) * 2 * Math.PI;
    const at = (t: number) => placed(lx + r * Math.cos(t), lz + r * Math.sin(t));
    return { ...wall(at(a), at(b), h, thickness, FLOOR_TOP), color: colors[k % colors.length] };
  });
const furniture: Structure[] = [
  // The armchair, red on a life ring, facing the door.
  ...ring(-7, -5, 2.1, 0.9, 1.1, 12, [RED, CREAM]),
  box(-7, -5, 3.2, 2.6, 0.8, 0.9, RED),
  box(-7, -6.2, 3.2, 0.8, 2.4, 1.7, RED),
  box(-8.7, -5.2, 0.8, 2.2, 1.1, 1.7, RED),
  box(-5.3, -5.2, 0.8, 2.2, 1.1, 1.7, RED),
  // The side table: a round top on a stem with an anchor of a foot.
  ...roundFloor({ ...placed(-3.2, -6), r: 1.0, y: FLOOR_TOP + 1.7, thickness: 0.15, color: BROWN }),
  box(-3.2, -6, 0.3, 0.3, 1.55, 0, DARK),
  box(-3.2, -6, 1.6, 0.25, 0.25, 0, DARK),
  box(-3.2, -6, 0.25, 1.6, 0.25, 0, DARK),
  // The couch: rolls of bamboo bound in orange, on a blue bed.
  box(5.5, -5.5, 6.4, 2.8, 0.8, 0, BLUE),
  box(5.5, -6.4, 6.0, 1.0, 1.0, 0.8, GREEN),
  box(5.5, -6.4, 6.0, 1.0, 1.0, 1.8, GREEN),
  box(5.5, -6.4, 6.0, 1.0, 1.0, 2.8, GREEN),
  box(3.6, -6.4, 0.5, 1.12, 3.0, 0.8, ORANGE),
  box(7.4, -6.4, 0.5, 1.12, 3.0, 0.8, ORANGE),
];

export const PINEAPPLE_HOUSE: Structure[] = [
  dune,
  ...roundFloor({
    x: X,
    z: Z,
    r: SHAPE.rings[0][1] - SHAPE.wall / 2,
    y: FLOOR_TOP,
    thickness: FLOOR,
    material: 'wood',
  }),
  ...shell,
  ...doorPieces(PINEAPPLE_DOOR),
  ...furniture,
];
