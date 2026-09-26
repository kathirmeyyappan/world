// The info card that opens when you click a cube. Closes on Q or a click outside the card; opening
// it releases the pointer lock so the mouse is usable. While open, `reading` is the cube id so the
// server can tell everyone else you're looking at it.
import type { CubeContent } from '@world/shared';

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
    const logo = this.card.querySelector('.logo') as HTMLImageElement;
    logo.style.display = info.logo ? 'block' : 'none';
    if (info.logo) {
      logo.src = info.logo;
      logo.alt = `${info.h1} logo`;
    }
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
    if (document.pointerLockElement) document.exitPointerLock();
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
