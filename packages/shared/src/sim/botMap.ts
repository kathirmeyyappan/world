// The world as the Python bots (modal-bots/) see it: the structures, for line of sight, and a graph
// of where a player can walk, for finding a way anywhere (up the tower's stair included). Bots run
// no sim of their own, so the graph is worked out here with the real one: every walkable spot on a
// 1 m grid is a node, and an edge joins two neighbouring nodes when stepPlayer, walking straight
// from one, arrives at the other; where only a running jump gets there (over the tower stair's
// rail onto a floor), that's a jump edge. `npm run bot-map` writes it, gzipped, to
// modal-bots/common/world_map.json.gz; it carries a fingerprint of everything it was built from,
// and a test fails when that no longer matches, so a change to the world regenerates it.
import {
  EYE_HEIGHT,
  GRAVITY,
  JUMP_VELOCITY,
  MOVE_SPEED,
  PLAYER_PADDING,
  PLAYER_RADIUS,
  STEP_DOWN,
  STEP_UP,
  TICK_DT,
} from './constants';
import { CAPSULE_TOP } from './health';
import { createPlayer, isGrounded, stepPlayer } from './player';
import { createRng, hashSeed } from './rng';
import { surfaceOf, type Structure } from './structures';
import type { Vec3 } from './types';
import { WORLD_SHAPE, WORLD_STRUCTURES, worldBounds, worldDistance } from './world';

const SPACING = 1; // metres between grid columns: under a doorway's clear width (1.2 m less a body)
const WALL_CLEARANCE = 0.05; // metres a node's body may be pushed by a wall before it doesn't count
const MAX_RISE = 1.5; // metres between neighbouring nodes worth trying an edge across
const SIGHT_CHECKS = 64;

export interface BotMap {
  source: number; // botMapSource() when it was built
  structures: Structure[]; // as content/structures.ts lists them, without their looks
  nodes: [number, number, number][]; // feet x, y, z
  edges: number[][]; // per node, the nodes a player walking straight from it reaches
  jumps: number[][]; // per node, the ones only a running jump toward them reaches
  // Segments the sim answered for (a x, y, z, b x, y, z, 1 when nothing stands between): the
  // Python side's line of sight is checked against these.
  sightChecks: number[][];
}

// A fingerprint of what the map depends on: the world's outline and structures, the body and
// movement constants, and this file's own settings.
export function botMapSource(): number {
  const physics = [
    EYE_HEIGHT,
    CAPSULE_TOP,
    PLAYER_RADIUS,
    PLAYER_PADDING,
    STEP_UP,
    STEP_DOWN,
    MOVE_SPEED,
    GRAVITY,
    JUMP_VELOCITY,
  ];
  const settings = [SPACING, WALL_CLEARANCE, MAX_RISE, SIGHT_CHECKS];
  return hashSeed(JSON.stringify([WORLD_SHAPE, shapes(), physics, settings]));
}

// The structures without their looks, which nothing here depends on.
function shapes(): Structure[] {
  return WORLD_STRUCTURES.list.map(({ material: _m, color: _c, ...shape }) => shape);
}

export function buildBotMap(): BotMap {
  const nodes = walkableNodes();
  const columns = new Map<string, number[]>();
  nodes.forEach((n, i) => {
    const key = columnKey(n.x, n.z);
    const list = columns.get(key);
    if (list) list.push(i);
    else columns.set(key, [i]);
  });
  const edges: number[][] = [];
  const jumps: number[][] = [];
  for (const a of nodes) {
    const walk: number[] = [];
    const jump: number[] = [];
    for (const [di, dj] of NEIGHBOURS)
      for (const j of columns.get(columnKey(a.x + di * SPACING, a.z + dj * SPACING)) ?? []) {
        if (Math.abs(nodes[j].y - a.y) > MAX_RISE) continue;
        if (reaches(a, nodes[j], false)) walk.push(j);
        else if (reaches(a, nodes[j], true)) jump.push(j);
      }
    edges.push(walk);
    jumps.push(jump);
  }
  return {
    source: botMapSource(),
    structures: shapes(),
    nodes: nodes.map((n) => [n.x, Math.round(n.y * 100) / 100, n.z]),
    edges,
    jumps,
    sightChecks: sightChecks(nodes),
  };
}

const NEIGHBOURS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

// Every grid column's standing heights: the floor and each top there that a player settles on
// (nothing higher within a step), with room for their head and not inside or against a wall.
function walkableNodes(): Vec3[] {
  const b = worldBounds();
  const nodes: Vec3[] = [];
  for (let x = Math.ceil(b.minX / SPACING) * SPACING; x <= b.maxX; x += SPACING) {
    for (let z = Math.ceil(b.minZ / SPACING) * SPACING; z <= b.maxZ; z += SPACING) {
      if (worldDistance(x, z) > -PLAYER_PADDING) continue;
      const heights = new Set([0, ...WORLD_STRUCTURES.list.flatMap((s) => topAt(s, x, z))]);
      for (const y of heights) {
        if (Math.abs(WORLD_STRUCTURES.groundAt(x, z, y + STEP_UP) - y) > 1e-9) continue;
        const ceiling = WORLD_STRUCTURES.ceilingAt(x, z, y + 1e-6);
        if (ceiling < y + EYE_HEIGHT + CAPSULE_TOP) continue;
        const pos = { x, y: y + EYE_HEIGHT, z };
        WORLD_STRUCTURES.move(pos, 0, 0, { head: pos.y + CAPSULE_TOP, reach: y + STEP_UP, radius: PLAYER_RADIUS });
        if (Math.hypot(pos.x - x, pos.z - z) > WALL_CLEARANCE) continue;
        nodes.push({ x, y, z });
      }
    }
  }
  return nodes;
}

// The height of a structure's top over (x, z), if its footprint covers it.
function topAt(s: Structure, x: number, z: number): number[] {
  const dx = x - s.x;
  const dz = z - s.z;
  const r = (s.w + s.d) / 2; // over the half-diagonal, so a cheap test that rejects most
  if (Math.abs(dx) > r || Math.abs(dz) > r) return [];
  const yaw = s.yaw ?? 0;
  const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  if (Math.abs(lx) > s.w / 2 || Math.abs(lz) > s.d / 2) return [];
  return [(s.y ?? 0) + surfaceOf(s).top(lx, lz)];
}

// Whether a player heading straight for b from a at full speed (jumping as they set off, if
// `jump`) and letting go once past b's column comes to stand there: within a hand of its line, at
// its height, in about the time the walk and a jump take.
function reaches(a: Vec3, b: Vec3, jump: boolean): boolean {
  const p = createPlayer('map', 'map', '#000', { x: a.x, y: a.y + EYE_HEIGHT, z: a.z });
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const frame = (my: number, jumping: boolean) => ({
    seq: 0,
    mx: 0,
    my,
    yaw,
    pitch: 0,
    jump: jumping,
    reading: null,
    actions: [],
  });
  const ticks =
    2 * Math.ceil(length / (MOVE_SPEED * TICK_DT)) + (jump ? Math.ceil((2 * JUMP_VELOCITY) / GRAVITY / TICK_DT) : 0);
  let along = 0;
  for (let tick = 0; tick < ticks; tick++) {
    stepPlayer(p, along < length ? frame(1, jump && tick === 0) : frame(0, false), TICK_DT);
    along = ((p.pos.x - a.x) * (b.x - a.x) + (p.pos.z - a.z) * (b.z - a.z)) / length;
    if (along < length || p.vy !== 0 || !isGrounded(p)) continue;
    const off = Math.abs((p.pos.x - a.x) * (b.z - a.z) - (p.pos.z - a.z) * (b.x - a.x)) / length;
    return off < 0.2 && along < length + 0.4 && Math.abs(p.pos.y - EYE_HEIGHT - b.y) < 0.3;
  }
  return false;
}

// Eye-to-eye segments between nodes on or around the structures, half of them blocked.
function sightChecks(nodes: Vec3[]): number[][] {
  const rng = createRng(1);
  const near = nodes.filter((n) => n.y > 0 || WORLD_STRUCTURES.groundAt(n.x, n.z, Infinity) > 0);
  const checks: number[][] = [];
  const counts = [0, 0];
  while (checks.length < SIGHT_CHECKS) {
    const [a, b] = [0, 1].map(() => near[Math.floor(rng() * near.length)]);
    const from = { x: a.x, y: a.y + EYE_HEIGHT, z: a.z };
    const to = { x: b.x, y: b.y + EYE_HEIGHT, z: b.z };
    const clear = WORLD_STRUCTURES.clear(from, to) ? 1 : 0;
    if (counts[clear] >= SIGHT_CHECKS / 2) continue;
    counts[clear]++;
    checks.push([from.x, from.y, from.z, to.x, to.y, to.z, clear]);
  }
  return checks;
}

function columnKey(x: number, z: number): string {
  return `${Math.round(x / SPACING)},${Math.round(z / SPACING)}`;
}
