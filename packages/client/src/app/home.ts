// Home screen: the room on the left, under two tabs: JOIN one that's running (the global room, or
// one by code) or CREATE a room under a code no one is using, the player on the right (their
// name, and a skin from a dropdown shown on a turning stage with the name over its head, as the
// guide and the menu show bodies). Resolves with a live Connection. Also honours
// ?room=&name=&avatar=&color= for invite links (a join) and tests, and ?error=&tab=&code= for a join
// the lobby turned away, which it sends back here.
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
  GLOBAL_ROOM,
  LobbyUnavailableError,
  SERVED_BY_ROOM_HOST,
  forgetRoom,
  joinRoom,
  rememberRoom,
  rememberedRoom,
  warmLobby,
  type JoinMode,
  type Joiner,
} from '../net/lobby';
import type { BodyView, Shown } from '../render/BodyView';
import { BOOK, GITHUB, pixelSvg } from '../ui/pixelIcons';
import { Picker, type Choice } from './Picker';

export interface HomeResult {
  connection: Connection;
  roomId: string;
  name: string;
}

const NAME_KEY = 'world.name';
const SKIN_KEY = 'world.skin';
// The dropdown's first choice: the standard body in a named color drawn afresh each time the page
// loads, so that people who keep it don't all join alike. The choice is kept, never the color.
const STANDARD = 'standard';
const ROLLED = Object.keys(NAMED_COLORS)[Math.floor(Math.random() * Object.keys(NAMED_COLORS).length)];
const UNPAINTED = '#ffffff'; // what the stage paints a skin of its own, which takes no paint
const COLOR = 'color:'; // before a NAMED_COLORS name, a choice of the standard body in that color
const TAG_PX = 16; // the least the name over the stage's body is drawn at: the view is small and close

// What each tab's button says, and the line under its code, if any.
const TABS: Record<JoinMode, { action: string; hint: string }> = {
  create: { action: 'CREATE ROOM', hint: 'a new room under a code no one is using' },
  join: { action: 'JOIN ROOM', hint: '' },
};

export function showHome(): Promise<HomeResult> {
  const root = document.getElementById('home')!;
  const nameInput = document.getElementById('home-name') as HTMLInputElement;
  const roomInput = document.getElementById('home-room') as HTMLInputElement;
  const joinBtn = document.getElementById('home-join') as HTMLButtonElement;
  const globalBtn = document.getElementById('home-global') as HTMLButtonElement;
  const offlineBtn = document.getElementById('home-offline') as HTMLButtonElement;
  const status = document.getElementById('home-status')!;
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('.home-tabs [role=tab]')];
  const modeHint = document.getElementById('home-mode-hint')!;
  const buttons = [joinBtn, globalBtn, offlineBtn, ...tabs];
  document.getElementById('home-guide')!.prepend(pixelSvg(BOOK, 'home-icon', { o: 'ink' }));
  document.getElementById('home-source')!.prepend(pixelSvg(GITHUB, 'home-icon'));

  const globalRow = document.getElementById('home-global-row')!;
  let mode: JoinMode = 'join';
  const pick = (to: JoinMode) => {
    mode = to;
    globalRow.classList.toggle('hidden', to !== 'join');
    for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.mode === to));
    joinBtn.textContent = TABS[to].action;
    modeHint.textContent = TABS[to].hint;
  };
  for (const tab of tabs) tab.addEventListener('click', () => pick(tab.dataset.mode === 'join' ? 'join' : 'create'));

  const loading = document.getElementById('loading')!;
  const params = new URLSearchParams(location.search);
  nameInput.value = params.get('name') ?? stored(NAME_KEY) ?? '';
  roomInput.value = params.get('room') ?? params.get('code') ?? '';
  pick(params.get('tab') === 'create' ? 'create' : 'join');
  const skin = new Picker(document.getElementById('home-skin')!, skinChoices());
  const asked = params.has('avatar') || params.has('color');
  skin.choose(asked ? choiceOf(params.get('avatar'), params.get('color')) : (stored(SKIN_KEY) ?? STANDARD));
  const stage = new Stage(document.getElementById('home-view')!, skin, () => sanitizeName(nameInput.value));
  const refused = params.get('error');

  const joiner = (): Joiner => ({
    name: sanitizeName(nameInput.value),
    ...lookOf(skin.value),
  });
  const keep = (you: Joiner) => {
    store(NAME_KEY, you.name);
    store(SKIN_KEY, skin.value);
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
    // `mode` null: the room host's own room, which the lobby has already let this page into.
    const attempt = async (roomId: string, mode: JoinMode | null) => {
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
        const connection = await joinRoom(roomId, you, mode);
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
      attempt(roomInput.value, mode);
    };
    joinBtn.addEventListener('click', joinTyped);
    roomInput.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') joinTyped();
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') roomInput.value ? joinTyped() : roomInput.focus();
    });
    globalBtn.addEventListener('click', () => attempt(GLOBAL_ROOM, 'join'));
    offlineBtn.addEventListener('click', () => {
      const you = joiner();
      keep(you);
      hideForm();
      resolve({ connection: new LocalConnection(you.name, you.avatar, you.color), roomId: 'offline', name: you.name });
    });

    // On the room host, ?room= is where the lobby sent this page; anywhere else it's an invite.
    const remembered = SERVED_BY_ROOM_HOST ? rememberedRoom() : null;
    if (refused) {
      // Turned away on the way to another room: this tab is out of the one it was in.
      forgetRoom();
      history.replaceState(null, '', location.pathname);
      showForm();
      status.textContent = refused;
      roomInput.focus();
    } else if (params.get('room')) attempt(params.get('room')!, SERVED_BY_ROOM_HOST ? null : 'join');
    else if (remembered) {
      nameInput.value = remembered.name || nameInput.value;
      skin.choose(choiceOf(remembered.avatar, remembered.color));
      attempt(remembered.roomId, null);
    } else if (params.get('offline') !== null) offlineBtn.click();
    else {
      showForm();
      if (!SERVED_BY_ROOM_HOST) warmLobby();
      (nameInput.value ? roomInput : nameInput).focus();
    }
  });
}

// Every look on foot a person can switch to by command, by the guide's name for it with the command
// beside it, the standard body first (in the color drawn for this load); then, always last, the
// standard body in each named color.
function skinChoices(): Choice[] {
  const choices: Choice[] = [];
  for (const id of AVATAR_IDS) {
    const command = AVATARS[id].command;
    if (command === null || AVATARS[id].class !== 'walker') continue;
    choices.push({ value: id, label: CHARACTERS[id].title, note: `/${command}` });
  }
  for (const name of Object.keys(NAMED_COLORS))
    choices.push({ value: COLOR + name, label: `${name[0].toUpperCase()}${name.slice(1)}`, note: `/${name}` });
  return choices;
}

// What a dropdown choice joins as.
function lookOf(value: string): { avatar: AvatarId | null; color: string | null } {
  if (value === STANDARD) return { avatar: null, color: ROLLED };
  if (value.startsWith(COLOR)) return { avatar: null, color: value.slice(COLOR.length) };
  return { avatar: isAvatarId(value) ? value : null, color: null };
}

// The dropdown choice for a skin, or the standard body in a named color.
function choiceOf(avatar: string | null, color: string | null): string {
  if (isAvatarId(avatar) && avatar !== 'standard') return avatar;
  return color ? COLOR + color : STANDARD;
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
  private readonly tag = document.createElement('div');

  constructor(
    private readonly box: HTMLElement,
    private readonly skin: Picker,
    private readonly name: () => string,
  ) {
    this.tag.className = 'name-tag';
    box.append(this.tag);
  }

  start(): void {
    if (this.frame) return;
    if (!this.view && !this.loading) {
      this.loading = true;
      void import('../render/BodyView').then(({ BodyView }) => {
        if (this.disposed) return;
        this.view = new BodyView(1 / devicePixelRatio); // the home screen draws nothing else
        this.box.prepend(this.view.canvas);
      });
    }
    const draw = () => {
      const shown = this.shown();
      this.view?.sync(shown, true);
      this.label(shown);
      this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.view?.sync(this.shown(), false);
  }

  // The name over the body's head, as the world's tags (ui/NameTags.ts) draw it.
  private label(shown: Shown): void {
    const at = this.view?.overHead();
    this.tag.style.display = at ? 'block' : 'none';
    if (!at) return;
    if (this.tag.textContent !== shown.name) this.tag.textContent = shown.name;
    this.tag.style.color = shown.color;
    this.tag.style.fontSize = `${Math.max(TAG_PX, at.px)}px`;
    this.tag.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)`;
  }

  private shown(): Shown {
    const { avatar, color } = lookOf(this.skin.value);
    const paint = color && Object.hasOwn(NAMED_COLORS, color) ? NAMED_COLORS[color] : UNPAINTED;
    return {
      name: this.name(),
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
