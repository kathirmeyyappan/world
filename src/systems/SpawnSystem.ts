import { Vector3 } from '@babylonjs/core';
import { World } from '../core/World';
import { Engine } from '../core/Engine';
import { InfoCube, CubeConfig } from '../entities/InfoCube';
import { UISystem } from './UISystem';

interface CubesData {
  cubes: CubeConfig[];
}

/**
 * Handles loading cube data and spawning them with even distribution across the world.
 */
export class SpawnSystem {
  private world: World;
  private engine: Engine;
  private uiSystem: UISystem;
  private spawnedCubes: InfoCube[] = [];

  private readonly minDistanceFromCenter: number = 10;
  private readonly minDistanceBetweenCubes: number = 8;

  constructor(world: World, engine: Engine, uiSystem: UISystem) {
    this.world = world;
    this.engine = engine;
    this.uiSystem = uiSystem;
  }

  public async loadAndSpawnCubes(jsonPath: string): Promise<void> {
    const response = await fetch(jsonPath);
    const data: CubesData = await response.json();
    this.spawnCubes(data.cubes);
  }

  private spawnCubes(configs: CubeConfig[]): void {
    const positions = this.generateDistributedPositions(configs.length);

    for (let i = 0; i < configs.length; i++) {
      const cube = new InfoCube(
        this.engine,
        this.uiSystem,
        configs[i],
        this.world.bounds,
        positions[i]
      );
      this.spawnedCubes.push(cube);
      this.world.addEntity(cube);
    }
  }

  /**
   * Generates evenly distributed positions within circular bounds.
   */
  private generateDistributedPositions(count: number): Vector3[] {
    const maxRadius = this.world.bounds.radius - 12; // padding from edge
    const positions: Vector3[] = [];

    // Distribute cubes in concentric rings for even spacing
    const rings = Math.ceil(Math.sqrt(count));
    let cubeIndex = 0;

    for (let ring = 1; ring <= rings && cubeIndex < count; ring++) {
      const ringRadius = (ring / rings) * maxRadius;
      const circumference = 2 * Math.PI * ringRadius;
      const cubesInRing = Math.min(
        Math.floor(circumference / this.minDistanceBetweenCubes),
        count - cubeIndex
      );

      for (let i = 0; i < cubesInRing && cubeIndex < count; i++) {
        const angle = (i / cubesInRing) * Math.PI * 2 + (ring * 0.5); // offset each ring
        const jitterR = (Math.random() - 0.5) * (maxRadius / rings) * 0.5;
        const jitterAngle = (Math.random() - 0.5) * 0.3;
        
        const r = ringRadius + jitterR;
        const a = angle + jitterAngle;
        
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const pos = new Vector3(x, 0, z);

        if (this.isValidPosition(pos, positions)) {
          positions.push(pos);
          cubeIndex++;
        }
      }
    }

    // Fill remaining with random positions if ring distribution didn't cover all
    while (positions.length < count) {
      const randomPos = this.findRandomValidPosition(positions);
      if (randomPos) {
        positions.push(randomPos);
      } else {
        // Fallback: place at random angle and radius
        const angle = Math.random() * Math.PI * 2;
        const r = this.minDistanceFromCenter + Math.random() * (maxRadius - this.minDistanceFromCenter);
        positions.push(new Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
      }
    }

    return positions;
  }

  private isValidPosition(pos: Vector3, existing: Vector3[]): boolean {
    // Check distance from center (player spawn)
    const distFromCenter = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
    if (distFromCenter < this.minDistanceFromCenter) {
      return false;
    }

    // Check distance from other cubes
    for (const other of existing) {
      const dist = Vector3.Distance(pos, other);
      if (dist < this.minDistanceBetweenCubes) {
        return false;
      }
    }

    return true;
  }

  private findRandomValidPosition(existing: Vector3[]): Vector3 | null {
    const maxRadius = this.world.bounds.radius - 12;
    const maxAttempts = 50;

    for (let i = 0; i < maxAttempts; i++) {
      // Random point in circle (sqrt for uniform distribution)
      const angle = Math.random() * Math.PI * 2;
      const r = this.minDistanceFromCenter + Math.sqrt(Math.random()) * (maxRadius - this.minDistanceFromCenter);
      const pos = new Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r);

      if (this.isValidPosition(pos, existing)) {
        return pos;
      }
    }

    return null;
  }

  public getCubes(): InfoCube[] {
    return this.spawnedCubes;
  }
}

