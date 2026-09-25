// Room code, player roster, ping, and chat. Pure DOM; the Game feeds it events.
import { MAX_CHAT_LENGTH } from '@world/shared';

const CHAT_LINES = 8;
const CHAT_FADE_MS = 12_000;

export class Hud {
  private readonly roomCode = document.getElementById('room-code') as HTMLButtonElement;
  private readonly playerList = document.getElementById('player-list')!;
  private readonly ping = document.getElementById('ping')!;
  private readonly chatLog = document.getElementById('chat-log')!;
  private readonly chatInput = document.getElementById('chat-input') as HTMLInputElement;
  private readonly crosshair = document.getElementById('crosshair')!;
  private players = new Map<string, { name: string; color: string }>();
  private myId = '';
  onChat: ((text: string) => void) | null = null;
  onChatOpenChange: ((open: boolean) => void) | null = null;

  constructor(roomId: string) {
    this.roomCode.textContent = roomId;
    this.roomCode.addEventListener('click', () => {
      const url = new URL(location.href);
      url.searchParams.set('room', roomId);
      url.searchParams.delete('name');
      navigator.clipboard?.writeText(url.toString()).then(() => this.system('invite link copied'));
    });

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
        if (text) this.onChat?.(text);
        this.closeChat();
      } else if (e.code === 'Escape') {
        this.closeChat();
      }
    });
    this.chatInput.addEventListener('blur', () => this.closeChat());
  }

  isChatOpen(): boolean {
    return !this.chatInput.classList.contains('hidden');
  }

  private openChat(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    this.chatInput.classList.remove('hidden');
    this.chatInput.value = '';
    this.chatInput.focus();
    this.onChatOpenChange?.(true);
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

  setPlayers(list: { id: string; name: string; color: string }[]): void {
    this.players = new Map(list.map((p) => [p.id, { name: p.name, color: p.color }]));
    this.renderPlayers();
  }

  addPlayer(p: { id: string; name: string; color: string }): void {
    this.players.set(p.id, { name: p.name, color: p.color });
    this.renderPlayers();
    this.system(`${p.name} joined`);
  }

  removePlayer(id: string, name: string): void {
    this.players.delete(id);
    this.renderPlayers();
    this.system(`${name} left`);
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
      li.append(dot, document.createTextNode(p.name + (id === this.myId ? ' (you)' : '')));
      this.playerList.appendChild(li);
    }
  }
}
