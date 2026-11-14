// How each avatar walks: the metres between its footfalls, which pace both its step sounds
// (audio/Footsteps.ts) and its limbs (Gait in common.ts, a footfall at each end of the legs'
// swing), so what you hear lands with what you see; what a footfall sounds like; and how the
// sound is pitched, a heavy body lower and slower. Every avatar has a row, null for one that never
// walks, so a new one has to choose each of these.
import { RUN_MULTIPLIER, walkSpeedOf, type AvatarId } from '@world/shared';
import type { SoundId } from '../../audio/Sfx';

export interface GaitSpec {
  stride: number; // metres between footfalls, at any speed up to its full walk: a slow walk steps slowly
  // Metres between footfalls running flat out (RUN_MULTIPLIER of its walk), for one whose stride
  // lengthens as it runs; between a walk and that, in between.
  runStride?: number;
  jump?: SoundId; // what leaving the ground on a jump sounds like: the swoosh unless given
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
  gary: { stride: 1.5, steps: { loop: 'slime' }, pitch: 1 }, // a snail: no footsteps, a faint slide
  plankton: { stride: 0.8, steps: 'thuds', pitch: 1.6 }, // a tiny, quick patter
  krabs: { stride: 0.52, steps: { loop: 'scuttle' }, pitch: 1 }, // the scuttle: tiny quick steps under one loop
  // A side's two tentacles plop down together, a lighter higher plop then a heavier lower one, 1.7
  // times a second at his full 6 m/s walk: an unhurried amble.
  squidward: { stride: 3.5, steps: { bar: ['suction-1', 'suction-2', 'suction-3', 'suction-4'] }, pitch: 1 },
  // Each step a little leap: under five a second at a full walk, and longer ones running.
  mario: { stride: 1.7, runStride: 2.4, steps: 'thuds', pitch: 1.05, jump: 'mario-jump' },
  luigi: { stride: 1.9, runStride: 2.7, steps: 'thuds', pitch: 1, jump: 'mario-jump' },
  'light-dragon': null,
  colgera: null,
};

// The metres between an avatar's footfalls with its feet walking at `walk` m/s.
export function strideOf(avatar: AvatarId, gait: GaitSpec, walk: number): number {
  if (gait.runStride === undefined) return gait.stride;
  const running = (walk / walkSpeedOf(avatar) - 1) / (RUN_MULTIPLIER - 1);
  return gait.stride + (gait.runStride - gait.stride) * Math.min(1, Math.max(0, running));
}
