// A room: the authoritative simulation for one set of players plus the cubes.
// Transport-agnostic so the Node server (WebSockets) and the browser's offline mode (a loopback)
// can both host one. Ticks on a fixed timestep and broadcasts a snapshot after every tick.
import { CUBE_IDS } from './content/cubes';
import { CORPSE_DROP, PICKUP_AREAS } from './content/pickups';
import { SPAWN_AREAS } from './content/regions';
import {
  isClientMessage,
  type ClientMessage,
  type CubeSnapshot,
  type PickupSnapshot,
  type ServerMessage,
} from './protocol';
import {
  MAX_CHAT_LENGTH,
  EYE_HEIGHT,
  MAX_INPUTS_PER_TICK,
  MAX_INPUT_QUEUE,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  DEATH_SCREEN_SECONDS,
  PLAYER_COLORS,
  PLAYER_PADDING,
  SPEEDY_SECONDS,
  STEP_UP,
  TICK_DT,
  TICK_RATE,
} from './sim/constants';
import { parseCommand, type BotCallArgs, type Command } from './commands';
import { resolveFire } from './sim/combat';
import { PositionHistory, rewindTick } from './sim/rewind';
import { applyDamage, damageFor, fallDamage } from './sim/health';
import { BOTS, botArguments, botRequest, type BotId, type BotPlacement, type BotRequest } from './sim/bots';
import { defaultBotsFor } from './sim/defaultBots';
import { GEAR, createGear, gearHelp, type GearId } from './sim/gear';
import { ITEMS, createItem, itemHelp, type ItemId, type ItemSpec } from './sim/items';
import { createCubes, stepCubes } from './sim/cubes';
import { randomPointInRegion } from './sim/regions';
import { createPickups, dropPickup, stepPickups, takePickups, type PickupArea, type PickupField } from './sim/pickups';
import { createPlayer, stepPlayer } from './sim/player';
import { createRng, type Rng } from './sim/rng';
import type { CubeState, InputFrame, PlayerState, Vec3 } from './sim/types';
import type { Structures } from './sim/collision';
import { CAPSULE_TOP } from './sim/health';
import {
  WORLD_SHAPE,
  WORLD_STRUCTURES,
  clampToWorld,
  randomPointInDisc,
  worldDistance,
  type WorldPart,
} from './sim/world';

// Shared has no DOM or Node lib; both runtimes provide these.
declare function setInterval(cb: () => void, ms: number): unknown;
declare function clearInterval(handle: unknown): void;

const SPAWN_WALL_MARGIN = 3;
const SPAWN_MARGIN = 1; // metres a spawn keeps inside its area: more than a body's radius
// Browsers leave whenever the player rejoins during the death screen, with a little extra time
// as a fallback. Bots cannot rejoin themselves, so approximate that window's midpoint.
const BOT_CORPSE_TICKS = 5 * TICK_RATE;
const BROWSER_CORPSE_TICKS = (DEATH_SCREEN_SECONDS + 3) * TICK_RATE;
const SPAWN_CUBE_MARGIN = 4;
const CALLED_BOT_RANGE = 50; // metres from the caller, across the floor, that a called bot spawns within

export interface ClientLink {
  send(msg: ServerMessage): void;
  close?(reason: string): void; // the room is done with this client; the reason reaches it as the close reason
}

interface Seat {
  lastShotTick: number;
  shootHeld: boolean; // last frame's shoot level, for tap weapons' press edge
  diedTick: number | null;
  state: PlayerState;
  link: ClientLink;
  queue: InputFrame[];
}

export interface JoinOptions extends BotPlacement {
  bot?: boolean; // the client says it's a bot (the browser never does; the bot framework always does)
  room?: string; // the public room code the client asked for; bots called from here join it
  // BotPlacement's spawn and avatar are honoured for bots only; a person always spawns at random.
}

// Starts a bot for this room; the host wires it to Modal. Rejects with a message on failure.
export type BotSpawner = (request: BotRequest) => Promise<void>;

export interface RoomOptions {
  seed?: number;
  worldShape?: WorldPart[];
  structures?: Structures;
  onEmpty?: () => void;
  log?: (msg: string) => void;
  spawnBot?: BotSpawner; // absent: bots can't be called from this room
  pickupAreas?: PickupArea[]; // where pickups float; the world's own (content/pickups.ts) by default
}

export class Room {
  readonly id: string;
  readonly worldShape: WorldPart[];
  readonly structures: Structures;
  tick = 0;

  private readonly seats = new Map<string, Seat>();
  private readonly history = new PositionHistory(); // where everyone was, for lag compensation
  private readonly cubes: CubeState[];
  private readonly pickups: PickupField;
  private readonly rng: Rng;
  private readonly onEmpty?: () => void;
  private readonly log: (msg: string) => void;
  private readonly spawnBot?: BotSpawner;
  private publicName: string | null = null; // the room code clients asked for, learnt at the first join
  private timer: unknown = null;
  private nextPlayerId = 1;

  constructor(id: string, opts: RoomOptions = {}) {
    this.id = id;
    this.worldShape = opts.worldShape ?? WORLD_SHAPE;
    this.structures = opts.structures ?? WORLD_STRUCTURES;
    this.rng = createRng(opts.seed ?? (Math.random() * 2 ** 32) >>> 0);
    this.cubes = createCubes(CUBE_IDS, this.worldShape, this.rng);
    this.pickups = createPickups(opts.pickupAreas ?? PICKUP_AREAS, this.rng);
    this.onEmpty = opts.onEmpty;
    this.log = opts.log ?? (() => {});
    this.spawnBot = opts.spawnBot;
  }

  get playerCount(): number {
    return this.seats.size;
  }

  // People, not bots. A room lives while it has one of these.
  get humanCount(): number {
    let n = 0;
    for (const seat of this.seats.values()) if (!seat.state.bot) n++;
    return n;
  }

  get botCount(): number {
    return this.seats.size - this.humanCount;
  }

  get players(): PlayerState[] {
    return [...this.seats.values()].map((s) => s.state);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), 1000 / TICK_RATE);
  }

  // Stops ticking and disconnects whoever is still seated (bots, when the last person left).
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const seat of this.seats.values()) seat.link.close?.('room closed');
    this.seats.clear();
  }

  // Seats a new player and sends them the world. Returns null (after an error message) when
  // the room is full, or when a bot would be alone: bots don't keep a room open, so one that
  // arrives after everyone left (a slow spawn) must not start a room that nothing would close.
  join(rawName: string, link: ClientLink, opts: JoinOptions = {}): string | null {
    if (this.seats.size >= MAX_PLAYERS) {
      link.send({ t: 'error', message: 'room is full' });
      return null;
    }
    if (opts.bot && this.humanCount === 0) {
      link.send({ t: 'error', message: 'no one here' });
      return null;
    }
    const id = `p${this.nextPlayerId++}`;
    const at = opts.bot && opts.spawn ? this.placedSpawn(opts.spawn) : this.spawnPoint();
    const state = createPlayer(id, sanitizeName(rawName), this.pickColor(), at, !!opts.bot);
    if (opts.bot && opts.avatar) {
      state.avatar = opts.avatar;
      state.avatarLocked = true;
    }
    if (opts.room && !this.publicName) this.publicName = opts.room;
    this.seats.set(id, { state, link, queue: [], lastShotTick: -Infinity, shootHeld: false, diedTick: null });
    link.send({
      t: 'welcome',
      id,
      room: this.id,
      tick: this.tick,
      players: this.players,
      cubes: this.cubeSnapshot(),
      pickups: this.pickupSnapshot(),
    });
    this.broadcast({ t: 'join', p: state }, id);
    this.log(`${state.name} (${id}) joined ${this.id}${state.bot ? ' as a bot' : ''}, ${this.seats.size} online`);
    if (!state.bot && this.humanCount === 1) this.addDefaultBots();
    return id;
  }

  // The room's starting bots (see sim/defaultBots.ts), spawned once, when the first person
  // arrives. Needs a host that can spawn and the room's public name, like callBot.
  private defaultBotsAdded = false;
  private addDefaultBots(): void {
    if (this.defaultBotsAdded || !this.spawnBot || !this.publicName) return;
    this.defaultBotsAdded = true;
    const bots = defaultBotsFor(this.publicName);
    if (bots.length === 0) return;
    this.broadcast({ t: 'system', text: `${botRollCall(bots.map((b) => BOTS[b.bot].playerName))} on the way` });
    for (const { bot, seconds, targets, ...placement } of bots) {
      const req = botRequest({ bot, room: this.publicName, seconds, caller: 'room', ...placement }, targets);
      this.spawnBot(req).catch((err: unknown) => {
        this.log(`default bot ${bot} for ${this.id}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  // A player goes. A dead one's body poofs away on every client and leaves CORPSE_DROP on whatever
  // it was lying on.
  leave(id: string): void {
    const seat = this.seats.get(id);
    if (!seat) return;
    this.seats.delete(id);
    const { dead, pos } = seat.state;
    if (dead) {
      const feet = { x: pos.x, y: this.structures.groundAt(pos.x, pos.z, pos.y - EYE_HEIGHT + 0.01), z: pos.z };
      dropPickup(this.pickups, CORPSE_DROP, feet, this.rng);
    }
    this.broadcast({ t: 'leave', id, name: seat.state.name });
    this.log(`${seat.state.name} (${id}) left ${this.id}, ${this.seats.size} online`);
    if (this.humanCount === 0) this.onEmpty?.(); // bots alone don't keep a room open
  }

  receive(id: string, raw: unknown): void {
    const seat = this.seats.get(id);
    if (!seat || !isClientMessage(raw)) return;
    const msg: ClientMessage = raw;
    switch (msg.t) {
      case 'input': {
        const newest = seat.queue.length ? seat.queue[seat.queue.length - 1].seq : seat.state.lastSeq;
        if (msg.f.seq <= newest) return;
        if (seat.queue.length >= MAX_INPUT_QUEUE) seat.queue.shift();
        seat.queue.push(msg.f);
        return;
      }
      case 'chat': {
        const text = msg.text
          .replace(/[\u0000-\u001f]/g, '')
          .trim()
          .slice(0, MAX_CHAT_LENGTH);
        if (!text) return;
        const command = parseCommand(text);
        if (command) this.runCommand(seat, command);
        else this.broadcast({ t: 'chat', id, name: seat.state.name, color: seat.state.color, text });
        return;
      }
      case 'ping':
        seat.link.send({ t: 'pong', at: msg.at });
        return;
    }
  }

  // The shoot action in one frame: a tap weapon fires on the press, a hold weapon fires every
  // cooldown while the sim says it's firing (held, scoped if needed, fuel left).
  private applyActions(seat: Seat, frame: InputFrame): void {
    const me = seat.state;
    const held = frame.actions.includes('shoot');
    const pressed = held && !seat.shootHeld;
    seat.shootHeld = held;
    const spec = me.item && ITEMS[me.item.id];
    const shoot = spec?.actions.shoot;
    if (!spec || !shoot || me.dead) return;
    const wants = shoot.mode === 'hold' ? me.firing : pressed && (!spec.fireNeedsScope || me.scoped);
    if (!wants || this.tick - seat.lastShotTick < spec.cooldownTicks) return;
    seat.lastShotTick = this.tick;
    if (shoot.mode === 'tap') this.broadcast({ t: 'shot', id: me.id });
    // Judge the shot where the targets were on the shooter's screen (rewind.ts); the shooter
    // fires from where they are now, which is what their own prediction showed them.
    const at = rewindTick(frame.view, this.tick);
    const targets = this.players.map((p) => ({
      id: p.id,
      dead: p.dead,
      avatar: p.avatar,
      pos: this.history.at(p.id, at) ?? p.pos,
      player: p,
    }));
    for (const hit of resolveFire(spec, me, targets, this.structures))
      this.damage(hit.target.player, damageFor(spec, hit.headshot), { shooter: seat, headshot: hit.headshot });
  }

  // Takes hearts off `victim`, for a shot by `by.shooter` or, with no `by`, a fall, and kills them
  // at zero. A death is one structured message; clients word the announcement.
  private damage(victim: PlayerState, damage: number, by: { shooter: Seat; headshot: boolean } | null): void {
    const killed = applyDamage(victim, damage);
    const shooter = by?.shooter.state ?? null;
    const headshot = by?.headshot ?? false;
    this.broadcast({
      t: 'hit',
      shooter: shooter?.id ?? null,
      victim: victim.id,
      damage,
      headshot,
      hearts: victim.hearts,
    });
    if (!killed) return;
    const seat = this.seats.get(victim.id);
    if (seat) seat.diedTick = this.tick;
    if (!shooter) return this.broadcast({ t: 'fell', victim: victim.id });
    shooter.kills++;
    this.broadcast({ t: 'kill', shooter: shooter.id, victim: victim.id, item: shooter.item!.id, headshot });
  }

  // A step that ended in a landing at `speed` m/s.
  private land(seat: Seat, speed: number): void {
    const damage = fallDamage(speed);
    if (damage > 0 && !seat.state.dead) this.damage(seat.state, damage, null);
  }

  step(): void {
    for (const [id, seat] of this.seats) {
      const corpseTicks = seat.state.bot ? BOT_CORPSE_TICKS : BROWSER_CORPSE_TICKS;
      if (seat.diedTick !== null && this.tick - seat.diedTick >= corpseTicks) {
        this.leave(id);
        seat.link.close?.('dead');
        continue;
      }
      const n = Math.min(seat.queue.length, MAX_INPUTS_PER_TICK);
      if (n === 0) {
        this.land(seat, stepPlayer(seat.state, null, TICK_DT, this.worldShape, this.structures));
        continue;
      }
      for (let i = 0; i < n; i++) {
        this.land(seat, stepPlayer(seat.state, seat.queue[i], TICK_DT, this.worldShape, this.structures));
        this.applyActions(seat, seat.queue[i]);
      }
      seat.queue.splice(0, n);
    }
    stepCubes(this.cubes, TICK_DT, this.worldShape, this.rng);
    stepPickups(this.pickups, TICK_DT, this.rng);
    for (const p of this.players) takePickups(this.pickups, p, EYE_HEIGHT);
    this.tick++;
    const players = this.players;
    this.broadcast({ t: 'snap', tick: this.tick, players, cubes: this.cubeSnapshot(), pickups: this.pickupSnapshot() });
    this.history.record(this.tick, players);
  }

  private broadcast(msg: ServerMessage, except?: string): void {
    for (const [id, seat] of this.seats) {
      if (id !== except) seat.link.send(msg);
    }
  }

  private pickupSnapshot(): PickupSnapshot[] {
    const r = (v: number) => Math.round(v * 100) / 100;
    return this.pickups.items.map((p) => ({
      id: p.id,
      kind: p.kind,
      x: r(p.pos.x),
      y: r(p.pos.y),
      z: r(p.pos.z),
      ry: r(p.ry),
    }));
  }

  private cubeSnapshot(): CubeSnapshot[] {
    return this.cubes.map((c) => ({ id: c.id, x: c.pos.x, y: c.pos.y, z: c.pos.z, rx: c.rot.x, ry: c.rot.y }));
  }

  // One of the least-used colours in the room, picked at random among the ties.
  private pickColor(): string {
    const used = new Map<string, number>();
    for (const s of this.seats.values()) used.set(s.state.color, (used.get(s.state.color) ?? 0) + 1);
    const fewest = Math.min(...PLAYER_COLORS.map((c) => used.get(c) ?? 0));
    const choices = PLAYER_COLORS.filter((c) => (used.get(c) ?? 0) === fewest);
    return choices[Math.floor(this.rng() * choices.length)];
  }

  private runCommand(seat: Seat, command: Command): void {
    switch (command.name) {
      case 'speedy':
        seat.state.boost = SPEEDY_SECONDS;
        this.broadcast({
          t: 'system',
          text: `${seat.state.name} increased their movement speed for ${SPEEDY_SECONDS}s`,
        });
        return;
      case 'equip':
        this.equip(seat, command.item);
        return;
      case 'wear':
        this.wear(seat, command.gear);
        return;
      case 'avatar': {
        // Like a name-given item: a name-given look can't be changed; anyone else switches for good.
        const me = seat.state;
        if (me.avatarLocked) {
          seat.link.send({ t: 'system', text: `you're ${me.avatar} for good` });
          return;
        }
        if (me.avatar === command.avatar) {
          seat.link.send({ t: 'system', text: `you're already ${command.avatar}` });
          return;
        }
        me.avatar = command.avatar;
        this.broadcast({ t: 'system', text: `${me.name} is now ${command.avatar}` });
        return;
      }
      case 'bot':
        this.callBot(seat, command.bot, command.call);
        return;
      case 'kill-bots':
        this.killBots(seat);
        return;
      case 'unknown':
        seat.link.send({ t: 'system', text: `unknown command /${command.raw}` });
        return;
    }
  }

  // "/circle-bot -t 60 -n bob" or "/sniper-bot -s tung --target kat": ask the host to start a bot
  // in this room, under its own name and look or the ones given, hunting `targets` if it's a combat
  // bot.
  // People only, and only where the host can reach Modal. There is no bot cap beyond the room's
  // 32 seats.
  private callBot(seat: Seat, id: BotId, call: BotCallArgs | null): void {
    const me = seat.state;
    const bot = BOTS[id];
    const tell = (text: string) => seat.link.send({ t: 'system', text });
    if (call === null) return tell(`usage: /${bot.playerName} ${botArguments(bot.worker)}`);
    const { seconds, targets } = call;
    const name = call.botName === null ? undefined : sanitizeName(call.botName);
    if (me.bot) return tell("bots can't call bots");
    if (!this.spawnBot || !this.publicName) return tell("bots can't be called in this room");
    if (this.seats.size >= MAX_PLAYERS) return tell('this room is full');

    const who = name === undefined ? bot.playerName : `${name} (${bot.playerName})`;
    const after = targets.length > 0 ? ` after ${targets.join(', ')}` : '';
    this.broadcast({ t: 'system', text: `${me.name} called ${who} for ${seconds}s${after}` });
    const near = this.spawnPoint(me.pos);
    const spawn = { x: near.x, y: near.y - EYE_HEIGHT, z: near.z };
    const named = name === undefined ? {} : { name };
    const dressed = call.avatar === null ? {} : { avatar: call.avatar };
    const req = botRequest(
      { bot: id, room: this.publicName, seconds, caller: me.name, spawn, ...named, ...dressed },
      targets,
    );
    this.spawnBot(req).catch((err: unknown) => {
      this.log(`bot ${id} for ${this.id}: ${err instanceof Error ? err.message : String(err)}`);
      tell(`couldn't call ${bot.playerName}`);
    });
  }

  // "/kill-bots": every living bot drops dead where it stands, as if shot, so each lies as a corpse
  // and is dropped like any other; a bot's run ends when the room closes its connection. People only.
  private killBots(seat: Seat): void {
    const tell = (text: string) => seat.link.send({ t: 'system', text });
    if (seat.state.bot) return tell("bots can't kill bots");
    const bots = [...this.seats.values()].filter((s) => s.state.bot && !s.state.dead);
    if (bots.length === 0) return tell('no bots here');
    for (const bot of bots) {
      bot.state.hearts = 0;
      bot.state.dead = true;
      bot.diedTick = this.tick;
    }
    this.broadcast({ t: 'system', text: `${seat.state.name} killed ${botRollCall(bots.map((b) => b.state.name))}` });
  }

  // Gear goes on beside whatever weapon they hold; wearing it again restarts its timer and tank.
  private wear(seat: Seat, id: GearId): void {
    const me = seat.state;
    me.gear = createGear(id);
    seat.link.send({ t: 'system', text: `you put on a ${id} for ${GEAR[id].seconds}s. ${gearHelp(id)}.` });
    this.broadcast({ t: 'system', text: `${me.name} put on a ${id}` }, me.id);
  }

  // One item at a time. A permanent holder can't swap; anyone else can, and re-equipping the
  // same item restarts its timer.
  private equip(seat: Seat, id: ItemId): void {
    const me = seat.state;
    const held = me.item;
    if (held?.permanent) {
      if (held.id === id) this.broadcast({ t: 'system', text: `${me.name} already has a ${id}` });
      else seat.link.send({ t: 'system', text: `you can't put down your ${held.id}` });
      return;
    }
    const spec = ITEMS[id];
    me.item = createItem(id, false);
    seat.link.send({ t: 'system', text: `you drew a ${id} for ${spec.seconds}s. ${howTo(spec)}.` });
    this.broadcast(
      {
        t: 'system',
        text: held && held.id !== id ? `${me.name} swapped their ${held.id} for a ${id}` : `${me.name} drew a ${id}`,
      },
      me.id,
    );
  }

  // A bot's chosen spot (feet at `feet`), kept inside the world and stood on the highest surface
  // within a step of those feet, so a spot asked for on a floor lands on it and one in the air falls.
  private placedSpawn(feet: Vec3): Vec3 {
    const p = { ...feet };
    clampToWorld(p, PLAYER_PADDING, this.worldShape);
    return { x: p.x, y: this.structures.groundAt(p.x, p.z, feet.y + STEP_UP) + EYE_HEIGHT, z: p.z };
  }

  // Somewhere in one of SPAWN_AREAS (or, given `near`, within CALLED_BOT_RANGE of it
  // across the floor), clear of the walls and not on top of a cube, standing on the ground (or
  // anything within a step of it) with room for a body above: inside a building's ground floor,
  // never on a roof, and never inside a wall. Returns the eye position.
  private spawnPoint(near?: Vec3) {
    const ground = (p: { x: number; z: number }) => this.structures.groundAt(p.x, p.z, STEP_UP);
    const roomy = (p: { x: number; z: number }) =>
      this.structures.ceilingAt(p.x, p.z, ground(p)) - ground(p) >= EYE_HEIGHT + CAPSULE_TOP;
    const area = SPAWN_AREAS[Math.floor(this.rng() * SPAWN_AREAS.length)]; // one for every try, so each gets its share
    const pick = () => (near ? this.pointNear(near) : randomPointInRegion(area, SPAWN_MARGIN, this.rng));
    let p = pick();
    for (let i = 0; i < 20; i++) {
      if (this.cubes.every((c) => Math.hypot(c.pos.x - p.x, c.pos.z - p.z) >= SPAWN_CUBE_MARGIN) && roomy(p)) break;
      p = pick();
    }
    return { x: p.x, y: ground(p) + EYE_HEIGHT, z: p.z };
  }

  // A random point within CALLED_BOT_RANGE of `near` and SPAWN_WALL_MARGIN inside the world; `near`
  // itself if twenty tries all land outside (at the world's edge, over half the circle can).
  private pointNear(near: Vec3): { x: number; z: number } {
    const around = { kind: 'disc' as const, x: near.x, z: near.z, r: CALLED_BOT_RANGE };
    for (let i = 0; i < 20; i++) {
      const p = randomPointInDisc(around, 0, this.rng);
      if (worldDistance(p.x, p.z, this.worldShape) <= -SPAWN_WALL_MARGIN) return p;
    }
    return { x: near.x, z: near.z };
  }
}

// "circle-bot x2, stalker-bot x3": names in first-seen order, repeats counted.
function botRollCall(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].map(([n, k]) => (k > 1 ? `${n} x${k}` : n)).join(', ');
}

function howTo(spec: ItemSpec): string {
  const help = itemHelp(spec.id);
  if (spec.fireNeedsScope) return `${help}. it only fires while scoped`;
  if (spec.fuelSeconds !== null) return `${help}. ${spec.fuelSeconds}s of fuel, refills while you don't`;
  return help;
}

export function sanitizeName(raw: string): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return cleaned || 'guest';
}

export function isValidRoomId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,23}$/.test(id);
}
