// The guide's numbers, read off the registries the game runs on (AVATARS, ITEMS, GEAR, PICKUPS and
// the constants), so a change to the game is a change here with no one remembering to make it.
// Everything is worked out the way the sim does it: a jump's rise from its takeoff and gravity, a
// spray's damage a second from its damage a tick and how often it ticks.
import {
  AVATARS,
  BOT_DEFAULT_SECONDS,
  BOT_FLAGS,
  BOT_FLAG_IDS,
  BOT_MAX_SECONDS,
  CHILL_SECONDS,
  CHILLED_SPEED_MULTIPLIER,
  COMMAND_SHORTCUTS,
  CORPSE_DROP,
  FUEL_REFILL_RATE,
  GEAR,
  GRAVITY,
  HEADSHOT_MULTIPLIER,
  ITEMS,
  PICKUPS,
  PICKUP_AREAS,
  REGEN_RATE,
  SCOPED_SPEED_MULTIPLIER,
  SPEEDY_MULTIPLIER,
  SPEEDY_SECONDS,
  TICK_RATE,
  classOf,
  climbSpeedOf,
  dragonShape,
  jumpVelocityOf,
  lifeOf,
  walkSpeedOf,
  type AvatarId,
  type GearId,
  type ItemId,
  type PickupKind,
} from '@world/shared';

export interface Stat {
  label: string;
  value: string;
}

// A number as the guide shows it: at most two decimals, none when it's whole.
export function num(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// A key as a person reads it: KeyF is F.
function keyName(code: string): string {
  return code.startsWith('Key') ? code.slice(3) : code;
}

// The chat commands that do `target` (an item, gear, 'speedy', or an avatar's command word): its own
// and its shortcuts.
export function commandsFor(word: string, target: string = word): string[] {
  const shortcuts = Object.entries(COMMAND_SHORTCUTS).filter(([, t]) => t === target);
  return [`/${word}`, ...shortcuts.map(([s]) => `/${s}`)];
}

function equip(commands: string[], nameTag: string | null): string {
  return commands.join(', ') + (nameTag ? `, or a name with ${nameTag} in it (for good)` : '');
}

export function characterStats(id: AvatarId): Stat[] {
  const look = AVATARS[id];
  const cls = classOf(id);
  const life = lifeOf(id);
  const hearts = `${life.hearts}${life.sprite === 'crystal' ? ' crystals' : ''}`;
  const rows: Stat[] = [];
  if (look.command) rows.push({ label: 'Wear it', value: equip(commandsFor(look.command, id), look.nameTag) });
  rows.push({ label: 'Hearts', value: look.regen ? `${hearts}, back at ${num(REGEN_RATE)} a second` : hearts });
  if (look.class === 'walker') {
    const walk = walkSpeedOf(id);
    const takeoff = jumpVelocityOf(id);
    const rise = takeoff ** 2 / (2 * GRAVITY);
    const air = (2 * takeoff) / GRAVITY;
    rows.push(
      { label: 'Height', value: `${num(look.hitbox.top)} m` },
      { label: 'Eye height', value: `${num(look.eye)} m` },
      { label: 'Walk', value: `${num(walk)} m/s` },
      { label: 'Jump', value: `${num(rise)} m high, ${num(air)} s in the air` },
      { label: 'Running jump', value: `${num(walk * air)} m` },
      { label: 'Ladder climb', value: `${num(climbSpeedOf(id))} m/s` },
      {
        label: 'Target',
        value: `${num(2 * look.hitbox.radius)} m wide; the top ${num(look.hitbox.head)} m is the head`,
      },
    );
  } else {
    const shape = dragonShape(id);
    rows.push(
      { label: 'Length', value: `${num(shape.links.reduce((a, b) => a + b, 0))} m` },
      { label: 'Cruise', value: `${num(shape.cruise)} m/s` },
      { label: 'Tightest turn', value: `${num(shape.turnRadius)} m across` },
    );
    if (shape.weak.length > 0)
      rows.push({
        label: 'Weak points',
        value: `${shape.weak.length}, the only places a hit hurts, and only from below`,
      });
  }
  rows.push({
    label: 'Items',
    value: look.item ? `its own ${ITEMS[look.item].name} only` : cls.kit ? 'any' : 'none',
  });
  rows.push({ label: 'Bots can wear it', value: cls.bots ? 'yes' : 'no' });
  return rows;
}

// The looks that come with an item of their own.
function ownersOf(item: ItemId): AvatarId[] {
  return (Object.keys(AVATARS) as AvatarId[]).filter((id) => AVATARS[id].item === item);
}

export function itemStats(id: ItemId): Stat[] {
  const spec = ITEMS[id];
  const perSecond = TICK_RATE / spec.cooldownTicks;
  const rows: Stat[] = [];
  if (spec.own)
    rows.push({
      label: 'Comes with',
      value: ownersOf(id)
        .map((a) => AVATARS[a].command ?? a)
        .join(', '),
    });
  else rows.push({ label: 'Equip', value: equip(commandsFor(id), spec.nameTag) });
  const hold = spec.actions.shoot?.mode === 'hold';
  rows.push({ label: 'Fire', value: hold ? 'hold click' : 'click' });
  if (spec.actions.scope?.key)
    rows.push({
      label: 'Scope',
      value:
        `${keyName(spec.actions.scope.key)} to scope` +
        (spec.fireNeedsScope ? ', and it only fires scoped' : '') +
        `; scoped, you walk at ${num(SCOPED_SPEED_MULTIPLIER * 100)}% and can't jump`,
    });
  if (hold) {
    rows.push({ label: 'Damage', value: `${num(spec.damage * perSecond)} hearts a second` });
  } else {
    rows.push(
      { label: 'Damage', value: `${num(spec.damage)} hearts a shot` },
      {
        label: 'Headshot',
        value: `${num(spec.damage * HEADSHOT_MULTIPLIER)} hearts (×${num(HEADSHOT_MULTIPLIER)})`,
      },
      {
        label: 'Fire rate',
        value: `${num(perSecond)} a second (${num(spec.cooldownTicks / TICK_RATE)} s between shots)`,
      },
      { label: 'Damage a second', value: `${num(spec.damage * perSecond)} hearts, held on the body` },
    );
  }
  rows.push({ label: 'Range', value: `${num(spec.range)} m` });
  if (spec.fire.kind === 'cone')
    rows.push({
      label: 'Spray',
      value: `a ${num((2 * spec.fire.halfAngle * 180) / Math.PI)}° cone; everyone in it is hit`,
    });
  if (spec.fuelSeconds !== null)
    rows.push({
      label: 'Tank',
      value: `${num(spec.fuelSeconds)} s of spray; empty to full in ${num(spec.fuelSeconds / FUEL_REFILL_RATE)} s`,
    });
  if (spec.element === 'ice')
    rows.push({
      label: 'Effect',
      value: `chills for ${num(CHILL_SECONDS)} s (walk at ${num(CHILLED_SPEED_MULTIPLIER * 100)}%), and frosts what it hits into ice`,
    });
  if (spec.element === 'fire') rows.push({ label: 'Effect', value: 'thaws a chill at once, and melts frost' });
  rows.push({ label: "Colgera's crystals", value: spec.shatters ? 'a hit shatters one' : 'washes over them' });
  return rows;
}

export function gearStats(id: GearId): Stat[] {
  const spec = GEAR[id];
  const thrust = spec.actions.thrust?.key;
  return [
    { label: 'Equip', value: equip(commandsFor(id), null) },
    ...(thrust ? [{ label: 'Use', value: `hold ${keyName(thrust)}` }] : []),
    { label: 'Lasts', value: `${num(spec.seconds)} s` },
    { label: 'Fuel', value: `${num(spec.fuelSeconds)} s of thrust; refills on the ground` },
    { label: 'Lift', value: `${num(spec.lift - GRAVITY)} m/s² upward, rising at most ${num(spec.maxRise)} m/s` },
    { label: 'Brake', value: `${num(spec.brake - GRAVITY)} m/s² against a fall` },
  ];
}

export function pickupStats(kind: PickupKind): Stat[] {
  const heals = PICKUPS[kind].heals;
  const rows: Stat[] = [{ label: 'Heals', value: heals === Infinity ? 'every heart' : `${num(heals)} hearts` }];
  const areas = PICKUP_AREAS.filter((a) => a.kind === kind);
  if (areas.length > 0) {
    const every = [...new Set(areas.map((a) => a.respawnSeconds))].map(num).join(' or ');
    rows.push(
      { label: 'Floating about', value: `${areas.reduce((n, a) => n + a.count, 0)} across the world` },
      { label: 'Comes back', value: `${every} s after it's taken` },
    );
  }
  if (kind === CORPSE_DROP) rows.push({ label: 'Where', value: "left where a dead player's body lay" });
  return rows;
}

export function speedyStats(): Stat[] {
  return [
    { label: 'Equip', value: commandsFor('speedy').join(', ') },
    { label: 'Speed', value: `×${num(SPEEDY_MULTIPLIER)} for ${num(SPEEDY_SECONDS)} s` },
  ];
}

// The flags a bot command takes, with the defaults the parser applies.
export function botFlagRows(): Stat[] {
  return BOT_FLAG_IDS.map((f) => {
    const flag = BOT_FLAGS[f];
    const forms = [flag.short, flag.long].filter((s) => s !== null).join(', ');
    const which = flag.workers.includes('dumb') ? 'all bots' : 'combat bots only';
    const extra = f === 'time' ? `; ${num(BOT_DEFAULT_SECONDS)} unless given, up to ${num(BOT_MAX_SECONDS)}` : '';
    return { label: `${forms} [${flag.value}]`, value: `${which}${extra}` };
  });
}
