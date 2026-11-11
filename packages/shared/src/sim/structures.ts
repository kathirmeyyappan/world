// Static geometry: buildings, walls, platforms, ramps, terrain and ladders. This file is the authoring
// surface (what a structure is, plus helpers for common pieces); collision.ts is how the sim uses
// them, and the client's render/Structures.ts draws them. The world's list is content/structures.ts.
//
// Every structure has a footprint: a w × d rectangle centred on (x, z) and turned by yaw (yaw 0
// faces +z, like players; local +x is to the right of local +z). Its underside is at height y
// (default 0, on the floor), and its kind says how high its top is at each point of the footprint.
// Standing, bumping, ceilings and line of sight are all worked out from those two facts, so a new
// kind needs a case in `surfaceOf` here and a builder in the client; the compiler asks for both.
// What it's like underfoot is its surface (surfaces.ts), named or implied by its material.
import { STEP_UP } from './constants';
import { isSurfaceId, type SurfaceId } from './surfaces';

export interface Footprint {
  x: number;
  z: number;
  w: number; // along local x
  d: number; // along local z
  y?: number; // underside height; above 0 it floats, and players can walk beneath
  yaw?: number;
  material?: StructureMaterial; // a pixel texture (the client's render/structureMaterials.ts)
  color?: string; // flat CSS colour when there's no material; each kind has a default
  surface?: SurfaceId; // what it's like to walk on (surfaces.ts); the material's by default
  door?: { id: string; open: boolean }; // a door's slab (doors.ts): stands only while the door is open or shut as `open` says
  hidden?: boolean; // collided with but never drawn: the shape of something the client draws its own way (a model)
  worldTop?: boolean; // map the top in world x/z whatever the look does, so overlapping tops of a plank look paint alike
}

// Surface looks the renderer knows how to paint.
export type StructureMaterial = 'brick' | 'wood' | 'red-tile' | 'flagstone' | 'sand' | 'plaster' | 'steel';

// A solid block: walls, buildings, platforms, pillars.
export interface Box extends Footprint {
  kind: 'box';
  h: number;
}

// A wedge that rises by h from its local -z edge (flush with the underside) to its local +z edge.
export interface Ramp extends Footprint {
  kind: 'ramp';
  h: number;
}

// A heightfield over the footprint: rows run along local z from -d/2 to +d/2, columns along local
// x from -w/2 to +w/2, at least 2 of each, and the surface is bilinear between samples. Heights
// are above the underside. Keep the edge samples at 0 to blend into the floor; the renderer
// draws no side walls.
export interface Terrain extends Footprint {
  kind: 'terrain';
  heights: number[][];
}

// An upright frame of two rails and rungs, w across (local x) and d through (its girth, local z),
// h tall from its underside: a walker holding forward at either of its local ±z faces takes hold
// and climbs it (walker.ts). To everything else it is a thin box, and frost never lies on it.
export interface Ladder extends Footprint {
  kind: 'ladder';
  h: number; // metres from its foot to its top, straight up
  // Radians from upright, up to MAX_LADDER_LEAN, its top that far over toward its local +z, as a
  // ladder stood against a wall there leans; climbed on the face it leans away from. Where it
  // leans it is solid underneath, like a ramp (surfaceOf), so lean one against something.
  lean?: number;
}

export type Structure = Box | Ramp | Terrain | Ladder;
export type StructureKind = Structure['kind'];

// How tall a structure is at a local point of its footprint (above its underside), and the
// greatest such height. The one per-kind fact the sim needs.
export interface Surface {
  top(lx: number, lz: number): number;
  height: number;
}

export function surfaceOf(s: Structure): Surface {
  switch (s.kind) {
    case 'box':
      return { top: () => s.h, height: s.h };
    case 'ladder': {
      // A leaning ladder's footprint runs from its foot to under its top (collision.ts), and it
      // is the wedge under its rails: a ramp from the foot's edge up to the top's.
      const d = s.d + ladderRun(s);
      return { top: (_lx, lz) => (s.lean ? s.h * (lz / d + 0.5) : s.h), height: s.h };
    }
    case 'ramp':
      return { top: (_lx, lz) => s.h * (lz / s.d + 0.5), height: s.h };
    case 'terrain':
      return { top: (lx, lz) => bilinear(s, lx, lz), height: Math.max(0, ...s.heights.flat()) };
  }
}

function bilinear(s: Terrain, lx: number, lz: number): number {
  const rows = s.heights.length;
  const cols = s.heights[0].length;
  const fx = Math.max(0, Math.min(cols - 1, (lx / s.w + 0.5) * (cols - 1)));
  const fz = Math.max(0, Math.min(rows - 1, (lz / s.d + 0.5) * (rows - 1)));
  const i = Math.min(cols - 2, Math.floor(fx));
  const j = Math.min(rows - 2, Math.floor(fz));
  const tx = fx - i;
  const tz = fz - j;
  const row = (r: number[]) => r[i] + (r[i + 1] - r[i]) * tx;
  return row(s.heights[j]) + (row(s.heights[j + 1]) - row(s.heights[j])) * tz;
}

// Throws on a structure the sim can't use, naming it, so a bad entry fails at startup.
export function validateStructure(s: Structure, label: string): void {
  const bad = (why: string) => new Error(`structure ${label} (${s.kind}): ${why}`);
  if (!(s.w > 0 && s.d > 0)) throw bad('w and d must be positive');
  if (s.kind !== 'terrain' && !(s.h > 0)) throw bad('h must be positive');
  if (s.kind === 'ladder' && s.lean !== undefined && !(s.lean >= 0 && s.lean <= MAX_LADDER_LEAN))
    throw bad(`lean must be from 0 to ${MAX_LADDER_LEAN} radians`);
  if (s.surface !== undefined && !isSurfaceId(s.surface)) throw bad(`unknown surface ${String(s.surface)}`);
  if (s.worldTop !== undefined && typeof s.worldTop !== 'boolean') throw bad('worldTop must be a boolean');
  if (s.kind === 'terrain') {
    const cols = s.heights[0]?.length ?? 0;
    if (s.heights.length < 2 || cols < 2 || s.heights.some((r) => r.length !== cols))
      throw bad('heights must be a rectangular grid of at least 2 x 2');
  }
}

// Authoring helpers for the common pieces. Each returns plain data, so a composite (a building)
// is just a function returning a list.

// A wall of the given height and thickness running along the floor from a to b.
export function wall(a: { x: number; z: number }, b: { x: number; z: number }, h: number, thickness = 0.4, y = 0): Box {
  return {
    kind: 'box',
    x: (a.x + b.x) / 2,
    z: (a.z + b.z) / 2,
    y,
    yaw: Math.atan2(b.x - a.x, b.z - a.z),
    w: thickness,
    d: Math.hypot(b.x - a.x, b.z - a.z),
    h,
  };
}

export const LADDER_WIDTH = 0.7; // metres across the rails
export const LADDER_GIRTH = 0.3; // metres through the frame: what a body or a shot meets
export const MAX_LADDER_LEAN = Math.PI / 4; // radians from upright: further over, it's a ramp with rungs

// A ladder standing on `foot` (its underside at y) up to `top`, its faces turned to `yaw` (the
// frame runs across it), of wood unless told otherwise.
export interface LadderOptions {
  material?: StructureMaterial;
  width?: number; // metres across the rails
  lean?: number; // radians from upright, toward the ladder's local +z
  hidden?: boolean; // for one a model draws
}

// A ladder standing on `foot` (the middle of its rails at the floor, at height y) up to `top`,
// its rungs across local x and its faces toward local ±z.
export function ladder(
  foot: { x: number; z: number },
  y: number,
  top: number,
  yaw: number,
  { material = 'wood', width = LADDER_WIDTH, lean = 0, hidden }: LadderOptions = {},
): Ladder {
  const piece: Ladder = {
    kind: 'ladder',
    x: foot.x,
    z: foot.z,
    y,
    yaw,
    w: width,
    d: LADDER_GIRTH,
    h: top - y,
    material,
  };
  if (lean) piece.lean = lean;
  if (hidden) piece.hidden = true;
  return piece;
}

// A ladder at bearing `angle` round (x, z), its rails' middle `r` out, stood with its back (local +z)
// toward the middle: up the outside of a round wall or the outer edge of a ring. With `outward`
// its back is away from the middle instead, as up the inner edge of a ring.
export function ringLadder(
  centre: { x: number; z: number },
  r: number,
  angle: number,
  y: number,
  top: number,
  { outward = false, ...opts }: LadderOptions & { outward?: boolean } = {},
): Ladder {
  const back = outward ? 1 : -1;
  const foot = { x: centre.x + r * Math.cos(angle), z: centre.z + r * Math.sin(angle) };
  return ladder(foot, y, top, Math.atan2(back * Math.cos(angle), back * Math.sin(angle)), opts);
}

// Metres a ladder's top is over from its foot, along its local +z: none upright.
export function ladderRun(s: Ladder): number {
  return s.h * Math.tan(s.lean ?? 0);
}

// A ramp from `low` on the floor (or at y) up to `high`, rising by h, width w.
export function ramp(low: { x: number; z: number }, high: { x: number; z: number }, h: number, w: number, y = 0): Ramp {
  return {
    kind: 'ramp',
    x: (low.x + high.x) / 2,
    z: (low.z + high.z) / 2,
    y,
    yaw: Math.atan2(high.x - low.x, high.z - low.z),
    w,
    d: Math.hypot(high.x - low.x, high.z - low.z),
    h,
  };
}

// A flight of steps from `bottom` up to `top`, rising by h in total from height `y` (default 0, the
// floor), width w. Each step rises h / steps; the default keeps that near 0.25 m. Steps are solid
// down to y, unless each is a slab `thickness` deep (a flight in the air, with room beneath it);
// with `rail`, each step also carries a post that high on both edges, so nobody steps off the
// sides. Throws if a step is taller than a player can walk up (STEP_UP).
export function stairs(
  bottom: { x: number; z: number },
  top: { x: number; z: number },
  h: number,
  w: number,
  opts: { steps?: number; y?: number; thickness?: number; rail?: number; material?: StructureMaterial } = {},
): Box[] {
  const { steps = Math.max(1, Math.ceil(h / 0.25)), y = 0, thickness = Infinity, rail = 0, material } = opts;
  if (h / steps > STEP_UP) throw new Error(`stairs: ${steps} steps rising ${h} m are over ${STEP_UP} m each`);
  const yaw = Math.atan2(top.x - bottom.x, top.z - bottom.z);
  const depth = Math.hypot(top.x - bottom.x, top.z - bottom.z) / steps;
  const RAIL_WIDTH = 0.2;
  return Array.from({ length: steps }, (_, i): Box[] => {
    const t = (i + 0.5) / steps;
    const at = { x: bottom.x + (top.x - bottom.x) * t, z: bottom.z + (top.z - bottom.z) * t };
    const stepTop = y + (h * (i + 1)) / steps;
    const base = Math.max(y, stepTop - thickness);
    const step: Box = { kind: 'box', ...at, y: base, yaw, w, d: depth, h: stepTop - base, material };
    if (rail <= 0) return [step];
    // Standing on the step rather than beside it, so the two share no face; local +x is (cos, -sin).
    const post = (side: number): Box => {
      const off = side * (w / 2 - RAIL_WIDTH / 2);
      const x = at.x + off * Math.cos(yaw);
      const z = at.z - off * Math.sin(yaw);
      return { kind: 'box', x, z, y: stepTop, yaw, w: RAIL_WIDTH, d: depth + 0.02, h: rail, material };
    };
    return [step, post(1), post(-1)];
  }).flat();
}

// Four walls and a roof. The doorway is a gap of `door` metres in the middle of the local +z
// wall, `doorHeight` tall; the roof sits on the walls.
export function building(opts: {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  yaw?: number;
  door?: number;
  doorHeight?: number;
  thickness?: number;
  color?: string;
}): Box[] {
  const { x, z, w, d, h, yaw = 0, door = 2, doorHeight = 2.6, thickness = 0.4, color } = opts;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (lx: number, lz: number) => ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c });
  const hw = w / 2;
  const hd = d / 2;
  const side = (hw - door / 2) / 2; // width of each wall piece either side of the door
  const pieces: Box[] = [
    wall(at(-hw, -hd), at(hw, -hd), h, thickness),
    wall(at(-hw, -hd), at(-hw, hd), h, thickness),
    wall(at(hw, -hd), at(hw, hd), h, thickness),
    wall(at(-hw, hd), at(-hw + 2 * side, hd), h, thickness),
    wall(at(hw - 2 * side, hd), at(hw, hd), h, thickness),
    wall(at(-door / 2, hd), at(door / 2, hd), h - doorHeight, thickness, doorHeight),
    { kind: 'box', x, z, y: h, yaw, w: w + thickness, d: d + thickness, h: thickness },
  ];
  return color ? pieces.map((p) => ({ ...p, color })) : pieces;
}

// Round pieces are built from straight ones. Angles are measured around (x, z) from +x toward +z.
function onCircle(x: number, z: number, r: number, angle: number): { x: number; z: number } {
  return { x: x + r * Math.cos(angle), z: z + r * Math.sin(angle) };
}

// A round wall of `segments` straight pieces on a circle of radius r (the wall's centreline),
// standing from height y to y + h. Each gap cuts a vertical opening (a doorway, a window) between
// two heights: the piece at that angle, or with `width` (radians) that arc centred on it, which may
// end partway along a piece (that piece keeps a jamb in the same plane up to the opening's edge).
export function roundWall(opts: {
  x: number;
  z: number;
  r: number;
  h: number;
  thickness: number;
  y?: number;
  segments?: number;
  gaps?: { angle: number; bottom: number; top: number; width?: number }[];
  material?: StructureMaterial;
  color?: string;
  hidden?: boolean;
  worldTop?: boolean;
}): Box[] {
  const { x, z, r, h, thickness, y = 0, segments = 32, gaps = [], material, color, hidden, worldTop } = opts;
  const step = (2 * Math.PI) / segments;
  const pieces: Box[] = [];
  for (let i = 0; i < segments; i++) {
    const mid = i * step;
    // The piece runs along the chord, long enough that its outer face reaches the corner it shares
    // with its neighbour (and a hair past): a thick wall's joints are wedges open on the outside
    // otherwise.
    const chord = r * Math.cos(step / 2);
    const length = 2 * (chord + thickness / 2) * Math.tan(step / 2) + 0.02;
    const foot = onCircle(x, z, chord, mid);
    const across = { x: -Math.sin(mid), z: Math.cos(mid) };
    const at = (d: number) => ({ x: foot.x + across.x * d, z: foot.z + across.z * d });
    const a = at(-length / 2);
    const b = at(length / 2);
    // The point on this piece's chord at `offset` radians from its middle.
    const along = (offset: number) => at(chord * Math.tan(offset));
    // Each gap's reach over this piece, as offsets from its middle, and up it, within its height.
    const cuts = gaps
      .map((g) => {
        const centre = g.width === undefined ? Math.round(g.angle / step) * step : g.angle;
        const half = (g.width ?? step) / 2;
        const off = Math.atan2(Math.sin(centre - mid), Math.cos(centre - mid));
        return {
          ...g,
          bottom: Math.max(g.bottom, y),
          top: Math.min(g.top, y + h),
          from: Math.max(off - half, -step / 2),
          to: Math.min(off + half, step / 2),
        };
      })
      .filter((g) => g.to - g.from > 1e-6 && g.top - g.bottom > 1e-6)
      .sort((p, q) => p.bottom - q.bottom);
    let from = y;
    const spans: [number, number][] = [];
    for (const g of cuts) {
      spans.push([from, g.bottom]);
      from = g.top;
      if (g.from > -step / 2 + 1e-6)
        pieces.push({
          ...wall(a, along(g.from), g.top - g.bottom, thickness, g.bottom),
          material,
          color,
          hidden,
          worldTop,
        });
      if (g.to < step / 2 - 1e-6)
        pieces.push({
          ...wall(along(g.to), b, g.top - g.bottom, thickness, g.bottom),
          material,
          color,
          hidden,
          worldTop,
        });
    }
    spans.push([from, y + h]);
    for (const [lo, hi] of spans)
      if (hi - lo > 1e-6) pieces.push({ ...wall(a, b, hi - lo, thickness, lo), material, color, hidden, worldTop });
  }
  return pieces;
}

// Steps winding around (x, z) between two radii, `turns` times round (the other way round when
// negative) while rising from `bottom` by `rise`. Each step is a slab `thickness` deep, so there's headroom beneath the flight above.
// With `rail`, each step also carries a post that high along its inner edge, so players can't step
// off the inside of the flight; they get on and off at its ends. Throws if a step is taller than
// a player can walk up.
export function spiralStairs(opts: {
  x: number;
  z: number;
  inner: number;
  outer: number;
  bottom: number;
  rise: number;
  turns: number;
  start: number;
  stepRise?: number;
  thickness?: number;
  rail?: number;
  material?: StructureMaterial;
  color?: string;
}): Box[] {
  const {
    x,
    z,
    inner,
    outer,
    bottom,
    rise,
    turns,
    start,
    stepRise = 0.25,
    thickness = 0.3,
    rail = 0,
    material,
    color,
  } = opts;
  const steps = Math.ceil(rise / stepRise);
  if (rise / steps > STEP_UP) throw new Error(`spiralStairs: steps rising ${rise / steps} m are over ${STEP_UP} m`);
  const turn = (turns * 2 * Math.PI) / steps;
  const RAIL_WIDTH = 0.2;
  return Array.from({ length: steps }, (_, i): Box[] => {
    const angle = start + turn * (i + 0.5);
    const top = bottom + (rise * (i + 1)) / steps;
    const base = Math.max(bottom, top - thickness);
    const yaw = Math.atan2(-Math.sin(angle), Math.cos(angle)); // local +z runs along the direction of climb
    const at = (r: number) => onCircle(x, z, r, angle);
    const step: Box = {
      kind: 'box',
      ...at((inner + outer) / 2),
      y: base,
      yaw,
      w: outer - inner,
      d: Math.abs(turn) * outer, // the arc at the outer edge, so steps meet there and overlap inside
      h: top - base,
      material,
      color,
    };
    if (rail <= 0) return [step];
    // Stands on the step rather than beside it, so the two share no face.
    const post: Box = {
      kind: 'box',
      ...at(inner + RAIL_WIDTH / 2),
      y: top,
      yaw,
      w: RAIL_WIDTH,
      d: Math.abs(turn) * inner + 0.02,
      h: rail,
      material,
      color,
    };
    return [step, post];
  }).flat();
}

// A round floor of radius r whose top is at y, with no gaps: a square in the middle and rings of
// sector-shaped boxes around it, each overlapping its neighbours. An optional hole (for a stair
// coming up from below) removes every sector of the outer ring, from the hole's `inner` out to r,
// that touches the angles `from`..`to`; the hole is never smaller than asked, and the ring's sectors
// start at `to`, so it ends exactly there (where a stair arriving through it ends, with nothing open
// past its top step) and only runs over at `from`; an `exact` hole has the sectors laid out over
// the arc outside it alone, so it ends exactly at both (a stair arriving at each end). With `inner`,
// only the ring from there out to r is built (a balcony round a tower, a roof open in the middle).
// Sectors are at most `chord` metres along the circle.
export function roundFloor(opts: {
  x: number;
  z: number;
  r: number;
  y: number;
  thickness?: number;
  inner?: number;
  hole?: { inner: number; from: number; to: number; exact?: boolean };
  chord?: number;
  material?: StructureMaterial;
  color?: string;
  hidden?: boolean;
  worldTop?: boolean;
}): Box[] {
  const { x, z, r, y, thickness = 0.4, inner, hole, chord = 2, material, color, hidden, worldTop } = opts;
  const slab = { y: y - thickness, h: thickness, material, color, hidden, worldTop };
  const edge = hole?.inner ?? inner ?? r / 2; // where the outer ring (the one a hole is cut from) begins
  const core = edge / 2; // the middle square's half side: its corners stay inside `edge`
  const pieces: Box[] =
    inner === undefined ? [{ kind: 'box', x, z, w: 2 * core + 0.1, d: 2 * core + 0.1, ...slab }] : [];
  const ring = (a: number, b: number, holed: boolean) => {
    const arc = holed && hole?.exact ? 2 * Math.PI - (hole.to - hole.from) : 2 * Math.PI;
    const count = Math.max(8, Math.ceil((arc * b) / chord));
    const span = arc / count;
    const inset = a * (1 - Math.cos(span / 2)) + 0.05; // reach far enough in to meet the ring inside
    const phase = holed && hole ? hole.to : 0;
    for (let k = 0; k < count; k++) {
      const angle = phase + (k + 0.5) * span;
      if (holed && hole && !hole.exact) {
        const middle = (hole.from + hole.to) / 2;
        const off = Math.abs(((((angle - middle) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        if (off < span / 2 + (hole.to - hole.from) / 2 - 1e-9) continue; // the sector just past `to` only touches it
      }
      const c = onCircle(x, z, (a - inset + b) / 2, angle);
      pieces.push({
        kind: 'box',
        x: c.x,
        z: c.z,
        yaw: Math.atan2(-Math.sin(angle), Math.cos(angle)),
        w: b - a + inset,
        d: span * b + 0.02,
        ...slab,
      });
    }
  };
  const start = inner ?? core;
  if (edge > start) ring(start, edge, false);
  ring(edge, r, true);
  return pieces;
}

// Terrain sampled from a height function over local coordinates, `cells` samples per metre.
export function terrain(opts: Footprint & { height: (lx: number, lz: number) => number; cells?: number }): Terrain {
  const { height, cells = 0.5, ...footprint } = opts;
  const cols = Math.max(2, Math.round(footprint.w * cells) + 1);
  const rows = Math.max(2, Math.round(footprint.d * cells) + 1);
  const heights = Array.from({ length: rows }, (_, j) =>
    Array.from({ length: cols }, (_, i) =>
      height((i / (cols - 1) - 0.5) * footprint.w, (j / (rows - 1) - 0.5) * footprint.d),
    ),
  );
  return { kind: 'terrain', ...footprint, heights };
}
