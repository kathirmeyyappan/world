export interface CubeInfo {
  id: string;
  h1: string;
  h2?: string;
  h3?: string;
  description: string[];
  logo?: string;
}

/**
 * Manages the HTML overlay for displaying cube information popups.
 */
export class UISystem {
  private overlay: HTMLElement;
  private card: HTMLElement;
  private onCloseCallback: (() => void) | null = null;

  constructor() {
    this.overlay = document.getElementById('info-overlay')!;
    this.card = document.getElementById('info-card')!;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    const closeBtn = this.card.querySelector('.close-btn');
    closeBtn?.addEventListener('click', () => this.hide());

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });

    window.addEventListener('keydown', (e) => {
      // Q or X to close popup (doesn't break pointer lock like Escape does)
      if ((e.code === 'KeyQ' || e.code === 'KeyX' || e.code === 'Escape') && this.isVisible()) {
        this.hide();
      }
    });
  }

  public show(info: CubeInfo, onClose?: () => void): void {
    this.onCloseCallback = onClose || null;

    const logoEl = this.card.querySelector('.logo') as HTMLImageElement;
    const h1El = this.card.querySelector('.h1')!;
    const h2El = this.card.querySelector('.h2')!;
    const h3El = this.card.querySelector('.h3')!;
    const descEl = this.card.querySelector('.description')!;

    // Logo (optional)
    if (info.logo) {
      logoEl.src = info.logo;
      logoEl.alt = `${info.h1} logo`;
      logoEl.style.display = 'block';
    } else {
      logoEl.style.display = 'none';
    }

    // Headings
    h1El.textContent = info.h1;
    h2El.textContent = info.h2 || '';
    h2El.style.display = info.h2 ? 'block' : 'none';
    h3El.textContent = info.h3 || '';
    h3El.style.display = info.h3 ? 'block' : 'none';
    
    // Render description as bullet points
    descEl.innerHTML = '';
    const ul = document.createElement('ul');
    for (const item of info.description) {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    }
    descEl.appendChild(ul);

    this.overlay.classList.add('visible');
  }

  public hide(): void {
    this.overlay.classList.remove('visible');
    if (this.onCloseCallback) {
      this.onCloseCallback();
      this.onCloseCallback = null;
    }
  }

  public isVisible(): boolean {
    return this.overlay.classList.contains('visible');
  }
}

