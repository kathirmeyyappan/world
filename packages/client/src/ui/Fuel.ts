// The flamethrower's tank: a bar above the item hint, full when the sim says so. Hidden for
// items without fuel.
export class Fuel {
  private readonly el = document.getElementById('fuel')!;
  private readonly fill = this.el.querySelector<HTMLElement>('.fill')!;
  private shown = false;
  private level = -1;

  // `fraction` 0..1, or null to hide.
  set(fraction: number | null): void {
    const show = fraction !== null;
    if (show !== this.shown) {
      this.shown = show;
      this.el.classList.toggle('hidden', !show);
    }
    if (fraction === null) return;
    const level = Math.round(fraction * 100);
    if (level === this.level) return;
    this.level = level;
    this.fill.style.width = `${level}%`;
    this.el.classList.toggle('empty', level === 0);
  }
}
