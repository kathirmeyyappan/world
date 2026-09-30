// A puff of chunky pixel "+"s scattering from a point: a corpse vanishing when its seat is dropped.
// Retro on purpose: every "+" is a sprite from a tiny sheet (two sizes, three greys), drawn
// with nearest sampling, never fades, and blinks out at the end of its own short life.
// One burst, gone in well under a second; the particle system disposes itself, texture and all.
import { Color4, DynamicTexture, ParticleSystem, Texture, Vector3 } from '@babylonjs/core';
import type { Engine } from './Engine';

const COUNT = 36;
const RADIUS = 0.4; // metres: roughly a body lying on its side
const CELL = 8; // sprite cell, in texture pixels
const QUAD = 0.24; // metres per cell: the big "+" is this wide, the small one three quarters of it
const SPANS = [6, 8]; // "+" widths in pixels, one column each; arms are always 2 px thick
const GREYS = ['#f2f2f2', '#a8a8ac', '#5e5e64']; // one row each

// The sheet: a column per size, a row per grey.
function plusSheet(engine: Engine): DynamicTexture {
  const size = { width: CELL * SPANS.length, height: CELL * GREYS.length };
  const tex = new DynamicTexture('poofTex', size, engine.scene, false, Texture.NEAREST_SAMPLINGMODE);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size.width, size.height);
  GREYS.forEach((grey, row) => {
    ctx.fillStyle = grey;
    SPANS.forEach((span, col) => {
      const x = col * CELL + (CELL - span) / 2;
      const y = row * CELL + (CELL - span) / 2;
      const mid = CELL / 2 - 1;
      ctx.fillRect(x, row * CELL + mid, span, 2);
      ctx.fillRect(col * CELL + mid, y, 2, span);
    });
  });
  tex.update();
  return tex;
}

export function poof(engine: Engine, at: Vector3): void {
  const ps = new ParticleSystem('poof', COUNT, engine.scene);
  ps.particleTexture = plusSheet(engine); // its own: disposeOnStop disposes the texture too
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.isAnimationSheetEnabled = true;
  ps.spriteCellWidth = CELL;
  ps.spriteCellHeight = CELL;
  ps.startSpriteCellID = 0;
  ps.endSpriteCellID = SPANS.length * GREYS.length - 1;
  ps.spriteRandomStartCell = true; // each "+" picks a size and grey and keeps it
  ps.spriteCellChangeSpeed = 0;
  ps.emitter = at.clone();
  ps.createHemisphericEmitter(RADIUS); // upward only, so none sink into the floor
  ps.minSize = ps.maxSize = QUAD;
  ps.color1 = ps.color2 = ps.colorDead = new Color4(1, 1, 1, 1); // no fade: they blink out
  ps.minLifeTime = 0.3;
  ps.maxLifeTime = 0.65;
  ps.minEmitPower = 4;
  ps.maxEmitPower = 9;
  ps.addVelocityGradient(0, 1);
  ps.addVelocityGradient(1, 0.15); // a hard burst that brakes, so they scatter and hang
  ps.gravity = new Vector3(0, 1.5, 0); // drifts up a little, like dust
  ps.manualEmitCount = COUNT;
  ps.targetStopDuration = 0.7;
  ps.disposeOnStop = true;
  ps.start();
}
