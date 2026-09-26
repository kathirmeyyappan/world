// A room: the authoritative simulation for one set of players plus the cubes.
// Transport-agnostic so the Node server (WebSockets) and the browser's offline mode (a loopback)
// can both host one. Ticks on a fixed timestep and broadcasts a snapshot after every tick.
import { CUBE_IDS } from './content/cubes';
import { isClientMessage, type ClientMessage, type CubeSnapshot, type ServerMessage } from './protocol';
import {
  MAX_CHAT_LENGTH,
  MAX_INPUTS_PER_TICK,
  MAX_INPUT_QUEUE,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  PLAYER_COLORS,
  TICK_DT,
  TICK_RATE,
} from './sim/constants';
import { createCubes, stepCubes } from './sim/cubes';
import { createPlayer, stepPlayer } from './sim/player';
import { createRng, type Rng } from './sim/rng';
import type { CubeState, InputFrame, PlayerState } from './sim/types';
import { WORLD_SHAPE, type WorldPart } from './sim/world';

// Shared has no DOM or Node lib; both runtimes provide these.
declare function setInterval(cb: () => void, ms: number): unknown;
declare function clearInterval(handle: unknown): void;

export interface ClientLink {
  send(msg: ServerMessage): void;
}

interface Seat {
  state: PlayerState;
  link: ClientLink;
  queue: InputFrame[];
}

export interface RoomOptions {
  seed?: number;
  worldShape?: WorldPart[];
  onEmpty?: () => void;
  log?: (msg: string) => void;
}

export class Room {
  readonly id: string;
  readonly worldShape: WorldPart[];
  tick = 0;

  private readonly seats = new Map<string, Seat>();
  private readonly cubes: CubeState[];
  private readonly rng: Rng;
  private readonly onEmpty?: () => void;
  private readonly log: (msg: string) => void;
  private timer: unknown = null;
  private nextPlayerId = 1;

  constructor(id: string, opts: RoomOptions = {}) {
    this.id = id;
    this.worldShape = opts.worldShape ?? WORLD_SHAPE;
    this.rng = createRng(opts.seed ?? (Math.random() * 2 ** 32) >>> 0);
    this.cubes = createCubes(CUBE_IDS, this.worldShape, this.rng);
    this.onEmpty = opts.onEmpty;
    this.log = opts.log ?? (() => {});
  }

  get playerCount(): number {
    return this.seats.size;
  }

  get players(): PlayerState[] {
    return [...this.seats.values()].map((s) => s.state);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), 1000 / TICK_RATE);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // Seats a new player and sends them the world. Returns null when the room is full.
  join(rawName: string, link: ClientLink): string | null {
    if (this.seats.size >= MAX_PLAYERS) {
      link.send({ t: 'error', message: 'room is full' });
      return null;
    }
    const id = `p${this.nextPlayerId++}`;
    const state = createPlayer(id, sanitizeName(rawName), this.pickColor(), this.spawnPoint());
    this.seats.set(id, { state, link, queue: [] });
    link.send({ t: 'welcome', id, room: this.id, tick: this.tick, players: this.players, cubes: this.cubeSnapshot() });
    this.broadcast({ t: 'join', p: state }, id);
    this.log(`${state.name} (${id}) joined ${this.id}, ${this.seats.size} online`);
    return id;
  }

  leave(id: string): void {
    const seat = this.seats.get(id);
    if (!seat) return;
    this.seats.delete(id);
    this.broadcast({ t: 'leave', id, name: seat.state.name });
    this.log(`${seat.state.name} (${id}) left ${this.id}, ${this.seats.size} online`);
    if (this.seats.size === 0) this.onEmpty?.();
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
        if (text) this.broadcast({ t: 'chat', id, name: seat.state.name, color: seat.state.color, text });
        return;
      }
      case 'ping':
        seat.link.send({ t: 'pong', at: msg.at });
        return;
    }
  }

  step(): void {
    for (const seat of this.seats.values()) {
      const n = Math.min(seat.queue.length, MAX_INPUTS_PER_TICK);
      if (n === 0) {
        stepPlayer(seat.state, null, TICK_DT, this.worldShape);
        continue;
      }
      for (let i = 0; i < n; i++) stepPlayer(seat.state, seat.queue[i], TICK_DT, this.worldShape);
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

  private spawnPoint() {
    const a = this.rng() * Math.PI * 2;
    const r = 1 + this.rng() * 3;
    return { x: Math.cos(a) * r, y: 1.7, z: Math.sin(a) * r };
  }
}

export function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/[\u0000-\u001f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
  return cleaned || 'guest';
}

export function isValidRoomId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,23}$/.test(id);
}
