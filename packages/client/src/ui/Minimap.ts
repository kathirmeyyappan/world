// Bottom-right minimap: the map (MapCanvas.ts) in a panel with its NEAR/WORLD toggle and your x, y,
// z in the corner. Desktop only (see styles.css); the menu's map (menu/Map.ts) shows the same view
// everywhere, so the view and the latest frame are kept here for it even where the panel is hidden.
import { MapCanvas, coordsOf, type MinimapFrame, type MinimapView } from './MapCanvas';

export type { MinimapFrame, MinimapView } from './MapCanvas';

export class Minimap {
  private readonly root = document.getElementById('minimap')!;
  private readonly toggleBar = document.getElementById('minimap-toggle')!;
  private readonly coords = document.getElementById('minimap-coords')!;
  private readonly map = new MapCanvas(document.getElementById('minimap-canvas') as HTMLCanvasElement);
  view: MinimapView = 'near';
  frame: MinimapFrame | null = null; // the latest, as the menu's map draws it too

  constructor() {
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
    this.frame = frame;
    if (!this.active) return;
    this.coords.textContent = coordsOf(frame.me);
    this.map.draw(frame, this.view);
  }
}
