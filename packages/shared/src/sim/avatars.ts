// Avatar types: how a player looks. Purely cosmetic; movement, hit capsule and items are the
// same for all of them. The chat command switches for good; a name containing an avatar's tag
// spawns as it and can't switch at all. A bot can also ask for any avatar when it joins
// (BotPlacement), including the ones people can't wear. Adding one means a row here and a builder
// in the client's render/avatars/.
export type AvatarId = 'standard' | 'elizabeth' | 'sahur';

export interface AvatarSpec {
  id: AvatarId;
  nameTag: string | null; // a name containing this spawns with the avatar
  blurb: string; // one plain line for the commands menu
  wearable: boolean; // people can switch to it by chat command (and the menu lists it)
}

export const AVATARS: Record<AvatarId, AvatarSpec> = {
  standard: { id: 'standard', nameTag: null, blurb: 'back to your normal self', wearable: true },
  elizabeth: { id: 'elizabeth', nameTag: 'ELIZABETH', blurb: 'become elizabeth from gintama', wearable: true },
  sahur: { id: 'sahur', nameTag: null, blurb: 'tung tung tung sahur, for bots only', wearable: false },
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
