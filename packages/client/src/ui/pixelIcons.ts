// Tiny pixel-art icons as inline SVGs, drawn from bitmap strings so they stay crisp at any
// size. '.' is empty; every other character is a pixel, with a CSS class per character so the
// stylesheet picks the colours.
const NS = 'http://www.w3.org/2000/svg';

export function pixelSvg(rows: string[], cls: string, classes: Record<string, string> = {}): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${rows[0].length} ${rows.length}`);
  svg.setAttribute('class', `pixel ${cls}`);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', '1');
      r.setAttribute('height', '1');
      if (classes[ch]) r.setAttribute('class', classes[ch]);
      svg.append(r);
    });
  });
  return svg;
}

// 9x8 heart. '+' is the highlight.
export const HEART = [
  '.##...##.',
  '#+##.####',
  '#########',
  '#########',
  '.#######.',
  '..#####..',
  '...###...',
  '....#....',
];

// 8x8 dagger: blade from the top right ('#'), guard ('G'), hilt ('H').
export const KNIFE = [
  '......##',
  '.....###',
  '....###.',
  '...###..',
  'GG###...',
  '.GG.....',
  'HGG.....',
  'H.......',
];

// 8x8 skull with eye holes and teeth.
export const SKULL = [
  '..####..',
  '.######.',
  '##.##.##',
  '##.##.##',
  '########',
  '.######.',
  '..#.#.#.',
  '..#.#.#.',
];

// 8x8 robot head: antenna, visor eyes, a mouth grille.
export const ROBOT = [
  '...##...',
  '...##...',
  '.######.',
  '#.#..#.#',
  '#.#..#.#',
  '#.####.#',
  '.#.##.#.',
  '.######.',
];

// 24x12 Modal mark, traced from the brand SVG: two mirrored hexagons meeting at the notch,
// '#' the lit faces, 'd' the shaded bottom face. Rendered by mountPoweredBy() on the loading screen.
export const MODAL_LOGO = [
  '....######....######....',
  '....######....######....',
  '...########..########...',
  '...##################...',
  '..#####dddddddddd#####..',
  '.#####ddddd..ddddd#####.',
  '.#####dddd....dddd#####.',
  '#####ddddd....ddddd#####',
  '####ddddd......ddddd####',
  '.###ddddd......ddddd###.',
  '.##ddddd........ddddd##.',
  '..#dddd..........dddd#..',
];
