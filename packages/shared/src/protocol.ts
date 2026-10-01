// Wire format between client and room host. JSON for now; small enough that it doesn't matter yet.
import { isItemAction, type ItemId } from './sim/items';
import type { PickupKind } from './sim/pickups';
import type { InputFrame, PlayerState } from './sim/types';

export interface CubeSnapshot {
  id: string;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
}

// A pickup where it floats this tick (sim/pickups.ts); `ry` is its spin.
export interface PickupSnapshot {
  id: string;
  kind: PickupKind;
  x: number;
  y: number;
  z: number;
  ry: number;
}

export type ClientMessage = { t: 'input'; f: InputFrame } | { t: 'chat'; text: string } | { t: 'ping'; at: number };

export type ServerMessage =
  | {
      t: 'welcome';
      id: string;
      room: string;
      tick: number;
      players: PlayerState[];
      cubes: CubeSnapshot[];
      pickups: PickupSnapshot[];
    }
  | { t: 'snap'; tick: number; players: PlayerState[]; cubes: CubeSnapshot[]; pickups: PickupSnapshot[] }
  | { t: 'join'; p: PlayerState }
  | { t: 'leave'; id: string; name: string }
  | { t: 'chat'; id: string; name: string; color: string; text: string }
  | { t: 'system'; text: string } // greyed-out line: command results, notices
  | { t: 'shot'; id: string } // someone fired a tap weapon; clients play the effect
  // Hearts came off: a shot landed, or with no shooter, a fall.
  | { t: 'hit'; shooter: string | null; victim: string; damage: number; headshot: boolean; hearts: number }
  | { t: 'kill'; shooter: string; victim: string; item: ItemId; headshot: boolean } // clients announce it
  | { t: 'fell'; victim: string } // a fall killed them
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
        isNum(f.mx) &&
        isNum(f.my) &&
        isNum(f.yaw) &&
        isNum(f.pitch) &&
        typeof f.jump === 'boolean' &&
        (f.reading === null || typeof f.reading === 'string') &&
        Array.isArray(f.actions) &&
        f.actions.every(isItemAction) &&
        (f.view === undefined || isNum(f.view))
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
