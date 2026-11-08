/* Service Worker — تطبيق الأذكار
   استراتيجية Network-First: في كل فتح يجلب أحدث ملفات من السيرفر أولاً، وعند انقطاع النت يعمل من الكاش.
   لا حاجة لتغيير رقم إصدار عند كل تعديل؛ يتحدّث التطبيق تلقائياً في كل مرة يُفتح فيها بوجود الإنترنت.
   (الكاش 'azkar-quran-v1' الخاص بالمصحف والتفسير منفصل ولا يُحذف أبداً من هنا). */
const CACHE = 'azkar-app';

// ملفات أساسية: لو فشل تحميل أي منها يفشل التثبيت
const REQUIRED = ['./', './index.html', './manifest.json'];

// ملفات ثانوية: خطوط وأيقونات
const OPTIONAL = [
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './fonts/cairo-arabic-400-normal.woff2',
  './fonts/cairo-arabic-600-normal.woff2',
  './fonts/cairo-arabic-700-normal.woff2',
  './fonts/cairo-latin-400-normal.woff2',
  './fonts/cairo-latin-700-normal.woff2',
  './fonts/amiri-arabic-400-normal.woff2',
  './fonts/scheherazade-new-arabic-400-normal.woff2'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // تفعيل النسخة الجديدة فوراً بدون انتظار إغلاق التبويبات
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(REQUIRED.map(u => new Request(u, { cache: 'reload' })));
    await Promise.all(OPTIONAL.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // حذف الكاش القديم المسمّى بأرقام إصدارات (azkar-v2.0.1 ...) فقط، وإبقاء azkar-app و azkar-quran-v1
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => /^azkar-v\d/.test(k)).map(k => caches.delete(k)));
    await self.clients.claim(); // السيطرة الفورية على التبويبات المفتوحة
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

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    try {
      // حاول جلب النسخة الأحدث من الشبكة (مع التحقق من التغيّر)
      const fresh = await fetch(req, { cache: 'no-cache' });
      if (fresh && fresh.ok) {
        cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      }
    } catch (err) {
      // انقطاع الإنترنت: من الكاش
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;

      if (req.mode === 'navigate') {
        const page = await cache.match('./index.html');
        if (page) return page;
      }
    }

    // احتياطي: لو رد السيرفر بخطأ أو فشلت الشبكة، استخدم الكاش إن وُجد
    return (await cache.match(req, { ignoreSearch: true })) || Response.error();
  })());
});

/* ===== التذكيرات: النقر على الإشعار + التنبيه الدوري بالخلفية (إن دعمه الجهاز) ===== */
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
      await self.registration.showNotification(names[k][0], { body:(d.body && d.body[k]) || '', icon:'icons/icon-192.png', badge:'icons/icon-192.png', tag:'wird-' + k, lang:'ar', dir:'rtl', data:{ go:names[k][1] } });
      d.fired = d.fired || {}; d.fired[k] = today; changed = true;
    }
    if (changed) await cache.put('rem.json', new Response(JSON.stringify(d), { headers:{ 'content-type':'application/json' } }));
  })());
});