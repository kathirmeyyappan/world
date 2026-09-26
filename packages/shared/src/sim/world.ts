// The walkable world as a union of discs. One disc today; more discs make connected areas.
// Anything that needs to know the world's outline (the minimap, and later the sim's bounds)
// reads this rather than assuming a circle.
import { WORLD_RADIUS } from './constants';

export interface Disc {
  x: number;
  z: number;
  r: number;
}

export const WORLD_SHAPE: Disc[] = [{ x: 0, z: 0, r: WORLD_RADIUS }];

// Signed distance to the shape's edge: negative inside, positive outside, in metres.
export function worldDistance(x: number, z: number, shape: Disc[] = WORLD_SHAPE): number {
  let d = Infinity;
  for (const disc of shape) d = Math.min(d, Math.hypot(x - disc.x, z - disc.z) - disc.r);
  return d;
}

export function worldBounds(shape: Disc[] = WORLD_SHAPE): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const disc of shape) {
    b.minX = Math.min(b.minX, disc.x - disc.r);
    b.maxX = Math.max(b.maxX, disc.x + disc.r);
    b.minZ = Math.min(b.minZ, disc.z - disc.r);
    b.maxZ = Math.max(b.maxZ, disc.z + disc.r);
  }
  return b;
}
