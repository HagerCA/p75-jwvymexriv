// App shell, cache-first, so the app opens with no signal. Only this site's own
// files are cached: the relay and every Google host always go to the network.
const VERSION = 'p75-v4';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './src/app.js',
  './src/calendar.js',
  './src/config.js',
  './src/drive-api.js',
  './src/drive.js',
  './src/estimate.js',
  './src/format.js',
  './src/store.js',
  './src/tally.js',
  './src/validate.js',
  './src/ui/checkin.js',
  './src/ui/days75.js',
  './src/ui/dom.js',
  './src/ui/review.js',
  './src/ui/settings.js',
  './src/ui/today.js',
  './src/ui/week.js',
  './fonts/DMSans-normal-latin.woff2',
  './fonts/SpaceGrotesk-a57c9413.woff2',
  './fonts/InstrumentSerif-normal-latin.woff2',
  './fonts/InstrumentSerif-italic-latin.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((hit) => hit || fetch(req)),
  );
});
