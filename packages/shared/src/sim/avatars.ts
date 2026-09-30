// Avatar types: how a player looks, and how big a target they make. Movement and items are the
// same for all of them; only the hit capsule follows the body. The chat command switches for good;
// a name containing an avatar's tag spawns as it and can't switch at all. A bot can also ask for any avatar when it joins
// (BotPlacement), including the ones people can't wear. Adding one means a row here and a builder
// in the client's render/avatars/.
export type AvatarId = 'standard' | 'elizabeth' | 'sahur';

// What shots test against (sim/combat.ts): a vertical capsule from the feet up to `top` metres,
// `radius` round its axis, whose top `head` metres count as the head. Sized to the drawn body, with
// the radius a little wider than it so a shot that grazes the silhouette still lands. Movement
// ignores it: every avatar walks, steps and fits through doors with the same body (sim/player.ts).
export interface Hitbox {
  top: number;
  radius: number;
  head: number;
}

export interface AvatarSpec {
  id: AvatarId;
  nameTag: string | null; // a name containing this spawns with the avatar
  blurb: string; // one plain line for the commands menu
  wearable: boolean; // people can switch to it by chat command (and the menu lists it)
  hitbox: Hitbox;
}

export const AVATARS: Record<AvatarId, AvatarSpec> = {
  standard: {
    id: 'standard',
    nameTag: null,
    blurb: 'back to your normal self',
    wearable: true,
    hitbox: { top: 2.0, radius: 0.55, head: 0.5 },
  },
  elizabeth: {
    id: 'elizabeth',
    nameTag: 'ELIZABETH',
    blurb: 'become elizabeth from gintama',
    wearable: true,
    hitbox: { top: 2.0, radius: 0.75, head: 0.55 }, // the egg is 1.24 m across, flippers out past that
  },
  sahur: {
    id: 'sahur',
    nameTag: null,
    blurb: 'tung tung tung sahur, for bots only',
    wearable: false,
    hitbox: { top: 3.2, radius: 0.55, head: 0.95 }, // a 0.7 m log; the head is the face, chin up
  },
};

export const AVATAR_IDS = Object.keys(AVATARS) as AvatarId[];

export function isAvatarId(v: unknown): v is AvatarId {
  return typeof v === 'string' && v in AVATARS;
}

// An avatar a person can switch to with its chat command.
export function isWearableAvatar(v: unknown): v is AvatarId {
  return isAvatarId(v) && AVATARS[v].wearable;
}

// The avatar a name asks for, else the standard one.
export function avatarFor(name: string): AvatarId {
  for (const id of AVATAR_IDS) {
    const tag = AVATARS[id].nameTag;
    if (tag && name.includes(tag)) return id;
  }
  return 'standard';
}
