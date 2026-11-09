// The map in the menu's PLAY tab: the HUD minimap's view (MapCanvas.ts; NEAR or WORLD, the same
// toggle, P too) drawn in the preview's window, with a wheel or a pinch to zoom it, about the point
// under the pointer, and a drag to slide it about. A change of view starts the framing afresh.
import { MapCanvas, STILL, coordsOf, type Framing, type MinimapView } from '../MapCanvas';
import type { Minimap } from '../Minimap';

const WHEEL_ZOOM = 1.0015; // zoom per pixel of wheel travel: a notch of 100 is about a sixth closer
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;

export class MenuMap {
  readonly el = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly map: MapCanvas;
  private readonly toggle = document.createElement('div');
  private readonly coords = document.createElement('span');
  private framing: Framing = { ...STILL, pan: { ...STILL.pan } };
  private view: MinimapView; // the view the framing is for
  private readonly pointers = new Map<number, { x: number; y: number }>(); // pressed on the map
  private pinch = 0; // CSS pixels between two pressed pointers at the last move

  constructor(private readonly minimap: Minimap) {
    this.el.className = 'view map';
    this.map = new MapCanvas(this.canvas, minimap.shape, minimap.landmarks, minimap.high);
    this.view = minimap.view;
    this.toggle.className = 'toggle';
    for (const view of ['near', 'world'] as const) {
      const button = Object.assign(document.createElement('button'), { textContent: view.toUpperCase() });
      button.dataset.view = view;
      button.addEventListener('click', () => minimap.setView(view));
      this.toggle.append(button);
    }
    this.coords.className = 'coords';
    this.el.append(this.canvas, this.toggle, this.coords);

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault(); // the wheel zooms the map, not the card under it
      const r = this.canvas.getBoundingClientRect();
      this.zoom(Math.pow(WHEEL_ZOOM, -e.deltaY), e.clientX - r.left, e.clientY - r.top);
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pinch = this.spread();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const was = this.pointers.get(e.pointerId);
      if (!was) return;
      const r = this.canvas.getBoundingClientRect();
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
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
  }

  // Once a frame while it's in view: the latest frame the HUD's minimap had, in its view.
  sync(): void {
    const view = this.minimap.view;
    if (view !== this.view) {
      this.view = view;
      this.framing = { ...STILL, pan: { ...STILL.pan } };
    }
    for (const b of this.toggle.children) {
      if (b instanceof HTMLElement) b.classList.toggle('on', b.dataset.view === view);
    }
    const frame = this.minimap.frame;
    if (!frame) return;
    this.coords.textContent = coordsOf(frame.me);
    this.map.draw(frame, view, this.framing);
  }

  // Metres per CSS pixel as drawn now.
  private scale(): number {
    return this.map.baseScale(this.view) / this.framing.zoom;
  }

  // Slides the map `dx`, `dy` CSS pixels: what was under the pointer stays under it.
  private slide(dx: number, dy: number): void {
    const s = this.scale();
    this.framing.pan.right -= dx * s;
    this.framing.pan.up += dy * s;
  }

  // Zooms `by` about the point `x`, `y` CSS pixels from the canvas's corner, which stays put.
  private zoom(by: number, x: number, y: number): void {
    const was = this.scale();
    this.framing.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.framing.zoom * by));
    const now = this.scale();
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
