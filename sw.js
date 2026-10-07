/**
 * =========================================================================
 * TW FF APPLICATION — Production Service Worker (PWA SPA App-Shell)
 * Supports: Vercel Deployments, Localhost Development & Offline App Shell
 * =========================================================================
 */

const VERSION = 'c6f98875';
const CACHE_NAME = 'twff-cache-' + VERSION;

// Precache Core Static Assets
const PRECACHE = [
  './',
  './index.html',
  './public/manifest.json',
  './css/style.css',
  './css/app.css',
  './css/tailwind.css',
  './css/home.css',
  './css/dashboard.css',
  './css/team.css',
  './css/live.css',
  './css/leagues.css',
  './css/fixtures.css',
  './css/scout.css',
  './css/transfers.css',
  './css/pending.css',
  './css/register.css',
  './js/app.js',
  './js/firebase-config.js',
  './js/dashboard.js',
  './js/home.js',
  './js/team.js',
  './js/pending.js',
  './js/register.js',
  './views/dashboard.html',
  './views/team.html',
  './views/live.html',
  './views/leagues.html',
  './views/fixtures.html',
  './views/scout.html',
  './views/transfers.html',
  './views/pending.html',
  './views/register.html'
];

// Firebase & Analytics API bypass domains (Never cache authentication or database calls)
const BYPASS_DOMAINS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'google-analytics.com',
  'googletagmanager.com',
  'firebase.googleapis.com',
  'api.telegram.org'
];

const abs = (path) => new URL(path, self.registration.scope).href;
const INDEX_URL = abs('./index.html');

// 1. Install Lifecycle: Cache core app-shell
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        PRECACHE.map(async (path) => {
          try {
            const url = abs(path);
            const res = await fetch(url, { cache: 'reload' });
            if (res.ok) {
              await cache.put(url === abs('./') ? INDEX_URL : url, res);
            }
          } catch (err) {
            console.warn(`[TW FF SW] Precache warning for ${path}:`, err);
          }
        })
      );
    })
  );
});

// 2. Activate Lifecycle: Clean legacy caches & claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// 3. Fetch Lifecycle: Stale-While-Revalidate with Navigation Fallback
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Bypass Google Firebase & External Live APIs
  if (BYPASS_DOMAINS.some((domain) => url.hostname.includes(domain))) {
    return;
  }

  // SPA Navigation Mode: Return cached index.html app-shell immediately
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const hit = await cache.match(INDEX_URL);
        const networkFetch = fetch(INDEX_URL)
          .then((networkRes) => {
            if (networkRes.ok) cache.put(INDEX_URL, networkRes.clone());
            return networkRes;
          })
          .catch(() => null);

        if (hit) {
          event.waitUntil(networkFetch);
          return hit;
        }

        return (await networkFetch) || new Response('Offline - TW FF Application', {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      })()
    );
    return;
  }

  // Same-Origin Asset Strategy: Stale-While-Revalidate (Ignore cache-busting queries)
  const isSameOrigin = url.origin === self.location.origin;
  let cacheKey = req.url;

  if (isSameOrigin) {
    const cleanUrl = new URL(req.url);
    cleanUrl.search = ''; // Strip ?r=123 queries for consistent cache hits
    cacheKey = cleanUrl.href;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(cacheKey);

      const networkFetch = fetch(isSameOrigin ? cacheKey : req)
        .then((res) => {
          if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
            cache.put(cacheKey, res.clone());
          }
          return res;
        })
        .catch(() => null);

      if (hit) {
        event.waitUntil(networkFetch);
        return hit;
      }

      return (await networkFetch) || new Response('', { status: 504 });
    })()
  );
});
