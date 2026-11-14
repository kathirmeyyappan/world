// Sound effects: short recordings in public/assets/sounds, fetched in the background once the
// browser lets the page make sound (after the first click or key), or, for a big one (`lazy`), the
// first time it's wanted; one that hasn't arrived yet doesn't play. SOUNDS says what each one is,
// and ITEM_SOUNDS, GEAR_SOUNDS and DRAGON_VOICES which item, gear or dragon makes which, so a
// new weapon is a row in each (the Records make the compiler ask). Other players' sounds are placed
// where they are and fade with distance (falloff); the local player's own play flat. Everything
// goes through one limiter, so a pile of shots at once gets squashed rather than clipping. Music and
// everything else come through a channel each, so either can be muted on its own, and the device
// keeps the choice.
import {
  isDragonAvatar,
  type AvatarId,
  type AvatarsOf,
  type GearId,
  type ItemAction,
  type ItemId,
  type Vec3,
} from '@world/shared';

export type Channel = 'music' | 'effects';

export type SoundId =
  | 'gun'
  | 'sniper'
  | 'whiz-1'
  | 'whiz-2'
  | 'whiz-3'
  | 'flame'
  | 'ice'
  | 'jet'
  | 'step-1'
  | 'step-2'
  | 'step-3'
  | 'step-4'
  | 'crunch-1'
  | 'crunch-2'
  | 'crunch-3'
  | 'crunch-4'
  | 'squeak-1'
  | 'squeak-2'
  | 'squeak-3'
  | 'squeak-4'
  | 'scuttle'
  | 'slime'
  | 'suction-1'
  | 'suction-2'
  | 'suction-3'
  | 'suction-4'
  | 'jump'
  | 'mario-jump'
  | 'mario-leap-1'
  | 'mario-leap-2'
  | 'luigi-leap-1'
  | 'luigi-leap-2'
  | 'mario-hurt-1'
  | 'mario-hurt-2'
  | 'mario-hurt-3'
  | 'luigi-hurt-1'
  | 'luigi-hurt-2'
  | 'luigi-kill-1'
  | 'luigi-kill-2'
  | 'mario-kill-1'
  | 'mario-kill-2'
  | 'mario-enter'
  | 'luigi-enter'
  | 'land'
  | 'land-hard'
  | 'hurt'
  | 'roar-1'
  | 'roar-2'
  | 'roar-3'
  | 'dragon-cry'
  | 'dragon-theme'
  | 'colgera-roar-1'
  | 'colgera-roar-2'
  | 'colgera-roar-3'
  | 'colgera-roar-far-1'
  | 'colgera-roar-far-2'
  | 'colgera-roar-far-3'
  | 'colgera-cry'
  | 'colgera-cry-far'
  | 'colgera-theme';

interface SoundSpec {
  file: string; // in public/assets/sounds
  half: number; // metres from the listener where it's half as loud as up close (see falloff)
  reach?: number; // metres past which it's silent; only gunshots carry across the map
  volume: number; // up close
  loop?: boolean;
  intro?: string; // played once first, ending on the sample the loop starts on
  swell?: number; // seconds it takes to rise from silence to its volume (a loop FADE, a one-shot ATTACK)
  fade?: number; // seconds a loop takes to go out once it's no longer wanted (FADE): music crosses over slowly
  lazy?: boolean; // fetched the first time it's wanted, not up front: a big one few will hear
  music?: boolean; // on the music channel, not the effects'
}

// Loops are WAV, cut on exact samples: MP3 pads both ends with silence, which would gap every repeat.
// Loudest to quietest up close: sniper, gun, the whizzes, flamethrower, ice blower, jetpack, then the body's own
// sounds (landings, footsteps, the jump swoosh), and quietest of all Gary's slime. The jet recording is denser
// than the flame's, so it needs the lower volume to come out quieter.
const SOUNDS: Record<SoundId, SoundSpec> = {
  gun: { file: 'gun.mp3', half: 10, volume: 0.35 },
  sniper: { file: 'sniper.mp3', half: 10, volume: 0.32 },
  'whiz-1': { file: 'whiz-1.mp3', half: 4, reach: 20, volume: 0.3 },
  'whiz-2': { file: 'whiz-2.mp3', half: 4, reach: 20, volume: 0.3 },
  'whiz-3': { file: 'whiz-3.mp3', half: 4, reach: 20, volume: 0.3 },
  flame: { file: 'flame.wav', intro: 'flame-start.wav', half: 4, reach: 25, volume: 0.12, loop: true },
  ice: { file: 'ice.wav', half: 4, reach: 25, volume: 0.1, loop: true },
  jet: { file: 'jet.wav', half: 4, reach: 25, volume: 0.06, loop: true, swell: 0.8 },
  'step-1': { file: 'step-1.mp3', half: 6, reach: 30, volume: 0.08 },
  'step-2': { file: 'step-2.mp3', half: 6, reach: 30, volume: 0.08 },
  'step-3': { file: 'step-3.mp3', half: 6, reach: 30, volume: 0.08 },
  'step-4': { file: 'step-4.mp3', half: 6, reach: 30, volume: 0.08 },
  'crunch-1': { file: 'crunch-1.wav', half: 6, reach: 30, volume: 0.07 }, // a step on sand (sim/surfaces.ts)
  'crunch-2': { file: 'crunch-2.wav', half: 6, reach: 30, volume: 0.07 },
  'crunch-3': { file: 'crunch-3.wav', half: 6, reach: 30, volume: 0.07 },
  'crunch-4': { file: 'crunch-4.wav', half: 6, reach: 30, volume: 0.07 },
  'squeak-1': { file: 'squeak-1.mp3', half: 6, reach: 30, volume: 0.08 },
  'squeak-2': { file: 'squeak-2.mp3', half: 6, reach: 30, volume: 0.08 },
  'squeak-3': { file: 'squeak-3.mp3', half: 6, reach: 30, volume: 0.08 },
  'squeak-4': { file: 'squeak-4.mp3', half: 6, reach: 30, volume: 0.08 },
  scuttle: { file: 'scuttle.wav', half: 6, reach: 30, volume: 0.07, loop: true },
  slime: { file: 'slime.wav', half: 3, reach: 15, volume: 0.02, loop: true }, // Gary sliding: barely there
  'suction-1': { file: 'suction-1.mp3', half: 6, reach: 30, volume: 0.06 },
  'suction-2': { file: 'suction-2.mp3', half: 6, reach: 30, volume: 0.06 },
  'suction-3': { file: 'suction-3.mp3', half: 6, reach: 30, volume: 0.06 },
  'suction-4': { file: 'suction-4.mp3', half: 6, reach: 30, volume: 0.06 },
  jump: { file: 'jump.mp3', half: 6, reach: 30, volume: 0.05 },
  // A character's own voice (voices.ts), over the body's sounds so it's heard as speech.
  'mario-jump': { file: 'mario-jump.mp3', half: 6, reach: 30, volume: 0.04 },
  'mario-leap-1': { file: 'mario-leap-1.mp3', half: 6, reach: 30, volume: 0.09 },
  'mario-leap-2': { file: 'mario-leap-2.mp3', half: 6, reach: 30, volume: 0.09 },
  'luigi-leap-1': { file: 'luigi-leap-1.mp3', half: 6, reach: 30, volume: 0.09 },
  'luigi-leap-2': { file: 'luigi-leap-2.mp3', half: 6, reach: 30, volume: 0.09 },
  'mario-hurt-1': { file: 'mario-hurt-1.mp3', half: 6, reach: 30, volume: 0.11 },
  'mario-hurt-2': { file: 'mario-hurt-2.mp3', half: 6, reach: 30, volume: 0.11 },
  'mario-hurt-3': { file: 'mario-hurt-3.mp3', half: 6, reach: 30, volume: 0.11 },
  'luigi-hurt-1': { file: 'luigi-hurt-1.mp3', half: 6, reach: 30, volume: 0.11 },
  'luigi-hurt-2': { file: 'luigi-hurt-2.mp3', half: 6, reach: 30, volume: 0.11 },
  'mario-kill-1': { file: 'mario-kill-1.mp3', half: 6, reach: 30, volume: 0.1 },
  'mario-kill-2': { file: 'mario-kill-2.mp3', half: 6, reach: 30, volume: 0.1 },
  'mario-enter': { file: 'mario-enter.mp3', half: 6, reach: 30, volume: 0.1 },
  'luigi-kill-1': { file: 'luigi-kill-1.mp3', half: 6, reach: 30, volume: 0.1 },
  'luigi-kill-2': { file: 'luigi-kill-2.mp3', half: 6, reach: 30, volume: 0.1 },
  'luigi-enter': { file: 'luigi-enter.mp3', half: 6, reach: 30, volume: 0.1 },
  land: { file: 'land.mp3', half: 8, reach: 35, volume: 0.1 },
  'land-hard': { file: 'land-hard.mp3', half: 10, reach: 40, volume: 0.14 },
  hurt: { file: 'hurt.mp3', half: 6, reach: 30, volume: 0.3 }, // your own damage, and a corpse poofing
  // A dragon's (the light dragon's own cries): its roars carry across the whole world, faint from
  // the far side, as does the cry it rises out of the ground with; its theme plays from its head,
  // soft a way off and gone before the far side (nothing in the world is 300 m from anything).
  'roar-1': { file: 'roar-1.mp3', half: 60, volume: 0.35 },
  'roar-2': { file: 'roar-2.mp3', half: 60, volume: 0.35 },
  'roar-3': { file: 'roar-3.mp3', half: 60, volume: 0.35 },
  'dragon-cry': { file: 'dragon-cry.mp3', half: 60, volume: 0.35, swell: 0.3 },
  'dragon-theme': {
    file: 'dragon-theme.mp3',
    half: 25,
    reach: 300,
    volume: 0.22,
    loop: true,
    swell: 2.5,
    fade: 2.5,
    lazy: true,
    music: true,
  },
  // Colgera's, from the game's own rip, each call in two takes: one up close, carrying like the light
  // dragon's, and one recorded from a way off, dull with the distance, played past FAR metres instead
  // (as loud there as the close one would have been, then falling off slower, the distance being in
  // the take). Its theme (the battle theme's last movement, cut to loop on itself after its lead-in)
  // falls off like the light dragon's, a little louder, the music being the bigger of the two.
  'colgera-roar-1': { file: 'colgera-roar-1.mp3', half: 60, volume: 0.35 },
  'colgera-roar-2': { file: 'colgera-roar-2.mp3', half: 60, volume: 0.35 },
  'colgera-roar-3': { file: 'colgera-roar-3.mp3', half: 60, volume: 0.35 },
  'colgera-roar-far-1': { file: 'colgera-roar-far-1.mp3', half: 120, volume: 0.26 },
  'colgera-roar-far-2': { file: 'colgera-roar-far-2.mp3', half: 120, volume: 0.26 },
  'colgera-roar-far-3': { file: 'colgera-roar-far-3.mp3', half: 120, volume: 0.26 },
  'colgera-cry': { file: 'colgera-cry.mp3', half: 60, volume: 0.35, swell: 0.3 },
  'colgera-cry-far': { file: 'colgera-cry-far.mp3', half: 120, volume: 0.26, swell: 0.3 },
  'colgera-theme': {
    file: 'colgera-theme.mp3',
    intro: 'colgera-theme-start.mp3',
    half: 25,
    reach: 300,
    volume: 0.26,
    loop: true,
    swell: 2.5,
    fade: 2.5,
    lazy: true,
    music: true,
  },
};

// Metres from a call past which its far take, if it has one, is the one played.
export const FAR = 45;

// The share of a sound's volume left `metres` from it (falloff): what a loop played flat, with no
// place, is given as its `level` to sound as if from there.
export function heard(id: SoundId, metres: number): number {
  return falloff(metres, SOUNDS[id]);
}

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
  'ice-blower': { firing: 'ice' },
  firebreath: { firing: 'flame' },
  frostbreath: { firing: 'ice' },
};

export const GEAR_SOUNDS: Record<GearId, { thrusting?: SoundId }> = {
  jetpack: { thrusting: 'jet' },
};

// A call: the take heard up close and, where there is one, the take heard from FAR metres off.
export interface Call {
  near: SoundId;
  far?: SoundId;
}

// What a dragon skin sounds like (render/avatars/dragons.ts lists the skins): its roars by action,
// the cry it rises out of the ground with, and the theme that plays from its head; null for a
// skin with no voice yet.
export interface DragonVoice {
  roars: Partial<Record<ItemAction, Call>>;
  cry: Call;
  theme: SoundId;
}
export const DRAGON_VOICES: Record<AvatarsOf<'asian-dragon'>, DragonVoice | null> = {
  'light-dragon': {
    roars: { 'roar-1': { near: 'roar-1' }, 'roar-2': { near: 'roar-2' }, 'roar-3': { near: 'roar-3' } },
    cry: { near: 'dragon-cry' },
    theme: 'dragon-theme',
  },
  colgera: {
    roars: {
      'roar-1': { near: 'colgera-roar-1', far: 'colgera-roar-far-1' },
      'roar-2': { near: 'colgera-roar-2', far: 'colgera-roar-far-2' },
      'roar-3': { near: 'colgera-roar-3', far: 'colgera-roar-far-3' },
    },
    cry: { near: 'colgera-cry', far: 'colgera-cry-far' },
    theme: 'colgera-theme',
  },
};

// The voice of whoever wears `avatar`, if it has one.
export function voiceOf(avatar: AvatarId): DragonVoice | null {
  return isDragonAvatar(avatar) ? DRAGON_VOICES[avatar] : null;
}

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
// Seconds a one-shot takes to come in: enough for the limiter to catch a loud one's first wave
// rather than letting it through hot, too short to hear as a fade.
const ATTACK = 0.005;
// Seconds a loop keeps going once it's no longer wanted. Another player's firing and thrusting
// drop out for a tick whenever their input arrives late, which would otherwise cut the loop and
// restart it (and the flamethrower's ignition) every time.
const LINGER = 0.25;
const SILENT = 0.002; // a one-shot falling off below this share of its volume isn't played
const SWEEP = 8; // metres either side of its nearest point that a whiz travels while it plays
const MUTED_KEY = 'world.muted'; // localStorage: the channels muted on this device, as a JSON list

interface Voice {
  gain: GainNode; // its volume, and its fades in and out
  near: GainNode; // how close it is (falloff)
  panner: PannerNode | null;
  stop: () => void;
  wanted: number; // when it was last asked for, in the audio clock
  fade: number; // seconds it takes to go out
}

export class Sfx {
  private ctx: AudioContext | null = null;
  // Each into the limiter in front of the speakers; silent while muted.
  private channels: Record<Channel, GainNode> | null = null;
  private readonly muted = loadMuted();
  private heard: Vec3 = { x: 0, y: 0, z: 0 }; // the listener
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly fetched = new Set<string>();
  private readonly loops = new Map<string, Voice>();

  constructor() {
    const unlock = () => {
      if (!this.ctx) {
        const ctx = new AudioContext();
        this.ctx = ctx;
        const limiter = new DynamicsCompressorNode(ctx, {
          threshold: -12,
          knee: 6,
          ratio: 12,
          attack: 0.002,
          release: 0.15,
        });
        limiter.connect(ctx.destination);
        const channel = (c: Channel) => {
          const node = new GainNode(ctx, { gain: this.muted.has(c) ? 0 : 1 });
          node.connect(limiter);
          return node;
        };
        this.channels = { music: channel('music'), effects: channel('effects') };
        this.load(ctx);
      }
      void this.ctx.resume();
    };
    // A finger going down isn't a gesture the browser lets start sound on a touchscreen; the end of
    // a tap is. Captured, so a handler that stops one from bubbling can't keep it from here.
    for (const event of ['pointerdown', 'pointerup', 'touchend', 'keydown'])
      window.addEventListener(event, unlock, { capture: true });
  }

  isMuted(channel: Channel): boolean {
    return this.muted.has(channel);
  }

  setMuted(channel: Channel, muted: boolean): void {
    if (muted) this.muted.add(channel);
    else this.muted.delete(channel);
    try {
      localStorage.setItem(MUTED_KEY, JSON.stringify([...this.muted]));
    } catch {
      // Storage blocked: muted for this page only.
    }
    const node = this.channels?.[channel];
    if (!node || !this.ctx) return;
    const t = this.ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(node.gain.value, t);
    node.gain.linearRampToValueAtTime(muted ? 0 : 1, t + FADE);
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
  // scales its volume; `rate` its speed and pitch together (2 is an octave up and half as long).
  // False if it couldn't play yet: no sound until the page is clicked, or the recording still on
  // its way.
  play(
    id: SoundId,
    at: Vec3 | null = null,
    o: { delay?: number; along?: Vec3; level?: number; rate?: number } = {},
  ): boolean {
    const buffer = this.buffer(id);
    if (!this.ctx || !buffer) return false;
    if (at && falloff(distance(at, this.heard), SOUNDS[id]) < SILENT) return true;
    const t = this.ctx.currentTime + (o.delay ?? 0);
    const spec = SOUNDS[id];
    const voice = this.voice(id, at, 0);
    voice.gain.gain.setValueAtTime(0, t);
    voice.gain.gain.linearRampToValueAtTime(spec.volume * (o.level ?? 1), t + (spec.swell ?? ATTACK));
    const src = new AudioBufferSourceNode(this.ctx, { buffer, playbackRate: o.rate ?? 1 });
    src.connect(voice.gain);
    src.start(t);
    if (voice.panner && at && o.along) {
      const d = o.along;
      const from = { x: at.x - d.x * SWEEP, y: at.y - d.y * SWEEP, z: at.z - d.z * SWEEP };
      const to = { x: at.x + d.x * SWEEP, y: at.y + d.y * SWEEP, z: at.z + d.z * SWEEP };
      place(voice.panner, from, t);
      glide(voice.panner, to, t + buffer.duration / (o.rate ?? 1));
    }
    return true;
  }

  // A call from `at`: its far take, when it has one and `at` is past FAR metres off, else its near.
  call(call: Call, at: Vec3, o: { delay?: number; level?: number } = {}): boolean {
    const far = call.far !== undefined && distance(at, this.heard) > FAR;
    return this.play(far ? call.far! : call.near, at, o);
  }

  // The loops that should be sounding this frame, each keyed by who's making it, and where (null
  // for the local player's own, played flat at `level` of its volume). A loop that hasn't been
  // listed for LINGER fades out, over its `fade`. `elapsed` is how far into it a loop already is
  // when it starts: a theme that has been running since its dragon rose, heard again from where it
  // has got to rather than from the top.
  setLoops(wanted: { key: string; id: SoundId; at: Vec3 | null; elapsed?: number; level?: number }[]): void {
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
      const started = this.startLoop(w.id, w.at, w.elapsed ?? 0, w.level ?? 1);
      if (started) this.loops.set(key, started);
    }
    for (const [key, voice] of this.loops) {
      if (t - voice.wanted < LINGER) continue;
      voice.gain.gain.cancelScheduledValues(t);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, t);
      voice.gain.gain.linearRampToValueAtTime(0, t + voice.fade);
      setTimeout(voice.stop, voice.fade * 1000 + 100);
      this.loops.delete(key);
    }
  }

  // A loop fading in to `level` of its volume, `elapsed` seconds along: in its intro, if it has
  // one, or round its body as many times as that takes; null until its files have arrived.
  private startLoop(id: SoundId, at: Vec3 | null, elapsed: number, level: number): Voice | null {
    const ctx = this.ctx!;
    const spec = SOUNDS[id];
    const buffer = this.buffer(id);
    const intro = spec.intro ? this.buffers.get(spec.intro) : undefined;
    if (!buffer || (spec.intro && !intro)) return null;
    const t = ctx.currentTime;
    const voice = this.voice(id, at, 0);
    voice.gain.gain.linearRampToValueAtTime(spec.volume * level, t + (spec.swell ?? FADE));
    const sources: AudioBufferSourceNode[] = [];
    const loop = new AudioBufferSourceNode(ctx, { buffer, loop: true });
    const lead = intro?.duration ?? 0;
    if (intro && elapsed < lead) {
      const lead = new AudioBufferSourceNode(ctx, { buffer: intro });
      lead.connect(voice.gain);
      lead.start(t, elapsed);
      sources.push(lead);
    }
    loop.connect(voice.gain);
    if (elapsed < lead) loop.start(t + lead - elapsed);
    else loop.start(t, (elapsed - lead) % buffer.duration);
    sources.push(loop);
    voice.stop = () => sources.forEach((src) => src.stop());
    return voice;
  }

  // A sound's gain (its volume, times `level`), then how near it is, then, when it has a place, a
  // panner that only sets left and right (falloff does the distance), into its channel. Its
  // sources connect to the gain.
  private voice(id: SoundId, at: Vec3 | null, level: number): Voice {
    const ctx = this.ctx!;
    const spec = SOUNDS[id];
    const gain = new GainNode(ctx, { gain: spec.volume * level });
    const near = new GainNode(ctx, { gain: at ? falloff(distance(at, this.heard), spec) : 1 });
    gain.connect(near);
    const channel = this.channels![spec.music ? 'music' : 'effects'];
    let panner: PannerNode | null = null;
    if (at) {
      panner = new PannerNode(ctx, { panningModel: 'equalpower', rolloffFactor: 0 });
      place(panner, at, ctx.currentTime);
      near.connect(panner).connect(channel);
    } else {
      near.connect(channel);
    }
    return { gain, near, panner, stop: () => {}, wanted: ctx.currentTime, fade: spec.fade ?? FADE };
  }

  // A sound's recording, if it has arrived; a lazy one (and its intro) is sent for the first time
  // it's asked for.
  private buffer(id: SoundId): AudioBuffer | undefined {
    const spec = SOUNDS[id];
    if (spec.lazy && this.ctx) {
      this.fetch(this.ctx, spec.file);
      if (spec.intro) this.fetch(this.ctx, spec.intro);
    }
    return this.buffers.get(spec.file);
  }

  // Every file but the lazy ones, fetched and decoded in the background.
  private load(ctx: AudioContext): void {
    for (const spec of Object.values(SOUNDS)) {
      if (spec.lazy) continue;
      this.fetch(ctx, spec.file);
      if (spec.intro) this.fetch(ctx, spec.intro);
    }
  }

  private fetch(ctx: AudioContext, file: string): void {
    if (this.fetched.has(file)) return;
    this.fetched.add(file);
    void fetch(`/assets/sounds/${file}`)
      .then((r) => r.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => this.buffers.set(file, buffer))
      .catch(() => {});
  }
}

function loadMuted(): Set<Channel> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(MUTED_KEY) ?? '[]');
    const channels: Channel[] = ['music', 'effects'];
    return new Set(Array.isArray(saved) ? channels.filter((c) => saved.includes(c)) : []);
  } catch {
    return new Set();
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
