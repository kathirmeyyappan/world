// A small line under the crosshair when one of your shots lands: who you hit and for how
// much, brighter for a headshot. Separate from chat so it never scrolls the log.
const SHOW_MS = 900;

export class HitNotice {
  private readonly el = document.getElementById('hit-notice')!;
  private timer: number | null = null;

  show(name: string, damage: number, headshot: boolean): void {
    this.el.textContent = `${headshot ? 'HEADSHOT' : 'hit'} ${name}  -${damage}`;
    this.el.classList.toggle('headshot', headshot);
    this.el.classList.add('on');
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.el.classList.remove('on');
      this.timer = null;
    }, SHOW_MS);
  }
}
