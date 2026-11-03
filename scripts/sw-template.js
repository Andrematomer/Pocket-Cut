// Generated into dist/sw.js at build time: vite.config.ts fills in the version and the file list below.
// Every file of the app is cached when the service worker installs. A new build has a new version,
// installs a new cache, and deletes the old one.
const VERSION = '__VERSION__';
const CACHE = 'nla-' + VERSION;
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(new URL(f, self.registration.scope).href, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nla-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Pages (index.html): network first, with a short wait, so a new version shows up on the next visit.
// If the network is slow or missing, the cached copy is used. Everything else is hashed and comes from the cache.
const shell = () => caches.match(new URL('./index.html', self.registration.scope).href, { ignoreSearch: true, ignoreVary: true });

function networkFirst(req) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (res) => {
      if (!settled && res) {
        settled = true;
        resolve(res);
      }
    };
    const fallback = () => shell().then((hit) => done(hit || Response.error()));
    const timer = setTimeout(fallback, 2500);
    fetch(req).then(
      (res) => {
        clearTimeout(timer);
        if (res.ok) done(res);
        else fallback();
      },
      () => {
        clearTimeout(timer);
        fallback();
      },
    );
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // an experimental build lives in ./nla/ and has its own service worker
  if (new URL(req.url).pathname.startsWith(new URL('./nla/', self.registration.scope).pathname)) return;
  if (req.mode === 'navigate') return void event.respondWith(networkFirst(req));
  event.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(req).catch(() => Response.error())),
  );
});
