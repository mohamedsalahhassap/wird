/* Service Worker — تطبيق الأذكار
   - ملفات HTML و Manifest: استراتيجية Stale-While-Revalidate (فتح فوري 0ms مع التحديث بالخلفية).
   - الخطوط والأيقونات الثابتة: استراتيجية Cache-First لتوفير استهلاك الشبكة.
   - إدارة الإصدارات: حذف أي كاش قديم لا يطابق الإصدار الحالي مع الحفاظ على 'azkar-quran-v1'. */
const CACHE = 'azkar-app-v3';

const REQUIRED = ['./', './index.html', './manifest.json'];

const OPTIONAL = [
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/og-image.png',
  './fonts/cairo-arabic-400-normal.woff2',
  './fonts/cairo-arabic-600-normal.woff2',
  './fonts/cairo-arabic-700-normal.woff2',
  './fonts/amiri-arabic-400-normal.woff2',
  './fonts/scheherazade-new-arabic-400-normal.woff2'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(REQUIRED.map(u => new Request(u, { cache: 'reload' })));
    await Promise.all(OPTIONAL.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // حذف الكاشات القديمة (azkar-app وأي إصدار سابق) مع إبقاء الحالي وكاش المصحف والتذكيرات
    const keys = await caches.keys();                                                                        // <-- جديد
    await Promise.all(keys.filter(k => k.startsWith('azkar-app') && k !== CACHE).map(k => caches.delete(k))); // <-- جديد

    const cache = await caches.open(CACHE);
    const validUrls = new Set(
      [...REQUIRED, ...OPTIONAL].map(u => new URL(u, self.location).href)
    );
    const requests = await cache.keys();

    // حذف أي ملف مخزّن لم يعد موجوداً في REQUIRED أو OPTIONAL تلقائياً
    await Promise.all(
      requests
        .filter(req => !validUrls.has(req.url))
        .map(req => cache.delete(req))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isStaticAsset = /\/(fonts|icons)\//.test(url.pathname) || 
                        /\.(woff2?|ttf|png|jpg|jpeg|svg|ico|webp)$/i.test(url.pathname);

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });

    // 1. Cache-First للملفات الثابتة (الخطوط والأيقونات) لتوفير طلبات الشبكة
    if (isStaticAsset) {
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch (err) {
        return Response.error();
      }
    }

    // 2. Stale-While-Revalidate للـ HTML والـ manifest
    const fetchPromise = fetch(req, { cache: 'no-cache' })
      .then(fresh => {
        if (fresh && fresh.ok) {
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(fetchPromise);
      return cached;
    }

    const networkRes = await fetchPromise;
    if (networkRes) return networkRes;

    if (req.mode === 'navigate') {
      const page = await cache.match('./index.html');
      if (page) return page;
    }

    return Response.error();
  })());
});

/* ===== التذكيرات: النقر على الإشعار + التنبيه الدوري بالخلفية ===== */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const go = (event.notification.data && event.notification.data.go) || '';
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    for (const c of list) {
      if ('focus' in c) { await c.focus(); if (go) c.postMessage({ go }); return; }
    }
    await self.clients.openWindow('./' + (go ? '?go=' + go : ''));
  })());
});

self.addEventListener('periodicsync', event => {
  if (event.tag !== 'wird-remind') return;
  event.waitUntil((async () => {
    const cache = await caches.open('azkar-rem-v1');
    const res = await cache.match('rem.json'); if (!res) return;
    const d = await res.json(); if (!d || !d.on) return;
    const now = new Date(), pad = n => String(n).padStart(2, '0');
    const today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    const names = { m:['أذكار الصباح','morning'], e:['أذكار المساء','evening'], w:['وِرد اليوم','wird'] };
    const m = now.getHours() * 60 + now.getMinutes();
    let changed = false;
    for (const k of ['m','e','w']) {
      const it = d.items && d.items[k]; if (!it || !it.on) continue;
      const [hh, mm] = it.t.split(':'), t = +hh * 60 + +mm;
      if (m < t || m > t + 240) continue;
      if (d.fired && d.fired[k] === today) continue;
      if (d.date === today && d.done && d.done[k]) continue;
      await self.registration.showNotification((d.title && d.title[k]) || names[k][0], { body:(d.body && d.body[k]) || '', icon:'icons/icon-192.png', badge:'icons/icon-192.png', tag:'wird-' + k, lang:'ar', dir:'rtl', data:{ go:names[k][1] } });
      d.fired = d.fired || {}; d.fired[k] = today; changed = true;
    }
    if (changed) await cache.put('rem.json', new Response(JSON.stringify(d), { headers:{ 'content-type':'application/json' } }));
  })());
});