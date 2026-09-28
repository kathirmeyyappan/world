// A room: the authoritative simulation for one set of players plus the cubes.
// Transport-agnostic so the Node server (WebSockets) and the browser's offline mode (a loopback)
// can both host one. Ticks on a fixed timestep and broadcasts a snapshot after every tick.
import { CUBE_IDS } from './content/cubes';
import { isClientMessage, type ClientMessage, type CubeSnapshot, type ServerMessage } from './protocol';
import {
  MAX_CHAT_LENGTH,
  EYE_HEIGHT,
  MAX_INPUTS_PER_TICK,
  MAX_INPUT_QUEUE,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  DEATH_SCREEN_SECONDS,
  PLAYER_COLORS,
  SPEEDY_SECONDS,
  TICK_DT,
  TICK_RATE,
} from './sim/constants';
import { parseCommand, type Command } from './commands';
import { resolveFire } from './sim/combat';
import { applyDamage, damageFor } from './sim/health';
import { AVATARS } from './sim/avatars';
import { BOTS, MAX_BOTS_PER_ROOM, type BotId, type BotRequest } from './sim/bots';
import { ITEMS, createItem, itemHelp, type ItemId, type ItemSpec } from './sim/items';
import { createCubes, stepCubes } from './sim/cubes';
import { createPlayer, stepPlayer } from './sim/player';
import { createRng, type Rng } from './sim/rng';
import type { CubeState, InputFrame, PlayerState } from './sim/types';
import { WORLD_SHAPE, randomPointInWorld, type WorldPart } from './sim/world';

// Shared has no DOM or Node lib; both runtimes provide these.
declare function setInterval(cb: () => void, ms: number): unknown;
declare function clearInterval(handle: unknown): void;
declare function setTimeout(cb: () => void, ms: number): unknown;

const SPAWN_WALL_MARGIN = 3;
// A dead player's own client reloads after the death screen; anything still connected after
// this (a bot, a backgrounded tab) is removed so corpses don't pile up.
const CORPSE_TICKS = (DEATH_SCREEN_SECONDS + 3) * TICK_RATE;
const SPAWN_CUBE_MARGIN = 4;

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

export interface JoinOptions {
  bot?: boolean; // the client says it's a bot (the browser never does; the bot framework always does)
  room?: string; // the public room code the client asked for; bots called from here join it
}

// Starts a bot for this room; the host wires it to Modal. Rejects with a message on failure.
export type BotSpawner = (request: BotRequest) => Promise<void>;

export interface RoomOptions {
  seed?: number;
  worldShape?: WorldPart[];
  onEmpty?: () => void;
  log?: (msg: string) => void;
  spawnBot?: BotSpawner; // absent: bots can't be called from this room
}

const PENDING_BOT_MS = 60_000; // a called bot counts toward the room's cap until it joins or this passes

export class Room {
  readonly id: string;
  readonly worldShape: WorldPart[];
  tick = 0;

  private readonly seats = new Map<string, Seat>();
  private readonly cubes: CubeState[];
  private readonly rng: Rng;
  private readonly onEmpty?: () => void;
  private readonly log: (msg: string) => void;
  private readonly spawnBot?: BotSpawner;
  private publicName: string | null = null; // the room code clients asked for, learnt at the first join
  private readonly pendingBots = new Set<object>();
  private timer: unknown = null;
  private nextPlayerId = 1;

  constructor(id: string, opts: RoomOptions = {}) {
    this.id = id;
    this.worldShape = opts.worldShape ?? WORLD_SHAPE;
    this.rng = createRng(opts.seed ?? (Math.random() * 2 ** 32) >>> 0);
    this.cubes = createCubes(CUBE_IDS, this.worldShape, this.rng);
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

  // Seats a new player and sends them the world. Returns null when the room is full.
  join(rawName: string, link: ClientLink, opts: JoinOptions = {}): string | null {
    if (this.seats.size >= MAX_PLAYERS) {
      link.send({ t: 'error', message: 'room is full' });
      return null;
    }
    const id = `p${this.nextPlayerId++}`;
    const state = createPlayer(id, sanitizeName(rawName), this.pickColor(), this.spawnPoint(), !!opts.bot);
    if (opts.room && !this.publicName) this.publicName = opts.room;
    if (opts.bot) this.settlePendingBot();
    this.seats.set(id, { state, link, queue: [], lastShotTick: -Infinity, shootHeld: false, diedTick: null });
    link.send({ t: 'welcome', id, room: this.id, tick: this.tick, players: this.players, cubes: this.cubeSnapshot() });
    this.broadcast({ t: 'join', p: state }, id);
    this.log(`${state.name} (${id}) joined ${this.id}${state.bot ? ' as a bot' : ''}, ${this.seats.size} online`);
    return id;
  }

  leave(id: string): void {
    const seat = this.seats.get(id);
    if (!seat) return;
    this.seats.delete(id);
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
        const text = msg.text.replace(/[\u0000-\u001f]/g, '').trim().slice(0, MAX_CHAT_LENGTH);
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
    for (const hit of resolveFire(spec, me, this.players)) this.damage(seat, hit.target, damageFor(spec, hit.headshot), hit.headshot);
  }

  // Takes hearts off `victim` for a shot by `shooter`, and kills them at zero. A kill is one
  // structured message; clients word the announcement.
  private damage(shooter: Seat, victim: PlayerState, damage: number, headshot: boolean): void {
    const killed = applyDamage(victim, damage);
    this.broadcast({ t: 'hit', shooter: shooter.state.id, victim: victim.id, damage, headshot, hearts: victim.hearts });
    if (!killed) return;
    const seat = this.seats.get(victim.id);
    if (seat) seat.diedTick = this.tick;
    shooter.state.kills++;
    this.broadcast({ t: 'kill', shooter: shooter.state.id, victim: victim.id, item: shooter.state.item!.id, headshot });
  }

  step(): void {
    for (const [id, seat] of this.seats) {
      if (seat.diedTick !== null && this.tick - seat.diedTick >= CORPSE_TICKS) {
        this.leave(id);
        seat.link.close?.('dead');
        continue;
      }
      const n = Math.min(seat.queue.length, MAX_INPUTS_PER_TICK);
      if (n === 0) {
        stepPlayer(seat.state, null, TICK_DT, this.worldShape);
        continue;
      }
      for (let i = 0; i < n; i++) {
        stepPlayer(seat.state, seat.queue[i], TICK_DT, this.worldShape);
        this.applyActions(seat, seat.queue[i]);
      }
      seat.queue.splice(0, n);
    }
    stepCubes(this.cubes, TICK_DT, this.worldShape, this.rng);
    this.tick++;
    this.broadcast({ t: 'snap', tick: this.tick, players: this.players, cubes: this.cubeSnapshot() });
  }

  private broadcast(msg: ServerMessage, except?: string): void {
    for (const [id, seat] of this.seats) {
      if (id !== except) seat.link.send(msg);
    }
  }

  private cubeSnapshot(): CubeSnapshot[] {
    return this.cubes.map((c) => ({ id: c.id, x: c.pos.x, y: c.pos.y, z: c.pos.z, rx: c.rot.x, ry: c.rot.y }));
  }

  private pickColor(): string {
    const used = new Map<string, number>();
    for (const s of this.seats.values()) used.set(s.state.color, (used.get(s.state.color) ?? 0) + 1);
    let best = PLAYER_COLORS[0];
    let bestCount = Infinity;
    for (const c of PLAYER_COLORS) {
      const n = used.get(c) ?? 0;
      if (n < bestCount) {
        best = c;
        bestCount = n;
      }
    }
    return best;
  }

  private runCommand(seat: Seat, command: Command): void {
    switch (command.name) {
      case 'speedy':
        seat.state.boost = SPEEDY_SECONDS;
        this.broadcast({ t: 'system', text: `${seat.state.name} increased their movement speed for ${SPEEDY_SECONDS}s` });
        return;
      case 'equip':
        this.equip(seat, command.item);
        return;
      case 'avatar': {
        const me = seat.state;
        const spec = AVATARS[command.avatar];
        if (me.avatar === command.avatar && me.avatarLeft === null) {
          seat.link.send({ t: 'system', text: `you're already ${command.avatar}` });
          return;
        }
        // A name-tagged look is for keeps; the command can't take it away.
        if (me.avatarLeft === null && me.avatar !== 'standard') {
          seat.link.send({ t: 'system', text: `you're ${me.avatar} for good` });
          return;
        }
        me.avatar = command.avatar;
        me.avatarLeft = spec.seconds > 0 ? spec.seconds : null;
        this.broadcast({ t: 'system', text: `${me.name} is now ${command.avatar}${spec.seconds ? ` for ${spec.seconds}s` : ''}` });
        return;
      }
      case 'bot':
        this.callBot(seat, command.bot, command.seconds);
        return;
      case 'unknown':
        seat.link.send({ t: 'system', text: `unknown command /${command.raw}` });
        return;
    }
  }

  // "/circle-bot 60": ask the host to start a bot in this room. People only, a few per room,
  // and only where the host can reach Modal.
  private callBot(seat: Seat, id: BotId, seconds: number | null): void {
    const me = seat.state;
    const bot = BOTS[id];
    const tell = (text: string) => seat.link.send({ t: 'system', text });
    if (seconds === null) return tell(`usage: /${bot.playerName} [seconds]`);
    if (me.bot) return tell("bots can't call bots");
    if (!this.spawnBot || !this.publicName) return tell("bots can't be called in this room");
    if (this.botCount + this.pendingBots.size >= MAX_BOTS_PER_ROOM) return tell(`this room already has ${MAX_BOTS_PER_ROOM} bots`);

    const pending = {};
    this.pendingBots.add(pending);
    setTimeout(() => this.pendingBots.delete(pending), PENDING_BOT_MS);
    this.broadcast({ t: 'system', text: `${me.name} called ${bot.playerName} for ${seconds}s` });
    this.spawnBot({ bot: id, room: this.publicName, seconds, caller: me.name }).catch((err: unknown) => {
      this.pendingBots.delete(pending);
      this.log(`bot ${id} for ${this.id}: ${err instanceof Error ? err.message : String(err)}`);
      tell(`couldn't call ${bot.playerName}`);
    });
  }

  private settlePendingBot(): void {
    const first = this.pendingBots.values().next().value;
    if (first) this.pendingBots.delete(first);
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
    this.broadcast({ t: 'system', text: held && held.id !== id ? `${me.name} swapped their ${held.id} for a ${id}` : `${me.name} drew a ${id}` }, me.id);
  }

  // Anywhere in the world, clear of the walls and not on top of a cube.
  private spawnPoint() {
    let p = randomPointInWorld(this.worldShape, SPAWN_WALL_MARGIN, this.rng);
    for (let i = 0; i < 20; i++) {
      if (this.cubes.every((c) => Math.hypot(c.pos.x - p.x, c.pos.z - p.z) >= SPAWN_CUBE_MARGIN)) break;
      p = randomPointInWorld(this.worldShape, SPAWN_WALL_MARGIN, this.rng);
    }
    return { x: p.x, y: EYE_HEIGHT, z: p.z };
  }
}

function howTo(spec: ItemSpec): string {
  const help = itemHelp(spec.id);
  if (spec.fireNeedsScope) return `${help}. it only fires while scoped`;
  if (spec.fuelSeconds !== null) return `${help}. ${spec.fuelSeconds}s of fuel, refills while you don't`;
  return help;
}

export function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/[\u0000-\u001f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
  return cleaned || 'guest';
}

export function isValidRoomId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,23}$/.test(id);
}
