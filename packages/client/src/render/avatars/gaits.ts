// How each avatar walks: the metres between its footfalls, which pace both its step sounds
// (audio/Footsteps.ts) and its limbs (Gait in common.ts, a footfall at each end of the legs'
// swing), so what you hear lands with what you see; what a footfall sounds like; and how the
// sound is pitched, a heavy body lower and slower. Every avatar has a row, null for one that never
// walks, so a new one has to choose each of these.
import type { AvatarId } from '@world/shared';
import type { SoundId } from '../../audio/Sfx';

export interface GaitSpec {
  stride: number; // metres between footfalls, at any speed: a slow walk steps slowly
  // A footfall: one of the thuds, a different one each time; a bar of the avatar's own sounds,
  // played round in order; or a loop that runs for as long as it moves along the ground.
  steps: 'thuds' | { bar: SoundId[] } | { loop: SoundId };
  pitch: number; // the step and landing sounds' rate: 1 as recorded, less is lower and longer
}

export const GAITS: Record<AvatarId, GaitSpec | null> = {
  standard: { stride: 2.6, steps: 'thuds', pitch: 1 },
  elizabeth: { stride: 2.6, steps: 'thuds', pitch: 1 },
  sahur: { stride: 4.1, steps: 'thuds', pitch: 0.8 }, // plods
  sulley: { stride: 4.4, steps: 'thuds', pitch: 0.85 }, // long, slow strides
  mike: { stride: 1.5, steps: 'thuds', pitch: 1.25 }, // patters
  spongebob: { stride: 2.3, steps: { bar: ['squeak-1', 'squeak-2', 'squeak-3', 'squeak-4'] }, pitch: 1.05 }, // high, low, high, low
  patrick: { stride: 2.6, steps: 'thuds', pitch: 0.9 },
  krabs: { stride: 0.52, steps: { loop: 'scuttle' }, pitch: 1 }, // the scuttle: tiny quick steps under one loop
  // A side's two tentacles plop down together, a lighter higher plop then a heavier lower one, at
  // the show's 2.3 a second at a full walk.
  squidward: { stride: 3.5, steps: { bar: ['suction-1', 'suction-2', 'suction-3', 'suction-4'] }, pitch: 1 },
  'light-dragon': null,
};
