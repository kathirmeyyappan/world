// The sim's view of the structures (structures.ts): where a player can stand, what stops them,
// what they bump their head on, and what a shot can't pass. Pure, so the Room and the client's
// prediction get identical answers. With no structures every query answers as the bare floor
// does: ground 0, no ceiling, nothing in the way.
import { surfaceOf, validateStructure, type Structure } from './structures';
import type { Vec3 } from './types';

const CELL = 8; // metres per spatial-grid cell
const RAY_STEP = 0.05; // metres between samples when a ray crosses a sloped top

// The part of a player that meets structures: a vertical cylinder from feet to head. Anything
// whose top is at or below `reach` (the feet plus a step) is ground, not a wall.
export interface Body {
  head: number;
  reach: number;
  radius: number;
}

interface Placed {
  x: number;
  z: number;
  cos: number;
  sin: number;
  hw: number;
  hd: number;
  base: number;
  height: number;
  top(lx: number, lz: number): number;
  mid: number; // height of the centre of its bounding sphere
  reach: number; // that sphere's radius
}

export class Structures {
  readonly top: number; // the highest point of any structure, 0 with none
  private readonly placed: Placed[];
  private readonly grid = new Map<string, number[]>();

  constructor(readonly list: readonly Structure[]) {
    list.forEach((s, i) => validateStructure(s, String(i)));
    this.placed = list.map((s) => {
      const yaw = s.yaw ?? 0;
      const surface = surfaceOf(s);
      return {
        x: s.x,
        z: s.z,
        cos: Math.cos(yaw),
        sin: Math.sin(yaw),
        hw: s.w / 2,
        hd: s.d / 2,
        base: s.y ?? 0,
        height: surface.height,
        top: surface.top,
        mid: (s.y ?? 0) + surface.height / 2,
        reach: Math.hypot(s.w / 2, s.d / 2, surface.height / 2),
      };
    });
    this.top = Math.max(0, ...this.placed.map((p) => p.base + p.height));
    this.placed.forEach((p, i) => {
      const r = Math.hypot(p.hw, p.hd);
      for (const key of cells(p.x - r, p.z - r, p.x + r, p.z + r)) {
        const bucket = this.grid.get(key);
        if (bucket) bucket.push(i);
        else this.grid.set(key, [i]);
      }
    });
  }

  // The highest surface under (x, z) that is no higher than `reach`, or 0 for the floor.
  groundAt(x: number, z: number, reach: number): number {
    let ground = 0;
    for (const p of this.near(x, z, x, z)) {
      const [lx, lz] = local(p, x, z);
      if (Math.abs(lx) > p.hw || Math.abs(lz) > p.hd) continue;
      const top = p.base + p.top(lx, lz);
      if (top <= reach && top > ground) ground = top;
    }
    return ground;
  }

  // The lowest underside over (x, z) at or above `from`, or Infinity.
  ceilingAt(x: number, z: number, from: number): number {
    let ceiling = Infinity;
    for (const p of this.near(x, z, x, z)) {
      const [lx, lz] = local(p, x, z);
      if (Math.abs(lx) > p.hw || Math.abs(lz) > p.hd) continue;
      if (p.base >= from && p.base < ceiling) ceiling = p.base;
    }
    return ceiling;
  }

  // Moves a body's centre by (dx, dz), pushing it out of anything too tall to step onto and
  // stopping short of anything it would end up inside (steep terrain). Moves in substeps no
  // longer than the radius so a fast body can't pass through a thin wall.
  move(pos: Vec3, dx: number, dz: number, body: Body): void {
    const r = body.radius;
    const near = this.near(
      Math.min(pos.x, pos.x + dx) - r,
      Math.min(pos.z, pos.z + dz) - r,
      Math.max(pos.x, pos.x + dx) + r,
      Math.max(pos.z, pos.z + dz) + r,
    );
    if (near.length === 0) {
      pos.x += dx;
      pos.z += dz;
      return;
    }
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / r));
    for (let i = 0; i < steps; i++) {
      const fromX = pos.x;
      const fromZ = pos.z;
      pos.x += dx / steps;
      pos.z += dz / steps;
      for (const p of near) pushOut(p, pos, body);
      if (near.some((p) => inside(p, pos.x, pos.z, body))) {
        pos.x = fromX;
        pos.z = fromZ;
        return;
      }
    }
  }

  // Distance along the unit ray (o, d) to the first structure it enters within maxT, else Infinity.
  raycast(o: Vec3, d: Vec3, maxT: number): number {
    let best = Infinity;
    for (const p of this.placed) {
      // Cheap rejection first: skip anything whose bounding sphere the ray misses.
      const cx = p.x - o.x;
      const cy = p.mid - o.y;
      const cz = p.z - o.z;
      const along = cx * d.x + cy * d.y + cz * d.z;
      if (along < -p.reach || along > Math.min(maxT, best) + p.reach) continue;
      if (cx * cx + cy * cy + cz * cz - along * along > p.reach * p.reach) continue;
      const [ox, oz] = local(p, o.x, o.z);
      const dx = d.x * p.cos - d.z * p.sin;
      const dz = d.x * p.sin + d.z * p.cos;
      let t0 = 0;
      let t1 = Math.min(maxT, best);
      for (const [v, dv, lo, hi] of [
        [ox, dx, -p.hw, p.hw],
        [oz, dz, -p.hd, p.hd],
        [o.y, d.y, p.base, p.base + p.height],
      ]) {
        if (Math.abs(dv) < 1e-12) {
          if (v < lo || v > hi) t0 = Infinity;
          continue;
        }
        const a = (lo - v) / dv;
        const b = (hi - v) / dv;
        t0 = Math.max(t0, Math.min(a, b));
        t1 = Math.min(t1, Math.max(a, b));
      }
      // Inside the footprint's bounding prism: find where the ray first dips below the top.
      for (let t = t0; t <= t1; t += RAY_STEP) {
        const lx = Math.max(-p.hw, Math.min(p.hw, ox + dx * t));
        const lz = Math.max(-p.hd, Math.min(p.hd, oz + dz * t));
        if (o.y + d.y * t <= p.base + p.top(lx, lz) + 1e-9) {
          best = t;
          break;
        }
      }
    }
    return best;
  }

  // Whether nothing stands between a and b.
  clear(a: Vec3, b: Vec3): boolean {
    if (this.placed.length === 0) return true;
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (len < 1e-9) return true;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len, z: (b.z - a.z) / len };
    return this.raycast(a, d, len) === Infinity;
  }

  // Structures whose grid cells touch the rectangle.
  private near(minX: number, minZ: number, maxX: number, maxZ: number): Placed[] {
    if (this.placed.length === 0) return [];
    const found = new Set<number>();
    for (const key of cells(minX, minZ, maxX, maxZ)) for (const i of this.grid.get(key) ?? []) found.add(i);
    return [...found].map((i) => this.placed[i]);
  }
}

function cells(minX: number, minZ: number, maxX: number, maxZ: number): string[] {
  const keys: string[] = [];
  for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
    for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) keys.push(`${cx},${cz}`);
  return keys;
}

// World (x, z) in a structure's local frame.
function local(p: Placed, x: number, z: number): [number, number] {
  const dx = x - p.x;
  const dz = z - p.z;
  return [dx * p.cos - dz * p.sin, dx * p.sin + dz * p.cos];
}

// A local offset back in world axes.
function world(p: Placed, lx: number, lz: number): [number, number] {
  return [lx * p.cos + lz * p.sin, -lx * p.sin + lz * p.cos];
}

// Whether the structure is a wall to this body at a local point: it reaches the body's height
// band there and is too tall to step onto.
function blocks(p: Placed, lx: number, lz: number, body: Body): boolean {
  return p.base < body.head && p.base + p.top(lx, lz) > body.reach;
}

function inside(p: Placed, x: number, z: number, body: Body): boolean {
  const [lx, lz] = local(p, x, z);
  return Math.abs(lx) <= p.hw && Math.abs(lz) <= p.hd && blocks(p, lx, lz, body);
}

// Pushes the body's circle out of the footprint where the structure is a wall: away from the
// nearest point of the rectangle, or out through the nearest side if the centre is inside.
function pushOut(p: Placed, pos: Vec3, body: Body): void {
  const [lx, lz] = local(p, pos.x, pos.z);
  const qx = Math.max(-p.hw, Math.min(p.hw, lx));
  const qz = Math.max(-p.hd, Math.min(p.hd, lz));
  if (!blocks(p, qx, qz, body)) return;
  let ex = lx - qx;
  let ez = lz - qz;
  const dist = Math.hypot(ex, ez);
  if (dist >= body.radius) return;
  if (dist > 1e-9) {
    const k = (body.radius - dist) / dist;
    ex *= k;
    ez *= k;
  } else if (p.hw - Math.abs(lx) < p.hd - Math.abs(lz)) {
    ex = Math.sign(lx || 1) * (p.hw - Math.abs(lx) + body.radius);
    ez = 0;
  } else {
    ex = 0;
    ez = Math.sign(lz || 1) * (p.hd - Math.abs(lz) + body.radius);
  }
  const [wx, wz] = world(p, ex, ez);
  pos.x += wx;
  pos.z += wz;
}
