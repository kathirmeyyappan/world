// The room host's page lives only as long as its session. Once the session is gone (the room closed,
// its token ran out, the browser dropped the cookie), Modal's proxy turns away a load of the page
// itself, a 401 or a 502, before anything of the game's runs. This worker, which the page installs
// (src/net/rejoin.ts), stands in front of those loads and sends a turned-away one where the page last
// said to: back through the lobby to the room it was in, or home once the player had left.
const STORE = 'world-rejoin';
const LINK = '/link'; // where a turned-away load goes, kept by the page

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') event.respondWith(load(event.request));
});

async function load(request) {
  const response = await fetch(request);
  // Only a return to the page is sent on: one with a query is the lobby handing this browser a room
  // (maybe one the page never kept), and every way the link leads comes back with one, so a room
  // that keeps failing shows its error rather than sending the browser round in circles.
  if (response.status < 400 || new URL(request.url).search) return response;
  const link = await caches
    .open(STORE)
    .then((store) => store.match(LINK))
    .then((kept) => kept?.text())
    .catch(() => undefined);
  return link ? Response.redirect(link, 302) : response;
}
