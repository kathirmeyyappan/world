// Regions: flat stretches of the world that things are placed in, each a disc or an axis-aligned
// rectangle on a floor at height `y`. Content names them (content/regions.ts) and anything that
// spawns somewhere picks its spot from one, so reshaping a place is one edit.
import type { Rng } from './rng';
import type { Vec3 } from './types';
import { randomPointInDisc, type Disc } from './world';

// A rectangle `w` wide along x and `d` deep along z, centred on (x, z).
export interface Rect {
  kind: 'rect';
  x: number;
  z: number;
  w: number;
  d: number;
}

export type Region = (Disc | Rect) & { y: number };

// A random point at least `margin` inside the region, uniform over it, on its floor.
export function randomPointInRegion(region: Region, margin: number, rng: Rng): Vec3 {
  if (region.kind === 'disc') return { ...randomPointInDisc(region, margin, rng), y: region.y };
  const halfW = Math.max(0, region.w / 2 - margin);
  const halfD = Math.max(0, region.d / 2 - margin);
  return { x: region.x + (rng() * 2 - 1) * halfW, y: region.y, z: region.z + (rng() * 2 - 1) * halfD };
}
