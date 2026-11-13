// The parts of the walkable outline (world.ts), in a module of their own so content can place
// things relative to them without importing world.ts, which imports the content.
import type { Bridge, Disc, Sector } from './world';

export const MAIN_DISC: Disc = { kind: 'disc', x: 0, z: 0, r: 50 }; // the cubes' home
export const ANNEX: Disc = { kind: 'disc', x: 112, z: 0, r: 30 }; // Tung Tung Tower's grounds
export const FLOOR_BRIDGE: Bridge = { kind: 'bridge', ax: 40, az: 0, bx: 92, bz: 0, halfWidth: 8 };
const PATH_HALF_WIDTH = 4; // the buildings' paths, narrower than the bridge to the tower

// Buildings 1 to 4's grounds and paths: the annex and the floor bridge (at PATH_HALF_WIDTH) turned
// round the main disc's middle to each one's bearing (degrees from +x toward +z), round its far side
// from the tower with the widest gap between Buildings 2 and 3, out at `out` on grounds the annex's
// size unless the building says otherwise. SpongeBob's house stands further out than the keeps, on wider grounds, so
// its dune sits on the floor with room round it.
const KEEP_OUT = 100;
const BUILDING_SITES: { bearing: number; out: number; r?: number }[] = [
  { bearing: 70, out: 124, r: 36 },
  { bearing: 135, out: KEEP_OUT },
  { bearing: 225, out: KEEP_OUT },
  { bearing: 290, out: KEEP_OUT },
];
const PATH_INTO = FLOOR_BRIDGE.bx - (ANNEX.x - ANNEX.r); // metres a path runs on into the grounds it leads to
const turned = (deg: number, x: number, z: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: x * Math.cos(a) - z * Math.sin(a), z: x * Math.sin(a) + z * Math.cos(a) };
};
export const BUILDING_GROUNDS: Disc[] = BUILDING_SITES.map(({ bearing, out, r = ANNEX.r }) => ({
  kind: 'disc',
  ...turned(bearing, out, 0),
  r,
}));
export const BUILDING_PATHS: Bridge[] = BUILDING_SITES.map(({ bearing, out, r = ANNEX.r }) => {
  const a = turned(bearing, FLOOR_BRIDGE.ax, FLOOR_BRIDGE.az);
  const b = turned(bearing, out - r + PATH_INTO, 0);
  return { ...FLOOR_BRIDGE, ax: a.x, az: a.z, bx: b.x, bz: b.z, halfWidth: PATH_HALF_WIDTH };
});
// The floor between them all: a slice of the main disc's middle out to the keeps' middles, from the
// first building's bearing round to the last's, so the only way out of it is the bridge to the
// tower. Its straight sides run under the first and last paths, which hide them.
export const BUILDING_FAN: Sector = {
  kind: 'sector',
  x: MAIN_DISC.x,
  z: MAIN_DISC.z,
  r: KEEP_OUT,
  from: (BUILDING_SITES[0].bearing * Math.PI) / 180,
  to: (BUILDING_SITES[BUILDING_SITES.length - 1].bearing * Math.PI) / 180,
};
