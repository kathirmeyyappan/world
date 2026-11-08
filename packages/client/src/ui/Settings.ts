// Game info and settings, behind the gear over the room panel or the X key: the link that brings
// friends into the room, sound, the view, the guide, and the way out. With a mouse it frees the
// pointer to click around in; closing it with X, its corner button or a click beside the card puts
// the player back in the world, and Esc closes it leaving the mouse free. On touch a tap on its corner
// button or beside the card closes it. Each setting belongs to whatever already keeps it (Sfx its
// channels, View the perspective, the browser the fullscreen): the menu only shows and flips it, so a
// new one is a row in `sections`.
import type { Channel, Sfx } from '../audio/Sfx';
import type { View } from '../game/View';
import { IS_TOUCH } from '../input/touch';
import { SERVED_BY_ROOM_HOST, leaveRoom } from '../net/lobby';
import { GEAR, pixelSvg } from './pixelIcons';

const GUIDE_URL = 'https://info.kathirm.com/kathir-world-guide?pvs=74';
const REPO_URL = 'https://github.com/kathirmeyyappan/world';
const SAID_MS = 1500; // how long the invite button says what it did

// One line of a section: what it's called, its key in play (shown with a keyboard), what it reads
// now, and what pressing it does.
interface Row {
  label: string;
  key?: string;
  value: () => string;
  press: () => void;
}

interface Section {
  title: string;
  rows: Row[];
}

export interface SettingsOptions {
  roomId: string;
  invite: string | null; // the link that brings a friend into the room; null offline, where no one can come
  sfx: Sfx;
  view: View;
}

export class Settings {
  private readonly el = document.getElementById('settings')!;
  private readonly values: { row: Row; button: HTMLButtonElement }[] = [];
  private open = false;
  private saidTimer = 0;
  // After it opens or closes; `back` when the close should put the player back in the world.
  onOpenChange: ((open: boolean, back: boolean) => void) | null = null;

  constructor(private readonly options: SettingsOptions) {
    const groups = sections(options.sfx, options.view);
    this.el.innerHTML = cardHtml(groups, !!options.invite);
    const rows = groups.flatMap((g) => g.rows);
    this.el.querySelectorAll<HTMLButtonElement>('button.value').forEach((button, i) => {
      const row = rows[i];
      this.values.push({ row, button });
      button.addEventListener('click', () => {
        row.press();
        this.refresh();
      });
    });
    this.wireInvite();
    this.el.querySelector('.close')!.addEventListener('click', () => this.hide(true));
    this.el.querySelector('.leave')!.addEventListener('click', leaveRoom);
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.hide(true);
    });
    document.addEventListener('fullscreenchange', () => this.refresh());
    // The mouse stays free while it's open, even when a capture asked for just before it opened lands
    // after (closing the chat by clicking the gear asks for one).
    document.addEventListener('pointerlockchange', () => {
      if (this.open && document.pointerLockElement) document.exitPointerLock();
    });

    const opener = document.getElementById('settings-button')!;
    opener.prepend(pixelSvg(GEAR, 'gear'));
    opener.addEventListener('click', () => this.show());
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.refresh();
    this.el.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    this.onOpenChange?.(true, false);
  }

  hide(back: boolean): void {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
    this.onOpenChange?.(false, back);
  }

  // A key pressed while the menu is open: X, the key that opened it, or Q, which closes the other
  // cards, goes back to the world; Esc closes it with the mouse left free.
  key(code: string): void {
    if (code === 'KeyX' || code === 'KeyQ') this.hide(true);
    else if (code === 'Escape') this.hide(false);
  }

  private refresh(): void {
    for (const { row, button } of this.values) {
      const value = row.value();
      button.textContent = value;
      button.classList.toggle('off', value === 'OFF');
    }
  }

  // The room's code and link go in as text, never markup: the lobby's address in the link comes from
  // the page's own URL.
  private wireInvite(): void {
    const { invite, roomId } = this.options;
    if (!invite) return;
    this.el.querySelector('.room .code')!.textContent = roomId;
    const link = this.el.querySelector<HTMLElement>('.invite .link')!;
    link.textContent = invite;
    const button = this.el.querySelector<HTMLButtonElement>('.invite .share')!;
    button.addEventListener('click', () => void this.passOn(invite, button, link));
  }

  // Hands the link on: to the phone's share sheet where there is one, else the clipboard, and when
  // neither works, selected on the card to copy by hand.
  private async passOn(invite: string, button: HTMLButtonElement, link: HTMLElement): Promise<void> {
    if (canShare()) {
      try {
        await navigator.share({ title: 'kathir world', url: invite });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return; // the sheet was closed
      }
    }
    try {
      await navigator.clipboard.writeText(invite);
      this.say(button, 'COPIED!');
    } catch {
      getSelection()?.selectAllChildren(link);
      this.say(button, 'COPY IT BELOW');
    }
  }

  // The invite button reads `text` for a moment, then its label again.
  private say(button: HTMLButtonElement, text: string): void {
    button.textContent = text;
    clearTimeout(this.saidTimer);
    this.saidTimer = window.setTimeout(() => (button.textContent = passOnLabel()), SAID_MS);
  }
}

// The page fullscreen, HUD included, or back out; the browser's own Esc comes out too.
export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

function sections(sfx: Sfx, view: View): Section[] {
  const channel = (label: string, c: Channel): Row => ({
    label,
    value: () => (sfx.isMuted(c) ? 'OFF' : 'ON'),
    press: () => sfx.setMuted(c, !sfx.isMuted(c)),
  });
  const seeing: Row[] = [
    {
      label: 'PERSPECTIVE',
      key: 'Z',
      value: () => (view.mode === 'first' ? 'FIRST PERSON' : 'THIRD PERSON'),
      press: () => view.toggle(),
    },
  ];
  // A phone whose browser can't take a page fullscreen (an iPhone's) gets no row for it.
  if (document.fullscreenEnabled)
    seeing.push({
      label: 'FULLSCREEN',
      key: 'O',
      value: () => (document.fullscreenElement ? 'ON' : 'OFF'),
      press: toggleFullscreen,
    });
  return [
    { title: 'SOUND', rows: [channel('MUSIC', 'music'), channel('SOUND EFFECTS', 'effects')] },
    { title: 'VIEW', rows: seeing },
  ];
}

// On a phone the share sheet, which can copy too; with a mouse, the clipboard is what's expected.
function canShare(): boolean {
  return IS_TOUCH && 'share' in navigator;
}

function passOnLabel(): string {
  return canShare() ? 'SHARE JOIN LINK' : 'COPY JOIN LINK';
}

function cardHtml(groups: Section[], invite: boolean): string {
  const keyboard = !IS_TOUCH;
  const rows = groups.map((s) => {
    const lines = s.rows.map((r) => {
      const key = keyboard && r.key ? `<kbd translate="no">${r.key}</kbd>` : '';
      return `<div class="row"><span class="name">${r.label}${key}</span><button class="value" translate="no"></button></div>`;
    });
    return `<section><h2>${s.title}</h2>${lines.join('')}</section>`;
  });
  // Anyone who opens the room host's address without its cookie is turned away before the page.
  const note = SERVED_BY_ROOM_HOST ? '<p class="note">send this link: the address bar only works for you</p>' : '';
  const inviteHtml = invite
    ? `<section class="invite">
        <h2>INVITE FRIENDS</h2>
        <p class="room"><span class="label">ROOM</span><span class="code" translate="no"></span></p>
        <button class="share wide">${passOnLabel()}</button>
        <div class="link" translate="no"></div>
        ${note}
      </section>`
    : '';
  // With a keyboard the footer teaches the key; on touch the corner button says it all.
  const footer = keyboard
    ? '<div class="footer"><div class="close-hint">PRESS <kbd translate="no">X</kbd> TO CLOSE<span class="cursor">▮</span></div></div>'
    : '';
  return `
    <div class="card">
      <div class="head">
        <h1>GAME INFO / SETTINGS</h1>
        <button class="close" title="close" translate="no">X</button>
      </div>
      <div class="body">
        ${inviteHtml}
        ${rows.join('')}
        <section>
          <h2>MORE</h2>
          <div class="links">
            <a class="button" href="${GUIDE_URL}" target="_blank" rel="noopener">READ THE GUIDE</a>
            <a class="button" href="${REPO_URL}" target="_blank" rel="noopener">SEE THE CODE</a>
          </div>
          <button class="leave wide subtle">LEAVE ROOM</button>
        </section>
      </div>
      ${footer}
    </div>`;
}
