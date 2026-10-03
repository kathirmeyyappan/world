// Tung Tung Tower: an 80 m brick keep in the middle of the annex, sealed floor by floor, with an
// entrance on each side. Each storey is 20 m, and a wooden stair climbs half a turn against the
// inside wall from each floor up through a hole in the one above, so the flights chain into one
// spiral: ground, 20, 40, then the top floor at 60. Every floor above the ground has six doors out
// to a balcony ringing the tower behind a low parapet (a sniper's perch), and the top balcony's west
// side opens onto a sky bridge. The bridge runs back over the floor bridge (inside the outline's
// corridor, so players can't be clamped off it) to a terrace floating over the middle of the main
// disc: a ring of deck round an open, walled middle. A roof
// closes the top, with the wall standing on past it as a parapet and merlons along that.
import { roundFloor, roundWall, spiralStairs, wall, type Box, type Structure } from '../sim/structures';
import { ANNEX } from '../sim/outline';
import type { Region } from '../sim/regions';
import type { RoundRoom } from '../sim/wallFrames';
import type { Vec3 } from '../sim/types';
import type { Disc } from '../sim/world';

const X = ANNEX.x;
const Z = ANNEX.z;
const HEIGHT = 80; // the roof
const ROOF_WALL = 1; // the wall stands this far above the roof all the way round (cover to shoot over)
const MERLON = 1.5; // and every other segment stands this far above that
const OUTER = 20; // outside face of the wall
const WALL = 1;
const SEGMENTS = 48; // straight pieces the wall is built from, 7.5° each
const INNER = OUTER - WALL; // inside face of the wall
const STAIR_WIDTH = 3.75;
const STAIR_INNER = INNER - STAIR_WIDTH;
const FLOOR_R = INNER + WALL / 2; // floors run into the wall, so there's no gap at its foot
const STOREY = 20;
const TOP = 3 * STOREY; // the top floor, where the sky bridge leaves
const GROUND_FLOOR = 0.05; // the ground floor's tiles sit this far above the annex floor
const SLAB = 0.4; // thickness of the upper floors
const ROOF_SLAB = 0.6;
const deg = (d: number) => (d * Math.PI) / 180; // angles run from +x toward +z
const STAIR_START = deg(45); // the first step; clear of all four entrances
const HOLE = deg(30); // each floor is open over the last 30° of the flight arriving through it
const DOOR_HEIGHT = 3;
const ENTRANCES = [0, 90, 180, 270].map(deg); // ground floor; 180° faces the floor bridge
// Balcony doors on each upper floor. Every floor's stair hole ends at 45° or 225°, where that
// floor's flight also starts, so the doors keep clear of both (a door is 7.5°, one wall segment).
const BALCONY_DOORS = [0, 75, 127.5, 180, 255, 307.5].map(deg);
const BRIDGE_DOOR = deg(180); // west, facing the main disc: the top balcony's way onto the bridge
// The main doors, west toward the main disc on the ground floor and onto the sky bridge from the
// top floor, are twice the others' width (two wall segments) and height.
const MAIN_DOOR = { angle: deg(180), width: deg(15), height: 2 * DOOR_HEIGHT };
const BALCONY = 3; // metres of balcony outside the wall
const PARAPET = 0.8; // under half a body, so it's cover you can shoot over
// Door sills, the stair's landings and the bridge deck sit this far below the floors they meet, so
// no two surfaces share a height where they overlap (they'd flicker).
const SILL = 0.02;
const DECK = 0.4; // thickness of the bridge and terrace decks

const TERRACE = { x: 0, z: 0, r: 20, inner: 8 }; // round the middle of the main disc, open within `inner`
const BRIDGE_WIDTH = 4;
const RAIL = 1.1;

const shell: Structure[] = [
  ...roundWall({
    x: X,
    z: Z,
    r: OUTER - WALL / 2,
    h: HEIGHT + ROOF_WALL, // past the roof, whose edge then ends inside the wall rather than level with its top
    thickness: WALL,
    segments: SEGMENTS,
    gaps: [
      ...ENTRANCES.map((angle) =>
        angle === MAIN_DOOR.angle
          ? { angle, width: MAIN_DOOR.width, bottom: 0, top: MAIN_DOOR.height }
          : { angle, bottom: 0, top: DOOR_HEIGHT },
      ),
      ...[STOREY, 2 * STOREY, TOP].flatMap((level) =>
        BALCONY_DOORS.map((angle) =>
          level === TOP && angle === MAIN_DOOR.angle
            ? { angle, width: MAIN_DOOR.width, bottom: level - SILL, top: level + MAIN_DOOR.height }
            : { angle, bottom: level - SILL, top: level + DOOR_HEIGHT },
        ),
      ),
    ],
    material: 'brick',
  }),
  ...roundFloor({ x: X, z: Z, r: FLOOR_R, y: HEIGHT, thickness: ROOF_SLAB, material: 'flagstone' }), // the roof
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
    bottom: -SILL, // so each landing's step (and the rail post beneath it) sits just under its floor
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
      thickness: SLAB,
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

export const TUNG_TUNG_TOWER: Structure[] = [...shell, ...inside, ...balconies, ...skyway, ...terrace];

// The keep's wall on the ground, for the minimap (content/landmarks.ts).
export const TUNG_TUNG_TOWER_FOOTPRINT: Disc = { kind: 'disc', x: X, z: Z, r: OUTER };

// The middle of each floor's top, ground floor first: where to stand something on floor n.
export const TUNG_TUNG_TOWER_FLOORS: Vec3[] = [GROUND_FLOOR, STOREY, 2 * STOREY, TOP].map((y) => ({ x: X, y, z: Z }));

// The four floors inside the wall, ground floor first: each one's open disc inside the stair,
// which runs round against the wall.
export const TUNG_TUNG_TOWER_INSIDE: Region[] = [GROUND_FLOOR, STOREY, 2 * STOREY, TOP].map((y): Region => ({
  kind: 'disc',
  x: X,
  z: Z,
  r: STAIR_INNER,
  y,
}));

// Each level's open floor, for placing things (content/regions.ts): the four inside, and the whole
// roof.
export const TUNG_TUNG_TOWER_LEVELS: Region[] = [
  ...TUNG_TUNG_TOWER_INSIDE,
  { kind: 'disc', x: X, z: Z, r: INNER, y: HEIGHT },
];

// The four floors inside the wall as rooms to hang frames in (sim/wallFrames.ts), ground floor
// first. Frames centre halfway up each storey, and a frame's angle 0 is the main entrance's bearing
// on every floor; each floor below the top has the flight that leaves it, which starts where the
// one arriving through its hole ended.
const DOOR = (2 * Math.PI) / SEGMENTS; // an ordinary door is one wall segment wide
export const TUNG_TUNG_TOWER_ROOMS: RoundRoom[] = [GROUND_FLOOR, STOREY, 2 * STOREY, TOP].map((floor, s) => ({
  x: X,
  z: Z,
  floor,
  ceiling: floor === TOP ? HEIGHT - ROOF_SLAB : (s + 1) * STOREY - SLAB,
  middle: s * STOREY + STOREY / 2,
  wall: { r: OUTER - WALL / 2, thickness: WALL, segments: SEGMENTS },
  entrance: MAIN_DOOR.angle,
  doors: (s === 0 ? ENTRANCES : BALCONY_DOORS).map((angle) => {
    const main = angle === MAIN_DOOR.angle && (s === 0 || floor === TOP);
    return { angle, width: main ? MAIN_DOOR.width : DOOR, top: main ? MAIN_DOOR.height : DOOR_HEIGHT };
  }),
  stair: floor === TOP ? undefined : { from: STAIR_START + s * Math.PI, climb: STOREY / Math.PI },
}));

// The terrace's deck, between its parapets.
export const TUNG_TUNG_TERRACE: Region = {
  kind: 'ring',
  x: TERRACE.x,
  z: TERRACE.z,
  r: TERRACE.r - 0.2,
  inner: TERRACE.inner + 0.2,
  y: TOP,
};
