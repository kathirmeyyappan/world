import { Ray } from '@babylonjs/core';
import { Engine } from './core/Engine';
import { World } from './core/World';
import { InputManager } from './core/InputManager';
import { Player } from './entities/Player';
import { InfoCube } from './entities/InfoCube';
import { UISystem } from './systems/UISystem';
import { SpawnSystem } from './systems/SpawnSystem';
import { MobileControls } from './systems/MobileControls';

async function main(): Promise<void> {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element not found');
  }

  // Initialize core systems
  const engine = new Engine(canvas);
  const inputManager = new InputManager(canvas);
  const uiSystem = new UISystem();
  
  // Initialize mobile controls
  new MobileControls(inputManager);

  // Create world
  const world = new World(engine);
  
  // Create player
  const player = new Player(engine, inputManager, world.bounds);
  world.addEntity(player);

  // Load and spawn cubes
  const spawnSystem = new SpawnSystem(world, engine, uiSystem);
  await spawnSystem.loadAndSpawnCubes('./data/cubes.json');

  // Hide loading screen
  const loadingEl = document.getElementById('loading');
  if (loadingEl) {
    loadingEl.classList.add('hidden');
  }

  // Track currently hovered cube
  let hoveredCube: InfoCube | null = null;

  // Handle click on hovered cube
  canvas.addEventListener('click', () => {
    if (hoveredCube && !engine.isPaused) {
      hoveredCube.activate();
    }
  });

  // Start render loop
  engine.run((deltaTime: number) => {
    if (!engine.isPaused) {
      inputManager.update();
      world.update(deltaTime);

      // Raycast from camera center to detect hovered cube
      const camera = player.getCamera();
      const ray = new Ray(camera.position, camera.getForwardRay().direction, 50);
      const hit = engine.scene.pickWithRay(ray, (mesh) => mesh.name.startsWith('cube-'));

      // Update hover states
      const newHoveredCube = hit?.pickedMesh 
        ? spawnSystem.getCubes().find(c => c.mesh === hit.pickedMesh) 
        : null;

      if (newHoveredCube !== hoveredCube) {
        if (hoveredCube) hoveredCube.setHovered(false);
        if (newHoveredCube) newHoveredCube.setHovered(true);
        hoveredCube = newHoveredCube ?? null;
      }
    }
  });

  // Handle window resize
  window.addEventListener('resize', () => {
    engine.resize();
  });
}

main().catch((error) => {
  console.error('Failed to start application:', error);
});
