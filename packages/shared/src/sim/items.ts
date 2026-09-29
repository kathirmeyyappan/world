// Equippable items. One at a time; chat commands swap freely unless the player's name carries an
// item's tag, in which case they spawn holding it for good and can never swap. Adding a weapon
// means adding a row here, a shape in the client's Weapons.ts, and nothing on the wire: every
// item action travels inside the input frame.
import { TICK_RATE } from './constants';
import { HEADSHOT_MULTIPLIER } from './health';

export type ItemId = 'gun' | 'sniper' | 'flamethrower';

// Things an item can do. Each is bound to a key on the client and reported in InputFrame.actions:
//   tap     fires on the press (the first tick the action is held), then the cooldown
//   hold    fires every cooldown while held, burning fuel
//   toggle  a state the client flips and reports while on (the sniper's scope)
export type ItemAction = 'shoot' | 'scope';
export type ActionMode = 'tap' | 'hold' | 'toggle';

export interface ActionSpec {
  key: string; // KeyboardEvent code
  mode: ActionMode;
}

// How a shot finds its targets. hitscan: one ray, nearest player, headshots count. cone: every
// player inside the cone, flat damage.
export type FireShape = { kind: 'hitscan' } | { kind: 'cone'; halfAngle: number };

export interface ItemSpec {
  id: ItemId;
  seconds: number; // how long a chat-command equip lasts
  range: number; // metres a shot can reach
  damage: number; // hearts a hit takes; hitscan headshots multiply it (health.ts)
  cooldownTicks: number; // between shots, or between damage ticks while holding
  actions: Partial<Record<ItemAction, ActionSpec>>;
  fire: FireShape;
  fireNeedsScope: boolean; // can only shoot while scoped
  fuelSeconds: number | null; // hold items: seconds of continuous fire from full; refills at FUEL_REFILL_RATE
  nameTag: string; // a name containing this spawns with the item permanently
  blurb: string; // one plain line for the commands menu
}

export const ITEMS: Record<ItemId, ItemSpec> = {
  gun: {
    id: 'gun',
    seconds: 45,
    range: 20,
    damage: 2,
    cooldownTicks: 7,
    actions: { shoot: { key: 'KeyK', mode: 'tap' } },
    fire: { kind: 'hitscan' },
    fireNeedsScope: false,
    fuelSeconds: null,
    nameTag: 'GUN',
    blurb: 'equip a handgun',
  },
  sniper: {
    id: 'sniper',
    seconds: 45,
    range: 500,
    damage: 4,
    cooldownTicks: 30,
    actions: { shoot: { key: 'KeyK', mode: 'tap' }, scope: { key: 'KeyF', mode: 'toggle' } },
    fire: { kind: 'hitscan' },
    fireNeedsScope: true,
    fuelSeconds: null,
    nameTag: 'SNIPER',
    blurb: 'equip a sniper rifle',
  },
  flamethrower: {
    id: 'flamethrower',
    seconds: 45,
    range: 10,
    damage: 0.5,
    cooldownTicks: 15,
    actions: { shoot: { key: 'KeyK', mode: 'hold' } },
    fire: { kind: 'cone', halfAngle: Math.PI / 8 },
    fireNeedsScope: false,
    fuelSeconds: 7.5,
    nameTag: 'FLAMETHROWER',
    blurb: 'equip a flamethrower',
  },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const FUEL_REFILL_RATE = 7.5 / 25; // of the burn rate: a 7.5 s tank takes 25 s to refill

// What a player is holding. `left` counts down in the sim unless `permanent`; `fuel` is seconds
// of fire left for hold items, null otherwise.
export interface ItemState {
  id: ItemId;
  left: number;
  permanent: boolean;
  fuel: number | null;
}

export function createItem(id: ItemId, permanent: boolean): ItemState {
  const spec = ITEMS[id];
  return { id, left: permanent ? 0 : spec.seconds, permanent, fuel: spec.fuelSeconds };
}

export function isItemId(v: unknown): v is ItemId {
  return typeof v === 'string' && v in ITEMS;
}

export function isItemAction(v: unknown): v is ItemAction {
  return v === 'shoot' || v === 'scope';
}

// The item a name entitles its owner to for the whole session, if any. Longer tags win so a
// name like "SNIPERGUN" is a sniper, not a gun.
export function permanentItemFor(name: string): ItemId | null {
  const matches = ITEM_IDS.filter((id) => name.includes(ITEMS[id].nameTag));
  matches.sort((a, b) => ITEMS[b].nameTag.length - ITEMS[a].nameTag.length);
  return matches[0] ?? null;
}

// "K or click to shoot, F to scope", for hints and chat notices. Shooting also works with a
// click, so say so; hold items say hold.
export function itemHelp(id: ItemId, sep = ', '): string {
  return Object.entries(ITEMS[id].actions)
    .map(
      ([action, spec]) =>
        `${spec.mode === 'hold' ? 'hold ' : ''}${keyLabel(spec.key)}${action === 'shoot' ? ' or click' : ''} to ${action === 'shoot' && spec.mode === 'hold' ? 'spray' : action}`,
    )
    .join(sep);
}

// "range: 20m, dmg: 2 (headshot 2.5x)" or "range: 10m, dps: 1": the numbers that matter, for
// the hint bar. Derived from the spec so it can't drift from what the Room does.
export function itemStats(id: ItemId): string {
  const spec = ITEMS[id];
  const parts = [`range: ${spec.range}m`];
  if (spec.actions.shoot?.mode === 'hold') parts.push(`dps: ${round((spec.damage * TICK_RATE) / spec.cooldownTicks)}`);
  else parts.push(`dmg: ${spec.damage}${spec.fire.kind === 'hitscan' ? ` (headshot ${HEADSHOT_MULTIPLIER}x)` : ''}`);
  return parts.join(', ');
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// Which of the item's actions a key press means, if any.
export function actionForKey(id: ItemId, code: string): ItemAction | null {
  for (const [action, spec] of Object.entries(ITEMS[id].actions)) if (code === spec.key) return action as ItemAction;
  return null;
}

function keyLabel(code: string): string {
  return code.replace(/^Key/, '').toUpperCase();
}

export function holding(item: ItemState | null, id?: ItemId): item is ItemState {
  return item !== null && (id === undefined || item.id === id);
}
