import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CUBE_IDS, HEADSHOT_MULTIPLIER, ITEMS, MAX_HEARTS, Room, WORLD_SHAPE, worldDistance, type InputFrame, type ItemAction, type ServerMessage } from '@world/shared';

function link() {
  const inbox: ServerMessage[] = [];
  return { inbox, send: (m: ServerMessage) => inbox.push(m) };
}

let seq = 1000;
function frame(pitch: number, actions: ItemAction[]): InputFrame {
  return { seq: seq++, mx: 0, my: 0, yaw: 0, pitch, jump: false, reading: null, actions };
}

// One press of the shoot action: a tick with it held, then a tick released.
function press(room: Room, id: string, pitch = 0, scoped = false): void {
  room.receive(id, { t: 'input', f: frame(pitch, scoped ? ['scope', 'shoot'] : ['shoot']) });
  room.step();
  room.receive(id, { t: 'input', f: frame(pitch, scoped ? ['scope'] : []) });
  room.step();
}

// Hold the shoot action for `ticks` ticks.
function hold(room: Room, id: string, ticks: number, on = true): void {
  for (let i = 0; i < ticks; i++) {
    room.receive(id, { t: 'input', f: frame(0, on ? ['shoot'] : []) });
    room.step();
  }
}

test('room seats players, applies inputs on step, and broadcasts', () => {
  const room = new Room('t', { seed: 1 });
  const a = link();
  const b = link();
  const ida = room.join('  alice ', a)!;
  const idb = room.join('', b)!;
  assert.equal(a.inbox[0].t, 'welcome');
  assert.equal(b.inbox[0].t === 'welcome' && b.inbox[0].players.length, 2);
  assert.equal(a.inbox[1].t === 'join' && a.inbox[1].p.name, 'guest');

  room.receive(ida, { t: 'input', f: { seq: 1, mx: 0, my: 1, yaw: 0, pitch: 0, jump: false, reading: 'aws', actions: [] } });
  room.receive(ida, { t: 'input', f: { seq: 1, mx: 0, my: 1, yaw: 0, pitch: 0, jump: false, reading: null, actions: [] } });
  room.receive(ida, { t: 'nonsense' });
  const before = room.players.find((p) => p.id === ida)!.pos.z;
  room.step();
  const snap = b.inbox.at(-1)!;
  assert.equal(snap.t, 'snap');
  if (snap.t !== 'snap') return;
  const alice = snap.players.find((p) => p.id === ida)!;
  assert.ok(alice.pos.z > before);
  assert.equal(alice.lastSeq, 1);
  assert.equal(alice.reading, 'aws');
  assert.equal(snap.cubes.length, CUBE_IDS.length);

  room.leave(idb);
  assert.equal(a.inbox.at(-1)?.t, 'leave');
  assert.equal(room.playerCount, 1);
});

test('room calls onEmpty when the last player leaves', () => {
  let empty = 0;
  const room = new Room('t', { onEmpty: () => empty++ });
  const id = room.join('x', link())!;
  room.leave(id);
  assert.equal(empty, 1);
});

test('players spawn at random spots across the whole world, clear of walls', () => {
  const room = new Room('spawn', { seed: 3 });
  const spots: { x: number; z: number }[] = [];
  for (let i = 0; i < 30; i++) {
    const l = link();
    const id = room.join(`p${i}`, l)!;
    const me = l.inbox[0].t === 'welcome' ? l.inbox[0].players.find((p) => p.id === id)! : null;
    assert.ok(me);
    spots.push({ x: me.pos.x, z: me.pos.z });
    assert.ok(worldDistance(me.pos.x, me.pos.z, WORLD_SHAPE) <= -3 + 1e-9, 'inside, clear of the wall');
    room.leave(id);
  }
  assert.ok(spots.some((p) => p.x > 82), 'some spawn in the annex');
  assert.ok(spots.some((p) => p.x < 50), 'some spawn in the main disc');
  assert.ok(new Set(spots.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`)).size === spots.length, 'all different');
});

test('/speedy and /s boost the sender and tell everyone in grey', () => {
  const room = new Room('cmd', { seed: 1 });
  const a = link();
  const b = link();
  const ida = room.join('alice', a)!;
  room.join('bob', b);
  const alice = room.players.find((p) => p.id === ida)!;
  for (const command of ['/speedy', '/s']) {
    alice.boost = 0;
    room.receive(ida, { t: 'chat', text: command });
    assert.equal(alice.boost, 20);
  }
  const notice = b.inbox.at(-1)!;
  assert.deepEqual(notice, { t: 'system', text: 'alice increased their movement speed for 20s' });
  assert.ok(!b.inbox.some((m) => m.t === 'chat'), 'the command itself is not broadcast as chat');

  room.receive(ida, { t: 'chat', text: '/fly' });
  assert.deepEqual(a.inbox.at(-1), { t: 'system', text: 'unknown command /fly' });
  assert.notDeepEqual(b.inbox.at(-1), { t: 'system', text: 'unknown command /fly' }, 'only the sender is told');
});

test('/gun then shoot: the server resolves the hit, kills the target, and the dead stop moving', () => {
  const room = new Room('gun', { seed: 5 });
  const a = link();
  const b = link();
  const ida = room.join('alice', a)!;
  const idb = room.join('bob', b)!;
  const alice = room.players.find((p) => p.id === ida)!;
  const bob = room.players.find((p) => p.id === idb)!;
  bob.pos = { x: alice.pos.x, y: alice.pos.y, z: alice.pos.z + 8 };

  press(room, ida, 0, false);
  assert.ok(!bob.dead, 'nothing to shoot with yet');
  room.receive(ida, { t: 'chat', text: '/gun' });
  assert.deepEqual(alice.item, { id: 'gun', left: 45, permanent: false, fuel: null });
  const chest = Math.atan2(0.8, 8);
  press(room, ida, chest, false);
  assert.equal(bob.hearts, MAX_HEARTS - ITEMS.gun.damage, 'a body shot takes the gun\'s damage');
  assert.ok(!bob.dead, 'bob is directly ahead but not dead yet');
  assert.ok(b.inbox.some((m) => m.t === 'hit' && m.victim === idb && m.shooter === ida && m.damage === 2 && !m.headshot && m.hearts === 8));
  while (!bob.dead) {
    for (let i = 0; i < ITEMS.gun.cooldownTicks; i++) room.step();
    press(room, ida, chest, false);
  }
  assert.equal(bob.hearts, 0);
  assert.equal(b.inbox.filter((m) => m.t === 'hit').length, 5, 'ten hearts, two a shot');
  assert.ok(b.inbox.some((m) => m.t === 'kill' && m.victim === idb && m.shooter === ida));
  assert.ok(b.inbox.some((m) => m.t === 'kill' && m.item === 'gun' && !m.headshot), 'the kill says what did it');
  assert.equal(alice.kills, 1, 'and counts for the shooter');
  assert.equal(bob.kills, 0);

  const before = { ...bob.pos };
  room.receive(idb, { t: 'input', f: { seq: 1, mx: 0, my: 1, yaw: 0, pitch: 0, jump: true, reading: null, actions: [] } });
  room.step();
  assert.deepEqual(bob.pos, before, 'dead players cannot move or jump');

  const c = link();
  room.join('carol', c);
  const welcome = c.inbox[0];
  assert.ok(welcome.t === 'welcome' && welcome.players.find((p) => p.id === idb)!.dead, 'late joiners see who is dead');
});

test('weapon command shortcuts equip the matching item', () => {
  const room = new Room('item-shortcuts', { seed: 6 });
  const playerId = room.join('alice', link())!;
  const player = room.players.find((candidate) => candidate.id === playerId)!;

  for (const [command, item] of [['/g', 'gun'], ['/ft', 'flamethrower']] as const) {
    room.receive(playerId, { t: 'chat', text: command });
    assert.equal(player.item?.id, item);
  }
});

test('commands swap items freely, items time out, and the gun only reaches 20 m', () => {
  const room = new Room('items', { seed: 6 });
  const a = link();
  const b = link();
  const ida = room.join('alice', a)!;
  const idb = room.join('bob', b)!;
  const alice = room.players.find((p) => p.id === ida)!;
  const bob = room.players.find((p) => p.id === idb)!;
  bob.pos = { x: alice.pos.x, y: alice.pos.y, z: alice.pos.z + 25 };

  room.receive(ida, { t: 'chat', text: '/gun' });
  room.receive(ida, { t: 'chat', text: '/sniper' });
  assert.equal(alice.item?.id, 'sniper', 'swapped');
  assert.ok(b.inbox.some((m) => m.t === 'system' && m.text === 'alice swapped their gun for a sniper'));
  room.receive(ida, { t: 'chat', text: '/gun' });
  assert.equal(alice.item?.id, 'gun', 'and back');

  press(room, ida, 0, false);
  assert.equal(bob.hearts, MAX_HEARTS, '25 m is past the gun');

  for (let i = 0; i < 30 * 46; i++) room.step();
  assert.ok(alice.item === null, 'the gun wore off');
  room.receive(ida, { t: 'chat', text: '/sniper' });
  assert.equal(room.players.find((p) => p.id === ida)!.item?.id, 'sniper');
  press(room, ida, 0, false);
  assert.ok(!bob.dead, 'the sniper only fires while scoped');
  press(room, ida, 0, true);
  assert.ok(bob.dead, 'scoped, the sniper reaches 25 m');
});

test('a name containing GUN or SNIPER is armed permanently and can never swap', () => {
  const room = new Room('perm', { seed: 2 });
  const a = link();
  const ida = room.join('bigGUNner', a)!;
  const me = room.players.find((p) => p.id === ida)!;
  assert.deepEqual(me.item, { id: 'gun', left: 0, permanent: true, fuel: null });
  for (let i = 0; i < 30 * 60; i++) room.step();
  assert.equal(me.item?.id, 'gun', 'still armed a minute later');
  room.receive(ida, { t: 'chat', text: '/gun' });
  assert.deepEqual(a.inbox.at(-1), { t: 'system', text: 'bigGUNner already has a gun' });
  room.receive(ida, { t: 'chat', text: '/sniper' });
  assert.deepEqual(a.inbox.at(-1), { t: 'system', text: "you can't put down your gun" });
  assert.equal(me.item?.id, 'gun');

  const s = link();
  const ids = room.join('SNIPERGUN', s)!;
  assert.equal(room.players.find((p) => p.id === ids)!.item?.id, 'sniper', 'longer tag wins');
  const b = link();
  const idb = room.join('gunner', b)!;
  assert.equal(room.players.find((p) => p.id === idb)!.item, null, 'lowercase does not count');
});

test('a corpse that never rejoins is removed and its link closed', () => {
  const room = new Room('corpse', { seed: 5 });
  const a = link();
  let closed = false;
  const bLink = { ...link(), close: () => { closed = true; } };
  const ida = room.join('alice', a)!;
  const idb = room.join('bot', bLink)!;
  const alice = room.players.find((p) => p.id === ida)!;
  const bot = room.players.find((p) => p.id === idb)!;
  bot.pos = { x: alice.pos.x, y: alice.pos.y, z: alice.pos.z + 5 };
  room.receive(ida, { t: 'chat', text: '/sniper' });
  press(room, ida, 0, true);
  assert.ok(bot.dead, 'a scoped sniper headshot');
  for (let i = 0; i < 30 * 12; i++) room.step();
  assert.ok(room.players.some((p) => p.id === idb), 'still a corpse at 12 s');
  for (let i = 0; i < 30 * 2; i++) room.step();
  assert.ok(!room.players.some((p) => p.id === idb), 'gone after the death screen would have reloaded');
  assert.ok(closed, 'its socket was closed');
  assert.ok(a.inbox.some((m) => m.t === 'leave' && m.id === idb), 'everyone saw it leave');
});

test('avatars: ELIZABETH in the name is for keeps; /elizabeth lasts 60 s', () => {
  const room = new Room('av', { seed: 1 });
  const a = link();
  const b = link();
  const ida = room.join('ELIZABETHann', a)!;
  const idb = room.join('bob', b)!;
  const ann = room.players.find((p) => p.id === ida)!;
  const bob = room.players.find((p) => p.id === idb)!;
  assert.equal(ann.avatar, 'elizabeth');
  assert.equal(bob.avatar, 'standard');

  room.receive(idb, { t: 'chat', text: '/elizabeth' });
  assert.equal(bob.avatar, 'elizabeth');
  assert.ok(a.inbox.some((m) => m.t === 'system' && m.text === 'bob is now elizabeth for 60s'));
  for (let i = 0; i < 30 * 59; i++) room.step();
  assert.equal(bob.avatar, 'elizabeth', 'still elizabeth just before the minute is up');
  for (let i = 0; i < 30 * 2; i++) room.step();
  assert.equal(bob.avatar, 'standard', 'reverted on its own');
  assert.equal(bob.item, null, 'looks change nothing else');

  room.receive(idb, { t: 'chat', text: '/elizabeth' });
  room.receive(idb, { t: 'chat', text: '/standard' });
  assert.equal(bob.avatar, 'standard', '/standard ends it early');

  for (let i = 0; i < 30 * 120; i++) room.step();
  assert.equal(ann.avatar, 'elizabeth', 'the name tag never expires');
  room.receive(ida, { t: 'chat', text: '/standard' });
  assert.deepEqual(a.inbox.at(-1), { t: 'system', text: "you're elizabeth for good" });
  room.receive(ida, { t: 'chat', text: '/elizabeth' });
  assert.deepEqual(a.inbox.at(-1), { t: 'system', text: "you're already elizabeth" });
});

test('headshots do 2.5x: a gun takes 5 hearts, a scoped sniper to the head is a one-shot kill', () => {
  const room = new Room('head', { seed: 5 });
  const a = link();
  const ida = room.join('GUNalice', a)!;
  const idb = room.join('bob', link())!;
  const idc = room.join('SNIPERcarol', link())!;
  const [alice, bob, carol] = [ida, idb, idc].map((id) => room.players.find((p) => p.id === id)!);
  bob.pos = { x: alice.pos.x, y: alice.pos.y, z: alice.pos.z + 8 };
  carol.pos = { x: alice.pos.x, y: alice.pos.y, z: alice.pos.z - 30 };

  press(room, ida, 0, false);
  assert.equal(bob.hearts, MAX_HEARTS - ITEMS.gun.damage * HEADSHOT_MULTIPLIER);
  assert.ok(a.inbox.some((m) => m.t === 'hit' && m.headshot && m.damage === 5));

  press(room, idc, 0, true);
  assert.ok(alice.dead, 'sniper headshot: 4 x 2.5 = 10 hearts');
  assert.equal(alice.hearts, 0);
});

test('flamethrower: hold to spray a 10 m cone at 1 heart/s, on a 7.5 s tank that takes 25 s to refill', () => {
  const room = new Room('flame', { seed: 9 });
  const a = link();
  const ida = room.join('alice', a)!;
  const idb = room.join('bob', link())!;
  const idc = room.join('carol', link())!;
  const idd = room.join('dave', link())!;
  const [alice, bob, carol, dave] = [ida, idb, idc, idd].map((id) => room.players.find((p) => p.id === id)!);
  bob.pos = { x: alice.pos.x + 1.5, y: alice.pos.y, z: alice.pos.z + 6 }; // 14 degrees off axis: in the cone
  carol.pos = { x: alice.pos.x, y: alice.pos.y, z: alice.pos.z + 12 }; // straight ahead but past 10 m
  dave.pos = { x: alice.pos.x + 5, y: alice.pos.y, z: alice.pos.z + 6 }; // 40 degrees off: outside

  room.receive(ida, { t: 'chat', text: '/flamethrower' });
  assert.deepEqual(alice.item, { id: 'flamethrower', left: 45, permanent: false, fuel: 7.5 });
  hold(room, ida, 30);
  assert.equal(bob.hearts, MAX_HEARTS - 1, 'two 0.5 ticks in a second');
  assert.equal(carol.hearts, MAX_HEARTS, 'out of reach');
  assert.equal(dave.hearts, MAX_HEARTS, 'outside the cone');
  assert.ok(!a.inbox.some((m) => m.t === 'shot'), 'no muzzle event for a hold weapon');
  assert.ok(Math.abs(alice.item!.fuel! - 6.5) < 1e-6, 'a second of fuel burnt');
  assert.ok(alice.firing);

  hold(room, ida, 30 * 6.5);
  assert.ok(alice.item!.fuel! < 1e-6, 'tank empty');
  assert.ok(!alice.firing, 'and it stops');
  const before = bob.hearts;
  hold(room, ida, 30);
  assert.equal(bob.hearts, before, 'holding with an empty tank does nothing');

  hold(room, ida, 30 * 12.5, false);
  assert.ok(Math.abs(alice.item!.fuel! - 3.75) < 1e-6, '12.5 s off the trigger refills half');
  hold(room, ida, 30 * 13, false);
  assert.ok(Math.abs(alice.item!.fuel! - 7.5) < 1e-6, 'full at 25 s, no further');
});

test('a tap weapon fires once per press however long the key is held', () => {
  const room = new Room('tap', { seed: 3 });
  const ida = room.join('alice', link())!;
  const idb = room.join('bob', link())!;
  const [alice, bob] = [ida, idb].map((id) => room.players.find((p) => p.id === id)!);
  bob.pos = { x: alice.pos.x, y: alice.pos.y, z: alice.pos.z + 5 };
  room.receive(ida, { t: 'chat', text: '/gun' });
  hold(room, ida, 60);
  assert.equal(bob.hearts, MAX_HEARTS - 5, 'one headshot, not six');
});
