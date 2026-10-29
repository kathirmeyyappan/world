// Picks the avatar builder for a player's avatar id. The Game recreates a player's avatar
// whenever the id in their state changes.
import type { AvatarId } from '@world/shared';
import type { Engine } from '../Engine';
import { BodyAvatar } from './Body';
import { ElizabethAvatar } from './Elizabeth';
import { MIKE } from './Mike';
import { PATRICK } from './Patrick';
import { SahurAvatar } from './Sahur';
import { SPONGEBOB } from './SpongeBob';
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
      return new BodyAvatar(engine, p.id, MIKE);
    case 'spongebob':
      return new BodyAvatar(engine, p.id, SPONGEBOB);
    case 'patrick':
      return new BodyAvatar(engine, p.id, PATRICK);
    case 'standard':
      return new StandardAvatar(engine, p.id, p.color);
  }
}
