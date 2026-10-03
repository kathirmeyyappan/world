// Live widgets the client draws itself, each a copy of one at widgets.kathirm.com: it fetches the
// same data the web widget does and paints the same layout onto a canvas, which a wall frame shows
// as a texture (render/WallFrames.ts). Drawing it ourselves keeps it one cheap texture in the
// scene, repainted only when its content changes.
import type { WidgetName } from '@world/shared';
import { spotifyWidget } from './spotify';

export interface Widget {
  readonly canvas: HTMLCanvasElement;
  // Called after every repaint, so whatever shows the canvas can take the new pixels.
  onPaint: () => void;
}

// A widget laid out as its web page would be in a window of this aspect (width over height).
export type WidgetFactory = (aspect: number) => Widget;

export const WIDGETS: Record<WidgetName, WidgetFactory> = {
  spotify: spotifyWidget,
};
