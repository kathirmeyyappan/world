// Spins up the real server on a random port and drives it with two ws clients.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import WebSocket from 'ws';
import { defaultBotsFor, type BotRequest, type ServerMessage } from '@world/shared';

async function startServer(port: number, env: Record<string, string> = {}) {
  const proc = spawn(process.execPath, ['--import', 'tsx', new URL('../src/index.ts', import.meta.url).pathname], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve) => {
    proc.stdout.on('data', (d: Buffer) => {
      if (d.toString().includes('listening')) resolve();
    });
  });
  return proc;
}

function connect(port: number, room: string, name: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${room}&name=${name}`);
  const inbox: ServerMessage[] = [];
  ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
  const next = (pred: (m: ServerMessage) => boolean, timeoutMs = 3000) =>
    new Promise<ServerMessage>((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const poll = () => {
        const i = inbox.findIndex(pred);
        if (i >= 0) return resolve(inbox.splice(0, i + 1)[i]);
        if (Date.now() > deadline) return reject(new Error('timed out waiting for message'));
        setTimeout(poll, 10);
      };
      poll();
    });
  return { ws, next, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

test('two clients in one room see each other move', async () => {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const proc = await startServer(port);
  try {
    const a = connect(port, 'e2e', 'alice');
    const b = connect(port, 'e2e', 'bob');
    await Promise.all([once(a.ws, 'open'), once(b.ws, 'open')]);

    const wa = await a.next((m) => m.t === 'welcome');
    const wb = await b.next((m) => m.t === 'welcome');
    assert.equal(wa.t, 'welcome');
    assert.equal(wb.t, 'welcome');
    if (wa.t !== 'welcome' || wb.t !== 'welcome') return;
    assert.equal(wb.players.length, 2);

    for (let seq = 1; seq <= 30; seq++) {
      a.send({ t: 'input', f: { seq, mx: 0, my: 1, yaw: 0, pitch: 0, jump: false, reading: null, actions: [] } });
    }
    const snap = await b.next((m) => m.t === 'snap' && m.players.some((p) => p.id === wa.id && p.lastSeq >= 30), 5000);
    if (snap.t !== 'snap') return;
    const start = wa.players.find((p) => p.id === wa.id)!.pos;
    const alice = snap.players.find((p) => p.id === wa.id)!;
    const walked = alice.pos.z - start.z;
    assert.ok(walked > 7 && walked < 9, `30 frames at 8 m/s should walk ~8 m forward, got ${walked}`);

    a.send({ t: 'chat', text: 'hi bob' });
    const chat = await b.next((m) => m.t === 'chat');
    assert.equal(chat.t === 'chat' && chat.text, 'hi bob');

    a.ws.close();
    const leave = await b.next((m) => m.t === 'leave');
    assert.equal(leave.t === 'leave' && leave.id, wa.id);
    b.ws.close();
  } finally {
    proc.kill();
  }
});

test('/circle-bot posts the room request to the bot sidecar', async () => {
  const received: { url?: string; body: BotRequest }[] = [];
  const sidecar = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ url: req.url, body: JSON.parse(body) });
      res.writeHead(202).end('fc-test');
    });
  });
  await new Promise<void>((r) => sidecar.listen(0, '127.0.0.1', r));
  const sidecarPort = (sidecar.address() as { port: number }).port;
  const port = 18790 + Math.floor(Math.random() * 100);
  const proc = await startServer(port, { BOT_SPAWNER_URL: `http://127.0.0.1:${sidecarPort}/bots` });
  try {
    const a = connect(port, 'late-night', 'kathir');
    await a.next((m) => m.t === 'welcome');
    a.send({ t: 'chat', text: '/circle-bot 60' });
    const said = await a.next((m) => m.t === 'system' && m.text.includes('called'));
    assert.equal(said.t === 'system' && said.text, 'kathir called circle-bot for 60s');
    // the first person in brings the room's default bots (sim/defaultBots.ts), then the call
    const defaults = defaultBotsFor('late-night').map(({ bot, seconds, ...placement }) => ({
      url: '/bots',
      body: { bot, room: 'late-night', seconds, caller: 'room', ...placement },
    }));
    for (let i = 0; i < 50 && received.length <= defaults.length; i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(received.slice(0, -1), defaults);
    const { spawn: near, ...call } = received[received.length - 1].body;
    assert.deepEqual(call, { bot: 'circle', room: 'late-night', seconds: 60, caller: 'kathir' });
    assert.equal(typeof near?.x, 'number', 'a called bot spawns near its caller');
    a.ws.close();
  } finally {
    proc.kill();
    sidecar.close();
  }
});
