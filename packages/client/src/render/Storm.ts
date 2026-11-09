// The storm Colgera rises through: a great disc of white lying on the ground where it comes up,
// glossy enough to mirror the body climbing out of it, with a hurricane turning round its edge
// (two walls of streaked cloud turning against each other, and a ring of scudding puffs), open
// while any of the body is still down in it and fading shut once the tail is out (dragons.ts
// `rise`). The mirror draws the body again, into the disc, only while the storm is open.
import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  MirrorTexture,
  ParticleSystem,
  Plane,
  StandardMaterial,
  Texture,
  Vector3,
  type AbstractMesh,
} from '@babylonjs/core';
import type { Rise } from './avatars/dragons';
import type { Engine } from './Engine';

const ACROSS = 40; // metres: wider than the wings
const WALL_HEIGHT = 16; // metres the cloud wall stands
const FADE = 0.9; // seconds to open or shut
const WALLS = [
  { across: ACROSS, turn: 0.7 }, // radians a second, the outer wall one way
  { across: ACROSS * 0.82, turn: -1.1 }, // and the inner the other
];
const PUFFS = 140; // in the air at once, scudding round the rim
const PUFF_SECONDS = 1.6;
const PUFF_SPEED = 9; // m/s round the rim
const MIRROR_SIZE = 512; // pixels: the reflection's render target
const MIRROR_LEVEL = 0.45; // how much of the reflection shows through the white
const DISC_ALPHA = 0.94;

let streaks: DynamicTexture | null = null;
let puff: DynamicTexture | null = null;

export class Storm implements Rise {
  private readonly disc: Mesh;
  private readonly discMaterial: StandardMaterial;
  private readonly reflection: MirrorTexture;
  private readonly walls: { mesh: Mesh; material: StandardMaterial; turn: number }[];
  private readonly puffs: ParticleSystem;
  private open = 0; // 0 shut to 1 open

  constructor(engine: Engine, name: string) {
    const scene = engine.scene;
    this.disc = MeshBuilder.CreateDisc(name, { radius: ACROSS / 2, tessellation: 48 }, scene);
    this.disc.rotation.x = Math.PI / 2;
    this.disc.isPickable = false;
    this.reflection = new MirrorTexture(`${name}-mirror`, MIRROR_SIZE, scene, true);
    this.reflection.level = MIRROR_LEVEL;
    this.reflection.renderList = [];
    this.discMaterial = new StandardMaterial(name, scene);
    this.discMaterial.diffuseColor = Color3.White();
    this.discMaterial.emissiveColor = new Color3(0.9, 0.93, 1);
    this.discMaterial.specularColor = Color3.Black();
    this.discMaterial.reflectionTexture = this.reflection;
    this.discMaterial.disableLighting = true;
    this.discMaterial.backFaceCulling = false;
    this.disc.material = this.discMaterial;
    this.walls = WALLS.map(({ across, turn }, i) => {
      const mesh = MeshBuilder.CreateCylinder(
        `${name}-wall-${i}`,
        { height: WALL_HEIGHT, diameter: across, tessellation: 48, cap: Mesh.NO_CAP },
        scene,
      );
      mesh.isPickable = false;
      const material = new StandardMaterial(`${name}-wall-${i}`, scene);
      const texture = (streaks ??= streakTexture(engine));
      material.diffuseTexture = texture;
      material.opacityTexture = texture;
      material.emissiveColor = new Color3(0.85, 0.9, 1);
      material.diffuseColor = Color3.Black();
      material.specularColor = Color3.Black();
      material.disableLighting = true;
      material.backFaceCulling = false;
      mesh.material = material;
      mesh.parent = this.disc;
      mesh.rotation.x = -Math.PI / 2; // upright again under the disc's turn
      mesh.position.z = -WALL_HEIGHT / 2; // the disc's -z is up once it lies flat
      return { mesh, material, turn };
    });
    this.puffs = new ParticleSystem(`${name}-puffs`, PUFFS, scene);
    this.puffs.particleTexture = puff ??= puffTexture(engine);
    this.puffs.emitter = this.disc;
    this.puffs.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.puffs.minSize = 3;
    this.puffs.maxSize = 6;
    this.puffs.minLifeTime = PUFF_SECONDS * 0.7;
    this.puffs.maxLifeTime = PUFF_SECONDS;
    this.puffs.emitRate = PUFFS / PUFF_SECONDS;
    this.puffs.color1 = new Color4(1, 1, 1, 0.55);
    this.puffs.color2 = new Color4(0.85, 0.9, 1, 0.4);
    this.puffs.colorDead = new Color4(1, 1, 1, 0);
    this.puffs.minAngularSpeed = -1;
    this.puffs.maxAngularSpeed = 1;
    // Born on the rim, in the disc's own frame (which lies flat: its -z is up), and sent round it.
    this.puffs.startPositionFunction = (world, position) => {
      const a = Math.random() * 2 * Math.PI;
      const r = (ACROSS / 2) * (0.85 + Math.random() * 0.25);
      Vector3.TransformCoordinatesFromFloatsToRef(
        Math.cos(a) * r,
        Math.sin(a) * r,
        -Math.random() * 3,
        world,
        position,
      );
    };
    this.puffs.startDirectionFunction = (world, direction, particle) => {
      const local = Vector3.TransformCoordinates(particle.position, world.clone().invert());
      const r = Math.hypot(local.x, local.y) || 1;
      Vector3.TransformNormalFromFloatsToRef(
        (-local.y / r) * PUFF_SPEED,
        (local.x / r) * PUFF_SPEED,
        -(1 + Math.random() * 3),
        world,
        direction,
      );
    };
    this.disc.setEnabled(false);
  }

  // The meshes the disc mirrors: the body coming up out of it.
  mirror(meshes: AbstractMesh[]): void {
    this.reflection.renderList = meshes;
  }

  update(at: Vector3, ground: number, open: boolean, dt: number): void {
    this.open = Math.max(0, Math.min(1, this.open + ((open ? 1 : -1) * dt) / FADE));
    if (open) {
      this.disc.position.set(at.x, ground + 0.05, at.z);
      this.reflection.mirrorPlane = new Plane(0, -1, 0, ground + 0.05);
    }
    const shown = this.open > 0;
    this.disc.setEnabled(shown);
    this.reflection.refreshRate = shown ? 1 : 0;
    this.discMaterial.alpha = DISC_ALPHA * this.open;
    this.disc.scaling.setAll(0.7 + 0.3 * this.open);
    for (const wall of this.walls) {
      wall.mesh.rotation.y += dt * wall.turn;
      wall.material.alpha = 0.5 * this.open;
    }
    if (open && !this.puffs.isStarted()) this.puffs.start();
    if (!open && this.puffs.isStarted()) this.puffs.stop();
  }

  dispose(): void {
    this.puffs.dispose(false); // not the puff: every storm's
    for (const wall of this.walls) {
      wall.mesh.dispose();
      wall.material.dispose(); // not the streaks: every storm's
    }
    this.reflection.dispose();
    this.disc.dispose();
    this.discMaterial.dispose();
  }
}

// Diagonal streaks of cloud, dense at the foot of the wall and gone at its top; wraps round.
function streakTexture(engine: Engine): DynamicTexture {
  const size = 256;
  const texture = new DynamicTexture('storm-streaks', size, engine.scene, false, Texture.BILINEAR_SAMPLINGMODE);
  texture.hasAlpha = true;
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = 'round';
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const length = 30 + Math.random() * 70;
    const fade = 1 - y / size; // y runs down the image: the wall's foot is at the bottom
    ctx.strokeStyle = `rgba(255,255,255,${(0.25 + Math.random() * 0.45) * (1 - fade * 0.9)})`;
    ctx.lineWidth = 2 + Math.random() * 5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y - length * 0.35);
    ctx.moveTo(x - size, y);
    ctx.lineTo(x - size + length, y - length * 0.35);
    ctx.stroke();
  }
  texture.update();
  return texture;
}

// A soft puff of cloud.
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
