// Live widgets the client draws itself, each a copy of one at widgets.kathirm.com: it fetches the
// same data the web widget does and paints the same layout onto a canvas, which a wall frame shows
// as a texture (render/WallFrames.ts). Drawing it ourselves keeps it one cheap texture in the
// scene, repainted only when its content changes.
import type { WidgetName } from '@world/shared';
import { animeActivityWidget } from './anime-activity';
import { spotifyWidget } from './spotify';

export interface Widget {
  readonly canvas: HTMLCanvasElement;
  // Called after every repaint, so whatever shows the canvas can take the new pixels.
  onPaint: () => void;
  // Whether its frame is shown, in view and near enough to see (render/CrispPanels.ts): a widget
  // fetches and animates only while it is and the tab is showing, and catches up at once when it
  // comes back.
  setShown: (shown: boolean) => void;
  // Moves a widget longer than its frame by `dy` pixels of wheel, if it scrolls.
  scroll?: (dy: number) => void;
}

// A widget laid out as its web page would be in a window of this aspect (width over height).
export type WidgetFactory = (aspect: number) => Widget;

export const WIDGETS: Record<WidgetName, WidgetFactory> = {
  spotify: spotifyWidget,
  'anime-activity': animeActivityWidget,
};
