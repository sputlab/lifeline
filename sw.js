/**
 * LifeLine - Service worker
 * La versione arriva dalla query di registrazione (sw.js?v=X.Y.Z): a ogni
 * rilascio l'URL cambia, il browser installa il nuovo worker e la vecchia
 * cache viene eliminata.
 *
 * - File statici (css, js, icone): precache + cache-first.
 * - Pagina principale: network-first, con copia in cache per l'avvio offline.
 * - api/*: sempre rete, mai in cache (sessione e dati di gioco).
 * - Font esterni: stale-while-revalidate.
 */
'use strict';

const VERSION = new URL(self.location).searchParams.get('v') || '0';
const CACHE = `lifeline-${VERSION}`;
const FONTS = 'lifeline-fonts';

const PRECACHE = [
    'offline.html',
    'manifest.webmanifest',
    'assets/css/base.css', 'assets/css/console.css', 'assets/css/settings.css', 'assets/css/debrief.css',
    'assets/js/i18n.js', 'assets/js/api.js', 'assets/js/app.js', 'assets/js/pwa.js',
    'assets/js/core/loader.js', 'assets/js/core/rng.js', 'assets/js/core/events.js',
    'assets/js/core/clock.js', 'assets/js/core/engine.js',
    'assets/js/game/call.js', 'assets/js/game/queue.js', 'assets/js/game/geo.js',
    'assets/js/game/cityart.js', 'assets/js/game/builder.js', 'assets/js/game/dialog.js',
    'assets/js/game/scheduler.js', 'assets/js/game/scoring.js', 'assets/js/game/director.js',
    'assets/js/game/training.js',
    'assets/js/ui/speechtext.js', 'assets/js/ui/prefs.js',
    'assets/js/ui/map.js', 'assets/js/ui/form.js', 'assets/js/ui/sound.js',
    'assets/js/ui/voice.js', 'assets/js/ui/callaudio.js', 'assets/js/ui/settings.js',
    'assets/js/ui/tutor.js', 'assets/js/ui/debrief.js', 'assets/js/ui/console.js',
    'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
    'assets/icons/maskable-192.png', 'assets/icons/maskable-512.png',
    'assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => Promise.all(PRECACHE.map((url) =>
                // un file mancante non deve impedire l'installazione
                cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))))
    );
    // Il nuovo worker resta in attesa finché la pagina non lo conferma (vedi pwa.js)
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys
                .filter((k) => k.startsWith('lifeline-') && k !== CACHE && k !== FONTS)
                .map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    if (url.origin === self.location.origin) {
        const path = url.pathname.slice(new URL('./', self.location).pathname.length);
        if (path.startsWith('api/')) return;                       // sempre rete
        if (req.mode === 'navigate') { event.respondWith(navigation(req)); return; }
        event.respondWith(cacheFirst(req));
        return;
    }
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        event.respondWith(staleWhileRevalidate(req));
    }
});

async function navigation(req) {
    const cache = await caches.open(CACHE);
    try {
        const res = await fetch(req);
        if (res.ok) cache.put(new URL('./', self.location).href, res.clone());
        return res;
    } catch (e) {
        return (await cache.match(new URL('./', self.location).href))
            || (await cache.match('offline.html'))
            || Response.error();
    }
}

async function cacheFirst(req) {
    const cache = await caches.open(CACHE);
    // ?v= identifica la versione: la cache si confronta ignorando la query
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
}

async function staleWhileRevalidate(req) {
    const cache = await caches.open(FONTS);
    const hit = await cache.match(req);
    const net = fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
    }).catch(() => hit);
    return hit || net;
}
