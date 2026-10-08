// Sound effects: short recordings in public/assets/sounds, fetched in the background once the
// browser lets the page make sound (after the first click or key); one that hasn't arrived yet
// doesn't play. SOUNDS says what each one is, and ITEM_SOUNDS and GEAR_SOUNDS which item or gear
// makes which, so a new weapon is a row in each (the Records make the compiler ask). Other
// players' sounds are placed where they are and fade with distance (falloff); the local player's
// own play flat. Everything goes through one limiter, so a pile of
// shots at once gets squashed rather than clipping.
import type { GearId, ItemId, Vec3 } from '@world/shared';

export type SoundId =
  | 'gun'
  | 'sniper'
  | 'whiz-1'
  | 'whiz-2'
  | 'whiz-3'
  | 'flame'
  | 'jet'
  | 'step-1'
  | 'step-2'
  | 'step-3'
  | 'step-4'
  | 'jump'
  | 'land'
  | 'land-hard'
  | 'hurt';

interface SoundSpec {
  file: string; // in public/assets/sounds
  half: number; // metres from the listener where it's half as loud as up close (see falloff)
  reach?: number; // metres past which it's silent; only gunshots carry across the map
  volume: number; // up close
  loop?: boolean;
  intro?: string; // played once first, ending on the sample the loop starts on
  swell?: number; // seconds a loop takes to rise from silence to its volume (FADE if not given)
}

// Loops are WAV, cut on exact samples: MP3 pads both ends with silence, which would gap every repeat.
// Loudest to quietest up close: sniper, gun, the whizzes, flamethrower, jetpack, then the body's own
// sounds (landings, footsteps, the jump swoosh). The jet recording is denser than the flame's, so it
// needs the lower volume to come out quieter.
const SOUNDS: Record<SoundId, SoundSpec> = {
  gun: { file: 'gun.mp3', half: 10, volume: 0.35 },
  sniper: { file: 'sniper.mp3', half: 10, volume: 0.32 },
  'whiz-1': { file: 'whiz-1.mp3', half: 4, reach: 20, volume: 0.3 },
  'whiz-2': { file: 'whiz-2.mp3', half: 4, reach: 20, volume: 0.3 },
  'whiz-3': { file: 'whiz-3.mp3', half: 4, reach: 20, volume: 0.3 },
  flame: { file: 'flame.wav', intro: 'flame-start.wav', half: 4, reach: 25, volume: 0.12, loop: true },
  jet: { file: 'jet.wav', half: 4, reach: 25, volume: 0.06, loop: true, swell: 0.8 },
  'step-1': { file: 'step-1.mp3', half: 6, reach: 30, volume: 0.08 },
  'step-2': { file: 'step-2.mp3', half: 6, reach: 30, volume: 0.08 },
  'step-3': { file: 'step-3.mp3', half: 6, reach: 30, volume: 0.08 },
  'step-4': { file: 'step-4.mp3', half: 6, reach: 30, volume: 0.08 },
  jump: { file: 'jump.mp3', half: 6, reach: 30, volume: 0.05 },
  land: { file: 'land.mp3', half: 8, reach: 35, volume: 0.1 },
  'land-hard': { file: 'land-hard.mp3', half: 10, reach: 40, volume: 0.14 },
  hurt: { file: 'hurt.mp3', half: 6, reach: 30, volume: 0.3 }, // your own damage, and a corpse poofing
};

// What each item sounds like: a tap weapon's shot, one of `nearMiss` at random for a shot that
// passes within `within` metres of you without hitting (placed where it passed, so a far one is
// quieter), or a hold weapon's loop while it sprays.
export const ITEM_SOUNDS: Record<
  ItemId,
  { shot?: SoundId; nearMiss?: { within: number; sounds: SoundId[] }; firing?: SoundId }
> = {
  gun: { shot: 'gun' },
  sniper: { shot: 'sniper', nearMiss: { within: 20, sounds: ['whiz-1', 'whiz-2', 'whiz-3'] } },
  flamethrower: { firing: 'flame' },
};

export const GEAR_SOUNDS: Record<GearId, { thrusting?: SoundId }> = {
  jetpack: { thrusting: 'jet' },
};

// The loops a player is making this frame: their hold weapon spraying, their gear thrusting.
export function loopsOf(p: {
  item: ItemId | null;
  firing: boolean;
  gear: GearId | null;
  thrusting: boolean;
  dead: boolean;
}): SoundId[] {
  if (p.dead) return [];
  const firing = p.item && p.firing ? ITEM_SOUNDS[p.item].firing : undefined;
  const thrusting = p.gear && p.thrusting ? GEAR_SOUNDS[p.gear].thrusting : undefined;
  return [firing, thrusting].filter((s): s is SoundId => s !== undefined);
}

const FADE = 0.04; // seconds a loop takes to come in or go out, so it doesn't click
// Seconds a loop keeps going once it's no longer wanted. Another player's firing and thrusting
// drop out for a tick whenever their input arrives late, which would otherwise cut the loop and
// restart it (and the flamethrower's ignition) every time.
const LINGER = 0.25;
const SILENT = 0.002; // a one-shot falling off below this share of its volume isn't played
const SWEEP = 8; // metres either side of its nearest point that a whiz travels while it plays

interface Voice {
  gain: GainNode; // its volume, and its fades in and out
  near: GainNode; // how close it is (falloff)
  panner: PannerNode | null;
  stop: () => void;
  wanted: number; // when it was last asked for, in the audio clock
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null; // the limiter in front of the speakers
  private heard: Vec3 = { x: 0, y: 0, z: 0 }; // the listener
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loops = new Map<string, Voice>();

  constructor() {
    const unlock = () => {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.out = new DynamicsCompressorNode(this.ctx, {
          threshold: -12,
          knee: 6,
          ratio: 12,
          attack: 0.002,
          release: 0.15,
        });
        this.out.connect(this.ctx.destination);
        this.load(this.ctx);
      }
      void this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  // Where the listener is and which way they face (yaw 0 faces +z, like everything else).
  listen(pos: Vec3, yaw: number): void {
    if (!this.ctx) return;
    this.heard = pos;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    const [x, y, z] = audioSpace(pos);
    const [fx, , fz] = audioSpace({ x: Math.sin(yaw), y: 0, z: Math.cos(yaw) });
    // Firefox's listener has only the older setters, not these AudioParams.
    if (l.positionX === undefined) {
      l.setPosition(x, y, z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
      return;
    }
    l.positionX.setValueAtTime(x, t);
    l.positionY.setValueAtTime(y, t);
    l.positionZ.setValueAtTime(z, t);
    l.forwardX.setValueAtTime(fx, t);
    l.forwardY.setValueAtTime(0, t);
    l.forwardZ.setValueAtTime(fz, t);
  }

  // A one-shot, at a spot in the world, or with no spot, the local player's own. `delay` holds it
  // back (seconds); `along`, a direction, sweeps it past `at` that way while it plays; `level`
  // scales its volume.
  play(id: SoundId, at: Vec3 | null = null, o: { delay?: number; along?: Vec3; level?: number } = {}): void {
    const buffer = this.buffers.get(SOUNDS[id].file);
    if (!this.ctx || !buffer) return;
    if (at && falloff(distance(at, this.heard), SOUNDS[id]) < SILENT) return;
    const t = this.ctx.currentTime + (o.delay ?? 0);
    const voice = this.voice(id, at, o.level ?? 1);
    const src = new AudioBufferSourceNode(this.ctx, { buffer });
    src.connect(voice.gain);
    src.start(t);
    if (voice.panner && at && o.along) {
      const d = o.along;
      const from = { x: at.x - d.x * SWEEP, y: at.y - d.y * SWEEP, z: at.z - d.z * SWEEP };
      const to = { x: at.x + d.x * SWEEP, y: at.y + d.y * SWEEP, z: at.z + d.z * SWEEP };
      place(voice.panner, from, t);
      glide(voice.panner, to, t + buffer.duration);
    }
  }

  // The loops that should be sounding this frame, each keyed by who's making it, and where (null
  // for the local player's own). A loop that hasn't been listed for LINGER fades out.
  setLoops(wanted: { key: string; id: SoundId; at: Vec3 | null }[]): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const w of wanted) {
      const key = `${w.key}:${w.id}`;
      const voice = this.loops.get(key);
      if (voice) {
        voice.wanted = t;
        if (voice.panner && w.at) {
          place(voice.panner, w.at, t);
          voice.near.gain.setTargetAtTime(falloff(distance(w.at, this.heard), SOUNDS[w.id]), t, 0.05);
        }
        continue;
      }
      const started = this.startLoop(w.id, w.at);
      if (started) this.loops.set(key, started);
    }
    for (const [key, voice] of this.loops) {
      if (t - voice.wanted < LINGER) continue;
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, t);
      voice.gain.gain.linearRampToValueAtTime(0, t + FADE);
      setTimeout(voice.stop, FADE * 2000);
      this.loops.delete(key);
    }
  }

  // A loop fading in, after its intro if it has one; null until its file has arrived.
  private startLoop(id: SoundId, at: Vec3 | null): Voice | null {
    const ctx = this.ctx!;
    const spec = SOUNDS[id];
    const buffer = this.buffers.get(spec.file);
    if (!buffer) return null;
    const t = ctx.currentTime;
    const voice = this.voice(id, at, 0);
    voice.gain.gain.linearRampToValueAtTime(spec.volume, t + (spec.swell ?? FADE));
    const intro = spec.intro ? this.buffers.get(spec.intro) : undefined;
    const sources = [new AudioBufferSourceNode(ctx, { buffer, loop: true })];
    if (intro) sources.unshift(new AudioBufferSourceNode(ctx, { buffer: intro }));
    for (const src of sources) src.connect(voice.gain);
    sources[0].start(t);
    if (intro) sources[1].start(t + intro.duration);
    voice.stop = () => sources.forEach((src) => src.stop());
    return voice;
  }

  // A sound's gain (its volume, times `level`), then how near it is, then, when it has a place, a
  // panner that only sets left and right (falloff does the distance), into the limiter. Its
  // sources connect to the gain.
  private voice(id: SoundId, at: Vec3 | null, level: number): Voice {
    const ctx = this.ctx!;
    const spec = SOUNDS[id];
    const gain = new GainNode(ctx, { gain: spec.volume * level });
    const near = new GainNode(ctx, { gain: at ? falloff(distance(at, this.heard), spec) : 1 });
    gain.connect(near);
    let panner: PannerNode | null = null;
    if (at) {
      panner = new PannerNode(ctx, { panningModel: 'equalpower', rolloffFactor: 0 });
      place(panner, at, ctx.currentTime);
      near.connect(panner).connect(this.out!);
    } else {
      near.connect(this.out!);
    }
    return { gain, near, panner, stop: () => {}, wanted: ctx.currentTime };
  }

  // Every file, fetched and decoded in the background.
  private load(ctx: AudioContext): void {
    const files = new Set(Object.values(SOUNDS).flatMap((s) => (s.intro ? [s.file, s.intro] : [s.file])));
    for (const file of files)
      void fetch(`/assets/sounds/${file}`)
        .then((r) => r.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => this.buffers.set(file, buffer))
        .catch(() => {});
  }
}

// Web Audio is right-handed and the world is left-handed (Babylon's default), so z flips on the way
// in; without it left and right would swap.
function audioSpace(p: Vec3): [number, number, number] {
  return [p.x, p.y, -p.z];
}

// The share of a sound's volume left `d` metres away: nearly all of it close by, half at `half`,
// then falling with the square of the distance (a quarter as loud at twice as far), so a fight
// nearby is loud and one across the map is faint; and with a `reach`, tapering to nothing there.
function falloff(d: number, spec: SoundSpec): number {
  const taper = spec.reach === undefined ? 1 : Math.max(0, 1 - d / spec.reach);
  return taper / (1 + (d / spec.half) ** 2);
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function place(panner: PannerNode, at: Vec3, t: number): void {
  const [x, y, z] = audioSpace(at);
  panner.positionX.setValueAtTime(x, t);
  panner.positionY.setValueAtTime(y, t);
  panner.positionZ.setValueAtTime(z, t);
}

function glide(panner: PannerNode, to: Vec3, t: number): void {
  const [x, y, z] = audioSpace(to);
  panner.positionX.linearRampToValueAtTime(x, t);
  panner.positionY.linearRampToValueAtTime(y, t);
  panner.positionZ.linearRampToValueAtTime(z, t);
}
