// The "you died" screen: a red wash over everything, who got you, and a countdown to rejoin.
// Rejoining reloads the page; the session cookie puts the player back in the same room as a
// fresh player, which is what a death means here, coming back where the dead do (lobby.ts respawn).
import { DEATH_SCREEN_SECONDS } from '@world/shared';
import { leaveRoom, respawn } from '../net/lobby';

export class Death {
  private readonly root = document.getElementById('death')!;
  private readonly by = document.getElementById('death-by')!;
  private readonly count = document.getElementById('death-count')!;
  private timer: number | null = null;

  constructor() {
    document.getElementById('death-rejoin')!.addEventListener('click', respawn);
    document.getElementById('death-exit')!.addEventListener('click', () => {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      leaveRoom();
    });
  }

  // `how`: "shot by kathir", "you fell".
  show(how: string): void {
    if (this.timer !== null) return;
    this.by.textContent = how;
    this.root.classList.remove('hidden');
    document.exitPointerLock?.();
    let left = DEATH_SCREEN_SECONDS;
    const tick = () => {
      this.count.textContent = `rejoining in ${left}`;
      if (left-- <= 0) respawn();
      else this.timer = window.setTimeout(tick, 1000);
    };
    tick();
  }
}
