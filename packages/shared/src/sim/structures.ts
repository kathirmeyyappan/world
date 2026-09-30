// Static geometry: buildings, walls, platforms, ramps and terrain. This file is the authoring
// surface (what a structure is, plus helpers for common pieces); collision.ts is how the sim uses
// them, and the client's render/Structures.ts draws them. The world's list is content/structures.ts.
//
// Every structure has a footprint: a w × d rectangle centred on (x, z) and turned by yaw (yaw 0
// faces +z, like players; local +x is to the right of local +z). Its underside is at height y
// (default 0, on the floor), and its kind says how high its top is at each point of the footprint.
// Standing, bumping, ceilings and line of sight are all worked out from those two facts, so a new
// kind needs a case in `surfaceOf` here and a builder in the client; the compiler asks for both.
import { STEP_UP } from './constants';

export interface Footprint {
  x: number;
  z: number;
  w: number; // along local x
  d: number; // along local z
  y?: number; // underside height; above 0 it floats, and players can walk beneath
  yaw?: number;
  material?: StructureMaterial; // a pixel texture (the client's render/structureMaterials.ts)
  color?: string; // flat CSS colour when there's no material; each kind has a default
}

// Surface looks the renderer knows how to paint.
export type StructureMaterial = 'brick' | 'wood' | 'red-tile' | 'flagstone';

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

export type Structure = Box | Ramp | Terrain;
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
  if ((s.kind === 'box' || s.kind === 'ramp') && !(s.h > 0)) throw bad('h must be positive');
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

// A flight of solid steps from `bottom` on the floor (or at y) up to `top`, rising by h in total,
// width w. Each step rises h / steps; the default keeps that near 0.25 m. Throws if a step is
// taller than a player can walk up (STEP_UP).
export function stairs(
  bottom: { x: number; z: number },
  top: { x: number; z: number },
  h: number,
  w: number,
  steps = Math.max(1, Math.ceil(h / 0.25)),
  y = 0,
): Box[] {
  if (h / steps > STEP_UP) throw new Error(`stairs: ${steps} steps rising ${h} m are over ${STEP_UP} m each`);
  const yaw = Math.atan2(top.x - bottom.x, top.z - bottom.z);
  const depth = Math.hypot(top.x - bottom.x, top.z - bottom.z) / steps;
  return Array.from({ length: steps }, (_, i) => {
    const t = (i + 0.5) / steps;
    return {
      kind: 'box',
      x: bottom.x + (top.x - bottom.x) * t,
      z: bottom.z + (top.z - bottom.z) * t,
      y,
      yaw,
      w,
      d: depth,
      h: (h * (i + 1)) / steps,
    };
  });
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

// A round wall of `segments` straight pieces on a circle of radius r (the wall's centreline).
// Each gap cuts a vertical opening (a doorway, a window) between two heights in the piece at
// that angle.
export function roundWall(opts: {
  x: number;
  z: number;
  r: number;
  h: number;
  thickness: number;
  segments?: number;
  gaps?: { angle: number; bottom: number; top: number }[];
  material?: StructureMaterial;
  color?: string;
}): Box[] {
  const { x, z, r, h, thickness, segments = 32, gaps = [], material, color } = opts;
  const step = (2 * Math.PI) / segments;
  const pieces: Box[] = [];
  for (let i = 0; i < segments; i++) {
    const mid = i * step;
    const cuts = gaps
      .filter((g) => ((Math.round(g.angle / step) % segments) + segments) % segments === i)
      .sort((a, b) => a.bottom - b.bottom);
    let from = 0;
    const spans: [number, number][] = [];
    for (const g of cuts) {
      spans.push([from, g.bottom]);
      from = g.top;
    }
    spans.push([from, h]);
    // A hair wider than the chord so neighbouring pieces meet at the outer face.
    const a = onCircle(x, z, r, mid - step * 0.52);
    const b = onCircle(x, z, r, mid + step * 0.52);
    for (const [lo, hi] of spans)
      if (hi - lo > 1e-6) pieces.push({ ...wall(a, b, hi - lo, thickness, lo), material, color });
  }
  return pieces;
}

// Steps winding around (x, z) between two radii, `turns` times round while rising from `bottom`
// by `rise`. Each step is a slab `thickness` deep, so there's headroom beneath the flight above.
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
      d: turn * outer, // the arc at the outer edge, so steps meet there and overlap inside
      h: top - base,
      material,
      color,
    };
    if (rail <= 0) return [step];
    const post: Box = {
      kind: 'box',
      ...at(inner + RAIL_WIDTH / 2),
      y: base,
      yaw,
      w: RAIL_WIDTH,
      d: turn * inner + 0.02,
      h: top - base + rail,
      material,
      color,
    };
    return [step, post];
  }).flat();
}

// A round floor of radius r whose top is at y, with no gaps: a square in the middle and rings of
// sector-shaped boxes around it, each overlapping its neighbours. An optional hole (for a stair
// coming up from below) removes every sector of the outer ring, from `inner` out to r, that touches
// the angles `from`..`to`; the hole is never smaller than asked. Sectors are at most `chord` metres
// along the circle.
export function roundFloor(opts: {
  x: number;
  z: number;
  r: number;
  y: number;
  thickness?: number;
  hole?: { inner: number; from: number; to: number };
  chord?: number;
  material?: StructureMaterial;
  color?: string;
}): Box[] {
  const { x, z, r, y, thickness = 0.4, hole, chord = 2, material, color } = opts;
  const slab = { y: y - thickness, h: thickness, material, color };
  const edge = hole ? hole.inner : r / 2; // where the outer ring (the one a hole is cut from) begins
  const core = edge / 2; // the middle square's half side: its corners stay inside `edge`
  const pieces: Box[] = [{ kind: 'box', x, z, w: 2 * core + 0.1, d: 2 * core + 0.1, ...slab }];
  const ring = (a: number, b: number, holed: boolean) => {
    const count = Math.max(8, Math.ceil((2 * Math.PI * b) / chord));
    const span = (2 * Math.PI) / count;
    const inset = a * (1 - Math.cos(span / 2)) + 0.05; // reach far enough in to meet the ring inside
    for (let k = 0; k < count; k++) {
      const angle = (k + 0.5) * span;
      if (holed && hole) {
        const middle = (hole.from + hole.to) / 2;
        const off = Math.abs(((((angle - middle) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        if (off < span / 2 + (hole.to - hole.from) / 2) continue;
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
  ring(core, edge, false);
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
