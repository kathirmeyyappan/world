// Gear: things a player wears rather than wields. Gear has its own slot beside the weapon
// (sim/items.ts), so someone can wear a jetpack and carry a gun at once; each slot is equipped,
// timed and fuelled on its own. Adding gear means a row here, its effect in stepGear, and a shape
// in the client's render/Gear.ts. Like weapons, nothing extra goes on the wire: its action rides
// in the input frame and its state in the player's.
import { actionHelp, nextFuel, type ActionSpec, type ItemAction } from './items';

export type GearId = 'jetpack';

export interface GearSpec {
  id: GearId;
  seconds: number; // how long a chat-command equip lasts
  actions: Partial<Record<ItemAction, ActionSpec>>; // hold actions, reported in InputFrame.actions
  fuelSeconds: number; // seconds of use from full; refills only on the ground
  lift: number; // upward acceleration while in use and not falling, m/s², against GRAVITY
  brake: number; // m/s², against GRAVITY, while falling: catches a fall fast but never pushes up
  maxRise: number; // m/s: the lift stops adding speed past this
  blurb: string; // one plain line for the commands menu
}

export const GEAR: Record<GearId, GearSpec> = {
  jetpack: {
    id: 'jetpack',
    seconds: 45,
    actions: { thrust: { key: 'Space', mode: 'hold' } }, // the jump key: jump, then keep holding
    fuelSeconds: 8,
    lift: 34,
    brake: 90,
    maxRise: 9,
    blurb: 'strap on a jetpack; hold jump to fly',
  },
};

export const GEAR_IDS = Object.keys(GEAR) as GearId[];

// What a player is wearing: `left` seconds until it comes off, `fuel` seconds of use left.
export interface GearState {
  id: GearId;
  left: number;
  fuel: number;
}

export function createGear(id: GearId): GearState {
  const spec = GEAR[id];
  return { id, left: spec.seconds, fuel: spec.fuelSeconds };
}

export function isGearId(v: unknown): v is GearId {
  return typeof v === 'string' && v in GEAR;
}

// What the gear pushes with this tick (sim/player.ts applies it through `thrust`).
export type Push = Pick<GearSpec, 'lift' | 'brake' | 'maxRise'>;

// One tick of the player's gear. Returns its push (null for none) and sets `thrusting` while the
// action is held and there's fuel.
export function stepGear(
  p: { gear: GearState | null; thrusting: boolean; dead: boolean },
  actions: readonly ItemAction[],
  grounded: boolean,
  dt: number,
): Push | null {
  const gear = p.gear;
  p.thrusting = false;
  if (!gear) return null;
  gear.left -= dt;
  if (gear.left <= 0) {
    p.gear = null;
    return null;
  }
  const spec = GEAR[gear.id];
  const wants = !p.dead && !!spec.actions.thrust && actions.includes('thrust') && gear.fuel > 0;
  gear.fuel = nextFuel(gear.fuel, spec.fuelSeconds, wants, grounded && !wants, dt);
  p.thrusting = wants && gear.fuel > 0;
  return p.thrusting ? spec : null;
}

// The vertical speed after `dt` of `push`, on top of the gravity already in `vy`: a fall is cancelled
// at the brake, never past a standstill, and the rest of the tick climbs at the lift, up to maxRise.
// A climb faster than that is left alone.
export function thrust(vy: number, push: Push, dt: number): number {
  let climb = dt;
  if (vy < 0) {
    const stop = -vy / push.brake;
    if (stop >= dt) return vy + push.brake * dt;
    vy = 0;
    climb = dt - stop;
  }
  return Math.max(vy, Math.min(push.maxRise, vy + push.lift * climb));
}

// "hold SPACE to fly", for hints and chat notices; `keyName` words a key code another way.
export function gearHelp(id: GearId, keyName?: (code: string) => string): string {
  return actionHelp(GEAR[id].actions, ', ', keyName);
}
