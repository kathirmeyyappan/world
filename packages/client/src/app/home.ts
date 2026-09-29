// Home screen: pick a name, then drop into the global room or join a room by code (a code nobody
// is using yet becomes a new room).
// Resolves with a live Connection. Also honours ?room=&name= for invite links and tests.
import { isValidRoomId, sanitizeName } from '@world/shared';
import { LocalConnection, type Connection } from '../net/Connection';
import {
  LobbyUnavailableError,
  SERVED_BY_ROOM_HOST,
  joinRoom,
  rememberRoom,
  rememberedRoom,
  warmLobby,
} from '../net/lobby';

export interface HomeResult {
  connection: Connection;
  roomId: string;
  name: string;
}

const GLOBAL_ROOM = 'global';
const NAME_KEY = 'world.name';

export function showHome(): Promise<HomeResult> {
  const root = document.getElementById('home')!;
  const nameInput = document.getElementById('home-name') as HTMLInputElement;
  const roomInput = document.getElementById('home-room') as HTMLInputElement;
  const joinBtn = document.getElementById('home-join') as HTMLButtonElement;
  const globalBtn = document.getElementById('home-global') as HTMLButtonElement;
  const offlineBtn = document.getElementById('home-offline') as HTMLButtonElement;
  const status = document.getElementById('home-status')!;
  const buttons = [joinBtn, globalBtn, offlineBtn];

  const loading = document.getElementById('loading')!;
  const params = new URLSearchParams(location.search);
  nameInput.value = params.get('name') ?? localStorage.getItem(NAME_KEY) ?? '';
  roomInput.value = params.get('room') ?? '';

  // The page loads showing the loading screen. Only reveal the home screen when there is
  // nothing to auto-join (or an auto-join fails), so arriving via the lobby never flashes it.
  const showForm = () => {
    loading.classList.add('hidden');
    root.classList.remove('hidden');
  };

  return new Promise((resolve) => {
    let busy = false;

    const attempt = async (roomId: string) => {
      if (busy) return;
      const name = sanitizeName(nameInput.value);
      roomId = roomId.trim().toLowerCase();
      if (!isValidRoomId(roomId)) {
        showForm();
        status.textContent = 'room codes are 1-24 letters, digits or dashes';
        return;
      }
      busy = true;
      buttons.forEach((b) => (b.disabled = true));
      status.textContent = `connecting to ${roomId}...`;
      localStorage.setItem(NAME_KEY, name);
      // The wait is mostly the lobby round trip and the room's session start, and on the
      // launcher that is a page navigation this page stays visible through. Show the loading
      // screen for it, so the join looks like one continuous load; a failure brings the form back.
      root.classList.add('hidden');
      loading.classList.remove('hidden');
      try {
        const connection = await joinRoom(roomId, name);
        if (SERVED_BY_ROOM_HOST) {
          rememberRoom(roomId, name);
          history.replaceState(null, '', location.pathname);
        }
        resolve({ connection, roomId, name });
      } catch (err) {
        showForm();
        if (err instanceof LobbyUnavailableError) {
          status.textContent = 'no multiplayer server here. play offline instead?';
          offlineBtn.classList.remove('hidden');
        } else {
          status.textContent = err instanceof Error ? err.message : 'could not connect';
        }
        busy = false;
        buttons.forEach((b) => (b.disabled = false));
      }
    };

    const joinTyped = () => {
      if (!roomInput.value.trim()) {
        status.textContent = 'enter a room code';
        roomInput.focus();
        return;
      }
      attempt(roomInput.value);
    };
    joinBtn.addEventListener('click', joinTyped);
    roomInput.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') joinTyped();
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') roomInput.value ? joinTyped() : roomInput.focus();
    });
    globalBtn.addEventListener('click', () => attempt(GLOBAL_ROOM));
    offlineBtn.addEventListener('click', () => {
      const name = sanitizeName(nameInput.value);
      localStorage.setItem(NAME_KEY, name);
      root.classList.add('hidden');
      resolve({ connection: new LocalConnection(name), roomId: 'offline', name });
    });

    const remembered = SERVED_BY_ROOM_HOST ? rememberedRoom() : null;
    if (params.get('room')) attempt(params.get('room')!);
    else if (remembered) {
      nameInput.value = remembered.name || nameInput.value;
      attempt(remembered.roomId);
    } else if (params.get('offline') !== null) offlineBtn.click();
    else {
      showForm();
      if (!SERVED_BY_ROOM_HOST) warmLobby();
      (nameInput.value ? roomInput : nameInput).focus();
    }
  });
}
