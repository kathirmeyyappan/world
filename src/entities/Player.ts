import {
  UniversalCamera,
  Vector3,
} from '@babylonjs/core';
import { Engine } from '../core/Engine';
import { InputManager } from '../core/InputManager';
import { Entity } from './Entity';
import { WorldBounds } from '../core/World';
import { UISystem } from '../systems/UISystem';

/**
 * First-person player controller with camera, movement, and look controls.
 */
export class Player extends Entity {
  private camera: UniversalCamera;
  private inputManager: InputManager;
  private bounds: WorldBounds;
  private uiSystem: UISystem;

  private moveSpeed: number = 8;
  private lookSensitivity: number = 0.002;
  private rotationX: number = 0;
  private rotationY: number = 0;

  // Jump physics
  private velocityY: number = 0;
  private readonly gravity: number = 20;
  private readonly jumpForce: number = 8;
  private readonly groundY: number = 1.7;

  constructor(engine: Engine, inputManager: InputManager, bounds: WorldBounds, uiSystem: UISystem) {
    super(engine.scene);
    this.inputManager = inputManager;
    this.bounds = bounds;
    this.uiSystem = uiSystem;

    this.camera = new UniversalCamera(
      'playerCamera',
      new Vector3(0, 1.7, 0),
      this.scene
    );
    this.camera.minZ = 0.1;
    this.camera.fov = 1.2;
    this.scene.activeCamera = this.camera;
  }

  public update(deltaTime: number): void {
    // Always apply physics (gravity, falling) even when overlay is visible
    this.handleJump(deltaTime);
    
    // Only process input (movement, look) when overlay is not visible
    if (!this.uiSystem.isVisible()) {
      this.handleLook();
      this.handleMovement(deltaTime);
    }
  }

  private handleJump(deltaTime: number): void {
    const isGrounded = this.camera.position.y <= this.groundY;

    // Check for jump input
    if (isGrounded && this.inputManager.consumeJump()) {
      this.velocityY = this.jumpForce;
    }

    // Apply gravity
    this.velocityY -= this.gravity * deltaTime;

    // Update position
    this.camera.position.y += this.velocityY * deltaTime;

    // Ground collision
    if (this.camera.position.y < this.groundY) {
      this.camera.position.y = this.groundY;
      this.velocityY = 0;
    }
  }

  private handleLook(): void {
    const lookDelta = this.inputManager.getLookDelta();

    this.rotationY += lookDelta.x * this.lookSensitivity;
    this.rotationX += lookDelta.y * this.lookSensitivity;

    // Clamp vertical look to prevent flipping
    this.rotationX = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.rotationX));

    this.camera.rotation.x = this.rotationX;
    this.camera.rotation.y = this.rotationY;
  }

  private handleMovement(deltaTime: number): void {
    const input = this.inputManager.getMovement();
    if (input.length() === 0) return;

    const forward = new Vector3(
      Math.sin(this.rotationY),
      0,
      Math.cos(this.rotationY)
    );
    const right = new Vector3(
      Math.sin(this.rotationY + Math.PI / 2),
      0,
      Math.cos(this.rotationY + Math.PI / 2)
    );

    const velocity = forward.scale(input.y).add(right.scale(input.x));
    velocity.normalize();
    velocity.scaleInPlace(this.moveSpeed * deltaTime);

    const newPosition = this.camera.position.add(velocity);

    // Clamp to circular bounds
    const maxRadius = this.bounds.radius - 1;
    const distanceFromCenter = Math.sqrt(newPosition.x * newPosition.x + newPosition.z * newPosition.z);
    if (distanceFromCenter > maxRadius) {
      const scale = maxRadius / distanceFromCenter;
      newPosition.x *= scale;
      newPosition.z *= scale;
    }

    this.camera.position = newPosition;
  }

  public get cameraPosition(): Vector3 {
    return this.camera.position.clone();
  }

  public getCamera(): UniversalCamera {
    return this.camera;
  }
}

