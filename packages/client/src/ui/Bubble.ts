// A line of text sitting just above a world position: a speech bubble with a tail pointing down at
// it, or a plain box. While you look at the object the line types in; look away and it
// backspaces out from wherever it got to. Look back and it resumes.
import { Matrix, Vector3, type Camera, type Scene } from '@babylonjs/core';

const TYPE_MS = 32;
const DELETE_MS = 18;

export class Bubble {
  private readonly el: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  private anchor: Vector3 | null = null;
  private line = '';
  private shown = 0; // characters currently on screen
  private dir: 1 | -1 = -1; // typing while hovered, deleting otherwise
  private timer: number | null = null;

  constructor(look: 'speech' | 'plain' = 'speech') {
    this.el = document.createElement('div');
    this.el.className = `bubble ${look} hidden`;
    this.text = document.createElement('span');
    this.el.append(
      this.text,
      Object.assign(document.createElement('span'), { className: 'bubble-cursor', textContent: '▮' }),
    );
    document.getElementById('hud')!.appendChild(this.el);
  }

  // Start (or resume) typing this line. A different line replaces whatever was showing.
  hover(line: string, anchor: Vector3): void {
    if (line !== this.line) {
      this.line = line;
      this.shown = 0;
      this.text.textContent = '';
    }
    this.anchor = anchor;
    this.dir = 1;
    this.el.classList.remove('hidden');
    this.run();
  }

  // Start backspacing from wherever typing got to. Hides once nothing is left.
  release(): void {
    this.dir = -1;
    this.run();
  }

  hide(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.anchor = null;
    this.line = '';
    this.shown = 0;
    this.el.classList.add('hidden');
  }

  // One ticker moves `shown` toward the full line or toward zero, whichever `dir` says. It stops
  // when it gets there and hover()/release() restart it when the direction changes.
  private run(): void {
    if (this.timer !== null) return;
    const tick = () => {
      this.timer = null;
      if (this.dir === 1 && this.shown < this.line.length) this.shown++;
      else if (this.dir === -1 && this.shown > 0) this.shown--;
      else {
        if (this.shown === 0) this.hide();
        return;
      }
      this.text.textContent = this.line.slice(0, this.shown);
      this.timer = window.setTimeout(tick, this.dir === 1 ? TYPE_MS : DELETE_MS);
    };
    tick();
  }

  update(scene: Scene, camera: Camera, canvas: HTMLCanvasElement): void {
    if (!this.anchor) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const behind = Vector3.TransformCoordinates(this.anchor, camera.getViewMatrix()).z < 0;
    const s = Vector3.Project(
      this.anchor,
      Matrix.Identity(),
      scene.getTransformMatrix(),
      camera.viewport.toGlobal(w, h),
    );
    const visible = !behind && s.x > -100 && s.x < w + 100 && s.y > -50 && s.y < h + 50;
    this.el.style.visibility = visible ? 'visible' : 'hidden';
    const x = Math.min(w - 20, Math.max(20, s.x));
    const y = Math.min(h - 20, Math.max(60, s.y));
    this.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }
}
