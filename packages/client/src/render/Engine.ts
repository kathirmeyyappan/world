// Babylon engine, scene, lights and post-processing. The retro look comes from rendering at a
// reduced internal resolution and letting the browser upscale with nearest-neighbour filtering.
import {
  Color3, Color4, DefaultRenderingPipeline, DirectionalLight, Engine as BabylonEngine, GlowLayer,
  HemisphericLight, Scene, Vector3,
} from '@babylonjs/core';

// Internal pixels per CSS pixel. 2.5 keeps the chunky look on a 1080p screen without turning text
// on cubes into mush; touch devices render smaller still.
const PIXEL_SCALE = window.matchMedia('(pointer: coarse)').matches ? 3 : 2.5;

export const FOG_COLOR = new Color3(0.02, 0.02, 0.05);

export class Engine {
  readonly engine: BabylonEngine;
  readonly scene: Scene;
  readonly glowLayer: GlowLayer;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new BabylonEngine(canvas, false, { preserveDrawingBuffer: false, stencil: true });
    this.engine.setHardwareScalingLevel(PIXEL_SCALE);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(FOG_COLOR.r, FOG_COLOR.g, FOG_COLOR.b, 1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.012;
    this.scene.fogColor = FOG_COLOR;

    const key = new DirectionalLight('key', new Vector3(-0.4, -1, 0.6), this.scene);
    key.intensity = 0.9;
    key.diffuse = new Color3(0.8, 0.85, 1);
    const fill = new HemisphericLight('fill', new Vector3(0, 1, 0), this.scene);
    fill.intensity = 0.35;
    fill.diffuse = new Color3(0.5, 0.6, 0.9);
    fill.groundColor = new Color3(0.05, 0.2, 0.1);

    this.glowLayer = new GlowLayer('glow', this.scene, { mainTextureRatio: 0.25, blurKernelSize: 24 });
    this.glowLayer.intensity = 0.8;

    const pipeline = new DefaultRenderingPipeline('post', false, this.scene);
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.55;
    pipeline.bloomWeight = 0.35;
    pipeline.bloomKernel = 32;
    pipeline.bloomScale = 0.5;
    pipeline.imageProcessingEnabled = true;
    pipeline.imageProcessing.toneMappingEnabled = true;
    pipeline.imageProcessing.contrast = 1.15;
    pipeline.imageProcessing.vignetteEnabled = true;
    pipeline.imageProcessing.vignetteWeight = 1.2;
    pipeline.imageProcessing.vignetteColor = new Color4(0, 0, 0.02, 0);

    window.addEventListener('resize', () => this.engine.resize());
  }

  run(update: (dt: number) => void): void {
    this.engine.runRenderLoop(() => {
      update(this.engine.getDeltaTime() / 1000);
      this.scene.render();
    });
  }

  dispose(): void {
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}
