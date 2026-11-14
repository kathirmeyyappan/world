// The storm Colgera rises through: the ground round it rippling out in rings glowing icy blue
// (GroundRipple.ts), with a gale turning over it, pixel "+"s of grey and white whirling round and
// up, and white fog rolling round its edge; open while any of the body is still down in the
// ground, and once the tail is out the rings settle and the gale stops blowing, its last "+"s and
// puffs dying off one by one as they would (dragons.ts `rise`). The ice it leaves on the floor is
// the sim's (room.ts).
import { Color3, Color4, DynamicTexture, Mesh, ParticleSystem, Texture, type Vector3 } from '@babylonjs/core';
import type { Rise } from './avatars/dragons';
import type { Engine } from './Engine';
import { GroundRipple } from './GroundRipple';
import { perScene } from './perScene';
import { plusSprites } from './Poof';

const ACROSS = 40; // metres: wider than the wings
const ICE_GLOW = new Color3(0.35, 0.55, 0.8); // what the rings' crests glow
const FADE = 0.9; // seconds to open or shut
const PLUSSES = 360; // "+"s in the air at once
const PLUS_SECONDS = 2.4;
const PLUS_TURN = 1.5; // radians a second the gale turns round the pool
const PLUS_RISE = 5; // m/s the "+"s climb
const PLUS_DRAW = 1.5; // m/s they're drawn in toward the middle as they climb
const FOG = 40; // puffs of fog at once
const FOG_SECONDS = 3.2;
const FOG_TURN = 0.45; // radians a second the fog rolls round
const FOG_RISE = 0.6; // m/s

export class Storm implements Rise {
  private readonly spin: Mesh; // the gale's frame, turning round the pool's axis
  private readonly roll: Mesh; // the fog's, turning slower
  private readonly ground: GroundRipple;
  private readonly plusses: ParticleSystem;
  private readonly fog: ParticleSystem;
  private blowing = false; // the gale's systems started and not yet stopped

  constructor(engine: Engine, name: string, hole: number) {
    const scene = engine.scene;
    this.spin = new Mesh(`${name}-spin`, scene);
    this.roll = new Mesh(`${name}-roll`, scene);
    this.ground = new GroundRipple(engine, `${name}-ground`, hole, { across: ACROSS, fade: FADE, glow: ICE_GLOW });
    // The gale: "+"s born over the pool, climbing and drawn in toward the middle, in the frame of a
    // node that turns, so every one of them goes round with it (a solid whirl, faster out at the
    // rim), spinning as they go.
    const half = ACROSS / 2;
    this.plusses = new ParticleSystem(`${name}-plusses`, PLUSSES, scene);
    plusSprites(engine, this.plusses);
    this.plusses.isLocal = true;
    this.plusses.emitter = this.spin;
    this.plusses.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.plusses.minSize = 0.5;
    this.plusses.maxSize = 1.3;
    this.plusses.minLifeTime = PLUS_SECONDS * 0.6;
    this.plusses.maxLifeTime = PLUS_SECONDS;
    this.plusses.emitRate = PLUSSES / PLUS_SECONDS;
    this.plusses.color1 = new Color4(1, 1, 1, 1);
    this.plusses.color2 = new Color4(1, 1, 1, 1);
    this.plusses.colorDead = new Color4(1, 1, 1, 1); // none fade: each blinks out
    this.plusses.minAngularSpeed = -4;
    this.plusses.maxAngularSpeed = 4;
    this.plusses.startPositionFunction = (_world, position) => {
      const a = Math.random() * 2 * Math.PI;
      const r = half * (0.3 + Math.random() * 0.75);
      position.set(Math.cos(a) * r, Math.random() * 2.5, Math.sin(a) * r);
    };
    this.plusses.startDirectionFunction = (_world, direction, particle) => {
      const r = Math.hypot(particle.position.x, particle.position.z) || 1;
      direction.set(
        (-particle.position.x / r) * PLUS_DRAW,
        PLUS_RISE * (0.7 + Math.random() * 0.6),
        (-particle.position.z / r) * PLUS_DRAW,
      );
    };
    // The fog: soft white puffs born round the rim, rolling round it slowly and lifting a little.
    this.fog = new ParticleSystem(`${name}-fog`, FOG, scene);
    this.fog.particleTexture = puffTexture(engine.scene);
    this.fog.isLocal = true;
    this.fog.emitter = this.roll;
    this.fog.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.fog.minSize = 5;
    this.fog.maxSize = 9;
    this.fog.minLifeTime = FOG_SECONDS * 0.7;
    this.fog.maxLifeTime = FOG_SECONDS;
    this.fog.emitRate = FOG / FOG_SECONDS;
    this.fog.color1 = new Color4(1, 1, 1, 0.5);
    this.fog.color2 = new Color4(0.9, 0.95, 1, 0.35);
    this.fog.colorDead = new Color4(1, 1, 1, 0);
    this.fog.minAngularSpeed = -0.3;
    this.fog.maxAngularSpeed = 0.3;
    this.fog.startPositionFunction = (_world, position) => {
      const a = Math.random() * 2 * Math.PI;
      const r = half * (0.7 + Math.random() * 0.45);
      position.set(Math.cos(a) * r, Math.random() * 3, Math.sin(a) * r);
    };
    this.fog.startDirectionFunction = (_world, direction) => {
      direction.set(0, FOG_RISE * (0.5 + Math.random()), 0);
    };
  }

  update(at: Vector3, ground: number, open: boolean, dt: number): void {
    this.ground.update(at, ground, open, dt);
    if (open) {
      this.spin.position.set(at.x, ground + 0.05, at.z);
      this.roll.position.copyFrom(this.spin.position);
    }
    // The frames the gale blows in stay enabled: the scene draws a particle system only while its
    // emitter is, and a stopped one still has its last particles to live out.
    this.spin.rotation.y += dt * PLUS_TURN;
    this.roll.rotation.y -= dt * FOG_TURN;
    if (open !== this.blowing) {
      this.blowing = open;
      for (const system of [this.plusses, this.fog]) {
        if (open) system.start();
        else system.stop();
      }
    }
  }

  dispose(): void {
    this.plusses.dispose(); // its own sheet of "+"s with it
    this.fog.dispose(false); // not the puff: every storm's
    this.ground.dispose();
    this.spin.dispose();
    this.roll.dispose();
  }
}

// A soft puff of fog, every storm's in a scene.
const puffTexture = perScene((scene) => {
  const size = 64;
  const texture = new DynamicTexture('storm-puff', size, scene, false, Texture.BILINEAR_SAMPLINGMODE);
  texture.hasAlpha = true;
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  texture.update();
  return texture;
});
