import { MeshBuilder, StandardMaterial, Color3, Texture, Vector3, AbstractMesh } from '@babylonjs/core';
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
  borderColor?: string; // Border color (defaults to white)
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
  private borderMeshes: AbstractMesh[] = [];

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
    // Create main cube
    const cubeSize = 1.8;
    this._mesh = MeshBuilder.CreateBox(`cube-${this.config.id}`, { size: cubeSize }, this.scene);
    this._mesh.position.set(this.cubeState.position.x, this.cubeState.position.y, this.cubeState.position.z);

    this.material = new StandardMaterial(`mat-${this.config.id}`, this.scene);
    this.baseColor = Color3.FromHexString(this.config.glowColor);
    // Make diffuse the main color, emissive just for subtle glow
    this.material.diffuseColor = this.baseColor;
    this.material.emissiveColor = this.baseColor.scale(0.3); // Subtle glow, not overwhelming
    this.material.specularColor = new Color3(0, 0, 0); // No specular for flat look
    this.material.roughness = 1.0; // Fully rough = no shine

    if (this.config.logo) {
      this.material.diffuseTexture = new Texture(this.config.logo, this.scene);
    }

    this._mesh.material = this.material;

    // Create edge-only border lines
    this.createEdgeBorder(cubeSize);
  }

  private createEdgeBorder(cubeSize: number): void {
    const borderColor = Color3.FromHexString(this.config.borderColor || '#ffffff');
    const halfSize = cubeSize / 2;
    const offset = 0.01; // Slight offset to prevent z-fighting
    const thickness = 0.16; // Thick border lines (2x thicker)

    // Define the 8 vertices of a cube
    const vertices: Vector3[] = [
      new Vector3(-halfSize - offset, -halfSize - offset, -halfSize - offset), // 0: bottom-left-back
      new Vector3(halfSize + offset, -halfSize - offset, -halfSize - offset),  // 1: bottom-right-back
      new Vector3(halfSize + offset, -halfSize - offset, halfSize + offset),  // 2: bottom-right-front
      new Vector3(-halfSize - offset, -halfSize - offset, halfSize + offset),  // 3: bottom-left-front
      new Vector3(-halfSize - offset, halfSize + offset, -halfSize - offset),  // 4: top-left-back
      new Vector3(halfSize + offset, halfSize + offset, -halfSize - offset),   // 5: top-right-back
      new Vector3(halfSize + offset, halfSize + offset, halfSize + offset),    // 6: top-right-front
      new Vector3(-halfSize - offset, halfSize + offset, halfSize + offset),   // 7: top-left-front
    ];

    // Define the 12 edges
    const edges: [Vector3, Vector3][] = [
      // Bottom face edges (4 edges)
      [vertices[0], vertices[1]], // back edge
      [vertices[1], vertices[2]], // right edge
      [vertices[2], vertices[3]], // front edge
      [vertices[3], vertices[0]], // left edge
      // Top face edges (4 edges)
      [vertices[4], vertices[5]], // back edge
      [vertices[5], vertices[6]], // right edge
      [vertices[6], vertices[7]], // front edge
      [vertices[7], vertices[4]], // left edge
      // Vertical edges (4 edges)
      [vertices[0], vertices[4]], // back-left
      [vertices[1], vertices[5]], // back-right
      [vertices[2], vertices[6]], // front-right
      [vertices[3], vertices[7]], // front-left
    ];

    // Create thick cylinder for each edge
    const borderMaterial = new StandardMaterial(`border-mat-${this.config.id}`, this.scene);
    borderMaterial.diffuseColor = borderColor;
    borderMaterial.emissiveColor = borderColor;
    borderMaterial.disableLighting = true;

    for (let i = 0; i < edges.length; i++) {
      const [start, end] = edges[i];
      const direction = end.subtract(start);
      const length = direction.length();
      const center = start.add(end).scale(0.5);

      // Create cylinder for this edge
      const cylinder = MeshBuilder.CreateCylinder(`border-${this.config.id}-${i}`, {
        height: length,
        diameter: thickness,
        tessellation: 8,
      }, this.scene);

      // Parent to cube first, then set local position
      cylinder.setParent(this._mesh);
      
      // Set local position (relative to parent cube)
      cylinder.position = center;
      
      // Orient cylinder along edge direction
      // Cylinder default is along Y axis, rotate to match edge
      cylinder.lookAt(end);
      cylinder.rotate(Vector3.Right(), Math.PI / 2);
      
      cylinder.material = borderMaterial;

      this.borderMeshes.push(cylinder);
    }
  }

  private addToGlowLayer(): void {
    if (this._mesh) {
      this.engine.glowLayer.addIncludedOnlyMesh(this._mesh);
    }
  }

  public dispose(): void {
    for (const borderMesh of this.borderMeshes) {
      borderMesh.dispose();
    }
    this.borderMeshes = [];
    super.dispose();
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

    // Sync mesh to state (borders are parented, so they follow automatically)
    this._mesh.position.set(this.cubeState.position.x, this.cubeState.position.y, this.cubeState.position.z);
    this._mesh.rotation.set(this.cubeState.rotation.x, this.cubeState.rotation.y, 0);

    // Hover effect - readable but still cartoony
    if (this.cubeState.isHovered) {
      const pulse = (Math.sin(this.cubeState.time * 5) + 1) / 2;
      this.material.emissiveColor = this.baseColor.scale(0.5 + pulse * 0.3); // Moderate glow
      this._mesh.scaling.setAll(1.15); // Slightly bigger scale
    } else {
      this.material.emissiveColor = this.baseColor.scale(0.3); // Subtle base glow
      this._mesh.scaling.setAll(1);
    }
  }
}
