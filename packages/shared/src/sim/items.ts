// Equippable items. One at a time, on a timer, unless the player's name carries an item's tag,
// in which case they spawn holding it for good and can never swap. Adding a weapon means adding
// a row here, a chat command alias, and a shape in the client's Weapons.ts.
export type ItemId = 'gun' | 'sniper';

export interface ItemSpec {
  id: ItemId;
  seconds: number; // how long a chat-command equip lasts
  range: number; // metres a shot can reach
  cooldownTicks: number;
  scope: boolean; // can aim down a scope (H)
  nameTag: string; // a name containing this spawns with the item permanently
}

export const ITEMS: Record<ItemId, ItemSpec> = {
  gun: { id: 'gun', seconds: 30, range: 20, cooldownTicks: 10, scope: false, nameTag: 'GUN' },
  sniper: { id: 'sniper', seconds: 30, range: 150, cooldownTicks: 30, scope: true, nameTag: 'SNIPER' },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

// What a player is holding. `left` counts down in the sim unless `permanent`.
export interface ItemState {
  id: ItemId;
  left: number;
  permanent: boolean;
}

export function isItemId(v: unknown): v is ItemId {
  return typeof v === 'string' && v in ITEMS;
}

// The item a name entitles its owner to for the whole session, if any. Longer tags win so a
// name like "SNIPERGUN" is a sniper, not a gun.
export function permanentItemFor(name: string): ItemId | null {
  const matches = ITEM_IDS.filter((id) => name.includes(ITEMS[id].nameTag));
  matches.sort((a, b) => ITEMS[b].nameTag.length - ITEMS[a].nameTag.length);
  return matches[0] ?? null;
}

export function holding(item: ItemState | null, id?: ItemId): item is ItemState {
  return item !== null && (id === undefined || item.id === id);
}
