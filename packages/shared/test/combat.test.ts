import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EYE_HEIGHT, GUN_RANGE, createPlayer, findHit, lookDirection } from '@world/shared';

const at = (id: string, x: number, z: number) => createPlayer(id, id, '#fff', { x, y: EYE_HEIGHT, z });

test('lookDirection matches the camera: yaw 0 is +z, positive pitch looks down', () => {
  const d = lookDirection(0, 0);
  assert.ok(Math.abs(d.z - 1) < 1e-9 && Math.abs(d.x) < 1e-9);
  assert.ok(lookDirection(Math.PI / 2, 0).x > 0.999);
  assert.ok(lookDirection(0, 0.5).y < 0);
});

test('findHit picks the nearest live player in front, within range and radius', () => {
  const me = at('me', 0, 0);
  const near = at('near', 0, 10);
  const far = at('far', 0, 20);
  const wide = at('wide', 1.2, 10);
  const behind = at('behind', 0, -5);
  assert.equal(findHit(me, [far, near, wide, behind])?.id, 'near');
  assert.equal(findHit(me, [wide, behind]), null, 'more than the hit radius off the line, or behind');

  me.yaw = Math.atan2(1.2, 10);
  assert.equal(findHit(me, [wide])?.id, 'wide', 'turning toward them hits');

  const dead = at('dead', 0, 10);
  dead.dead = true;
  assert.equal(findHit(at('me', 0, 0), [dead]), null, 'the dead are not targets');
  assert.equal(findHit(at('me', 0, 0), [at('x', 0, GUN_RANGE + 2)]), null, 'out of range');
  assert.equal(findHit(at('me', 0, 0), [at('x', 0.3, 5)])?.id, 'x', 'slightly off centre still counts');
});
