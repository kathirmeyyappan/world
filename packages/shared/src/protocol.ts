// Wire format between client and room host. JSON for now; small enough that it doesn't matter yet.
import type { InputFrame, PlayerState } from './sim/types';

export interface CubeSnapshot {
  id: string;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
}

export type ClientMessage =
  | { t: 'input'; f: InputFrame }
  | { t: 'chat'; text: string }
  | { t: 'ping'; at: number };

export type ServerMessage =
  | { t: 'welcome'; id: string; room: string; tick: number; players: PlayerState[]; cubes: CubeSnapshot[] }
  | { t: 'snap'; tick: number; players: PlayerState[]; cubes: CubeSnapshot[] }
  | { t: 'join'; p: PlayerState }
  | { t: 'leave'; id: string; name: string }
  | { t: 'chat'; id: string; name: string; color: string; text: string }
  | { t: 'pong'; at: number }
  | { t: 'error'; message: string };

export function isClientMessage(v: unknown): v is ClientMessage {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  switch (m.t) {
    case 'input': {
      const f = m.f as Record<string, unknown> | undefined;
      return (
        !!f &&
        Number.isInteger(f.seq) &&
        isNum(f.mx) && isNum(f.my) && isNum(f.yaw) && isNum(f.pitch) &&
        typeof f.jump === 'boolean' &&
        (f.reading === null || typeof f.reading === 'string')
      );
    }
    case 'chat':
      return typeof m.text === 'string';
    case 'ping':
      return isNum(m.at);
    default:
      return false;
  }
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
