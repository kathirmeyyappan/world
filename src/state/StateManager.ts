import { GameState, PlayerState, CubeState, Vec3 } from './GameState';

/**
 * Manages game state with support for server interpolation and client-side prediction.
 * In single-player: runs local simulation.
 * In multiplayer: interpolates server state, predicts local player.
 */
export class StateManager {
  public state: GameState;
  
  // Multiplayer: Buffer of server states for interpolation
  private serverStateBuffer: Array<{ state: GameState; timestamp: number }> = [];
  private interpolationDelay = 100; // 100ms behind server for smooth interpolation
  private isMultiplayer = false; // Set to true when server connects

  constructor(worldRadius: number = 50) {
    this.state = {
      world: { radius: worldRadius },
      players: {},
      cubes: {},
    };
  }
  
  /**
   * Enable multiplayer mode (call when server connects).
   * TODO: Call this when WebSocket connects
   */
  public enableMultiplayer(): void {
    this.isMultiplayer = true;
  }
  
  /**
   * Disable multiplayer mode (fallback to single-player).
   */
  public disableMultiplayer(): void {
    this.isMultiplayer = false;
    this.serverStateBuffer = [];
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

  // ---- Server State Updates (for multiplayer) ----
  
  /**
   * Receive server state update.
   * TODO: Call this from WebSocket onmessage handler
   * Example: socket.onmessage = (e) => stateManager.receiveServerState(JSON.parse(e.data));
   */
  public receiveServerState(serverState: GameState, timestamp?: number): void {
    const ts = timestamp || Date.now();
    this.serverStateBuffer.push({ state: serverState, timestamp: ts });
    
    // Keep only recent states (last 5 for interpolation)
    if (this.serverStateBuffer.length > 5) {
      this.serverStateBuffer.shift();
    }
  }
  
  /**
   * Interpolate cube positions from server state buffer.
   * Runs every frame for smooth 60 FPS rendering.
   */
  private interpolateServerState(): void {
    if (this.serverStateBuffer.length < 2) return;
    
    const now = Date.now();
    const renderTime = now - this.interpolationDelay;
    
    // Find two states to interpolate between
    let state1 = this.serverStateBuffer[0];
    let state2 = this.serverStateBuffer[1];
    
    // Find the right pair of states
    for (let i = 0; i < this.serverStateBuffer.length - 1; i++) {
      if (this.serverStateBuffer[i + 1].timestamp >= renderTime) {
        state1 = this.serverStateBuffer[i];
        state2 = this.serverStateBuffer[i + 1];
        break;
      }
    }
    
    // Interpolate cube positions
    const t = Math.max(0, Math.min(1, 
      (renderTime - state1.timestamp) / (state2.timestamp - state1.timestamp)
    ));
    
    const baseY = 3;
    const floatAmplitude = 0.3;
    
    for (const cubeId in this.state.cubes) {
      const cube = this.state.cubes[cubeId];
      const s1Cube = state1.state.cubes[cubeId];
      const s2Cube = state2.state.cubes[cubeId];
      
      if (s1Cube && s2Cube) {
        // Interpolate time value (drives floating animation)
        cube.time = this.lerp(s1Cube.time, s2Cube.time, t);
        
        // Interpolate X and Z position (wander movement)
        cube.position.x = this.lerp(s1Cube.position.x, s2Cube.position.x, t);
        cube.position.z = this.lerp(s1Cube.position.z, s2Cube.position.z, t);
        
        // Recalculate Y position from interpolated time to maintain smooth floating animation
        // This ensures the sine wave animation continues smoothly between server updates
        cube.position.y = baseY + Math.sin(cube.time * cube.floatFrequency) * floatAmplitude;
        
        // Interpolate rotation (handle wrapping for continuous rotation)
        cube.rotation.x = this.lerpAngle(s1Cube.rotation.x, s2Cube.rotation.x, t);
        cube.rotation.y = this.lerpAngle(s1Cube.rotation.y, s2Cube.rotation.y, t);
        cube.rotation.z = this.lerpAngle(s1Cube.rotation.z, s2Cube.rotation.z, t);
        
        // Preserve animation parameters (they don't change)
        cube.floatFrequency = s1Cube.floatFrequency;
        cube.rotationSpeed = s1Cube.rotationSpeed;
        cube.wanderSpeed = s1Cube.wanderSpeed;
      }
    }
  }
  
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }
  
  /**
   * Lerp for angles, handles wrapping around 2π for smooth rotation interpolation.
   */
  private lerpAngle(a: number, b: number, t: number): number {
    // Normalize angles to [0, 2π]
    a = ((a % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2);
    b = ((b % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2);
    
    // Find shortest path (handle wrapping)
    let diff = b - a;
    if (Math.abs(diff) > Math.PI) {
      diff = diff > 0 ? diff - Math.PI * 2 : diff + Math.PI * 2;
    }
    
    return a + diff * t;
  }

  // ---- Simulation (single-player only, replaced by server in multiplayer) ----

  simulateCubes(deltaTime: number): void {
    // In multiplayer, server handles simulation - we just interpolate
    if (this.isMultiplayer) {
      this.interpolateServerState();
      return;
    }
    
    // Single-player: local simulation
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
  
  /**
   * Get local player input for sending to server.
   * TODO: Call this periodically (e.g., 20-30 times/sec) and send via WebSocket
   * Example: socket.send(JSON.stringify({ type: 'input', data: stateManager.getLocalPlayerInput() }));
   */
  public getLocalPlayerInput(localPlayerId: string = 'local'): { 
    id: string; 
    position: Vec3; 
    rotation: Vec3;
    timestamp: number;
  } | null {
    const player = this.getPlayer(localPlayerId);
    if (!player) return null;
    
    return {
      id: localPlayerId,
      position: { ...player.position },
      rotation: { ...player.rotation },
      timestamp: Date.now(),
    };
  }
}
