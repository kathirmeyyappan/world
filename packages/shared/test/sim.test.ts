import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EYE_HEIGHT, JUMP_VELOCITY, TICK_DT, WORLD_SHAPE,
  clonePlayer, createCubes, createPlayer, createRng, stepCubes, stepPlayer, worldDistance,
  type InputFrame,
} from '@world/shared';

const frame = (seq: number, over: Partial<InputFrame> = {}): InputFrame => ({
  seq, mx: 0, my: 0, yaw: 0, pitch: 0, jump: false, reading: null, ...over,
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

test('cubes are spread over both discs and never enter the bridge', () => {
  const rng = createRng(7);
  const cubes = createCubes(['a', 'b', 'c', 'd', 'e', 'f'], WORLD_SHAPE, rng);
  assert.ok(cubes.some((c) => c.pos.x > 70), 'some cube starts in the annex');
  assert.ok(cubes.some((c) => c.pos.x < 50), 'some cube starts in the main disc');
  for (let t = 0; t < 30 * 60 * 5; t++) {
    stepCubes(cubes, TICK_DT, WORLD_SHAPE, rng);
    for (const c of cubes) assert.ok(c.pos.x < 44 || c.pos.x > 88, 'cube is not on the bridge');
  }
});
