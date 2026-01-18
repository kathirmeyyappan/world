import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  DynamicTexture,
  Texture,
  Mesh,
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
    this.createSkyObjects(radius);
  }

  private createGround(radius: number): void {
    // Inner high-quality ground extends beyond dome for crisp visuals
    const innerRadius = radius * 2; // 2x playable area for high quality past dome
    const ground = MeshBuilder.CreateDisc(
      'ground',
      { radius: innerRadius, tessellation: 128 }, // Smoother for less polygon-y look
      this.engine.scene
    );
    ground.rotation.x = Math.PI / 2;
    ground.position.y = 0.01; // Slightly above extended ground to avoid z-fighting

    const material = new StandardMaterial('groundMat', this.engine.scene);
    material.diffuseColor = new Color3(0.3, 0.5, 0.35); // Brighter, more saturated
    material.specularColor = new Color3(0, 0, 0); // No specular for flat cartoony look
    material.roughness = 1.0; // Fully rough = no shine
    // Scale texture size with radius for consistent quality
    material.diffuseTexture = this.createGridTexture('groundGrid', 2048, innerRadius);
    ground.material = material;

    // Extended ground that goes forever (creates "locked in" feel)
    // Uses the same material as inner ground for seamless transition
    const extendedRadius = radius * 10;
    const extendedGround = MeshBuilder.CreateDisc(
      'extendedGround',
      { radius: extendedRadius, tessellation: 128 }, // Smoother
      this.engine.scene
    );
    extendedGround.rotation.x = Math.PI / 2;
    extendedGround.position.y = -0.01; // Slightly below inner ground

    // Use same colors but dimmer grid lines for distance fade effect
    const extendedMaterial = new StandardMaterial('extendedGroundMat', this.engine.scene);
    extendedMaterial.diffuseColor = new Color3(0.3, 0.5, 0.35); // Brighter, more saturated
    extendedMaterial.specularColor = new Color3(0, 0, 0); // No specular
    extendedMaterial.roughness = 1.0;
    extendedMaterial.diffuseTexture = this.createGridTexture('extendedGroundGrid', 2048, extendedRadius, false, true);
    extendedGround.material = extendedMaterial;
  }

  private createDome(radius: number): void {
    const domeRadius = radius * 1.1;
    const dome = MeshBuilder.CreateSphere(
      'dome',
      { diameter: domeRadius * 2, segments: 64, slice: 0.5 }, // Smoother dome
      this.engine.scene
    );
    dome.position.y = -domeRadius * 0.41;

    const material = new StandardMaterial('domeMat', this.engine.scene);
    material.diffuseColor = new Color3(0.4, 0.1, 0.15); // Brighter, more saturated red
    material.emissiveColor = new Color3(0.6, 0.2, 0.25); // More vibrant glow
    material.specularColor = new Color3(0, 0, 0);
    material.roughness = 1.0; // Flat, no shine
    material.alpha = 0.5; // Slightly more opaque for cartoony feel
    material.backFaceCulling = false;
    
    const texture = this.createGridTexture('domeGrid', 512, radius, true);
    texture.hasAlpha = true;
    material.diffuseTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
    dome.material = material;
  }

  private createSkyObjects(worldRadius: number): void {
    // Define sky objects here - each gets placed at a random sky position
    const skyObjects = [
      { image: 'moon.png', size: 20, glowColor: new Color3(0.8, 0.8, 0.8) },
      { image: 'mugiwara.png', size: 30, glowColor: new Color3(0.7, 0.7, 0.7) },
      { image: 'patriots.png', size: 25, glowColor: new Color3(0.5, 0.5, 0.5) },
      { image: 'drake_maye.png', size: 30, glowColor: new Color3(0.3, 0.3, 0.3) },
      // Add more objects here as needed
    ];

    const placedPositions: Vector3[] = [];
    const minDistance = 100; // Minimum 3D distance between sky objects

    for (const obj of skyObjects) {
      // Generate random position with better spacing
      let position: Vector3;
      let attempts = 0;
      do {
        const angle = Math.random() * Math.PI * 2;
        const elevation = 30 + Math.random() * 80; // Height in sky
        const distance = worldRadius * 0.8 + Math.random() * worldRadius * 2;
        position = new Vector3(
          Math.cos(angle) * distance,
          elevation,
          Math.sin(angle) * distance
        );
        attempts++;
      } while (
        attempts < 100 &&
        placedPositions.some(p => Vector3.Distance(p, position) < minDistance)
      );
      placedPositions.push(position);

      // Material with texture - load first to get aspect ratio
      const mat = new StandardMaterial(`skyMat_${obj.image}`, this.engine.scene);
      const tex = new Texture(
        `./assets/textures/sky/${obj.image}`,
        this.engine.scene,
        false,
        true // Invert Y to fix upside down
      );
      tex.hasAlpha = true;
      
      // Wait for texture to load, then create plane with correct aspect ratio
      tex.onLoadObservable.addOnce(() => {
        const internalTex = tex.getInternalTexture();
        if (internalTex) {
          const texWidth = internalTex.width;
          const texHeight = internalTex.height;
          const aspectRatio = texWidth / texHeight;
          const baseSize = obj.size;
          
          // Calculate width/height preserving aspect ratio
          const width = aspectRatio >= 1 ? baseSize * aspectRatio : baseSize;
          const height = aspectRatio >= 1 ? baseSize : baseSize / aspectRatio;
          
          // Create billboard plane with correct aspect ratio
          const plane = MeshBuilder.CreatePlane(
            `sky_${obj.image}`,
            { width, height },
            this.engine.scene
          );
          plane.position = position;
          plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
          
          mat.diffuseTexture = tex;
          mat.emissiveTexture = tex;
          mat.emissiveColor = obj.glowColor;
          mat.useAlphaFromDiffuseTexture = true;
          mat.backFaceCulling = false;
          mat.disableLighting = true;
          plane.material = mat;
          
          // Add to glow layer
          this.engine.glowLayer.addIncludedOnlyMesh(plane);
        }
      });
    }
  }

  private createGridTexture(name: string, size: number, worldRadius: number, isDome: boolean = false, isExtended: boolean = false): DynamicTexture {
    const texture = new DynamicTexture(name, size, this.engine.scene, true);
    const ctx = texture.getContext();

    // Background - brighter, more saturated for cartoony look
    if (isDome) {
      ctx.fillStyle = 'rgba(40, 10, 15, 0.15)'; // Brighter red background
    } else {
      ctx.fillStyle = '#1a3a20'; // Brighter green background
    }
    ctx.fillRect(0, 0, size, size);

    // Grid lines - brighter, more vibrant colors
    const gridSpacing = size / (worldRadius / 0.5);
    let strokeStyle = 'rgba(220, 255, 140, 0.6)'; // Brighter, more opaque
    if (isDome) {
      strokeStyle = 'rgba(255, 100, 100, 1.0)'; // More vibrant red
    } else if (isExtended) {
      strokeStyle = 'rgba(200, 255, 120, 0.3)'; // Brighter extended
    }
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = isDome ? 3 : 2; // Thicker lines for more defined look

    // Vertical lines
    // Horizontal lines (dome uses 2x spacing to reduce stretching appearance)
    const vSpacing = isDome ? 1.5 * gridSpacing : gridSpacing;
    for (let x = 0; x <= size; x += vSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }

    // Horizontal lines (dome uses 6x spacing to reduce stretching appearance)
    const hSpacing = isDome ? 4.5 * gridSpacing : gridSpacing;
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

