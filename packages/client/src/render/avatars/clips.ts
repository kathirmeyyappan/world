// Animation clips for a jointed body (Jointed.ts): frames of where its hips are and how each of its
// bones is turned, made by scripts/jointed-clips.py, and the little it takes to play them. A clip is
// sampled at a frame (between two, their turns are mixed) into a Motion, and two motions blend into
// one, so a body eases from standing into its run or from its jump into its fall by blending what
// each clip says. Nothing here works a pose out: every pose a body strikes was drawn by an animator.
import { bytes } from './skinned';

// The bones a clip turns, in the order its frames list them (scripts/jointed-clips.py BONES).
export const CLIP_BONES = [
  'hips',
  'spine',
  'chest',
  'head',
  'armL',
  'forearmL',
  'handL',
  'armR',
  'forearmR',
  'handR',
  'legL',
  'shinL',
  'footL',
  'legR',
  'shinR',
  'footR',
] as const;
export type ClipBone = (typeof CLIP_BONES)[number];
export const LEGS = CLIP_BONES.indexOf('legL'); // the first of the six leg bones, which are the last in a frame

const HIPS = 3; // numbers a frame gives the hips: x, y, z from standing straight, in leg lengths
const TURN = 4; // and each bone: a quaternion, x, y, z, w
const SIZE = HIPS + CLIP_BONES.length * TURN;

// One moment of a body: its hips, then each bone's turn in its parent, as a clip's frame has them.
export type Motion = Float32Array;

export function motion(): Motion {
  const m = new Float32Array(SIZE);
  for (let b = 0; b < CLIP_BONES.length; b++) m[HIPS + b * TURN + 3] = 1;
  return m;
}

// A clip as the generated file holds it.
export interface RawClip {
  readonly fps: number;
  readonly frames: number;
  readonly hips: string;
  readonly turns: string;
}

export interface Clip {
  fps: number;
  frames: number;
  seconds: number;
  data: Float32Array; // its frames, each a Motion, end to end
}

const decoded = new Map<RawClip, Clip>();

// A clip's frames, decoded once a page.
export function clip(raw: RawClip): Clip {
  let made = decoded.get(raw);
  if (made) return made;
  const hips = new Int16Array(bytes(raw.hips).buffer);
  const turns = new Int16Array(bytes(raw.turns).buffer);
  const data = new Float32Array(raw.frames * SIZE);
  for (let f = 0; f < raw.frames; f++) {
    for (let i = 0; i < HIPS; i++) data[f * SIZE + i] = hips[f * HIPS + i] / 1000;
    for (let i = 0; i < SIZE - HIPS; i++) data[f * SIZE + HIPS + i] = turns[f * (SIZE - HIPS) + i] / 32767;
  }
  made = { fps: raw.fps, frames: raw.frames, seconds: raw.frames / raw.fps, data };
  decoded.set(raw, made);
  return made;
}

// A clip `at` of the way through it (0 to 1), into `out`: a clip that loops runs round from its
// last frame into its first, one that doesn't holds its last.
export function sample(out: Motion, c: Clip, at: number, loops: boolean): void {
  const frame = loops ? (((at % 1) + 1) % 1) * c.frames : Math.min(1, Math.max(0, at)) * (c.frames - 1);
  const k = Math.floor(frame);
  const a = (k % c.frames) * SIZE;
  const b = (loops ? (k + 1) % c.frames : Math.min(c.frames - 1, k + 1)) * SIZE;
  mixed(out, c.data, a, c.data, b, frame - k, 0);
}

// `a` on the way to `b`, `t` of the way, into `out` (which may be either); with `from`, only the
// bones from that one on, the rest left as `out` has them (a body's legs alone).
export function blend(out: Motion, a: Motion, b: Motion, t: number, from = 0): void {
  if (from > 0 && out !== a) out.set(a);
  mixed(out, a, 0, b, 0, t, from);
}

// Hips straight between the two; each turn between its two the short way round, to unit length
// (close enough to the arc between turns a frame or a blend apart).
function mixed(out: Motion, a: Float32Array, ai: number, b: Float32Array, bi: number, t: number, from: number): void {
  if (from === 0) for (let i = 0; i < HIPS; i++) out[i] = a[ai + i] + (b[bi + i] - a[ai + i]) * t;
  for (let bone = from; bone < CLIP_BONES.length; bone++) {
    const o = HIPS + bone * TURN;
    const ax = a[ai + o];
    const ay = a[ai + o + 1];
    const az = a[ai + o + 2];
    const aw = a[ai + o + 3];
    let bx = b[bi + o];
    let by = b[bi + o + 1];
    let bz = b[bi + o + 2];
    let bw = b[bi + o + 3];
    if (ax * bx + ay * by + az * bz + aw * bw < 0) {
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
    }
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const z = az + (bz - az) * t;
    const w = aw + (bw - aw) * t;
    const n = 1 / Math.hypot(x, y, z, w);
    out[o] = x * n;
    out[o + 1] = y * n;
    out[o + 2] = z * n;
    out[o + 3] = w * n;
  }
}

// Where a bone's turn starts in a Motion.
export function turnAt(bone: number): number {
  return HIPS + bone * TURN;
}
