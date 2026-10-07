import { showHome } from './app/home';
import type { Game } from './game/Game';
import { forgetRoom, homeUrl } from './net/lobby';
import { mountLoadingArt } from './ui/LoadingArt';

declare global {
  interface Window {
    __world?: { debug: () => unknown; setLook: (yaw: number, pitch?: number) => void };
    __game?: Game; // dev builds only: the whole thing, for headless checks
  }
}

async function main(): Promise<void> {
  mountLoadingArt();
  // The game (Babylon and all) is most of the download, so it comes in its own chunk, fetched while
  // the home screen or a join is under way; this one only has to bring the loading art in.
  const gameModule = import('./game/Game');
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
  const { connection, roomId } = await showHome();
  const { Game } = await gameModule;

  const loading = document.getElementById('loading')!;
  loading.classList.remove('hidden');

  const game = new Game(canvas, connection, roomId, (reason) => {
    document.getElementById('disconnected-reason')!.textContent = reason;
    document.getElementById('disconnected')!.classList.remove('hidden');
  });
  window.__world = { debug: () => game.debug(), setLook: (yaw, pitch) => game.setLook(yaw, pitch) };
  if (import.meta.env.DEV) window.__game = game;
  document.getElementById('disconnected-home')!.addEventListener('click', () => {
    forgetRoom();
    location.href = homeUrl();
  });
  game.start();
  requestAnimationFrame(() => loading.classList.add('hidden'));
}

main().catch((err) => {
  console.error(err);
  document.getElementById('disconnected-reason')!.textContent = String(err);
  document.getElementById('disconnected')!.classList.remove('hidden');
});
