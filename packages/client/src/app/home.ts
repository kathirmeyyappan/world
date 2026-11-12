// Home screen: the room on the left (drop into the global room, or join one by code: a code nobody
// is using yet becomes a new room), the player on the right (their name, and a skin from a dropdown
// shown on a turning stage, as the guide and the menu show bodies).
// Resolves with a live Connection. Also honours ?room=&name=&avatar=&color= for invite links and tests.
import {
  AVATARS,
  AVATAR_IDS,
  NAMED_COLORS,
  isAvatarId,
  isValidRoomId,
  sanitizeName,
  type AvatarId,
} from '@world/shared';
import { CHARACTERS } from '../guide/content';
import { LocalConnection, type Connection } from '../net/Connection';
import {
  LobbyUnavailableError,
  SERVED_BY_ROOM_HOST,
  joinRoom,
  rememberRoom,
  rememberedRoom,
  warmLobby,
  type Joiner,
} from '../net/lobby';
import type { BodyView, Shown } from '../render/BodyView';

export interface HomeResult {
  connection: Connection;
  roomId: string;
  name: string;
}

const GLOBAL_ROOM = 'global';
const NAME_KEY = 'world.name';
const SKIN_KEY = 'world.skin';
// The dropdown's first choice: the standard body, which the room paints a color of its own
// choosing, so the stage shows it white.
const RANDOM = '';
const UNPAINTED = '#ffffff';
const COLOR = 'color:'; // before a NAMED_COLORS name, a choice of the standard body in that color

export function showHome(): Promise<HomeResult> {
  const root = document.getElementById('home')!;
  const nameInput = document.getElementById('home-name') as HTMLInputElement;
  const skinSelect = document.getElementById('home-skin') as HTMLSelectElement;
  const roomInput = document.getElementById('home-room') as HTMLInputElement;
  const joinBtn = document.getElementById('home-join') as HTMLButtonElement;
  const globalBtn = document.getElementById('home-global') as HTMLButtonElement;
  const offlineBtn = document.getElementById('home-offline') as HTMLButtonElement;
  const status = document.getElementById('home-status')!;
  const buttons = [joinBtn, globalBtn, offlineBtn];

  const loading = document.getElementById('loading')!;
  const params = new URLSearchParams(location.search);
  nameInput.value = params.get('name') ?? stored(NAME_KEY) ?? '';
  roomInput.value = params.get('room') ?? '';
  fillSkins(skinSelect);
  const asked = params.has('avatar') || params.has('color');
  choose(skinSelect, asked ? choiceOf(params.get('avatar'), params.get('color')) : (stored(SKIN_KEY) ?? RANDOM));
  const stage = new Stage(document.getElementById('home-view')!, skinSelect);

  const joiner = (): Joiner => ({
    name: sanitizeName(nameInput.value),
    ...lookOf(skinSelect.value),
  });
  const keep = (you: Joiner) => {
    store(NAME_KEY, you.name);
    store(SKIN_KEY, choiceOf(you.avatar, you.color));
  };

  // The page loads showing the loading screen. Only reveal the home screen when there is
  // nothing to auto-join (or an auto-join fails), so arriving via the lobby never flashes it.
  let busy = false;
  const showForm = () => {
    busy = false;
    buttons.forEach((b) => (b.disabled = false));
    loading.classList.add('hidden');
    root.classList.remove('hidden');
    stage.start();
  };
  const hideForm = () => {
    root.classList.add('hidden');
    stage.stop();
  };
  // Back from the lobby restores this page from the back/forward cache as it was left: mid-join,
  // waiting on a navigation that has already happened. Hand the form back.
  const restore = (e: PageTransitionEvent) => {
    if (!e.persisted) return;
    status.textContent = '';
    showForm();
  };
  window.addEventListener('pageshow', restore);

  return new Promise((finish) => {
    const resolve = (result: HomeResult) => {
      window.removeEventListener('pageshow', restore);
      stage.dispose();
      finish(result);
    };
    const attempt = async (roomId: string) => {
      if (busy) return;
      const you = joiner();
      roomId = roomId.trim().toLowerCase();
      if (!isValidRoomId(roomId)) {
        showForm();
        status.textContent = 'room codes are 1-24 letters, digits or dashes';
        return;
      }
      busy = true;
      buttons.forEach((b) => (b.disabled = true));
      status.textContent = `connecting to ${roomId}...`;
      keep(you);
      // The wait is mostly the lobby round trip and the room's session start, and on the
      // launcher that is a page navigation this page stays visible through. Show the loading
      // screen for it, so the join looks like one continuous load; a failure brings the form back.
      hideForm();
      loading.classList.remove('hidden');
      try {
        const connection = await joinRoom(roomId, you);
        if (SERVED_BY_ROOM_HOST) {
          rememberRoom(roomId, you);
          history.replaceState(null, '', location.pathname);
        }
        resolve({ connection, roomId, name: you.name });
      } catch (err) {
        showForm();
        if (err instanceof LobbyUnavailableError) {
          status.textContent = 'no multiplayer server here. play offline instead?';
          offlineBtn.classList.remove('hidden');
        } else {
          status.textContent = err instanceof Error ? err.message : 'could not connect';
        }
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
      const you = joiner();
      keep(you);
      hideForm();
      resolve({ connection: new LocalConnection(you.name, you.avatar, you.color), roomId: 'offline', name: you.name });
    });

    const remembered = SERVED_BY_ROOM_HOST ? rememberedRoom() : null;
    if (params.get('room')) attempt(params.get('room')!);
    else if (remembered) {
      nameInput.value = remembered.name || nameInput.value;
      choose(skinSelect, choiceOf(remembered.avatar, remembered.color));
      attempt(remembered.roomId);
    } else if (params.get('offline') !== null) offlineBtn.click();
    else {
      showForm();
      if (!SERVED_BY_ROOM_HOST) warmLobby();
      (nameInput.value ? roomInput : nameInput).focus();
    }
  });
}

// Every look a person can switch to by command, by the guide's name for it, the standard body first
// as a random color; then, always last, the standard body in each named color.
function fillSkins(select: HTMLSelectElement): void {
  const option = (value: string, text: string) => select.append(new Option(text, value));
  for (const id of AVATAR_IDS) {
    if (AVATARS[id].command === null) continue;
    option(id === 'standard' ? RANDOM : id, id === 'standard' ? 'Random color' : CHARACTERS[id].title);
  }
  for (const name of Object.keys(NAMED_COLORS)) option(COLOR + name, `${name[0].toUpperCase()}${name.slice(1)}`);
}

// Picks `value` in the dropdown, or the first choice where there's no such option.
function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  if (select.selectedIndex < 0) select.selectedIndex = 0;
}

// What a dropdown choice joins as.
function lookOf(value: string): { avatar: AvatarId | null; color: string | null } {
  if (value.startsWith(COLOR)) return { avatar: null, color: value.slice(COLOR.length) };
  return { avatar: isAvatarId(value) && value !== 'standard' ? value : null, color: null };
}

// The dropdown choice for a skin, or the standard body in a named color.
function choiceOf(avatar: string | null, color: string | null): string {
  if (isAvatarId(avatar) && avatar !== 'standard') return avatar;
  return color ? COLOR + color : RANDOM;
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the home screen won't offer it next time.
  }
}

// The chosen skin on its stage. Babylon comes in with the game's own chunk, so the view is fetched
// the first time the form is shown (never on an auto-join) and drawn each frame while it's up.
class Stage {
  private view: BodyView | null = null;
  private loading = false;
  private disposed = false; // the chunk can arrive after a quick join has already left the form
  private frame = 0;

  constructor(
    private readonly box: HTMLElement,
    private readonly skin: HTMLSelectElement,
  ) {}

  start(): void {
    if (this.frame) return;
    if (!this.view && !this.loading) {
      this.loading = true;
      void import('../render/BodyView').then(({ BodyView }) => {
        if (this.disposed) return;
        this.view = new BodyView();
        this.box.prepend(this.view.canvas);
      });
    }
    const draw = () => {
      this.view?.sync(this.shown(), true);
      this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.view?.sync(this.shown(), false);
  }

  private shown(): Shown {
    const { avatar, color } = lookOf(this.skin.value);
    const paint = color && Object.hasOwn(NAMED_COLORS, color) ? NAMED_COLORS[color] : UNPAINTED;
    return {
      name: '',
      avatar: avatar ?? 'standard',
      color: paint,
      item: null,
      gear: null,
      chilled: false,
      shattered: [],
    };
  }

  // Off for good: the game gets the GPU to itself.
  dispose(): void {
    this.disposed = true;
    this.stop();
    this.view?.dispose();
    this.view = null;
  }
}
