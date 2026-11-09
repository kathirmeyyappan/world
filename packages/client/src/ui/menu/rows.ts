// The kinds of row the menu is made of, and how each draws itself. A row is plain data: what it says,
// and functions that read and change what it's about. The menu's content (tabs.ts) never touches the
// DOM, and a new kind of row is a type here and a case in `draw`.
import { IS_TOUCH } from '../../input/touch';

export interface Tab {
  title: string;
  sections: Section[];
}

export interface Section {
  title: string;
  rows: Row[];
}

export type Row = Toggle | Stepper | Field | Buttons | Share;

// A setting with a few values: its button reads the one it's on and moves it to the next.
export interface Toggle {
  kind: 'toggle';
  label: string;
  key?: string; // its key in play, shown with a keyboard
  value: () => string;
  press: () => void;
}

// A setting stepped through its values, < and > either side of the one it's on. With `auto`, a
// button before them hands the choice to the game, lit while it has it; a step takes it back.
export interface Stepper {
  kind: 'stepper';
  label: string;
  value: () => string;
  step: (by: 1 | -1) => void;
  can: (by: 1 | -1) => boolean; // whether there's a value that way
  auto?: { label: () => string; on: () => boolean; press: () => void };
  hint?: () => string | null; // a warning under it, while there's one to give
}

// Something typed and sent, a name or a room code. `note` is what to say under it (an error, or how
// the sending went), read again whenever the menu refreshes.
export interface Field {
  kind: 'field';
  label: string;
  placeholder: string;
  maxLength: number;
  action: string; // the button's label
  value?: () => string; // what the box shows while it isn't being typed in
  submit: (text: string) => void;
  note: () => Note | null;
  hint?: string; // said under it, dimmed, while there's no note
}

export interface Note {
  text: string;
  tone: 'ok' | 'bad' | 'busy' | 'hint';
}

export interface Buttons {
  kind: 'buttons';
  buttons: Button[];
}

export interface Button {
  label: string;
  press?: () => void;
  href?: string; // opens in a new tab
  danger?: boolean; // red: a way out of the room
}

// A link to hand on: copied, or on a phone sent through the share sheet, and shown to copy by hand.
export interface Share {
  kind: 'share';
  name: string; // what it's a link to ("global")
  link: string;
  note?: string;
}

// A drawn row, and how to bring it up to date with what it shows.
export interface Drawn {
  el: HTMLElement;
  refresh?: () => void;
}

const SAID_MS = 1500; // how long a share button says what it did

export function draw(row: Row): Drawn {
  switch (row.kind) {
    case 'toggle':
      return toggle(row);
    case 'stepper':
      return stepper(row);
    case 'field':
      return field(row);
    case 'buttons':
      return buttons(row);
    case 'share':
      return share(row);
  }
}

function toggle(row: Toggle): Drawn {
  const el = element('div', 'row');
  const name = element('span', 'name', row.label);
  if (row.key && !IS_TOUCH) name.append(element('kbd', '', row.key));
  const button = element('button', 'value');
  button.translate = false;
  button.addEventListener('click', () => {
    row.press();
    refresh();
  });
  const refresh = () => {
    const value = row.value();
    if (button.textContent !== value) button.textContent = value;
    button.classList.toggle('off', value === 'OFF');
  };
  el.append(name, button);
  return { el, refresh };
}

function stepper(row: Stepper): Drawn {
  const el = element('div', 'stepper');
  const line = element('div', 'row');
  const controls = element('div', 'controls');
  const refreshers: (() => void)[] = [];
  const pressing = (button: HTMLButtonElement, press: () => void) =>
    button.addEventListener('click', () => {
      press();
      refresh();
    });
  const steps = element('div', 'steps');
  if (row.auto) {
    const { label, on, press } = row.auto;
    const auto = element('button', 'auto');
    auto.translate = false;
    pressing(auto, press);
    refreshers.push(() => {
      const text = label();
      if (auto.textContent !== text) auto.textContent = text;
      auto.classList.toggle('on', on());
      steps.classList.toggle('off', on());
    });
    controls.append(auto);
  }
  const reading = element('span', 'reading');
  reading.translate = false;
  for (const by of [-1, 1] as const) {
    const button = element('button', 'step', by < 0 ? '<' : '>');
    button.translate = false;
    pressing(button, () => row.step(by));
    refreshers.push(() => (button.disabled = !row.can(by)));
    steps.append(by < 0 ? button : reading, by < 0 ? reading : button);
  }
  refreshers.push(() => {
    const text = row.value();
    if (reading.textContent !== text) reading.textContent = text;
  });
  controls.append(steps);
  line.append(element('span', 'name', row.label), controls);
  el.append(line);
  if (row.hint) {
    const { hint } = row;
    const warning = element('div', 'hint');
    refreshers.push(() => {
      const text = hint() ?? '';
      if (warning.textContent !== text) warning.textContent = text;
      warning.hidden = !text;
    });
    el.append(warning);
  }
  const refresh = () => refreshers.forEach((r) => r());
  return { el, refresh };
}

function field(row: Field): Drawn {
  const el = element('div', 'field');
  const input = element('input');
  input.type = 'text';
  input.maxLength = row.maxLength;
  input.placeholder = row.placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.translate = false;
  const go = element('button', 'go', row.action);
  const note = element('div', 'note');
  const line = element('div', 'line');
  line.append(input, go);
  el.append(element('div', 'name', row.label), line, note);
  const refresh = () => {
    const shown = row.value?.();
    if (shown !== undefined && document.activeElement !== input && input.value !== shown) input.value = shown;
    const n = row.note() ?? (row.hint ? { text: row.hint, tone: 'hint' } : null);
    if (note.textContent !== (n?.text ?? '')) note.textContent = n?.text ?? '';
    note.dataset.tone = n?.tone ?? '';
  };
  const submit = () => {
    row.submit(input.value);
    input.blur(); // on a phone, puts the keyboard away
    refresh();
  };
  go.addEventListener('click', submit);
  // What's typed here is for this box, not for the game or the chat (whose keys listen on the window).
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') submit();
    else if (e.key === 'Escape') input.blur();
  });
  return { el, refresh };
}

function buttons(row: Buttons): Drawn {
  const el = element('div', 'buttons');
  for (const b of row.buttons) {
    const button = b.href ? element('a', 'button', b.label) : element('button', '', b.label);
    if (b.danger) button.classList.add('danger');
    if (button instanceof HTMLAnchorElement && b.href) {
      button.href = b.href;
      button.target = '_blank';
      button.rel = 'noopener';
    }
    if (b.press) button.addEventListener('click', b.press);
    el.append(button);
  }
  return { el };
}

function share(row: Share): Drawn {
  const el = element('div', 'share');
  const title = element('p', 'code', row.name);
  title.translate = false;
  const label = canShare() ? 'SHARE JOIN LINK' : 'COPY JOIN LINK';
  const button = element('button', 'wide', label);
  const link = element('div', 'link', row.link);
  link.translate = false;
  el.append(title, button, link);
  if (row.note) el.append(element('p', 'warn', row.note));
  let timer = 0;
  const say = (text: string) => {
    button.textContent = text;
    clearTimeout(timer);
    timer = window.setTimeout(() => (button.textContent = label), SAID_MS);
  };
  // To the phone's share sheet where there is one, else the clipboard, and when neither works,
  // selected on the card to copy by hand.
  button.addEventListener('click', async () => {
    if (canShare()) {
      try {
        await navigator.share({ title: 'kathir world', url: row.link });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return; // the sheet was closed
      }
    }
    try {
      await navigator.clipboard.writeText(row.link);
      say('COPIED!');
    } catch {
      getSelection()?.selectAllChildren(link);
      say('COPY IT BELOW');
    }
  });
  return { el };
}

// On a phone the share sheet, which can copy too; with a mouse, the clipboard is what's expected.
function canShare(): boolean {
  return IS_TOUCH && 'share' in navigator;
}

// Text goes in as text, never markup: some of it (a link, a name) comes from the page's URL.
function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}
