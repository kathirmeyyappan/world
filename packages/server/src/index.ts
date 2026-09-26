// Room server. One process hosts many rooms; a WebSocket is routed to a room by the session id
// that Modal's proxy stamps on the upgrade request, or by ?room= when running bare (local dev).
import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { Room, type ClientLink, type ServerMessage } from '@world/shared';
import { createStaticHandler } from './static';

const PORT = Number(process.env.PORT ?? 8787);
const SESSION_HEADER = 'x-modal-server-session-id';
const EMPTY_ROOM_GRACE_MS = 30_000;
const SIM_LATENCY_MS = Number(process.env.SIM_LATENCY_MS ?? 0);
const SIM_JITTER_MS = Number(process.env.SIM_JITTER_MS ?? 0);
const STATIC_DIR = process.env.STATIC_DIR;

const rooms = new Map<string, Room>();
const emptyTimers = new Map<string, NodeJS.Timeout>();

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

function roomFor(key: string): Room {
  const pending = emptyTimers.get(key);
  if (pending) {
    clearTimeout(pending);
    emptyTimers.delete(key);
  }
  let room = rooms.get(key);
  if (!room) {
    room = new Room(key, {
      log,
      onEmpty: () => {
        emptyTimers.set(
          key,
          setTimeout(() => {
            rooms.get(key)?.stop();
            rooms.delete(key);
            emptyTimers.delete(key);
            log(`room ${key} closed`);
          }, EMPTY_ROOM_GRACE_MS),
        );
      },
    });
    room.start();
    rooms.set(key, room);
    log(`room ${key} opened`);
  }
  return room;
}

function roomKey(req: IncomingMessage, url: URL): string {
  const session = req.headers[SESSION_HEADER];
  if (typeof session === 'string' && session) return session;
  return url.searchParams.get('room') || 'local';
}

function linkFor(ws: WebSocket): ClientLink {
  const raw = (msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  if (SIM_LATENCY_MS <= 0 && SIM_JITTER_MS <= 0) return { send: raw };
  return {
    send: (msg) => setTimeout(() => raw(msg), SIM_LATENCY_MS + Math.random() * SIM_JITTER_MS),
  };
}

const serveStatic = STATIC_DIR ? createStaticHandler(STATIC_DIR) : null;

const http = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  if (serveStatic) {
    serveStatic(req, res);
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true });

http.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const room = roomFor(roomKey(req, url));
    const id = room.join(url.searchParams.get('name') ?? '', linkFor(ws));
    if (!id) {
      ws.close(1008, 'room full');
      return;
    }
    let alive = true;
    ws.on('pong', () => (alive = true));
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 15_000);
    ws.on('message', (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      room.receive(id, parsed);
    });
    ws.on('close', () => {
      clearInterval(heartbeat);
      room.leave(id);
    });
    ws.on('error', (err) => log(`socket error for ${id}: ${err.message}`));
  });
});

http.listen(PORT, '0.0.0.0', () => {
  log(`room server listening on :${PORT}` + (STATIC_DIR ? ` serving ${STATIC_DIR}` : '') + (SIM_LATENCY_MS ? ` (simulated latency ${SIM_LATENCY_MS}+${SIM_JITTER_MS}ms)` : ''));
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    for (const room of rooms.values()) room.stop();
    wss.close();
    http.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
