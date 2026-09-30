// Bottom-right minimap. Two views: NEAR keeps you centred and rotates so you always face up;
// WORLD shows the whole outline north-up. The floor and outline are drawn per pixel from the
// world's signed distance, so any shape made of discs and bridges draws correctly with no path maths.
// That is too slow to redo every frame, so each view's floor is drawn once, north-up, into an
// offscreen canvas at that view's scale, and each frame just places (and for NEAR, rotates) it.
// Markers (cubes, players, you) go on top with plain canvas calls; a player on another level (a
// floor above, a bridge below) is a triangle pointing their way instead of a square. Your x, y, z sits
// in the map's corner: the sim's coordinates, with y the height of your feet rather than your eyes.
// Desktop only; see styles.css.
import { EYE_HEIGHT, worldBounds, worldDistance, type WorldPart } from '@world/shared';

export interface MinimapFrame {
  me: { x: number; y: number; z: number; yaw: number };
  players: { x: number; y: number; z: number; color: string }[];
  cubes: { x: number; z: number }[];
}

export type MinimapView = 'near' | 'world';

const SIZE = 224; // internal pixels, one per CSS pixel of the canvas
const NEAR_RANGE = 26; // metres from you to the panel's edge in the near view
const GRID_SPACING = 10;
const EDGE_PIXELS = 1.1; // half-width of the outline, in panel pixels, so it stays crisp at any zoom
const ACCENT = [100, 181, 246] as const;
const LEVEL = 3; // metres of height difference at which another player reads as above or below you

export class Minimap {
  private readonly root = document.getElementById('minimap')!;
  private readonly canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
  private readonly toggleBar = document.getElementById('minimap-toggle')!;
  private readonly coords = document.getElementById('minimap-coords')!;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly floors = new Map<number, Floor>(); // keyed by metres per pixel
  private view: MinimapView = 'near';
  private readonly bounds;

  constructor(private readonly shape: WorldPart[]) {
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d')!;
    this.bounds = worldBounds(shape);
    this.setView('near');
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
    this.coords.textContent = `${x.toFixed(0)}, ${(y - EYE_HEIGHT).toFixed(0)}, ${z.toFixed(0)}`;
    const t = this.transform(frame.me);
    this.drawFloor(t);

    for (const c of frame.cubes) this.marker(t, c.x, c.z, 2, 'rgba(255,255,255,0.35)'); // faint specks; players should stand out
    for (const p of frame.players) this.player(t, p, p.y - frame.me.y);
    this.drawMe(t, frame.me);
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

  // The cached floor for this view's scale, drawn so its world points land where `t` puts them.
  private drawFloor(t: Transform): void {
    let floor = this.floors.get(t.scale);
    if (!floor) this.floors.set(t.scale, (floor = this.renderFloor(t.scale)));
    const ctx = this.ctx;
    const [e, f] = this.toPixel(t, floor.x, floor.z);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(t.rx, -t.fx, -t.rz, t.fz, e, f); // floor pixels are the same size as the panel's
    ctx.drawImage(floor.canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // The whole world's floor, north-up, at `scale` metres per pixel, with a pixel of margin for the
  // outline. `x`, `z` is the world point at the canvas's top-left corner.
  private renderFloor(scale: number): Floor {
    const b = this.bounds;
    const x = b.minX - 2 * scale;
    const z = b.maxZ + 2 * scale;
    const w = Math.ceil((b.maxX - b.minX) / scale) + 4;
    const h = Math.ceil((b.maxZ - b.minZ) / scale) + 4;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(w, h);
    const data = image.data;
    let i = 0;
    for (let py = 0; py < h; py++) {
      const wz = z - (py + 0.5) * scale;
      for (let px = 0; px < w; px++, i += 4) {
        const wx = x + (px + 0.5) * scale;
        const d = worldDistance(wx, wz, this.shape);
        let a = 0;
        if (Math.abs(d) < scale * EDGE_PIXELS) a = 230;
        else if (d < 0) {
          const gx = Math.abs((((wx % GRID_SPACING) + GRID_SPACING) % GRID_SPACING) - GRID_SPACING / 2);
          const gz = Math.abs((((wz % GRID_SPACING) + GRID_SPACING) % GRID_SPACING) - GRID_SPACING / 2);
          const onLine = gx > GRID_SPACING / 2 - scale * 0.6 || gz > GRID_SPACING / 2 - scale * 0.6;
          a = onLine ? 70 : 28;
        }
        data[i] = ACCENT[0];
        data[i + 1] = ACCENT[1];
        data[i + 2] = ACCENT[2];
        data[i + 3] = a;
      }
    }
    ctx.putImageData(image, 0, 0);
    return { canvas, x, z };
  }

  private toPixel(t: Transform, x: number, z: number): [number, number] {
    const dx = x - t.ox;
    const dz = z - t.oz;
    const lx = dx * t.rx + dz * t.rz;
    const ly = dx * t.fx + dz * t.fz;
    return [SIZE / 2 + lx / t.scale, SIZE / 2 - ly / t.scale];
  }

  private marker(t: Transform, x: number, z: number, size: number, color: string): void {
    const [px, py] = this.toPixel(t, x, z);
    if (px < -size || py < -size || px > SIZE + size || py > SIZE + size) return;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(px - size / 2), Math.round(py - size / 2), size, size);
  }

  // A square on your level, or a triangle pointing up or down at someone above or below you.
  private player(t: Transform, p: MinimapFrame['players'][number], dy: number): void {
    if (Math.abs(dy) < LEVEL) return this.marker(t, p.x, p.z, 5, p.color);
    const [px, py] = this.toPixel(t, p.x, p.z);
    if (px < -6 || py < -6 || px > SIZE + 6 || py > SIZE + 6) return;
    const x = Math.round(px);
    const y = Math.round(py);
    const tip = dy > 0 ? -4 : 4;
    const ctx = this.ctx;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(x, y + tip);
    ctx.lineTo(x + 4, y - tip);
    ctx.lineTo(x - 4, y - tip);
    ctx.closePath();
    ctx.fill();
  }

  private drawMe(t: Transform, me: MinimapFrame['me']): void {
    const [px, py] = this.toPixel(t, me.x, me.z);
    // Heading on screen: forward is straight up in the near view, rotated by yaw in the world view.
    const angle = this.view === 'near' ? 0 : me.yaw;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(Math.round(px), Math.round(py));
    ctx.rotate(angle);
    ctx.fillStyle = '#fff';
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

interface Floor {
  canvas: HTMLCanvasElement;
  x: number;
  z: number;
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
