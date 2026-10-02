// A glow round the edge of the whole view that comes on for a moment and then fades: red when you
// take a hit, gold when you heal. Nothing but a class toggle on its element; each look is in
// styles.css (.edge-flash, and its colour by id).
export class EdgeFlash {
  private timer: number | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly ms: number, // how long it's on, coming in included, before it fades
  ) {}

  flash(): void {
    this.el.classList.add('on');
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.el.classList.remove('on');
      this.timer = null;
    }, this.ms);
  }
}
