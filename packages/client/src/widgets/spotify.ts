// The Spotify widget (widgets.kathirm.com/spotify, from kathirmeyyappan/widgets): what's playing
// on Kathir's Spotify, or what last played, from the same worker the web widget polls, painted to
// match its widget.css: a blurred, darkened wash of the album art behind the art itself, a status
// row, the title, artist and album, and a progress bar.
import type { Widget, WidgetFactory } from './index';

const WORKER_URL = 'https://spotify-widget.kathirmey.workers.dev';
const POLL_MS = 7000; // as often as the web widget polls
const TICK_MS = 125; // while playing: the progress bar and the equaliser bars move this often
// CSS pixels across the window it's laid out in, as if it were the web page: just past the card's
// 480 px and widget.css's 24 px padding, so the card fills the frame's width.
const VIEW_W = 540;
const SCALE = 3; // canvas pixels per CSS pixel: sharp even with the frame filling a high-DPI screen
const FONT = "'Inter', system-ui, -apple-system, sans-serif";
const GREEN = '#1db954';
// The Spotify mark, on a 24 px square (the web widget's inline SVG).
const MARK = new Path2D(
  'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z',
);

// What the worker answers with; any field can be missing.
interface Track {
  isPlaying?: boolean;
  title?: string;
  artist?: string;
  album?: string;
  albumArt?: string | null;
  progressMs?: number;
  durationMs?: number;
}

type Status = 'playing' | 'idle' | 'offline';

// widget.css's colours per state: the mark and label, the progress fill, and the times.
const LOOK: Record<Status, { label: string; accent: string; fill: string; times: string }> = {
  playing: { label: 'NOW PLAYING', accent: GREEN, fill: GREEN, times: '#888' },
  idle: { label: 'LAST PLAYED', accent: '#999', fill: '#444', times: '#555' },
  offline: { label: 'NOT PLAYING', accent: '#444', fill: '#333', times: '#444' },
};

// Text lines are `line-height: normal`: about 1.21 times the font size.
const lineHeight = (px: number) => px * 1.21;

export const spotifyWidget: WidgetFactory = (aspect) => {
  const w = VIEW_W;
  const h = Math.round(VIEW_W / aspect);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * SCALE);
  canvas.height = Math.round(h * SCALE);
  const ctx = canvas.getContext('2d')!;
  // The blurred wash only changes with the art, so it's drawn once per track.
  const wash = document.createElement('canvas');
  wash.width = canvas.width;
  wash.height = canvas.height;

  const widget: Widget = { canvas, onPaint: () => {}, setShown: () => {} };
  let track: Track = {};
  let status: Status = 'offline';
  let art: HTMLImageElement | null = null;
  let artSrc = '';
  let anchor = { ms: 0, at: 0 }; // progress at a moment, for ticking between polls
  let ticker: number | null = null;

  const paintWash = () => {
    const wc = wash.getContext('2d')!;
    wc.clearRect(0, 0, wash.width, wash.height);
    if (!art || status === 'offline') return;
    // object-fit: cover, scaled 1.08 about the middle, blur(60px) brightness(0.4) saturate(1.4).
    const cover = Math.max(wash.width / art.width, wash.height / art.height) * 1.08;
    const aw = art.width * cover;
    const ah = art.height * cover;
    wc.filter = `blur(${60 * SCALE}px) brightness(0.4) saturate(1.4)`;
    wc.drawImage(art, (wash.width - aw) / 2, (wash.height - ah) / 2, aw, ah);
    wc.filter = 'none';
  };

  const paint = () => {
    const look = LOOK[status];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(wash, 0, 0);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

    // The row: 120 px of art, a 20 px gap and the text, at most 480 px wide, centred.
    const rowW = Math.min(w - 48, 480);
    const x = (w - rowW) / 2;
    const y = (h - 120) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowOffsetY = 4 * SCALE;
    ctx.shadowBlur = 20 * SCALE;
    ctx.beginPath();
    ctx.roundRect(x, y, 120, 120, 8);
    ctx.fillStyle = '#2a2a2a';
    ctx.fill();
    ctx.restore();
    if (art) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, 120, 120, 8);
      ctx.clip();
      const side = Math.min(art.width, art.height);
      ctx.drawImage(art, (art.width - side) / 2, (art.height - side) / 2, side, side, x, y, 120, 120);
      ctx.restore();
    }

    const tx = x + 140;
    const textW = rowW - 140;
    // Heights down the text: the status row (13), 10, title, 4, artist, 2, album, 14, times.
    const textH = 13 + 10 + lineHeight(22) + 4 + lineHeight(14) + 2 + lineHeight(12) + 14 + lineHeight(10);
    let ty = y + (120 - textH) / 2;
    ctx.textBaseline = 'middle';

    // Status row: the mark, the label, and while playing three bouncing bars.
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(13 / 24, 13 / 24);
    ctx.fillStyle = look.accent;
    ctx.fill(MARK);
    ctx.restore();
    ctx.font = `700 10px ${FONT}`;
    ctx.letterSpacing = '1px';
    ctx.fillStyle = look.accent;
    ctx.fillText(look.label, tx + 18, ty + 6.5);
    const labelEnd = tx + 18 + ctx.measureText(look.label).width;
    ctx.letterSpacing = '0px';
    if (status === 'playing') {
      const t = performance.now() / 1000;
      [5, 9, 6].forEach((barH, i) => {
        // eq-bounce: scaleY 0.35 → 1, eased, 0.7 s each way, 0.15 s apart.
        const p = ((((t - i * 0.15) / 0.7) % 2) + 2) % 2;
        const s = 0.35 + 0.65 * (0.5 - 0.5 * Math.cos(Math.PI * (p < 1 ? p : 2 - p)));
        ctx.fillStyle = GREEN;
        ctx.beginPath();
        ctx.roundRect(labelEnd + 7 + i * 4, ty + 11.5 - barH * s, 2, barH * s, 1);
        ctx.fill();
      });
    }
    ty += 13 + 10;

    const text = (str: string, px: number, weight: number, color: string) => {
      ctx.font = `${weight} ${px}px ${FONT}`;
      ctx.fillStyle = color;
      ctx.fillText(ellipsis(ctx, str, textW), tx, ty + lineHeight(px) / 2);
      ty += lineHeight(px);
    };
    text(track.title ?? '—', 22, 700, '#ffffff');
    ty += 4;
    text(track.artist ?? '—', 14, 400, '#b3b3b3');
    ty += 2;
    text(track.album ?? '', 12, 400, '#777');
    ty += 14;

    // Progress row: elapsed, the bar, and the length.
    const duration = track.durationMs ?? 0;
    const elapsed = status === 'playing' ? Math.min(anchor.ms + (Date.now() - anchor.at), duration) : 0;
    const left = status === 'playing' ? clock(elapsed) : status === 'idle' ? '-:--' : '00:00';
    const right = status === 'offline' ? '00:00' : clock(duration);
    const mid = ty + lineHeight(10) / 2;
    ctx.font = `400 10px ${FONT}`;
    ctx.fillStyle = look.times;
    ctx.fillText(left, tx, mid);
    const rightW = ctx.measureText(right).width;
    ctx.fillText(right, tx + textW - rightW, mid);
    const barX = tx + ctx.measureText(left).width + 7;
    const barW = tx + textW - rightW - 7 - barX;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.roundRect(barX, mid - 1.5, barW, 3, 2);
    ctx.fill();
    if (duration > 0 && elapsed > 0) {
      ctx.fillStyle = look.fill;
      ctx.beginPath();
      ctx.roundRect(barX, mid - 1.5, (barW * elapsed) / duration, 3, 2);
      ctx.fill();
    }
    widget.onPaint();
  };

  const show = (next: Track) => {
    track = next;
    status = next.isPlaying ? 'playing' : next.title ? 'idle' : 'offline';
    anchor = { ms: next.progressMs ?? 0, at: Date.now() };
    const src = next.albumArt ?? '';
    if (src !== artSrc) {
      artSrc = src;
      art = null;
      if (src) {
        const img = new Image();
        // Without CORS the art would taint the canvas, which then can't become a texture.
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (artSrc !== src) return;
          art = img;
          paintWash();
          paint();
        };
        img.src = src;
      }
    }
    paintWash();
    sync();
    paint();
  };

  // Poll like the web widget, every POLL_MS, but only while the frame is in view and the tab is
  // showing; at once when both come back. A failed poll keeps what's there.
  const poll = async () => {
    try {
      const res = await fetch(WORKER_URL);
      show((await res.json()) as Track);
    } catch {
      // keep the last state
    }
  };
  let inView = false;
  let polling: number | null = null;
  // Start or stop polling, and the ticker that moves the progress and equaliser while playing, to
  // match whether anyone can see it.
  const sync = () => {
    const live = inView && !document.hidden;
    if (live && polling === null) {
      void poll();
      polling = window.setInterval(() => void poll(), POLL_MS);
    }
    if (!live && polling !== null) {
      clearInterval(polling);
      polling = null;
    }
    const tick = live && status === 'playing';
    if (tick && ticker === null) ticker = window.setInterval(paint, TICK_MS);
    if (!tick && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  };
  document.addEventListener('visibilitychange', sync);
  widget.setShown = (shown) => {
    inView = shown;
    sync();
  };

  paint();
  return widget;
};

// `str`, cut short with an ellipsis to fit `max` pixels in the current font.
function ellipsis(ctx: CanvasRenderingContext2D, str: string, max: number): string {
  if (ctx.measureText(str).width <= max) return str;
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(str.slice(0, mid) + '…').width <= max) lo = mid;
    else hi = mid - 1;
  }
  return str.slice(0, lo) + '…';
}

// Milliseconds as mm:ss.
function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
