// The name of the area you're in (content/areas.ts), in big pixel letters across the top of the
// screen: when you join, and each time you walk into a different area. Between areas (the floor
// bridge) the last name stands, so crossing back and forth over a seam doesn't flicker.
import { areaAt } from '@world/shared';

const HOLD_MS = 2800; // how long the name stays up before fading

export class AreaTitle {
  private readonly el = document.getElementById('area-title')!;
  private current: string | null = null;
  private timer = 0;

  update(x: number, z: number): void {
    const name = areaAt(x, z)?.name;
    if (!name || name === this.current) return;
    this.current = name;
    this.el.textContent = name;
    this.el.classList.add('on');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.remove('on'), HOLD_MS);
  }
}
