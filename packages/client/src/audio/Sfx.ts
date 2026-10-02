// Sound effects: short recordings in public/assets/sounds, fetched in the background once the
// browser lets the page make sound (after the first click or key); one that hasn't arrived yet
// doesn't play. SOUNDS says what each one is, and ITEM_SOUNDS and GEAR_SOUNDS which item or gear
// makes which, so a new weapon is a row in each (the Records make the compiler ask). Other
// players' sounds are placed where they are and fade with distance, down to barely audible by
// `faint`; the local player's own play flat. Everything goes through one limiter, so a pile of
// shots at once gets squashed rather than clipping.
import type { GearId, ItemId, Vec3 } from '@world/shared';

export type SoundId = 'gun' | 'sniper' | 'whiz-1' | 'whiz-2' | 'whiz-3' | 'flame' | 'jet';

interface SoundSpec {
  file: string; // in public/assets/sounds
  faint: number; // metres from the listener where it's down to FAINT of its volume
  volume: number; // within NEAR of the listener
  loop?: boolean;
  intro?: string; // played once first, ending on the sample the loop starts on
  swell?: number; // seconds a loop takes to rise from silence to its volume (FADE if not given)
}

// Loops are WAV, cut on exact samples: MP3 pads both ends with silence, which would gap every repeat.
// Loudest to quietest up close: sniper, gun, the whizzes, jetpack, flamethrower.
const SOUNDS: Record<SoundId, SoundSpec> = {
  gun: { file: 'gun.mp3', faint: 200, volume: 0.35 },
  sniper: { file: 'sniper.mp3', faint: 200, volume: 0.45 },
  'whiz-1': { file: 'whiz-1.mp3', faint: 20, volume: 0.3 },
  'whiz-2': { file: 'whiz-2.mp3', faint: 20, volume: 0.3 },
  'whiz-3': { file: 'whiz-3.mp3', faint: 20, volume: 0.3 },
  flame: { file: 'flame.wav', intro: 'flame-start.wav', faint: 40, volume: 0.12, loop: true },
  jet: { file: 'jet.wav', faint: 60, volume: 0.11, loop: true, swell: 0.8 },
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
const NEAR = 2; // metres within which a sound plays at its full volume
const FAINT = 0.03; // the share of its volume a sound has left at its `faint` distance
const SWEEP = 8; // metres either side of its nearest point that a whiz travels while it plays

interface Voice {
  gain: GainNode;
  panner: PannerNode | null;
  stop: () => void;
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
    l.positionX.setValueAtTime(x, t);
    l.positionY.setValueAtTime(y, t);
    l.positionZ.setValueAtTime(z, t);
    const [fx, , fz] = audioSpace({ x: Math.sin(yaw), y: 0, z: Math.cos(yaw) });
    l.forwardX.setValueAtTime(fx, t);
    l.forwardY.setValueAtTime(0, t);
    l.forwardZ.setValueAtTime(fz, t);
  }

  // A one-shot, at a spot in the world, or with no spot, the local player's own. `delay` holds it
  // back (seconds); `along`, a direction, sweeps it past `at` that way while it plays.
  play(id: SoundId, at: Vec3 | null = null, o: { delay?: number; along?: Vec3 } = {}): void {
    const buffer = this.buffers.get(SOUNDS[id].file);
    if (!this.ctx || !buffer) return;
    if (at && distance(at, this.heard) > 2 * SOUNDS[id].faint) return; // not worth the nodes
    const t = this.ctx.currentTime + (o.delay ?? 0);
    const voice = this.voice(id, at, 1);
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
  // for the local player's own). Loops not listed fade out.
  setLoops(wanted: { key: string; id: SoundId; at: Vec3 | null }[]): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const keep = new Set<string>();
    for (const w of wanted) {
      const key = `${w.key}:${w.id}`;
      keep.add(key);
      const voice = this.loops.get(key);
      if (voice) {
        if (voice.panner && w.at) place(voice.panner, w.at, t);
        continue;
      }
      const started = this.startLoop(w.id, w.at);
      if (started) this.loops.set(key, started);
    }
    for (const [key, voice] of this.loops) {
      if (keep.has(key)) continue;
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

  // A sound's gain (its volume, times `level`), into a panner when it has a place, into the
  // speakers. Its sources connect to the gain.
  private voice(id: SoundId, at: Vec3 | null, level: number): Voice {
    const ctx = this.ctx!;
    const spec = SOUNDS[id];
    const gain = new GainNode(ctx, { gain: spec.volume * level });
    let panner: PannerNode | null = null;
    if (at) {
      // Inverse falloff, NEAR / (NEAR + rolloff * (d - NEAR)), with the rolloff that leaves FAINT
      // of the volume at `faint`.
      panner = new PannerNode(ctx, {
        panningModel: 'equalpower',
        distanceModel: 'inverse',
        refDistance: NEAR,
        maxDistance: 10000,
        rolloffFactor: (NEAR * (1 / FAINT - 1)) / (spec.faint - NEAR),
      });
      place(panner, at, ctx.currentTime);
      gain.connect(panner).connect(this.out!);
    } else {
      gain.connect(this.out!);
    }
    return { gain, panner, stop: () => {} };
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
