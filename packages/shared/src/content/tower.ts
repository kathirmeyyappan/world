// Tung Tung Tower: an 80 m brick keep in the middle of the annex, sealed floor by floor. Each storey
// is 20 m, and a wooden stair climbs half a turn against the inside wall from each floor up through a
// hole in the one above, so the flights chain into one spiral: ground, 20, 40, then the top floor at
// 60, whose west door opens onto a sky bridge. The bridge runs back over the floor bridge (inside
// the outline's corridor, so players can't be clamped off it) to a floating terrace above the main
// disc. A roof with battlements closes the top.
import { roundFloor, roundWall, spiralStairs, wall, type Box, type Structure } from '../sim/structures';
import { ANNEX } from '../sim/outline';
import type { WorldPart } from '../sim/world';

const X = ANNEX.x;
const Z = ANNEX.z;
const HEIGHT = 80;
const OUTER = 20; // outside face of the wall
const WALL = 1;
const INNER = OUTER - WALL; // inside face of the wall
const STAIR_WIDTH = 3.75;
const STAIR_INNER = INNER - STAIR_WIDTH;
const FLOOR_R = INNER + WALL / 2; // floors run into the wall, so there's no gap at its foot
const STOREY = 20;
const TOP = 3 * STOREY; // the top floor, where the sky bridge leaves
const STAIR_START = Math.PI / 2; // the first step, on the +z side; angles run from +x toward +z
const HOLE = Math.PI / 6; // each floor is open over the last 30° of the flight arriving through it
const DOOR = Math.PI; // west, facing the main disc
const DOOR_HEIGHT = 3;
const DECK = 0.4; // thickness of the bridge and terrace decks

const TERRACE = { x: 30, z: 0, w: 16, d: 16 }; // over the east side of the main disc
const BRIDGE_WIDTH = 4;
const RAIL = 1.1;

const shell: Structure[] = [
  ...roundWall({
    x: X,
    z: Z,
    r: OUTER - WALL / 2,
    h: HEIGHT,
    thickness: WALL,
    segments: 48,
    gaps: [
      { angle: DOOR, bottom: 0, top: DOOR_HEIGHT }, // ground-floor entrance, facing the floor bridge
      { angle: DOOR, bottom: TOP, top: TOP + DOOR_HEIGHT }, // top-floor door onto the sky bridge
    ],
    material: 'brick',
  }),
  ...roundFloor({ x: X, z: Z, r: FLOOR_R, y: HEIGHT, thickness: 0.6, material: 'flagstone' }), // the roof
  // Battlements: a merlon on every other segment of the wall top.
  ...Array.from({ length: 24 }, (_, k): Box => {
    const a = (k * 2 * Math.PI) / 24;
    const r = OUTER - WALL / 2;
    const along = 0.045; // half the merlon's arc, in radians
    return {
      ...wall(
        { x: X + r * Math.cos(a - along), z: Z + r * Math.sin(a - along) },
        { x: X + r * Math.cos(a + along), z: Z + r * Math.sin(a + along) },
        1.5,
        WALL,
        HEIGHT,
      ),
      material: 'brick',
    };
  }),
];

// Storey s runs from floor s up to floor s + 1; its flight covers half a turn, so flight s ends (and
// floor s + 1's hole sits) at STAIR_START + (s + 1) half turns.
const flightEnd = (s: number) => STAIR_START + (s + 1) * Math.PI;
const inside: Structure[] = [
  ...spiralStairs({
    x: X,
    z: Z,
    inner: STAIR_INNER,
    outer: INNER,
    bottom: 0,
    rise: TOP,
    turns: 1.5,
    start: STAIR_START,
    rail: 1,
    material: 'wood',
  }),
  ...roundFloor({ x: X, z: Z, r: FLOOR_R, y: 0.05, thickness: 0.05, material: 'red-tile' }), // the ground floor
  ...[1, 2, 3].flatMap((floor) =>
    roundFloor({
      x: X,
      z: Z,
      r: FLOOR_R,
      y: floor * STOREY,
      hole: { inner: STAIR_INNER, from: flightEnd(floor - 1) - HOLE, to: flightEnd(floor - 1) },
      material: 'red-tile',
    }),
  ),
];

// A low wall along a deck edge at the top floor's height, from a to b.
const rail = (a: { x: number; z: number }, b: { x: number; z: number }): Box => ({
  ...wall(a, b, RAIL, 0.2, TOP),
  material: 'brick',
});

const bridgeStart = X - FLOOR_R; // back through the doorway to where the top floor ends
const bridgeEnd = TERRACE.x + TERRACE.w / 2;
const halfW = BRIDGE_WIDTH / 2;
const skyway: Structure[] = [
  {
    kind: 'box',
    x: (bridgeStart + bridgeEnd) / 2,
    z: Z,
    y: TOP - DECK,
    w: bridgeStart - bridgeEnd,
    d: BRIDGE_WIDTH,
    h: DECK,
    material: 'flagstone',
  },
  rail({ x: bridgeEnd, z: Z - halfW }, { x: bridgeStart, z: Z - halfW }),
  rail({ x: bridgeEnd, z: Z + halfW }, { x: bridgeStart, z: Z + halfW }),
];

const t = {
  x0: TERRACE.x - TERRACE.w / 2,
  x1: bridgeEnd,
  z0: TERRACE.z - TERRACE.d / 2,
  z1: TERRACE.z + TERRACE.d / 2,
};
const terrace: Structure[] = [
  { kind: 'box', ...TERRACE, y: TOP - DECK, h: DECK, material: 'flagstone' },
  rail({ x: t.x0, z: t.z0 }, { x: t.x1, z: t.z0 }),
  rail({ x: t.x0, z: t.z1 }, { x: t.x1, z: t.z1 }),
  rail({ x: t.x0, z: t.z0 }, { x: t.x0, z: t.z1 }),
  // The east rail leaves a gap where the bridge meets the terrace.
  rail({ x: t.x1, z: t.z0 }, { x: t.x1, z: Z - halfW }),
  rail({ x: t.x1, z: Z + halfW }, { x: t.x1, z: t.z1 }),
];

export const TUNG_TUNG_TOWER: Structure[] = [...shell, ...inside, ...skyway, ...terrace];

// Where the sky bridge and terrace are, for naming the area (content/areas.ts): a strip from the
// door to the terrace's far edge, as wide as the terrace, and the height of the decks.
export const SKYWAY_REGION: WorldPart = {
  kind: 'bridge',
  ax: t.x0,
  az: Z,
  bx: bridgeStart,
  bz: Z,
  halfWidth: TERRACE.d / 2,
};
export const SKYWAY_HEIGHT = TOP;
