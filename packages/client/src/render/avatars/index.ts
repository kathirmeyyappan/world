// Picks the avatar builder for a player's avatar id. The Game recreates a player's avatar
// whenever the id in their state changes.
import type { AvatarId } from '@world/shared';
import type { Engine } from '../Engine';
import { ElizabethAvatar } from './Elizabeth';
import { MikeAvatar } from './Mike';
import { SahurAvatar } from './Sahur';
import { StandardAvatar } from './Standard';
import { SulleyAvatar } from './Sulley';
import type { Avatar } from './common';

export type { Avatar } from './common';
export { StandardAvatar } from './Standard';

export function createAvatar(engine: Engine, p: { id: string; color: string; avatar: AvatarId }): Avatar {
  switch (p.avatar) {
    case 'elizabeth':
      return new ElizabethAvatar(engine, p.id);
    case 'sahur':
      return new SahurAvatar(engine, p.id);
    case 'sulley':
      return new SulleyAvatar(engine, p.id);
    case 'mike':
      return new MikeAvatar(engine, p.id);
    case 'standard':
      return new StandardAvatar(engine, p.id, p.color);
  }
}
