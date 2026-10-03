// Tung Tung Tower: an 80 m keep (content/keep.ts) in the middle of the annex, all four floors of the
// layout stacked, with a stair winding up through every one of them to the roof. Every floor above
// the ground has six doors out to a balcony ringing the tower behind a low parapet (a sniper's
// perch), and the top balcony's west side opens onto a sky bridge. The bridge runs back over the
// floor bridge (inside the outline's corridor, so players can't be clamped off it) to a terrace
// floating over the middle of the main disc: a ring of deck round an open, walled middle.
import { roundFloor, roundWall, wall, type Box, type Structure } from '../sim/structures';
import { ANNEX } from '../sim/outline';
import type { Region } from '../sim/regions';
import type { RoundRoom } from '../sim/wallFrames';
import type { Vec3 } from '../sim/types';
import type { Disc } from '../sim/world';
import { OPENING, OUTER, RAIL, SILL, STAIR_INNER, STOREY, deg, keep } from './keep';

const X = ANNEX.x;
const Z = ANNEX.z;
const TOWER = keep({ x: X, z: Z, entrance: deg(180), floors: [0, 1, 2, 3] }); // west, toward the main disc
const TOP = 3 * STOREY; // the top floor, where the sky bridge leaves
const BRIDGE_DOOR = deg(180); // the top floor's main door, onto the bridge
const BALCONY = 3; // metres of balcony outside the wall
const PARAPET = 0.8; // under half a body, so it's cover you can shoot over
const DECK = 0.4; // thickness of the bridge and terrace decks

const TERRACE = { x: 0, z: 0, r: 20, inner: 8 }; // round the middle of the main disc, open within `inner`
const BRIDGE_WIDTH = 4;

// A ring outside the wall on every upper floor, reached through its doors, behind a parapet
// that opens only where the sky bridge leaves the top one.
const balconies: Structure[] = [STOREY, 2 * STOREY, TOP].flatMap((level) => [
  ...roundFloor({ x: X, z: Z, inner: OUTER, r: OUTER + BALCONY, y: level, material: 'flagstone' }),
  ...roundWall({
    x: X,
    z: Z,
    r: OUTER + BALCONY - 0.1,
    y: level,
    h: PARAPET,
    thickness: 0.2,
    segments: 48,
    gaps: level === TOP ? [{ angle: BRIDGE_DOOR, bottom: level, top: level + PARAPET }] : [],
    material: 'brick',
  }),
]);

// A low wall along a deck edge, standing on the deck's top at y, from a to b.
const rail = (a: { x: number; z: number }, b: { x: number; z: number }, y = TOP): Box => ({
  ...wall(a, b, RAIL, 0.2, y),
  material: 'brick',
});

const BRIDGE_TOP = TOP - SILL; // just under the balcony it tucks beneath
const bridgeStart = X - OUTER - BALCONY + 0.2; // under the top balcony's outer edge, so no sliver between
const halfW = BRIDGE_WIDTH / 2;
const bridgeEnd = TERRACE.x + TERRACE.r - 1; // a metre under the terrace's edge, so no sliver between
const railEnd = TERRACE.x + Math.sqrt((TERRACE.r - 0.1) ** 2 - halfW ** 2); // where the rails meet its parapet
const skyway: Structure[] = [
  {
    kind: 'box',
    x: (bridgeStart + bridgeEnd) / 2,
    z: Z,
    y: BRIDGE_TOP - DECK,
    w: bridgeStart - bridgeEnd,
    d: BRIDGE_WIDTH,
    h: DECK,
    material: 'flagstone',
  },
  rail({ x: railEnd, z: Z - halfW }, { x: bridgeStart, z: Z - halfW }, BRIDGE_TOP),
  rail({ x: railEnd, z: Z + halfW }, { x: bridgeStart, z: Z + halfW }, BRIDGE_TOP),
];

// A ring of deck round the middle of the main disc, open in the middle, with a parapet round both
// edges. The outer one opens only where the bridge comes in from the east.
const terrace: Structure[] = [
  ...roundFloor({ ...TERRACE, y: TOP, thickness: DECK, material: 'flagstone' }),
  ...roundWall({
    x: TERRACE.x,
    z: TERRACE.z,
    r: TERRACE.r - 0.1,
    y: TOP,
    h: RAIL,
    thickness: 0.2,
    segments: 64,
    gaps: [{ angle: 0, width: 2 * Math.asin(halfW / (TERRACE.r - 0.1)), bottom: TOP, top: TOP + RAIL }],
    material: 'brick',
  }),
  ...roundWall({
    x: TERRACE.x,
    z: TERRACE.z,
    r: TERRACE.inner + 0.1,
    y: TOP,
    h: RAIL,
    thickness: 0.2,
    segments: 32,
    material: 'brick',
  }),
];

export const TUNG_TUNG_TOWER: Structure[] = [...TOWER.structures, ...balconies, ...skyway, ...terrace];

export const TUNG_TUNG_TOWER_FOOTPRINT: Disc = TOWER.footprint;

// The four floors as rooms to hang frames in (sim/wallFrames.ts), ground floor first.
export const TUNG_TUNG_TOWER_ROOMS: RoundRoom[] = TOWER.rooms;

// The middle of each floor's top, ground floor first: where to stand something on floor n.
export const TUNG_TUNG_TOWER_FLOORS: Vec3[] = TOWER.rooms.map(({ floor }) => ({ x: X, y: floor, z: Z }));

// The four floors inside the wall, ground floor first: each one's open disc inside the stair,
// which runs round against the wall.
export const TUNG_TUNG_TOWER_INSIDE: Region[] = TOWER.rooms.map(({ floor }): Region => ({
  kind: 'disc',
  x: X,
  z: Z,
  r: STAIR_INNER,
  y: floor,
}));

// Each level's open floor, for placing things (content/regions.ts): the four inside, and the roof
// between the parapet round its opening and the stair.
export const TUNG_TUNG_TOWER_LEVELS: Region[] = [
  ...TUNG_TUNG_TOWER_INSIDE,
  { kind: 'ring', x: X, z: Z, r: STAIR_INNER, inner: OPENING + 0.2, y: TOWER.roof },
];

// The terrace's deck, between its parapets.
export const TUNG_TUNG_TERRACE: Region = {
  kind: 'ring',
  x: TERRACE.x,
  z: TERRACE.z,
  r: TERRACE.r - 0.2,
  inner: TERRACE.inner + 0.2,
  y: TOP,
};
