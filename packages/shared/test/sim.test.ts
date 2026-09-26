import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EYE_HEIGHT, JUMP_VELOCITY, TICK_DT, WORLD_RADIUS,
  clonePlayer, createCubes, createPlayer, createRng, stepCubes, stepPlayer,
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
    stepPlayer(a, f, TICK_DT, WORLD_RADIUS);
    stepPlayer(b, f, TICK_DT, WORLD_RADIUS);
  }
  assert.deepEqual(a, b);
});

test('movement is yaw-relative and clamped to the world edge', () => {
  const p = createPlayer('a', 'a', '#fff', { x: 0, y: EYE_HEIGHT, z: 0 });
  stepPlayer(p, frame(1, { my: 1, yaw: Math.PI / 2 }), 1, WORLD_RADIUS);
  assert.ok(p.pos.x > 7.9 && Math.abs(p.pos.z) < 1e-9, 'yaw of pi/2 walks along +x');
  for (let i = 2; i < 200; i++) stepPlayer(p, frame(i, { my: 1, yaw: Math.PI / 2 }), 1, WORLD_RADIUS);
  assert.ok(Math.hypot(p.pos.x, p.pos.z) <= WORLD_RADIUS - 1 + 1e-9);
});

test('jump only from the ground, and gravity brings you back', () => {
  const p = createPlayer('a', 'a', '#fff', { x: 0, y: EYE_HEIGHT, z: 0 });
  stepPlayer(p, frame(1, { jump: true }), TICK_DT, WORLD_RADIUS);
  assert.ok(p.vy > 0 && p.vy < JUMP_VELOCITY);
  stepPlayer(p, frame(2, { jump: true }), TICK_DT, WORLD_RADIUS);
  assert.ok(p.vy < JUMP_VELOCITY - 2 * 20 * TICK_DT + 1e-9, 'mid-air jump ignored');
  for (let i = 3; i < 200; i++) stepPlayer(p, null, TICK_DT, WORLD_RADIUS);
  assert.equal(p.pos.y, EYE_HEIGHT);
  assert.equal(p.vy, 0);
});

test('cubes stay inside the world and spawn apart', () => {
  const rng = createRng(42);
  const cubes = createCubes(['a', 'b', 'c', 'd', 'e', 'f'], WORLD_RADIUS, rng);
  for (let i = 0; i < cubes.length; i++)
    for (let j = i + 1; j < cubes.length; j++)
      assert.ok(Math.hypot(cubes[i].pos.x - cubes[j].pos.x, cubes[i].pos.z - cubes[j].pos.z) >= 7.9);
  for (let t = 0; t < 30 * 60 * 5; t++) stepCubes(cubes, TICK_DT, WORLD_RADIUS, rng);
  for (const c of cubes) assert.ok(Math.hypot(c.pos.x, c.pos.z) < WORLD_RADIUS - 7);
});
