import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EYE_HEIGHT,
  GEAR,
  ITEMS,
  JUMP_VELOCITY,
  SCOPED_SPEED_MULTIPLIER,
  SPEEDY_MULTIPLIER,
  SPEEDY_SECONDS,
  STEP_UP,
  TICK_DT,
  TICK_RATE,
  WORLD_SHAPE,
  Structures,
  building,
  clonePlayer,
  createCubes,
  createGear,
  createItem,
  createPlayer,
  fallDamage,
  createRng,
  ramp,
  stairs,
  stepCubes,
  stepPlayer,
  worldDistance,
  type InputFrame,
} from '@world/shared';

const frame = (seq: number, over: Partial<InputFrame> = {}): InputFrame => ({
  seq,
  mx: 0,
  my: 0,
  yaw: 0,
  pitch: 0,
  jump: false,
  reading: null,
  actions: [],
  ...over,
});

test('stepPlayer is deterministic: same inputs give identical state', () => {
  const a = createPlayer('a', 'a', '#fff', { x: 0, y: EYE_HEIGHT, z: 0 });
  const b = clonePlayer(a);
  for (let i = 1; i <= 100; i++) {
    const f = frame(i, { mx: Math.sin(i), my: Math.cos(i), yaw: i * 0.01, jump: i % 30 === 0 });
    stepPlayer(a, f, TICK_DT, WORLD_SHAPE);
    stepPlayer(b, f, TICK_DT, WORLD_SHAPE);
  }
  assert.deepEqual(a, b);
});

test('movement is yaw-relative and clamped to the world edge', () => {
  const p = createPlayer('a', 'a', '#fff', { x: 0, y: EYE_HEIGHT, z: 0 });
  stepPlayer(p, frame(1, { my: 1, yaw: Math.PI / 2 }), 1, WORLD_SHAPE);
  assert.ok(p.pos.x > 7.9 && Math.abs(p.pos.z) < 1e-9, 'yaw of pi/2 walks along +x');
  for (let i = 2; i < 200; i++) stepPlayer(p, frame(i, { my: 1, yaw: Math.PI / 2 }), 1, WORLD_SHAPE);
  assert.ok(worldDistance(p.pos.x, p.pos.z, WORLD_SHAPE) <= -1 + 1e-9);
});

test('jump only from the ground, and gravity brings you back', () => {
  const p = createPlayer('a', 'a', '#fff', { x: 0, y: EYE_HEIGHT, z: 0 });
  stepPlayer(p, frame(1, { jump: true }), TICK_DT, WORLD_SHAPE);
  assert.ok(p.vy > 0 && p.vy < JUMP_VELOCITY);
  stepPlayer(p, frame(2, { jump: true }), TICK_DT, WORLD_SHAPE);
  assert.ok(p.vy < JUMP_VELOCITY - 2 * 20 * TICK_DT + 1e-9, 'mid-air jump ignored');
  for (let i = 3; i < 200; i++) stepPlayer(p, null, TICK_DT, WORLD_SHAPE);
  assert.equal(p.pos.y, EYE_HEIGHT);
  assert.equal(p.vy, 0);
});

test('cubes stay inside the world and spawn apart', () => {
  const rng = createRng(42);
  const cubes = createCubes(['a', 'b', 'c', 'd', 'e', 'f'], WORLD_SHAPE, rng);
  for (let i = 0; i < cubes.length; i++)
    for (let j = i + 1; j < cubes.length; j++)
      assert.ok(Math.hypot(cubes[i].pos.x - cubes[j].pos.x, cubes[i].pos.z - cubes[j].pos.z) >= 7.9);
  for (let t = 0; t < 30 * 60 * 5; t++) stepCubes(cubes, TICK_DT, WORLD_SHAPE, rng);
  for (const c of cubes) assert.ok(worldDistance(c.pos.x, c.pos.z, WORLD_SHAPE) < -7);
});

test('the annex is reachable only through the bridge', () => {
  // Walking +x along z=0 goes through the bridge into the second disc.
  const via = createPlayer('a', 'a', '#fff', { x: 0, y: EYE_HEIGHT, z: 0 });
  for (let i = 1; i < 30 * 20; i++) stepPlayer(via, frame(i, { my: 1, yaw: Math.PI / 2 }), TICK_DT, WORLD_SHAPE);
  assert.ok(via.pos.x > 100, `reached the annex at x=${via.pos.x.toFixed(1)}`);
  assert.ok(worldDistance(via.pos.x, via.pos.z, WORLD_SHAPE) <= -1 + 1e-9);

  // The straight line from off-axis to the annex crosses open space that isn't world.
  assert.ok(worldDistance(56, 10, WORLD_SHAPE) > 0);

  // Aiming at the annex from off-axis hits the main disc's wall, slides along it and can only
  // get across by being funnelled into the bridge: whenever x is between the discs, z is inside
  // the bridge's width.
  const off = createPlayer('b', 'b', '#fff', { x: 0, y: EYE_HEIGHT, z: 20 });
  const yaw = Math.atan2(112 - 0, 0 - 20); // toward the annex centre
  for (let i = 1; i < 30 * 30; i++) {
    stepPlayer(off, frame(i, { my: 1, yaw }), TICK_DT, WORLD_SHAPE);
    assert.ok(worldDistance(off.pos.x, off.pos.z, WORLD_SHAPE) <= -1 + 1e-6, `inside at tick ${i}`);
    if (off.pos.x > 51 && off.pos.x < 81) assert.ok(Math.abs(off.pos.z) <= 3 + 1e-6, `on the bridge at tick ${i}`);
  }
});

test('cubes all live in the main disc and cover it evenly', () => {
  const rng = createRng(7);
  const cubes = createCubes(['a', 'b', 'c', 'd', 'e', 'f'], WORLD_SHAPE, rng);
  const quadrants = new Set<string>();
  for (let t = 0; t < 30 * 60 * 10; t++) {
    stepCubes(cubes, TICK_DT, WORLD_SHAPE, rng);
    for (const c of cubes) {
      assert.ok(Math.hypot(c.pos.x, c.pos.z) <= 50 - 7.9, 'cube stays in the main disc');
      if (t % 30 === 0) quadrants.add(`${c.pos.x > 0}${c.pos.z > 0}${Math.hypot(c.pos.x, c.pos.z) > 25}`);
    }
  }
  assert.equal(quadrants.size, 8, 'over ten minutes the cubes visit every quadrant, inner and outer');
});

test('/speedy boost multiplies movement and wears off; a scope slows it and stops jumps', () => {
  const p = createPlayer('a', 'a', '#fff', { x: 0, y: EYE_HEIGHT, z: 0 });
  p.boost = SPEEDY_SECONDS;
  stepPlayer(p, frame(1, { my: 1 }), 1, WORLD_SHAPE);
  assert.ok(Math.abs(p.pos.z - 8 * SPEEDY_MULTIPLIER) < 1e-9, 'boosted for one second');
  for (let i = 2; i <= SPEEDY_SECONDS; i++) stepPlayer(p, frame(i, { my: 0 }), 1, WORLD_SHAPE);
  assert.equal(p.boost, 0);
  const before = p.pos.z;
  stepPlayer(p, frame(99, { my: 1 }), 0.1, WORLD_SHAPE);
  assert.ok(Math.abs(p.pos.z - before - 0.8) < 1e-9, 'back to normal speed');

  // Scoped: 30% of the walk, and the jump does nothing.
  p.item = createItem('sniper', false);
  const at = p.pos.z;
  stepPlayer(p, frame(100, { my: 1, jump: true, actions: ['scope'] }), 0.1, WORLD_SHAPE);
  assert.ok(Math.abs(p.pos.z - at - 0.8 * SCOPED_SPEED_MULTIPLIER) < 1e-9, 'scoped walk');
  assert.equal(p.vy, 0, 'no jump while scoped');
});

test('a fall costs a heart per 10 m from 20 m, in half hearts; a jetpack lifts and breaks the fall', () => {
  assert.deepEqual([19.9, 20, 27, 34.9].map(fallDamage), [0, 2, 2.5, 3]);
  const open = new Structures([]);
  // Dropped with feet 30 m up; `thrustBelow` holds the jetpack's thrust once the feet are that low.
  const drop = (thrustBelow: number) => {
    const p = createPlayer('a', 'a', '#fff', { x: 0, y: 30 + EYE_HEIGHT, z: 0 });
    p.gear = createGear('jetpack');
    for (let i = 1; i < 300; i++) {
      const low = p.pos.y - EYE_HEIGHT < thrustBelow;
      const fell = stepPlayer(p, frame(i, { actions: low ? ['thrust'] : [] }), TICK_DT, WORLD_SHAPE, open);
      if (fell) return fell;
    }
    return 0;
  };
  assert.ok(Math.abs(drop(0) - 30) < 0.1, `the whole 30 m: ${drop(0)}`);
  assert.ok(drop(3) < 3, 'thrusting in the last 3 m: the fall starts there');

  const p = createPlayer('b', 'b', '#fff', { x: 0, y: EYE_HEIGHT, z: 0 });
  p.gear = createGear('jetpack');
  const fly = (ticks: number) => {
    for (let i = 0; i < ticks; i++)
      stepPlayer(p, frame(p.lastSeq + 1, { actions: ['thrust'] }), TICK_DT, WORLD_SHAPE, open);
  };
  fly(TICK_RATE);
  assert.ok(p.pos.y - EYE_HEIGHT > 5 && p.vy <= GEAR.jetpack.maxRise, `a second of thrust climbs: ${p.pos.y}`);
  fly(TICK_RATE * GEAR.jetpack.fuelSeconds);
  assert.equal(p.gear?.fuel, 0);
  assert.ok(!p.thrusting && p.vy < 0, 'an empty tank drops them');
});

test('a timed item wears off after its window; a permanent one never does', () => {
  const p = createPlayer('a', 'a', '#fff', { x: 0, y: EYE_HEIGHT, z: 0 });
  p.item = { id: 'gun', left: ITEMS.gun.seconds, permanent: false, fuel: null };
  for (let i = 1; i <= ITEMS.gun.seconds - 1; i++) stepPlayer(p, null, 1, WORLD_SHAPE);
  assert.ok(p.item, 'still armed just before the window ends');
  stepPlayer(p, null, 1, WORLD_SHAPE);
  assert.equal(p.item, null);

  const q = createPlayer('b', 'SNIPERb', '#fff', { x: 0, y: EYE_HEIGHT, z: 0 });
  for (let i = 0; i < 1000; i++) stepPlayer(q, null, 1, WORLD_SHAPE);
  assert.deepEqual(q.item, { id: 'sniper', left: 0, permanent: true, fuel: null });
});

// Structures: walk into a wall, up a ramp onto a platform, off its far end, and jump under a roof.
const walk = (p: ReturnType<typeof createPlayer>, yaw: number, ticks: number, world: Structures, jump = false) => {
  for (let i = 0; i < ticks; i++)
    stepPlayer(p, frame(p.lastSeq + 1, { my: 1, yaw, jump }), TICK_DT, WORLD_SHAPE, world);
};

test('a wall stops a player, who slides along it', () => {
  const world = new Structures([{ kind: 'box', x: 0, z: 5, w: 20, d: 0.4, h: 3 }]);
  const p = createPlayer('a', 'a', '#fff', { x: 0, y: EYE_HEIGHT, z: 0 });
  walk(p, 0, 60, world);
  assert.ok(p.pos.z < 5 - 0.2 - 0.3, `stopped short of the wall, at z ${p.pos.z}`);
  walk(p, Math.PI / 4, 30, world);
  assert.ok(p.pos.x > 3 && p.pos.z < 4.5, 'walking into it at an angle slides along it');
});

test('a ramp carries a player up onto a platform, and they drop off its far edge', () => {
  const world = new Structures([
    ramp({ x: 0, z: 2 }, { x: 0, z: 10 }, 2, 3),
    { kind: 'box', x: 0, z: 12, w: 3, d: 4, h: 2 },
  ]);
  const p = createPlayer('a', 'a', '#fff', { x: 0, y: EYE_HEIGHT, z: 0 });
  walk(p, 0, 36, world); // about 9.6 m, most of the way up
  assert.ok(p.pos.y > EYE_HEIGHT + 1.5 && p.vy === 0, `standing on the slope at y ${p.pos.y}`);
  walk(p, 0, 12, world);
  assert.equal(p.pos.y, 2 + EYE_HEIGHT, 'on the platform');
  walk(p, 0, 30, world);
  assert.equal(p.pos.y, EYE_HEIGHT, 'off the end and back on the floor');
});

test('a roof stops a jump and a doorway lets a player in', () => {
  const world = new Structures(building({ x: 0, z: 0, w: 8, d: 8, h: 2.4, door: 2, doorHeight: 2.2 }));
  const p = createPlayer('a', 'a', '#fff', { x: 0, y: EYE_HEIGHT, z: 8 });
  walk(p, Math.PI, 45, world); // in through the door in the +z wall
  assert.ok(p.pos.z < 2, `inside, at z ${p.pos.z}`);
  let top = 0;
  for (let i = 0; i < 30; i++) {
    stepPlayer(p, frame(p.lastSeq + 1, { jump: i === 0 }), TICK_DT, WORLD_SHAPE, world);
    top = Math.max(top, p.pos.y + 0.3);
  }
  assert.ok(top <= 2.4 + 1e-9, `head stopped at the roof, reached ${top}`);
});

test('walking climbs stairs without a jump, and a taller step stops you', () => {
  const up = new Structures(stairs({ x: 0, z: 2 }, { x: 0, z: 5 }, 2, 2));
  const p = createPlayer('a', 'a', '#fff', { x: 0, y: EYE_HEIGHT, z: 0 });
  walk(p, 0, 18, up); // 4.8 m: onto the top step, which spans 4.63-5
  assert.equal(p.pos.y, 2 + EYE_HEIGHT);
  const tall = new Structures([{ kind: 'box', x: 0, z: 2, w: 2, d: 2, h: STEP_UP + 0.05 }]);
  const q = createPlayer('b', 'b', '#fff', { x: 0, y: EYE_HEIGHT, z: 0 });
  walk(q, 0, 17, tall);
  assert.ok(q.pos.y === EYE_HEIGHT && q.pos.z < 1, 'blocked at its edge');
  assert.throws(() => stairs({ x: 0, z: 0 }, { x: 0, z: 1 }, 2, 1, 2), /over/);
});
