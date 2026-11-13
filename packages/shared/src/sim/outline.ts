// The parts of the walkable outline (world.ts), in a module of their own so content can place
// things relative to them without importing world.ts, which imports the content.
import type { Bridge, Disc, Sector } from './world';

export const MAIN_DISC: Disc = { kind: 'disc', x: 0, z: 0, r: 50 }; // the cubes' home
export const ANNEX: Disc = { kind: 'disc', x: 112, z: 0, r: 30 }; // Tung Tung Tower's grounds
export const FLOOR_BRIDGE: Bridge = { kind: 'bridge', ax: 40, az: 0, bx: 92, bz: 0, halfWidth: 8 };

// Buildings 1 to 4's grounds: discs the annex's size unless the building says otherwise, round the
// main disc's middle at each one's bearing (degrees from +x toward +z), round its far side from the
// tower, out at `out`. SpongeBob's house stands further out than the keeps, on wider grounds, so
// its dune sits on the floor with room round it. Buildings 2 and 3 stand either side of the Krusty
// Krab, which faces the tower from straight across the main disc: the five are a turn of SITE_TURN
// apart.
const KEEP_OUT = 100;
const SITE_TURN = 55;
const KRUSTY_KRAB_BEARING = 180;
const BUILDING_SITES: { bearing: number; out: number; r?: number }[] = [
  { bearing: KRUSTY_KRAB_BEARING - 2 * SITE_TURN, out: 124, r: 52 },
  { bearing: KRUSTY_KRAB_BEARING - SITE_TURN, out: KEEP_OUT },
  { bearing: KRUSTY_KRAB_BEARING + SITE_TURN, out: KEEP_OUT },
  { bearing: KRUSTY_KRAB_BEARING + 2 * SITE_TURN, out: KEEP_OUT },
];
const turned = (deg: number, x: number, z: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: x * Math.cos(a) - z * Math.sin(a), z: x * Math.sin(a) + z * Math.cos(a) };
};
export const BUILDING_GROUNDS: Disc[] = BUILDING_SITES.map(({ bearing, out, r = ANNEX.r }) => ({
  kind: 'disc',
  ...turned(bearing, out, 0),
  r,
}));
// The Krusty Krab's grounds, on the fan's rim like the keeps': wide enough to walk all the way round
// the building (36 m by 24 m, content/krustyKrab.ts) with ten metres to spare at its corners.
export const KRUSTY_KRAB_GROUNDS: Disc = { kind: 'disc', ...turned(KRUSTY_KRAB_BEARING, KEEP_OUT, 0), r: 32 };
// The open floor between them all: a slice of the main disc's middle out to the keeps' middles,
// from FAN_SPILL degrees short of the first building's bearing round to as far past the last's, so
// its straight sides run out from the main disc into the end buildings' grounds with room beside
// the terrace's staircase there, and the only way out of it is the bridge to the tower.
const FAN_SPILL = 10;
export const BUILDING_FAN: Sector = {
  kind: 'sector',
  x: MAIN_DISC.x,
  z: MAIN_DISC.z,
  r: KEEP_OUT,
  from: ((BUILDING_SITES[0].bearing - FAN_SPILL) * Math.PI) / 180,
  to: ((BUILDING_SITES[BUILDING_SITES.length - 1].bearing + FAN_SPILL) * Math.PI) / 180,
};
