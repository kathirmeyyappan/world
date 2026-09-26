// Turns a room id into a live Connection.
//
// Three ways in, decided at runtime:
//   dev      VITE_ROOM_WS_URL is set: dial the room server directly (Vite proxies /ws).
//   hosted   the page was served by the room server itself (?direct=1): the WebSocket is
//            same-origin, so the proxy's session cookie applies and no token is needed.
//   launcher anywhere else (GitHub Pages): navigate to the lobby, which starts a session and
//            redirects the browser to the room host with the token. See docs/connections.png.
import { WsConnection, type Connection } from './Connection';

const DIRECT_WS_URL = import.meta.env.VITE_ROOM_WS_URL as string | undefined;
// Read once at load: the home screen cleans the query string after joining.
export const SERVED_BY_ROOM_HOST = new URLSearchParams(location.search).has('direct');

export class LobbyUnavailableError extends Error {}

export function lobbyUrl(): string | null {
  const meta = document.querySelector('meta[name="lobby-url"]') as HTMLMetaElement | null;
  const url = meta?.content || (import.meta.env.VITE_LOBBY_URL as string | undefined) || '';
  return url ? url.replace(/\/$/, '') : null;
}

export async function joinRoom(roomId: string, name: string): Promise<Connection> {
  const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
  const wsScheme = location.protocol === 'https:' ? 'wss' : 'ws';

  if (DIRECT_WS_URL) {
    const base = DIRECT_WS_URL.startsWith('/') ? `${wsScheme}://${location.host}${DIRECT_WS_URL}` : DIRECT_WS_URL;
    return WsConnection.connect(`${base}?${q({ room: roomId, name })}`);
  }

  if (SERVED_BY_ROOM_HOST) {
    return WsConnection.connect(`${wsScheme}://${location.host}/ws?${q({ room: roomId, name })}`);
  }

  const lobby = lobbyUrl();
  if (!lobby) throw new LobbyUnavailableError('no lobby configured');
  location.href = `${lobby}/join/${encodeURIComponent(roomId)}?${q({ name })}`;
  return new Promise(() => {});
}
