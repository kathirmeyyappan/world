// What a surface is like underfoot, apart from its shape (structures.ts) and its look (a
// structure's `material`): how the feet take hold of it, and what a footfall on it sounds like.
// Every structure has one, named in `surface` or implied by its material (MATERIAL_SURFACES),
// the bare floor is hard, and frost (frost.ts) makes any top ice for as long as it lasts. The
// walker reads `grip` every tick (walker.ts); the client's Footsteps plays `footfall`. A new
// surface is a row here and, with a footfall of its own, sounds for it in the client.
import type { Structure, StructureMaterial } from './structures';

export type SurfaceId = 'hard' | 'sand' | 'ice';

// What a step on it sounds like, for avatars whose steps are the ground's (the thuds).
export type Footfall = 'thud' | 'crunch';

export interface SurfaceSpec {
  id: SurfaceId;
  // How fast the feet can change the walk's velocity, m/s²: toward where the keys send it, or to
  // a stop with none held. Infinity is a sure footing: the walk goes exactly where it's sent, at
  // once. Anything less keeps its momentum, slowing at this rate, and gravity pulls it down any
  // slope the feet can't hold against (walker.ts).
  grip: number;
  footfall: Footfall;
}

export const SURFACES: Record<SurfaceId, SurfaceSpec> = {
  hard: { id: 'hard', grip: Infinity, footfall: 'thud' },
  sand: { id: 'sand', grip: Infinity, footfall: 'crunch' },
  // From a full walk to a stop in 1.6 s and 6 m; a slope of 15° or more pulls harder than the
  // feet can push, so the slide can't be climbed.
  ice: { id: 'ice', grip: 5, footfall: 'thud' },
};

// The surface a material implies when the structure names none.
export const MATERIAL_SURFACES: Record<StructureMaterial, SurfaceId> = {
  brick: 'hard',
  wood: 'hard',
  'red-tile': 'hard',
  flagstone: 'hard',
  sand: 'sand',
  sandstone: 'hard',
};

export function isSurfaceId(v: unknown): v is SurfaceId {
  return typeof v === 'string' && Object.hasOwn(SURFACES, v);
}

// What a structure is like underfoot, frost aside.
export function surfaceOfStructure(s: Structure): SurfaceId {
  return s.surface ?? (s.material ? MATERIAL_SURFACES[s.material] : 'hard');
}
