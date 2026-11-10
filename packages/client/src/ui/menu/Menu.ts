// The menu, behind the gear over the room panel, the X key or Esc: tabs of rows (tabs.ts) for who
// you are, the room and its link, other rooms, sound, the view and the guide, with a look at your
// own body and the map (Preview.ts) at the top of the first. It builds its own button and card and
// keeps its own look (menu.css), so the rest of the page knows it only as the button in the top-left
// corner. With a mouse it frees the pointer to click around in, and it is what Esc brings up from
// the world (the game opens it when the pointer is let go, since the browser answers that Esc
// itself); closing it with X, Esc, its corner button or a click beside the card puts the player
// back in the world, and C swaps it for the commands card. On touch a tap on its corner button or
// beside the card closes it.
import { IS_TOUCH } from '../../input/touch';
import { rememberName } from '../../net/lobby';
import { railScroll } from '../scrollRail';
import { gearIcon } from './gearIcon';
import { Preview } from './Preview';
import { draw, type Drawn } from './rows';
import { menuTabs, type Me, type MenuHooks } from './tabs';
import './menu.css';

export { toggleFullscreen } from './tabs';
export type { MenuHooks } from './tabs';

export class Menu {
  private readonly el = document.createElement('div');
  private readonly drawn: Drawn[] = [];
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly panels: HTMLElement[] = [];
  private readonly preview: Preview;
  private readonly me: Me = {
    name: '',
    avatar: 'standard',
    color: '#ffffff',
    item: null,
    gear: null,
    chilled: false,
    shattered: [],
  };
  private open = false;
  private shown = 0; // the tab selected
  // After it opens or closes; `back` when the close should put the player back in the world.
  onOpenChange: ((open: boolean, back: boolean) => void) | null = null;

  constructor(private readonly hooks: MenuHooks) {
    this.preview = new Preview(hooks.minimap);
    this.el.id = 'menu';
    this.el.className = 'hidden';
    this.el.translate = true;
    const card = this.card(hooks);
    this.el.append(card);
    railScroll(card.querySelector<HTMLElement>('.body')!);
    document.getElementById('app')!.append(this.el);
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.hide(true);
    });
    document.addEventListener('fullscreenchange', () => this.refresh());
    // The mouse stays free while it's open, even when a capture asked for just before it opened lands
    // after (closing the chat by clicking the gear asks for one).
    document.addEventListener('pointerlockchange', () => {
      if (this.open && document.pointerLockElement) document.exitPointerLock();
    });
    // Ahead of everything else listening for keys, so nothing reaches the game or the chat while
    // it's open.
    window.addEventListener('keydown', (e) => this.key(e), { capture: true });

    const opener = document.createElement('button');
    opener.id = 'menu-button';
    opener.append(gearIcon('gear'), Object.assign(document.createElement('span'), { textContent: 'MENU' }));
    if (!IS_TOUCH) opener.append(Object.assign(document.createElement('kbd'), { textContent: 'X', translate: false }));
    opener.addEventListener('click', () => this.show());
    document.getElementById('corner')!.prepend(opener);
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
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.el.classList.add('hidden');
    this.onOpenChange?.(false, back);
  }

  // Once a frame, with the player as the room has them. A change of name after the first is a rename
  // going through, kept for the next page this tab or the home screen loads. The preview draws
  // while the PLAY tab is open.
  sync(me: Me): void {
    if (me.name !== this.me.name) {
      if (this.me.name) rememberName(me.name);
      this.me.name = me.name;
    }
    Object.assign(this.me, me);
    this.preview.sync(this.me, this.open && this.shown === 0);
    if (this.open) this.refresh();
  }

  // While it's open the menu has the keyboard: X, the key that opened it, Esc, which does too, or
  // Q, which closes the other cards, goes back to the world; C swaps it for the commands card, as it
  // would from the world; P turns the map, as in the world. Keys typed into its fields are theirs
  // (rows.ts).
  private key(e: KeyboardEvent): void {
    if (!this.open || (e.target instanceof HTMLInputElement && this.el.contains(e.target))) return;
    e.stopPropagation();
    if (e.repeat) return;
    if (e.code === 'KeyX' || e.code === 'KeyQ' || e.code === 'Escape') this.hide(true);
    else if (e.code === 'KeyC') {
      this.hooks.commands(); // up before the menu goes, so the mouse stays free for its buttons
      this.hide(true);
    } else if (e.code === 'KeyP') this.hooks.minimap.toggle();
  }

  private refresh(): void {
    for (const d of this.drawn) d.refresh?.();
  }

  // The tab shown. The others stay laid out under it, unseen and out of reach, so the card is as tall
  // as its tallest tab and doesn't jump when the tab changes.
  private select(i: number): void {
    this.shown = i;
    this.tabs.forEach((t, j) => t.classList.toggle('on', i === j));
    this.panels.forEach((p, j) => {
      p.classList.toggle('off', i !== j);
      p.inert = i !== j;
    });
  }

  private card(hooks: MenuHooks): HTMLElement {
    const card = document.createElement('div');
    card.className = 'card';
    const head = document.createElement('div');
    head.className = 'head';
    const close = Object.assign(document.createElement('button'), {
      className: 'close',
      title: 'close',
      textContent: 'X',
    });
    close.addEventListener('click', () => this.hide(true));
    head.append(Object.assign(document.createElement('h1'), { textContent: 'MENU' }), close);

    const nav = document.createElement('nav');
    const body = document.createElement('div');
    body.className = 'body';
    menuTabs(hooks, this.me).forEach((tab, i) => {
      const button = Object.assign(document.createElement('button'), { textContent: tab.title });
      button.addEventListener('click', () => this.select(i));
      this.tabs.push(button);
      const panel = document.createElement('div');
      panel.className = 'panel';
      for (const section of tab.sections) {
        const el = document.createElement('section');
        el.append(Object.assign(document.createElement('h2'), { textContent: section.title }));
        for (const row of section.rows) {
          const d = draw(row);
          this.drawn.push(d);
          el.append(d.el);
        }
        panel.append(el);
      }
      this.panels.push(panel);
      body.append(panel);
    });
    nav.append(...this.tabs);
    const scroller = document.createElement('div'); // the body beside its scroll rail
    scroller.className = 'scroller';
    scroller.append(body);
    // The window of the body and the map, with the way to the commands under it.
    const top = document.createElement('div');
    top.className = 'top';
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.innerHTML = IS_TOUCH
      ? 'hint: tap CMDS to see available commands'
      : 'hint: press <kbd translate="no">C</kbd> to see available commands';
    top.append(this.preview.el, hint);
    this.panels[0].prepend(top);
    card.append(head, nav, scroller);
    // With a keyboard the footer teaches the key; on touch the corner button says it all.
    if (!IS_TOUCH) {
      const footer = document.createElement('div');
      footer.className = 'footer';
      footer.innerHTML = 'PRESS <kbd translate="no">X</kbd> TO CLOSE<span class="cursor">▮</span>';
      card.append(footer);
    }
    this.select(0);
    return card;
  }
}
