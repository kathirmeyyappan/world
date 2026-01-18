import { Ray } from '@babylonjs/core';
import { Engine } from './core/Engine';
import { World } from './core/World';
import { InputManager } from './core/InputManager';
import { Player } from './entities/Player';
import { InfoCube } from './entities/InfoCube';
import { UISystem } from './systems/UISystem';
import { SpawnSystem } from './systems/SpawnSystem';
import { MobileControls } from './systems/MobileControls';
import { StateManager } from './state';

async function main(): Promise<void> {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element not found');
  }

  // Initialize core systems
  const engine = new Engine(canvas);
  const uiSystem = new UISystem();
  const inputManager = new InputManager(canvas, uiSystem);

  // Initialize mobile controls
  new MobileControls(inputManager);

  // Create world
  const world = new World(engine);

  // Create state manager (for multiplayer, this would sync with server)
  const stateManager = new StateManager(world.bounds.radius);

  // Create player
  const player = new Player(engine, inputManager, world.bounds, uiSystem, stateManager);
  world.addEntity(player);

  // Load and spawn cubes
  const spawnSystem = new SpawnSystem(world, engine, uiSystem, stateManager);
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
    if (hoveredCube && !uiSystem.isVisible()) {
      hoveredCube.activate();
    }
  });

  // Start render loop
  engine.run((deltaTime: number) => {
    const overlayVisible = uiSystem.isVisible();

    // Update input
    inputManager.update();

    // Simulate cube movement (for multiplayer, replace with server state sync)
    stateManager.simulateCubes(deltaTime);

    // Update world (renders entities from state)
    world.update(deltaTime);

    // Raycast for hover (only when overlay hidden)
    if (!overlayVisible) {
      const camera = player.getCamera();
      const ray = new Ray(camera.position, camera.getForwardRay().direction, 50);
      const hit = engine.scene.pickWithRay(ray, (mesh) => mesh.name.startsWith('cube-'));

      const newHoveredCube = hit?.pickedMesh
        ? spawnSystem.getCubes().find(c => c.mesh === hit.pickedMesh)
        : null;

      if (newHoveredCube !== hoveredCube) {
        if (hoveredCube) hoveredCube.setHovered(false);
        if (newHoveredCube) newHoveredCube.setHovered(true);
        hoveredCube = newHoveredCube ?? null;
      }
    } else {
      if (hoveredCube) {
        hoveredCube.setHovered(false);
        hoveredCube = null;
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
