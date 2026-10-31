// What kind of player an avatar makes: how it moves each tick. Every avatar names its class
// (avatars.ts), and the Room and the client's prediction step a player through it (player.ts), so
// a new class is a spec here with the sim it needs, and a new look in a class is a row in AVATARS.
import { AVATARS, type AvatarId } from './avatars';
import type { Structures } from './collision';
import type { InputFrame, PlayerState } from './types';
import { stepWalker } from './walker';
import type { WorldPart } from './world';

export type PlayerClass = 'walker';

export interface ClassSpec {
  id: PlayerClass;
  // Moves `p` for one tick of `dt` seconds on `input` (null when no frame arrived), its look and
  // item already applied. Returns how fast it was falling if it landed, m/s downward, else 0.
  step(p: PlayerState, input: InputFrame | null, dt: number, shape: WorldPart[], structures: Structures): number;
}

export const CLASSES: Record<PlayerClass, ClassSpec> = {
  walker: { id: 'walker', step: stepWalker },
};

export function classOf(avatar: AvatarId): ClassSpec {
  return CLASSES[AVATARS[avatar].class];
}
