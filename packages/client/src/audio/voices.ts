// What a character says in its own voice, where it has one: on a jump, a long jump, and a hit.
// Anything a row leaves out is the sound every body makes there.
import type { AvatarId } from '@world/shared';
import type { SoundId } from './Sfx';

export interface Voice {
  jump?: SoundId; // leaving the ground on a jump: the swoosh unless given
  leap?: SoundId[]; // leaving it on a long jump (sim/avatars.ts `Leap`): the jump's sound unless given
  hurt?: SoundId[]; // taking damage, heard by everyone near
}

export const VOICES: Partial<Record<AvatarId, Voice>> = {
  mario: {
    jump: 'mario-jump',
    leap: ['mario-leap-1', 'mario-leap-2'],
    hurt: ['mario-hurt-1', 'mario-hurt-2', 'mario-hurt-3'],
  },
  luigi: {
    jump: 'mario-jump',
    leap: ['luigi-leap-1', 'luigi-leap-2'],
    hurt: ['luigi-hurt-1', 'luigi-hurt-2'],
  },
};

// One of a line's takes, any of them.
export function take(takes: SoundId[] | undefined): SoundId | undefined {
  return takes?.[Math.floor(Math.random() * takes.length)];
}
