// Picks the avatar builder for a player's avatar id. The Game recreates a player's avatar
// whenever the id in their state changes.
import type { AvatarId } from '@world/shared';
import type { Engine } from '../Engine';
import { bodyBuilder } from './Body';
import { DragonAvatar } from './Dragon';
import { DRAGONS, type DragonAvatarId } from './dragons';
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
// do, with the dragons' models, so a change of look goes on without waiting on the network.
const SKINNED: readonly AvatarId[] = [
  'sulley',
  'mike',
  'spongebob',
  'patrick',
  'krabs',
  'squidward',
  'gary',
  ...(Object.keys(DRAGONS) as DragonAvatarId[]),
];

// Everyone on foot is a figure the walker poses (Walker.ts), made from its builder; one that moves
// by a rule of its own is a subclass of WalkerAvatar, made here by its class. A dragon skin is the
// dragon (Dragon.ts) in that skin's look (dragons.ts).
type Make = (engine: Engine, id: string, kind: AvatarId, color: string) => Avatar;
const walker =
  (build: Build): Make =>
  (engine, id, kind, color) =>
    new WalkerAvatar(engine, id, kind, build, color);
const dragon =
  (look: DragonAvatarId): Make =>
  (engine, id, kind) =>
    new DragonAvatar(engine, id, kind, DRAGONS[look]);
const MAKERS: Record<AvatarId, Make> = {
  standard: walker(buildStandard),
  elizabeth: walker(buildElizabeth),
  sahur: walker(buildSahur),
  sulley: walker(buildSulley),
  mike: walker(bodyBuilder(MIKE)),
  spongebob: walker(bodyBuilder(SPONGEBOB)),
  patrick: walker(bodyBuilder(PATRICK)),
  krabs: walker(bodyBuilder(KRABS)),
  squidward: walker(buildSquidward),
  gary: walker(buildGary),
  'light-dragon': dragon('light-dragon'),
  colgera: dragon('colgera'),
};

export function preloadAvatars(engine: Engine): void {
  const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 3000));
  idle(() => {
    for (const avatar of SKINNED) skinTexture(engine.scene, avatar);
    for (const look of Object.values(DRAGONS)) void look.model();
  });
}

export function createAvatar(engine: Engine, p: { id: string; color: string; avatar: AvatarId }): Avatar {
  return MAKERS[p.avatar](engine, p.id, p.avatar, p.color);
}
