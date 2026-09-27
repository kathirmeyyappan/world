import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EYE_HEIGHT, ITEMS, createPlayer, findHit, lookDirection } from '@world/shared';

const GUN = ITEMS.gun.range;

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
  assert.equal(findHit(me, [far, near, wide, behind], GUN)?.id, 'near');
  assert.equal(findHit(me, [wide, behind], GUN), null, 'more than the hit radius off the line, or behind');

  me.yaw = Math.atan2(1.2, 10);
  assert.equal(findHit(me, [wide], GUN)?.id, 'wide', 'turning toward them hits');

  const dead = at('dead', 0, 10);
  dead.dead = true;
  assert.equal(findHit(at('me', 0, 0), [dead], GUN), null, 'the dead are not targets');
  assert.equal(findHit(at('me', 0, 0), [at('x', 0, GUN + 2)], GUN), null, 'out of gun range');
  assert.equal(findHit(at('me', 0, 0), [at('x', 0, GUN + 2)], ITEMS.sniper.range)?.id, 'x', 'the sniper reaches it');
  assert.equal(findHit(at('me', 0, 0), [at('x', 0.3, 5)], GUN)?.id, 'x', 'slightly off centre still counts');
});
