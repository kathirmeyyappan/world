// Turns a room id into a live Connection.
//
// Three ways in, decided at runtime:
//   dev      VITE_ROOM_WS_URL is set: dial the room server directly (Vite proxies /ws).
//   hosted   the page was served by the room server itself (?direct=1): the WebSocket is
//            same-origin, so the proxy's session cookie applies and no token is needed.
//   launcher anywhere else (GitHub Pages): navigate to the lobby, which starts a session and
//            redirects the browser to the room host with the token. See docs/join-flow.png.
import { WsConnection, type Connection } from './Connection';

const DIRECT_WS_URL = import.meta.env.VITE_ROOM_WS_URL as string | undefined;
// The home screen scrubs the query string after joining, so what it carried is kept in
// sessionStorage: a reload on the room host then rejoins the same room instead of showing the menu.
const startParams = new URLSearchParams(location.search);
if (startParams.has('direct')) sessionStorage.setItem('world.direct', '1');
if (startParams.get('lobby')) sessionStorage.setItem('world.lobby', startParams.get('lobby')!);
if (startParams.get('home')) sessionStorage.setItem('world.home', startParams.get('home')!);
export const SERVED_BY_ROOM_HOST = sessionStorage.getItem('world.direct') === '1';

export function rememberRoom(roomId: string, name: string): void {
  sessionStorage.setItem('world.room', roomId);
  sessionStorage.setItem('world.name', name);
}

export function rememberedRoom(): { roomId: string; name: string } | null {
  const roomId = sessionStorage.getItem('world.room');
  return roomId ? { roomId, name: sessionStorage.getItem('world.name') ?? '' } : null;
}

export function forgetRoom(): void {
  sessionStorage.removeItem('world.room');
  sessionStorage.removeItem('world.name');
}

// The launcher the player came from, or this host's own menu when that isn't known.
export function homeUrl(): string {
  return sessionStorage.getItem('world.home') || location.pathname;
}

export class LobbyUnavailableError extends Error {}

// Where the lobby is: what the lobby's own redirect told this tab, else what the room host put in
// the page (a tab that never went through the lobby), else the build-time launcher setting.
export function lobbyUrl(): string | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="world-lobby"]')?.content;
  const url =
    sessionStorage.getItem('world.lobby') || meta || (import.meta.env.VITE_LOBBY_URL as string | undefined) || '';
  return url ? url.replace(/\/$/, '') : null;
}

// Wake the lobby while the player is still typing a name, so Join doesn't pay its cold start.
// Opaque cross-origin fetch: we only need the request to land, not the response.
export function warmLobby(): void {
  const lobby = lobbyUrl();
  if (lobby) fetch(`${lobby}/healthz`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
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
