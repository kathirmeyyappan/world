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
  canFire: boolean; // false for a scope-only weapon that isn't scoped
}

export interface MobileActionHandlers {
  onActionDown: () => void; // SELECT / FIRE pressed; FIRE stays down until onActionUp
  onActionUp: () => void;
  onScope: () => void;
  onChat: () => void;
  onCommands: () => void;
}

export class MobileActions {
  private readonly action = document.getElementById('action-button') as HTMLButtonElement | null;
  private readonly scope = document.getElementById('scope-button') as HTMLButtonElement | null;
  private readonly chat = document.getElementById('chat-button') as HTMLButtonElement | null;
  private readonly commands = document.getElementById('commands-button') as HTMLButtonElement | null;
  private label = '';

  constructor(handlers: MobileActionHandlers) {
    if (!IS_TOUCH) return;
    tap(this.action, handlers.onActionDown, handlers.onActionUp);
    tap(this.scope, handlers.onScope);
    tap(this.chat, handlers.onChat);
    tap(this.commands, handlers.onCommands);
  }

  update(state: MobileActionState): void {
    if (!IS_TOUCH || !this.action || !this.scope) return;
    const label = state.item ? (state.canFire ? 'FIRE' : 'SCOPE TO FIRE') : state.hot ? 'SELECT' : '';
    if (label !== this.label) {
      this.label = label;
      this.action.textContent = label;
      this.action.classList.toggle('hidden', !label);
      this.action.classList.toggle('fire', label === 'FIRE');
      this.action.classList.toggle('disabled', label === 'SCOPE TO FIRE');
    }
    const canScope = !!state.item && 'scope' in ITEMS[state.item].actions;
    this.scope.classList.toggle('hidden', !canScope);
    this.scope.classList.toggle('on', state.scoped);
  }
}

// A press that fires once on touchstart, with a pressed look until release, which `onUp` hears
// about for buttons that are held. Touch only, so a synthesized click never double-fires.
function tap(button: HTMLButtonElement | null, onDown: () => void, onUp?: () => void): void {
  if (!button) return;
  button.addEventListener('touchstart', (e) => {
    e.preventDefault();
    button.classList.add('active');
    onDown();
  }, { passive: false });
  const up = () => {
    button.classList.remove('active');
    onUp?.();
  };
  button.addEventListener('touchend', up);
  button.addEventListener('touchcancel', up);
}
