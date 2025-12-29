import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  DynamicTexture,
} from '@babylonjs/core';
import { Engine } from './Engine';
import { Entity } from '../entities/Entity';

export interface WorldBounds {
  radius: number;
}

/**
 * Manages the game world including bounds, ground, and entity lifecycle.
 */
export class World {
  public readonly bounds: WorldBounds;
  private engine: Engine;
  private entities: Entity[] = [];

  constructor(engine: Engine, radius: number = 50) {
    this.engine = engine;
    this.bounds = { radius };

    this.createGround(radius);
    this.createDome(radius);
  }

  private createGround(radius: number): void {
    const ground = MeshBuilder.CreateDisc(
      'ground',
      { radius: radius, tessellation: 64 },
      this.engine.scene
    );
    ground.rotation.x = Math.PI / 2;

    const material = new StandardMaterial('groundMat', this.engine.scene);
    material.diffuseColor = new Color3(0.18, 0.32, 0.2);
    material.specularColor = new Color3(0.1, 0.15, 0.1);
    material.diffuseTexture = this.createGridTexture('groundGrid', 1024, radius);
    ground.material = material;
  }

  private createDome(radius: number): void {
    const domeRadius = radius * 1.1;
    const dome = MeshBuilder.CreateSphere(
      'dome',
      { diameter: domeRadius * 2, segments: 32, slice: 0.5 },
      this.engine.scene
    );
    // Lower the dome so floor cuts it higher up (less equator distortion)
    dome.position.y = -domeRadius * 0.3;

    const material = new StandardMaterial('domeMat', this.engine.scene);
    material.diffuseColor = new Color3(0.08, 0.2, 0.1);
    material.emissiveColor = new Color3(0.04, 0.12, 0.06);
    material.specularColor = new Color3(0, 0, 0);
    material.backFaceCulling = false;
    material.diffuseTexture = this.createGridTexture('domeGrid', 512, radius, true);
    dome.material = material;
  }

  private createGridTexture(name: string, size: number, worldRadius: number, isDome: boolean = false): DynamicTexture {
    const texture = new DynamicTexture(name, size, this.engine.scene, true);
    const ctx = texture.getContext();

    // Background - dark green tint (ground lighter)
    ctx.fillStyle = isDome ? '#081a0c' : '#0e2810';
    ctx.fillRect(0, 0, size, size);

    // Grid lines - yellowish green, every 0.5 units
    const gridSpacing = size / (worldRadius / 0.5);
    ctx.strokeStyle = isDome ? 'rgba(180, 255, 100, 0.25)' : 'rgba(200, 255, 120, 0.35)';
    ctx.lineWidth = 1;

    // Vertical lines
    // Horizontal lines (dome uses 2x spacing to reduce stretching appearance)
    const vSpacing = isDome ? gridSpacing * 2 : gridSpacing;
    for (let x = 0; x <= size; x += vSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }

    // Horizontal lines (dome uses 6x spacing to reduce stretching appearance)
    const hSpacing = isDome ? gridSpacing * 6 : gridSpacing;
    for (let y = 0; y <= size; y += hSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }

    texture.update();
    return texture;
  }

  public addEntity(entity: Entity): void {
    this.entities.push(entity);
  }

  public removeEntity(entity: Entity): void {
    const index = this.entities.indexOf(entity);
    if (index !== -1) {
      this.entities.splice(index, 1);
      entity.dispose();
    }
  }

  public update(deltaTime: number): void {
    for (const entity of this.entities) {
      entity.update(deltaTime);
    }
  }

  public getEntities(): Entity[] {
    return this.entities;
  }

  /**
   * Clamps a position to stay within circular world bounds with optional padding.
   */
  public clampToBounds(position: Vector3, padding: number = 0): Vector3 {
    const maxRadius = this.bounds.radius - padding;
    const distanceFromCenter = Math.sqrt(position.x * position.x + position.z * position.z);
    
    if (distanceFromCenter > maxRadius) {
      const scale = maxRadius / distanceFromCenter;
      return new Vector3(position.x * scale, position.y, position.z * scale);
    }
    return position.clone();
  }

  /**
   * Checks if a position is within circular world bounds.
   */
  public isInBounds(position: Vector3, padding: number = 0): boolean {
    const distanceFromCenter = Math.sqrt(position.x * position.x + position.z * position.z);
    return distanceFromCenter <= this.bounds.radius - padding;
  }

  public dispose(): void {
    for (const entity of this.entities) {
      entity.dispose();
    }
    this.entities = [];
  }
}

