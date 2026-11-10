// How the picture is drawn: the size of its pixels (CSS pixels per rendered one, the retro grid
// the browser blows the frame up to) and how many frames a second it's drawn, each a setting the
// menu shows and the device keeps. The pixel size is auto unless one is chosen: it starts fine on a
// mouse device and coarse on a touch one, steps coarser whenever the machine falls behind the frame
// rate, and tries a step finer again once it has kept up for a while, and straight on to the next
// while each holds, so a weak machine settles where it keeps up and a strong one climbs to the
// detail in seconds. The tries never stop: one that fails costs
// the player a few seconds of dropped frames before auto backs off, and the next waits twice as
// long, from a minute up to eight, then every eight minutes for the rest of the session. That is
// the price of finding the finest size the machine can hold, and it is paid only by a machine
// that can't go finer.

export const PIXEL_SIZES = [1, 1.5, 2, 2.5, 3] as const; // the choices, and the steps auto moves along
export type PixelSize = (typeof PIXEL_SIZES)[number];
export const FRAME_RATES = [15, 30, 45, 60, 75, 90] as const; // the choices, fifteen apart
export type FrameRate = (typeof FRAME_RATES)[number];

// Where auto starts: a phone on the coarse grid it has always had, a mouse device a step finer;
// either climbs to the finest size for as long as it keeps up. The frame rate is the device's
// unless one is chosen, a phone's a notch under a mouse device's.
const AUTO_START: PixelSize = 1.5;
const TOUCH_START: PixelSize = 2.5;
const FINEST: PixelSize = 1;
const FRAME_RATE: FrameRate = 60;
const TOUCH_FRAME_RATE: FrameRate = 45;
const STARTUP_MS = 6000; // the world is still streaming in: its hitches say nothing about the machine
const SETTLE_MS = 3000; // after a step, before its frames count (the resize itself hitches)
const WINDOW = 120; // frames judged at a time: two seconds at 60
const PAUSE_MS = 500; // an interval this long is the tab asleep, not a slow frame
const BACK_OFF = 0.2; // the share of late frames in the window that steps coarser
const KEPT_UP = 0.02; // at most this share late (a GC pause or two) counts as keeping up
const PROBE_AFTER_MS = 20000; // kept up this long, auto tries a step finer
const RETRY_MS = 60000; // after a step finer fails, how long before trying again; doubles each time
const RETRY_MAX_MS = 8 * 60000; // and never longer: a machine that can't go finer is tried this often for good
const PIXELS_KEY = 'world.pixels';
const FRAME_RATE_KEY = 'world.fps';

export class Picture {
  pixels: PixelSize | 'auto' = 'auto';
  frameRate: FrameRate;
  private readonly start: PixelSize;
  private current: PixelSize; // what's drawn now: the choice, or where auto has got to
  private settled: PixelSize; // where auto has got to on this machine, kept through a choice
  private late: boolean[] = [];
  private holdUntil: number; // until when auto leaves the level alone
  private probeAt = Infinity; // when auto may next try a step finer
  private probing = false; // the level drawn is a step finer under trial
  private retryMs = RETRY_MS;

  constructor(touch: boolean, now: number) {
    this.start = touch ? TOUCH_START : AUTO_START;
    this.frameRate = touch ? TOUCH_FRAME_RATE : FRAME_RATE;
    try {
      const pixels = Number(localStorage.getItem(PIXELS_KEY));
      if (isPixelSize(pixels)) this.pixels = pixels;
      const rate = Number(localStorage.getItem(FRAME_RATE_KEY));
      if (isFrameRate(rate)) this.frameRate = rate;
    } catch {
      // no storage: the defaults
    }
    this.settled = this.start;
    this.current = this.pixels === 'auto' ? this.start : this.pixels;
    this.holdUntil = now + STARTUP_MS;
    this.probeAt = now + STARTUP_MS + PROBE_AFTER_MS;
  }

  // CSS pixels per rendered pixel, as drawn now.
  get level(): PixelSize {
    return this.current;
  }

  // The size auto has settled on for this machine (its start until it has judged anything): a
  // choice finer than this is one the machine hasn't been seen to keep up with.
  get autoLevel(): PixelSize {
    return this.settled;
  }

  // A size coarser (`by` 1) or finer (-1) than what's drawn now, chosen for good.
  stepPixels(by: 1 | -1): void {
    const size = beside(PIXEL_SIZES, this.current, by);
    if (size !== undefined) this.setPixels(size);
  }

  canStepPixels(by: 1 | -1): boolean {
    return beside(PIXEL_SIZES, this.current, by) !== undefined;
  }

  // Auto takes up again where it had got to.
  setPixels(pixels: PixelSize | 'auto'): void {
    this.pixels = pixels;
    this.current = pixels === 'auto' ? this.settled : pixels;
    this.late = [];
    this.probing = false;
    this.retryMs = RETRY_MS;
    this.holdUntil = Infinity; // auto picks up again from the next frame (frame() sets it)
    keep(PIXELS_KEY, String(pixels));
  }

  // The frame rate a step up (`by` 1) or down (-1).
  stepFrameRate(by: 1 | -1): void {
    const rate = beside(FRAME_RATES, this.frameRate, by);
    if (rate === undefined) return;
    this.frameRate = rate;
    // A new rate is a new question: auto judges it afresh, free to try finer at once if it keeps up.
    this.late = [];
    this.probing = false;
    this.retryMs = RETRY_MS;
    this.probeAt = 0;
    this.holdUntil = Infinity;
    keep(FRAME_RATE_KEY, String(rate));
  }

  canStepFrameRate(by: 1 | -1): boolean {
    return beside(FRAME_RATES, this.frameRate, by) !== undefined;
  }

  // A frame drawn `interval` ms after the last, `late` when the machine held it past the tick it was
  // due on (Engine.run judges that). Auto judges the last WINDOW frames: a share of late ones steps
  // coarser, next to none for a while earns a try at finer, and a step finer that keeps up through a
  // whole window is kept and tries the next one at once.
  frame(now: number, interval: number, late: boolean): void {
    if (this.pixels !== 'auto') return;
    if (this.holdUntil === Infinity) this.holdUntil = now + SETTLE_MS;
    if (now < this.holdUntil || interval > PAUSE_MS) return;
    this.late.push(late);
    if (this.late.length > WINDOW) this.late.shift();
    if (this.late.length < WINDOW / 2) return;
    const share = this.late.filter(Boolean).length / this.late.length;
    const at = PIXEL_SIZES.indexOf(this.current);
    if (share > BACK_OFF && at < PIXEL_SIZES.length - 1) {
      // Falling behind: a step coarser. A step finer under trial failed, so the next try waits longer.
      if (this.probing) this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
      this.probing = false;
      this.probeAt = now + this.retryMs;
      this.step(at + 1, now);
    } else if (this.late.length < WINDOW) {
      return; // a whole window before a step finer is judged to hold
    } else if (share <= KEPT_UP && (this.probing || now >= this.probeAt) && this.current > FINEST) {
      if (this.probing) this.retryMs = RETRY_MS;
      this.probing = true;
      this.probeAt = Infinity;
      this.step(at - 1, now);
    } else if (this.probing) {
      // Held, but with little to spare or nothing finer to try: kept, and tried past again later.
      this.probing = false;
      this.retryMs = RETRY_MS;
      this.probeAt = now + PROBE_AFTER_MS;
    }
  }

  private step(to: number, now: number): void {
    this.current = this.settled = PIXEL_SIZES[to];
    this.late = [];
    this.holdUntil = now + SETTLE_MS;
  }
}

// The entry `by` places on from `at` in `list`, if there is one.
function beside<T>(list: readonly T[], at: T, by: 1 | -1): T | undefined {
  return list[list.indexOf(at) + by];
}

function isPixelSize(n: number): n is PixelSize {
  return (PIXEL_SIZES as readonly number[]).includes(n);
}

function isFrameRate(n: number): n is FrameRate {
  return (FRAME_RATES as readonly number[]).includes(n);
}

function keep(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not kept
  }
}
