// Picks the avatar builder for a player's avatar id. The Game recreates a player's avatar
// whenever the id in their state changes.
import type { AvatarId } from '@world/shared';
import type { Engine } from '../Engine';
import { BodyAvatar } from './Body';
import { DragonAvatar, loadDragonModel } from './Dragon';
import { ElizabethAvatar } from './Elizabeth';
import { GaryAvatar } from './Gary';
import { KRABS } from './Krabs';
import { MIKE } from './Mike';
import { PATRICK } from './Patrick';
import { SahurAvatar } from './Sahur';
import { SPONGEBOB } from './SpongeBob';
import { SquidwardAvatar } from './Squidward';
import { StandardAvatar } from './Standard';
import { SulleyAvatar } from './Sulley';
import { skinTexture } from './skinned';
import type { Avatar } from './common';

export type { Avatar } from './common';
export { StandardAvatar } from './Standard';

// The avatars drawn from a model with an atlas, each fetched once the page has nothing better to
// do, with the dragon's model, so a change of look goes on without waiting on the network.
const SKINNED: readonly AvatarId[] = [
  'sulley',
  'mike',
  'spongebob',
  'patrick',
  'krabs',
  'squidward',
  'gary',
  'light-dragon',
];

export function preloadAvatars(engine: Engine): void {
  const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 3000));
  idle(() => {
    for (const avatar of SKINNED) skinTexture(engine.scene, avatar);
    void loadDragonModel();
  });
}

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
    case 'krabs':
      return new BodyAvatar(engine, p.id, KRABS);
    case 'squidward':
      return new SquidwardAvatar(engine, p.id);
    case 'gary':
      return new GaryAvatar(engine, p.id);
    case 'standard':
      return new StandardAvatar(engine, p.id, p.color);
    case 'light-dragon':
      return new DragonAvatar(engine, p.id);
  }
}
