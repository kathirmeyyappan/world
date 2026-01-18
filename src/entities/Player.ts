import { UniversalCamera, Vector3 } from '@babylonjs/core';
import { Engine } from '../core/Engine';
import { InputManager } from '../core/InputManager';
import { Entity } from './Entity';
import { WorldBounds } from '../core/World';
import { UISystem } from '../systems/UISystem';
import { StateManager } from '../state';

/**
 * First-person player controller. Syncs position/rotation to game state.
 */
export class Player extends Entity {
  private camera: UniversalCamera;
  private inputManager: InputManager;
  private bounds: WorldBounds;
  private uiSystem: UISystem;
  private stateManager: StateManager;
  private playerId: string;

  private moveSpeed = 8;
  private lookSensitivity = 0.002;
  private gravity = 20;
  private jumpForce = 8;
  private groundY = 1.7;

  constructor(
    engine: Engine,
    inputManager: InputManager,
    bounds: WorldBounds,
    uiSystem: UISystem,
    stateManager: StateManager,
    playerId: string = 'local'
  ) {
    super(engine.scene);
    this.inputManager = inputManager;
    this.bounds = bounds;
    this.uiSystem = uiSystem;
    this.stateManager = stateManager;
    this.playerId = playerId;

    // Register in state
    this.stateManager.addPlayer(playerId);

    this.camera = new UniversalCamera('playerCamera', new Vector3(0, 1.7, 0), this.scene);
    this.camera.minZ = 0.1;
    this.camera.fov = 1.2;
    this.scene.activeCamera = this.camera;
  }

  public update(deltaTime: number): void {
    const state = this.stateManager.getPlayer(this.playerId);
    if (!state) return;

    // Physics (always runs)
    this.handleJump(deltaTime, state);

    // Input (only when overlay hidden)
    if (!this.uiSystem.isVisible()) {
      this.handleLook(state);
      this.handleMovement(deltaTime, state);
    }

    // Sync camera to state
    this.camera.position.set(state.position.x, state.position.y, state.position.z);
    this.camera.rotation.x = state.rotation.x;
    this.camera.rotation.y = state.rotation.y;
  }

  private handleJump(deltaTime: number, state: NonNullable<ReturnType<StateManager['getPlayer']>>): void {
    const isGrounded = state.position.y <= this.groundY;

    if (isGrounded && this.inputManager.consumeJump()) {
      state.velocityY = this.jumpForce;
    }

    state.velocityY -= this.gravity * deltaTime;
    state.position.y += state.velocityY * deltaTime;

    if (state.position.y < this.groundY) {
      state.position.y = this.groundY;
      state.velocityY = 0;
    }
  }

  private handleLook(state: NonNullable<ReturnType<StateManager['getPlayer']>>): void {
    const delta = this.inputManager.getLookDelta();
    state.rotation.y += delta.x * this.lookSensitivity;
    state.rotation.x += delta.y * this.lookSensitivity;
    state.rotation.x = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, state.rotation.x));
  }

  private handleMovement(deltaTime: number, state: NonNullable<ReturnType<StateManager['getPlayer']>>): void {
    const input = this.inputManager.getMovement();
    if (input.length() === 0) return;

    const forward = new Vector3(Math.sin(state.rotation.y), 0, Math.cos(state.rotation.y));
    const right = new Vector3(Math.sin(state.rotation.y + Math.PI / 2), 0, Math.cos(state.rotation.y + Math.PI / 2));

    const velocity = forward.scale(input.y).add(right.scale(input.x));
    velocity.normalize().scaleInPlace(this.moveSpeed * deltaTime);

    state.position.x += velocity.x;
    state.position.z += velocity.z;

    // Clamp to bounds
    const maxRadius = this.bounds.radius - 1;
    const dist = Math.sqrt(state.position.x ** 2 + state.position.z ** 2);
    if (dist > maxRadius) {
      const scale = maxRadius / dist;
      state.position.x *= scale;
      state.position.z *= scale;
    }
  }

  public getCamera(): UniversalCamera {
    return this.camera;
  }
}
