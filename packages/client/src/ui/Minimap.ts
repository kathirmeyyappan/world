// Bottom-right minimap. Two views: NEAR keeps you centred and rotates so you always face up;
// WORLD shows the whole outline north-up. The floor and outline are drawn per pixel from the
// world's signed distance, so any shape made of discs and bridges draws correctly with no path maths.
// Markers (cubes, players, you) go on top with plain canvas calls, and your world x, z is shown
// under the map: the same coordinates the sim, the wire protocol and WORLD_SHAPE use.
// Desktop only; see styles.css.
import { worldBounds, worldDistance, type WorldPart } from '@world/shared';

export interface MinimapFrame {
  me: { x: number; z: number; yaw: number };
  players: { x: number; z: number; color: string }[];
  cubes: { x: number; z: number }[];
}

export type MinimapView = 'near' | 'world';

const SIZE = 112; // internal pixels; CSS scales it up with image-rendering: pixelated
const NEAR_RANGE = 26; // metres from you to the panel's edge in the near view
const GRID_SPACING = 10;
const EDGE_PIXELS = 0.75; // half-width of the outline, in panel pixels, so it stays crisp at any zoom
const ACCENT = [100, 181, 246] as const;

export class Minimap {
  private readonly root = document.getElementById('minimap')!;
  private readonly canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
  private readonly label = document.getElementById('minimap-view')!;
  private readonly coords = document.getElementById('minimap-coords')!;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private view: MinimapView = 'near';
  private readonly bounds;

  constructor(private readonly shape: WorldPart[]) {
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d')!;
    this.image = this.ctx.createImageData(SIZE, SIZE);
    this.bounds = worldBounds(shape);
    this.setView('near');
  }

  toggle(): void {
    this.setView(this.view === 'near' ? 'world' : 'near');
  }

  setView(view: MinimapView): void {
    this.view = view;
    this.label.textContent = view === 'near' ? 'NEAR' : 'WORLD';
  }

  get active(): boolean {
    return this.root.clientWidth > 0;
  }

  update(frame: MinimapFrame): void {
    if (!this.active) return;
    this.coords.textContent = `${frame.me.x.toFixed(0)}, ${frame.me.z.toFixed(0)}`;
    const t = this.transform(frame.me);
    this.drawFloor(t);
    this.ctx.putImageData(this.image, 0, 0);

    for (const c of frame.cubes) this.marker(t, c.x, c.z, 3, 'rgba(255,255,255,0.85)');
    for (const p of frame.players) this.marker(t, p.x, p.z, 3, p.color);
    this.drawMe(t, frame.me);
  }

  // Pixel <-> world mapping for the current view. `origin` is the world point at the panel
  // centre, `f`/`r` the world directions that map to screen up and right, `scale` metres per pixel.
  private transform(me: MinimapFrame['me']): Transform {
    if (this.view === 'near') {
      return {
        ox: me.x, oz: me.z, scale: (NEAR_RANGE * 2) / SIZE,
        fx: Math.sin(me.yaw), fz: Math.cos(me.yaw),
        rx: Math.cos(me.yaw), rz: -Math.sin(me.yaw),
      };
    }
    const b = this.bounds;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 8;
    return {
      ox: (b.minX + b.maxX) / 2, oz: (b.minZ + b.maxZ) / 2, scale: span / SIZE,
      fx: 0, fz: 1, rx: 1, rz: 0,
    };
  }

  private drawFloor(t: Transform): void {
    const data = this.image.data;
    const half = SIZE / 2;
    let i = 0;
    for (let py = 0; py < SIZE; py++) {
      const ly = (half - py - 0.5) * t.scale;
      for (let px = 0; px < SIZE; px++, i += 4) {
        const lx = (px + 0.5 - half) * t.scale;
        const wx = t.ox + t.rx * lx + t.fx * ly;
        const wz = t.oz + t.rz * lx + t.fz * ly;
        const d = worldDistance(wx, wz, this.shape);
        let a = 0;
        if (Math.abs(d) < t.scale * EDGE_PIXELS) a = 230;
        else if (d < 0) {
          const gx = Math.abs(((wx % GRID_SPACING) + GRID_SPACING) % GRID_SPACING - GRID_SPACING / 2);
          const gz = Math.abs(((wz % GRID_SPACING) + GRID_SPACING) % GRID_SPACING - GRID_SPACING / 2);
          const onLine = gx > GRID_SPACING / 2 - t.scale * 0.6 || gz > GRID_SPACING / 2 - t.scale * 0.6;
          a = onLine ? 70 : 28;
        }
        data[i] = ACCENT[0];
        data[i + 1] = ACCENT[1];
        data[i + 2] = ACCENT[2];
        data[i + 3] = a;
      }
    }
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
    ctx.moveTo(0, -4);
    ctx.lineTo(3.5, 3);
    ctx.lineTo(0, 1.5);
    ctx.lineTo(-3.5, 3);
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
