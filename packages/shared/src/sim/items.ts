// Weapons: the items a player holds. One at a time; chat commands swap freely unless the player's
// name carries a weapon's tag, in which case they spawn holding it for good and can never swap. A
// look may come with one of its own instead (AvatarSpec.item: a dragon's breath), held for good
// while it's worn. Gear (sim/gear.ts) is the other kind of item, worn in its own slot beside the
// weapon. Adding a weapon means adding a row here, a shape in the client's Weapons.ts, and nothing
// on the wire: every item action travels inside the input frame.
import { TICK_RATE } from './constants';
import { HEADSHOT_MULTIPLIER } from './health';

export type ItemId = 'gun' | 'sniper' | 'flamethrower' | 'firebreath';

// Things an item, or a player's class (classes.ts), can do. Each is bound to a key on the client and
// reported in InputFrame.actions:
//   tap     fires on the press (the first tick the action is held), then the cooldown
//   hold    works while held, burning fuel: a flamethrower fires every cooldown, a jetpack pushes every tick
//   toggle  a state the client flips and reports while on (the sniper's scope)
export type ItemAction = 'shoot' | 'scope' | 'thrust' | 'roar-1' | 'roar-2' | 'roar-3';
export type ActionMode = 'tap' | 'hold' | 'toggle';

export interface ActionSpec {
  key: string; // KeyboardEvent code
  mode: ActionMode;
}

// How a shot finds its targets. hitscan: one ray, nearest player, headshots count. cone: every
// player inside the cone, flat damage.
export type FireShape = { kind: 'hitscan' } | { kind: 'cone'; halfAngle: number };

// What a hold weapon sprays, for the client's jet: the same sprites in another element's colours.
export type Element = 'fire';

export interface ItemSpec {
  id: ItemId;
  range: number; // metres a shot can reach
  damage: number; // hearts a hit takes; hitscan headshots multiply it (health.ts)
  cooldownTicks: number; // between shots, or between damage ticks while holding
  actions: Partial<Record<ItemAction, ActionSpec>>;
  fire: FireShape;
  element: Element | null; // what it sprays; null for bullets
  fireNeedsScope: boolean; // can only shoot while scoped
  fuelSeconds: number | null; // hold items: seconds of continuous fire from full; refills at FUEL_REFILL_RATE
  nameTag: string | null; // a name containing this spawns holding the item, locked in hand
  own: boolean; // a look's own (a dragon's breath): never drawn by command, tagged, listed or shown in a hand
  blurb: string; // one plain line for the commands menu
}

export const ITEMS: Record<ItemId, ItemSpec> = {
  gun: {
    id: 'gun',
    range: 20,
    damage: 2,
    cooldownTicks: 7,
    actions: { shoot: { key: 'KeyK', mode: 'tap' } },
    fire: { kind: 'hitscan' },
    element: null,
    fireNeedsScope: false,
    fuelSeconds: null,
    nameTag: 'GUN',
    own: false,
    blurb: 'equip a handgun',
  },
  sniper: {
    id: 'sniper',
    range: 500,
    damage: 4,
    cooldownTicks: 30,
    actions: { shoot: { key: 'KeyK', mode: 'tap' }, scope: { key: 'KeyF', mode: 'toggle' } },
    fire: { kind: 'hitscan' },
    element: null,
    fireNeedsScope: true,
    fuelSeconds: null,
    nameTag: 'SNIPER',
    own: false,
    blurb: 'equip a sniper rifle',
  },
  flamethrower: {
    id: 'flamethrower',
    range: 20,
    damage: 0.5,
    cooldownTicks: 5,
    actions: { shoot: { key: 'KeyK', mode: 'hold' } },
    fire: { kind: 'cone', halfAngle: Math.PI / 8 },
    element: 'fire',
    fireNeedsScope: false,
    fuelSeconds: 7.5,
    nameTag: 'FLAMETHROWER',
    own: false,
    blurb: 'equip a flamethrower',
  },
  // A dragon's: the flamethrower's burn and tank from a mouth, in a cone four times as wide.
  firebreath: {
    id: 'firebreath',
    range: 20,
    damage: 0.5,
    cooldownTicks: 5,
    actions: { shoot: { key: 'KeyK', mode: 'hold' } },
    fire: { kind: 'cone', halfAngle: Math.PI / 4 },
    element: 'fire',
    fireNeedsScope: false,
    fuelSeconds: 7.5,
    nameTag: null,
    own: true,
    blurb: 'breathe fire',
  },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const FUEL_REFILL_RATE = 7.5 / 25; // of the burn rate: a 7.5 s tank takes 25 s to refill

// What a player is holding, until they draw another or die. `locked` (a name tag's item) can't be
// put down; `fuel` is seconds of fire left for hold items, null otherwise.
export interface ItemState {
  id: ItemId;
  locked: boolean;
  fuel: number | null;
}

export function createItem(id: ItemId, locked: boolean): ItemState {
  return { id, locked, fuel: ITEMS[id].fuelSeconds };
}

export function isItemId(v: unknown): v is ItemId {
  return typeof v === 'string' && Object.hasOwn(ITEMS, v);
}

export function isItemAction(v: unknown): v is ItemAction {
  return v === 'shoot' || v === 'scope' || v === 'thrust' || v === 'roar-1' || v === 'roar-2' || v === 'roar-3';
}

// A tank after `dt` seconds: down while `burning`, back up at FUEL_REFILL_RATE of the burn rate
// while `refilling`, kept between empty and `full` (float slop near empty counts as empty).
export function nextFuel(fuel: number, full: number, burning: boolean, refilling: boolean, dt: number): number {
  const next = burning ? fuel - dt : refilling ? Math.min(full, fuel + dt * FUEL_REFILL_RATE) : fuel;
  return next < 1e-9 ? 0 : next;
}

// The item a name entitles its owner to for the whole session, if any. Longer tags win so a
// name like "SNIPERGUN" is a sniper, not a gun.
export function lockedItemFor(name: string): ItemId | null {
  const tags = ITEM_IDS.flatMap((id) => (ITEMS[id].nameTag === null ? [] : [{ id, tag: ITEMS[id].nameTag }]));
  const matches = tags.filter(({ tag }) => name.includes(tag));
  matches.sort((a, b) => b.tag.length - a.tag.length);
  return matches[0]?.id ?? null;
}

// "K or click to shoot, F to scope", for hints and chat notices. Shooting also works with a
// click, so say so; hold items say hold.
export function itemHelp(id: ItemId, sep = ', '): string {
  return actionHelp(ITEMS[id].actions, sep);
}

// The same for any set of actions, naming each key with `keyName`; keys that do the same thing go
// together ("A, S, D to roar").
export function actionHelp(
  actions: Partial<Record<ItemAction, ActionSpec>>,
  sep = ', ',
  keyName: (code: string) => string = keyLabel,
): string {
  const keys = new Map<string, string[]>();
  for (const [action, spec] of Object.entries(actions)) {
    const phrase = `${spec.mode === 'hold' ? 'hold ' : ''}%${ACTION_HELP[action as ItemAction](spec)}`;
    keys.set(phrase, [...(keys.get(phrase) ?? []), keyName(spec.key)]);
  }
  return [...keys].map(([phrase, named]) => phrase.replace('%', named.join(', '))).join(sep);
}

// What follows the key in actionHelp.
const ACTION_HELP: Record<ItemAction, (spec: ActionSpec) => string> = {
  shoot: (spec) => ` or click to ${spec.mode === 'hold' ? 'spray' : 'shoot'}`,
  scope: () => ' to scope',
  thrust: () => ' to fly',
  'roar-1': () => ' to roar',
  'roar-2': () => ' to roar',
  'roar-3': () => ' to roar',
};

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
