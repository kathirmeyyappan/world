// What's the matter with you, under the hearts: a counter while chilled (an ice hit,
// sim/constants.ts) with the view frosted over. Set every frame from the predicted state; the page
// is touched only when the shown tenth of a second changes.
export class Condition {
  private readonly frost = document.getElementById('frost')!;
  private readonly label = document.getElementById('condition')!;
  private text = '';

  // Seconds of the chill left.
  set(chilled: number): void {
    const text = chilled > 0 ? `CHILLED ${(Math.ceil(chilled * 10) / 10).toFixed(1)}s` : '';
    if (text === this.text) return;
    const was = !!this.text;
    this.text = text;
    this.label.textContent = text;
    if (!!text === was) return;
    this.frost.classList.toggle('chilled', !!text);
    this.label.classList.toggle('hidden', !text);
  }
}
