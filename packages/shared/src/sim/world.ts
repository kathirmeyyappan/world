// The walkable world: discs joined by bridges, all unioned. Everything that cares about the
// outline reads this: the sim's clamp (server and client), the wall and floor renderers, sky
// object placement and the minimap. Signed distance is the one primitive they share.
import type { Rng } from './rng';
import type { Vec3 } from './types';

export interface Disc {
  kind: 'disc';
  x: number;
  z: number;
  r: number;
}

// A straight corridor between two points. Its ends should sit inside the discs it joins.
export interface Bridge {
  kind: 'bridge';
  ax: number;
  az: number;
  bx: number;
  bz: number;
  halfWidth: number;
}

export type WorldPart = Disc | Bridge;

export const WORLD_SHAPE: WorldPart[] = [
  { kind: 'disc', x: 0, z: 0, r: 50 }, // main area; players spawn at its centre
  { kind: 'disc', x: 112, z: 0, r: 30 }, // annex
  { kind: 'bridge', ax: 40, az: 0, bx: 92, bz: 0, halfWidth: 4 },
];

// Signed distance from (x, z) to one part's edge: negative inside.
export function partDistance(x: number, z: number, part: WorldPart): number {
  if (part.kind === 'disc') return Math.hypot(x - part.x, z - part.z) - part.r;
  const q = closestOnSegment(x, z, part);
  return Math.hypot(x - q.x, z - q.z) - part.halfWidth;
}

// Signed distance to the world's edge: negative inside, positive outside, in metres.
export function worldDistance(x: number, z: number, shape: WorldPart[] = WORLD_SHAPE): number {
  let d = Infinity;
  for (const part of shape) d = Math.min(d, partDistance(x, z, part));
  return d;
}

export function worldBounds(shape: WorldPart[] = WORLD_SHAPE): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const grow = (x: number, z: number, r: number) => {
    b.minX = Math.min(b.minX, x - r);
    b.maxX = Math.max(b.maxX, x + r);
    b.minZ = Math.min(b.minZ, z - r);
    b.maxZ = Math.max(b.maxZ, z + r);
  };
  for (const part of shape) {
    if (part.kind === 'disc') grow(part.x, part.z, part.r);
    else {
      grow(part.ax, part.az, part.halfWidth);
      grow(part.bx, part.bz, part.halfWidth);
    }
  }
  return b;
}

export function worldDiscs(shape: WorldPart[] = WORLD_SHAPE): Disc[] {
  return shape.filter((p): p is Disc => p.kind === 'disc');
}

// Keeps `pos` at least `padding` inside the world. Finds the part the point is deepest in (or
// nearest to) and pushes the point back onto that part's inset edge, which slides naturally
// along walls and lets a player pass from a disc into a bridge without a seam.
export function clampToWorld(pos: Vec3, padding: number, shape: WorldPart[] = WORLD_SHAPE): void {
  let best: WorldPart | null = null;
  let bestD = Infinity;
  for (const part of shape) {
    const d = partDistance(pos.x, pos.z, part);
    if (d < bestD) {
      bestD = d;
      best = part;
    }
  }
  if (!best || bestD <= -padding) return;

  let cx: number;
  let cz: number;
  let radius: number;
  if (best.kind === 'disc') {
    cx = best.x;
    cz = best.z;
    radius = best.r - padding;
  } else {
    const q = closestOnSegment(pos.x, pos.z, best);
    cx = q.x;
    cz = q.z;
    radius = best.halfWidth - padding;
  }
  const dx = pos.x - cx;
  const dz = pos.z - cz;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-9) return;
  pos.x = cx + (dx / dist) * radius;
  pos.z = cz + (dz / dist) * radius;
}

// A random point at least `margin` inside the given disc, via rejection so density is uniform.
export function randomPointInDisc(disc: Disc, margin: number, rng: Rng): { x: number; z: number } {
  const r = Math.max(0, disc.r - margin);
  const a = rng() * Math.PI * 2;
  const d = Math.sqrt(rng()) * r;
  return { x: disc.x + Math.cos(a) * d, z: disc.z + Math.sin(a) * d };
}

// The disc a point is in, or the nearest one.
export function nearestDisc(x: number, z: number, shape: WorldPart[] = WORLD_SHAPE): Disc {
  let best: Disc | null = null;
  let bestD = Infinity;
  for (const disc of worldDiscs(shape)) {
    const d = partDistance(x, z, disc);
    if (d < bestD) {
      bestD = d;
      best = disc;
    }
  }
  if (!best) throw new Error('world shape has no discs');
  return best;
}

function closestOnSegment(x: number, z: number, b: Bridge): { x: number; z: number } {
  const vx = b.bx - b.ax;
  const vz = b.bz - b.az;
  const len2 = vx * vx + vz * vz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - b.ax) * vx + (z - b.az) * vz) / len2));
  return { x: b.ax + vx * t, z: b.az + vz * t };
}
