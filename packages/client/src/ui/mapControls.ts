// What a map you can handle does with the pointer (the menu's map and the guide's): a wheel or a
// pinch zooms it about the point under the pointer, which stays put, and a drag slides it about. It
// keeps the Framing a MapCanvas draws with; `scale` is the view's metres per CSS pixel before zoom.
import { STILL, type Framing } from './MapCanvas';

const WHEEL_ZOOM = 1.0015; // zoom per pixel of wheel travel: a notch of 100 is about a sixth closer
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;

export class MapControls {
  framing: Framing = fresh();
  private readonly pointers = new Map<number, { x: number; y: number }>(); // pressed on the map
  private pinch = 0; // CSS pixels between two pressed pointers at the last move

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly scale: () => number,
  ) {
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault(); // the wheel zooms the map, not the page or the card under it
      const r = canvas.getBoundingClientRect();
      this.zoom(Math.pow(WHEEL_ZOOM, -e.deltaY), e.clientX - r.left, e.clientY - r.top);
    });
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pinch = this.spread();
    });
    canvas.addEventListener('pointermove', (e) => {
      const was = this.pointers.get(e.pointerId);
      if (!was) return;
      const r = canvas.getBoundingClientRect();
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) return this.slide(e.clientX - was.x, e.clientY - was.y);
      // Two fingers: the map zooms as they spread, about their midpoint, and slides with it.
      const [a, b] = [...this.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.slide((e.clientX - was.x) / 2, (e.clientY - was.y) / 2);
      const spread = this.spread();
      if (this.pinch > 0) this.zoom(spread / this.pinch, mid.x - r.left, mid.y - r.top);
      this.pinch = spread;
    });
    const release = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.pinch = this.spread();
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  // Back to the view's own framing.
  reset(): void {
    this.framing = fresh();
  }

  // Metres per CSS pixel as drawn now.
  private now(): number {
    return this.scale() / this.framing.zoom;
  }

  // Slides the map `dx`, `dy` CSS pixels: what was under the pointer stays under it.
  private slide(dx: number, dy: number): void {
    const s = this.now();
    this.framing.pan.right -= dx * s;
    this.framing.pan.up += dy * s;
  }

  // Zooms `by` about the point `x`, `y` CSS pixels from the canvas's corner, which stays put.
  private zoom(by: number, x: number, y: number): void {
    const was = this.now();
    this.framing.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.framing.zoom * by));
    const now = this.now();
    const dx = x - this.canvas.clientWidth / 2;
    const dy = y - this.canvas.clientHeight / 2;
    this.framing.pan.right += dx * (was - now);
    this.framing.pan.up -= dy * (was - now);
  }

  private spread(): number {
    if (this.pointers.size < 2) return 0;
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}

function fresh(): Framing {
  return { ...STILL, pan: { ...STILL.pan } };
}
