// Where this browser goes when the room host turns away a load of its page for want of a session:
// public/rejoin-sw.js, installed here, reads the link from a cache, since a worker sees neither the
// page's storage nor anything of a page that never loaded.
const STORE = 'world-rejoin';
const LINK = '/link';

// Installs the worker and keeps `link` for it, or with null lets a turned-away load fail as it comes.
// Resolves once it's kept, so a page about to leave can wait for it.
export async function rejoinTo(link: string | null): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/rejoin-sw.js').catch(() => {});
  try {
    const store = await caches.open(STORE);
    await (link ? store.put(LINK, new Response(link)) : store.delete(LINK));
  } catch {
    // Storage blocked: a turned-away load fails as it comes.
  }
}
