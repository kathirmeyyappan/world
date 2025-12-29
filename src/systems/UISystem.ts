export interface CubeInfo {
  id: string;
  name: string;
  role: string;
  period: string;
  description: string;
  logo: string;
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
    const nameEl = this.card.querySelector('.name')!;
    const roleEl = this.card.querySelector('.role')!;
    const periodEl = this.card.querySelector('.period')!;
    const descEl = this.card.querySelector('.description')!;

    logoEl.src = info.logo;
    logoEl.alt = `${info.name} logo`;
    nameEl.textContent = info.name;
    roleEl.textContent = info.role;
    periodEl.textContent = info.period;
    descEl.textContent = info.description;

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

