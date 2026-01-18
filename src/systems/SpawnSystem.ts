import { Vector3 } from '@babylonjs/core';
import { World } from '../core/World';
import { Engine } from '../core/Engine';
import { InfoCube, CubeConfig } from '../entities/InfoCube';
import { UISystem } from './UISystem';
import { StateManager } from '../state';

interface CubesData {
  cubes: CubeConfig[];
}

/**
 * Handles loading cube data and spawning.
 * 
 * For single-player: populates state AND creates renderers.
 * For multiplayer: server populates state, client just creates renderers.
 */
export class SpawnSystem {
  private world: World;
  private engine: Engine;
  private uiSystem: UISystem;
  private stateManager: StateManager;
  private spawnedCubes: InfoCube[] = [];
  private cubeConfigs: Map<string, CubeConfig> = new Map();

  private readonly minDistanceFromCenter: number = 10;
  private readonly minDistanceBetweenCubes: number = 8;

  constructor(world: World, engine: Engine, uiSystem: UISystem, stateManager: StateManager) {
    this.world = world;
    this.engine = engine;
    this.uiSystem = uiSystem;
    this.stateManager = stateManager;
  }

  /**
   * Single-player: load configs, populate state, create renderers.
   */
  public async loadAndSpawnCubes(jsonPath: string): Promise<void> {
    const response = await fetch(jsonPath);
    const data: CubesData = await response.json();

    // Store configs for later use
    for (const config of data.cubes) {
      this.cubeConfigs.set(config.id, config);
    }

    // Generate positions and add to state (server would do this in multiplayer)
    const positions = this.generateDistributedPositions(data.cubes.length);
    for (let i = 0; i < data.cubes.length; i++) {
      this.stateManager.addCube(data.cubes[i].id, {
        x: positions[i].x,
        y: 3,
        z: positions[i].z,
      });
    }

    // Create renderers from state
    this.createRenderersFromState();
  }

  /**
   * Multiplayer: create renderers for cubes already in state.
   * Call this after receiving state from server.
   */
  public createRenderersFromState(): void {
    for (const cubeState of Object.values(this.stateManager.state.cubes)) {
      const config = this.cubeConfigs.get(cubeState.id);
      if (!config) continue;

      const cube = new InfoCube(this.engine, this.uiSystem, config, cubeState);
      this.spawnedCubes.push(cube);
      this.world.addEntity(cube);
    }
  }

  /**
   * Multiplayer: set configs (received from server or loaded separately).
   */
  public setConfigs(configs: CubeConfig[]): void {
    for (const config of configs) {
      this.cubeConfigs.set(config.id, config);
    }
  }

  private generateDistributedPositions(count: number): Vector3[] {
    const maxRadius = this.world.bounds.radius - 12;
    const positions: Vector3[] = [];
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
        const angle = (i / cubesInRing) * Math.PI * 2 + (ring * 0.5);
        const jitterR = (Math.random() - 0.5) * (maxRadius / rings) * 0.5;
        const jitterAngle = (Math.random() - 0.5) * 0.3;

        const r = ringRadius + jitterR;
        const a = angle + jitterAngle;
        const pos = new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);

        if (this.isValidPosition(pos, positions)) {
          positions.push(pos);
          cubeIndex++;
        }
      }
    }

    while (positions.length < count) {
      const randomPos = this.findRandomValidPosition(positions);
      if (randomPos) {
        positions.push(randomPos);
      } else {
        const angle = Math.random() * Math.PI * 2;
        const r = this.minDistanceFromCenter + Math.random() * (maxRadius - this.minDistanceFromCenter);
        positions.push(new Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
      }
    }

    return positions;
  }

  private isValidPosition(pos: Vector3, existing: Vector3[]): boolean {
    const distFromCenter = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
    if (distFromCenter < this.minDistanceFromCenter) return false;

    for (const other of existing) {
      if (Vector3.Distance(pos, other) < this.minDistanceBetweenCubes) return false;
    }
    return true;
  }

  private findRandomValidPosition(existing: Vector3[]): Vector3 | null {
    const maxRadius = this.world.bounds.radius - 12;

    for (let i = 0; i < 50; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = this.minDistanceFromCenter + Math.sqrt(Math.random()) * (maxRadius - this.minDistanceFromCenter);
      const pos = new Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      if (this.isValidPosition(pos, existing)) return pos;
    }
    return null;
  }

  public getCubes(): InfoCube[] {
    return this.spawnedCubes;
  }
}
