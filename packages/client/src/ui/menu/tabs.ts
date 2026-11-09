// What's in the menu: a tab for playing (who you are, the room you're in and its link, other rooms)
// and one for settings (sound, the view, the guide). Every row reads and changes something another
// part of the client keeps (the connection for a rename, Sfx's channels, View's perspective, the
// browser's fullscreen, the Picture's pixel size and frame rate), handed in as MenuHooks, so a new
// setting is a row here and nothing else has to know about it.
import { MAX_NAME_LENGTH, MAX_ROOM_ID_LENGTH, RENAME_SECONDS, cleanName, isValidRoomId } from '@world/shared';
import type { Channel, Sfx } from '../../audio/Sfx';
import type { View } from '../../game/View';
import { SERVED_BY_ROOM_HOST, leaveRoom, roomLink, switchRoom } from '../../net/lobby';
import type { Picture } from '../../render/Picture';
import type { Field, Note, Row, Section, Tab } from './rows';

const GUIDE_URL = 'https://info.kathirm.com/kathir-world-guide?pvs=74';
const REPO_URL = 'https://github.com/kathirmeyyappan/world';
const GLOBAL_ROOM = 'global';
// How long a rename may take to show in the room before the menu says it didn't: a snapshot comes
// thirty times a second, so this is a lost message, not a slow one.
const RENAME_TIMEOUT_MS = 3000;
// Pixels finer than this are a warning: the fill at 1× can be more than a phone's tab survives.
const CRASH_BELOW = 1.5;

export interface MenuHooks {
  roomId: string;
  online: boolean; // false offline, where no one else can come and there's no other room to go to
  sfx: Sfx;
  view: View;
  picture: Picture;
  rename: (name: string) => void; // asks the room to call this player `name` from now on
}

// The player as the menu last saw them (Menu.sync, once a frame).
export interface Me {
  name: string;
}

export function menuTabs(hooks: MenuHooks, me: Me): Tab[] {
  return [
    { title: 'PLAY', sections: [you(hooks, me), ...(hooks.online ? [thisRoom(hooks)] : []), switching(hooks, me)] },
    { title: 'SETTINGS', sections: [sound(hooks.sfx), seeing(hooks.view), picture(hooks.picture), more()] },
  ];
}

// The page fullscreen, HUD included, or back out; the browser's own Esc comes out too.
export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

function you(hooks: MenuHooks, me: Me): Section {
  return { title: 'YOU', rows: [nameField(hooks, me)] };
}

// The room's code and the link that brings a friend into it.
function thisRoom(hooks: MenuHooks): Section {
  return {
    title: 'THIS ROOM',
    rows: [
      {
        kind: 'share',
        name: hooks.roomId,
        link: roomLink(hooks.roomId),
        // Anyone who opens the room host's address without its cookie is turned away before the page.
        note: SERVED_BY_ROOM_HOST ? 'send this link — the address bar only works for you' : undefined,
      },
    ],
  };
}

// Other rooms, and the way out. Offline there's no other room to go to, only home.
function switching(hooks: MenuHooks, me: Me): Section {
  const leave = { label: 'LEAVE ROOM', press: leaveRoom, danger: true };
  if (!hooks.online) return { title: 'SWITCH ROOM', rows: [{ kind: 'buttons', buttons: [leave] }] };
  const global = hooks.roomId === GLOBAL_ROOM ? [] : [{ label: 'JOIN GLOBAL', press: () => go(GLOBAL_ROOM, me) }];
  return { title: 'SWITCH ROOM', rows: [roomField(hooks, me), { kind: 'buttons', buttons: [...global, leave] }] };
}

// The name everyone sees over your head and in the room list. The room refuses a rename within
// RENAME_SECONDS of the last, so the box does too rather than send one it knows won't take.
function nameField(hooks: MenuHooks, me: Me): Field {
  let asked: { name: string; at: number } | null = null;
  let error: string | null = null;
  return {
    kind: 'field',
    label: 'NAME',
    placeholder: 'who are you',
    maxLength: MAX_NAME_LENGTH,
    action: 'SAVE',
    hint: 'shown over your head and in the room list',
    value: () => me.name,
    submit: (text) => {
      const name = cleanName(text);
      const now = performance.now();
      error = !name
        ? 'type a name first'
        : name === me.name
          ? `you're already ${name}`
          : asked && now - asked.at < RENAME_SECONDS * 1000
            ? `one rename every ${RENAME_SECONDS} seconds`
            : null;
      if (error) return;
      asked = { name, at: now };
      hooks.rename(name);
    },
    note: (): Note | null => {
      if (error) return { text: error, tone: 'bad' };
      if (!asked) return null;
      if (me.name === asked.name) return { text: `everyone sees ${asked.name} now`, tone: 'ok' };
      if (performance.now() - asked.at > RENAME_TIMEOUT_MS)
        return { text: "it didn't go through, try again", tone: 'bad' };
      return { text: 'renaming...', tone: 'busy' };
    },
  };
}

// Another room by its code, under the name you have now; a code nobody is using starts a new room,
// as on the home screen.
function roomField(hooks: MenuHooks, me: Me): Field {
  let note: Note | null = null;
  return {
    kind: 'field',
    label: 'ROOM CODE',
    placeholder: 'e.g. late-night',
    maxLength: MAX_ROOM_ID_LENGTH,
    action: 'GO',
    hint: 'a code no one is using starts a new room',
    submit: (text) => {
      const code = text.trim().toLowerCase();
      if (!isValidRoomId(code)) note = { text: 'room codes are 1-24 letters, digits or dashes', tone: 'bad' };
      else if (code === hooks.roomId) note = { text: `you're in ${code} already`, tone: 'bad' };
      else {
        note = { text: `joining ${code}...`, tone: 'busy' };
        go(code, me);
      }
    },
    note: () => note,
  };
}

// The page leaves for the other room behind the loading screen, as a join from the home screen does.
function go(code: string, me: Me): void {
  document.getElementById('loading')?.classList.remove('hidden');
  switchRoom(code, me.name);
}

function sound(sfx: Sfx): Section {
  const channel = (label: string, c: Channel): Row => ({
    kind: 'toggle',
    label,
    value: () => (sfx.isMuted(c) ? 'OFF' : 'ON'),
    press: () => sfx.setMuted(c, !sfx.isMuted(c)),
  });
  return { title: 'SOUND', rows: [channel('MUSIC', 'music'), channel('SOUND EFFECTS', 'effects')] };
}

function seeing(view: View): Section {
  const rows: Row[] = [
    {
      kind: 'toggle',
      label: 'PERSPECTIVE',
      key: 'Z',
      value: () => (view.mode === 'first' ? 'FIRST PERSON' : 'THIRD PERSON'),
      press: () => view.toggle(),
    },
  ];
  // A phone whose browser can't take a page fullscreen (an iPhone's) gets no row for it.
  if (document.fullscreenEnabled)
    rows.push({
      kind: 'toggle',
      label: 'FULLSCREEN',
      key: 'O',
      value: () => (document.fullscreenElement ? 'ON' : 'OFF'),
      press: toggleFullscreen,
    });
  return { title: 'VIEW', rows };
}

// How the frame is drawn: the size of its pixels (auto moves with what the machine keeps up with,
// or one chosen) and the frames a second.
function picture(picture: Picture): Section {
  const auto = () => picture.pixels === 'auto';
  return {
    title: 'PICTURE',
    rows: [
      {
        kind: 'stepper',
        label: 'PIXEL SIZE',
        value: () => `${picture.level}×`,
        step: (by) => picture.stepPixels(by),
        can: (by) => picture.canStepPixels(by),
        auto: {
          label: () => (auto() ? `AUTO (${picture.level}×)` : 'AUTO'),
          on: auto,
          press: () => picture.setPixels('auto'),
        },
        hint: () => (picture.level < CRASH_BELOW ? 'AT THIS SIZE THE GAME MIGHT CRASH' : null),
      },
      {
        kind: 'stepper',
        label: 'FRAME RATE',
        value: () => `${picture.frameRate} FPS`,
        step: (by) => picture.stepFrameRate(by),
        can: (by) => picture.canStepFrameRate(by),
      },
    ],
  };
}

function more(): Section {
  return {
    title: 'MORE',
    rows: [
      {
        kind: 'buttons',
        buttons: [
          { label: 'READ THE GUIDE', href: GUIDE_URL },
          { label: 'SEE THE CODE', href: REPO_URL },
        ],
      },
    ],
  };
}
