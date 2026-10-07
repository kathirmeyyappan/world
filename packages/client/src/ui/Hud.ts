// Room code, player roster, ping, and chat. Pure DOM; the Game feeds it events.
import { MAX_CHAT_LENGTH, MAX_HEARTS } from '@world/shared';
import { HEART, KNIFE, ROBOT, SKULL, pixelSvg } from './pixelIcons';

import { SERVED_BY_ROOM_HOST, lobbyUrl } from '../net/lobby';

const CHAT_LINES = 8;

// On Pages or in dev the page can take ?room=; on the room host that would skip the lobby, so
// point invites at the lobby instead.
function inviteLink(roomId: string): string {
  const lobby = lobbyUrl();
  if (lobby && SERVED_BY_ROOM_HOST) return `${lobby}/join/${encodeURIComponent(roomId)}`;
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('room', roomId);
  return url.toString();
}
const CHAT_FADE_MS = 12_000;
// Lines sent from this tab, oldest first, that Up and Down step back through like a shell's history.
// Kept in sessionStorage, since dying reloads the page.
const HISTORY_KEY = 'world.chat-history';
const HISTORY_LINES = 50;

export class Hud {
  private readonly roomCode = document.getElementById('room-code') as HTMLButtonElement;
  private readonly panel = document.getElementById('room-panel')!;
  private readonly panelToggle = document.getElementById('panel-toggle') as HTMLButtonElement;
  private readonly playerList = document.getElementById('player-list')!;
  private readonly ping = document.getElementById('ping')!;
  private readonly chatLog = document.getElementById('chat-log')!;
  private readonly itemHint = document.getElementById('item-hint')!;
  private readonly itemHintMain = this.itemHint.querySelector('.main')!;
  private readonly itemHintStats = this.itemHint.querySelector('.stats')!;
  private itemHintText = '';
  private readonly chatInput = document.getElementById('chat-input') as HTMLInputElement;
  private readonly sent = loadHistory();
  private recalled = 0; // the line of `sent` in the box; sent.length is the one being typed
  private draft = ''; // what was being typed before stepping back
  private readonly crosshair = document.getElementById('crosshair')!;
  private players = new Map<string, RosterEntry>();
  private myId = '';
  onChat: ((text: string) => void) | null = null;
  onChatOpenChange: ((open: boolean) => void) | null = null;

  constructor(roomId: string) {
    this.roomCode.textContent = roomId;
    this.roomCode.addEventListener('click', () => {
      navigator.clipboard?.writeText(inviteLink(roomId)).then(() => this.tip(this.roomCode, 'copied'));
    });

    this.setPanelCollapsed(window.matchMedia('(pointer: coarse)').matches);
    this.panelToggle.addEventListener('click', () =>
      this.setPanelCollapsed(!this.panel.classList.contains('collapsed')),
    );

    this.chatInput.classList.add('hidden');
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && !this.isChatOpen() && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        this.openChat();
      }
    });
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') {
        const text = this.chatInput.value.trim().slice(0, MAX_CHAT_LENGTH);
        if (text) {
          this.remember(text);
          this.onChat?.(text);
        }
        this.closeChat();
      } else if (e.code === 'Escape') {
        this.closeChat();
      } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        this.recall(e.code === 'ArrowUp' ? -1 : 1);
      }
    });
    this.chatInput.addEventListener('blur', () => this.closeChat());
  }

  private setPanelCollapsed(collapsed: boolean): void {
    this.panel.classList.toggle('collapsed', collapsed);
    this.panelToggle.textContent = collapsed ? '▸' : '▾';
    this.panelToggle.setAttribute('aria-expanded', String(!collapsed));
  }

  isChatOpen(): boolean {
    return !this.chatInput.classList.contains('hidden');
  }

  openChat(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    this.chatInput.classList.remove('hidden');
    this.chatInput.value = '';
    this.recalled = this.sent.length;
    this.chatInput.focus();
    this.onChatOpenChange?.(true);
  }

  // Puts the line `step` back (-1) or on (1) from the one shown in the box, keeping what was being
  // typed to come back to past the newest.
  private recall(step: number): void {
    const next = this.recalled + step;
    if (next < 0 || next > this.sent.length) return;
    if (this.recalled === this.sent.length) this.draft = this.chatInput.value;
    this.recalled = next;
    this.chatInput.value = next === this.sent.length ? this.draft : this.sent[next];
  }

  private remember(text: string): void {
    if (this.sent.at(-1) !== text) this.sent.push(text);
    this.sent.splice(0, this.sent.length - HISTORY_LINES);
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(this.sent));
    } catch {
      // Storage full or blocked: the history still lasts this page.
    }
  }

  private closeChat(): void {
    if (!this.isChatOpen()) return;
    this.chatInput.classList.add('hidden');
    this.chatInput.blur();
    this.onChatOpenChange?.(false);
  }

  setSelf(id: string): void {
    this.myId = id;
  }

  setPlayers(list: RosterPlayer[]): void {
    this.players = new Map(list.map((p) => [p.id, entry(p)]));
    this.renderPlayers();
  }

  addPlayer(p: RosterPlayer): void {
    this.players.set(p.id, entry(p));
    this.renderPlayers();
    this.system(`${p.name} joined`);
  }

  // Once per snapshot: hearts and kills on the roster. Re-renders only when a number moved.
  updateStats(list: { id: string; hearts: number; kills: number; dead: boolean }[]): void {
    let changed = false;
    for (const p of list) {
      const e = this.players.get(p.id);
      if (!e) continue;
      if (e.hearts !== p.hearts || e.kills !== p.kills || e.dead !== p.dead) {
        e.hearts = p.hearts;
        e.kills = p.kills;
        e.dead = p.dead;
        changed = true;
      }
    }
    if (changed) this.renderPlayers();
  }

  removePlayer(id: string, name: string): void {
    this.players.delete(id);
    this.renderPlayers();
    this.system(`${name} left`);
  }

  setDead(id: string): void {
    const p = this.players.get(id);
    if (p) {
      p.dead = true;
      this.renderPlayers();
    }
  }

  playerName(id: string): string {
    return this.players.get(id)?.name ?? 'someone';
  }

  // Red crosshair while a shot from here would land.
  setCrosshairTarget(on: boolean): void {
    this.crosshair.classList.toggle('target', on);
  }

  // What you're holding and how to use it, or nothing.
  setItemHint(text: string, stats = ''): void {
    const key = `${text}\n${stats}`;
    if (key === this.itemHintText) return;
    this.itemHintText = key;
    this.itemHintMain.textContent = text;
    this.itemHintStats.textContent = stats;
    this.itemHint.classList.toggle('hidden', !text);
  }

  // Brief red crosshair when one of your shots lands.
  hitMarker(): void {
    this.crosshair.classList.add('hit');
    setTimeout(() => this.crosshair.classList.remove('hit'), 150);
  }

  setPing(ms: number): void {
    this.ping.textContent = `${Math.round(ms)} ms`;
  }

  setCrosshairHot(hot: boolean): void {
    this.crosshair.classList.toggle('hot', hot);
  }

  chat(name: string, color: string, text: string): void {
    const li = document.createElement('li');
    const who = document.createElement('span');
    who.className = 'who';
    who.style.color = color;
    who.textContent = `${name}: `;
    li.append(who, document.createTextNode(text));
    this.pushLine(li);
  }

  system(text: string): void {
    const li = document.createElement('li');
    li.className = 'system';
    li.textContent = text;
    this.pushLine(li);
  }

  // A small note beside the thing that was just done (the copied room code), gone in a moment.
  // Local feedback like this stays out of the chat log.
  tip(anchor: HTMLElement, text: string): void {
    anchor.parentElement?.querySelector('.tip')?.remove();
    const el = document.createElement('span');
    el.className = 'tip';
    el.textContent = text;
    anchor.insertAdjacentElement('afterend', el);
    setTimeout(() => el.classList.add('gone'), 1200);
    setTimeout(() => el.remove(), 1600);
  }

  // A kill, worded and coloured like an announcement: "ann killed bob with a sniper headshot".
  announceKill(shooter: string, victim: string, item: string, headshot: boolean): void {
    const li = document.createElement('li');
    li.className = 'kill';
    li.textContent = `${this.playerName(shooter)} killed ${this.playerName(victim)} with a ${item}${headshot ? ' headshot' : ''}`;
    this.pushLine(li);
  }

  announceFall(victim: string): void {
    const li = document.createElement('li');
    li.className = 'kill';
    li.textContent = `${this.playerName(victim)} fell to their death`;
    this.pushLine(li);
  }

  private pushLine(li: HTMLLIElement): void {
    this.chatLog.appendChild(li);
    while (this.chatLog.children.length > CHAT_LINES) this.chatLog.firstChild?.remove();
    setTimeout(() => li.classList.add('faded'), CHAT_FADE_MS);
  }

  private renderPlayers(): void {
    this.playerList.replaceChildren();
    for (const [id, p] of this.players) {
      const li = document.createElement('li');
      if (id === this.myId) li.className = 'me';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      li.append(dot);
      if (p.bot) li.append(pixelSvg(ROBOT, 'robot'));
      li.append(document.createTextNode(p.name + (id === this.myId ? ' (you)' : '')));
      const stats = document.createElement('span');
      stats.className = 'stats';
      // Dead: just the skull. Alive: hearts and kills.
      if (p.dead) stats.append(pixelSvg(SKULL, 'skull'));
      else {
        stats.append(pixelSvg(HEART, 'heart', { '+': 'hi' }), text(`${fmt(p.hearts)}/${MAX_HEARTS}`));
        stats.append(pixelSvg(KNIFE, 'knife', { G: 'guard', H: 'hilt' }), text(String(p.kills)));
      }
      li.append(stats);
      this.playerList.appendChild(li);
    }
  }
}

interface RosterPlayer {
  id: string;
  name: string;
  color: string;
  bot?: boolean;
  hearts?: number;
  kills?: number;
  dead?: boolean;
}

interface RosterEntry {
  name: string;
  color: string;
  bot: boolean;
  hearts: number;
  kills: number;
  dead: boolean;
}

function entry(p: RosterPlayer): RosterEntry {
  return {
    name: p.name,
    color: p.color,
    bot: !!p.bot,
    hearts: p.hearts ?? MAX_HEARTS,
    kills: p.kills ?? 0,
    dead: !!p.dead,
  };
}

function text(s: string): Text {
  return document.createTextNode(s);
}

// 7.5 stays 7.5; 8 stays 8.
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function loadHistory(): string[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((line): line is string => typeof line === 'string') : [];
  } catch {
    return [];
  }
}
