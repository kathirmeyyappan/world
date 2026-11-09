// Frost: ice laid over the surfaces of structures (structures.ts) and the bare floor by an ice
// spray and melted off them by fire, kept by the Room for everyone (room.ts) and sent to every
// client, like a door's swing. It lies in cells: each face of a piece (its top, its underside and
// its four sides) is cut into a grid of FROST_CELL squares from one corner, the floor the same way
// from the origin, and a cell is frosted or not. A frosted top is ice underfoot whatever the
// piece is made of (collision.ts `footing`), and the client draws every frosted cell as a crust on
// its face (render/Frost.ts, from `frostQuad`). A spray's touch is a fan of rays through its cone
// (`sprayFrost`): where each lands, the cells within its splat of the spot on that face turn, so a
// spray held on a wall covers it in a second or two and a flame clears it the same way. Frost
// never thaws on its own; past MAX_FROST cells the oldest melt first.
import type { Structures } from './collision';
import { surfaceOf, type Structure } from './structures';
import type { Vec3 } from './types';

export const FROST_CELL = 0.5; // metres along each side of a cell
export const MAX_FROST = 40000; // cells a room keeps: 10,000 m², the main disc's floor and more
export const FLOOR = -1; // the "piece" that is the bare floor
export const FROST_LIFT = 0.02; // metres a cell's crust stands off its face, so the two never share a plane
const SPLAT = 0.75; // metres round where a ray lands that its touch reaches, at the least
// A ray's splat grows with the spray's own width where it lands, this share of it: a spray fans
// out, and the dozen rays stand for all of it, so a shot or two frosts the whole patch solid.
const SPREAD = 0.3;
const RAYS = 12;
// The R2 sequence (Roberts): point n of it spreads evenly among the ones before, so a spray's
// rays cover its cone without rings or gaps, shot after shot.
const R2 = [0.7548776662466927, 0.5698402909980532];

// A piece's top, its underside, and its +x, -x, +z and -z sides, in its own frame.
export type Face = 0 | 1 | 2 | 3 | 4 | 5;
export const FACES: Face[] = [0, 1, 2, 3, 4, 5];

// One frosted cell, as the wire carries it: the piece (its index in the world's list, or FLOOR),
// the face, and the cell's column and row on that face's grid.
export type FrostCell = [piece: number, face: Face, i: number, j: number];

export class Frost {
  private readonly cells = new Map<string, FrostCell>(); // in the order they froze, oldest first

  get size(): number {
    return this.cells.size;
  }

  has(piece: number, face: Face, i: number, j: number): boolean {
    return this.cells.has(key(piece, face, i, j));
  }

  // Freezes or melts a cell. Returns whether that changed anything.
  set(cell: FrostCell, on: boolean): boolean {
    const k = key(...cell);
    if (on === this.cells.has(k)) return false;
    if (on) this.cells.set(k, cell);
    else this.cells.delete(k);
    return true;
  }

  // Melts the oldest cells past MAX_FROST, and returns them.
  trim(): FrostCell[] {
    const gone: FrostCell[] = [];
    for (const [k, cell] of this.cells) {
      if (this.cells.size <= MAX_FROST) break;
      this.cells.delete(k);
      gone.push(cell);
    }
    return gone;
  }

  list(): FrostCell[] {
    return [...this.cells.values()];
  }
}

function key(piece: number, face: Face, i: number, j: number): string {
  return `${piece}:${face}:${i}:${j}`;
}

// A face's own coordinates: metres along it (u) and up or across it (v) from its corner, for a
// point of the piece given in its local frame (`ly` above its underside). The floor's are world x
// and z.
export function faceCoords(s: Structure | null, face: Face, lx: number, ly: number, lz: number): [number, number] {
  if (!s) return [lx, lz];
  switch (face) {
    case 0:
    case 1:
      return [lx + s.w / 2, lz + s.d / 2];
    case 2:
    case 3:
      return [lz + s.d / 2, ly];
    case 4:
    case 5:
      return [lx + s.w / 2, ly];
  }
}

// The cell of a face that its point (u, v) lies in.
export function cellOf(u: number, v: number): [number, number] {
  return [Math.floor(u / FROST_CELL), Math.floor(v / FROST_CELL)];
}

// A face's reach: metres along it and up (or across) it from its corner.
function faceSize(s: Structure, face: Face): [number, number] {
  const { height } = surfaceOf(s);
  return face <= 1 ? [s.w, s.d] : face <= 3 ? [s.d, height] : [s.w, height];
}

// Whether a face has such a cell: the floor has every cell; a piece's face has those inside its
// reach, cut to it at the edge, and on a side, those not wholly above the top's slope; a terrain
// has only its top (its sides and underside are never drawn), and a ladder none at all.
export function hasCell(s: Structure | null, piece: number, face: Face, i: number, j: number): boolean {
  if (!s) return piece === FLOOR && face === 0;
  if (s.kind === 'ladder' || (s.kind === 'terrain' && face !== 0)) return false;
  const [along, up] = faceSize(s, face);
  const u0 = i * FROST_CELL;
  const v0 = j * FROST_CELL;
  const u1 = Math.min(along, u0 + FROST_CELL);
  const v1 = Math.min(up, v0 + FROST_CELL);
  if (u0 < 0 || v0 < 0 || u1 - u0 < 1e-6 || v1 - v0 < 1e-6) return false;
  if (face <= 1) return true;
  const { top } = surfaceOf(s);
  const hw = s.w / 2;
  const hd = s.d / 2;
  const crest =
    face <= 3
      ? Math.max(top(face === 2 ? hw : -hw, u0 - hd), top(face === 2 ? hw : -hw, u1 - hd))
      : Math.max(top(u0 - hw, face === 4 ? hd : -hd), top(u1 - hw, face === 4 ? hd : -hd));
  return crest > v0 + 1e-6;
}

// What a cell is drawn as: its four corners, FROST_LIFT off the face, in world space, the face's
// normal there, and the cell's reach along the face (u0, v0, u1, v1), for a crust that runs on
// across its neighbours. A cell past the face's edge, or above a ramp's slope, is cut to it; one
// the face hasn't (hasCell) is null.
export function frostQuad(
  s: Structure | null,
  piece: number,
  face: Face,
  i: number,
  j: number,
): { corners: Vec3[]; normal: Vec3; uv: [number, number, number, number] } | null {
  if (!hasCell(s, piece, face, i, j)) return null;
  if (!s) {
    const u0 = i * FROST_CELL;
    const v0 = j * FROST_CELL;
    const u1 = u0 + FROST_CELL;
    const v1 = v0 + FROST_CELL;
    return {
      corners: [
        { x: u0, y: FROST_LIFT, z: v0 },
        { x: u1, y: FROST_LIFT, z: v0 },
        { x: u1, y: FROST_LIFT, z: v1 },
        { x: u0, y: FROST_LIFT, z: v1 },
      ],
      normal: { x: 0, y: 1, z: 0 },
      uv: [u0, v0, u1, v1],
    };
  }
  const { top } = surfaceOf(s);
  const hw = s.w / 2;
  const hd = s.d / 2;
  const [along, up] = faceSize(s, face);
  const u0 = i * FROST_CELL;
  const v0 = j * FROST_CELL;
  const u1 = Math.min(along, u0 + FROST_CELL);
  const v1 = Math.min(up, v0 + FROST_CELL);
  // The corner at face coordinates (u, v) in the piece's frame, and the face's normal there.
  let at: (u: number, v: number) => [number, number, number];
  let normal: [number, number, number];
  switch (face) {
    case 0: {
      // The slope across the cell, for the normal.
      const mx = (u0 + u1) / 2 - hw;
      const mz = (v0 + v1) / 2 - hd;
      const gx = (top(u1 - hw, mz) - top(u0 - hw, mz)) / (u1 - u0);
      const gz = (top(mx, v1 - hd) - top(mx, v0 - hd)) / (v1 - v0);
      const len = Math.hypot(gx, 1, gz);
      normal = [-gx / len, 1 / len, -gz / len];
      at = (u, v) => [u - hw, top(u - hw, v - hd), v - hd];
      break;
    }
    case 1:
      normal = [0, -1, 0];
      at = (u, v) => [u - hw, 0, v - hd];
      break;
    case 2:
    case 3: {
      const side = face === 2 ? hw : -hw;
      normal = [Math.sign(side), 0, 0];
      at = (u, v) => [side, Math.min(v, top(side, u - hd)), u - hd];
      break;
    }
    case 4:
    case 5: {
      const side = face === 4 ? hd : -hd;
      normal = [0, 0, Math.sign(side)];
      at = (u, v) => [u - hw, Math.min(v, top(u - hw, side)), side];
      break;
    }
  }
  const local = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
  const yaw = s.yaw ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const base = s.y ?? 0;
  const turned = ([lx, ly, lz]: [number, number, number]): Vec3 => ({
    x: lx * cos + lz * sin,
    y: ly,
    z: -lx * sin + lz * cos,
  });
  return {
    corners: local.map(([lx, ly, lz]) => {
      const c = turned([lx + normal[0] * FROST_LIFT, ly + normal[1] * FROST_LIFT, lz + normal[2] * FROST_LIFT]);
      return { x: s.x + c.x, y: base + c.y, z: s.z + c.z };
    }),
    normal: turned(normal),
    uv: [u0, v0, u1, v1],
  };
}

// Where a ray's touch lands on a face: the spot in the face's coordinates, and the ellipse it
// wets, `across` metres to either side and `along` metres (as far or farther) each way along the
// ray's own direction over the face (a unit vector in face coordinates), since a ray meeting a
// face at a glancing angle smears along it.
export interface Blot {
  u: number;
  v: number;
  along: number;
  across: number;
  dirU: number;
  dirV: number;
}

// Turns every cell of a face under the blot `on` or off; `allowed` keeps a floor splat inside the
// world. Returns the cells that changed.
export function splat(
  frost: Frost,
  s: Structure | null,
  piece: number,
  face: Face,
  blot: Blot,
  on: boolean,
  allowed: (cell: FrostCell) => boolean = () => true,
): FrostCell[] {
  const changed: FrostCell[] = [];
  const { u, v, along, across, dirU, dirV } = blot;
  const [i0, j0] = cellOf(u - along, v - along);
  const [i1, j1] = cellOf(u + along, v + along);
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const du = (i + 0.5) * FROST_CELL - u;
      const dv = (j + 0.5) * FROST_CELL - v;
      const p = (du * dirU + dv * dirV) / along;
      const q = (dv * dirU - du * dirV) / across;
      if (p * p + q * q > 1) continue;
      const cell: FrostCell = [piece, face, i, j];
      if (!hasCell(s, piece, face, i, j) || !allowed(cell)) continue;
      if (frost.set(cell, on)) changed.push(cell);
    }
  return changed;
}

// Where a spray from `o` along `d` lands: RAYS rays spread over its cone (`halfAngle`, out to
// `range`), the `shot`th spray's between the last ones', each frosting (`on`) or melting the face
// it reaches round where it lands, wider the farther it flew, the floor included where `floor`
// says there is one (inside the world's outline), doors excepted (they swing). Returns the cells
// that changed.
// Freezes every floor cell within `radius` metres of (x, z) that is inside the world (`floor`),
// returning the cells that turned.
export function frostDisc(
  structures: Structures,
  floor: (x: number, z: number) => boolean,
  x: number,
  z: number,
  radius: number,
): FrostCell[] {
  const changed: FrostCell[] = [];
  const [i0, j0] = cellOf(x - radius, z - radius);
  const [i1, j1] = cellOf(x + radius, z + radius);
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const cx = (i + 0.5) * FROST_CELL;
      const cz = (j + 0.5) * FROST_CELL;
      if (Math.hypot(cx - x, cz - z) > radius || !floor(cx, cz)) continue;
      const cell: FrostCell = [FLOOR, 0, i, j];
      if (structures.frost.set(cell, true)) changed.push(cell);
    }
  return changed;
}

export function sprayFrost(
  structures: Structures,
  floor: (x: number, z: number) => boolean,
  o: Vec3,
  d: Vec3,
  halfAngle: number,
  range: number,
  shot: number,
  on: boolean,
): FrostCell[] {
  // Two unit vectors across the spray, to fan the rays round it.
  const ref = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const a = unit(cross(d, ref));
  const b = cross(d, a);
  const changed: FrostCell[] = [];
  // The blot a ray makes `t` metres out, meeting the face with `n` of its direction along the
  // face's normal and (pu, pv) of it across the face: a round splat SPREAD of the spray's width
  // there, drawn out along the ray as the face lies glancing to it, to three times its width.
  const blot = (u: number, v: number, t: number, n: number, pu: number, pv: number): Blot => {
    const across = Math.max(SPLAT, t * Math.tan(halfAngle) * SPREAD);
    const flat = Math.hypot(pu, pv);
    const along = across / Math.max(Math.abs(n), 1 / 3);
    return flat < 1e-6
      ? { u, v, along: across, across, dirU: 1, dirV: 0 }
      : { u, v, along, across, dirU: pu / flat, dirV: pv / flat };
  };
  for (let k = 0; k < RAYS; k++) {
    const n = shot * RAYS + k;
    const r = halfAngle * Math.sqrt((0.5 + n * R2[0]) % 1);
    const theta = 2 * Math.PI * ((0.5 + n * R2[1]) % 1);
    const across = Math.sin(r);
    const dir = {
      x: d.x * Math.cos(r) + (a.x * Math.cos(theta) + b.x * Math.sin(theta)) * across,
      y: d.y * Math.cos(r) + (a.y * Math.cos(theta) + b.y * Math.sin(theta)) * across,
      z: d.z * Math.cos(r) + (a.z * Math.cos(theta) + b.z * Math.sin(theta)) * across,
    };
    const hit = structures.touch(o, dir, range);
    const floorT = dir.y < 0 ? -o.y / dir.y : Infinity;
    if (floorT <= range && floorT < (hit?.t ?? Infinity)) {
      const x = o.x + dir.x * floorT;
      const z = o.z + dir.z * floorT;
      if (!floor(x, z)) continue;
      const inside = ([, , i, j]: FrostCell) => floor((i + 0.5) * FROST_CELL, (j + 0.5) * FROST_CELL);
      const b = blot(x, z, floorT, dir.y, dir.x, dir.z);
      changed.push(...splat(structures.frost, null, FLOOR, 0, b, on, inside));
      continue;
    }
    if (!hit || hit.face === null) continue;
    const s = structures.list[hit.piece];
    if (s.door || s.kind === 'ladder') continue;
    // The spot and the ray's direction in the piece's frame, then across its face.
    const yaw = s.yaw ?? 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const dx = hit.point.x - s.x;
    const dz = hit.point.z - s.z;
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    const [ex, ey, ez] = [dir.x * cos - dir.z * sin, dir.y, dir.x * sin + dir.z * cos];
    const [u, v] = faceCoords(s, hit.face, lx, hit.point.y - (s.y ?? 0), lz);
    const [into, pu, pv] = hit.face <= 1 ? [ey, ex, ez] : hit.face <= 3 ? [ex, ez, ey] : [ez, ex, ey];
    changed.push(...splat(structures.frost, s, hit.piece, hit.face, blot(u, v, hit.t, into, pu, pv), on));
  }
  return changed;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function unit(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
