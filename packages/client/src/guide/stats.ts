// The guide's numbers, read off the registries the game runs on (AVATARS, ITEMS, GEAR, PICKUPS and
// the constants), so a change to the game is a change here with no one remembering to make it.
// Everything is worked out the way the sim does it: a spray's damage a second from its damage a tick
// and how often it ticks.
import {
  AVATARS,
  BOT_DEFAULT_SECONDS,
  BOT_FLAGS,
  BOT_FLAG_IDS,
  BOT_MAX_SECONDS,
  CHILL_SECONDS,
  CHILLED_SPEED_MULTIPLIER,
  FUEL_REFILL_RATE,
  GEAR,
  GRAVITY,
  HEADSHOT_MULTIPLIER,
  ITEMS,
  JUMP_RISE,
  PICKUPS,
  PICKUP_AREAS,
  REGEN_RATE,
  RUN_MULTIPLIER,
  SCOPED_SPEED_MULTIPLIER,
  SPEEDY_MULTIPLIER,
  SPEEDY_SECONDS,
  TICK_RATE,
  climbSpeedOf,
  dragonShape,
  jumpVelocityOf,
  leapOf,
  lifeOf,
  walkSpeedOf,
  type AvatarId,
  type BotFlag,
  type BotWorker,
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

export function characterStats(id: AvatarId): Stat[] {
  const look = AVATARS[id];
  const life = lifeOf(id);
  const rows: Stat[] = [];
  if (look.command) rows.push({ label: 'Equip', value: `/${look.command}` });
  rows.push({ label: life.sprite === 'crystal' ? 'Crystals' : 'Hearts', value: num(life.hearts) });
  if (look.regen) rows.push({ label: 'Regen', value: `${num(REGEN_RATE)} hearts/s` });
  if (look.class === 'walker') {
    rows.push(
      { label: 'Height', value: `${num(look.hitbox.top)} m` },
      { label: 'Eye height', value: `${num(look.eye)} m` },
      { label: 'Walk', value: `${num(walkSpeedOf(id))} m/s` },
      { label: 'Jump power', value: num(look.jump) },
      { label: 'Ladder climb', value: `${num(climbSpeedOf(id))} m/s` },
      { label: 'Hitbox width', value: `${num(2 * look.hitbox.radius)} m` },
      { label: 'Head hitbox', value: `${num(look.hitbox.head)} m` },
    );
  } else {
    const shape = dragonShape(id);
    rows.push(
      { label: 'Length', value: `${num(shape.links.reduce((a, b) => a + b, 0))} m` },
      { label: 'Cruise', value: `${num(shape.cruise)} m/s` },
      { label: 'Turning radius', value: `${num(shape.turnRadius)} m` },
    );
  }
  return rows;
}

// What a character can do that the rest can't, each with its own numbers.
export type AbilityId = 'leap';

// A character's special abilities, read off its row: none for most.
export function abilityStats(id: AvatarId): { id: AbilityId; stats: Stat[] }[] {
  const leap = leapOf(id);
  if (!leap) return [];
  // The long jump as walker.ts flies it: up at a share of the jump under a share of gravity, across
  // at a multiple of the run, for as long as that keeps it in the air.
  const speed = walkSpeedOf(id) * RUN_MULTIPLIER * leap.speed;
  const up = jumpVelocityOf(id) * Math.sqrt(leap.rise * leap.float);
  const seconds = (2 * up) / (GRAVITY * leap.float);
  const jump = AVATARS[id];
  return [
    {
      id: 'leap',
      stats: [
        { label: 'Use', value: 'Shift + Space, moving' },
        { label: 'Distance', value: `${num(speed * seconds)} m` },
        { label: 'Height', value: `${num(JUMP_RISE * (jump.class === 'walker' ? jump.jump : 1) * leap.rise)} m` },
        { label: 'Speed', value: `${num(speed)} m/s` },
      ],
    },
  ];
}

export function itemStats(id: ItemId): Stat[] {
  const spec = ITEMS[id];
  const perSecond = TICK_RATE / spec.cooldownTicks;
  const rows: Stat[] = [];
  // A dragon's breath comes with its look, and that look's command is how to get it.
  const owner = (Object.keys(AVATARS) as AvatarId[]).find((a) => AVATARS[a].item === id);
  const command = spec.own && owner ? AVATARS[owner].command : id;
  if (command) rows.push({ label: 'Equip', value: `/${command}` });
  if (spec.actions.scope?.key)
    rows.push(
      { label: 'Scope', value: keyName(spec.actions.scope.key) },
      { label: 'Scoped walk', value: `${num(SCOPED_SPEED_MULTIPLIER * 100)}%` },
    );
  if (spec.actions.shoot?.mode === 'hold') {
    rows.push({ label: 'Damage', value: `${num(spec.damage * perSecond)} hearts/s` });
  } else {
    rows.push(
      { label: 'Damage', value: `${num(spec.damage)} hearts` },
      { label: 'Headshot', value: `${num(spec.damage * HEADSHOT_MULTIPLIER)} hearts` },
      { label: 'Fire rate', value: `${num(perSecond)}/s` },
      { label: 'DPS', value: `${num(spec.damage * perSecond)} hearts/s` },
    );
  }
  rows.push({ label: 'Range', value: `${num(spec.range)} m` });
  if (spec.fire.kind === 'cone')
    rows.push({ label: 'Spray cone', value: `${num((2 * spec.fire.halfAngle * 180) / Math.PI)}°` });
  if (spec.fuelSeconds !== null)
    rows.push(
      { label: 'Tank', value: `${num(spec.fuelSeconds)} s` },
      { label: 'Refill', value: `${num(spec.fuelSeconds / FUEL_REFILL_RATE)} s` },
    );
  if (spec.element === 'ice')
    rows.push(
      { label: 'Chill', value: `${num(CHILL_SECONDS)} s` },
      { label: 'Chilled walk', value: `${num(CHILLED_SPEED_MULTIPLIER * 100)}%` },
    );
  return rows;
}

export function gearStats(id: GearId): Stat[] {
  const spec = GEAR[id];
  const thrust = spec.actions.thrust?.key;
  return [
    { label: 'Equip', value: `/${id}` },
    ...(thrust ? [{ label: 'Thrust', value: keyName(thrust) }] : []),
    { label: 'Lasts', value: `${num(spec.seconds)} s` },
    { label: 'Fuel', value: `${num(spec.fuelSeconds)} s` },
    { label: 'Lift', value: `${num(spec.lift - GRAVITY)} m/s²` },
    { label: 'Max rise', value: `${num(spec.maxRise)} m/s` },
    { label: 'Brake', value: `${num(spec.brake - GRAVITY)} m/s²` },
  ];
}

export function pickupStats(kind: PickupKind): Stat[] {
  const heals = PICKUPS[kind].heals;
  // A full life's worth, on foot, where a pickup heals everything.
  const hearts = heals === Infinity ? lifeOf('standard').hearts : heals;
  const rows: Stat[] = [{ label: 'Heals', value: `${num(hearts)} hearts` }];
  const areas = PICKUP_AREAS.filter((a) => a.kind === kind);
  if (areas.length > 0)
    rows.push(
      { label: 'In the world', value: `${areas.reduce((n, a) => n + a.count, 0)}` },
      { label: 'Respawn', value: `${num(Math.max(...areas.map((a) => a.respawnSeconds)))} s` },
    );
  return rows;
}

export function speedyStats(): Stat[] {
  return [
    { label: 'Equip', value: '/speedy' },
    { label: 'Speed', value: `×${num(SPEEDY_MULTIPLIER)}` },
    { label: 'Lasts', value: `${num(SPEEDY_SECONDS)} s` },
  ];
}

// The flags a bot on `worker` takes, each with what it does and the defaults the parser applies.
export function botFlagRows(worker: BotWorker, text: Record<BotFlag, string>): Stat[] {
  return BOT_FLAG_IDS.filter((f) => BOT_FLAGS[f].workers.includes(worker)).map((f) => {
    const flag = BOT_FLAGS[f];
    const forms = [flag.short, flag.long].filter((s) => s !== null).join(', ');
    const extra = f === 'time' ? `; ${num(BOT_DEFAULT_SECONDS)} unless given, up to ${num(BOT_MAX_SECONDS)}` : '';
    return { label: `${forms} [${flag.value}]`, value: `${text[f]}${extra}` };
  });
}
