// The guide: an overlay on the home screen that embeds the hosted guide page. The iframe only
// gets its src when opened, so the launcher never loads the page for people who don't ask.
// If the host refuses to be framed, the "open in new tab" link in the header still works.
export const GUIDE_URL = 'https://info.kathirm.com/kathir-world-guide?pvs=74';

export function mountGuide(): void {
  const root = document.getElementById('guide')!;
  const frame = document.getElementById('guide-frame') as HTMLIFrameElement;
  const open = document.getElementById('home-guide')!;
  const close = document.getElementById('guide-close')!;
  const link = document.getElementById('guide-link') as HTMLAnchorElement;
  link.href = GUIDE_URL;

  const show = () => {
    if (!frame.src) frame.src = GUIDE_URL;
    root.classList.remove('hidden');
    close.focus();
  };
  const hide = () => root.classList.add('hidden');

  open.addEventListener('click', show);
  close.addEventListener('click', hide);
  root.addEventListener('click', (e) => {
    if (e.target === root) hide();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !root.classList.contains('hidden')) hide();
  });
}
