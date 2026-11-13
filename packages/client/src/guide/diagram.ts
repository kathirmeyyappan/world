// The guide's diagrams: what something does, seen from above, as inline SVG on a 640 × 360 canvas
// coloured by guide.css (the `.diagram` rules). The subject is a green disc with a tick the way it
// faces, people amber discs, other bots grey squares, walls hatched, and distances dashed rings.
// Strokes say what a line is: `move` where something goes (`detour` for a way round), `look` what
// it watches, `turn` how it turns, `shot` what it fires at. Labels are plain words, never numbers,
// with `note` for the quieter ones. Every diagram is built from these marks alone, so they all match.

export type Pt = [number, number];

export type Stroke = 'move' | 'detour' | 'look' | 'turn' | 'shot';

// Which arrowhead each stroke ends in: one per colour.
const HEADS: Record<Stroke, 'move' | 'look' | 'shot'> = {
  move: 'move',
  detour: 'move',
  look: 'look',
  turn: 'look',
  shot: 'shot',
};

const WIDTH = 640;
const HEIGHT = 360;
const LINE_HEIGHT = 20;

// The point `r` from `c` at `deg` degrees, screen-wise: 0 to the right, 90 straight down.
export function polar(c: Pt, r: number, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
}

// `t` of the way from `a` to `b`.
export function along(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// The screen-wise angle from `a` to `b`, in degrees, as `polar` takes it.
export function degTo(a: Pt, b: Pt): number {
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}

// A coordinate as it goes into the SVG.
export const fmt = (n: number): string => n.toFixed(1);

interface Stroked {
  arrow?: boolean;
  faint?: boolean; // where it was, or what it ignores
}

export class Diagram {
  private readonly marks: string[] = [];

  // `id` keeps the arrowheads' and hatch's ids apart from other diagrams' on the page.
  constructor(private readonly id: string) {}

  // The thing the diagram is about.
  subject([x, y]: Pt, facing: number, faint = false): void {
    const [tx, ty] = polar([x, y], 20, facing);
    this.marks.push(
      `<g class="dg-subject${faint ? ' dg-faint' : ''}"><line x1="${fmt(x)}" y1="${fmt(y)}" x2="${fmt(tx)}" y2="${fmt(ty)}"/><circle cx="${fmt(x)}" cy="${fmt(y)}" r="11"/></g>`,
    );
  }

  person([x, y]: Pt, faint = false): void {
    this.marks.push(`<circle class="dg-person${faint ? ' dg-faint' : ''}" cx="${fmt(x)}" cy="${fmt(y)}" r="10"/>`);
  }

  otherBot([x, y]: Pt): void {
    this.marks.push(`<rect class="dg-other" x="${fmt(x - 10)}" y="${fmt(y - 10)}" width="20" height="20" rx="3"/>`);
  }

  // A wall `length` long and `thick` through, centred on `c` and turned `deg` from horizontal.
  wall(c: Pt, length: number, deg: number, thick = 16): void {
    this.marks.push(
      `<rect class="dg-wall" fill="url(#${this.id}-hatch)" x="${fmt(c[0] - length / 2)}" y="${fmt(c[1] - thick / 2)}" width="${length}" height="${thick}" transform="rotate(${fmt(deg)} ${fmt(c[0])} ${fmt(c[1])})"/>`,
    );
  }

  // A distance round `c`: how close, or the circle something keeps to.
  ring(c: Pt, r: number): void {
    this.marks.push(`<circle class="dg-ring" cx="${fmt(c[0])}" cy="${fmt(c[1])}" r="${fmt(r)}"/>`);
  }

  line(a: Pt, b: Pt, stroke: Stroke, opts: Stroked = {}): void {
    this.stroke(`<line x1="${fmt(a[0])}" y1="${fmt(a[1])}" x2="${fmt(b[0])}" y2="${fmt(b[1])}"`, stroke, opts);
  }

  // Any SVG path, `d` written with `fmt`.
  path(d: string, stroke: Stroke, opts: Stroked = {}): void {
    this.stroke(`<path d="${d}"`, stroke, opts);
  }

  // An arc round `c` from `from` to `to` degrees, clockwise on screen.
  arc(c: Pt, r: number, from: number, to: number, stroke: Stroke, opts: Stroked = {}): void {
    const [x1, y1] = polar(c, r, from);
    const [x2, y2] = polar(c, r, to);
    const large = to - from > 180 ? 1 : 0;
    this.path(`M ${fmt(x1)} ${fmt(y1)} A ${r} ${r} 0 ${large} 1 ${fmt(x2)} ${fmt(y2)}`, stroke, opts);
  }

  // Sights on someone about to be shot.
  crosshair([x, y]: Pt): void {
    const tick = (x1: number, y1: number, x2: number, y2: number): string =>
      `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}"/>`;
    this.marks.push(
      `<g class="dg-cross"><circle cx="${fmt(x)}" cy="${fmt(y)}" r="17"/>${tick(x - 24, y, x - 11, y)}${tick(x + 11, y, x + 24, y)}${tick(x, y - 24, x, y - 11)}${tick(x, y + 11, x, y + 24)}</g>`,
    );
  }

  // Lines of text from `at`, one under the other; `note` for the quieter ones.
  label(
    at: Pt,
    lines: string[],
    { note = false, anchor = 'start' }: { note?: boolean; anchor?: 'start' | 'middle' | 'end' } = {},
  ): void {
    const spans = lines
      .map((l, i) => `<tspan x="${fmt(at[0])}" dy="${i === 0 ? 0 : LINE_HEIGHT}">${l}</tspan>`)
      .join('');
    this.marks.push(
      `<text class="dg-label${note ? ' dg-note' : ''}" x="${fmt(at[0])}" y="${fmt(at[1])}" text-anchor="${anchor}">${spans}</text>`,
    );
  }

  // The diagram, with `alt` read out in its place.
  element(alt: string): HTMLElement {
    const box = document.createElement('div');
    box.className = 'diagram';
    box.innerHTML = `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img">${this.defs()}${this.marks.join('')}</svg>`;
    box.querySelector('svg')?.setAttribute('aria-label', alt);
    return box;
  }

  private stroke(open: string, stroke: Stroke, { arrow = false, faint = false }: Stroked): void {
    const end = arrow ? ` marker-end="url(#${this.id}-${HEADS[stroke]})"` : '';
    this.marks.push(`${open} class="dg-stroke dg-${stroke}${faint ? ' dg-faint' : ''}"${end}/>`);
  }

  private defs(): string {
    const head = (kind: string): string =>
      `<marker id="${this.id}-${kind}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="dg-head-${kind}" d="M 0 0 L 10 5 L 0 10 z"/></marker>`;
    const hatch = `<pattern id="${this.id}-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="dg-hatch" x1="0" y1="0" x2="0" y2="6"/></pattern>`;
    return `<defs>${head('move')}${head('look')}${head('shot')}${hatch}</defs>`;
  }
}
