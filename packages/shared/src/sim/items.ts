// Equippable items. One at a time, on a timer, unless the player's name carries an item's tag,
// in which case they spawn holding it for good and can never swap. Adding a weapon means adding
// a row here, a chat command alias, and a shape in the client's Weapons.ts.
export type ItemId = 'gun' | 'sniper';

// Things an item can do, each bound to a key the client listens for (a letter, as in KeyK).
export type ItemAction = 'shoot' | 'scope';

export interface ItemSpec {
  id: ItemId;
  seconds: number; // how long a chat-command equip lasts
  range: number; // metres a shot can reach
  cooldownTicks: number;
  actions: Partial<Record<ItemAction, string>>; // action -> key letter
  nameTag: string; // a name containing this spawns with the item permanently
}

export const ITEMS: Record<ItemId, ItemSpec> = {
  gun: { id: 'gun', seconds: 30, range: 20, cooldownTicks: 10, actions: { shoot: 'K' }, nameTag: 'GUN' },
  sniper: { id: 'sniper', seconds: 30, range: 150, cooldownTicks: 30, actions: { shoot: 'K', scope: 'F' }, nameTag: 'SNIPER' },
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

// "K to shoot, F to scope", for hints and chat notices.
export function itemHelp(id: ItemId, sep = ', '): string {
  return Object.entries(ITEMS[id].actions).map(([action, key]) => `${key} to ${action}`).join(sep);
}

// Which of the item's actions a key press means, if any.
export function actionForKey(id: ItemId, code: string): ItemAction | null {
  for (const [action, key] of Object.entries(ITEMS[id].actions)) if (code === `Key${key}`) return action as ItemAction;
  return null;
}

export function holding(item: ItemState | null, id?: ItemId): item is ItemState {
  return item !== null && (id === undefined || item.id === id);
}
