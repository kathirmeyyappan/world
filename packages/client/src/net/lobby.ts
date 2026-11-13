// Turns a room id into a live Connection.
//
// Three ways in, decided at runtime:
//   dev      VITE_ROOM_WS_URL is set: dial the room server directly (Vite proxies /ws).
//   hosted   the page was served by the room server itself (?direct=1): the WebSocket is
//            same-origin, so the proxy's session cookie applies and no token is needed.
//   launcher anywhere else (GitHub Pages): navigate to the lobby, which starts a session and
//            redirects the browser to the room host with the token. See docs/join-flow.png.
import { NAMED_COLORS, isAvatarId, type AvatarId } from '@world/shared';
import { WsConnection, type Connection } from './Connection';

const DIRECT_WS_URL = import.meta.env.VITE_ROOM_WS_URL as string | undefined;
// The home screen scrubs the query string after joining, so what it carried is kept in
// sessionStorage: a reload on the room host then rejoins the same room instead of showing the menu.
const startParams = new URLSearchParams(location.search);
if (startParams.has('direct')) sessionStorage.setItem('world.direct', '1');
if (startParams.get('lobby')) sessionStorage.setItem('world.lobby', startParams.get('lobby')!);
// Home is the launcher the player came from. Switching rooms goes through the lobby from this page,
// and the lobby names whatever sent it there, so this host itself is never taken for home.
const home = startParams.get('home');
if (home && home !== location.origin) sessionStorage.setItem('world.home', home);
export const SERVED_BY_ROOM_HOST = sessionStorage.getItem('world.direct') === '1';

export function rememberRoom(roomId: string, you: Joiner): void {
  sessionStorage.setItem('world.room', roomId);
  sessionStorage.setItem('world.name', you.name);
  for (const [key, value] of [
    ['world.avatar', you.avatar],
    ['world.color', you.color],
  ] as const) {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  }
}

export function rememberedRoom(): ({ roomId: string } & Joiner) | null {
  const roomId = sessionStorage.getItem('world.room');
  if (!roomId) return null;
  const avatar = sessionStorage.getItem('world.avatar');
  return {
    roomId,
    name: sessionStorage.getItem('world.name') ?? '',
    avatar: isAvatarId(avatar) ? avatar : null,
    color: sessionStorage.getItem('world.color'),
  };
}

export function forgetRoom(): void {
  sessionStorage.removeItem('world.room');
  sessionStorage.removeItem('world.name');
  sessionStorage.removeItem('world.avatar');
  sessionStorage.removeItem('world.color');
}

// A new name, kept where the home screen looks for its default and where this tab's reload does.
export function rememberName(name: string): void {
  try {
    localStorage.setItem('world.name', name);
  } catch {
    // Storage blocked: the home screen won't offer it next time.
  }
  if (sessionStorage.getItem('world.room')) sessionStorage.setItem('world.name', name);
}

// Back into the room after dying: the page reloads as a fresh player, and the join says it's a
// respawn, so the Room puts it where the dead come back (RESPAWN_AREAS) rather than where people
// first come in.
export function respawn(): void {
  sessionStorage.setItem('world.respawn', '1');
  location.reload();
}

// The launcher the player came from, or this host's own menu when that isn't known.
export function homeUrl(): string {
  return sessionStorage.getItem('world.home') || location.pathname;
}

// Out of the room for good: the tab forgets it, so the home page doesn't rejoin it, and goes home.
export function leaveRoom(): void {
  forgetRoom();
  location.href = homeUrl();
}

// The room everyone shares. It is always open: creating or joining it both just go in.
export const GLOBAL_ROOM = 'global';

// What a join asks of its code: `create` a room no one is in yet, or `join` one that's running. The
// lobby (or, in dev, the room server) refuses the other, and the refusal comes back to the home
// screen as its error.
export type JoinMode = 'create' | 'join';

// The link into a running room: a friend's invite, or with `you`, this player's own way to another
// room under their name and in their skin. On Pages or in dev the page itself takes ?room= (the
// home screen joins it); the room host's page only works with its session's cookie, so from there
// the link goes through the lobby, which finds the room's session.
export function roomLink(roomId: string, you?: Joiner): string {
  const lobby = lobbyUrl();
  if (lobby && SERVED_BY_ROOM_HOST) return lobbyJoin(lobby, roomId, you, 'join');
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('room', roomId);
  for (const [key, value] of you ? joinQuery(you) : []) url.searchParams.set(key, value);
  return url.toString();
}

// To another room as `you`: the page goes where that room's link goes, and joins it there.
export function switchRoom(roomId: string, you: Joiner): void {
  location.href = roomLink(roomId, you);
}

// Who's joining: their name, their skin (null for the standard body), and for the standard body
// its color by name (one of NAMED_COLORS; null for one the room picks).
export interface Joiner {
  name: string;
  avatar: AvatarId | null;
  color: string | null;
}

// The name of a color a player wears, if it's one of NAMED_COLORS.
export function colorName(hex: string): string | null {
  return Object.keys(NAMED_COLORS).find((name) => NAMED_COLORS[name] === hex) ?? null;
}

function lobbyJoin(lobby: string, roomId: string, you: Joiner | undefined, mode: JoinMode): string {
  const query = you ? joinQuery(you) : new URLSearchParams();
  query.set('mode', mode);
  return `${lobby}/join/${encodeURIComponent(roomId)}?${query}`;
}

function joinQuery({ name, avatar, color }: Joiner): URLSearchParams {
  const query = new URLSearchParams({ name });
  if (avatar && avatar !== 'standard') query.set('avatar', avatar);
  else if (color) query.set('color', color);
  return query;
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

// Into a room as `mode` asks, or with no mode, into the room host's own room (the one the lobby sent
// this page to, or this tab's on a reload), which the lobby has already admitted it to.
export async function joinRoom(roomId: string, you: Joiner, mode: JoinMode | null): Promise<Connection> {
  const ws = () => {
    const query = joinQuery(you);
    query.set('room', roomId);
    if (mode) query.set('mode', mode);
    if (sessionStorage.getItem('world.respawn')) query.set('respawn', '1');
    sessionStorage.removeItem('world.respawn');
    return query;
  };
  const wsScheme = location.protocol === 'https:' ? 'wss' : 'ws';

  if (DIRECT_WS_URL) {
    const base = DIRECT_WS_URL.startsWith('/') ? `${wsScheme}://${location.host}${DIRECT_WS_URL}` : DIRECT_WS_URL;
    return WsConnection.connect(`${base}?${ws()}`);
  }

  // The room host serves one session's room; any other goes through the lobby.
  const lobby = lobbyUrl();
  if (SERVED_BY_ROOM_HOST && (!mode || !lobby)) {
    return WsConnection.connect(`${wsScheme}://${location.host}/ws?${ws()}`);
  }

  if (!lobby) throw new LobbyUnavailableError('no lobby configured');
  location.href = lobbyJoin(lobby, roomId, you, mode ?? 'join');
  return new Promise(() => {});
}
