// Red edge flash over the whole view when you take a hit. Nothing but a class toggle; the
// look is in styles.css.
const FLASH_MS = 160;

export class DamageFlash {
  private readonly el = document.getElementById('damage-flash')!;
  private timer: number | null = null;

  flash(): void {
    this.el.classList.add('on');
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.el.classList.remove('on');
      this.timer = null;
    }, FLASH_MS);
  }
}
