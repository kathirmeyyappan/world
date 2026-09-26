// Touch controls: a square pad on the left that acts as a joystick, and a jump button on the
// right. Both are plain DOM styled like the rest of the HUD. Only mounted on touch devices.
import type { InputManager } from './InputManager';

const RADIUS = 34;

export class MobileControls {
  private readonly pad = document.getElementById('pad');
  private readonly thumb = document.getElementById('pad-thumb');
  private touchId: number | null = null;
  private originX = 0;
  private originY = 0;

  constructor(private readonly input: InputManager) {
    if (!('ontouchstart' in window || navigator.maxTouchPoints > 0)) return;
    const pad = this.pad;
    if (pad) {
      pad.addEventListener('touchstart', (e) => {
        if (this.touchId !== null) return;
        const t = e.changedTouches[0];
        const r = pad.getBoundingClientRect();
        this.touchId = t.identifier;
        this.originX = r.left + r.width / 2;
        this.originY = r.top + r.height / 2;
        pad.classList.add('active');
        this.move(t.clientX, t.clientY);
        e.preventDefault();
      }, { passive: false });
      pad.addEventListener('touchmove', (e) => {
        for (const t of Array.from(e.changedTouches)) if (t.identifier === this.touchId) this.move(t.clientX, t.clientY);
        e.preventDefault();
      }, { passive: false });
      const end = (e: TouchEvent) => {
        for (const t of Array.from(e.changedTouches)) if (t.identifier === this.touchId) this.release();
      };
      pad.addEventListener('touchend', end);
      pad.addEventListener('touchcancel', end);
    }
    const jump = document.getElementById('jump-button');
    jump?.addEventListener('touchstart', (e) => {
      e.preventDefault();
      jump.classList.add('active');
      input.requestJump();
    }, { passive: false });
    jump?.addEventListener('touchend', () => jump.classList.remove('active'));
  }

  private move(x: number, y: number): void {
    let dx = x - this.originX;
    let dy = y - this.originY;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx *= RADIUS / len;
      dy *= RADIUS / len;
    }
    if (this.thumb) this.thumb.style.transform = `translate(${dx}px, ${dy}px)`;
    this.input.joystick = { x: dx / RADIUS, y: -dy / RADIUS };
  }

  private release(): void {
    this.touchId = null;
    this.pad?.classList.remove('active');
    if (this.thumb) this.thumb.style.transform = '';
    this.input.joystick = { x: 0, y: 0 };
  }

  dispose(): void {
    this.release();
  }
}
