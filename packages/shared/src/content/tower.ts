// The annex tower: an 80 m grey keep in the middle of the annex. A spiral stair climbs the inside
// wall, arriving at a floor every 20 m (20, 40 and 60). The top floor's west door opens onto a sky
// bridge that runs back over the floor bridge (inside the outline's corridor, so players can't be
// clamped off it) to a floating terrace above the main disc.
import { roundFloor, roundWall, spiralStairs, wall, type Box, type Structure } from '../sim/structures';

const X = 112; // the annex's centre (sim/world.ts)
const Z = 0;
const HEIGHT = 80;
const OUTER = 11; // outside face of the wall
const WALL = 1;
const STAIR_INNER = 7.5; // the stairwell is the ring between here and the wall
const FLOOR_R = 7.4;
const STOREY = 20;
const DOOR = Math.PI; // west, facing the main disc
const DOOR_HEIGHT = 3;
const TOP = 3 * STOREY; // the top floor, where the sky bridge leaves
const DECK = 0.4; // thickness of the walkway, bridge and terrace decks

const STONE = '#77777c';
const STEP = '#66666b';
const WOOD = '#5b5249';
const DECK_STONE = '#6e6e73';

const TERRACE = { x: 30, z: 0, w: 16, d: 16 }; // over the east side of the main disc
const BRIDGE_WIDTH = 4;
const RAIL = 1.1;

// A low wall along a deck edge, from a to b.
const rail = (a: { x: number; z: number }, b: { x: number; z: number }): Box => ({
  ...wall(a, b, RAIL, 0.2, TOP),
  color: STONE,
});

const shell: Structure[] = [
  ...roundWall({
    x: X,
    z: Z,
    r: OUTER - WALL / 2,
    h: HEIGHT,
    thickness: WALL,
    gaps: [
      { angle: DOOR, bottom: 0, top: DOOR_HEIGHT }, // ground-floor entrance, facing the floor bridge
      { angle: DOOR, bottom: TOP, top: TOP + DOOR_HEIGHT }, // top-floor door onto the sky bridge
    ],
    color: STONE,
  }),
  // Battlements: a merlon on every other segment of the wall top.
  ...Array.from({ length: 16 }, (_, k) => {
    const a = (k * 2 * Math.PI) / 16;
    const r = OUTER - WALL / 2;
    const along = 0.08; // half the merlon's arc, in radians
    return {
      ...wall(
        { x: X + r * Math.cos(a - along), z: Z + r * Math.sin(a - along) },
        { x: X + r * Math.cos(a + along), z: Z + r * Math.sin(a + along) },
        1.5,
        WALL,
        HEIGHT,
      ),
      color: STONE,
    };
  }),
];

const inside: Structure[] = [
  // One continuous flight: three turns from the ground to the top floor, starting and arriving on
  // the east side, so each floor is reached where the next turn begins.
  ...spiralStairs({
    x: X,
    z: Z,
    inner: STAIR_INNER,
    outer: OUTER - WALL,
    bottom: 0,
    rise: TOP,
    turns: 3,
    start: 0,
    color: STEP,
  }),
  ...[STOREY, 2 * STOREY, TOP].flatMap((y) => roundFloor({ x: X, z: Z, r: FLOOR_R, y, color: WOOD })),
  // The top floor's walkway across the stairwell to the door; the flight passes 10 m beneath it.
  {
    kind: 'box',
    x: X - (FLOOR_R + OUTER) / 2,
    z: Z,
    y: TOP - DECK,
    w: OUTER - FLOOR_R + 0.5,
    d: 2,
    h: DECK,
    color: WOOD,
  },
];

const bridgeStart = X - OUTER; // just outside the door
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
    color: DECK_STONE,
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
  { kind: 'box', ...TERRACE, y: TOP - DECK, h: DECK, color: DECK_STONE },
  rail({ x: t.x0, z: t.z0 }, { x: t.x1, z: t.z0 }),
  rail({ x: t.x0, z: t.z1 }, { x: t.x1, z: t.z1 }),
  rail({ x: t.x0, z: t.z0 }, { x: t.x0, z: t.z1 }),
  // The east rail leaves a gap where the bridge meets the terrace.
  rail({ x: t.x1, z: t.z0 }, { x: t.x1, z: Z - halfW }),
  rail({ x: t.x1, z: Z + halfW }, { x: t.x1, z: t.z1 }),
];

export const ANNEX_TOWER: Structure[] = [...shell, ...inside, ...skyway, ...terrace];
