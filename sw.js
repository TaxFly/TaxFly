// TaxFly Service Worker — v7
const CACHE = 'taxfly-v10';
const PRECACHE = [
    './login.html',
    './selector.html',
    './profiles.html',
    './index.html',
    './compras.html',
    './itinerario.html',
    './unidades.html',
    './tickets.html',
    './grupo.html',
    './style/style.css', 
    './manifest.json',
    './assets/icon-512.png',
    './assets/icon-192.png',
];

const OFFLINE_FALLBACK = './offline.html';

// ── Install: precachear con Promise.allSettled para que un fallo
//    no rompa todo el proceso de instalación ──
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(cache =>
            Promise.allSettled(PRECACHE.map(url =>
                cache.add(url).catch(err => {
                    console.warn('[SW] No se pudo cachear:', url, err);
                })
            ))
        ).then(() => self.skipWaiting())
    );
});

// ── Activate: limpiar cachés viejos ──
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// ── Fetch ──
self.addEventListener('fetch', e => {
    // Ignorar peticiones no-GET
    if (e.request.method !== 'GET') return;

    const url = new URL(e.request.url);

    // Ignorar extensiones de Chrome
    if (url.protocol === 'chrome-extension:') return;

    // ── 1. APIs externas — siempre red, sin interceptar ──
    const networkOnly = [
        'dolarapi.com', 'open.er-api.com', 'queue-times.com',
        'firebaseapp.com', 'googleapis.com',
        'securetoken.googleapis.com', 'firebaseio.com',
        'corsproxy.io', 'recaptcha',
        'taxusa-proxy', 'taxusa.juanbria18.workers.dev',
        'groq', 'llama', 'anthropic',
    ];
    if (networkOnly.some(d => url.href.includes(d))) return;

    // ── 2. Google Fonts → Stale While Revalidate ──
    if (url.href.includes('fonts.googleapis.com') || url.href.includes('fonts.gstatic.com')) {
        e.respondWith(
            caches.open(CACHE).then(cache =>
                cache.match(e.request).then(cached => {
                    const fetchPromise = fetch(e.request)
                        .then(res => {
                            if (res && res.ok) cache.put(e.request, res.clone());
                            return res;
                        })
                        .catch(() => cached);
                    return cached || fetchPromise;
                })
            )
        );
        return;
    }

    // ── 3. Flags CDN → Cache agresivo ──
    if (url.href.includes('flagcdn.com') || url.href.includes('flagpedia.net')) {
        e.respondWith(
            caches.open(CACHE).then(cache =>
                cache.match(e.request).then(r => r ||
                    fetch(e.request).then(res => {
                        if (res && res.ok) cache.put(e.request, res.clone());
                        return res;
                    }).catch(() => new Response(null, { status: 404 }))
                )
            )
        );
        return;
    }

    // ── 4. HTML propio → Network First con fallback a caché ──
    if (
        url.origin === self.location.origin &&
        e.request.headers.get('accept')?.includes('text/html')
    ) {
        e.respondWith(
            fetchWithTimeout(e.request, 8000)
                .then(res => {
                    if (res && res.status === 200) {
                        caches.open(CACHE).then(cache => cache.put(e.request, res.clone()));
                    }
                    return res;
                })
                .catch(() =>
                    caches.match(e.request).then(cached =>
                        cached || caches.match(OFFLINE_FALLBACK)
                    )
                )
        );
        return;
    }

    // ── 5. CSS, JS, imágenes locales → Cache First ──
    if (url.origin === self.location.origin) {
        e.respondWith(
            caches.open(CACHE).then(cache =>
                cache.match(e.request).then(cached => {
                    if (cached) {
                        // Actualizar en background sin bloquear
                        fetch(e.request).then(res => {
                            if (res && res.ok) cache.put(e.request, res.clone());
                        }).catch(() => {});
                        return cached;
                    }
                    return fetch(e.request).then(res => {
                        if (res && res.ok) cache.put(e.request, res.clone());
                        return res;
                    }).catch(() => {
                        if (e.request.headers.get('accept')?.includes('text/html')) {
                            return caches.match(OFFLINE_FALLBACK);
                        }
                        return new Response(null, { status: 503 });
                    });
                })
            )
        );
    }
});

// ── Mensajes desde la app ──
self.addEventListener('message', e => {
    if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
    if (e.data?.type === 'CLEAR_CACHE') {
        caches.delete(CACHE).then(() => e.ports[0]?.postMessage({ ok: true }));
    }
});

// ── Helper: fetch con timeout ──
function fetchWithTimeout(request, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        fetch(request)
            .then(r => { clearTimeout(timer); resolve(r); })
            .catch(e => { clearTimeout(timer); reject(e); });
    });
}
