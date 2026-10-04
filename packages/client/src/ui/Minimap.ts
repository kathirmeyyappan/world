// Bottom-right minimap. Two views: NEAR keeps you centred and rotates so you always face up;
// WORLD shows the whole outline north-up. Everything is drawn each frame as shapes in world metres
// through the view's transform, at the screen's own pixel density (RES canvas pixels to the CSS
// pixel), so edges stay smooth at any zoom and as the near view turns: the outline's parts
// (discs, bridges and arcs), landmarks (content/landmarks.ts) grey on the floor, and up past
// HIGH_UP the walkways up there too. Markers go on top: cubes as faint specks, people as smaller
// copies of your arrow pointing their way, bots as squares, and anyone on another level (a floor
// above, a bridge below) faded. Your x, y, z sits in the map's corner: the sim's coordinates, with
// y the height of your feet rather than your eyes. Desktop only; see styles.css.
import { EYE_HEIGHT, HIGH_UP, worldBounds, type Landmark, type WorldPart } from '@world/shared';

export interface MinimapFrame {
  me: { x: number; y: number; z: number; yaw: number };
  players: { x: number; y: number; z: number; yaw: number; color: string; bot: boolean }[];
  cubes: { x: number; z: number }[];
}

export type MinimapView = 'near' | 'world';

const SIZE = 224; // CSS pixels across the panel
// Canvas pixels per CSS pixel: the screen's own density, and at least two, so a plain screen gets
// the map drawn finer and smoothed down.
const RES = Math.min(3, Math.max(2, Math.ceil(window.devicePixelRatio || 1)));
const W = SIZE * RES; // canvas pixels across
const NEAR_RANGE = 26; // metres from you to the panel's edge in the near view
const GRID_SPACING = 10;
const EDGE = 2.2; // CSS pixels of outline outside the world's edge
const ACCENT = '100, 181, 246';
const FLOOR = `rgba(${ACCENT}, 0.11)`;
const GRID = `rgba(${ACCENT}, 0.27)`;
const OUTLINE = `rgba(${ACCENT}, 0.9)`;
const LANDMARK = 'rgba(150, 150, 158, 0.78)';
const RING = 'rgb(70, 70, 78)'; // a landmark's inner circles
const OTHERS = 0.6; // other people's arrows, as a fraction of yours
const BOT = 5; // CSS pixels across a bot's square, inside its light edge: still under a person's arrow
const LEVEL = 3; // metres of height difference at which another player reads as above or below you

export class Minimap {
  private readonly root = document.getElementById('minimap')!;
  private readonly canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
  private readonly toggleBar = document.getElementById('minimap-toggle')!;
  private readonly coords = document.getElementById('minimap-coords')!;
  private readonly ctx: CanvasRenderingContext2D;
  // Offscreen layers, each masked to its shapes before it's laid under what's drawn.
  private readonly gridLayer = layer();
  private readonly floorLayer = layer();
  private readonly landmarkLayer = layer();
  private readonly parts: Path2D[];
  private view: MinimapView = 'world';
  private readonly bounds;

  constructor(
    shape: WorldPart[],
    private readonly landmarks: Landmark[] = [],
    private readonly high: Landmark[] = [], // shown too while your feet are above HIGH_UP
  ) {
    this.canvas.width = W;
    this.canvas.height = W;
    this.ctx = this.canvas.getContext('2d')!;
    this.parts = shape.map(partPath);
    this.bounds = worldBounds(shape);
    this.setView('world');
  }

  toggle(): void {
    this.setView(this.view === 'near' ? 'world' : 'near');
  }

  setView(view: MinimapView): void {
    this.view = view;
    for (const el of this.toggleBar.querySelectorAll<HTMLElement>('[data-view]')) {
      el.classList.toggle('on', el.dataset.view === view);
    }
  }

  get active(): boolean {
    return this.root.clientWidth > 0;
  }

  update(frame: MinimapFrame): void {
    if (!this.active) return;
    const { x, y, z } = frame.me;
    const n = (v: number) => Math.round(v) || 0; // `|| 0` so a hair below zero reads 0, not -0
    this.coords.textContent = `${n(x)}, ${n(y - EYE_HEIGHT)}, ${n(z)}`;
    const t = this.transform(frame.me);
    this.drawFloor(t, y - EYE_HEIGHT > HIGH_UP ? [...this.landmarks, ...this.high] : this.landmarks);

    const ctx = this.ctx;
    ctx.setTransform(RES, 0, 0, RES, 0, 0); // markers in CSS pixels
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; // faint specks; players should stand out
    for (const c of frame.cubes) this.square(t, c.x, c.z, 2);
    for (const p of frame.players) {
      ctx.globalAlpha = Math.abs(p.y - y) < LEVEL ? 1 : 0.45;
      ctx.fillStyle = p.color;
      if (p.bot) this.bot(t, p.x, p.z);
      else this.arrow(t, p.x, p.z, p.yaw - (this.view === 'near' ? frame.me.yaw : 0), OTHERS);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    this.arrow(t, x, z, this.view === 'near' ? 0 : frame.me.yaw, 1);
  }

  // Pixel <-> world mapping for the current view. `origin` is the world point at the panel
  // centre, `f`/`r` the world directions that map to screen up and right, `scale` metres per pixel.
  private transform(me: MinimapFrame['me']): Transform {
    if (this.view === 'near') {
      return {
        ox: me.x,
        oz: me.z,
        scale: (NEAR_RANGE * 2) / SIZE,
        fx: Math.sin(me.yaw),
        fz: Math.cos(me.yaw),
        rx: Math.cos(me.yaw),
        rz: -Math.sin(me.yaw),
      };
    }
    const b = this.bounds;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 8;
    return {
      ox: (b.minX + b.maxX) / 2,
      oz: (b.minZ + b.maxZ) / 2,
      scale: span / SIZE,
      fx: 0,
      fz: 1,
      rx: 1,
      rz: 0,
    };
  }

  // The floor, its grid, `landmarks` and the world's edge, as shapes in world metres through `t`.
  // The edge is every part's outline with everything inside the world rubbed out again, leaving the
  // outside half of the line round the whole; the rest goes under it, top first, each on a layer
  // masked to its shapes so overlapping parts don't double up.
  private drawFloor(t: Transform, landmarks: Landmark[]): void {
    const k = RES / t.scale; // canvas pixels per metre
    const place = (c: CanvasRenderingContext2D) => {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.clearRect(0, 0, W, W);
      c.setTransform(
        k * t.rx,
        -k * t.fx,
        k * t.rz,
        -k * t.fz,
        W / 2 - k * (t.rx * t.ox + t.rz * t.oz),
        W / 2 + k * (t.fx * t.ox + t.fz * t.oz),
      );
    };
    const px = (n: number) => (n * RES) / k; // n CSS pixels, in metres
    // Covers `layer` wherever `shapes` do, solid, once however many overlap.
    const cover = (layer: CanvasRenderingContext2D, shapes: Path2D[]) => {
      layer.fillStyle = '#000';
      for (const s of shapes) layer.fill(s, 'evenodd');
      layer.setTransform(1, 0, 0, 1, 0, 0);
    };
    // Turns what's on `layer` to `fill`, keeping only where it is.
    const tint = (layer: CanvasRenderingContext2D, fill: string) => {
      layer.globalCompositeOperation = 'source-in';
      layer.fillStyle = fill;
      layer.fillRect(0, 0, W, W);
    };

    const ctx = this.ctx;
    place(ctx);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = px(2 * EDGE);
    for (const p of this.parts) ctx.stroke(p);
    ctx.globalCompositeOperation = 'destination-out';
    for (const p of this.parts) ctx.fill(p);
    ctx.globalCompositeOperation = 'destination-over';

    ctx.strokeStyle = RING;
    ctx.lineWidth = px(1);
    for (const l of landmarks) {
      if (l.kind !== 'disc' || !l.rings) continue;
      for (let i = 1; i <= l.rings; i++) {
        ctx.beginPath();
        ctx.arc(l.x, l.z, (l.r * i) / (l.rings + 1), 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
    place(this.landmarkLayer);
    cover(this.landmarkLayer, landmarks.map(partPath));
    tint(this.landmarkLayer, LANDMARK);

    place(this.floorLayer);
    cover(this.floorLayer, this.parts); // the world's floor, as a mask for the grid first
    const grid = this.gridLayer;
    place(grid);
    const b = this.bounds;
    grid.beginPath();
    for (let x = Math.ceil(b.minX / GRID_SPACING) * GRID_SPACING; x <= b.maxX; x += GRID_SPACING) {
      grid.moveTo(x, b.minZ);
      grid.lineTo(x, b.maxZ);
    }
    for (let z = Math.ceil(b.minZ / GRID_SPACING) * GRID_SPACING; z <= b.maxZ; z += GRID_SPACING) {
      grid.moveTo(b.minX, z);
      grid.lineTo(b.maxX, z);
    }
    grid.strokeStyle = GRID;
    grid.lineWidth = px(1);
    grid.stroke();
    grid.setTransform(1, 0, 0, 1, 0, 0);
    grid.globalCompositeOperation = 'destination-in';
    grid.drawImage(this.floorLayer.canvas, 0, 0);
    tint(this.floorLayer, FLOOR);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const l of [this.landmarkLayer, grid, this.floorLayer]) ctx.drawImage(l.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  private toPixel(t: Transform, x: number, z: number): [number, number] {
    const dx = x - t.ox;
    const dz = z - t.oz;
    const lx = dx * t.rx + dz * t.rz;
    const ly = dx * t.fx + dz * t.fz;
    return [SIZE / 2 + lx / t.scale, SIZE / 2 - ly / t.scale];
  }

  // A square `size` CSS pixels across at (x, z), in the current fill.
  private square(t: Transform, x: number, z: number, size: number): void {
    const [px, py] = this.toPixel(t, x, z);
    this.ctx.fillRect(px - size / 2, py - size / 2, size, size);
  }

  // A bot at (x, z): a square in the current fill, edged light so it reads against the floor.
  private bot(t: Transform, x: number, z: number): void {
    const [px, py] = this.toPixel(t, x, z);
    const ctx = this.ctx;
    ctx.fillRect(px - BOT / 2, py - BOT / 2, BOT, BOT);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px - BOT / 2 - 0.5, py - BOT / 2 - 0.5, BOT + 1, BOT + 1);
  }

  // Your arrow at (x, z), turned `angle` clockwise from up and `scale` times your size, in the
  // current fill.
  private arrow(t: Transform, x: number, z: number, angle: number, scale: number): void {
    const [px, py] = this.toPixel(t, x, z);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(6, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-6, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

interface Transform {
  ox: number;
  oz: number;
  scale: number;
  fx: number;
  fz: number;
  rx: number;
  rz: number;
}

function layer(): CanvasRenderingContext2D {
  return Object.assign(document.createElement('canvas'), { width: W, height: W }).getContext('2d')!;
}

// A part of the outline, or a landmark, as one closed path in world metres (a landmark open in the
// middle as a second circle, which an even-odd fill leaves out). Bridges and arcs have round ends.
function partPath(p: WorldPart | Landmark): Path2D {
  const path = new Path2D();
  if (p.kind === 'disc') {
    path.arc(p.x, p.z, p.r, 0, 2 * Math.PI);
    if ('inner' in p && p.inner) {
      path.moveTo(p.x + p.inner, p.z);
      path.arc(p.x, p.z, p.inner, 0, 2 * Math.PI);
    }
    return path;
  }
  const w = p.halfWidth;
  if (p.kind === 'bridge') {
    const side = Math.atan2(p.bz - p.az, p.bx - p.ax) + Math.PI / 2; // the bearing of one side from the middle line
    path.arc(p.bx, p.bz, w, side, side - Math.PI, true);
    path.arc(p.ax, p.az, w, side - Math.PI, side, true);
    path.closePath();
    return path;
  }
  const end = (a: number) => [p.x + p.r * Math.cos(a), p.z + p.r * Math.sin(a)] as const;
  path.arc(p.x, p.z, p.r + w, p.from, p.to);
  path.arc(...end(p.to), w, p.to, p.to + Math.PI);
  path.arc(p.x, p.z, p.r - w, p.to, p.from, true);
  path.arc(...end(p.from), w, p.from + Math.PI, p.from + 2 * Math.PI);
  path.closePath();
  return path;
}
