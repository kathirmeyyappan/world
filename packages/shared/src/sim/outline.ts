// The parts of the walkable outline (world.ts), in a module of their own so content can place
// things relative to them without importing world.ts, which imports the content.
import type { Bridge, Disc } from './world';

export const MAIN_DISC: Disc = { kind: 'disc', x: 0, z: 0, r: 50 }; // the cubes' home
export const ANNEX: Disc = { kind: 'disc', x: 112, z: 0, r: 30 }; // Tung Tung Tower's grounds
export const FLOOR_BRIDGE: Bridge = { kind: 'bridge', ax: 40, az: 0, bx: 92, bz: 0, halfWidth: 4 };

// Buildings 1 to 4's grounds, round the far side of the main disc from the annex at these bearings
// (degrees from +x toward +z), each joined to it by a path narrower than the floor bridge.
const BUILDING_BEARINGS = [90, 150, 210, 270];
const BUILDING_OUT = 100; // metres from the main disc's middle to each building's
const BUILDING_GROUND = 25; // radius of each one's grounds: 5 m round its wall
export const BUILDING_GROUNDS: Disc[] = BUILDING_BEARINGS.map((d) => ({
  kind: 'disc',
  x: BUILDING_OUT * Math.cos((d * Math.PI) / 180),
  z: BUILDING_OUT * Math.sin((d * Math.PI) / 180),
  r: BUILDING_GROUND,
}));
// From 10 m inside the main disc to 10 m inside the grounds, like the floor bridge.
export const BUILDING_PATHS: Bridge[] = BUILDING_GROUNDS.map((g) => {
  const a = (MAIN_DISC.r - 10) / BUILDING_OUT; // the ends, as fractions of the way out
  const b = (BUILDING_OUT - BUILDING_GROUND + 10) / BUILDING_OUT;
  return { kind: 'bridge', ax: g.x * a, az: g.z * a, bx: g.x * b, bz: g.z * b, halfWidth: 3 };
});
