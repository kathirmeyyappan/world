// Serves the built client from STATIC_DIR when hosted on Modal, so the page and the WebSocket
// share an origin and the proxy's session cookie applies to both. Unset in local dev (Vite serves).
import { readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

// Vite's build output is named for its content (`Game-DXWI046V.js`), so it can be kept for good;
// anything else under /assets/ (textures, sounds, pictures) keeps its name when it changes, so it is
// checked against its modification time on every load.
const HASHED = /^\/assets\/[^/]+-[\w-]{8}\.[\w.]+$/;

// The page is served with the lobby's URL in a meta tag when the host knows it, so a tab that
// didn't arrive through the lobby (a pasted URL) can still reach it to join a room.
export function createStaticHandler(dir: string, lobbyUrl = '') {
  const meta = lobbyUrl ? `<meta name="world-lobby" content="${escapeAttr(lobbyUrl)}" />` : '';
  const index = readFileSync(join(dir, 'index.html'), 'utf8').replace('</head>', `${meta}</head>`);

  return (req: IncomingMessage, res: ServerResponse): void => {
    const path = normalize(new URL(req.url ?? '/', 'http://x').pathname).replace(/^(\.\.[/\\])+/, '');
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' });
      res.end(index);
      return;
    }
    const file = join(dir, path);
    if (!file.startsWith(dir)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const { size, mtime } = statSync(file);
      const modified = Math.floor(mtime.getTime() / 1000); // HTTP dates have whole seconds
      if (modified <= Math.floor(Date.parse(req.headers['if-modified-since'] ?? '') / 1000)) {
        res.writeHead(304).end();
        return;
      }
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'content-length': size,
        'last-modified': mtime.toUTCString(),
        'cache-control': HASHED.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' });
      res.end(index);
    }
  };
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
