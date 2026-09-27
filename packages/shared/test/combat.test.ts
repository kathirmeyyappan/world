import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EYE_HEIGHT, ITEMS, createPlayer, findHit, lookDirection, resolveFire } from '@world/shared';

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
  assert.equal(findHit(me, [far, near, wide, behind], GUN)?.target.id, 'near');
  assert.equal(findHit(me, [wide, behind], GUN), null, 'more than the hit radius off the line, or behind');

  me.yaw = Math.atan2(1.2, 10);
  assert.equal(findHit(me, [wide], GUN)?.target.id, 'wide', 'turning toward them hits');

  const dead = at('dead', 0, 10);
  dead.dead = true;
  assert.equal(findHit(at('me', 0, 0), [dead], GUN), null, 'the dead are not targets');
  assert.equal(findHit(at('me', 0, 0), [at('x', 0, GUN + 2)], GUN), null, 'out of gun range');
  assert.equal(findHit(at('me', 0, 0), [at('x', 0, GUN + 2)], ITEMS.sniper.range)?.target.id, 'x', 'the sniper reaches it');
  assert.equal(findHit(at('me', 0, 0), [at('x', 0.3, 5)], GUN)?.target.id, 'x', 'slightly off centre still counts');
});

test('where the shot lands decides a headshot: eye level is the head, the chest is not', () => {
  const me = at('me', 0, 0);
  const x = at('x', 0, 6);
  assert.equal(findHit(me, [x], GUN)?.headshot, true, 'a level shot hits them between the eyes');
  me.pitch = Math.atan2(0.8, 6); // aim 0.8 m below their eyes
  assert.equal(findHit(me, [x], GUN)?.headshot, false, 'chest');
  me.pitch = Math.atan2(1.5, 6);
  assert.equal(findHit(me, [x], GUN)?.headshot, false, 'legs');
});

test('resolveFire: hitscan picks one, a cone takes everyone inside it', () => {
  const me = at('me', 0, 0);
  const near = at('near', 0, 4);
  const beside = at('beside', 1.5, 6);
  const far = at('far', 0, 12);
  const wide = at('wide', 5, 6);
  assert.deepEqual(resolveFire(ITEMS.gun, me, [near, beside, far, wide]).map((h) => h.target.id), ['near']);
  assert.deepEqual(resolveFire(ITEMS.flamethrower, me, [near, beside, far, wide]).map((h) => h.target.id).sort(), ['beside', 'near']);
  assert.ok(resolveFire(ITEMS.flamethrower, me, [near]).every((h) => !h.headshot), 'no headshots from a cone');
});
