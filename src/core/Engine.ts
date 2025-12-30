import {
  Engine as BabylonEngine,
  Scene,
  HemisphericLight,
  Vector3,
  Color4,
  GlowLayer,
} from '@babylonjs/core';

/**
 * Core engine wrapper for Babylon.js. Manages scene, lighting, and render loop.
 */
export class Engine {
  public readonly engine: BabylonEngine;
  public readonly scene: Scene;
  public readonly glowLayer: GlowLayer;
  public isPaused: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new BabylonEngine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.01, 0.02, 0.03, 1); // Dark blue sky

    this.setupLighting();
    this.glowLayer = new GlowLayer('glow', this.scene);
    this.glowLayer.intensity = 0.8;
  }

  private setupLighting(): void {
    const ambient = new HemisphericLight(
      'ambient',
      new Vector3(0, 1, 0),
      this.scene
    );
    ambient.intensity = 0.7;
    ambient.groundColor.set(0.15, 0.3, 0.18);
  }

  /**
   * Starts the render loop with a callback for game logic updates.
   */
  public run(updateCallback: (deltaTime: number) => void): void {
    this.engine.runRenderLoop(() => {
      const deltaTime = this.engine.getDeltaTime() / 1000;
      updateCallback(deltaTime);
      this.scene.render();
    });
  }

  public resize(): void {
    this.engine.resize();
  }

  public dispose(): void {
    this.scene.dispose();
    this.engine.dispose();
  }
}

