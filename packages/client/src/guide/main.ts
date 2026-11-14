// The guide (world.kathirm.com/guide/): every character, item, place, bot and command, in tabs. A
// character or item is picked from a list and shown in a 3D view of its own (BodyView, the menu's
// player view: a character standing, an item floating on its own) beside what it is and its numbers; the numbers come from stats.ts, read off the
// game's registries, and the words from content.ts. The tab and the pick are in the URL's hash
// (#characters/gary), so a link goes straight to one.
import {
  AVATARS,
  AVATAR_IDS,
  BOTS,
  BOT_IDS,
  ANNEX,
  BUILDING_GROUNDS,
  BUILDING_LEVELS,
  BUILDING_NAMES,
  CUBES,
  DUNE_HEIGHT,
  GEAR_IDS,
  ITEMS,
  ITEM_IDS,
  KRUSTY_KRAB_FLOOR,
  KRUSTY_KRAB_GROUNDS,
  KRUSTY_KRAB_PROFILE,
  PICKUP_AREAS,
  PINEAPPLE_LEVELS,
  PINEAPPLE_PROFILE,
  TERRACE,
  TOWER_LEVELS,
  defaultBotsFor,
  botArguments,
  type AvatarId,
  type BotId,
  type Region,
} from '@world/shared';
import { BodyView, type Shown, type Thing } from '../render/BodyView';
import { MapCanvas } from '../ui/MapCanvas';
import { MapControls } from '../ui/mapControls';
import { commandGroups } from '../ui/commands';
import {
  ABILITIES,
  BOT_EXAMPLES,
  BOT_FLAG_TEXT,
  BOT_DIAGRAM_TEXT,
  BOT_NOTE,
  CHARACTERS,
  CONTROLS,
  GEAR_TEXT,
  INTRO,
  PICKUP_TEXT,
  PLACES,
  RESUME_CUBE,
  SPEEDY,
  ITEM_TEXT,
  type Entry,
  type Photo,
  type Place,
} from './content';
import { botDiagram } from './botDiagrams';
import { cubeThing, gearThing, itemThing, pickupThing } from './things';
import {
  abilityStats,
  botFlagRows,
  characterStats,
  gearStats,
  itemStats,
  num,
  pickupStats,
  speedyStats,
  type Stat,
} from './stats';

const COLOR = '#ff7043'; // the standard body's paint in the views

// One thing a catalog lists: its words, its numbers, and what its view shows: a body, a thing on
// its own, or nothing.
interface Pick {
  id: string;
  entry: Entry;
  stats: () => Stat[];
  abilities?: () => { entry: Entry; stats: Stat[] }[]; // what it can do that the rest can't, each under its own heading
  view: { body: Shown } | { thing: Thing } | null;
}

interface Section {
  title: string;
  picks: Pick[];
}

function shown(avatar: AvatarId): Shown {
  return { name: '', avatar, color: COLOR, item: null, gear: null, chilled: false, shattered: [] };
}

// The skins anyone can wear, the ones only bots can wear left out.
function characters(): Section[] {
  const listed = AVATAR_IDS.filter((id) => AVATARS[id].command && !AVATARS[id].hidden);
  const pick = (id: AvatarId): Pick => ({
    id,
    entry: CHARACTERS[id],
    stats: () => characterStats(id),
    abilities: () => abilityStats(id).map((a) => ({ entry: ABILITIES[a.id], stats: a.stats })),
    view: { body: shown(id) },
  });
  return [
    { title: 'Characters', picks: listed.filter((id) => AVATARS[id].class === 'walker').map(pick) },
    { title: 'Dragons', picks: listed.filter((id) => AVATARS[id].class !== 'walker').map(pick) },
  ];
}

// The items as the commands card groups them: what you equip, each floating on its own; a dragon's
// breath, which is its dragon's mouth and so has nothing to show alone; what floats about the world
// (hearts, and the résumé cubes); and the speed boost, which is just a command.
function items(): Section[] {
  const own = ITEM_IDS.filter((id) => ITEMS[id].own);
  const item = (id: (typeof ITEM_IDS)[number]): Pick => ({
    id,
    entry: ITEM_TEXT[id],
    stats: () => itemStats(id),
    view: ITEMS[id].own ? null : { thing: itemThing(id) },
  });
  const cube: Pick = {
    id: 'resume-cube',
    entry: RESUME_CUBE,
    stats: () => [{ label: 'In the world', value: `${CUBES.length}` }],
    view: { thing: cubeThing(CUBES[0]) },
  };
  return [
    {
      title: 'Equip',
      picks: [
        ...ITEM_IDS.filter((id) => !own.includes(id)).map(item),
        ...GEAR_IDS.map((id): Pick => ({
          id,
          entry: GEAR_TEXT[id],
          stats: () => gearStats(id),
          view: { thing: gearThing(id) },
        })),
      ],
    },
    { title: 'Dragon breath', picks: own.map(item) },
    {
      title: 'Floating about',
      picks: [
        ...(['heart', 'big-heart'] as const).map((kind): Pick => ({
          id: kind,
          entry: PICKUP_TEXT[kind],
          stats: () => pickupStats(kind),
          view: { thing: pickupThing(kind) },
        })),
        cube,
      ],
    },
    { title: 'Other', picks: [{ id: 'speedy', entry: SPEEDY, stats: speedyStats, view: null }] },
  ];
}

// A name as the game shouts it ("ANIME BUILDING") in the guide's case ("Anime Building").
function titleCase(name: string): string {
  return name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// A registry's one-line blurb ("circles the nearest player") as a sentence.
function sentence(blurb: string): string {
  return `${blurb[0].toUpperCase()}${blurb.slice(1)}.`;
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

function list(lines: string[]): HTMLUListElement {
  const ul = el('ul', 'facts');
  for (const line of lines) ul.append(el('li', '', line));
  return ul;
}

function facts(lines: string[]): HTMLElement[] {
  return lines.length === 0 ? [] : [el('h3', '', 'Fun facts'), list(lines)];
}

// A row of small tabs over one body at a time, `first` showing to begin with.
function subTabs(tabs: { title: string; body: HTMLElement }[], first = 0): HTMLElement {
  const box = el('div', 'subtabs');
  const row = el('nav');
  const buttons = tabs.map(({ title }, i) => {
    const b = el('button', '', title);
    b.addEventListener('click', () => pick(i));
    row.append(b);
    return b;
  });
  const pick = (at: number) => {
    buttons.forEach((b, i) => b.classList.toggle('on', i === at));
    tabs.forEach(({ body }, i) => body.classList.toggle('hidden', i !== at));
  };
  box.append(row, ...tabs.map((t) => t.body));
  pick(first);
  return box;
}

// A list to pick from beside one thing shown in full, its 3D view (where it has one) kept across picks.
class Catalog {
  readonly el = el('div', 'catalog');
  private readonly view = new BodyView(1 / devicePixelRatio);
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
    this.viewBox.classList.toggle('none', !pick.view);
    const { entry } = pick;
    this.text.replaceChildren(
      el('h2', '', entry.title),
      ...(entry.summary ? [el('p', 'summary', entry.summary)] : []),
      statTable(pick.stats()),
      ...(pick.abilities?.() ?? []).flatMap((a) => [
        el('h3', '', `Special ability: ${a.entry.title}`),
        el('p', 'summary', a.entry.summary),
        statTable(a.stats),
      ]),
      ...facts(entry.facts),
    );
    this.view.resize();
  }

  frame(visible: boolean): void {
    const v = this.current.view;
    if (v && 'thing' in v) this.view.syncThing(v.thing, visible);
    else this.view.sync(v?.body ?? shown('standard'), visible && v !== null);
  }
}

// How many hearts float about in these regions.
function heartsIn(regions: Region[]): number {
  return PICKUP_AREAS.filter((a) => a.kind === 'heart' && regions.includes(a.region)).reduce((n, a) => n + a.count, 0);
}

// The height of the highest floor in these regions.
function topOf(regions: Region[]): Stat {
  return { label: 'Height', value: `${num(Math.max(...regions.map((r) => r.y)))} m` };
}

function placeStats(place: Place): Stat[] {
  switch (place.id) {
    case 'pineapple':
      return [
        // To the deck on the crown, the top of the house anyone stands on.
        { label: 'Height', value: `${num(DUNE_HEIGHT + PINEAPPLE_PROFILE.attic.deck.y)} m` },
        { label: 'Floors', value: `${PINEAPPLE_LEVELS.length}` },
        { label: 'Hearts', value: `${heartsIn(PINEAPPLE_LEVELS)}` },
      ];
    case 'krusty-krab':
      return [
        // To the tops of the arches, the highest of it anyone stands on.
        { label: 'Height', value: `${num(KRUSTY_KRAB_PROFILE.size.h)} m` },
        { label: 'Hearts', value: `${heartsIn([KRUSTY_KRAB_FLOOR])}` },
      ];
    case 'welcome-building':
    case 'anime-building':
    case 'building4': {
      const ground = BUILDING_GROUNDS[place.building ?? 0];
      const levels = BUILDING_LEVELS.filter((r) => Math.hypot(r.x - ground.x, r.z - ground.z) < 1);
      return [topOf(levels), { label: 'Hearts', value: `${heartsIn(levels)}` }];
    }
    case 'tower':
      return [
        topOf(TOWER_LEVELS),
        { label: 'Floors', value: `${TOWER_LEVELS.length - 1}` },
        { label: 'Hearts', value: `${heartsIn(TOWER_LEVELS)}` },
      ];
    case 'terrace':
      return [topOf([TERRACE]), { label: 'Hearts', value: `${heartsIn([TERRACE])}` }];
  }
}

const PHOTOS = '/assets/guide/places';

// One photo at a time over the page, big, with its caption: arrows (or the keys) step through the
// gallery it came from, and Esc, the X or a click beside it closes it.
class Lightbox {
  private readonly el = el('div', 'lightbox hidden');
  private readonly img = el('img');
  private readonly caption = el('p', 'caption');
  private photos: Photo[] = [];
  private at = 0;

  constructor() {
    const close = el('button', 'close', '✕');
    const prev = el('button', 'step prev', '‹');
    const next = el('button', 'step next', '›');
    close.addEventListener('click', () => this.close());
    prev.addEventListener('click', () => this.step(-1));
    next.addEventListener('click', () => this.step(1));
    this.el.addEventListener('click', (e) => e.target === this.el && this.close());
    const frame = el('figure');
    frame.append(this.img, this.caption);
    this.el.append(frame, prev, next, close);
    document.body.append(this.el);
    window.addEventListener('keydown', (e) => {
      if (this.el.classList.contains('hidden')) return;
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowLeft') this.step(-1);
      else if (e.key === 'ArrowRight') this.step(1);
    });
  }

  open(photos: Photo[], at: number): void {
    this.photos = photos;
    this.at = at;
    this.show();
    this.el.classList.remove('hidden');
  }

  private step(by: number): void {
    this.at = (this.at + by + this.photos.length) % this.photos.length;
    this.show();
  }

  private show(): void {
    const photo = this.photos[this.at];
    this.img.src = `${PHOTOS}/${photo.file}.jpg`;
    this.img.alt = photo.caption;
    this.caption.textContent = `${photo.caption} (${this.at + 1} of ${this.photos.length})`;
    this.el.classList.toggle('single', this.photos.length < 2);
  }

  private close(): void {
    this.el.classList.add('hidden');
  }
}

function gallery(photos: Photo[], lightbox: Lightbox): HTMLElement {
  const row = el('div', 'gallery');
  photos.forEach((photo, i) => {
    const b = el('button');
    const img = el('img');
    img.src = `${PHOTOS}/${photo.file}-thumb.jpg`;
    img.alt = photo.caption;
    img.loading = 'lazy';
    b.title = photo.caption;
    b.append(img);
    b.addEventListener('click', () => lightbox.open(photos, i));
    row.append(b);
  });
  return row;
}

// Where each place is on the map, to name it under the pointer and pick it with a click: its
// grounds, and while the map shows what's up high, the terrace's deck over them all.
interface PlaceSpot {
  id: Place['id'];
  x: number;
  z: number;
  r: number;
  inner?: number; // metres from the middle out to a ring's inside edge
  high?: boolean; // only while the map shows the walkways up high
}

function placeSpots(): PlaceSpot[] {
  const spots: PlaceSpot[] = [];
  if (TERRACE.kind === 'ring') spots.push({ id: 'terrace', ...TERRACE, high: true });
  spots.push({ id: 'tower', ...ANNEX }, { id: 'krusty-krab', ...KRUSTY_KRAB_GROUNDS });
  for (const place of PLACES) {
    const n = place.id === 'pineapple' ? 0 : place.building;
    if (n !== undefined) spots.push({ id: place.id, ...BUILDING_GROUNDS[n] });
  }
  return spots;
}

function placeTitle(place: Place): string {
  return place.building === undefined ? place.title : titleCase(BUILDING_NAMES[place.building]);
}

const CLICK_SLOP = 5; // CSS pixels a press may move and still be a click rather than a drag

// The world's map at the top of the World tab, the game's own (MapCanvas: the minimap's WORLD view,
// with no one on it), to drag about and zoom, seen from the ground or from up high: the GROUND and
// HIGH toggle, high being the view the game's map takes past HIGH_UP, with the walkways up there
// (the terrace, the sky bridge, the staircases). A place under the pointer is named beside it, and
// a click on one picks it.
class WorldMap {
  readonly el = el('section', 'card wide world-map');
  private readonly canvas = el('canvas');
  private readonly map = new MapCanvas(this.canvas);
  private readonly controls = new MapControls(this.canvas, () => this.map.baseScale('world'));
  private readonly toggle = el('div', 'toggle');
  private showsHigh = false;
  private readonly label = el('span', 'label');
  private readonly spots = placeSpots();
  private pressed: { x: number; y: number } | null = null;

  constructor(onPick: (id: Place['id']) => void) {
    const zoom = matchMedia('(pointer: coarse)').matches ? 'pinch' : 'scroll';
    const box = el('div', 'view');
    for (const high of [false, true]) {
      const button = el('button', '', high ? 'HIGH' : 'GROUND');
      button.addEventListener('click', () => this.setHigh(high));
      this.toggle.append(button);
    }
    this.setHigh(false);
    this.canvas.addEventListener('pointerdown', (e) => (this.pressed = { x: e.clientX, y: e.clientY }));
    this.canvas.addEventListener('pointermove', (e) => this.hover(e));
    this.canvas.addEventListener('pointerleave', () => this.name(null));
    this.canvas.addEventListener('click', (e) => {
      const from = this.pressed;
      if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > CLICK_SLOP) return;
      const spot = this.spotAt(e);
      if (spot) onPick(spot.id);
    });
    box.append(this.canvas, this.label, this.toggle, el('span', 'hint', `drag to slide · ${zoom} to zoom`));
    this.el.append(el('h2', '', 'Map'), box);
  }

  draw(): void {
    this.map.drawWorld(this.controls.framing, this.showsHigh);
  }

  private setHigh(high: boolean): void {
    this.showsHigh = high;
    [...this.toggle.children].forEach((b, i) => b.classList.toggle('on', i === Number(high)));
  }

  private spotAt(e: MouseEvent): PlaceSpot | null {
    const r = this.canvas.getBoundingClientRect();
    const at = this.map.worldAt(e.clientX - r.left, e.clientY - r.top, this.controls.framing);
    return (
      this.spots.find((s) => {
        const d = Math.hypot(at.x - s.x, at.z - s.z);
        return (!s.high || this.showsHigh) && d <= s.r && d >= (s.inner ?? 0);
      }) ?? null
    );
  }

  private hover(e: PointerEvent): void {
    if (e.buttons) return this.name(null); // dragging
    const spot = this.spotAt(e);
    this.name(spot);
    if (!spot) return;
    const r = this.canvas.getBoundingClientRect();
    this.label.style.left = `${e.clientX - r.left}px`;
    this.label.style.top = `${e.clientY - r.top}px`;
  }

  private name(spot: PlaceSpot | null): void {
    const place = spot && PLACES.find((p) => p.id === spot.id);
    this.label.textContent = place ? placeTitle(place) : '';
    this.label.classList.toggle('on', !!place);
    this.canvas.classList.toggle('over', !!place);
  }
}

const FLASH_MS = 1600; // how long a picked place's card stays lit, as .card.flash's animation runs

function worldPanel(): { panel: HTMLElement; map: WorldMap } {
  const panel = el('div', 'cards');
  const cards = new Map<Place['id'], HTMLElement>();
  const map = new WorldMap((id) => {
    const card = cards.get(id);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('flash');
    void card.offsetWidth; // restarts the animation on a second pick
    card.classList.add('flash');
    window.setTimeout(() => card.classList.remove('flash'), FLASH_MS);
  });
  panel.append(map.el);
  const lightbox = new Lightbox();
  for (const place of PLACES) {
    const card = el('section', 'card');
    card.append(
      el('h2', '', placeTitle(place)),
      gallery(place.photos, lightbox),
      el('p', 'summary', place.summary),
      statTable(placeStats(place)),
      ...facts(place.facts),
    );
    cards.set(place.id, card);
    panel.append(card);
  }
  return { panel, map };
}

function botPage(id: BotId): HTMLElement {
  const bot = BOTS[id];
  const page = el('div');
  const head = el('h2', 'command', `/${bot.playerName}`);
  head.append(el('span', 'args', ` ${botArguments(bot.worker)}`));
  const [cmd, what] = BOT_EXAMPLES[id];
  const example = el('p', 'example');
  example.append(el('code', '', cmd), el('span', '', what));
  page.append(
    head,
    botDiagram(id, BOT_DIAGRAM_TEXT[id]),
    el('p', 'summary', sentence(bot.blurb)),
    statTable(botFlagRows(bot.worker, BOT_FLAG_TEXT)),
    el('h3', '', 'For example'),
    example,
  );
  return page;
}

// The sniper first, the bot people ask about most; then the rest as the registry lists them.
const SHOWN_BOTS: BotId[] = ['sniper', ...BOT_IDS.filter((id) => id !== 'sniper')];

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
      `Every room starts with ${circles} circle bots, each in a random skin, and ${stalkers} Tung Tung Tung Sahur stalkers in the tower. Flags go in any order, each at most once.`,
    ),
  );
  const bots = el('section', 'card wide');
  bots.append(subTabs(SHOWN_BOTS.map((id) => ({ title: BOTS[id].playerName, body: botPage(id) }))));
  panel.append(about, bots);
  return panel;
}

function commandsPanel(): HTMLElement {
  const panel = el('div', 'cards');
  const controls = el('section', 'card wide');
  controls.append(
    el('h2', '', 'Controls'),
    subTabs(
      CONTROLS.map(({ title, keys }) => ({ title, body: statTable(keys.map(([label, value]) => ({ label, value }))) })),
    ),
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
  const back = el('a', 'back', '← back to kathir world');
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
  const { panel: world, map: worldMap } = worldPanel();
  panels.set('world', world);
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
    if (active === 'world') worldMap.draw();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
