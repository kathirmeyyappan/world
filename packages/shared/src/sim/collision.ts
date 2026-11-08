// The sim's view of the structures (structures.ts): where a player can stand, what stops them,
// what they bump their head on, and what a shot can't pass. Pure, so the Room and the client's
// prediction get identical answers. With no structures every query answers as the bare floor
// does: ground 0, no ceiling, nothing in the way. A door's pieces (doors.ts) stand or not as the
// door is swung, and frost (frost.ts) lies on faces or not as it's sprayed and melted: those two
// are what changes after building, so a Room keeps its own.
import { LADDER_GAP, LADDER_REACH, PLAYER_RADIUS } from './constants';
import { FLOOR, Frost, cellOf, faceCoords, type Face } from './frost';
import { ladderRun, surfaceOf, validateStructure, type Ladder, type Structure } from './structures';
import { surfaceOfStructure, type SurfaceId } from './surfaces';
import type { Vec3 } from './types';

// Metres per spatial-grid cell, across and up: a query looks only in the cells of the height band
// it reaches, so pieces at other heights in the same column (a keep's upper floors, the house's
// shell band by band) cost it nothing.
const CELL = 8;
const RAY_STEP = 0.05; // metres between samples when a ray crosses a sloped top
// Where a body's footing is read for frost, and its room is checked at a ladder, as shares of its
// radius from its middle: the middle and the four sides.
const PROBES = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const HANDS = 1; // metres above a walker's feet its hands take hold of a ladder's rungs
// Metres of a ray tried at a time: the pieces in the grid cells that stretch's box crosses, so a
// ray through empty cells costs next to nothing and a spray's rays try only what's in front of it.
const RAY_STRETCH = 4 * CELL;

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
  on: boolean; // standing: always, but for a door's piece while the door is the other way
  door: { id: string; open: boolean } | null;
}

// What a ray lands on: how far along it, the piece (its index in the list), which of its faces
// (null from inside the piece), and the spot.
export interface Touch {
  t: number;
  piece: number;
  face: Face | null;
  point: Vec3;
}

// What's underfoot at a spot: the ground's height there, the piece it's the top of (null for the
// floor), what it's like to walk on (frost counted), and the rise of its top per metre along x
// and z (0 on the flat).
export interface Footing {
  y: number;
  piece: number | null;
  surface: SurfaceId;
  slope: { x: number; z: number };
}

export class Structures {
  readonly top: number; // the highest point of any structure, 0 with none
  readonly doorIds: string[];
  readonly ladders: number[]; // the pieces that are ladders (structures.ts), by index
  readonly frost = new Frost(); // what's frosted over, by face and cell
  private readonly placed: Placed[];
  private readonly grid = new Map<string, number[]>();
  private readonly doors = new Map<string, number[]>(); // each door's pieces
  private readonly lowBand: number; // the grid's lowest and highest height bands with anything in them
  private readonly highBand: number;

  constructor(readonly list: readonly Structure[]) {
    list.forEach((s, i) => validateStructure(s, String(i)));
    this.placed = list.map((s) => {
      const yaw = s.yaw ?? 0;
      const surface = surfaceOf(s);
      // A leaning ladder's footprint runs from its foot (its x, z) to under its top.
      const run = s.kind === 'ladder' ? ladderRun(s) : 0;
      return {
        x: s.x + (Math.sin(yaw) * run) / 2,
        z: s.z + (Math.cos(yaw) * run) / 2,
        cos: Math.cos(yaw),
        sin: Math.sin(yaw),
        hw: s.w / 2,
        hd: (s.d + run) / 2,
        base: s.y ?? 0,
        height: surface.height,
        top: surface.top,
        mid: (s.y ?? 0) + surface.height / 2,
        reach: Math.hypot(s.w / 2, s.d / 2, surface.height / 2),
        on: !s.door || !s.door.open, // doors start shut
        door: s.door ?? null,
      };
    });
    this.placed.forEach((p, i) => {
      if (p.door) this.doors.set(p.door.id, [...(this.doors.get(p.door.id) ?? []), i]);
    });
    this.doorIds = [...this.doors.keys()];
    this.ladders = list.flatMap((s, i) => (s.kind === 'ladder' ? [i] : []));
    this.top = Math.max(0, ...this.placed.map((p) => p.base + p.height));
    this.lowBand = Math.min(0, ...this.placed.map((p) => band(p.base)));
    this.highBand = Math.max(0, ...this.placed.map((p) => band(p.base + p.height)));
    this.placed.forEach((p, i) => {
      const r = Math.hypot(p.hw, p.hd);
      for (const key of cells(p.x - r, p.z - r, p.x + r, p.z + r, p.base, p.base + p.height)) {
        const bucket = this.grid.get(key);
        if (bucket) bucket.push(i);
        else this.grid.set(key, [i]);
      }
    });
  }

  // Swings a door: its pieces for that state stand, the others don't.
  setDoor(id: string, open: boolean): void {
    for (const i of this.doors.get(id) ?? []) this.placed[i].on = this.placed[i].door!.open === open;
  }

  isOpen(id: string): boolean {
    return (this.doors.get(id) ?? []).some((i) => this.placed[i].door!.open && this.placed[i].on);
  }

  // The door the ray (o, d) meets first within maxT, before anything else, or null.
  doorAt(o: Vec3, d: Vec3, maxT: number): string | null {
    const hit = this.cast(o, d, maxT);
    return hit ? (this.placed[hit.piece].door?.id ?? null) : null;
  }

  // The highest surface under (x, z) that is no higher than `reach`, or 0 for the floor.
  groundAt(x: number, z: number, reach: number): number {
    return this.ground(x, z, reach).y;
  }

  // What's underfoot at (x, z) for feet that reach up to `reach`: the ground there (groundAt), the
  // piece it is, its surface and its slope. It's ice wherever the top is frosted (the floor's
  // included) under the spot or, with `radius`, under any of a body that wide round it: a foot on
  // ice slips, so a hole in the frost smaller than a body doesn't catch.
  footing(x: number, z: number, reach: number, radius = 0): Footing {
    const { y, piece, lx, lz } = this.ground(x, z, reach);
    const probes = radius > 0 ? PROBES.length : 1;
    let frosted = false;
    for (let k = 0; k < probes && !frosted; k++)
      frosted = this.frostedAt(x + PROBES[k][0] * radius, z + PROBES[k][1] * radius, y);
    if (piece === null) return { y, piece, surface: frosted ? 'ice' : 'hard', slope: { x: 0, z: 0 } };
    const p = this.placed[piece];
    const s = this.list[piece];
    const surface = frosted ? 'ice' : surfaceOfStructure(s);
    // The top's rise per metre in the piece's own axes, then in the world's.
    const [wx, wz] = world(p, rise(p, lx, lz, 1, 0), rise(p, lx, lz, 0, 1));
    return { y, piece, surface, slope: { x: wx, z: wz } };
  }

  // Whether the ground at (x, z), whose height is `y`, is frosted there: the floor's cell, or that
  // of any piece whose top is at that height at the spot. Tops meet in one plane wherever pieces
  // overlap (the helpers' joints, a model's hidden floor over the dune's sand), and a spray lands
  // on whichever of them a ray meets first, so ice on any of them is underfoot.
  private frostedAt(x: number, z: number, y: number): boolean {
    if (Math.abs(y) < 1e-3 && this.frost.has(FLOOR, 0, ...cellOf(x, z))) return true;
    for (const i of this.nearIndices(x, z, x, z, y, y)) {
      const p = this.placed[i];
      const [lx, lz] = local(p, x, z);
      if (Math.abs(lx) > p.hw || Math.abs(lz) > p.hd || Math.abs(p.base + p.top(lx, lz) - y) > 1e-3) continue;
      if (this.frost.has(i, 0, ...cellOf(...faceCoords(this.list[i], 0, lx, 0, lz)))) return true;
    }
    return false;
  }

  // The highest top under (x, z) that is no higher than `reach`, which piece it is (null for the
  // floor, at 0) and where on it: down the height bands from the one `reach` is in, until the
  // bands left all lie under the best so far.
  private ground(x: number, z: number, reach: number): { y: number; piece: number | null; lx: number; lz: number } {
    const best = { y: 0, piece: null as number | null, lx: 0, lz: 0 };
    for (let b = Math.min(band(reach), this.highBand); b >= this.lowBand; b--) {
      for (const i of this.nearIndices(x, z, x, z, b * CELL, b * CELL)) {
        const p = this.placed[i];
        const [lx, lz] = local(p, x, z);
        if (Math.abs(lx) > p.hw || Math.abs(lz) > p.hd) continue;
        const top = p.base + p.top(lx, lz);
        if (top <= reach && top > best.y) {
          best.y = top;
          best.piece = i;
          best.lx = lx;
          best.lz = lz;
        }
      }
      if (best.y >= b * CELL) break;
    }
    return best;
  }

  // The lowest underside over (x, z) at or above `from`, or Infinity: up the height bands from the
  // one `from` is in, until the bands left all start above the best so far.
  ceilingAt(x: number, z: number, from: number): number {
    let ceiling = Infinity;
    for (let b = Math.max(band(from), this.lowBand); b <= this.highBand; b++) {
      for (const p of this.near(x, z, x, z, b * CELL, b * CELL)) {
        const [lx, lz] = local(p, x, z);
        if (Math.abs(lx) > p.hw || Math.abs(lz) > p.hd) continue;
        if (p.base >= from && p.base < ceiling) ceiling = p.base;
      }
      if (ceiling <= (b + 1) * CELL) break;
    }
    return ceiling;
  }

  // Whether a body at (x, z), feet at `feet` and `height` tall, is clear of every structure, and
  // with `reach` (its radius) a body that wide, clear at every spot that far round it too:
  // anything there tops out at or below its feet (ground) or starts above its head.
  fits(x: number, z: number, feet: number, height: number, reach = 0): boolean {
    const probes = reach > 0 ? PROBES.length : 1;
    for (let k = 0; k < probes; k++) {
      const px = x + PROBES[k][0] * reach;
      const pz = z + PROBES[k][1] * reach;
      const clear = this.near(px, pz, px, pz, feet, feet + height).every((p) => {
        const [lx, lz] = local(p, px, pz);
        if (Math.abs(lx) > p.hw || Math.abs(lz) > p.hd) return true;
        return p.base >= feet + height || p.base + p.top(lx, lz) <= feet + 1e-6;
      });
      if (!clear) return false;
    }
    return true;
  }

  // The ladder a walker at (x, z) with its feet at `feet`, looking along `yaw`, can take hold of:
  // one it stands within LADDER_REACH of a face of (where the face is at its feet's height, on a
  // leaning one), between the rails, no higher than its top and with its hands no lower than its
  // foot, looking toward it (within a quarter turn), and the face: the side (±1 along the
  // ladder's local z) the body is on.
  ladderAt(x: number, z: number, feet: number, yaw: number): { piece: number; side: 1 | -1 } | null {
    for (const i of this.ladders) {
      const p = this.placed[i];
      const s = this.ladder(i);
      const [lx, lz] = local(p, x, z);
      const line = this.ladderOut(i, feet) - ladderRun(s) / 2; // the rails' middle, from the footprint's
      const side: 1 | -1 = lz >= line ? 1 : -1;
      const off = side * (lz - line) - s.d / 2;
      if (Math.abs(lx) > p.hw || off < 0 || off > LADDER_REACH) continue;
      if (feet > p.base + p.height || feet + HANDS < p.base) continue;
      // The way out of that face, in the world: a look along it is a look away from the ladder.
      if (Math.sin(yaw) * p.sin * side + Math.cos(yaw) * p.cos * side > 0) continue;
      return { piece: i, side };
    }
    return null;
  }

  // Where a body climbing ladder `piece` on `side` with its feet at `feet` stands: its middle, off
  // the face there by its radius and LADDER_GAP, between the rails.
  ladderSpot(piece: number, side: 1 | -1, feet: number): { x: number; z: number } {
    return this.alongLadder(
      piece,
      this.ladderOut(piece, feet) + side * (this.ladder(piece).d / 2 + PLAYER_RADIUS + LADDER_GAP),
    );
  }

  // The middle of ladder `piece`'s rails at height `feet`: what a body swings round.
  ladderLine(piece: number, feet: number): { x: number; z: number } {
    return this.alongLadder(piece, this.ladderOut(piece, feet));
  }

  // Radians ladder `piece` leans from upright, toward its local +z.
  ladderLean(piece: number): number {
    return this.ladder(piece).lean ?? 0;
  }

  // The look (a yaw) straight at ladder `piece` from `side`.
  ladderFacing(piece: number, side: 1 | -1): number {
    const p = this.placed[piece];
    return Math.atan2(-side * p.sin, -side * p.cos);
  }

  // A ladder's foot and top, as heights.
  ladderSpan(piece: number): { base: number; top: number } {
    const p = this.placed[piece];
    return { base: p.base, top: p.base + p.height };
  }

  private ladder(piece: number): Ladder {
    const s = this.list[piece];
    if (s.kind !== 'ladder') throw new Error(`piece ${piece} is a ${s.kind}, not a ladder`);
    return s;
  }

  // How far along ladder `piece`'s local +z its rails' middle is at height `feet`, from its foot.
  private ladderOut(piece: number, feet: number): number {
    return (feet - this.placed[piece].base) * Math.tan(this.ladderLean(piece));
  }

  // The spot `out` metres along ladder `piece`'s local +z from its foot, in the world.
  private alongLadder(piece: number, out: number): { x: number; z: number } {
    const p = this.placed[piece];
    const s = this.ladder(piece);
    return { x: s.x + p.sin * out, z: s.z + p.cos * out };
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
      body.reach,
      body.head,
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

  // Whether any structure that is a wall to `body` comes within its radius of (x, z).
  touches(x: number, z: number, body: Body): boolean {
    const r = body.radius;
    for (const p of this.near(x - r, z - r, x + r, z + r, body.reach, body.head)) {
      const [lx, lz] = local(p, x, z);
      const qx = Math.max(-p.hw, Math.min(p.hw, lx));
      const qz = Math.max(-p.hd, Math.min(p.hd, lz));
      if (Math.hypot(lx - qx, lz - qz) < r - 1e-6 && blocks(p, qx, qz, body)) return true;
    }
    return false;
  }

  // Distance along the unit ray (o, d) to the first structure it enters within maxT, else Infinity.
  raycast(o: Vec3, d: Vec3, maxT: number): number {
    return this.cast(o, d, maxT)?.t ?? Infinity;
  }

  // What the unit ray (o, d) lands on first within maxT, or null for nothing.
  touch(o: Vec3, d: Vec3, maxT: number): Touch | null {
    return this.cast(o, d, maxT);
  }

  // A stretch of the ray at a time (maxT must be finite); the nearest hit is in hand once the
  // stretch it lies in has been tried, since every piece it could be on has a cell in that stretch's box.
  private cast(o: Vec3, d: Vec3, maxT: number): Touch | null {
    let best: Touch | null = null;
    for (let from = 0; from < maxT && !(best && best.t <= from); from += RAY_STRETCH) {
      const to = Math.min(maxT, from + RAY_STRETCH);
      const [ax, ay, az] = [o.x + d.x * from, o.y + d.y * from, o.z + d.z * from];
      const [bx, by, bz] = [o.x + d.x * to, o.y + d.y * to, o.z + d.z * to];
      const stretch = this.nearIndices(
        Math.min(ax, bx),
        Math.min(az, bz),
        Math.max(ax, bx),
        Math.max(az, bz),
        Math.min(ay, by),
        Math.max(ay, by),
      );
      for (const i of stretch) best = this.hit(o, d, maxT, i, best);
    }
    return best;
  }

  // Where the ray (o, d) first enters piece `i` within maxT, if that's nearer than `best`.
  private hit(o: Vec3, d: Vec3, maxT: number, i: number, best: Touch | null): Touch | null {
    const p = this.placed[i];
    const limit = best ? best.t : maxT;
    // Cheap rejection first: skip anything whose bounding sphere the ray misses.
    const cx = p.x - o.x;
    const cy = p.mid - o.y;
    const cz = p.z - o.z;
    const along = cx * d.x + cy * d.y + cz * d.z;
    if (along < -p.reach || along > limit + p.reach) return best;
    if (cx * cx + cy * cy + cz * cz - along * along > p.reach * p.reach) return best;
    const [ox, oz] = local(p, o.x, o.z);
    const dx = d.x * p.cos - d.z * p.sin;
    const dz = d.x * p.sin + d.z * p.cos;
    let t0 = 0;
    let t1 = limit;
    let entry = -1; // the slab (local x, z, then y) the ray enters the footprint's prism through, if any
    const slabs: [number, number, number, number][] = [
      [ox, dx, -p.hw, p.hw],
      [oz, dz, -p.hd, p.hd],
      [o.y, d.y, p.base, p.base + p.height],
    ];
    for (let k = 0; k < slabs.length; k++) {
      const [v, dv, lo, hi] = slabs[k];
      if (Math.abs(dv) < 1e-12) {
        if (v < lo || v > hi) t0 = Infinity;
        continue;
      }
      const a = (lo - v) / dv;
      const b = (hi - v) / dv;
      if (Math.min(a, b) > t0) {
        t0 = Math.min(a, b);
        entry = k;
      }
      t1 = Math.min(t1, Math.max(a, b));
    }
    // Inside the footprint's bounding prism: find where the ray first dips below the top.
    const under = (t: number) => {
      const lx = Math.max(-p.hw, Math.min(p.hw, ox + dx * t));
      const lz = Math.max(-p.hd, Math.min(p.hd, oz + dz * t));
      return o.y + d.y * t <= p.base + p.top(lx, lz) + 1e-9;
    };
    for (let t = t0; t <= t1; t += RAY_STEP) {
      if (!under(t)) continue;
      let face: Face | null;
      if (t > t0) {
        // Under a sloped top from above: narrow the crossing down between this sample and the last.
        let above = t - RAY_STEP;
        for (let k = 0; k < 12; k++) {
          const mid = (above + t) / 2;
          if (under(mid)) t = mid;
          else above = mid;
        }
        face = 0;
      } else if (entry < 0) face = null;
      else if (entry === 0) face = dx < 0 ? 2 : 3;
      else if (entry === 1) face = dz < 0 ? 4 : 5;
      else face = d.y < 0 ? 0 : 1;
      return { t, piece: i, face, point: { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t } };
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

  // Structures whose grid cells touch the box, standing (a door's piece only while the door is
  // its way). Anything wholly above or below the box's height is left out; a height past every
  // band with anything in it (an infinite reach) looks no further than those.
  private near(minX: number, minZ: number, maxX: number, maxZ: number, minY: number, maxY: number): Placed[] {
    return this.nearIndices(minX, minZ, maxX, maxZ, minY, maxY).map((i) => this.placed[i]);
  }

  private nearIndices(minX: number, minZ: number, maxX: number, maxZ: number, minY: number, maxY: number): number[] {
    if (this.placed.length === 0) return [];
    const found = new Set<number>();
    const low = Math.max(minY, this.lowBand * CELL);
    const high = Math.min(maxY, this.highBand * CELL);
    for (const key of cells(minX, minZ, maxX, maxZ, low, high)) for (const i of this.grid.get(key) ?? []) found.add(i);
    return [...found].filter((i) => this.placed[i].on);
  }
}

function band(y: number): number {
  return Math.floor(y / CELL);
}

function cells(minX: number, minZ: number, maxX: number, maxZ: number, minY: number, maxY: number): string[] {
  const keys: string[] = [];
  for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
    for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++)
      for (let cy = band(minY); cy <= band(maxY); cy++) keys.push(`${cx},${cz},${cy}`);
  return keys;
}

// How much a structure's top rises per metre from a local point along the local direction (ax, az),
// measured over a hand's width either side of it, kept within the footprint.
function rise(p: Placed, lx: number, lz: number, ax: number, az: number): number {
  const HAND = 0.05;
  const clampX = (v: number) => Math.max(-p.hw, Math.min(p.hw, v));
  const clampZ = (v: number) => Math.max(-p.hd, Math.min(p.hd, v));
  const [x0, z0] = [clampX(lx - ax * HAND), clampZ(lz - az * HAND)];
  const [x1, z1] = [clampX(lx + ax * HAND), clampZ(lz + az * HAND)];
  const span = Math.hypot(x1 - x0, z1 - z0);
  return span > 1e-9 ? (p.top(x1, z1) - p.top(x0, z0)) / span : 0;
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
