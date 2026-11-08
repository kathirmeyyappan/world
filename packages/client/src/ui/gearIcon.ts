// The menu's gear, drawn the way icon sets draw it: the outline of eight teeth, each narrowing from
// its base to a flat tip, round a ring, stroked in the text's colour in a 24-unit box. It's a vector,
// not a bitmap like the HUD's other icons: at the 16 to 20 px it's shown at, a pixel grid is too
// coarse for the gaps between the teeth and the gap round the ring, and a gear drawn in it reads as a
// flower.
const NS = 'http://www.w3.org/2000/svg';
const TIP = 10.2; // units from the middle to the tips of the teeth
const VALLEY = 0.77; // the floor between teeth, as a share of TIP
const TIP_HALF = 10; // degrees either side of a tooth's middle at its tip
const BASE_HALF = 17; // and at its base
const RING = 0.38; // the ring's radius, as a share of TIP
const STROKE = 2.4; // units: about the weight of the pixel font beside it at 20 px

export function gearIcon(cls: string): SVGSVGElement {
  const at = (degrees: number, r: number) => {
    const a = (degrees * Math.PI) / 180;
    return `${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`;
  };
  const floor = TIP * VALLEY;
  let d = '';
  for (let k = 0; k < 8; k++) {
    const mid = -90 + 45 * k; // the first tooth straight up
    d += `${k ? 'L' : 'M'}${at(mid - BASE_HALF, floor)} L${at(mid - TIP_HALF, TIP)} `;
    d += `L${at(mid + TIP_HALF, TIP)} L${at(mid + BASE_HALF, floor)} `;
    d += `A${floor},${floor} 0 0 1 ${at(mid + 45 - BASE_HALF, floor)} `;
  }
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24',
    class: cls,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': String(STROKE),
    'stroke-linejoin': 'round',
  }))
    svg.setAttribute(k, v);
  const teeth = document.createElementNS(NS, 'path');
  teeth.setAttribute('d', `${d}Z`);
  const ring = document.createElementNS(NS, 'circle');
  for (const [k, v] of Object.entries({ cx: '12', cy: '12', r: (TIP * RING).toFixed(2) })) ring.setAttribute(k, v);
  svg.append(teeth, ring);
  return svg;
}
