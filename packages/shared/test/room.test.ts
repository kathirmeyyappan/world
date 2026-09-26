import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room, type ServerMessage } from '@world/shared';

function link() {
  const inbox: ServerMessage[] = [];
  return { inbox, send: (m: ServerMessage) => inbox.push(m) };
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

  room.receive(ida, { t: 'input', f: { seq: 1, mx: 0, my: 1, yaw: 0, pitch: 0, jump: false, reading: 'aws' } });
  room.receive(ida, { t: 'input', f: { seq: 1, mx: 0, my: 1, yaw: 0, pitch: 0, jump: false, reading: null } });
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
  assert.equal(snap.cubes.length, 6);

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
