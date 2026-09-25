// Turns a room id into a live Connection. In dev the client dials the room server directly;
// in production it asks the lobby for a session token first (see docs/multiplayer-flow.png).
import { WsConnection, type Connection } from './Connection';

const DIRECT_WS_URL = import.meta.env.VITE_ROOM_WS_URL as string | undefined;

export class LobbyUnavailableError extends Error {}

interface Ticket {
  room_id: string;
  ws_url: string;
  token: string;
}

export async function joinRoom(roomId: string, name: string): Promise<Connection> {
  const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
  if (DIRECT_WS_URL) {
    const base = DIRECT_WS_URL.startsWith('/')
      ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${DIRECT_WS_URL}`
      : DIRECT_WS_URL;
    return WsConnection.connect(`${base}?${q({ room: roomId, name })}`);
  }

  let ticket = await requestTicket(roomId, false);
  try {
    return await WsConnection.connect(`${ticket.ws_url}?${q({ modal_session_token: ticket.token, name })}`);
  } catch {
    // The stored session probably idled out. Ask the lobby for a fresh one, once.
    ticket = await requestTicket(roomId, true);
    return WsConnection.connect(`${ticket.ws_url}?${q({ modal_session_token: ticket.token, name })}`);
  }
}

async function requestTicket(roomId: string, fresh: boolean): Promise<Ticket> {
  let res: Response;
  try {
    res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fresh }),
    });
  } catch {
    throw new LobbyUnavailableError('lobby unreachable');
  }
  if (res.status === 404) throw new LobbyUnavailableError('no lobby at this origin');
  if (!res.ok) throw new Error(`lobby error ${res.status}`);
  return (await res.json()) as Ticket;
}
