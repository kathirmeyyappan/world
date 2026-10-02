// Sound effects, synthesized with Web Audio (no files): short noise bursts and low thumps, in
// keeping with the pixel look. Each sound is a row in SOUNDS, and ITEM_SOUNDS and GEAR_SOUNDS
// say which one an item or gear makes, so a new weapon is a row in each (the Records make the
// compiler ask). Other players' sounds are placed where they are and fade out by `range`; the
// local player's own play flat. Browsers only start audio after a click or key, so nothing
// plays until then.
import type { GearId, ItemId, Vec3 } from '@world/shared';

export type SoundId = 'gun' | 'sniper' | 'whiz' | 'flame' | 'jet';

interface SoundSpec {
  range: number; // metres from the listener where it has faded to silence
  volume: number;
  // Builds the sound into `out` from now. One-shots end on their own; loops run until the
  // returned stop is called.
  start(ctx: AudioContext, out: AudioNode): () => void;
}

// What each item sounds like: a tap weapon's shot (and the whiz of one that just misses you),
// or a hold weapon's loop while it sprays.
export const ITEM_SOUNDS: Record<ItemId, { shot?: SoundId; nearMiss?: SoundId; firing?: SoundId }> = {
  gun: { shot: 'gun' },
  sniper: { shot: 'sniper', nearMiss: 'whiz' },
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

const SOUNDS: Record<SoundId, SoundSpec> = {
  // A dry crack over a short thump.
  gun: {
    range: 70,
    volume: 0.5,
    start(ctx, out) {
      burst(ctx, out, { type: 'lowpass', from: 3500, to: 1200, decay: 0.12 });
      thump(ctx, out, { from: 160, to: 45, decay: 0.1, level: 0.8 });
      return () => {};
    },
  },
  // Louder and longer: a bright crack that darkens, and a deep boom under it.
  sniper: {
    range: 300,
    volume: 0.5,
    start(ctx, out) {
      burst(ctx, out, { type: 'lowpass', from: 6000, to: 600, decay: 0.45 });
      thump(ctx, out, { from: 95, to: 28, decay: 0.4, level: 0.7 });
      return () => {};
    },
  },
  // A round going past your head: a narrow hiss that drops in pitch as it passes.
  whiz: {
    range: 20,
    volume: 0.7,
    start(ctx, out) {
      const t = ctx.currentTime;
      const filter = new BiquadFilterNode(ctx, { type: 'bandpass', Q: 6, frequency: 5000 });
      filter.frequency.exponentialRampToValueAtTime(900, t + 0.3);
      const gain = new GainNode(ctx, { gain: 0 });
      gain.gain.linearRampToValueAtTime(3, t + 0.1); // the narrow band lets little through
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      noiseSource(ctx, false).connect(filter).connect(gain).connect(out);
      return () => {};
    },
  },
  // A soft roar that flickers.
  flame: {
    range: 40,
    volume: 0.35,
    start(ctx, out) {
      const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 900 });
      const flicker = new GainNode(ctx, { gain: 0.8 });
      const lfo = new OscillatorNode(ctx, { frequency: 9 });
      const depth = new GainNode(ctx, { gain: 0.2 });
      lfo.connect(depth).connect(flicker.gain);
      const src = noiseSource(ctx, true);
      src.connect(filter).connect(flicker).connect(out);
      lfo.start();
      return () => {
        src.stop();
        lfo.stop();
      };
    },
  },
  // A low rumble: dark noise over a buzzing drone.
  jet: {
    range: 50,
    volume: 0.4,
    start(ctx, out) {
      const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 450 });
      const src = noiseSource(ctx, true);
      src.connect(filter).connect(out);
      const drone = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 48 });
      const droneTone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 220 });
      const droneLevel = new GainNode(ctx, { gain: 0.3 });
      drone.connect(droneTone).connect(droneLevel).connect(out);
      drone.start();
      return () => {
        src.stop();
        drone.stop();
      };
    },
  },
};

const FADE = 0.04; // seconds a loop takes to come in or go out, so it doesn't click

interface Voice {
  gain: GainNode;
  panner: PannerNode | null;
  stop: () => void;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private readonly loops = new Map<string, Voice>();

  constructor() {
    const unlock = () => {
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  // Where the listener is and which way they face (yaw 0 faces +z, like everything else).
  listen(pos: Vec3, yaw: number): void {
    if (!this.ctx) return;
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

  // A one-shot, at a spot in the world, or with no spot, the local player's own.
  play(id: SoundId, at: Vec3 | null = null): void {
    if (!this.ctx) return;
    this.voice(id, at, 1);
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
      let voice = this.loops.get(key);
      if (!voice) {
        voice = this.voice(w.id, w.at, 0);
        voice.gain.gain.linearRampToValueAtTime(SOUNDS[w.id].volume, t + FADE);
        this.loops.set(key, voice);
      } else if (voice.panner && w.at) place(voice.panner, w.at, t);
    }
    for (const [key, voice] of this.loops) {
      if (keep.has(key)) continue;
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, t);
      voice.gain.gain.linearRampToValueAtTime(0, t + FADE);
      setTimeout(voice.stop, FADE * 2000);
      this.loops.delete(key);
    }
  }

  // A sound's graph: its source into a gain (its volume, times `level`), into a panner when it
  // has a place, into the speakers.
  private voice(id: SoundId, at: Vec3 | null, level: number): Voice {
    const ctx = this.ctx!;
    const spec = SOUNDS[id];
    const gain = new GainNode(ctx, { gain: spec.volume * level });
    let panner: PannerNode | null = null;
    if (at) {
      panner = new PannerNode(ctx, {
        panningModel: 'equalpower',
        distanceModel: 'linear',
        refDistance: 2,
        maxDistance: spec.range,
        rolloffFactor: 1,
      });
      place(panner, at, ctx.currentTime);
      gain.connect(panner).connect(ctx.destination);
    } else {
      gain.connect(ctx.destination);
    }
    return { gain, panner, stop: spec.start(ctx, gain) };
  }
}

// Web Audio is right-handed and the world is left-handed (Babylon's default), so z flips on the way
// in; without it left and right would swap.
function audioSpace(p: Vec3): [number, number, number] {
  return [p.x, p.y, -p.z];
}

function place(panner: PannerNode, at: Vec3, t: number): void {
  const [x, y, z] = audioSpace(at);
  panner.positionX.setValueAtTime(x, t);
  panner.positionY.setValueAtTime(y, t);
  panner.positionZ.setValueAtTime(z, t);
}

// One second of white noise per context, shared by every sound that hisses.
const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>();
function noiseSource(ctx: AudioContext, loop: boolean): AudioBufferSourceNode {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = new AudioBuffer({ length: ctx.sampleRate, sampleRate: ctx.sampleRate });
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  const src = new AudioBufferSourceNode(ctx, { buffer, loop });
  src.start();
  return src;
}

// Noise through a filter that sweeps from `from` to `to` Hz while it dies away over `decay` s.
function burst(
  ctx: AudioContext,
  out: AudioNode,
  o: { type: BiquadFilterType; from: number; to: number; decay: number },
): void {
  const t = ctx.currentTime;
  const filter = new BiquadFilterNode(ctx, { type: o.type, frequency: o.from });
  filter.frequency.exponentialRampToValueAtTime(o.to, t + o.decay);
  const gain = new GainNode(ctx, { gain: 1 });
  gain.gain.exponentialRampToValueAtTime(0.001, t + o.decay);
  const src = noiseSource(ctx, false);
  src.connect(filter).connect(gain).connect(out);
  src.stop(t + o.decay);
}

// A sine that drops from `from` to `to` Hz as it dies away: the body under a crack.
function thump(ctx: AudioContext, out: AudioNode, o: { from: number; to: number; decay: number; level: number }): void {
  const t = ctx.currentTime;
  const osc = new OscillatorNode(ctx, { frequency: o.from });
  osc.frequency.exponentialRampToValueAtTime(o.to, t + o.decay);
  const gain = new GainNode(ctx, { gain: o.level });
  gain.gain.exponentialRampToValueAtTime(0.001, t + o.decay);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + o.decay);
}
