// A dropdown in the game's look, standing in for the browser's own: the choice on a button, and
// under it a list like the chat's completions (each choice's name with a note dimmed beside it) on a
// scroll rail. Up and Down move along the list, Enter or a click picks, and Esc or a press anywhere
// else closes it.
import { railScroll } from '../ui/scrollRail';

export interface Choice {
  value: string;
  label: string;
  note: string; // dimmed beside the label: the chat command that does the same
}

export class Picker {
  private readonly button = document.createElement('button');
  private readonly box = document.createElement('div');
  private readonly list = document.createElement('ul');
  private readonly rows: HTMLLIElement[];
  private picked = 0;
  private lit = 0; // the row Up and Down have reached while the list is open

  constructor(
    root: HTMLElement,
    private readonly choices: Choice[],
  ) {
    this.button.type = 'button';
    this.button.className = 'picked';
    this.button.setAttribute('aria-haspopup', 'listbox');
    this.box.className = 'scroller options hidden';
    this.list.setAttribute('role', 'listbox');
    this.rows = choices.map((choice, i) => {
      const row = document.createElement('li');
      row.setAttribute('role', 'option');
      const label = Object.assign(document.createElement('span'), { className: 'label', textContent: choice.label });
      const note = Object.assign(document.createElement('span'), { className: 'note', textContent: choice.note });
      row.append(label, note);
      row.addEventListener('click', () => this.pick(i));
      row.addEventListener('pointermove', () => this.light(i, false));
      return row;
    });
    this.list.append(...this.rows);
    this.box.append(this.list);
    root.append(this.button, this.box);
    railScroll(this.list);

    this.button.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    this.button.addEventListener('keydown', (e) => this.key(e));
    document.addEventListener('pointerdown', (e) => {
      if (this.isOpen && !root.contains(e.target as Node)) this.close();
    });
    this.show();
  }

  get value(): string {
    return this.choices[this.picked].value;
  }

  // Picks the choice with `value`, or the first where there's no such choice.
  choose(value: string): void {
    this.picked = Math.max(
      0,
      this.choices.findIndex((c) => c.value === value),
    );
    this.show();
  }

  private get isOpen(): boolean {
    return !this.box.classList.contains('hidden');
  }

  private open(): void {
    this.box.classList.remove('hidden');
    this.button.setAttribute('aria-expanded', 'true');
    this.light(this.picked, true);
  }

  private close(): void {
    this.box.classList.add('hidden');
    this.button.setAttribute('aria-expanded', 'false');
  }

  private key(e: KeyboardEvent): void {
    if (e.key === 'Tab') return this.close(); // and on to the next field
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!this.isOpen) {
      if (step === 0 && e.key !== 'Enter' && e.key !== ' ') return;
      this.open();
    } else if (step !== 0) this.light(Math.min(this.rows.length - 1, Math.max(0, this.lit + step)), true);
    else if (e.key === 'Enter' || e.key === ' ') this.pick(this.lit);
    else if (e.key === 'Escape') this.close();
    else return;
    // Handled here, not as the button's own click on Enter or Space.
    e.preventDefault();
    e.stopPropagation();
  }

  private light(i: number, scroll: boolean): void {
    this.rows[this.lit].classList.remove('lit');
    this.lit = i;
    this.rows[i].classList.add('lit');
    if (scroll) this.rows[i].scrollIntoView({ block: 'nearest' });
  }

  private pick(i: number): void {
    this.picked = i;
    this.show();
    this.close();
    this.button.focus();
  }

  private show(): void {
    this.button.textContent = this.choices[this.picked].label;
    this.rows.forEach((row, i) => row.setAttribute('aria-selected', String(i === this.picked)));
  }
}
