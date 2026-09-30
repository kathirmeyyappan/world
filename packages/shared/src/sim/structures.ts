// Static geometry: buildings, walls, platforms, ramps and terrain. This file is the authoring
// surface (what a structure is, plus helpers for common pieces); collision.ts is how the sim uses
// them, and the client's render/Structures.ts draws them. The world's list is content/structures.ts.
//
// Every structure has a footprint: a w × d rectangle centred on (x, z) and turned by yaw (yaw 0
// faces +z, like players; local +x is to the right of local +z). Its underside is at height y
// (default 0, on the floor), and its kind says how high its top is at each point of the footprint.
// Standing, bumping, ceilings and line of sight are all worked out from those two facts, so a new
// kind needs a case in `surfaceOf` here and a builder in the client; the compiler asks for both.

export interface Footprint {
  x: number;
  z: number;
  w: number; // along local x
  d: number; // along local z
  y?: number; // underside height; above 0 it floats, and players can walk beneath
  yaw?: number;
  color?: string; // CSS colour for the renderer; each kind has a default
}

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
