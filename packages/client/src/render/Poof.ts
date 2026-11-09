// A puff of chunky pixel "+"s scattering from a point: a corpse vanishing when its seat is dropped.
// Every "+" is a sprite from a tiny sheet (two sizes, three greys) drawn with nearest sampling; none
// fade, each blinks out at the end of its own short life.
// One burst, gone in well under a second; the particle system disposes itself, texture and all.
// The same sprites, tinted, are an ice jet's crystals (render/Jet.ts).
import { Color4, DynamicTexture, ParticleSystem, Texture, Vector3 } from '@babylonjs/core';
import type { Engine } from './Engine';

const COUNT = 36;
const RADIUS = 0.4; // metres: roughly a body lying on its side
const CELL = 8; // sprite cell, in texture pixels
const QUAD = 0.24; // metres per cell: the big "+" is this wide, the small one three quarters of it
const SPANS = [6, 8]; // "+" widths in pixels, one column each; arms are always 2 px thick
const GREYS = ['#f2f2f2', '#a8a8ac', '#5e5e64']; // one row each, lightest at the top

// The sheet: a column per size, a row per grey. Stored top row first, so cell 0 is the top left.
function plusSheet(engine: Engine): DynamicTexture {
  const size = { width: CELL * SPANS.length, height: CELL * GREYS.length };
  const tex = new DynamicTexture('poofTex', size, engine.scene, false, Texture.NEAREST_SAMPLINGMODE, undefined, false);
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
  tex.update(false);
  return tex;
}

// Gives `ps` the "+"s to draw: a sheet of its own (disposed with the system), each particle picking a
// size and one of the lightest `greys` greys when it's born and keeping them.
export function plusSprites(engine: Engine, ps: ParticleSystem, greys = GREYS.length): void {
  ps.particleTexture = plusSheet(engine);
  ps.isAnimationSheetEnabled = true;
  ps.spriteCellWidth = CELL;
  ps.spriteCellHeight = CELL;
  ps.startSpriteCellID = 0;
  ps.endSpriteCellID = SPANS.length * greys - 1;
  ps.spriteRandomStartCell = true;
  ps.spriteCellChangeSpeed = 0;
}

const SHARDS = 48;
const SHARD_RADIUS = 0.9; // metres: a crystal the size of a ring's underside
const SHARD_SIZE = 0.42; // metres across a shard
const FLASH_SECONDS = 0.45;
const FLASH_ACROSS = 7; // metres the light spreads to
const SPARKLES = 4; // pink ones among the shards, bigger and slower, for the glint of the core
const SPARKLE_SIZE = 0.75;

let light: DynamicTexture | null = null; // the flash's soft glow, drawn once

// A crystal shattering, seen from under it: a soft flash of light where it was, and its shards
// popping out, then fluttering down, spinning and twinkling, fading as they fall, a few pink
// sparkles of the core among them; gone in a couple of seconds.
export function shards(engine: Engine, at: Vector3): void {
  const flash = new ParticleSystem('shatter-flash', 3, engine.scene);
  flash.particleTexture = light ??= lightTexture(engine);
  flash.blendMode = ParticleSystem.BLENDMODE_ADD;
  flash.emitter = at.clone();
  flash.minEmitPower = flash.maxEmitPower = 0;
  flash.minLifeTime = flash.maxLifeTime = FLASH_SECONDS;
  flash.addSizeGradient(0, FLASH_ACROSS * 0.25);
  flash.addSizeGradient(1, FLASH_ACROSS);
  flash.addColorGradient(0, new Color4(1, 0.96, 1, 0.9));
  flash.addColorGradient(0.4, new Color4(0.95, 0.75, 1, 0.5));
  flash.addColorGradient(1, new Color4(0.8, 0.45, 1, 0));
  flash.manualEmitCount = 3;
  flash.targetStopDuration = FLASH_SECONDS + 0.1;
  flash.disposeOnStop = true;
  flash.start();

  const ps = new ParticleSystem('shards', SHARDS, engine.scene);
  plusSprites(engine, ps, 2);
  ps.spriteCellChangeSpeed = 5; // flicking between the sheet's sizes and greys: a twinkle
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.emitter = at.clone();
  ps.createSphereEmitter(SHARD_RADIUS);
  ps.minSize = SHARD_SIZE * 0.6;
  ps.maxSize = SHARD_SIZE;
  ps.color1 = new Color4(1, 1, 1, 1);
  ps.color2 = new Color4(0.75, 0.9, 1, 1);
  ps.colorDead = new Color4(0.6, 0.8, 1, 0);
  ps.minLifeTime = 1.4;
  ps.maxLifeTime = 2.4;
  ps.minEmitPower = 0.6;
  ps.maxEmitPower = 2.4;
  ps.minAngularSpeed = -5;
  ps.maxAngularSpeed = 5;
  ps.gravity = new Vector3(0, -3, 0); // a flutter, not a drop
  ps.manualEmitCount = SHARDS;
  ps.targetStopDuration = 2.5;
  ps.disposeOnStop = true;
  ps.start();

  const sparkles = new ParticleSystem('shatter-sparkles', SPARKLES, engine.scene);
  plusSprites(engine, sparkles, 1); // the lightest grey alone, so the pink stays pink
  sparkles.spriteCellChangeSpeed = 6;
  sparkles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  sparkles.emitter = at.clone();
  sparkles.createSphereEmitter(SHARD_RADIUS * 0.6);
  sparkles.minSize = SPARKLE_SIZE * 0.8;
  sparkles.maxSize = SPARKLE_SIZE;
  sparkles.color1 = new Color4(1, 0.6, 0.95, 1);
  sparkles.color2 = new Color4(0.95, 0.4, 1, 1);
  sparkles.colorDead = new Color4(0.9, 0.3, 1, 0);
  sparkles.minLifeTime = 1.8;
  sparkles.maxLifeTime = 2.6;
  sparkles.minEmitPower = 0.3;
  sparkles.maxEmitPower = 1.2;
  sparkles.minAngularSpeed = -3;
  sparkles.maxAngularSpeed = 3;
  sparkles.gravity = new Vector3(0, -2, 0);
  sparkles.manualEmitCount = SPARKLES;
  sparkles.targetStopDuration = 2.7;
  sparkles.disposeOnStop = true;
  sparkles.start();
}

// A soft disc of light for the flash.
function lightTexture(engine: Engine): DynamicTexture {
  const size = 64;
  const texture = new DynamicTexture('shatter-light', size, engine.scene, false, Texture.BILINEAR_SAMPLINGMODE);
  texture.hasAlpha = true;
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,240,255,0.6)');
  g.addColorStop(1, 'rgba(255,220,255,0)');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  texture.update();
  return texture;
}

export function poof(engine: Engine, at: Vector3): void {
  const ps = new ParticleSystem('poof', COUNT, engine.scene);
  plusSprites(engine, ps);
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
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
