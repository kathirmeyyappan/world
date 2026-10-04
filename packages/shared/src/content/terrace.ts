// The terrace: a ring of deck floating over the middle of the main disc, level with Tung Tung
// Tower's top floor, open in the middle, with a parapet round both edges. The outer one opens where
// a way up arrives: the tower's sky bridge from the east (content/tower.ts), and a staircase from
// each building's roof (content/buildings.ts) that climbs over the building's path, railed both sides.
import { roundFloor, roundWall, stairs, type Structure } from '../sim/structures';
import { ANNEX, BUILDING_GROUNDS } from '../sim/outline';
import type { Region } from '../sim/regions';
import type { Bridge } from '../sim/world';
import { OUTER, RAIL, SILL, STOREY } from './keep';

// The deck's own outline, its top at y.
export const TERRACE_RING = { x: 0, z: 0, r: 40, inner: 16, y: 3 * STOREY };
export const DECK = 0.4; // thickness of the terrace and the sky bridge
export const WALKWAY = 4; // width of the sky bridge and the staircases

const { x: X, z: Z, r: R, inner: INNER, y: Y } = TERRACE_RING;
const PARAPET_R = R - 0.1; // the outer parapet's centreline

// Each building's staircase, from the foot of its roof exit (in the wall, under the parapet's gap)
// to the terrace's edge, its top step just below the deck and reaching a hair under it: any further
// and the deck's edge would stand more than a step above the last stair a player can reach.
const STAIRCASES = BUILDING_GROUNDS.map(({ x, z }) => {
  const out = Math.hypot(x - X, z - Z);
  const along = (d: number) => ({ x: X + ((x - X) * d) / out, z: Z + ((z - Z) * d) / out });
  const roof = STOREY - SILL; // a one-storey building's roof, just under its top like a sill
  return { bottom: along(out - OUTER + 0.5), top: along(R - 0.05), y: roof, h: Y - SILL - roof };
});

// Where the outer parapet opens: toward the tower and each building.
const ARRIVALS = [ANNEX, ...BUILDING_GROUNDS].map(({ x, z }) => Math.atan2(z - Z, x - X));

export const TERRACE: Structure[] = [
  ...roundFloor({ ...TERRACE_RING, thickness: DECK, material: 'flagstone' }),
  ...roundWall({
    x: X,
    z: Z,
    r: PARAPET_R,
    y: Y,
    h: RAIL,
    thickness: 0.2,
    segments: 128,
    gaps: ARRIVALS.map((angle) => ({
      angle,
      width: 2 * Math.asin(WALKWAY / 2 / PARAPET_R),
      bottom: Y,
      top: Y + RAIL,
    })),
    material: 'brick',
  }),
  ...roundWall({ x: X, z: Z, r: INNER + 0.1, y: Y, h: RAIL, thickness: 0.2, segments: 64, material: 'brick' }),
  ...STAIRCASES.flatMap(({ bottom, top, y, h }) =>
    stairs(bottom, top, h, WALKWAY, { y, thickness: 0.3, rail: RAIL, material: 'wood' }),
  ),
];

// The deck between its parapets, for placing things (content/regions.ts).
export const TERRACE_DECK: Region = { kind: 'ring', x: X, z: Z, r: R - 0.2, inner: INNER + 0.2, y: Y };

// The staircases on the ground, for the minimap's view from up high (content/landmarks.ts).
export const STAIRCASE_FOOTPRINTS: Bridge[] = STAIRCASES.map(({ bottom, top }) => ({
  kind: 'bridge',
  ax: bottom.x,
  az: bottom.z,
  bx: top.x,
  bz: top.z,
  halfWidth: WALKWAY / 2,
}));
