// The walkable world: discs joined by bridges, and pie slices, all unioned. Everything that cares about the
// outline reads this: the sim's clamp (server and client), the wall and floor renderers, sky
// object placement and the minimap. Signed distance is the one primitive they share.
import { STRUCTURES } from '../content/structures';
import { Structures } from './collision';
import { ANNEX, BUILDING_FAN, BUILDING_GROUNDS, BUILDING_PATHS, FLOOR_BRIDGE, MAIN_DISC } from './outline';
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

// A pie slice: everything within r of (x, z) from bearing `from` round to `to` (radians from +x
// toward +z, `to` past `from`), its two straight sides running out from (x, z).
export interface Sector {
  kind: 'sector';
  x: number;
  z: number;
  r: number;
  from: number;
  to: number;
}

export type WorldPart = Disc | Bridge | Sector;

export { ANNEX, BUILDING_FAN, BUILDING_GROUNDS, BUILDING_PATHS, FLOOR_BRIDGE, MAIN_DISC };
// The main disc first: it's the cubes' home (sim/cubes.ts).
export const WORLD_SHAPE: WorldPart[] = [
  MAIN_DISC,
  ANNEX,
  FLOOR_BRIDGE,
  ...BUILDING_GROUNDS,
  ...BUILDING_PATHS,
  BUILDING_FAN,
];

// Metres the ground past the world's edge stands above the floor: below it, so the kerb along the
// edge drops to it and where you can't go reads from afar. Only drawn (render/Environment.ts): the
// sim keeps everyone inside the edge and its floor flat.
export const OUTSIDE_HEIGHT = -1;

// The structures standing inside the outline, indexed for the sim's queries.
export const WORLD_STRUCTURES = new Structures(STRUCTURES);

// Signed distance from (x, z) to one part's edge: negative inside.
export function partDistance(x: number, z: number, part: WorldPart): number {
  if (part.kind === 'disc') return Math.hypot(x - part.x, z - part.z) - part.r;
  if (part.kind === 'sector') {
    const q = closestOnSectorEdge(x, z, part);
    return (inSector(x, z, part) ? -1 : 1) * Math.hypot(x - q.x, z - q.z);
  }
  const q = closestOnSegment(x, z, part);
  return Math.hypot(x - q.x, z - q.z) - part.halfWidth;
}

// Signed distance to the world's edge: negative inside, positive outside, in metres.
export function worldDistance(x: number, z: number, shape: WorldPart[] = WORLD_SHAPE): number {
  let d = Infinity;
  for (const part of shape) d = Math.min(d, partDistance(x, z, part));
  return d;
}

export function worldBounds(shape: WorldPart[] = WORLD_SHAPE): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const grow = (x: number, z: number, r: number) => {
    b.minX = Math.min(b.minX, x - r);
    b.maxX = Math.max(b.maxX, x + r);
    b.minZ = Math.min(b.minZ, z - r);
    b.maxZ = Math.max(b.maxZ, z + r);
  };
  for (const part of shape) {
    if (part.kind === 'disc') grow(part.x, part.z, part.r);
    else if (part.kind === 'bridge') {
      grow(part.ax, part.az, part.halfWidth);
      grow(part.bx, part.bz, part.halfWidth);
    } else {
      grow(part.x, part.z, 0);
      for (let i = 0; i <= 64; i++) {
        const a = part.from + ((part.to - part.from) * i) / 64;
        grow(part.x + part.r * Math.cos(a), part.z + part.r * Math.sin(a), 0);
      }
    }
  }
  return b;
}

export function worldDiscs(shape: WorldPart[] = WORLD_SHAPE): Disc[] {
  return shape.filter((p): p is Disc => p.kind === 'disc');
}

// How far out from the origin the world reaches: a circle round every part of it, the sky a dragon
// flies in, over the ground or the void.
export function worldReach(shape: WorldPart[] = WORLD_SHAPE): number {
  let reach = 0;
  for (const part of shape) {
    if (part.kind === 'disc') reach = Math.max(reach, Math.hypot(part.x, part.z) + part.r);
    else if (part.kind === 'bridge')
      reach = Math.max(
        reach,
        Math.hypot(part.ax, part.az) + part.halfWidth,
        Math.hypot(part.bx, part.bz) + part.halfWidth,
      );
    else reach = Math.max(reach, Math.hypot(part.x, part.z) + part.r);
  }
  return reach;
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

  if (best.kind === 'sector') {
    // Onto the nearest point of its edge, then `padding` back in from it.
    const q = closestOnSectorEdge(pos.x, pos.z, best);
    const out = (inSector(pos.x, pos.z, best) ? -1 : 1) / Math.max(Math.hypot(pos.x - q.x, pos.z - q.z), 1e-9);
    pos.x = q.x - (pos.x - q.x) * out * padding;
    pos.z = q.z - (pos.z - q.z) * out * padding;
    return;
  }
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

// Whether (x, z)'s bearing from the slice's middle is between its sides.
function withinSpan(x: number, z: number, s: Sector): boolean {
  const round = (((Math.atan2(z - s.z, x - s.x) - s.from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); // from `from`
  return round <= s.to - s.from;
}

function inSector(x: number, z: number, s: Sector): boolean {
  return Math.hypot(x - s.x, z - s.z) <= s.r && withinSpan(x, z, s);
}

// The nearest point to (x, z) on the slice's edge: its round side, or either straight one.
function closestOnSectorEdge(x: number, z: number, s: Sector): { x: number; z: number } {
  const side = (a: number) =>
    closestOnSegment(x, z, { ax: s.x, az: s.z, bx: s.x + s.r * Math.cos(a), bz: s.z + s.r * Math.sin(a) });
  const candidates = [side(s.from), side(s.to)];
  const d = Math.hypot(x - s.x, z - s.z);
  if (d > 1e-9 && withinSpan(x, z, s))
    candidates.push({ x: s.x + ((x - s.x) * s.r) / d, z: s.z + ((z - s.z) * s.r) / d });
  let best = candidates[0];
  for (const c of candidates) if (Math.hypot(x - c.x, z - c.z) < Math.hypot(x - best.x, z - best.z)) best = c;
  return best;
}

function closestOnSegment(x: number, z: number, b: Pick<Bridge, 'ax' | 'az' | 'bx' | 'bz'>): { x: number; z: number } {
  const vx = b.bx - b.ax;
  const vz = b.bz - b.az;
  const len2 = vx * vx + vz * vz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - b.ax) * vx + (z - b.az) * vz) / len2));
  return { x: b.ax + vx * t, z: b.az + vz * t };
}
