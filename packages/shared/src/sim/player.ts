// A player's tick: the look and item every class shares, then the movement of its class
// (classes.ts). Runs identically on the server (authoritative) and the client (prediction), so it
// must stay pure: no Babylon, no DOM, no time reads.
import { MAX_PITCH } from './constants';
import { AVATARS, avatarFor, type AvatarId } from './avatars';
import { classOf } from './classes';
import type { Structures } from './collision';
import { ITEMS, createItem, nextFuel, lockedItemFor, type ItemState } from './items';
import type { InputFrame, PlayerState, Vec3 } from './types';
import { WORLD_SHAPE, WORLD_STRUCTURES, type WorldPart } from './world';

export function createPlayer(id: string, name: string, color: string, spawn: Vec3, bot = false): PlayerState {
  const avatar = avatarFor(name);
  const p: PlayerState = {
    id,
    name,
    bot,
    color,
    pos: { x: spawn.x, y: spawn.y, z: spawn.z },
    vy: 0,
    yaw: 0,
    pitch: 0,
    lastSeq: 0,
    reading: null,
    boost: 0,
    item: ownItem(avatar, name),
    gear: null,
    scoped: false,
    firing: false,
    thrusting: false,
    avatar,
    dragon: null,
    avatarLocked: avatar !== 'standard',
    hearts: classOf(avatar).hearts,
    kills: 0,
    dead: false,
  };
  classOf(avatar).enter(p);
  return p;
}

export function clonePlayer(p: PlayerState): PlayerState {
  return {
    ...p,
    pos: { ...p.pos },
    item: p.item && { ...p.item },
    gear: p.gear && { ...p.gear },
    dragon: p.dragon && { ...p.dragon, dir: { ...p.dragon.dir }, spine: [...p.dragon.spine] },
  };
}

// Puts `p` in `avatar`. A new class is a new body at the same eye point: its life in proportion to
// the old, the old class's state gone and the new one's made, and the kit dropped where the class
// has none. The look's own item is held for good; leaving one brings back whatever the name gives.
export function becomeAvatar(p: PlayerState, avatar: AvatarId): void {
  const from = classOf(p.avatar);
  const to = classOf(avatar);
  const hadOwn = AVATARS[p.avatar].item !== null;
  p.avatar = avatar;
  if (to !== from) {
    if (!p.dead) p.hearts = Math.max(0.5, Math.round((p.hearts / from.hearts) * to.hearts * 2) / 2);
    from.exit(p);
    to.enter(p);
    p.vy = 0;
    if (!to.kit) {
      p.gear = null;
      p.boost = 0;
    }
  }
  if (AVATARS[avatar].item || hadOwn) p.item = ownItem(avatar, p.name);
}

// The look's own item, locked, else the name's, else nothing.
function ownItem(avatar: AvatarId, name: string): ItemState | null {
  const id = AVATARS[avatar].item ?? lockedItemFor(name);
  return id ? createItem(id, true) : null;
}

// Weapon actions from the frame. Scope is a level the client reports; firing is for hold items
// and needs fuel, which burns while firing and refills otherwise. Pure, so the local fuel gauge
// and scope state predict exactly. Tap shots are events the Room resolves.
function stepItem(p: PlayerState, input: InputFrame | null, dt: number): void {
  const item = p.item;
  if (!item || p.dead) {
    p.scoped = false;
    p.firing = false;
    return;
  }
  const spec = ITEMS[item.id];
  const held = input ? input.actions : [];
  p.scoped = !!spec.actions.scope && held.includes('scope');
  const wantsFire = spec.actions.shoot?.mode === 'hold' && held.includes('shoot') && (!spec.fireNeedsScope || p.scoped);
  p.firing = wantsFire && (item.fuel === null || item.fuel > 0);
  if (item.fuel !== null && spec.fuelSeconds !== null) {
    item.fuel = nextFuel(item.fuel, spec.fuelSeconds, p.firing, !p.firing, dt);
    if (item.fuel === 0) p.firing = false; // the tank ran dry this tick
  }
}

// Advances one player by `dt`. A null input means no frame arrived: the class's own physics still
// apply. Returns how fast they were falling if they landed this step (m/s, downward), else 0; the
// Room turns that into fall damage.
export function stepPlayer(
  p: PlayerState,
  input: InputFrame | null,
  dt: number,
  shape: WorldPart[] = WORLD_SHAPE,
  structures: Structures = WORLD_STRUCTURES,
): number {
  if (input) {
    p.yaw = input.yaw;
    p.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, input.pitch));
    p.reading = input.reading;
    p.lastSeq = input.seq;
  }
  stepItem(p, input, dt);
  const landing = classOf(p.avatar).step(p, input, dt, shape, structures);
  p.boost = Math.max(0, p.boost - dt);
  return landing;
}
