// The anime activity widget (widgets.kathirm.com/anime-activity, from kathirmeyyappan/widgets): what
// Kathir has recently watched or read on MyAnimeList, from the same worker the web widget fetches,
// painted to match its widget.css: a header, then a row per title with its cover, title and type
// badge, status, progress and score, and how long ago. It lays out as a page as tall as it needs
// and shows a window of it the frame's height; the wheel scrolls that window (`scroll`).
import type { Widget, WidgetFactory } from './index';
import { ellipsis } from './text';

const WORKER_URL = 'https://anime-activity-widget.kathirmey.workers.dev';
const DAYS = 10; // as many days back as the web widget asks for
const REFRESH_MS = 10 * 60 * 1000; // fetched again on coming into view after this long
// CSS pixels across the window it's laid out in, as if it were the web page: the card's 520 px and
// widget.css's 24 px padding either side.
const VIEW_W = 568;
const PAD = 24;
const SCALE = 3; // canvas pixels per CSS pixel: sharp even with the frame filling a high-DPI screen
const FONT = "'Inter', system-ui, -apple-system, sans-serif";
const MAL_BLUE = '#2e51a2';
// The web widget's MyAnimeList mark, on a 24 px square.
const MARK = new Path2D('M3 5h18v14H3V5zm2 2v10h14V7H5zm2 2h4v6H9v-2H7V9zm6 0h4v2h-2v4h-2V9z');
const BADGES: Record<string, { fill: string; text: string }> = {
  anime: { fill: 'rgba(46, 81, 162, 0.2)', text: '#6b8fd4' },
  manga: { fill: 'rgba(184, 92, 56, 0.2)', text: '#d49575' },
};
// Rows down the page: the header, then a cover's height and the gap below it per title.
const HEADER = 13 + 8 + 1; // the mark's line, its padding and the rule under it
const GAP = 14;
const COVER_W = 56;
const COVER_H = 80;
const ROW_GAP = 12;
const WHEEL = 0.6; // CSS pixels of page per pixel of wheel

// What the worker answers with for each title.
interface Entry {
  type: string;
  unit: string;
  title: string;
  image: string;
  status: string;
  score: number | null;
  progress: number | null;
  total: number | null;
  date: string;
}

type State = 'loading' | 'ready' | 'empty' | 'error';
const MESSAGES: Record<Exclude<State, 'ready'>, string> = {
  loading: 'Loading…',
  empty: 'No recent activity.',
  error: 'Could not load activity.',
};

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export const animeActivityWidget: WidgetFactory = (aspect) => {
  const w = VIEW_W;
  const h = Math.round(VIEW_W / aspect);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * SCALE);
  canvas.height = Math.round(h * SCALE);
  const ctx = canvas.getContext('2d')!;

  let state: State = 'loading';
  let entries: Entry[] = [];
  const covers = new Map<string, HTMLImageElement>(); // by the worker's image url, once loaded
  let scroll = 0; // CSS pixels of the page above the window
  let fetchedAt = -Infinity;

  const pageHeight = () =>
    PAD + HEADER + GAP + (state === 'ready' ? entries.length * (COVER_H + ROW_GAP) - ROW_GAP : 60) + PAD;
  const maxScroll = () => Math.max(0, pageHeight() - h);

  const paint = () => {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(0, -scroll);
    const x = PAD;
    const width = w - 2 * PAD;
    let y = PAD;
    ctx.textBaseline = 'middle';

    // Header: the mark and "RECENT UPDATES", over a faint rule.
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(14 / 24, 14 / 24);
    ctx.fillStyle = MAL_BLUE;
    ctx.fill(MARK);
    ctx.restore();
    ctx.font = `700 11px ${FONT}`;
    ctx.letterSpacing = '1.1px';
    ctx.fillStyle = '#b3b3b3';
    ctx.fillText('RECENT UPDATES', x + 20, y + 7);
    ctx.letterSpacing = '0px';
    y += HEADER;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(x, y - 1, width, 1);
    y += GAP;

    if (state !== 'ready') {
      ctx.font = `400 13px ${FONT}`;
      ctx.fillStyle = '#777';
      ctx.textAlign = 'center';
      ctx.fillText(MESSAGES[state], w / 2, y + 30);
      ctx.textAlign = 'left';
    }
    for (const e of state === 'ready' ? entries : []) {
      row(e, x, y, width);
      y += COVER_H + ROW_GAP;
    }

    // A thin bar down the right edge when there's more page than window.
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    if (maxScroll() > 0) {
      const bar = (h * h) / pageHeight();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.beginPath();
      ctx.roundRect(w - 7, (scroll / maxScroll()) * (h - bar), 3, bar, 2);
      ctx.fill();
    }
    widget.onPaint();
  };

  // One title's row: cover, then title and badge over the detail line, then the time on the right.
  const row = (e: Entry, x: number, y: number, width: number) => {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowOffsetY = 2 * SCALE;
    ctx.shadowBlur = 8 * SCALE;
    ctx.beginPath();
    ctx.roundRect(x, y, COVER_W, COVER_H, 4);
    ctx.fillStyle = '#2a2a2a';
    ctx.fill();
    ctx.restore();
    const cover = covers.get(e.image);
    if (cover) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, COVER_W, COVER_H, 4);
      ctx.clip();
      // object-fit: cover
      const s = Math.max(COVER_W / cover.width, COVER_H / cover.height);
      const cw = COVER_W / s;
      const ch = COVER_H / s;
      ctx.drawImage(cover, (cover.width - cw) / 2, (cover.height - ch) / 2, cw, ch, x, y, COVER_W, COVER_H);
      ctx.restore();
    }

    const ago = since(e.date);
    ctx.font = `400 11px ${FONT}`;
    const agoW = ctx.measureText(ago).width;
    ctx.fillStyle = '#777';
    ctx.fillText(ago, x + width - agoW, y + COVER_H / 2);

    const mx = x + COVER_W + 14;
    const metaW = width - COVER_W - 14 - 14 - agoW;
    const middle = y + COVER_H / 2;
    // Title row (14 px, line-height normal) over the detail line (12 px), 3 px apart, centred.
    const titleY = middle - (17 + 3 + 14.5) / 2 + 17 / 2;
    const detailY = titleY + 17 / 2 + 3 + 14.5 / 2;

    ctx.font = `700 9px ${FONT}`;
    ctx.letterSpacing = '0.72px';
    const badge = e.type.toUpperCase();
    const badgeW = ctx.measureText(badge).width + 12;
    ctx.letterSpacing = '0px';
    ctx.font = `600 14px ${FONT}`;
    const title = ellipsis(ctx, e.title, metaW - 8 - badgeW);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(title, mx, titleY);
    const bx = mx + ctx.measureText(title).width + 8;
    const look = BADGES[e.type] ?? BADGES.anime;
    ctx.fillStyle = look.fill;
    ctx.beginPath();
    ctx.roundRect(bx, titleY - 7, badgeW, 14, 3);
    ctx.fill();
    ctx.font = `700 9px ${FONT}`;
    ctx.letterSpacing = '0.72px';
    ctx.fillStyle = look.text;
    ctx.fillText(badge, bx + 6, titleY);
    ctx.letterSpacing = '0px';

    const total = e.total && e.total > 0 ? e.total : '?';
    const parts = [
      e.status,
      `${e.progress ?? 0}/${total} ${e.unit}`,
      e.score && e.score > 0 ? `Scored ${e.score}/10` : 'Scored –',
    ];
    ctx.font = `400 12px ${FONT}`;
    let dx = mx;
    parts.forEach((part, i) => {
      if (i > 0) {
        ctx.fillStyle = '#555';
        ctx.fillText('·', dx + 6, detailY);
        dx += 12 + ctx.measureText('·').width;
      }
      ctx.fillStyle = '#b3b3b3';
      ctx.fillText(part, dx, detailY);
      dx += ctx.measureText(part).width;
    });
  };

  const load = async () => {
    fetchedAt = Date.now();
    try {
      const res = await fetch(`${WORKER_URL}?days=${DAYS}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { entries?: Entry[]; error?: string };
      if (body.error) throw new Error(body.error);
      entries = body.entries ?? [];
      state = entries.length > 0 ? 'ready' : 'empty';
    } catch {
      state = entries.length > 0 ? 'ready' : 'error'; // a failed refresh keeps what's there
    }
    scroll = Math.min(scroll, maxScroll());
    for (const e of entries) if (e.image && !covers.has(e.image)) loadCover(e.image);
    paint();
  };

  // Covers come through the worker, which serves them with CORS headers: an image without them
  // would taint the canvas, which then can't become the frame's texture from afar.
  const loadCover = (url: string) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      covers.set(url, img);
      paint();
    };
    img.src = `${WORKER_URL}/cover?url=${encodeURIComponent(url)}`;
  };

  const widget: Widget = {
    canvas,
    onPaint: () => {},
    setShown: (shown) => {
      if (shown && Date.now() - fetchedAt > REFRESH_MS) void load();
    },
    scroll: (dy) => {
      const next = Math.min(maxScroll(), Math.max(0, scroll + dy * WHEEL));
      if (next === scroll) return;
      scroll = next;
      paint();
    },
  };

  paint();
  return widget;
};

// How long ago an ISO time was, as the web widget words it ("3 hours ago", "yesterday").
function since(iso: string): string {
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const a = Math.abs(s);
  if (a < 60) return relative.format(s, 'second');
  if (a < 3600) return relative.format(Math.round(s / 60), 'minute');
  if (a < 86400) return relative.format(Math.round(s / 3600), 'hour');
  if (a < 2592000) return relative.format(Math.round(s / 86400), 'day');
  if (a < 31536000) return relative.format(Math.round(s / 2592000), 'month');
  return relative.format(Math.round(s / 31536000), 'year');
}
