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

export function createStaticHandler(dir: string) {
  const index = readFileSync(join(dir, 'index.html'), 'utf8');

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
      const size = statSync(file).size;
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'content-length': size,
        'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' });
      res.end(index);
    }
  };
}
