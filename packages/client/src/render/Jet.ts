// What a hold weapon sprays from its nozzle, by its element (ItemSpec.element): the flamethrower's
// blocks of fire (FlameJet.ts), or the ice blower's crystals, the "+"s of a corpse's poof (Poof.ts)
// flying out white and fading to blue. Cosmetic only; the server decides who burns or freezes. One
// per nozzle (viewmodel or avatar), running along its parent's +z.
import { Color4, Mesh, ParticleSystem, Vector3, type TransformNode } from '@babylonjs/core';
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

export function createJet(
  engine: Engine,
  name: string,
  parent: TransformNode,
  element: Element,
  length: number,
  halfAngle: number,
): Jet {
  return element === 'fire'
    ? new FlameJet(engine, name, parent, length, halfAngle)
    : new IceJet(engine, name, parent, length, halfAngle);
}

const COUNT = 16; // crystals in the air in a jet of BASE_LENGTH or shorter; longer ones get more
const FLIGHT_SECONDS = 0.35;
const BASE_LENGTH = 10;
const START_SIZE = 0.16; // metres across as a crystal leaves the nozzle
const GROWTH = 0.6; // metres it grows on the way out of a jet of BASE_LENGTH

// The crystals are one particle system, drawn in one call, kept in the nozzle's own space so the
// whole spray swings with the hand like the flame does. Off, it stops emitting and the last ones
// fly out.
class IceJet implements Jet {
  private readonly system: ParticleSystem;
  private on = false;

  constructor(engine: Engine, name: string, parent: TransformNode, length: number, halfAngle: number) {
    const scene = engine.scene;
    const stretch = Math.max(1, length / BASE_LENGTH);
    // The system follows a mesh: an empty one at the nozzle, whose disposal takes the system with it.
    const emitter = new Mesh(`${name}-ice`, scene);
    emitter.parent = parent;
    emitter.isPickable = false;
    const count = Math.ceil(COUNT * stretch);
    const ps = new ParticleSystem(`${name}-ice`, count + 4, scene);
    plusSprites(engine, ps, 2); // white and light grey, under the tint
    ps.emitter = emitter;
    ps.isLocal = true;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.applyFog = false;
    ps.updateSpeed = 1 / 60; // so lifetimes are seconds and powers metres per second
    const spread = Math.tan(halfAngle);
    ps.createBoxEmitter(
      new Vector3(-spread, -spread, 1),
      new Vector3(spread, spread, 1),
      Vector3.Zero(),
      Vector3.Zero(),
    );
    ps.minEmitPower = ps.maxEmitPower = length / FLIGHT_SECONDS;
    ps.minLifeTime = ps.maxLifeTime = FLIGHT_SECONDS;
    ps.emitRate = count / FLIGHT_SECONDS;
    ps.addSizeGradient(0, START_SIZE);
    ps.addSizeGradient(1, START_SIZE + GROWTH * stretch);
    // white at the nozzle, pale blue in the middle, blue and fading at the end
    ps.addColorGradient(0, new Color4(1, 1, 1, 1));
    ps.addColorGradient(0.5, new Color4(0.78, 0.92, 1, 0.9));
    ps.addColorGradient(1, new Color4(0.45, 0.72, 1, 0));
    this.system = ps;
  }

  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (on) this.system.start();
    else this.system.stop();
  }

  update(): void {} // the scene animates it

  dispose(): void {
    this.system.dispose();
  }
}
