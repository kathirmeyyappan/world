// The storm Colgera rises through: a great white pool lying on the ground where it comes up, lit
// blue round its rim and crawling with static like a screen between channels, with a gale turning
// over it, pixel "+"s of grey and white whirling round and up and white fog rolling round its
// edge; open while any of the body is still down in it and fading shut once the tail is out
// (dragons.ts `rise`). The ice it leaves on the floor is the sim's (room.ts).
import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  StandardMaterial,
  Texture,
  Vector3,
} from '@babylonjs/core';
import type { Rise } from './avatars/dragons';
import type { Engine } from './Engine';
import { plusSprites } from './Poof';

const ACROSS = 40; // metres: wider than the wings
const FADE = 0.9; // seconds to open or shut
const POOL = 256; // pixels across the pool's picture
const GRAIN = 64; // pixels across a tile of static, laid over the pool a few times across
const STATIC_STEP = 1 / 15; // seconds between the static's frames
const STATIC_TILES = 4; // tiles of static to cycle through
const STATIC_LEVEL = 0.4; // how much of the static shows through the white
const POOL_ALPHA = 0.5; // how solid the pool is: the floor and the ice on it show through
const PLUSSES = 360; // "+"s in the air at once
const PLUS_SECONDS = 2.4;
const PLUS_TURN = 1.5; // radians a second the gale turns round the pool
const PLUS_RISE = 5; // m/s the "+"s climb
const PLUS_DRAW = 1.5; // m/s they're drawn in toward the middle as they climb
const FOG = 40; // puffs of fog at once
const FOG_SECONDS = 3.2;
const FOG_TURN = 0.45; // radians a second the fog rolls round
const FOG_RISE = 0.6; // m/s

let base: HTMLCanvasElement | null = null; // the pool's white and blue, drawn once for every storm
let grains: HTMLCanvasElement[] | null = null; // the tiles of static, likewise
let puff: DynamicTexture | null = null;

export class Storm implements Rise {
  private readonly spin: Mesh; // the gale's frame, turning round the pool's axis
  private readonly roll: Mesh; // the fog's, turning slower
  private readonly disc: Mesh;
  private readonly material: StandardMaterial;
  private readonly picture: DynamicTexture;
  private readonly plusses: ParticleSystem;
  private readonly fog: ParticleSystem;
  private open = 0; // 0 shut to 1 open
  private staticAt = 0; // seconds since the static last stepped

  constructor(engine: Engine, name: string) {
    const scene = engine.scene;
    this.spin = new Mesh(`${name}-spin`, scene);
    this.roll = new Mesh(`${name}-roll`, scene);
    this.disc = MeshBuilder.CreateDisc(name, { radius: ACROSS / 2, tessellation: 48 }, scene);
    this.disc.rotation.x = Math.PI / 2;
    this.disc.isPickable = false;
    this.disc.parent = this.spin;
    this.picture = new DynamicTexture(`${name}-pool`, POOL, scene, false, Texture.BILINEAR_SAMPLINGMODE);
    this.picture.hasAlpha = true;
    this.material = new StandardMaterial(name, scene);
    this.material.emissiveTexture = this.picture;
    this.material.opacityTexture = this.picture;
    this.material.emissiveColor = Color3.White();
    this.material.diffuseColor = Color3.Black();
    this.material.specularColor = Color3.Black();
    this.material.disableLighting = true;
    this.material.backFaceCulling = false;
    this.disc.material = this.material;
    this.paint();
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
    this.fog.particleTexture = puff ??= puffTexture(engine);
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
    this.spin.setEnabled(false);
  }

  update(at: Vector3, ground: number, open: boolean, dt: number): void {
    this.open = Math.max(0, Math.min(1, this.open + ((open ? 1 : -1) * dt) / FADE));
    if (open) {
      this.spin.position.set(at.x, ground + 0.05, at.z);
      this.roll.position.copyFrom(this.spin.position);
    }
    this.spin.setEnabled(this.open > 0);
    this.spin.rotation.y += dt * PLUS_TURN;
    this.roll.rotation.y -= dt * FOG_TURN;
    this.material.alpha = POOL_ALPHA * this.open;
    this.disc.scaling.setAll(0.7 + 0.3 * this.open);
    this.staticAt += dt;
    if (this.open > 0 && this.staticAt >= STATIC_STEP) {
      this.staticAt = 0;
      this.paint();
    }
    if (open && !this.plusses.isStarted()) {
      this.plusses.start();
      this.fog.start();
    }
    if (!open && this.plusses.isStarted()) {
      this.plusses.stop();
      this.fog.stop();
    }
  }

  // The pool's picture: its white and blue, with a fresh frame of static laid over it.
  private paint(): void {
    const ctx = this.picture.getContext() as CanvasRenderingContext2D;
    const tiles = (grains ??= Array.from({ length: STATIC_TILES }, grainTile));
    ctx.clearRect(0, 0, POOL, POOL);
    ctx.drawImage((base ??= poolPicture()), 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop'; // static only where the pool is, its soft edge kept
    ctx.globalAlpha = STATIC_LEVEL;
    const pattern = ctx.createPattern(tiles[Math.floor(Math.random() * tiles.length)], 'repeat');
    if (pattern) {
      ctx.translate(Math.random() * GRAIN, Math.random() * GRAIN);
      ctx.fillStyle = pattern;
      ctx.fillRect(-GRAIN, -GRAIN, POOL + GRAIN, POOL + GRAIN);
    }
    ctx.restore();
    this.picture.update();
  }

  dispose(): void {
    this.plusses.dispose(); // its own sheet of "+"s with it
    this.fog.dispose(false); // not the puff: every storm's
    this.disc.dispose();
    this.material.dispose();
    this.picture.dispose();
    this.spin.dispose();
    this.roll.dispose();
  }
}

// The pool: pale in the middle, through blue to deep blue at the rim, and gone just past it.
function poolPicture(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = POOL;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(POOL / 2, POOL / 2, 0, POOL / 2, POOL / 2, POOL / 2);
  g.addColorStop(0, 'rgba(226,238,255,0.9)');
  g.addColorStop(0.55, 'rgba(206,228,255,0.9)');
  g.addColorStop(0.8, 'rgba(140,195,255,0.88)');
  g.addColorStop(0.93, 'rgba(70,150,255,0.7)');
  g.addColorStop(1, 'rgba(50,130,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, POOL, POOL);
  return canvas;
}

// A tile of static: every pixel a random grey with a touch of blue.
function grainTile(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = GRAIN;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(GRAIN, GRAIN);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.random() * 255;
    image.data[i] = v * 0.75;
    image.data[i + 1] = v * 0.88;
    image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// A soft puff of fog.
function puffTexture(engine: Engine): DynamicTexture {
  const size = 64;
  const texture = new DynamicTexture('storm-puff', size, engine.scene, false, Texture.BILINEAR_SAMPLINGMODE);
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
}
