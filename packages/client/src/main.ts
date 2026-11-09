import { showHome } from './app/home';
import type { Game } from './game/Game';
import { IS_TOUCH } from './input/touch';
import { leaveRoom } from './net/lobby';

declare global {
  interface Window {
    __world?: { debug: () => unknown; setLook: (yaw: number, pitch?: number) => void };
    __game?: Game; // dev builds only: the whole thing, for headless checks
  }
}

async function main(): Promise<void> {
  // The game (Babylon and all) is most of the download, so it comes in its own chunk, fetched while
  // the home screen or a join is under way.
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
  document.getElementById('disconnected-home')!.addEventListener('click', leaveRoom);
  game.start();
  requestAnimationFrame(() => loading.classList.add('hidden'));
  showStart(canvas);
}

// The world waits behind one press. It's what lets the browser start sound (Sfx unlocks on it; on a
// touchscreen only a tap does, never a drag), and with a mouse it takes the pointer, so moving the
// mouse turns the view from the start. Pressing anywhere on it pushes the button in. No key gets
// past it: Enter would open the chat behind it, and the typing then holds the focus the press needs.
const START_FADE_MS = 200; // matches #start's transition
function showStart(canvas: HTMLCanvasElement): void {
  const gate = document.getElementById('start')!;
  gate.querySelector('.label')!.textContent = IS_TOUCH ? 'TAP TO PLAY' : 'CLICK TO PLAY';
  gate.classList.remove('hidden');
  gate.addEventListener('pointerdown', () => gate.classList.add('pressed'));
  for (const up of ['pointerup', 'pointercancel', 'pointerleave'])
    gate.addEventListener(up, () => gate.classList.remove('pressed'));
  const keys = (e: KeyboardEvent) => e.stopPropagation();
  window.addEventListener('keydown', keys, { capture: true });
  gate.addEventListener(
    'click',
    () => {
      window.removeEventListener('keydown', keys, { capture: true });
      if (!IS_TOUCH) void canvas.requestPointerLock?.();
      gate.classList.add('gone');
      setTimeout(() => gate.remove(), START_FADE_MS);
    },
    { once: true },
  );
}

main().catch((err) => {
  console.error(err);
  document.getElementById('disconnected-reason')!.textContent = String(err);
  document.getElementById('disconnected')!.classList.remove('hidden');
});
