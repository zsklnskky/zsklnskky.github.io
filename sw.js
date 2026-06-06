/* ============================================================
   SERVICE WORKER — оффлайн-кэш для дашборда
   Стратегия: stale-while-revalidate.
   При апдейте — версию (CACHE) бамп → старый кэш сносится.
   ============================================================ */
const CACHE = 'zahar-dash-v1';

const PRECACHE = [
  '/',
  '/index.html',
  '/focus.html',
  '/wallet.html',
  '/password.html',
  '/orbit.html',
  '/manifest.json',
  '/ai-agent.js',
  '/i18n.js',
  '/voice.js',
  '/social.js',
  '/focus-icon.png',
  '/wallet-icon.png',
  '/password-icon.png',
  '/orbit-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      // Кэшируем по одному — если какой-то файл не найдётся, не валим всю установку
      Promise.all(PRECACHE.map(url =>
        cache.add(url).catch(err => console.warn('SW skip cache:', url, err.message))
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Firebase/Firestore/Mistral и пр. AI-API — всегда сеть, кэш не используем
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('gstatic') ||
      url.hostname.includes('mistral') ||
      url.hostname.includes('groq') ||
      url.hostname.includes('openrouter') ||
      url.hostname.includes('deepseek') ||
      url.hostname.includes('currency-api') ||
      url.hostname.includes('jsdelivr')) {
    return; // браузер сам обработает
  }

  // Только наш домен → stale-while-revalidate
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req).then(cached => {
        const network = fetch(req).then(res => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        // отдаём кэш быстро, но фоном обновляем
        return cached || network;
      })
    )
  );
});
