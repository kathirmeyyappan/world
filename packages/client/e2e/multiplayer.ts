// End-to-end check: starts the room server and Vite, opens two browsers in the same room, walks
// one forward, and asserts the other sees it. Leaves screenshots in e2e/out/.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const out = join(here, 'out');
const SERVER_PORT = 8790;
const CLIENT_PORT = 5190;
const ROOM = 'e2e';

function start(cmd: string, args: string[], cwd: string, ready: string, env: Record<string, string> = {}): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (d: Buffer) => {
      if (d.toString().includes(ready)) resolve(proc);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.stderr.on('data', (d: Buffer) => process.stderr.write(`[${args[args.length - 1] ?? cmd}] ${d}`));
    proc.on('exit', (code) => reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`)));
  });
}

async function debug(page: Page) {
  return page.evaluate(() => (window as unknown as { __world: { debug: () => { id: string; pos: { x: number; z: number }; remotes: { id: string; name: string; x: number; z: number }[] } } }).__world.debug());
}

async function main() {
  mkdirSync(out, { recursive: true });
  const server = await start(process.execPath, ['--import', 'tsx', 'packages/server/src/index.ts'], root, 'listening', { PORT: String(SERVER_PORT) });
  const client = await start(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--port', String(CLIENT_PORT), '--strictPort'], join(root, 'packages/client'), 'Local:', {
    VITE_ROOM_WS_URL: `ws://localhost:${SERVER_PORT}/ws`,
  });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const open = async (name: string) => {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.error(`[${name} pageerror]`, e.message));
      await page.goto(`http://localhost:${CLIENT_PORT}/?room=${ROOM}&name=${name}`);
      await page.waitForFunction(() => !!(window as unknown as { __world?: unknown }).__world);
      await page.waitForFunction(() => document.querySelectorAll('#player-list li').length >= 1);
      return page;
    };
    const alice = await open('alice');
    const bob = await open('bob');
    await bob.waitForFunction(() => document.querySelectorAll('#player-list li').length === 2);
    await alice.waitForFunction(() => document.querySelectorAll('#player-list li').length === 2);
    console.log('both players seated');

    const fps = await alice.evaluate<number>('new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); })');
    console.log(`alice renders at ~${fps} fps`);
    const before = await debug(alice);
    await alice.keyboard.down('KeyW');
    await alice.waitForTimeout(1500);
    await alice.keyboard.up('KeyW');
    await alice.waitForTimeout(400);
    const after = await debug(alice);
    const moved = Math.hypot(after.pos.x - before.pos.x, after.pos.z - before.pos.z);
    console.log(`alice predicted move: ${moved.toFixed(2)}m`);
    if (moved < 2) throw new Error('alice did not move');

    const seenByBob = (await debug(bob)).remotes.find((r) => r.name === 'alice');
    if (!seenByBob) throw new Error('bob does not see alice');
    const err = Math.hypot(seenByBob.x - after.pos.x, seenByBob.z - after.pos.z);
    console.log(`bob sees alice at (${seenByBob.x.toFixed(2)}, ${seenByBob.z.toFixed(2)}), ${err.toFixed(2)}m from her predicted spot`);
    if (err > 1) throw new Error('bob sees alice far from where she is');

    // Turn bob to face alice so she is on screen, then chat.
    const bobState = await debug(bob);
    const yaw = Math.atan2(after.pos.x - bobState.pos.x, after.pos.z - bobState.pos.z);
    await bob.evaluate((y) => {
      const w = window as unknown as { __world: { setLook?: (y: number) => void } };
      w.__world.setLook?.(y);
    }, yaw);
    await alice.keyboard.press('Enter');
    await alice.keyboard.type('hi bob');
    await alice.keyboard.press('Enter');
    await bob.waitForFunction(() => document.querySelector('#chat-log')?.textContent?.includes('hi bob'));
    console.log('chat delivered');

    await bob.waitForTimeout(300);
    await alice.screenshot({ path: join(out, 'alice.png') });
    await bob.screenshot({ path: join(out, 'bob.png') });
    console.log(`screenshots in ${out}`);
  } finally {
    await browser.close();
    client.kill();
    server.kill();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
