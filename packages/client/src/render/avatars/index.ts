// Picks the avatar builder for a player's avatar id. The Game recreates a player's avatar
// whenever the id in their state changes.
import type { AvatarId } from '@world/shared';
import type { Engine } from '../Engine';
import { ElizabethAvatar } from './Elizabeth';
import { SahurAvatar } from './Sahur';
import { StandardAvatar } from './Standard';
import type { Avatar } from './common';

export type { Avatar } from './common';

export function createAvatar(engine: Engine, p: { id: string; name: string; color: string; avatar: AvatarId }): Avatar {
  switch (p.avatar) {
    case 'elizabeth':
      return new ElizabethAvatar(engine, p.id, p.name, p.color);
    case 'sahur':
      return new SahurAvatar(engine, p.id, p.name, p.color);
    case 'standard':
      return new StandardAvatar(engine, p.id, p.name, p.color);
  }
}
