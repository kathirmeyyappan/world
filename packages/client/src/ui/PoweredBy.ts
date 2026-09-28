// "POWERED BY MODAL" under the loading screen's title, with the pixel Modal mark.
import { MODAL_LOGO, pixelSvg } from './pixelIcons';

export function mountPoweredBy(): void {
  const host = document.querySelector('#loading .powered');
  if (!host || host.querySelector('svg')) return;
  host.append(pixelSvg(MODAL_LOGO, 'modal-logo', { d: 'd' }));
}
