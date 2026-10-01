import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CUBE_IDS,
  EYE_HEIGHT,
  HEADSHOT_MULTIPLIER,
  ITEMS,
  MAX_HEARTS,
  MAX_PLAYERS,
  MAX_REWIND_TICKS,
  MOVE_SPEED,
  Room,
  Structures,
  TICK_DT,
  TICK_RATE,
  worldDistance,
  defaultBotsFor,
  type BotRequest,
  type InputFrame,
  type ItemAction,
  type ServerMessage,
} from '@world/shared';

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

  room.receive(ida, {
    t: 'input',
    f: { seq: 1, mx: 0, my: 1, yaw: 0, pitch: 0, jump: false, reading: 'aws', actions: [] },
  });
  room.receive(ida, {
    t: 'input',
    f: { seq: 1, mx: 0, my: 1, yaw: 0, pitch: 0, jump: false, reading: null, actions: [] },
  });
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

test('players spawn at random spots across the main area only, clear of its wall', () => {
  const room = new Room('spawn', { seed: 3 });
  const spots: { x: number; z: number }[] = [];
  for (let i = 0; i < 30; i++) {
    const l = link();
    const id = room.join(`p${i}`, l)!;
    const me = l.inbox[0].t === 'welcome' ? l.inbox[0].players.find((p) => p.id === id)! : null;
    assert.ok(me);
    spots.push({ x: me.pos.x, z: me.pos.z });
    assert.ok(Math.hypot(me.pos.x, me.pos.z) <= 50 - 3 + 1e-9, 'in the main disc, clear of its wall');
    room.leave(id);
  }
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
  assert.equal(bob.hearts, MAX_HEARTS - ITEMS.gun.damage, "a body shot takes the gun's damage");
  assert.ok(!bob.dead, 'bob is directly ahead but not dead yet');
  assert.ok(
    b.inbox.some(
      (m) => m.t === 'hit' && m.victim === idb && m.shooter === ida && m.damage === 2 && !m.headshot && m.hearts === 8,
    ),
  );
  while (!bob.dead) {
    for (let i = 0; i < ITEMS.gun.cooldownTicks; i++) room.step();
    press(room, ida, chest, false);
  }
  assert.equal(bob.hearts, 0);
  assert.equal(b.inbox.filter((m) => m.t === 'hit').length, 5, 'ten hearts, two a shot');
  assert.ok(b.inbox.some((m) => m.t === 'kill' && m.victim === idb && m.shooter === ida));
  assert.ok(
    b.inbox.some((m) => m.t === 'kill' && m.item === 'gun' && !m.headshot),
    'the kill says what did it',
  );
  assert.equal(alice.kills, 1, 'and counts for the shooter');
  assert.equal(bob.kills, 0);

  const before = { ...bob.pos };
  room.receive(idb, {
    t: 'input',
    f: { seq: 1, mx: 0, my: 1, yaw: 0, pitch: 0, jump: true, reading: null, actions: [] },
  });
  room.step();
  assert.deepEqual(bob.pos, before, 'dead players cannot move or jump');

  const c = link();
  room.join('carol', c);
  const welcome = c.inbox[0];
  assert.ok(welcome.t === 'welcome' && welcome.players.find((p) => p.id === idb)!.dead, 'late joiners see who is dead');
});

test("lag compensation: a shot is judged where the target was on the shooter's screen", () => {
  const room = new Room('rewind', { seed: 5 });
  const ida = room.join('alice', link())!;
  const idb = room.join('bob', link())!;
  const alice = room.players.find((p) => p.id === ida)!;
  const bob = room.players.find((p) => p.id === idb)!;
  room.receive(ida, { t: 'chat', text: '/gun' });
  const chest = Math.atan2(0.8, 8);
  const shoot = (view?: number) => {
    room.receive(ida, { t: 'input', f: { ...frame(chest, ['shoot']), view } });
    room.step();
    room.receive(ida, { t: 'input', f: frame(chest, []) });
    for (let i = 0; i < ITEMS.gun.cooldownTicks; i++) room.step();
  };

  // Bob is dead ahead at tick `seen`, then strafes 6 ticks at run speed: 1.6 m to the side.
  bob.pos = { x: alice.pos.x, y: alice.pos.y, z: alice.pos.z + 8 };
  room.step();
  const seen = room.tick;
  for (let i = 0; i < 6; i++) {
    bob.pos = { ...bob.pos, x: bob.pos.x + MOVE_SPEED * TICK_DT };
    room.step();
  }

  shoot(seen);
  assert.equal(bob.hearts, MAX_HEARTS - ITEMS.gun.damage, 'alice saw bob dead ahead: a hit');
  shoot();
  assert.equal(bob.hearts, MAX_HEARTS - ITEMS.gun.damage, 'no view: judged against now, and bob has moved on');
  assert.ok(room.tick - seen > MAX_REWIND_TICKS);
  shoot(seen);
  assert.equal(bob.hearts, MAX_HEARTS - ITEMS.gun.damage, 'too far back to rewind: clamped, so it misses');
});

test('weapon command shortcuts equip the matching item', () => {
  const room = new Room('item-shortcuts', { seed: 6 });
  const playerId = room.join('alice', link())!;
  const player = room.players.find((candidate) => candidate.id === playerId)!;

  for (const [command, item] of [
    ['/g', 'gun'],
    ['/ft', 'flamethrower'],
  ] as const) {
    room.receive(playerId, { t: 'chat', text: command });
    assert.equal(player.item?.id, item);
  }
  room.receive(playerId, { t: 'chat', text: '/jp' });
  assert.equal(player.gear?.id, 'jetpack', 'gear goes on beside the weapon');
  assert.equal(player.item?.id, 'flamethrower');
});

test('hearts: walking into one heals 3 up to full, a full player leaves it, and it comes back 30 s later', () => {
  const welcome = link();
  new Room('default-hearts', { seed: 1 }).join('a', welcome);
  assert.equal(welcome.inbox[0].t === 'welcome' && welcome.inbox[0].pickups.length, 14, 'the world starts with 14');

  const area = {
    region: { kind: 'disc', x: 0, z: 0, r: 4, y: 0 },
    kind: 'heart',
    count: 1,
    respawnSeconds: 30,
  } as const;
  const room = new Room('hearts', { seed: 2, structures: new Structures([]), pickupAreas: [area] });
  const a = link();
  const id = room.join('alice', a)!;
  const alice = room.players.find((p) => p.id === id)!;
  const hearts = () => {
    const snap = [...a.inbox].reverse().find((m) => m.t === 'snap');
    return snap?.t === 'snap' ? snap.pickups : [];
  };
  room.step();
  const [heart] = hearts();
  Object.assign(alice.pos, { x: heart.x, z: heart.z });
  room.step();
  assert.equal(hearts().length, 1, 'full health: left where it is');
  alice.hearts = 8.5;
  room.step();
  assert.equal(alice.hearts, MAX_HEARTS, 'healed, capped at full');
  assert.equal(hearts().length, 0);
  for (let i = 0; i < TICK_RATE * 30; i++) room.step();
  assert.equal(hearts().length, 1, 'another 30 s later');
});

test('a hard landing hurts like a shot with no shooter, and a fatal one is announced as a fall', () => {
  const room = new Room('falls', { seed: 3, structures: new Structures([]) });
  const a = link();
  const id = room.join('alice', a)!;
  const alice = room.players.find((p) => p.id === id)!;
  const fall = (feet: number) => {
    alice.pos.y = feet + EYE_HEIGHT;
    for (let i = 0; i < TICK_RATE * 3; i++) room.step();
  };
  fall(41);
  assert.deepEqual(
    a.inbox.find((m) => m.t === 'hit'),
    { t: 'hit', shooter: null, victim: id, damage: 5, headshot: false, hearts: MAX_HEARTS - 5 },
  );
  fall(14);
  assert.equal(alice.hearts, MAX_HEARTS - 5, 'under 15 m is free');
  fall(70);
  assert.ok(alice.dead);
  assert.ok(a.inbox.some((m) => m.t === 'fell' && m.victim === id));
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
  const bLink = {
    ...link(),
    close: () => {
      closed = true;
    },
  };
  const ida = room.join('alice', a)!;
  const idb = room.join('bot', bLink)!;
  const alice = room.players.find((p) => p.id === ida)!;
  const bot = room.players.find((p) => p.id === idb)!;
  bot.pos = { x: alice.pos.x, y: alice.pos.y, z: alice.pos.z + 5 };
  room.receive(ida, { t: 'chat', text: '/sniper' });
  press(room, ida, 0, true);
  assert.ok(bot.dead, 'a scoped sniper headshot');
  for (let i = 0; i < 30 * 12; i++) room.step();
  assert.ok(
    room.players.some((p) => p.id === idb),
    'still a corpse at 12 s',
  );
  for (let i = 0; i < 30 * 2; i++) room.step();
  assert.ok(!room.players.some((p) => p.id === idb), 'gone after the death screen would have reloaded');
  assert.ok(closed, 'its socket was closed');
  assert.ok(
    a.inbox.some((m) => m.t === 'leave' && m.id === idb),
    'everyone saw it leave',
  );
});

test('avatars: /elizabeth is for good; ELIZABETH in the name locks the look', () => {
  const room = new Room('av', { seed: 1 });
  const a = link();
  const b = link();
  const ida = room.join('ELIZABETHann', a)!;
  const idb = room.join('bob', b)!;
  const ann = room.players.find((p) => p.id === ida)!;
  const bob = room.players.find((p) => p.id === idb)!;
  assert.equal(ann.avatar, 'elizabeth');
  assert.ok(ann.avatarLocked);
  assert.equal(bob.avatar, 'standard');
  assert.ok(!bob.avatarLocked);

  room.receive(idb, { t: 'chat', text: '/elizabeth' });
  assert.equal(bob.avatar, 'elizabeth');
  assert.ok(a.inbox.some((m) => m.t === 'system' && m.text === 'bob is now elizabeth'));
  for (let i = 0; i < 30 * 120; i++) room.step();
  assert.equal(bob.avatar, 'elizabeth', 'no timer: still elizabeth two minutes later');
  assert.equal(bob.item, null, 'looks change nothing else');
  room.receive(idb, { t: 'chat', text: '/elizabeth' });
  assert.deepEqual(b.inbox.at(-1), { t: 'system', text: "you're already elizabeth" });
  room.receive(idb, { t: 'chat', text: '/standard' });
  assert.equal(bob.avatar, 'standard', 'and back by choice');

  room.receive(idb, { t: 'chat', text: '/sahur' });
  assert.deepEqual(b.inbox.at(-1), { t: 'system', text: 'unknown command /sahur' }, 'a look goes by its command');
  room.receive(idb, { t: 'chat', text: '/tung' });
  assert.equal(bob.avatar, 'sahur');
  room.receive(ida, { t: 'chat', text: '/standard' });
  assert.deepEqual(a.inbox.at(-1), { t: 'system', text: "you're elizabeth for good" });
  assert.equal(ann.avatar, 'elizabeth');
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

test('flamethrower: hold to spray a 20 m cone, 0.5 hearts every 5 ticks, on a 7.5 s tank that takes 25 s to refill', () => {
  const room = new Room('flame', { seed: 9 });
  const a = link();
  const ida = room.join('alice', a)!;
  const idb = room.join('bob', link())!;
  const idc = room.join('carol', link())!;
  const idd = room.join('dave', link())!;
  const [alice, bob, carol, dave] = [ida, idb, idc, idd].map((id) => room.players.find((p) => p.id === id)!);
  bob.pos = { x: alice.pos.x + 1.5, y: alice.pos.y, z: alice.pos.z + 6 }; // 14 degrees off axis: in the cone
  carol.pos = { x: alice.pos.x, y: alice.pos.y, z: alice.pos.z + 22 }; // straight ahead but past 20 m
  dave.pos = { x: alice.pos.x + 5, y: alice.pos.y, z: alice.pos.z + 6 }; // 40 degrees off: outside

  room.receive(ida, { t: 'chat', text: '/flamethrower' });
  assert.deepEqual(alice.item, { id: 'flamethrower', left: 45, permanent: false, fuel: 7.5 });
  hold(room, ida, 30);
  assert.equal(bob.hearts, MAX_HEARTS - 3, 'six 0.5 ticks in a second (ticks 0, 5, 10, 15, 20, 25)');
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

test('bots are flagged at join, never keep a room open, and are dropped when it closes', () => {
  let empties = 0;
  let botClosed = false;
  const room = new Room('bots', { seed: 4, onEmpty: () => empties++ });
  let botCloseReason = '';
  const bot = {
    ...link(),
    close: (reason: string) => {
      botClosed = true;
      botCloseReason = reason;
    },
  };
  assert.equal(room.join('circle-bot', bot, { bot: true }), null, 'a bot never starts a room on its own');
  assert.deepEqual(bot.inbox.at(-1), { t: 'error', message: 'no one here' });
  const ida = room.join('alice', link())!;
  const idb = room.join('circle-bot', bot, { bot: true })!;
  assert.equal(room.players.find((p) => p.id === idb)!.bot, true);
  assert.equal(room.players.find((p) => p.id === ida)!.bot, false);
  assert.equal(room.humanCount, 1);
  assert.equal(room.playerCount, 2);

  room.leave(ida);
  assert.equal(empties, 1, 'the last person leaving empties the room even with a bot seated');
  room.stop();
  assert.ok(botClosed, 'closing the room disconnects the bot');
  assert.equal(botCloseReason, 'room closed', 'and says why, unlike a corpse (dead)');
  assert.equal(room.playerCount, 0);
});

test("a bot stands where it asks, looking how it asks; a person can't choose", () => {
  const room = new Room('placed', { seed: 4 });
  const human = room.join('alice', link(), { spawn: { x: 5, y: 0, z: 5 }, avatar: 'elizabeth' })!;
  const alice = room.players.find((p) => p.id === human)!;
  assert.notDeepEqual([alice.pos.x, alice.pos.z], [5, 5]);
  assert.equal(alice.avatar, 'standard');

  const onFloor = room.join('stalker-bot', link(), { bot: true, spawn: { x: 112, y: 20, z: 0 }, avatar: 'elizabeth' })!;
  const stalker = room.players.find((p) => p.id === onFloor)!;
  assert.deepEqual(stalker.pos, { x: 112, y: 20 + EYE_HEIGHT, z: 0 }, "on the tower's first floor");
  assert.equal(stalker.avatar, 'elizabeth');
  assert.ok(stalker.avatarLocked, 'and stays that way');

  const outside = room.join('circle-bot', link(), { bot: true, spawn: { x: 0, y: 30, z: 500 } })!;
  const lost = room.players.find((p) => p.id === outside)!;
  assert.ok(worldDistance(lost.pos.x, lost.pos.z) <= -1 + 1e-9, 'clamped inside the outline');
  assert.equal(lost.pos.y, EYE_HEIGHT, 'and standing on what is under it');
});

test('/kill-bots drops every living bot where it stands, people only', () => {
  const room = new Room('cull', { seed: 4 });
  const a = link();
  const ida = room.join('alice', a)!;
  const bots = [link(), link()].map((l) => {
    let closed = '';
    const id = room.join('circle-bot', { ...l, close: (reason: string) => (closed = reason) }, { bot: true })!;
    return { id, l, closed: () => closed };
  });
  room.receive(bots[0].id, { t: 'chat', text: '/kill-bots' });
  assert.deepEqual(bots[0].l.inbox.at(-1), { t: 'system', text: "bots can't kill bots" });

  room.receive(ida, { t: 'chat', text: '/kill-bots' });
  assert.ok(room.players.filter((p) => p.bot).every((p) => p.dead && p.hearts === 0));
  assert.ok(!room.players.find((p) => p.id === ida)!.dead);
  assert.deepEqual(a.inbox.at(-1), { t: 'system', text: 'alice killed circle-bot x2' });
  room.receive(ida, { t: 'chat', text: '/kill-bots' });
  assert.deepEqual(a.inbox.at(-1), { t: 'system', text: 'no bots here' });

  for (let i = 0; i <= 5 * TICK_RATE; i++) room.step();
  assert.equal(room.playerCount, 1, 'corpses are dropped like any bot corpse');
  assert.ok(
    bots.every((b) => b.closed() === 'dead'),
    'which ends each bot run',
  );
});

test("the first person in brings the room's default bots; nobody else does", async () => {
  const spawned: BotRequest[] = [];
  const room = new Room('sess-d', {
    seed: 4,
    spawnBot: async (req) => {
      spawned.push(req);
    },
  });
  assert.equal(
    room.join('circle-bot', link(), { bot: true, room: 'global' }),
    null,
    'a bot alone is refused, so it never triggers them',
  );
  const a = link();
  room.join('alice', a, { room: 'global' });
  await Promise.resolve();
  const expected = defaultBotsFor('global').map(({ bot, seconds, ...placement }) => ({
    bot,
    room: 'global',
    seconds,
    caller: 'room',
    ...placement,
  }));
  assert.deepEqual(spawned, expected, 'placements ride along with the request');
  assert.ok(a.inbox.some((m) => m.t === 'system' && m.text === 'circle-bot x2, stalker-bot x3 on the way'));
  room.join('bob', link(), { room: 'global' });
  room.join('circle-bot', link(), { bot: true, room: 'global' });
  await Promise.resolve();
  assert.equal(spawned.length, expected.length, 'only the first person');

  const quiet = new Room('sess-q', { seed: 4 });
  assert.ok(quiet.join('carol', link(), { room: 'global' }), 'no spawner: joins fine, no bots');
});

test('/circle-bot asks the host to start a bot in this room; people only, default 300 s, full room', async () => {
  const spawned: BotRequest[] = [];
  let fail = false;
  const room = new Room('sess-1', {
    seed: 4,
    spawnBot: async (req) => {
      if (fail) throw new Error('modal down');
      spawned.push(req);
    },
  });
  const a = link();
  const ida = room.join('alice', a, { room: 'late-night' })!;
  const b = link();
  const idb = room.join('circle-bot', b, { bot: true, room: 'late-night' })!;
  await Promise.resolve();
  spawned.length = 0; // alice's arrival spawned the room's default bots; this test is about calls

  const alice = room.players.find((p) => p.id === ida)!;
  Object.assign(alice.pos, { x: 112, z: 0 }); // the middle of the annex, 62 m from the main disc's edge
  room.receive(ida, { t: 'chat', text: '/circle-bot 60' });
  await Promise.resolve();
  const { spawn: _, ...call } = spawned[0];
  assert.deepEqual(call, { bot: 'circle', room: 'late-night', seconds: 60, caller: 'alice' });
  assert.ok(
    b.inbox.some((m) => m.t === 'system' && m.text === 'alice called circle-bot for 60s'),
    'everyone hears',
  );

  room.receive(ida, { t: 'chat', text: '/stalker' });
  await Promise.resolve();
  assert.equal(spawned[1].seconds, 300, "no number: the bot's default");
  room.receive(ida, { t: 'chat', text: '/circle 9999' });
  await Promise.resolve();
  assert.equal(spawned[2].seconds, 3500, 'capped');
  for (const { spawn } of spawned) {
    assert.ok(spawn && Math.hypot(spawn.x - 112, spawn.z) <= 50, `a called bot spawns near the caller: ${spawn?.x}`);
  }
  room.receive(ida, { t: 'chat', text: '/circle-bot soon' });
  assert.deepEqual(a.inbox.at(-1), { t: 'system', text: 'usage: /circle-bot [seconds]' });

  room.receive(idb, { t: 'chat', text: '/circle-bot' });
  assert.deepEqual(b.inbox.at(-1), { t: 'system', text: "bots can't call bots" });

  // no bot cap: the only limit is the room's seats
  while (room.playerCount < MAX_PLAYERS) room.join('bot', link(), { bot: true });
  room.receive(ida, { t: 'chat', text: '/stalker-bot' });
  assert.deepEqual(a.inbox.at(-1), { t: 'system', text: 'this room is full' });
  assert.equal(spawned.length, 3);

  fail = true;
  const c = link();
  const room2 = new Room('sess-2', {
    seed: 1,
    spawnBot: async () => {
      throw new Error('modal down');
    },
  });
  const idc = room2.join('carol', c, { room: 'x' })!;
  room2.receive(idc, { t: 'chat', text: '/circle-bot' });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(c.inbox.at(-1), { t: 'system', text: "couldn't call circle-bot" });

  const d = link();
  const room3 = new Room('sess-3', { seed: 1 });
  const idd = room3.join('dave', d, { room: 'x' })!;
  room3.receive(idd, { t: 'chat', text: '/circle-bot' });
  assert.deepEqual(d.inbox.at(-1), { t: 'system', text: "bots can't be called in this room" });
});

test('a bot corpse lingers for 5 s while a browser gets the full death screen', () => {
  const room = new Room('corpses', { seed: 5 });
  const ida = room.join('SNIPERalice', link())!;
  let botClosed = false;
  const idb = room.join(
    'circle-bot',
    {
      ...link(),
      close: () => {
        botClosed = true;
      },
    },
    { bot: true },
  )!;
  let humanClosed = false;
  const idc = room.join('bob', {
    ...link(),
    close: () => {
      humanClosed = true;
    },
  })!;
  const [alice, bot, bob] = [ida, idb, idc].map((id) => room.players.find((p) => p.id === id)!);
  bot.pos = { x: alice.pos.x, y: alice.pos.y, z: alice.pos.z + 5 };
  press(room, ida, 0, true);
  assert.ok(bot.dead, 'sniper headshot');
  bob.pos = { x: alice.pos.x, y: alice.pos.y, z: alice.pos.z + 5 };
  for (let i = 0; i < ITEMS.sniper.cooldownTicks; i++) room.step();
  press(room, ida, 0, true);
  assert.ok(bob.dead);

  for (let i = 0; i < 30 * 3; i++) room.step();
  assert.ok(!botClosed, 'the bot corpse is still visible before 5 s');
  assert.ok(!humanClosed, 'the browser corpse is still visible');

  for (let i = 0; i < 30 * 2; i++) room.step();
  assert.ok(botClosed, "the bot's connection was closed after about 5 s");
  assert.ok(!room.players.some((p) => p.id === idb), "the bot's corpse is gone");
  assert.ok(!humanClosed, 'the browser still has time to use its death screen');

  for (let i = 0; i < 30 * 9; i++) room.step();
  assert.ok(humanClosed, "the browser's fallback cleanup eventually closed it");
});
