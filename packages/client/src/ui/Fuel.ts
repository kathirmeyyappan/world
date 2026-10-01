// A tank's gauge: the flamethrower's bar above the item hint (the default element), or the one in
// the gear panel. Set every frame to the sim's exact level as a scale on the fill, which the browser
// composites without layout, so it drains and refills smoothly; hidden for items without fuel.
export class Fuel {
  private readonly fill: HTMLElement;
  private shown = false;
  private level = -1;
  private empty = false;

  constructor(private readonly el: HTMLElement = document.getElementById('fuel')!) {
    this.fill = el.querySelector<HTMLElement>('.fill')!;
  }

  // `fraction` 0..1, or null to hide.
  set(fraction: number | null): void {
    const show = fraction !== null;
    if (show !== this.shown) {
      this.shown = show;
      this.el.classList.toggle('hidden', !show);
    }
    if (fraction === null || fraction === this.level) return;
    this.level = fraction;
    this.fill.style.transform = `scaleX(${fraction})`;
    if ((fraction === 0) !== this.empty) {
      this.empty = fraction === 0;
      this.el.classList.toggle('empty', this.empty);
    }
  }
}
