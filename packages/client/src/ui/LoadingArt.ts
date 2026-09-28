// The loading screen's pixel art: Elizabeth above the title, the Modal mark in the
// "POWERED BY MODAL" line under it. Both are bitmaps in pixelIcons.ts.
import { ELIZABETH, MODAL_LOGO, pixelSvg } from './pixelIcons';

export function mountLoadingArt(): void {
  const loading = document.getElementById('loading');
  if (!loading || loading.querySelector('svg')) return;
  loading.querySelector('.mascot')?.append(pixelSvg(ELIZABETH, 'elizabeth', { k: 'k', c: 'c', w: 'w', o: 'o' }));
  loading.querySelector('.powered')?.append(pixelSvg(MODAL_LOGO, 'modal-logo', { d: 'd' }));
}
