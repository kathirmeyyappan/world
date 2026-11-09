// What a hold weapon sprays from its nozzle, by its element (ItemSpec.element): the flamethrower's
// blocks of fire (FlameJet.ts), or the ice blower's crystals, the "+"s of a corpse's poof (Poof.ts)
// flying out white and fading to blue in a glowing mist. Cosmetic only; the server decides who
// burns or freezes. One per nozzle (viewmodel or avatar), running along its parent's +z.
import { Color4, DynamicTexture, Mesh, ParticleSystem, Texture, type TransformNode } from '@babylonjs/core';
import type { Element, ItemSpec } from '@world/shared';
import type { Engine } from './Engine';
import { FlameJet } from './FlameJet';
import { plusSprites } from './Poof';

export interface Jet {
  set(on: boolean): void; // spraying or not
  update(dt: number): void; // every frame
  dispose(): void;
}

// The half angle of the item's cone, for its jet.
export function coneAngle(spec: ItemSpec): number {
  return spec.fire.kind === 'cone' ? spec.fire.halfAngle : 0;
}

// How much of a jet to draw: `density` times the usual particles, `size` times their usual size,
// for a flame `core` how much they keep to the middle of the cone (a dragon's breath is thick),
// and `width` metres across the source: a nozzle is a point, a dragon's mouth a line across it
// (the parent's x), the cone opening from all along it.
export interface JetLook {
  density?: number;
  size?: number;
  core?: number;
  width?: number;
}

export function createJet(
  engine: Engine,
  name: string,
  parent: TransformNode,
  element: Element,
  length: number,
  halfAngle: number,
  look: JetLook = {},
): Jet {
  return element === 'fire'
    ? new FlameJet(engine, name, parent, length, halfAngle, look)
    : new IceJet(engine, name, parent, length, halfAngle, look);
}

const COUNT = 16; // crystals in the air in a jet of BASE_LENGTH or shorter; longer ones get more
const FLIGHT_SECONDS = 0.35;
const BASE_LENGTH = 10;
const START_SIZE = 0.16; // metres across as a crystal leaves the nozzle
const GROWTH = 0.6; // metres it grows on the way out of a jet of BASE_LENGTH
const MIST_START = 0.1; // the same for the puffs of mist round the crystals: small at the nozzle, which is right under the rider's eyes
const MIST_GROWTH = 1.2;
const MIST_PIXELS = 32; // across a puff's sprite, a soft disc

// The crystals and the mist are a particle system each, drawn in a call each, kept in the nozzle's
// own space so the whole spray swings with the hand like the flame does. Both add their light to
// what's behind them, so the spray glows. Off, they stop emitting and the last ones fly out.
class IceJet implements Jet {
  private readonly systems: ParticleSystem[];
  private on = false;

  constructor(
    engine: Engine,
    name: string,
    parent: TransformNode,
    length: number,
    halfAngle: number,
    { density = 1, size = 1, width = 0 }: JetLook = {},
  ) {
    const scene = engine.scene;
    const stretch = Math.max(1, length / BASE_LENGTH) * size;
    // The systems follow a mesh: an empty one at the nozzle, whose disposal takes them with it.
    const emitter = new Mesh(`${name}-ice`, scene);
    emitter.parent = parent;
    emitter.isPickable = false;
    const count = Math.ceil(COUNT * stretch * density);
    const spread = Math.tan(halfAngle);
    const system = (kind: string) => {
      const ps = new ParticleSystem(`${name}-ice-${kind}`, count + 4, scene);
      ps.emitter = emitter;
      ps.isLocal = true;
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.applyFog = false;
      ps.updateSpeed = 1 / 60; // so lifetimes are seconds and powers metres per second
      // Born along the source's line and sent out anywhere in the cone (a direction a metre out
      // along the axis and up to `spread` across it, evenly over the disc), in the nozzle's space.
      ps.startPositionFunction = (_world, position) => {
        position.set((Math.random() - 0.5) * width, 0, 0);
      };
      ps.startDirectionFunction = (_world, direction) => {
        const r = spread * Math.sqrt(Math.random());
        const a = Math.random() * 2 * Math.PI;
        direction.set(Math.cos(a) * r, Math.sin(a) * r, 1);
      };
      ps.minEmitPower = ps.maxEmitPower = length / FLIGHT_SECONDS;
      ps.minLifeTime = ps.maxLifeTime = FLIGHT_SECONDS;
      ps.emitRate = count / FLIGHT_SECONDS;
      return ps;
    };
    const crystals = system('crystals');
    plusSprites(engine, crystals, 2); // white and light grey, under the tint
    crystals.addSizeGradient(0, START_SIZE * size);
    crystals.addSizeGradient(1, START_SIZE * size + GROWTH * stretch);
    // white at the nozzle, sky blue in the middle, blue and fading at the end
    crystals.addColorGradient(0, new Color4(1, 1, 1, 1));
    crystals.addColorGradient(0.4, new Color4(0.6, 0.85, 1, 0.9));
    crystals.addColorGradient(1, new Color4(0.3, 0.6, 1, 0));
    const mist = system('mist');
    mist.particleTexture = mistSprite(engine);
    mist.addSizeGradient(0, MIST_START * size);
    mist.addSizeGradient(1, MIST_START * size + MIST_GROWTH * stretch);
    mist.addColorGradient(0, new Color4(0.85, 0.95, 1, 0.35));
    mist.addColorGradient(0.6, new Color4(0.55, 0.8, 1, 0.3));
    mist.addColorGradient(1, new Color4(0.3, 0.6, 1, 0));
    this.systems = [crystals, mist];
  }

  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    for (const ps of this.systems) {
      if (on) ps.start();
      else ps.stop();
    }
  }

  update(): void {} // the scene animates them

  dispose(): void {
    for (const ps of this.systems) ps.dispose();
  }
}

// A puff's sprite: a disc fading out to its edge, the system's own (disposed with it).
function mistSprite(engine: Engine): DynamicTexture {
  const tex = new DynamicTexture('iceMist', MIST_PIXELS, engine.scene, false, Texture.BILINEAR_SAMPLINGMODE);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const mid = MIST_PIXELS / 2;
  const fade = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  fade.addColorStop(0, 'rgba(255, 255, 255, 1)');
  fade.addColorStop(0.5, 'rgba(255, 255, 255, 0.35)');
  fade.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.clearRect(0, 0, MIST_PIXELS, MIST_PIXELS);
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, MIST_PIXELS, MIST_PIXELS);
  tex.update();
  return tex;
}
