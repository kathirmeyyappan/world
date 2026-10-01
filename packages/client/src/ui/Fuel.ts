// A tank's gauge: the flamethrower's bar above the item hint (the default element), or the one in
// the gear panel. Full when the sim says so; hidden for items without fuel.
export class Fuel {
  private readonly fill: HTMLElement;
  private shown = false;
  private level = -1;

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
    if (fraction === null) return;
    // In tenths of a percent: a slow refill (an 8 s tank takes about 27 s) crosses a whole percent
    // only every quarter second, which reads as the bar stepping.
    const level = Math.round(fraction * 1000);
    if (level === this.level) return;
    this.level = level;
    this.fill.style.width = `${level / 10}%`;
    this.el.classList.toggle('empty', level === 0);
  }
}
