// The dragon skins the client can draw, one per look of the asian-dragon class (sim/avatars.ts):
// the model each is drawn from (written by a script in scripts/, fetched once, the first time one is
// needed or at startup), what it rises out of the ground through, and the slow wave that runs down
// its body in the air, if any. A new skin is a row here and a row in AVATARS; the renderer
// (Dragon.ts) is the same for all of them.
import type { Vector3 } from '@babylonjs/core';
import type { AvatarsOf } from '@world/shared';
import type { Engine } from '../Engine';
import { Portal } from '../Portal';
import { Storm } from '../Storm';

export type DragonAvatarId = AvatarsOf<'asian-dragon'>;

// One skinned mesh of a model: vertices in millimetres (Int16 x, y, z), unit normals (Int8), texture
// coordinates (Uint16 over 0 to 1, v down the image), triangles (Uint16) and, per vertex, the two
// bones it follows (Uint8) and the first's share of it (Uint8 of 255); all base64.
export interface MeshData {
  readonly positions: string;
  readonly normals: string;
  readonly uvs: string;
  readonly indices: string;
  readonly bones: string;
  readonly split: string;
}

// A dragon's model, in its frame: metres, the eyes at the origin, x to its right. Bone 0 is at the
// eyes; a bone sits on the spine `along` metres behind them (the renderer puts it there on the
// spine the sim moves), or hangs on its `parent`, where `along` is null, at its rest pose; a parent
// comes before its children. `neck` is how many bones behind the head lie on the neck's curve
// rather than on the spine itself, so a turn of the head bends them evenly; `jaw` is the lower
// jaw's bone, hung on the head at its hinge with the head's axes, or null for a mouth that
// doesn't open. `frames` is each bone's rest pose in index order (its position, then its right, up
// and forward unit vectors), and `mouth` the lower jaw's tip, where the breath starts.
export interface DragonModel {
  readonly mouth: readonly number[];
  readonly neck: number;
  readonly jaw: number | null;
  readonly along: readonly (number | null)[];
  readonly parent: readonly (number | null)[];
  readonly frames: readonly number[];
  readonly head: MeshData; // round the head, hidden for its rider's view from the eyes
  readonly maw: MeshData | null; // the inside of the mouth, drawn only while the jaw is open
  readonly body: MeshData;
  // Per weak point of the sim's shape, in its order: the pieces that go when it shatters, the ring's
  // crown of spikes, the crystal in its hollow and the ice sealing the hollow over and under it
  // (drawn translucent, the crystal showing through).
  readonly weak: readonly { readonly crown: MeshData; readonly plate: MeshData; readonly ice: MeshData }[];
  // The wings: each a bone hung on its link's bone at the shoulder (`pivot`, in that bone's
  // frame), which the renderer flaps; `side` is 1 for a right wing and -1 for a left, `pair` which
  // pair down the body it belongs to, the first 0.
  readonly wings: readonly {
    readonly bone: number;
    readonly pivot: readonly number[];
    readonly side: 1 | -1;
    readonly pair: number;
  }[];
}

// What a dragon rises out of the ground through: `at` is over where the body comes out (its x and
// z), `ground` the floor there, and `open` whether any of the body is still down in it.
export interface Rise {
  update(at: Vector3, ground: number, open: boolean, dt: number): void;
  dispose(): void;
}

// The wave down a body in the air, running from the head to the tail: metres up and down at full
// size, metres of body per wavelength, seconds per wave, and metres behind the eyes by which it is
// at full size (none at the neck, so the head stays put). The spine's points ride it, so a body of
// rigid pieces tilts along it joint by joint and a skinned one bends.
export interface Wave {
  size: number;
  length: number;
  seconds: number;
  from: number;
}

export interface DragonLook {
  model(): Promise<DragonModel>;
  rise(engine: Engine, name: string): Rise;
  wave: Wave | null;
  glow: boolean; // the skin has a glow atlas (<id>-glow.png): what shines on it in the dark
  mouth: number; // metres across the mouth: the breath starts all along that line, not from a point
}

// A loader that fetches once and hands everyone the same promise.
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  return () => (loading ??= load());
}

export const DRAGONS: Record<DragonAvatarId, DragonLook> = {
  // The light dragon: a long serpent that comes up through a portal of gold light.
  'light-dragon': {
    model: once(() => import('./dragonModel').then((m) => m.DRAGON_MODEL)),
    rise: (engine, name) => new Portal(engine, name),
    wave: { size: 0.375, length: 13.1, seconds: 2.6, from: 7.5 },
    glow: false,
    mouth: 0.7,
  },
  // Colgera: rigid ring segments on a jointed spine, which a long slow wave flexes; it comes up
  // through a storm.
  colgera: {
    model: once(() => import('./colgeraModel').then((m) => m.COLGERA_MODEL)),
    rise: (engine, name) => new Storm(engine, name),
    wave: { size: 0.3, length: 14, seconds: 3.2, from: 4 },
    glow: true, // its eyes, the crystals and the veins through the ice
    mouth: 1.8, // between the mandibles
  },
};
