// A puff of grey pixel "+"s scattering from a point: a corpse vanishing when its seat is dropped.
// One burst, gone in about half a second; the particle system disposes itself, texture and all.
import { Color4, DynamicTexture, ParticleSystem, Texture, Vector3 } from '@babylonjs/core';
import type { Engine } from './Engine';

const COUNT = 28;
const RADIUS = 0.5; // metres: roughly a body lying on its side
const PLUS_PIXELS = 5; // the "+" is drawn on a 5x5 grid and kept blocky

function plusTexture(engine: Engine): DynamicTexture {
  const tex = new DynamicTexture('poofTex', PLUS_PIXELS, engine.scene, false, Texture.NEAREST_SAMPLINGMODE);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const mid = Math.floor(PLUS_PIXELS / 2);
  ctx.clearRect(0, 0, PLUS_PIXELS, PLUS_PIXELS);
  ctx.fillStyle = '#fff';
  ctx.fillRect(mid, 0, 1, PLUS_PIXELS);
  ctx.fillRect(0, mid, PLUS_PIXELS, 1);
  tex.update();
  return tex;
}

export function poof(engine: Engine, at: Vector3): void {
  const ps = new ParticleSystem('poof', COUNT, engine.scene);
  ps.particleTexture = plusTexture(engine); // its own: disposeOnStop disposes the texture too
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.emitter = at.clone();
  ps.createSphereEmitter(RADIUS);
  // Each "+" gets its own size and grey (a random mix of the two colours), then fades out.
  ps.minSize = 0.12;
  ps.maxSize = 0.45;
  ps.color1 = new Color4(0.9, 0.9, 0.9, 1);
  ps.color2 = new Color4(0.35, 0.35, 0.38, 1);
  ps.colorDead = new Color4(0.5, 0.5, 0.5, 0);
  ps.minLifeTime = 0.25;
  ps.maxLifeTime = 0.55;
  ps.minEmitPower = 2;
  ps.maxEmitPower = 5;
  ps.addVelocityGradient(0, 1);
  ps.addVelocityGradient(1, 0.1); // a quick burst that settles, not a spray
  ps.gravity = new Vector3(0, 1.5, 0); // drifts up a little, like dust
  ps.manualEmitCount = COUNT;
  ps.targetStopDuration = 0.6;
  ps.disposeOnStop = true;
  ps.start();
}
