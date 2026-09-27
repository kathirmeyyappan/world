// A small line under the crosshair: who you hit and for how much when a shot lands, brighter
// for a headshot, or a plain note about what you're holding ("only fires while scoped").
// Separate from chat so it never scrolls the log.
const SHOW_MS = 900;
const NOTE_MS = 1500;

export class HitNotice {
  private readonly el = document.getElementById('hit-notice')!;
  private timer: number | null = null;

  show(name: string, damage: number, headshot: boolean): void {
    this.put(`${headshot ? 'HEADSHOT' : 'hit'} ${name}  -${damage}`, headshot ? 'headshot' : '', SHOW_MS);
  }

  note(text: string): void {
    this.put(text, 'note', NOTE_MS);
  }

  private put(text: string, cls: string, ms: number): void {
    this.el.textContent = text;
    this.el.classList.remove('headshot', 'note');
    if (cls) this.el.classList.add(cls);
    this.el.classList.add('on');
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.el.classList.remove('on');
      this.timer = null;
    }, ms);
  }
}
