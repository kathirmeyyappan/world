import { MeshBuilder, StandardMaterial, Color3, Texture } from '@babylonjs/core';
import { Engine } from '../core/Engine';
import { Entity } from './Entity';
import { UISystem, CubeInfo } from '../systems/UISystem';
import { CubeState } from '../state';

export interface CubeConfig {
  id: string;
  h1: string;
  h2?: string;
  h3?: string;
  description: string[];
  logo?: string;
  glowColor: string;
}

/**
 * Floating info cube. Renders from game state.
 * Does NOT add to state - that's the server's job (or SpawnSystem for single-player).
 */
export class InfoCube extends Entity {
  private engine: Engine;
  private uiSystem: UISystem;
  private config: CubeConfig;
  private cubeState: CubeState;
  private material!: StandardMaterial;
  private baseColor!: Color3;

  constructor(
    engine: Engine,
    uiSystem: UISystem,
    config: CubeConfig,
    cubeState: CubeState  // State is passed in, not created here
  ) {
    super(engine.scene);
    this.engine = engine;
    this.uiSystem = uiSystem;
    this.config = config;
    this.cubeState = cubeState;

    this.createMesh();
    this.addToGlowLayer();
  }

  private createMesh(): void {
    this._mesh = MeshBuilder.CreateBox(`cube-${this.config.id}`, { size: 1.8 }, this.scene);
    this._mesh.position.set(this.cubeState.position.x, this.cubeState.position.y, this.cubeState.position.z);

    this.material = new StandardMaterial(`mat-${this.config.id}`, this.scene);
    this.baseColor = Color3.FromHexString(this.config.glowColor);
    this.material.diffuseColor = this.baseColor;
    this.material.emissiveColor = this.baseColor.scale(0.6);
    this.material.specularColor = new Color3(0.3, 0.3, 0.3);

    if (this.config.logo) {
      this.material.diffuseTexture = new Texture(this.config.logo, this.scene);
    }

    this._mesh.material = this.material;
  }

  private addToGlowLayer(): void {
    if (this._mesh) {
      this.engine.glowLayer.addIncludedOnlyMesh(this._mesh);
    }
  }

  public setHovered(hovered: boolean): void {
    this.cubeState.isHovered = hovered;
  }

  public activate(): void {
    const info: CubeInfo = {
      id: this.config.id,
      h1: this.config.h1,
      h2: this.config.h2,
      h3: this.config.h3,
      description: this.config.description,
      logo: this.config.logo,
    };
    this.uiSystem.show(info);
  }

  public update(_deltaTime: number): void {
    if (!this._mesh) return;

    // Sync mesh to state
    this._mesh.position.set(this.cubeState.position.x, this.cubeState.position.y, this.cubeState.position.z);
    this._mesh.rotation.set(this.cubeState.rotation.x, this.cubeState.rotation.y, 0);

    // Hover effect
    if (this.cubeState.isHovered) {
      const pulse = (Math.sin(this.cubeState.time * 5) + 1) / 2;
      this.material.emissiveColor = this.baseColor.scale(0.7 + pulse * 0.3);
      this._mesh.scaling.setAll(1.15);
    } else {
      this.material.emissiveColor = this.baseColor.scale(0.6);
      this._mesh.scaling.setAll(1);
    }
  }
}
