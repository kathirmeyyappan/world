// The map in the menu's PLAY tab: the HUD minimap's view (MapCanvas.ts; NEAR or WORLD, the same
// toggle, P too) drawn in the preview's window, with a wheel or a pinch to zoom it, about the point
// under the pointer, and a drag to slide it about. A change of view starts the framing afresh.
import { MapCanvas, coordsOf, type MinimapView } from '../MapCanvas';
import { MapControls } from '../mapControls';
import type { Minimap } from '../Minimap';

export class MenuMap {
  readonly el = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly map = new MapCanvas(this.canvas);
  private readonly controls = new MapControls(this.canvas, () => this.map.baseScale(this.view));
  private readonly toggle = document.createElement('div');
  private readonly coords = document.createElement('span');
  private view: MinimapView; // the view the framing is for

  constructor(private readonly minimap: Minimap) {
    this.el.className = 'view map';
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
  }

  // Once a frame while it's in view: the latest frame the HUD's minimap had, in its view.
  sync(): void {
    const view = this.minimap.view;
    if (view !== this.view) {
      this.view = view;
      this.controls.reset();
    }
    for (const b of this.toggle.children) {
      if (b instanceof HTMLElement) b.classList.toggle('on', b.dataset.view === view);
    }
    const frame = this.minimap.frame;
    if (!frame) return;
    this.coords.textContent = coordsOf(frame.me);
    this.map.draw(frame, view, this.controls.framing);
  }
}
