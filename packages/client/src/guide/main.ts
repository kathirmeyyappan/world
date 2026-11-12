// The guide (world.kathirm.com/guide/): every character, item, place, bot and command, in tabs. A
// character or item is picked from a list and shown in a 3D view of its own (BodyView, the menu's
// player view) beside what it is and its numbers; the numbers come from stats.ts, read off the
// game's registries, and the words from content.ts. The tab and the pick are in the URL's hash
// (#characters/gary), so a link goes straight to one.
import {
  AVATARS,
  AVATAR_IDS,
  BOTS,
  BOT_IDS,
  BUILDING_LEVELS,
  GEAR_IDS,
  ITEMS,
  ITEM_IDS,
  MAIN_AREA,
  PICKUP_AREAS,
  TERRACE,
  TOWER_LEVELS,
  defaultBotsFor,
  type AvatarId,
  type Region,
} from '@world/shared';
import { BodyView, type Shown } from '../render/BodyView';
import { commandGroups } from '../ui/commands';
import {
  BOT_EXAMPLES,
  BOT_NOTE,
  BOT_TEXT,
  CHARACTERS,
  CONTROLS,
  GEAR_TEXT,
  INTRO,
  PICKUP_TEXT,
  PLACES,
  SPEEDY,
  WEAPONS,
  type Entry,
  type Place,
} from './content';
import { botFlagRows, characterStats, gearStats, itemStats, num, pickupStats, speedyStats, type Stat } from './stats';

const COLOR = '#64b5f6'; // the standard body's paint in the views: the page's accent

// One thing a catalog lists: its words, its numbers, and the body that shows it (none: no view).
interface Pick {
  id: string;
  entry: Entry;
  stats: () => Stat[];
  shown: Shown | null;
}

interface Section {
  title: string;
  picks: Pick[];
}

function shown(avatar: AvatarId, extra: Partial<Shown> = {}): Shown {
  return { name: '', avatar, color: COLOR, item: null, gear: null, chilled: false, shattered: [], ...extra };
}

// The skins anyone can wear, the ones only bots can wear left out.
function characters(): Section[] {
  const listed = AVATAR_IDS.filter((id) => AVATARS[id].command && !AVATARS[id].hidden);
  const pick = (id: AvatarId): Pick => ({
    id,
    entry: CHARACTERS[id],
    stats: () => characterStats(id),
    shown: shown(id),
  });
  return [
    { title: 'On foot', picks: listed.filter((id) => AVATARS[id].class === 'walker').map(pick) },
    { title: 'Dragons', picks: listed.filter((id) => AVATARS[id].class !== 'walker').map(pick) },
  ];
}

// Weapons held by the standard body (spraying, where it's a spray), a dragon's breath by its
// dragon, gear worn on the standard body's back, and what floats about with no body to show it.
function items(): Section[] {
  const owner = (item: string) => AVATAR_IDS.find((a) => AVATARS[a].item === item) ?? 'standard';
  const weapon = (id: (typeof ITEM_IDS)[number]): Pick => {
    const spec = ITEMS[id];
    const firing = spec.actions.shoot?.mode === 'hold';
    return {
      id,
      entry: WEAPONS[id],
      stats: () => itemStats(id),
      shown: spec.own ? shown(owner(id), { item: id, firing }) : shown('standard', { item: id, firing, close: true }),
    };
  };
  return [
    { title: 'Weapons', picks: ITEM_IDS.filter((id) => !ITEMS[id].own).map(weapon) },
    { title: 'Dragon breath', picks: ITEM_IDS.filter((id) => ITEMS[id].own).map(weapon) },
    {
      title: 'Gear',
      picks: GEAR_IDS.map((id) => ({
        id,
        entry: GEAR_TEXT[id],
        stats: () => gearStats(id),
        shown: shown('standard', { gear: id, thrusting: true, close: true }),
      })),
    },
    {
      title: 'Pickups and boosts',
      picks: [
        ...(['heart', 'big-heart'] as const).map((kind) => ({
          id: kind,
          entry: PICKUP_TEXT[kind],
          stats: () => pickupStats(kind),
          shown: null,
        })),
        { id: 'speedy', entry: SPEEDY, stats: speedyStats, shown: null },
      ],
    },
  ];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function statTable(stats: Stat[]): HTMLTableElement {
  const table = el('table', 'stats');
  for (const s of stats) {
    const row = table.insertRow();
    row.append(el('th', '', s.label), el('td', '', s.value));
  }
  return table;
}

function facts(list: string[]): HTMLElement[] {
  if (list.length === 0) return [];
  const ul = el('ul', 'facts');
  for (const f of list) ul.append(el('li', '', f));
  return [el('h3', '', 'Fun facts'), ul];
}

// A list to pick from beside one thing shown in full, its 3D view (where it has one) kept across picks.
class Catalog {
  readonly el = el('div', 'catalog');
  private readonly view = new BodyView();
  private readonly viewBox = el('div', 'view');
  private readonly text = el('div', 'text');
  private readonly list = el('nav', 'picker');
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly picks = new Map<string, Pick>();
  current: Pick;

  constructor(
    readonly tab: string,
    sections: Section[],
    private readonly go: (tab: string, id: string) => void,
  ) {
    const list = this.list;
    for (const section of sections) {
      list.append(el('h3', '', section.title));
      for (const pick of section.picks) {
        const b = el('button', '', pick.entry.title);
        b.addEventListener('click', () => this.go(this.tab, pick.id));
        list.append(b);
        this.buttons.set(pick.id, b);
        this.picks.set(pick.id, pick);
      }
    }
    const zoom = matchMedia('(pointer: coarse)').matches ? 'pinch' : 'scroll';
    this.viewBox.append(this.view.canvas, el('span', 'hint', `drag to turn · ${zoom} to zoom`));
    const detail = el('article', 'detail');
    detail.append(this.viewBox, this.text);
    this.el.append(list, detail);
    this.current = sections[0].picks[0];
    this.show(this.current.id);
  }

  has(id: string): boolean {
    return this.picks.has(id);
  }

  show(id: string): void {
    const pick = this.picks.get(id) ?? this.current;
    this.current = pick;
    for (const [key, b] of this.buttons) b.classList.toggle('on', key === pick.id);
    // On a phone the list is one scrolling row: bring the pick into it, once the fonts that size the
    // buttons have come.
    const b = this.buttons.get(pick.id)!;
    void document.fonts.ready.then(() => {
      const { scrollLeft, clientWidth } = this.list;
      if (b.offsetLeft < scrollLeft || b.offsetLeft + b.offsetWidth > scrollLeft + clientWidth)
        this.list.scrollLeft = b.offsetLeft - 8;
    });
    this.viewBox.classList.toggle('none', !pick.shown);
    const { entry } = pick;
    this.text.replaceChildren(
      el('h2', '', entry.title),
      ...(entry.from ? [el('p', 'from', `from ${entry.from}`)] : []),
      el('p', 'summary', entry.summary),
      statTable(pick.stats()),
      ...facts(entry.facts),
    );
    this.view.resize();
  }

  frame(visible: boolean): void {
    const s = this.current.shown;
    this.view.sync(s ?? shown('standard'), visible && s !== null);
  }
}

// How many hearts float about in these regions.
function heartsIn(regions: Region[]): number {
  return PICKUP_AREAS.filter((a) => a.kind === 'heart' && regions.includes(a.region)).reduce((n, a) => n + a.count, 0);
}

function placeStats(place: Place): Stat[] {
  const stalkers = defaultBotsFor('guide', () => 0).filter((b) => b.bot === 'stalker').length;
  switch (place.id) {
    case 'main':
      return [
        { label: 'Size', value: MAIN_AREA.kind === 'disc' ? `${num(2 * MAIN_AREA.r)} m across` : '' },
        { label: 'Hearts', value: `${heartsIn([MAIN_AREA])} floating about` },
      ].filter((s) => s.value);
    case 'buildings':
      return [{ label: 'Hearts', value: `${heartsIn(BUILDING_LEVELS)}: one inside each, and one on each roof` }];
    case 'tower':
      return [
        { label: 'Floors', value: `${TOWER_LEVELS.length - 1}, and the roof` },
        { label: 'Roof', value: `${num(TOWER_LEVELS[TOWER_LEVELS.length - 1].y)} m up` },
        { label: 'Hearts', value: `${heartsIn(TOWER_LEVELS)}` },
        { label: 'Guards', value: `${stalkers} stalker bots, one on each of the lower floors` },
      ];
    case 'terrace':
      return [
        { label: 'Height', value: `${num(TERRACE.y)} m up` },
        { label: 'Hearts', value: `${heartsIn([TERRACE])}` },
      ];
  }
}

function worldPanel(): HTMLElement {
  const panel = el('div', 'cards');
  for (const place of PLACES) {
    const card = el('section', 'card');
    card.append(
      el('h2', '', place.title),
      el('p', 'summary', place.summary),
      statTable(placeStats(place)),
      ...facts(place.facts),
    );
    panel.append(card);
  }
  return panel;
}

function botsPanel(): HTMLElement {
  const panel = el('div', 'cards');
  const lineup = defaultBotsFor('guide', () => 0);
  const circles = lineup.filter((b) => b.bot === 'circle').length;
  const stalkers = lineup.filter((b) => b.bot === 'stalker').length;
  const about = el('section', 'card wide');
  about.append(
    el('h2', '', 'Bots'),
    el('p', 'summary', BOT_NOTE),
    el(
      'p',
      'summary',
      `Every room starts with ${circles} circle bots, each in a random skin, and ${stalkers} Tung Tung Tung Sahur stalkers in the tower.`,
    ),
  );
  panel.append(about);
  for (const id of BOT_IDS) {
    const bot = BOTS[id];
    const card = el('section', 'card');
    card.append(
      el('h2', '', `/${bot.playerName}`),
      el('p', 'summary', BOT_TEXT[id].summary),
      statTable([{ label: 'Kind', value: bot.worker === 'combat' ? 'combat: takes --target' : 'simple' }]),
    );
    panel.append(card);
  }
  const flags = el('section', 'card wide');
  flags.append(el('h2', '', 'Flags'), el('p', 'summary', 'In any order, each at most once.'), statTable(botFlagRows()));
  const examples = el('ul', 'facts');
  for (const [cmd, what] of BOT_EXAMPLES) {
    const li = el('li');
    li.append(el('code', '', cmd), document.createTextNode(` ${what}`));
    examples.append(li);
  }
  flags.append(el('h3', '', 'For example'), examples);
  panel.append(flags);
  return panel;
}

function commandsPanel(): HTMLElement {
  const panel = el('div', 'cards');
  const controls = el('section', 'card wide');
  controls.append(
    el('h2', '', 'Controls'),
    statTable(CONTROLS.map(([label, value]) => ({ label, value }))),
    el('p', 'summary', 'A dragon flies forward on W and roars on A, S and D.'),
  );
  panel.append(controls);
  for (const group of commandGroups()) {
    const card = el('section', 'card');
    card.append(el('h2', '', group.title), statTable(group.rows.map((r) => ({ label: r.label, value: r.note }))));
    panel.append(card);
  }
  return panel;
}

function main(): void {
  const root = document.getElementById('guide')!;
  const header = el('header');
  const back = el('a', 'back', '← into the world');
  back.href = '/';
  header.append(back, el('h1', '', 'KATHIR WORLD GUIDE'), ...INTRO.map((p) => el('p', 'intro', p)));

  const tabs: [string, string][] = [
    ['characters', 'CHARACTERS'],
    ['items', 'ITEMS'],
    ['world', 'WORLD'],
    ['bots', 'BOTS'],
    ['commands', 'COMMANDS'],
  ];
  const nav = el('nav', 'tabs');
  const panels = new Map<string, HTMLElement>();
  const go = (tab: string, id = '') => {
    location.hash = id ? `${tab}/${id}` : tab;
  };
  const catalogs = [new Catalog('characters', characters(), go), new Catalog('items', items(), go)];
  panels.set('characters', catalogs[0].el);
  panels.set('items', catalogs[1].el);
  panels.set('world', worldPanel());
  panels.set('bots', botsPanel());
  panels.set('commands', commandsPanel());
  const buttons = new Map<string, HTMLButtonElement>();
  for (const [id, label] of tabs) {
    const b = el('button', '', label);
    b.addEventListener('click', () => go(id));
    nav.append(b);
    buttons.set(id, b);
  }
  const main = el('main');
  main.append(...panels.values());
  root.append(header, nav, main);

  let active = 'characters';
  const route = () => {
    const [tab, id] = location.hash.slice(1).split('/');
    active = panels.has(tab) ? tab : 'characters';
    for (const [key, panel] of panels) panel.classList.toggle('hidden', key !== active);
    for (const [key, b] of buttons) b.classList.toggle('on', key === active);
    const catalog = catalogs.find((c) => c.tab === active);
    if (catalog) catalog.show(id && catalog.has(id) ? id : catalog.current.id);
  };
  window.addEventListener('hashchange', route);
  route();

  const frame = () => {
    for (const c of catalogs) c.frame(c.tab === active);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
