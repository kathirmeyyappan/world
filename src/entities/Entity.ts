import { Mesh, Vector3, Scene } from '@babylonjs/core';

/**
 * Base class for all game entities. Provides common interface for lifecycle management.
 */
export abstract class Entity {
  protected scene: Scene;
  protected _mesh: Mesh | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  public get mesh(): Mesh | null {
    return this._mesh;
  }

  public get position(): Vector3 {
    return this._mesh?.position ?? Vector3.Zero();
  }

  public set position(value: Vector3) {
    if (this._mesh) {
      this._mesh.position = value;
    }
  }

  public abstract update(deltaTime: number): void;

  public dispose(): void {
    if (this._mesh) {
      this._mesh.dispose();
      this._mesh = null;
    }
  }
}

