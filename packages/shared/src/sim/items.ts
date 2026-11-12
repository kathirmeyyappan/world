// Weapons: the items a player holds. One at a time; chat commands swap freely, except that a look
// may come with one of its own (AvatarSpec.item: a dragon's breath), held for good while it's worn.
// Gear (sim/gear.ts) is the other kind of item, worn in its own slot beside the weapon. Adding a weapon means adding a row here, a shape in the client's Weapons.ts (a hold weapon
// with an element gets a tank and a jet in that element's colours too), a sound in the client's
// ITEM_SOUNDS, and nothing on the wire: every item action travels inside the input frame.
import { CHILL_SECONDS, TICK_RATE } from './constants';
import { HEADSHOT_MULTIPLIER } from './health';

export type ItemId = 'gun' | 'sniper' | 'flamethrower' | 'ice-blower' | 'firebreath' | 'frostbreath';

// Things an item, or a player's class (classes.ts), can do. Each is bound to a key on the client and
// reported in InputFrame.actions:
//   tap     fires on the press (the first tick the action is held), then the cooldown
//   hold    works while held, burning fuel: a flamethrower fires every cooldown, a jetpack pushes every tick
//   toggle  a state the client flips and reports while on (the sniper's scope)
// The swaps are a climber's, not an item's: a tap on A or D on a ladder (the touch SWAP button is
// A's), to go round to its other face by its left or its right (walker.ts).
export type ItemAction = 'shoot' | 'scope' | 'thrust' | 'roar-1' | 'roar-2' | 'roar-3' | 'swap-left' | 'swap-right';
export type ActionMode = 'tap' | 'hold' | 'toggle';

export interface ActionSpec {
  key: string | null; // KeyboardEvent code; null for a shot, which is a click (the touch FIRE button)
  mode: ActionMode;
}

// How a shot finds its targets. hitscan: one ray, nearest player, headshots count. cone: every
// player inside the cone, flat damage.
export type FireShape = { kind: 'hitscan' } | { kind: 'cone'; halfAngle: number };

// What a hold weapon sprays: the client's jet in the element's colours, and what a hit does besides
// its damage (ice chills, constants.ts).
export type Element = 'fire' | 'ice';

export interface ItemSpec {
  id: ItemId;
  name: string; // what the hint calls it
  range: number; // metres a shot can reach
  damage: number; // hearts a hit takes; hitscan headshots multiply it (health.ts)
  cooldownTicks: number; // between shots, or between damage ticks while holding
  actions: Partial<Record<ItemAction, ActionSpec>>;
  fire: FireShape;
  element: Element | null; // what it sprays; null for bullets
  shatters: boolean; // whether a hit of it shatters a dragon's crystal (dragon.ts hurt): a bullet does, a spray washes over one
  fireNeedsScope: boolean; // can only shoot while scoped
  fuelSeconds: number | null; // hold items: seconds of continuous fire from full; refills at FUEL_REFILL_RATE
  own: boolean; // a look's own (a dragon's breath): never drawn by command, tagged, listed or shown in a hand
  blurb: string; // one plain line for the commands menu
}

export const ITEMS: Record<ItemId, ItemSpec> = {
  gun: {
    id: 'gun',
    name: 'gun',
    range: 20,
    damage: 2,
    cooldownTicks: 7,
    actions: { shoot: { key: null, mode: 'tap' } },
    fire: { kind: 'hitscan' },
    element: null,
    shatters: true,
    fireNeedsScope: false,
    fuelSeconds: null,
    own: false,
    blurb: 'equip a handgun',
  },
  sniper: {
    id: 'sniper',
    name: 'sniper',
    range: 500,
    damage: 4,
    cooldownTicks: 30,
    actions: { shoot: { key: null, mode: 'tap' }, scope: { key: 'KeyF', mode: 'toggle' } },
    fire: { kind: 'hitscan' },
    element: null,
    shatters: true,
    fireNeedsScope: true,
    fuelSeconds: null,
    own: false,
    blurb: 'equip a sniper rifle',
  },
  flamethrower: {
    id: 'flamethrower',
    name: 'flamethrower',
    range: 20,
    damage: 0.5,
    cooldownTicks: 5,
    actions: { shoot: { key: null, mode: 'hold' } },
    fire: { kind: 'cone', halfAngle: Math.PI / 8 },
    element: 'fire',
    shatters: false,
    fireNeedsScope: false,
    fuelSeconds: 7.5,
    own: false,
    blurb: 'equip a flamethrower',
  },
  // The flamethrower's twin, spraying ice at half its burn: a touch also chills for CHILL_SECONDS
  // (constants.ts).
  'ice-blower': {
    id: 'ice-blower',
    name: 'ice blower',
    range: 20,
    damage: 0.25,
    cooldownTicks: 5,
    actions: { shoot: { key: null, mode: 'hold' } },
    fire: { kind: 'cone', halfAngle: Math.PI / 8 },
    element: 'ice',
    shatters: false,
    fireNeedsScope: false,
    fuelSeconds: 7.5,
    own: false,
    blurb: 'equip an ice blower',
  },
  // A dragon's: the flamethrower's burn and tank from a mouth, in a cone four times as wide.
  firebreath: {
    id: 'firebreath',
    name: 'fire breath',
    range: 30,
    damage: 0.5,
    cooldownTicks: 5,
    actions: { shoot: { key: null, mode: 'hold' } },
    fire: { kind: 'cone', halfAngle: Math.PI / 5 },
    element: 'fire',
    shatters: false,
    fireNeedsScope: false,
    fuelSeconds: 7.5,
    own: true,
    blurb: 'breathe fire',
  },
  // Colgera's: the ice blower's chill from a mouth, in the firebreath's cone.
  frostbreath: {
    id: 'frostbreath',
    name: 'frost breath',
    range: 30,
    damage: 0.5,
    cooldownTicks: 5,
    actions: { shoot: { key: null, mode: 'hold' } },
    fire: { kind: 'cone', halfAngle: Math.PI / 5 },
    element: 'ice',
    shatters: false,
    fireNeedsScope: false,
    fuelSeconds: 7.5,
    own: true,
    blurb: 'breathe frost',
  },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const FUEL_REFILL_RATE = 7.5 / 25; // of the burn rate: a 7.5 s tank takes 25 s to refill

// What a player is holding, until they draw another or die. `locked` (a look's own item) can't be
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
  return (
    v === 'shoot' ||
    v === 'scope' ||
    v === 'thrust' ||
    v === 'roar-1' ||
    v === 'roar-2' ||
    v === 'roar-3' ||
    v === 'swap-left' ||
    v === 'swap-right'
  );
}

// A tank after `dt` seconds: down while `burning`, back up at FUEL_REFILL_RATE of the burn rate
// while `refilling`, kept between empty and `full` (float slop near empty counts as empty).
export function nextFuel(fuel: number, full: number, burning: boolean, refilling: boolean, dt: number): number {
  const next = burning ? fuel - dt : refilling ? Math.min(full, fuel + dt * FUEL_REFILL_RATE) : fuel;
  return next < 1e-9 ? 0 : next;
}

// "click to shoot, F to scope", for hints and chat notices: a shot is a click, the rest name their
// keys, and a key that's held says hold.
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
    const phrase = `${spec.key !== null && spec.mode === 'hold' ? 'hold ' : ''}${ACTION_HELP[action as ItemAction](spec)}`;
    keys.set(phrase, [...(keys.get(phrase) ?? []), ...(spec.key === null ? [] : [keyName(spec.key)])]);
  }
  return [...keys].map(([phrase, named]) => phrase.replace('%', named.join(', '))).join(sep);
}

// Each action's help, with `%` where its keys go; a shot has none.
const ACTION_HELP: Record<ItemAction, (spec: ActionSpec) => string> = {
  shoot: (spec) => (spec.mode === 'hold' ? 'click and hold to spray' : 'click to shoot'),
  scope: () => '% to scope',
  thrust: () => '% to fly',
  'roar-1': () => '% to roar',
  'swap-left': () => '% to go round the ladder',
  'swap-right': () => '% to go round the ladder',
  'roar-2': () => '% to roar',
  'roar-3': () => '% to roar',
};

// "range: 20m, dmg: 2 (headshot 2.5x)" or "range: 10m, dps: 1, chills 5s": the numbers that
// matter, for the hint bar. Derived from the spec so it can't drift from what the Room does.
export function itemStats(id: ItemId): string {
  const spec = ITEMS[id];
  const parts = [`range: ${spec.range}m`];
  if (spec.actions.shoot?.mode === 'hold') parts.push(`dps: ${round((spec.damage * TICK_RATE) / spec.cooldownTicks)}`);
  else parts.push(`dmg: ${spec.damage}${spec.fire.kind === 'hitscan' ? ` (headshot ${HEADSHOT_MULTIPLIER}x)` : ''}`);
  if (spec.element === 'ice') parts.push(`chills ${CHILL_SECONDS}s`);
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
