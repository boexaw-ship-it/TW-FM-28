/**
 * TW Fantasy — Service Worker (SPA app-shell)
 * - Install မှာ အားလုံးကို precache (offline + page ပြောင်းတိုင်း network မသွားတော့ဘူး)
 * - Same-origin asset: stale-while-revalidate (query string ?r=N ကို ignore လုပ်)
 * - Navigation: index.html (app shell) ကိုပဲ ပြန်ပေး
 * - Firebase data / auth call တွေ မစွက်ဖက်
 * VERSION နဲ့ precache list ကို `node tools/build.js` က auto ထည့်ပေးတယ်
 */
const VERSION = 'e23bde05';
const CACHE_NAME = 'twfm-spa-' + VERSION;
const PRECACHE = /*PRECACHE_START*/
[
  "./",
  "./css/app.css",
  "./css/dashboard.css",
  "./css/draft.css",
  "./css/fixtures.css",
  "./css/home.css",
  "./css/index.css",
  "./css/inline/draft.css",
  "./css/inline/fixtures.css",
  "./css/inline/leagues.css",
  "./css/inline/live.css",
  "./css/inline/pending.css",
  "./css/inline/register.css",
  "./css/inline/scout.css",
  "./css/inline/team.css",
  "./css/inline/transfers.css",
  "./css/inline/twsuper.css",
  "./css/leagues.css",
  "./css/live.css",
  "./css/pending.css",
  "./css/register.css",
  "./css/scout.css",
  "./css/style.css",
  "./css/tailwind.css",
  "./css/team.css",
  "./css/transfers.css",
  "./css/twsuper.css",
  "./index.html",
  "./js/app.js",
  "./js/core/auth.js",
  "./js/core/data.js",
  "./js/core/fs.js",
  "./js/core/scope.js",
  "./js/dashboard.js",
  "./js/draft-ui.js",
  "./js/draft.js",
  "./js/firebase-config.js",
  "./js/fixtures.js",
  "./js/home.js",
  "./js/index-ui.js",
  "./js/index.js",
  "./js/inline/draft.js",
  "./js/insights.js",
  "./js/leagues.js",
  "./js/live-ui.js",
  "./js/live.js",
  "./js/more.js",
  "./js/pending.js",
  "./js/pitch-renderer.js",
  "./js/register.js",
  "./js/routes.js",
  "./js/scout-ui.js",
  "./js/scout.js",
  "./js/team.js",
  "./js/transfer-pricing.js",
  "./js/transfers.js",
  "./js/twsuper.js",
  "./js/utils/player-photo.js",
  "./js/weekfixtures.js",
  "./public/jerseys/gk/ars.png",
  "./public/jerseys/gk/avl.png",
  "./public/jerseys/gk/bha_gk.png",
  "./public/jerseys/gk/bou.png",
  "./public/jerseys/gk/bre.png",
  "./public/jerseys/gk/che.png",
  "./public/jerseys/gk/cov_gk.png",
  "./public/jerseys/gk/cry.png",
  "./public/jerseys/gk/eve.png",
  "./public/jerseys/gk/ful.png",
  "./public/jerseys/gk/hul.png",
  "./public/jerseys/gk/ips.png",
  "./public/jerseys/gk/lee.png",
  "./public/jerseys/gk/liv.png",
  "./public/jerseys/gk/mci.png",
  "./public/jerseys/gk/mun.png",
  "./public/jerseys/gk/new.png",
  "./public/jerseys/gk/nfo.png",
  "./public/jerseys/gk/sun.png",
  "./public/jerseys/gk/tot.png",
  "./public/jerseys/outfield/ars.png",
  "./public/jerseys/outfield/avl.png",
  "./public/jerseys/outfield/bha.png",
  "./public/jerseys/outfield/bou.png",
  "./public/jerseys/outfield/bre.png",
  "./public/jerseys/outfield/che.png",
  "./public/jerseys/outfield/cov.png",
  "./public/jerseys/outfield/cry.png",
  "./public/jerseys/outfield/eve.png",
  "./public/jerseys/outfield/ful.png",
  "./public/jerseys/outfield/hul.png",
  "./public/jerseys/outfield/ips.png",
  "./public/jerseys/outfield/lee.png",
  "./public/jerseys/outfield/liv.png",
  "./public/jerseys/outfield/mci.png",
  "./public/jerseys/outfield/mun.png",
  "./public/jerseys/outfield/new.png",
  "./public/jerseys/outfield/nfo.png",
  "./public/jerseys/outfield/sun.png",
  "./public/jerseys/outfield/tot.png",
  "./views/dashboard.html",
  "./views/draft.html",
  "./views/fixtures.html",
  "./views/leagues.html",
  "./views/live.html",
  "./views/login.html",
  "./views/more.html",
  "./views/pending.html",
  "./views/register.html",
  "./views/scout.html",
  "./views/team.html",
  "./views/transfers.html",
  "./views/twsuper.html"
]
/*PRECACHE_END*/;

const BYPASS = ['firestore.googleapis.com', 'identitytoolkit.googleapis.com', 'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com', 'google-analytics.com', 'googletagmanager.com', 'firebase.googleapis.com'];

const abs = (p) => new URL(p, self.registration.scope).href;
const INDEX_URL = abs('./index.html');

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then((cache) =>
    Promise.allSettled(PRECACHE.map(async (p) => {
      const url = abs(p);
      const res = await fetch(url, { cache: 'reload' });
      if (res.ok) await cache.put(url === abs('./') ? INDEX_URL : url, res);
    }))
  ));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (BYPASS.some((h) => url.hostname.includes(h))) return;

  // App shell
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(INDEX_URL);
      const net = fetch(INDEX_URL).then((r) => { if (r.ok) cache.put(INDEX_URL, r.clone()); return r; }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || new Response('Offline', { status: 503 });
    })());
    return;
  }

  const same = url.origin === self.location.origin;
  let key = req.url;
  if (same) { const u = new URL(req.url); u.search = ''; key = u.href; } // ?r=N router cache-bust ကို ignore

  e.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(key);
    const net = fetch(same ? key : req).then((res) => {
      if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) cache.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response('', { status: 504 });
  })());
});
