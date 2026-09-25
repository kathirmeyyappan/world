import './styles.css';
import { showHome } from './app/home';
import { Game } from './game/Game';

declare global {
  interface Window {
    __world?: { debug: () => unknown; setYaw: (yaw: number) => void };
  }
}

async function main(): Promise<void> {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
  const { connection, roomId } = await showHome();

  const loading = document.getElementById('loading')!;
  loading.classList.remove('hidden');

  const game = new Game(canvas, connection, roomId, (reason) => {
    document.getElementById('disconnected-reason')!.textContent = reason;
    document.getElementById('disconnected')!.classList.remove('hidden');
  });
  window.__world = { debug: () => game.debug(), setYaw: (yaw) => game.setYaw(yaw) };
  document.getElementById('disconnected-home')!.addEventListener('click', () => {
    location.href = location.pathname;
  });
  game.start();
  requestAnimationFrame(() => loading.classList.add('hidden'));
}

main().catch((err) => {
  console.error(err);
  document.getElementById('disconnected-reason')!.textContent = String(err);
  document.getElementById('disconnected')!.classList.remove('hidden');
});
