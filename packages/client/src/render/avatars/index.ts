// Picks the avatar builder for a player's avatar id. The Game recreates a player's avatar
// whenever the id in their state changes.
import type { AvatarId } from '@world/shared';
import type { Engine } from '../Engine';
import { bodyBuilder } from './Body';
import { DragonAvatar, loadDragonModel } from './Dragon';
import { buildElizabeth } from './Elizabeth';
import { buildGary } from './Gary';
import { KRABS } from './Krabs';
import { MIKE } from './Mike';
import { PATRICK } from './Patrick';
import { buildSahur } from './Sahur';
import { SPONGEBOB } from './SpongeBob';
import { buildSquidward } from './Squidward';
import { buildStandard } from './Standard';
import { buildSulley } from './Sulley';
import { skinTexture } from './skinned';
import { WalkerAvatar, type Build } from './Walker';
import type { Avatar } from './common';

export type { Avatar } from './common';

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

// Everyone on foot is a figure the Walker poses (Walker.ts); the dragon is its own class.
const WALKERS: Record<Exclude<AvatarId, 'light-dragon'>, Build> = {
  standard: buildStandard,
  elizabeth: buildElizabeth,
  sahur: buildSahur,
  sulley: buildSulley,
  mike: bodyBuilder(MIKE),
  spongebob: bodyBuilder(SPONGEBOB),
  patrick: bodyBuilder(PATRICK),
  krabs: bodyBuilder(KRABS),
  squidward: buildSquidward,
  gary: buildGary,
};

export function preloadAvatars(engine: Engine): void {
  const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 3000));
  idle(() => {
    for (const avatar of SKINNED) skinTexture(engine.scene, avatar);
    void loadDragonModel();
  });
}

export function createAvatar(engine: Engine, p: { id: string; color: string; avatar: AvatarId }): Avatar {
  if (p.avatar === 'light-dragon') return new DragonAvatar(engine, p.id);
  return new WalkerAvatar(engine, p.id, p.avatar, WALKERS[p.avatar], p.color);
}
