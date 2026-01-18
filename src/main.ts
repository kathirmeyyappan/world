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

  // Create state manager
  const stateManager = new StateManager(world.bounds.radius);
  
  // TODO: Multiplayer - Initialize WebSocket connection
  // const socket = new WebSocket('ws://your-server-url');
  // socket.onopen = () => {
  //   stateManager.enableMultiplayer();
  //   console.log('Connected to server');
  // };
  // socket.onmessage = (event) => {
  //   const data = JSON.parse(event.data);
  //   if (data.type === 'state') {
  //     stateManager.receiveServerState(data.state, data.timestamp);
  //   }
  // };
  // socket.onerror = () => {
  //   stateManager.disableMultiplayer();
  //   console.error('Server connection lost, falling back to single-player');
  // };
  // 
  // // Input throttling for server (send every ~50ms = 20 times/sec)
  // // Uncomment when enabling multiplayer:
  // // let lastInputSendTime = 0;
  // // const INPUT_SEND_INTERVAL = 50;

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

  // Start render loop (runs at 60 FPS)
  engine.run((deltaTime: number) => {
    const overlayVisible = uiSystem.isVisible();

    // Update input
    inputManager.update();

    // CLIENT-SIDE PREDICTION: Update local player immediately (no lag)
    // In multiplayer, server will correct if needed
    // In single-player, this is the authoritative update
    const localPlayer = stateManager.getPlayer('local');
    if (localPlayer && !overlayVisible) {
      // Player.update() handles movement and updates state directly
      // This gives instant response for local player
    }

    // TODO: Multiplayer - Send local player input to server (throttled)
    // Uncomment when enabling multiplayer (also uncomment variable declarations above):
    // const now = Date.now();
    // if (now - lastInputSendTime >= INPUT_SEND_INTERVAL) {
    //   const input = stateManager.getLocalPlayerInput('local');
    //   if (input && socket.readyState === WebSocket.OPEN) {
    //     socket.send(JSON.stringify({ type: 'input', data: input }));
    //   }
    //   lastInputSendTime = now;
    // }

    // STATE UPDATE: 
    // - Single-player: Simulate cubes locally
    // - Multiplayer: Interpolate from server state (handled in simulateCubes)
    stateManager.simulateCubes(deltaTime);

    // RENDER: Update world (renders entities from state at 60 FPS)
    // This runs every frame for smooth rendering, even if state updates are less frequent
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
