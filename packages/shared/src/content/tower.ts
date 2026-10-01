// Tung Tung Tower: an 80 m brick keep in the middle of the annex, sealed floor by floor, with an
// entrance on each side. Each storey is 20 m, and a wooden stair climbs half a turn against the
// inside wall from each floor up through a hole in the one above, so the flights chain into one
// spiral: ground, 20, 40, then the top floor at 60. Every floor above the ground has six doors out
// to a balcony ringing the tower behind a low parapet (a sniper's perch), and the top balcony's west
// side opens onto a sky bridge. The bridge runs back over the floor bridge (inside the outline's
// corridor, so players can't be clamped off it) to a floating terrace above the main disc. A roof
// closes the top, with the wall standing on past it as a parapet and merlons along that.
import { roundFloor, roundWall, spiralStairs, wall, type Box, type Structure } from '../sim/structures';
import { ANNEX } from '../sim/outline';
import type { Region } from '../sim/regions';
import type { Vec3 } from '../sim/types';
import type { Disc } from '../sim/world';

const X = ANNEX.x;
const Z = ANNEX.z;
const HEIGHT = 80; // the roof
const ROOF_WALL = 1; // the wall stands this far above the roof all the way round (cover to shoot over)
const MERLON = 1.5; // and every other segment stands this far above that
const OUTER = 20; // outside face of the wall
const WALL = 1;
const INNER = OUTER - WALL; // inside face of the wall
const STAIR_WIDTH = 3.75;
const STAIR_INNER = INNER - STAIR_WIDTH;
const FLOOR_R = INNER + WALL / 2; // floors run into the wall, so there's no gap at its foot
const STOREY = 20;
const TOP = 3 * STOREY; // the top floor, where the sky bridge leaves
const GROUND_FLOOR = 0.05; // the ground floor's tiles sit this far above the annex floor
const deg = (d: number) => (d * Math.PI) / 180; // angles run from +x toward +z
const STAIR_START = deg(45); // the first step; clear of all four entrances
const HOLE = deg(30); // each floor is open over the last 30° of the flight arriving through it
const DOOR_HEIGHT = 3;
const ENTRANCES = [0, 90, 180, 270].map(deg); // ground floor; 180° faces the floor bridge
// Balcony doors on each upper floor. Every floor's stair hole ends at 45° or 225°, where that
// floor's flight also starts, so the doors keep clear of both (a door is 7.5°, one wall segment).
const BALCONY_DOORS = [0, 75, 127.5, 180, 255, 307.5].map(deg);
const BRIDGE_DOOR = deg(180); // west, facing the main disc: the top balcony's way onto the bridge
const BALCONY = 3; // metres of balcony outside the wall
const PARAPET = 0.8; // under half a body, so it's cover you can shoot over
// Door sills and the bridge deck sit this far below the floors they meet, so no two surfaces share
// a height where they overlap (they'd flicker).
const SILL = 0.02;
const DECK = 0.4; // thickness of the bridge and terrace decks

const TERRACE = { x: 30, z: 0, w: 16, d: 16 }; // over the east side of the main disc
const BRIDGE_WIDTH = 4;
const RAIL = 1.1;

const shell: Structure[] = [
  ...roundWall({
    x: X,
    z: Z,
    r: OUTER - WALL / 2,
    h: HEIGHT + ROOF_WALL, // past the roof, whose edge then ends inside the wall rather than level with its top
    thickness: WALL,
    segments: 48,
    gaps: [
      ...ENTRANCES.map((angle) => ({ angle, bottom: 0, top: DOOR_HEIGHT })),
      ...[STOREY, 2 * STOREY, TOP].flatMap((level) =>
        BALCONY_DOORS.map((angle) => ({ angle, bottom: level - SILL, top: level + DOOR_HEIGHT })),
      ),
    ],
    material: 'brick',
  }),
  ...roundFloor({ x: X, z: Z, r: FLOOR_R, y: HEIGHT, thickness: 0.6, material: 'flagstone' }), // the roof
  // Battlements: a merlon on every other segment of the parapet.
  ...Array.from({ length: 24 }, (_, k): Box => {
    const a = (k * 2 * Math.PI) / 24;
    const r = OUTER - WALL / 2;
    const along = 0.045; // half the merlon's arc, in radians
    return {
      ...wall(
        { x: X + r * Math.cos(a - along), z: Z + r * Math.sin(a - along) },
        { x: X + r * Math.cos(a + along), z: Z + r * Math.sin(a + along) },
        MERLON,
        WALL,
        HEIGHT + ROOF_WALL,
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
  ...roundFloor({ x: X, z: Z, r: FLOOR_R, y: GROUND_FLOOR, thickness: GROUND_FLOOR, material: 'red-tile' }), // the ground floor
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

// A ring outside the wall on every upper floor, reached through BALCONY_DOORS, behind a parapet
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
const bridgeEnd = TERRACE.x + TERRACE.w / 2;
const halfW = BRIDGE_WIDTH / 2;
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
  rail({ x: bridgeEnd, z: Z - halfW }, { x: bridgeStart, z: Z - halfW }, BRIDGE_TOP),
  rail({ x: bridgeEnd, z: Z + halfW }, { x: bridgeStart, z: Z + halfW }, BRIDGE_TOP),
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

export const TUNG_TUNG_TOWER: Structure[] = [...shell, ...inside, ...balconies, ...skyway, ...terrace];

// The keep's wall on the ground, for the minimap (content/landmarks.ts).
export const TUNG_TUNG_TOWER_FOOTPRINT: Disc = { kind: 'disc', x: X, z: Z, r: OUTER };

// The middle of each floor's top, ground floor first: where to stand something on floor n.
export const TUNG_TUNG_TOWER_FLOORS: Vec3[] = [GROUND_FLOOR, STOREY, 2 * STOREY, TOP].map((y) => ({ x: X, y, z: Z }));

// Each level's open floor, for placing things (content/regions.ts): the four floors inside the
// stair, which runs round against the wall, and the whole roof.
export const TUNG_TUNG_TOWER_LEVELS: Region[] = [
  ...[GROUND_FLOOR, STOREY, 2 * STOREY, TOP].map((y): Region => ({ kind: 'disc', x: X, z: Z, r: STAIR_INNER, y })),
  { kind: 'disc', x: X, z: Z, r: INNER, y: HEIGHT },
];

// The terrace's deck, inside its rails.
export const TUNG_TUNG_TERRACE: Region = { kind: 'rect', ...TERRACE, y: TOP };
