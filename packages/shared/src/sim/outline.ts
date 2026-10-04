// The parts of the walkable outline (world.ts), in a module of their own so content can place
// things relative to them without importing world.ts, which imports the content.
import type { Arc, Bridge, Disc } from './world';

export const MAIN_DISC: Disc = { kind: 'disc', x: 0, z: 0, r: 50 }; // the cubes' home
export const ANNEX: Disc = { kind: 'disc', x: 112, z: 0, r: 30 }; // Tung Tung Tower's grounds
export const FLOOR_BRIDGE: Bridge = { kind: 'bridge', ax: 40, az: 0, bx: 92, bz: 0, halfWidth: 4 };

// Buildings 1 to 4's grounds and paths: the annex and the floor bridge turned round the main disc's
// middle to these bearings (degrees from +x toward +z), round its far side from the tower.
const BUILDING_BEARINGS = [90, 150, 210, 270];
const turned = (deg: number, x: number, z: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: x * Math.cos(a) - z * Math.sin(a), z: x * Math.sin(a) + z * Math.cos(a) };
};
export const BUILDING_GROUNDS: Disc[] = BUILDING_BEARINGS.map((d) => ({ ...ANNEX, ...turned(d, ANNEX.x, ANNEX.z) }));
export const BUILDING_PATHS: Bridge[] = BUILDING_BEARINGS.map((d) => {
  const a = turned(d, FLOOR_BRIDGE.ax, FLOOR_BRIDGE.az);
  const b = turned(d, FLOOR_BRIDGE.bx, FLOOR_BRIDGE.bz);
  return { ...FLOOR_BRIDGE, ax: a.x, az: a.z, bx: b.x, bz: b.z };
});
// Round the far side, through all four buildings' grounds, twice as wide as a path.
export const BUILDING_ARC: Arc = {
  kind: 'arc',
  x: MAIN_DISC.x,
  z: MAIN_DISC.z,
  r: ANNEX.x,
  from: (Math.min(...BUILDING_BEARINGS) * Math.PI) / 180,
  to: (Math.max(...BUILDING_BEARINGS) * Math.PI) / 180,
  halfWidth: 2 * FLOOR_BRIDGE.halfWidth,
};
