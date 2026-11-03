// What's the matter with you, under the hearts: a counter while frozen solid (an ice hit,
// sim/constants.ts) with the view frosted over, and while chilled after it, with the frost thinning
// to a rim. Set every frame from the predicted state; the page is touched only when the shown tenth
// of a second changes.
export class Condition {
  private readonly frost = document.getElementById('frost')!;
  private readonly label = document.getElementById('condition')!;
  private text = '';
  private state: 'frozen' | 'chilled' | null = null;

  // Seconds of each left.
  set(frozen: number, chilled: number): void {
    const state = frozen > 0 ? 'frozen' : chilled > 0 ? 'chilled' : null;
    const left = Math.ceil((state === 'frozen' ? frozen : chilled) * 10) / 10;
    const text = state ? `${state.toUpperCase()} ${left.toFixed(1)}s` : '';
    if (text === this.text) return;
    this.text = text;
    this.label.textContent = text;
    if (state === this.state) return;
    this.state = state;
    this.frost.classList.toggle('frozen', state === 'frozen');
    this.frost.classList.toggle('chilled', state === 'chilled');
    this.label.classList.toggle('hidden', !state);
    this.label.classList.toggle('chilled', state === 'chilled');
  }
}
