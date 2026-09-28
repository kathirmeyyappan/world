// Avatar types: how a player looks. Purely cosmetic; movement, hit capsule and items are the
// same for all of them. The chat command switches for good; a name containing an avatar's tag
// spawns as it and can't switch at all. Adding one means a row here and a builder in the
// client's render/avatars/.
export type AvatarId = 'standard' | 'elizabeth';

export interface AvatarSpec {
  id: AvatarId;
  nameTag: string | null; // a name containing this spawns with the avatar
  blurb: string; // one plain line for the commands menu
}

export const AVATARS: Record<AvatarId, AvatarSpec> = {
  standard: { id: 'standard', nameTag: null, blurb: 'back to your normal self' },
  elizabeth: { id: 'elizabeth', nameTag: 'ELIZABETH', blurb: 'become elizabeth from gintama' },
};

export const AVATAR_IDS = Object.keys(AVATARS) as AvatarId[];

export function isAvatarId(v: unknown): v is AvatarId {
  return typeof v === 'string' && v in AVATARS;
}

// The avatar a name asks for, else the standard one.
export function avatarFor(name: string): AvatarId {
  for (const id of AVATAR_IDS) {
    const tag = AVATARS[id].nameTag;
    if (tag && name.includes(tag)) return id;
  }
  return 'standard';
}
