// TaxFly Service Worker — v8  (+ alertas de presupuesto)
const CACHE = 'taxfly-v11';
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
    './rutas.html',
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


// ══════════════════════════════════════════════════════
// ── PUSH NOTIFICATIONS — alertas de presupuesto ───────
// ══════════════════════════════════════════════════════

// Textos por idioma para notificaciones disparadas desde el servidor
const BUDGET_NOTIF_TEXTS = {
    es: {
        70:  { title: '⚠️ Presupuesto al 70%',   body: 'Llevás gastado el 70% de tu presupuesto de viaje.' },
        90:  { title: '🚨 Presupuesto al 90%',   body: '¡Cuidado! Solo te queda el 10% del presupuesto.' },
        100: { title: '🔴 Presupuesto agotado',  body: 'Superaste tu presupuesto total de viaje.' },
    },
    en: {
        70:  { title: '⚠️ Budget at 70%',    body: "You've used 70% of your travel budget." },
        90:  { title: '🚨 Budget at 90%',    body: 'Almost there! Only 10% of your budget left.' },
        100: { title: '🔴 Budget exceeded',  body: "You've gone over your travel budget." },
    },
    pt: {
        70:  { title: '⚠️ Orçamento em 70%',   body: 'Você usou 70% do seu orçamento de viagem.' },
        90:  { title: '🚨 Orçamento em 90%',   body: 'Cuidado! Só restam 10% do orçamento.' },
        100: { title: '🔴 Orçamento esgotado', body: 'Você ultrapassou o orçamento total de viagem.' },
    },
};

// Evento push — payload JSON del servidor (Firebase Cloud Function):
// { pct: 70|90|100, lang: 'es'|'en'|'pt', spent: 123.45, budget: 500, url: '...' }
self.addEventListener('push', e => {
    let data = {};
    try { data = e.data ? e.data.json() : {}; } catch(_) {}

    const pct    = data.pct    || 70;
    const lang   = data.lang   || 'es';
    const url    = data.url    || './compras.html';
    const spentN  = data.spent  ? Number(data.spent).toFixed(0)  : null;
    const budgetN = data.budget ? Number(data.budget).toFixed(0) : null;

    const texts = (BUDGET_NOTIF_TEXTS[lang] || BUDGET_NOTIF_TEXTS.es)[pct]
                || BUDGET_NOTIF_TEXTS.es[70];

    const body = (spentN && budgetN)
        ? `${texts.body} (USD ${spentN} / ${budgetN})`
        : texts.body;

    e.waitUntil(
        self.registration.showNotification(texts.title, {
            body,
            icon:     './assets/icon-192.png',
            badge:    './assets/icon-192.png',
            tag:      'budget-alert-' + pct,
            renotify: true,
            vibrate:  [200, 100, 200],
            data:     { url },
            actions:  [
                { action: 'open',    title: '📊 Ver gastos' },
                { action: 'dismiss', title: '✕ Cerrar'      },
            ],
        })
    );
});

// Click en la notificación — abre/enfoca la app
self.addEventListener('notificationclick', e => {
    e.notification.close();
    if (e.action === 'dismiss') return;

    const targetUrl = (e.notification.data && e.notification.data.url) || './compras.html';

    e.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            // Si ya hay una tab con compras abierta, enfocarla
            for (const client of list) {
                if (client.url.includes('compras') && 'focus' in client) {
                    return client.focus();
                }
            }
            // Si no, abrir nueva
            if (clients.openWindow) return clients.openWindow(targetUrl);
        })
    );
});
