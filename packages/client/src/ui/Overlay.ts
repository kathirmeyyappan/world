// The info card that opens when you click a cube. Closes on Q, or on a click outside the card once
// the mouse is free (Esc). Pointer lock is left alone so opening it doesn't break immersion.
// While open, `reading` is the cube id so the server can tell everyone else you're looking at it.
import type { CubeContent } from '@world/shared';
import { LOGO_PIXELS } from '../render/CubeMesh';
import { loadPixelated } from '../render/pixelate';

export class Overlay {
  private readonly overlay = document.getElementById('info-overlay')!;
  private readonly card = document.getElementById('info-card')!;
  reading: string | null = null;

  constructor() {
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
    window.addEventListener('keydown', (e) => {
      if (this.isVisible() && e.code === 'KeyQ') this.hide();
    });
  }

  show(info: CubeContent): void {
    const logo = this.card.querySelector('.logo') as HTMLCanvasElement;
    logo.style.display = info.logo ? 'block' : 'none';
    const ctx = logo.getContext('2d')!;
    ctx.clearRect(0, 0, logo.width, logo.height);
    if (info.logo) {
      const url = info.logo;
      loadPixelated(url, LOGO_PIXELS).then((canvas) => {
        if (this.reading === info.id) ctx.drawImage(canvas, 0, 0);
      });
    }
    (this.card.querySelector('.card-bar-id') as HTMLElement).textContent = info.id.toUpperCase();
    this.setText('.h1', info.h1);
    this.setText('.h2', info.h2);
    this.setText('.h3', info.h3);
    const desc = this.card.querySelector('.description')!;
    desc.replaceChildren();
    const ul = document.createElement('ul');
    for (const line of info.description) {
      const li = document.createElement('li');
      li.textContent = line;
      ul.appendChild(li);
    }
    desc.appendChild(ul);
    this.reading = info.id;
    this.overlay.classList.add('visible');
  }

  hide(): void {
    this.overlay.classList.remove('visible');
    this.reading = null;
  }

  isVisible(): boolean {
    return this.overlay.classList.contains('visible');
  }

  private setText(selector: string, value: string | undefined): void {
    const el = this.card.querySelector(selector) as HTMLElement;
    el.textContent = value ?? '';
    el.style.display = value ? 'block' : 'none';
  }
}
