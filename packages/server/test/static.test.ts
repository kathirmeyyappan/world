// The static handler's caching: Vite's hashed output is kept for good, everything else is checked
// against its modification time on every load, since a texture keeps its name when it is redrawn.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createStaticHandler } from '../src/static';

test('hashed build files are cached for good, the rest revalidated', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'world-static-'));
  mkdirSync(join(dir, 'assets/textures'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<html><head></head></html>');
  writeFileSync(join(dir, 'assets/Game-DXWI046V.js'), '');
  writeFileSync(join(dir, 'assets/textures/skin.png'), 'png');
  const server = createServer(createStaticHandler(dir));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = (path: string) => `http://127.0.0.1:${address.port}${path}`;
  try {
    const hashed = await fetch(url('/assets/Game-DXWI046V.js'));
    assert.equal(hashed.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const skin = await fetch(url('/assets/textures/skin.png'));
    assert.equal(skin.headers.get('cache-control'), 'no-cache');
    const since = skin.headers.get('last-modified');
    assert.ok(since);
    const unchanged = await fetch(url('/assets/textures/skin.png'), { headers: { 'if-modified-since': since } });
    assert.equal(unchanged.status, 304);
  } finally {
    server.close();
  }
});
