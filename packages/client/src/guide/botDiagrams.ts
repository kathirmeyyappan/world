// What each bot does, drawn from above: the bot in green, people in amber, other bots grey, walls
// hatched. Drawn as inline SVG on a 640 × 360 canvas, coloured by guide.css.
import type { BotId } from '@world/shared';

const W = 640;
const H = 360;

type Pt = [number, number];

// The point `r` from `c` at `deg` degrees, screen-wise: 0 to the right, 90 straight down.
function polar(c: Pt, r: number, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
}

// `t` of the way from `a` to `b`.
function along(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function degTo(a: Pt, b: Pt): number {
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}

const f = (n: number): string => n.toFixed(1);

// The bot the diagram is about: a disc with a tick the way it faces.
function bot([x, y]: Pt, facing: number, cls = ''): string {
  const [tx, ty] = polar([x, y], 20, facing);
  return `<g class="bd-bot ${cls}"><line x1="${f(x)}" y1="${f(y)}" x2="${f(tx)}" y2="${f(ty)}"/><circle cx="${f(x)}" cy="${f(y)}" r="11"/></g>`;
}

function person([x, y]: Pt, cls = ''): string {
  return `<circle class="bd-person ${cls}" cx="${f(x)}" cy="${f(y)}" r="10"/>`;
}

function otherBot([x, y]: Pt): string {
  return `<rect class="bd-other" x="${f(x - 10)}" y="${f(y - 10)}" width="20" height="20" rx="3"/>`;
}

// A wall, hatched by the diagram's own pattern, `length` long and `thick` through, centred on `c` and turned `deg` from horizontal.
function wall(id: string, c: Pt, length: number, deg: number, thick = 16): string {
  return `<rect class="bd-wall" fill="url(#${id}-hatch)" x="${f(c[0] - length / 2)}" y="${f(c[1] - thick / 2)}" width="${length}" height="${thick}" transform="rotate(${f(deg)} ${f(c[0])} ${f(c[1])})"/>`;
}

function line(a: Pt, b: Pt, cls: string, arrow = ''): string {
  const end = arrow ? ` marker-end="url(#${arrow})"` : '';
  return `<line class="${cls}" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}"${end}/>`;
}

function path(d: string, cls: string, arrow = ''): string {
  const end = arrow ? ` marker-end="url(#${arrow})"` : '';
  return `<path class="${cls}" d="${d}"${end}/>`;
}

// An arc round `c` from `from` to `to` degrees, clockwise on screen.
function arc(c: Pt, r: number, from: number, to: number, cls: string, arrow = ''): string {
  const [x1, y1] = polar(c, r, from);
  const [x2, y2] = polar(c, r, to);
  const large = to - from > 180 ? 1 : 0;
  return path(`M ${f(x1)} ${f(y1)} A ${r} ${r} 0 ${large} 1 ${f(x2)} ${f(y2)}`, cls, arrow);
}

function crosshair([x, y]: Pt): string {
  return `<g class="bd-cross"><circle cx="${f(x)}" cy="${f(y)}" r="17"/><line x1="${f(x - 24)}" y1="${f(y)}" x2="${f(x - 11)}" y2="${f(y)}"/><line x1="${f(x + 11)}" y1="${f(y)}" x2="${f(x + 24)}" y2="${f(y)}"/><line x1="${f(x)}" y1="${f(y - 24)}" x2="${f(x)}" y2="${f(y - 11)}"/><line x1="${f(x)}" y1="${f(y + 11)}" x2="${f(x)}" y2="${f(y + 24)}"/></g>`;
}

// Lines of text from `at`, one under the other; `anchor` is SVG's text-anchor.
function label(at: Pt, lines: string[], cls = '', anchor: 'start' | 'middle' | 'end' = 'start'): string {
  const spans = lines.map((l, i) => `<tspan x="${f(at[0])}" dy="${i === 0 ? 0 : 20}">${l}</tspan>`).join('');
  return `<text class="bd-label ${cls}" x="${f(at[0])}" y="${f(at[1])}" text-anchor="${anchor}">${spans}</text>`;
}

// Arrowheads, one per stroke colour, with ids of the diagram's own so the three can share a page.
function defs(id: string): string {
  const head = (kind: string): string =>
    `<marker id="${id}-${kind}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="bd-head-${kind}" d="M 0 0 L 10 5 L 0 10 z"/></marker>`;
  const hatch = `<pattern id="${id}-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="bd-hatch" x1="0" y1="0" x2="0" y2="6"/></pattern>`;
  return `<defs>${head('move')}${head('look')}${head('shot')}${hatch}</defs>`;
}

// Strafes round the nearest player facing them; blocked, it finds a way round to the ring further on.
function circle(id: string): string {
  const c: Pt = [210, 182];
  const r = 118;
  const me = polar(c, r, -140);
  const stuck = polar(c, r, -4);
  const rejoin = polar(c, r, 52);
  const out = polar(c, r + 62, 20);
  return [
    `<circle class="bd-ring" cx="${c[0]}" cy="${c[1]}" r="${r}"/>`,
    wall(id, polar(c, r, 18), 86, 18),
    line(me, along(me, c, 0.86), 'bd-look'),
    arc(c, r + 16, -128, -64, 'bd-move', `${id}-move`),
    arc(c, r + 16, -150, -128, 'bd-move bd-faint'),
    bot(me, degTo(me, c)),
    path(
      `M ${f(stuck[0] + 12)} ${f(stuck[1])} C ${f(out[0] - 10)} ${f(out[1] - 60)}, ${f(out[0] + 14)} ${f(out[1] - 10)}, ${f(out[0])} ${f(out[1])} S ${f(rejoin[0] + 50)} ${f(rejoin[1] + 8)}, ${f(rejoin[0] + 12)} ${f(rejoin[1] + 4)}`,
      'bd-move bd-detour',
      `${id}-move`,
    ),
    bot(stuck, degTo(stuck, c), 'bd-ghost'),
    person(c),
    label([c[0], c[1] + 36], ['nearest player'], '', 'middle'),
    label([c[0], c[1] + 56], ['(the middle, alone)'], 'bd-note', 'middle'),
    label([c[0] - 6, 26], ['strafes round, facing them'], '', 'middle'),
    label([430, 150], ['something in the way?'], ''),
    label([430, 172], ['finds a way round it', 'by the map, back to', 'the ring further on'], 'bd-note'),
  ].join('');
}

// Stands where it is and turns to face the nearest person, whoever else is closer.
function stalker(id: string): string {
  const me: Pt = [190, 176];
  const was: Pt = [372, 62];
  const now: Pt = [404, 236];
  const far: Pt = [560, 92];
  const other: Pt = [118, 262];
  return [
    path(`M 330 22 C 420 70, 440 170, 404 236 S 360 320, 330 344`, 'bd-move bd-faint', `${id}-move`),
    line(me, along(me, was, 0.92), 'bd-look bd-faint'),
    line(me, along(me, now, 0.93), 'bd-look'),
    arc(me, 78, degTo(me, was) + 4, degTo(me, now) - 4, 'bd-turn', `${id}-look`),
    person(was, 'bd-ghost'),
    person(now),
    person(far, 'bd-dim'),
    otherBot(other),
    bot(me, degTo(me, now)),
    label([me[0], me[1] + 40], ['never moves'], '', 'middle'),
    label([282, 150], ['turns to', 'follow'], 'bd-note'),
    label([432, 242], ['nearest person'], ''),
    label([far[0], far[1] + 32], ['further off:', 'not watched'], 'bd-note', 'middle'),
    label([other[0], other[1] + 34], ['bots never count,', 'however close'], 'bd-note', 'middle'),
  ].join('');
}

// Watches whoever it can see; shoots the close ones (or anyone, once it's been hit); hides to reload.
function sniper(id: string): string {
  const me: Pt = [170, 186];
  const r = 128;
  const near: Pt = [238, 98];
  const far: Pt = [478, 112];
  const hidden: Pt = [246, 288];
  const block = along(me, hidden, 0.62);
  const cover: Pt = [96, 222];
  const pillar = along(cover, near, 0.2);
  return [
    `<circle class="bd-ring" cx="${me[0]}" cy="${me[1]}" r="${r}"/>`,
    label([me[0] - r + 12, me[1] - r + 34], ['close'], 'bd-note'),
    line(me, along(me, near, 0.86), 'bd-shot', `${id}-shot`),
    line(me, along(me, far, 0.96), 'bd-look'),
    line(me, along(me, block, 0.9), 'bd-look bd-faint'),
    wall(id, block, 70, degTo(me, hidden) + 90),
    wall(id, pillar, 30, degTo(cover, near) + 90, 16),
    path(
      `M ${f(me[0] - 14)} ${f(me[1] + 8)} Q 120 216, ${f(cover[0] + 14)} ${f(cover[1] - 2)}`,
      'bd-move',
      `${id}-move`,
    ),
    bot(cover, degTo(cover, near), 'bd-ghost'),
    person(near),
    crosshair(near),
    person(far),
    person(hidden, 'bd-dim'),
    bot(me, degTo(me, near)),
    label([near[0] + 30, near[1] - 18], ['close: scopes in', 'and shoots'], ''),
    label(
      [far[0] + 20, far[1] + 50],
      ['far: kept in its sights,', 'shot only once it’s', 'been hit itself'],
      'bd-note',
      'middle',
    ),
    label([hidden[0] + 22, hidden[1] - 4], ['behind a wall:', 'unseen'], 'bd-note'),
    label([cover[0] - 4, cover[1] + 34], ['ducks out of', 'sight to reload'], 'bd-note', 'middle'),
    label([420, 262], ['nobody in sight a while,', 'or hurt: moves to', 'another floor'], 'bd-note'),
  ].join('');
}

const DRAW: Record<BotId, (id: string) => string> = { circle, stalker, sniper };

export function botDiagram(bot: BotId, alt: string): HTMLElement {
  const id = `bd-${bot}`;
  const box = document.createElement('div');
  box.className = 'bot-diagram';
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${alt}">${defs(id)}${DRAW[bot](id)}</svg>`;
  return box;
}
