// Touch replacements for the keyboard and mouse actions: one context button that reads SELECT
// when the crosshair is on a cube and FIRE when holding a weapon, a SCOPE button that only
// exists for items that can scope, and a CHAT button since there is no Enter key. Plain DOM,
// only mounted on touch devices. The Game tells it what's true each frame; it never reads
// game state itself.
import { ITEMS, type ItemId } from '@world/shared';
import { IS_TOUCH } from './touch';

export interface MobileActionState {
  hot: boolean; // crosshair on something selectable
  item: ItemId | null;
  scoped: boolean;
}

export interface MobileActionHandlers {
  onAction: () => void;
  onScope: () => void;
  onChat: () => void;
}

export class MobileActions {
  private readonly action = document.getElementById('action-button') as HTMLButtonElement | null;
  private readonly scope = document.getElementById('scope-button') as HTMLButtonElement | null;
  private readonly chat = document.getElementById('chat-button') as HTMLButtonElement | null;
  private label = '';

  constructor(handlers: MobileActionHandlers) {
    if (!IS_TOUCH) return;
    tap(this.action, handlers.onAction);
    tap(this.scope, handlers.onScope);
    tap(this.chat, handlers.onChat);
  }

  update(state: MobileActionState): void {
    if (!IS_TOUCH || !this.action || !this.scope) return;
    const label = state.item ? 'FIRE' : state.hot ? 'SELECT' : '';
    if (label !== this.label) {
      this.label = label;
      this.action.textContent = label;
      this.action.classList.toggle('hidden', !label);
      this.action.classList.toggle('fire', label === 'FIRE');
    }
    const canScope = !!state.item && 'scope' in ITEMS[state.item].actions;
    this.scope.classList.toggle('hidden', !canScope);
    this.scope.classList.toggle('on', state.scoped);
  }
}

// A press that fires once on touchstart, with a pressed look until release. Touch only, so a
// synthesized click never double-fires.
function tap(button: HTMLButtonElement | null, handler: () => void): void {
  if (!button) return;
  button.addEventListener('touchstart', (e) => {
    e.preventDefault();
    button.classList.add('active');
    handler();
  }, { passive: false });
  const up = () => button.classList.remove('active');
  button.addEventListener('touchend', up);
  button.addEventListener('touchcancel', up);
}
