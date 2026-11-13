// The parts of the walkable outline (world.ts), in a module of their own so content can place
// things relative to them without importing world.ts, which imports the content.
import type { Arc, Bridge, Disc } from './world';

export const MAIN_DISC: Disc = { kind: 'disc', x: 0, z: 0, r: 50 }; // the cubes' home
export const ANNEX: Disc = { kind: 'disc', x: 112, z: 0, r: 30 }; // Tung Tung Tower's grounds
export const FLOOR_BRIDGE: Bridge = { kind: 'bridge', ax: 40, az: 0, bx: 92, bz: 0, halfWidth: 4 };

// Buildings 1 to 4's grounds and paths: the annex and the floor bridge turned round the main disc's
// middle to each one's bearing (degrees from +x toward +z), round its far side from the tower, at
// the annex's distance and size unless the building says otherwise. SpongeBob's house stands
// further out on wider grounds, so its dune sits on the floor with room round it.
const BUILDING_SITES: { bearing: number; out?: number; r?: number }[] = [
  { bearing: 90, out: 124, r: 36 },
  { bearing: 150 },
  { bearing: 210 },
  { bearing: 270 },
];
const PATH_INTO = FLOOR_BRIDGE.bx - (ANNEX.x - ANNEX.r); // metres a path runs on into the grounds it leads to
const turned = (deg: number, x: number, z: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: x * Math.cos(a) - z * Math.sin(a), z: x * Math.sin(a) + z * Math.cos(a) };
};
export const BUILDING_GROUNDS: Disc[] = BUILDING_SITES.map(({ bearing, out = ANNEX.x, r = ANNEX.r }) => ({
  kind: 'disc',
  ...turned(bearing, out, 0),
  r,
}));
export const BUILDING_PATHS: Bridge[] = BUILDING_SITES.map(({ bearing, out = ANNEX.x, r = ANNEX.r }) => {
  const a = turned(bearing, FLOOR_BRIDGE.ax, FLOOR_BRIDGE.az);
  const b = turned(bearing, out - r + PATH_INTO, 0);
  return { ...FLOOR_BRIDGE, ax: a.x, az: a.z, bx: b.x, bz: b.z };
});
// Round the far side at the annex's distance, through all four buildings' grounds, twice as wide as a
// path.
export const BUILDING_ARC: Arc = {
  kind: 'arc',
  x: MAIN_DISC.x,
  z: MAIN_DISC.z,
  r: ANNEX.x,
  from: (Math.min(...BUILDING_SITES.map((s) => s.bearing)) * Math.PI) / 180,
  to: (Math.max(...BUILDING_SITES.map((s) => s.bearing)) * Math.PI) / 180,
  halfWidth: 2 * FLOOR_BRIDGE.halfWidth,
};
