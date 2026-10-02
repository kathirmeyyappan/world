// Regions: flat stretches of the world that things are placed in, each a disc, a ring or an
// axis-aligned rectangle on a floor at height `y`. Content names them (content/regions.ts) and anything that
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

// The band between radius `inner` and radius `r` round (x, z): a deck with a hole in the middle.
export interface Ring {
  kind: 'ring';
  x: number;
  z: number;
  r: number;
  inner: number;
}

export type Region = (Disc | Ring | Rect) & { y: number };

// Radians round a ring that one stretch of a drift may cover: a straight line between two points
// that close together, both well out from the hole, passes clear of it.
const RING_TURN = 0.8;

// A random point at least `margin` inside the region, uniform over it, on its floor.
export function randomPointInRegion(region: Region, margin: number, rng: Rng): Vec3 {
  if (region.kind === 'disc') return { ...randomPointInDisc(region, margin, rng), y: region.y };
  if (region.kind === 'ring') return pointInRing(region, margin, rng() * 2 * Math.PI, rng);
  const halfW = Math.max(0, region.w / 2 - margin);
  const halfD = Math.max(0, region.d / 2 - margin);
  return { x: region.x + (rng() * 2 - 1) * halfW, y: region.y, z: region.z + (rng() * 2 - 1) * halfD };
}

// A random point in the region to head for from `from` without leaving it on the way: anywhere, but
// in a ring, no more than RING_TURN round from `from`, so the line there doesn't cross the hole.
export function nextPointInRegion(region: Region, margin: number, from: { x: number; z: number }, rng: Rng): Vec3 {
  if (region.kind !== 'ring') return randomPointInRegion(region, margin, rng);
  const at = Math.atan2(from.z - region.z, from.x - region.x);
  return pointInRing(region, margin, at + (rng() * 2 - 1) * RING_TURN, rng);
}

// A point at `angle` round a ring, at a random distance out, at least `margin` from both edges;
// uniform over the band's area.
function pointInRing(ring: Ring & { y: number }, margin: number, angle: number, rng: Rng): Vec3 {
  const lo = ring.inner + margin;
  const hi = Math.max(lo, ring.r - margin);
  const d = Math.sqrt(lo * lo + rng() * (hi * hi - lo * lo));
  return { x: ring.x + Math.cos(angle) * d, y: ring.y, z: ring.z + Math.sin(angle) * d };
}
