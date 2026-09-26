// A speech bubble anchored to a world position. The line types in, holds, then backspaces out.
import { Matrix, Vector3, type Camera, type Scene } from '@babylonjs/core';

const TYPE_MS = 32;
const HOLD_MS = 2600;
const DELETE_MS = 18;

export class Bubble {
  private readonly el: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  private anchor: Vector3 | null = null;
  private timer: number | null = null;
  private generation = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'bubble';
    this.el.classList.add('hidden');
    this.text = document.createElement('span');
    this.el.append(this.text, Object.assign(document.createElement('span'), { className: 'bubble-cursor', textContent: '▮' }));
    document.getElementById('hud')!.appendChild(this.el);
  }

  say(line: string, anchor: Vector3): void {
    const gen = ++this.generation;
    if (this.timer !== null) clearTimeout(this.timer);
    this.anchor = anchor;
    this.text.textContent = '';
    this.el.classList.remove('hidden');

    const step = (fn: () => boolean, ms: number, done: () => void) => {
      const tick = () => {
        if (gen !== this.generation) return;
        if (fn()) this.timer = window.setTimeout(tick, ms);
        else done();
      };
      tick();
    };
    let i = 0;
    step(() => (i < line.length ? ((this.text.textContent = line.slice(0, ++i)), true) : false), TYPE_MS, () => {
      this.timer = window.setTimeout(() => {
        if (gen !== this.generation) return;
        step(() => (i > 0 ? ((this.text.textContent = line.slice(0, --i)), true) : false), DELETE_MS, () => this.hide());
      }, HOLD_MS);
    });
  }

  hide(): void {
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.anchor = null;
    this.el.classList.add('hidden');
  }

  update(scene: Scene, camera: Camera, canvas: HTMLCanvasElement): void {
    if (!this.anchor) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const behind = Vector3.TransformCoordinates(this.anchor, camera.getViewMatrix()).z < 0;
    const s = Vector3.Project(this.anchor, Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(w, h));
    const visible = !behind && s.x > -100 && s.x < w + 100 && s.y > -50 && s.y < h + 50;
    this.el.style.visibility = visible ? 'visible' : 'hidden';
    const x = Math.min(w - 20, Math.max(20, s.x));
    const y = Math.min(h - 20, Math.max(60, s.y));
    this.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }
}
