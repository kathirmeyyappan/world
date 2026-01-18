import { GameState, PlayerState, CubeState, Vec3 } from './GameState';

/**
 * Manages game state. For multiplayer, swap simulate() with server sync.
 */
export class StateManager {
  public state: GameState;

  constructor(worldRadius: number = 50) {
    this.state = {
      world: { radius: worldRadius },
      players: {},
      cubes: {},
    };
  }

  // ---- Players ----

  addPlayer(id: string): PlayerState {
    this.state.players[id] = {
      id,
      position: { x: 0, y: 1.7, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      velocityY: 0,
    };
    return this.state.players[id];
  }

  getPlayer(id: string): PlayerState | undefined {
    return this.state.players[id];
  }

  // ---- Cubes ----

  addCube(id: string, position: Vec3): CubeState {
    const maxRadius = this.state.world.radius - 8;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * maxRadius;

    this.state.cubes[id] = {
      id,
      position: { ...position },
      rotation: { x: 0, y: 0, z: 0 },
      targetPosition: { x: Math.cos(angle) * r, y: 3, z: Math.sin(angle) * r },
      isHovered: false,
      time: Math.random() * Math.PI * 2,
      wanderSpeed: 0.3 + Math.random() * 0.5,
      floatFrequency: 1.2 + Math.random() * 0.6,
      rotationSpeed: 0.2 + Math.random() * 0.3,
    };
    return this.state.cubes[id];
  }

  getCube(id: string): CubeState | undefined {
    return this.state.cubes[id];
  }

  // ---- Simulation (replace with server sync for multiplayer) ----

  simulateCubes(deltaTime: number): void {
    const worldRadius = this.state.world.radius;
    const boundaryBuffer = 8;
    const baseY = 3;
    const floatAmplitude = 0.3;

    for (const cube of Object.values(this.state.cubes)) {
      cube.time += deltaTime;

      // Float & rotate
      cube.position.y = baseY + Math.sin(cube.time * cube.floatFrequency) * floatAmplitude;
      cube.rotation.y += cube.rotationSpeed * deltaTime;
      cube.rotation.x = Math.sin(cube.time * 0.5) * 0.1;

      // Wander
      const dx = cube.targetPosition.x - cube.position.x;
      const dz = cube.targetPosition.z - cube.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const distFromCenter = Math.sqrt(cube.position.x ** 2 + cube.position.z ** 2);

      if (dist < 0.5 || distFromCenter >= worldRadius - boundaryBuffer) {
        // Pick new target
        const maxR = worldRadius - boundaryBuffer;
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * maxR;
        cube.targetPosition = { x: Math.cos(angle) * r, y: baseY, z: Math.sin(angle) * r };
      } else {
        // Move toward target
        const speed = cube.wanderSpeed * Math.min(dist / 5, 1);
        cube.position.x += (dx / dist) * speed * deltaTime;
        cube.position.z += (dz / dist) * speed * deltaTime;
      }
    }
  }

  // ---- Serialization (for multiplayer) ----

  toJSON(): string {
    return JSON.stringify(this.state);
  }

  fromJSON(json: string): void {
    this.state = JSON.parse(json);
  }
}
