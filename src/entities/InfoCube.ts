import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Texture,
} from '@babylonjs/core';
import { Engine } from '../core/Engine';
import { Entity } from './Entity';
import { UISystem, CubeInfo } from '../systems/UISystem';
import { WorldBounds } from '../core/World';

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
 * Floating info cube that wanders around and displays information when clicked.
 */
export class InfoCube extends Entity {
  private engine: Engine;
  private uiSystem: UISystem;
  private config: CubeConfig;
  private bounds: WorldBounds;
  private material!: StandardMaterial;
  private baseColor!: Color3;

  private time: number = 0;
  private baseY: number = 3;
  private floatAmplitude: number = 0.3;
  private floatFrequency: number = 1.5;
  private rotationSpeed: number = 0.3;

  // Wander behavior
  private targetPosition: Vector3;
  private wanderSpeed: number;
  private readonly boundaryBuffer: number = 8;

  // Hover state
  private isHovered: boolean = false;

  constructor(
    engine: Engine,
    uiSystem: UISystem,
    config: CubeConfig,
    bounds: WorldBounds,
    spawnPosition: Vector3
  ) {
    super(engine.scene);
    this.engine = engine;
    this.uiSystem = uiSystem;
    this.config = config;
    this.bounds = bounds;

    // Randomize timing offset so cubes don't sync
    this.time = Math.random() * Math.PI * 2;
    this.floatFrequency = 1.2 + Math.random() * 0.6;
    this.rotationSpeed = 0.2 + Math.random() * 0.3;
    this.wanderSpeed = 0.3 + Math.random() * 0.5;

    this.createMesh(spawnPosition);
    this.targetPosition = this.pickNewTarget();
    this.setupInteraction();
    this.addToGlowLayer();
  }

  private createMesh(position: Vector3): void {
    this._mesh = MeshBuilder.CreateBox(
      `cube-${this.config.id}`,
      { size: 1.8 },
      this.scene
    );
    this._mesh.position = position.clone();
    this._mesh.position.y = this.baseY;

    this.material = new StandardMaterial(`mat-${this.config.id}`, this.scene);
    
    // Parse glow color
    this.baseColor = Color3.FromHexString(this.config.glowColor);
    this.material.diffuseColor = this.baseColor;
    this.material.emissiveColor = this.baseColor.scale(0.6); // Increased default glow
    this.material.specularColor = new Color3(0.3, 0.3, 0.3);

    // Apply logo texture if available
    if (this.config.logo) {
      const texture = new Texture(this.config.logo, this.scene);
      this.material.diffuseTexture = texture;
    }

    this._mesh.material = this.material;
  }

  private setupInteraction(): void {
    // Interaction is now handled via center-screen raycasting in main.ts
  }

  /** Called by raycast system when player is looking at this cube */
  public setHovered(hovered: boolean): void {
    this.isHovered = hovered;
  }

  /** Called by raycast system when player clicks while looking at this cube */
  public activate(): void {
    this.onClick();
  }

  private addToGlowLayer(): void {
    if (this._mesh) {
      this.engine.glowLayer.addIncludedOnlyMesh(this._mesh);
    }
  }

  private onClick(): void {
    const info: CubeInfo = {
      id: this.config.id,
      h1: this.config.h1,
      h2: this.config.h2,
      h3: this.config.h3,
      description: this.config.description,
      logo: this.config.logo,
    };

    // Show overlay without pausing the game (for multiplayer support)
    this.uiSystem.show(info);
  }

  private pickNewTarget(): Vector3 {
    // Pick random point within circular bounds
    const maxRadius = this.bounds.radius - this.boundaryBuffer;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * maxRadius; // sqrt for uniform distribution
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    return new Vector3(x, this.baseY, z);
  }

  public update(deltaTime: number): void {
    if (!this._mesh) return;

    this.time += deltaTime;

    // Floating animation
    const floatOffset = Math.sin(this.time * this.floatFrequency) * this.floatAmplitude;
    
    // Rotation
    this._mesh.rotation.y += this.rotationSpeed * deltaTime;
    this._mesh.rotation.x = Math.sin(this.time * 0.5) * 0.1;

    // Wander movement
    this.updateWander(deltaTime);

    // Apply float after wander updates position
    this._mesh.position.y = this.baseY + floatOffset;

    // Hover glow effect
    this.updateHoverEffect();
  }

  private updateHoverEffect(): void {
    if (!this.material) return;

    if (this.isHovered) {
      // Bright pulsing glow when hovered
      const pulse = (Math.sin(this.time * 5) + 1) / 2;
      const glowIntensity = 0.7 + pulse * 0.3; // 0.7 to 1.0
      this.material.emissiveColor = this.baseColor.scale(glowIntensity);
      if (this._mesh) {
        this._mesh.scaling.setAll(1.15);
      }
    } else {
      // Normal glow (increased from 0.3)
      this.material.emissiveColor = this.baseColor.scale(0.6);
      if (this._mesh) {
        this._mesh.scaling.setAll(1);
      }
    }
  }

  private updateWander(deltaTime: number): void {
    if (!this._mesh) return;

    const currentPos = new Vector3(
      this._mesh.position.x,
      this.baseY,
      this._mesh.position.z
    );

    const toTarget = this.targetPosition.subtract(currentPos);
    const distance = toTarget.length();

    // Pick new target if reached or too close to boundary
    if (distance < 0.5 || !this.isPositionSafe(currentPos)) {
      this.targetPosition = this.pickNewTarget();
      return;
    }

    // Move toward target with easing
    const direction = toTarget.normalize();
    const speed = this.wanderSpeed * this.easeInOut(Math.min(distance, 5) / 5);
    
    this._mesh.position.x += direction.x * speed * deltaTime;
    this._mesh.position.z += direction.z * speed * deltaTime;
  }

  private isPositionSafe(pos: Vector3): boolean {
    const distanceFromCenter = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
    return distanceFromCenter < this.bounds.radius - this.boundaryBuffer;
  }

  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
}

