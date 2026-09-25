import { Color4, Engine as BabylonEngine, GlowLayer, HemisphericLight, Scene, Vector3 } from '@babylonjs/core';

export class Engine {
  readonly engine: BabylonEngine;
  readonly scene: Scene;
  readonly glowLayer: GlowLayer;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new BabylonEngine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.01, 0.02, 0.03, 1);

    const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 1.0;
    ambient.groundColor.set(0.3, 0.5, 0.35);
    ambient.diffuse.set(1, 1, 1);

    this.glowLayer = new GlowLayer('glow', this.scene);
    this.glowLayer.intensity = 1.2;

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
