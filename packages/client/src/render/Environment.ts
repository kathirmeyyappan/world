// Static scenery: shader-drawn grid floor, gradient sky with stars, a boundary wall that only
// shows up when you get close, and a few billboards in the sky. No textures, no lights needed.
import {
  Color3, Effect, Mesh, MeshBuilder, ShaderMaterial, StandardMaterial, Texture, Vector3,
} from '@babylonjs/core';
import { Engine, FOG_COLOR } from './Engine';
import {
  GROUND_FRAGMENT, GROUND_VERTEX, SKY_FRAGMENT, SKY_VERTEX, WALL_FRAGMENT, WALL_VERTEX,
} from './shaders';

const SKY_OBJECTS = [
  { image: 'moon.png', size: 18, glow: 0.9 },
  { image: 'mugiwara.png', size: 24, glow: 0.6 },
  { image: 'patriots.png', size: 20, glow: 0.5 },
  { image: 'drake_maye.png', size: 24, glow: 0.35 },
];

const WALL_REVEAL_DISTANCE = 9;

export class Environment {
  private readonly materials: ShaderMaterial[] = [];
  private time = 0;

  constructor(private readonly engine: Engine, private readonly radius: number) {
    Effect.ShadersStore['worldGroundVertexShader'] = GROUND_VERTEX;
    Effect.ShadersStore['worldGroundFragmentShader'] = GROUND_FRAGMENT;
    Effect.ShadersStore['worldSkyVertexShader'] = SKY_VERTEX;
    Effect.ShadersStore['worldSkyFragmentShader'] = SKY_FRAGMENT;
    Effect.ShadersStore['worldWallVertexShader'] = WALL_VERTEX;
    Effect.ShadersStore['worldWallFragmentShader'] = WALL_FRAGMENT;
    this.createGround();
    this.createSky();
    this.createWall();
    this.createSkyObjects();
  }

  private createGround(): void {
    const scene = this.engine.scene;
    const size = this.radius * 12;
    const ground = MeshBuilder.CreateGround('ground', { width: size, height: size, subdivisions: 1 }, scene);
    ground.isPickable = false;
    const mat = new ShaderMaterial('groundMat', scene, 'worldGround', {
      attributes: ['position'],
      uniforms: ['world', 'worldViewProjection', 'cameraPos', 'lineColor', 'majorColor', 'floorColor', 'fogColor', 'playRadius', 'time'],
    });
    mat.setColor3('lineColor', new Color3(0.2, 0.9, 0.5));
    mat.setColor3('majorColor', new Color3(0.45, 1.0, 0.7));
    mat.setColor3('floorColor', new Color3(0.03, 0.06, 0.05));
    mat.setColor3('fogColor', FOG_COLOR);
    mat.setFloat('playRadius', this.radius);
    mat.backFaceCulling = false;
    ground.material = mat;
    this.materials.push(mat);
  }

  private createSky(): void {
    const scene = this.engine.scene;
    const sky = MeshBuilder.CreateSphere('sky', { diameter: this.radius * 30, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
    sky.isPickable = false;
    sky.infiniteDistance = true;
    sky.applyFog = false;
    const mat = new ShaderMaterial('skyMat', scene, 'worldSky', {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'fogColor', 'zenithColor', 'horizonColor', 'time'],
    });
    mat.setColor3('fogColor', FOG_COLOR);
    mat.setColor3('zenithColor', new Color3(0.01, 0.01, 0.04));
    mat.setColor3('horizonColor', new Color3(0.12, 0.03, 0.14));
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    sky.material = mat;
    this.materials.push(mat);
  }

  private createWall(): void {
    const scene = this.engine.scene;
    const wall = MeshBuilder.CreateCylinder('wall', { diameter: this.radius * 2, height: 16, tessellation: 96, cap: Mesh.NO_CAP }, scene);
    wall.position.y = 8;
    wall.isPickable = false;
    const mat = new ShaderMaterial('wallMat', scene, 'worldWall', {
      attributes: ['position'],
      uniforms: ['world', 'worldViewProjection', 'cameraPos', 'wallColor', 'revealDistance', 'time'],
      needAlphaBlending: true,
    });
    mat.setColor3('wallColor', new Color3(1.0, 0.25, 0.35));
    mat.setFloat('revealDistance', WALL_REVEAL_DISTANCE);
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    wall.material = mat;
    this.materials.push(mat);
  }

  private createSkyObjects(): void {
    const scene = this.engine.scene;
    const placed: Vector3[] = [];
    for (const obj of SKY_OBJECTS) {
      let position = Vector3.Zero();
      for (let attempt = 0; attempt < 100; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = this.radius * 1.2 + Math.random() * this.radius * 1.5;
        position = new Vector3(Math.cos(angle) * distance, 25 + Math.random() * 45, Math.sin(angle) * distance);
        if (placed.every((p) => Vector3.Distance(p, position) >= 60)) break;
      }
      placed.push(position);

      const mat = new StandardMaterial(`skyMat_${obj.image}`, scene);
      const tex = new Texture(`/assets/textures/sky/${obj.image}`, scene, false, true, Texture.NEAREST_SAMPLINGMODE);
      tex.hasAlpha = true;
      tex.onLoadObservable.addOnce(() => {
        const internal = tex.getInternalTexture();
        if (!internal) return;
        const aspect = internal.width / internal.height;
        const width = aspect >= 1 ? obj.size * aspect : obj.size;
        const height = aspect >= 1 ? obj.size : obj.size / aspect;
        const plane = MeshBuilder.CreatePlane(`sky_${obj.image}`, { width, height }, scene);
        plane.position = position;
        plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
        plane.isPickable = false;
        plane.applyFog = false;
        mat.diffuseTexture = tex;
        mat.emissiveTexture = tex;
        mat.emissiveColor = new Color3(obj.glow, obj.glow, obj.glow);
        mat.useAlphaFromDiffuseTexture = true;
        mat.backFaceCulling = false;
        mat.disableLighting = true;
        plane.material = mat;
      });
    }
  }

  // Once per frame: the shaders need the camera position for fades and a clock for pulses.
  update(dt: number, cameraPos: Vector3): void {
    this.time += dt;
    for (const m of this.materials) {
      m.setFloat('time', this.time);
      m.setVector3('cameraPos', cameraPos);
    }
  }
}
