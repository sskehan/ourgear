/* Our Gear service worker. Bump CACHE with every release. */
const CACHE = 'ourgear-1.09';
const SHELL = ['./', './index.html', './app.js', './styles.css', './manifest.webmanifest',
  './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share')) {
    e.respondWith(handleShare(e.request));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then((r) => r || fetch(e.request)));
    return;
  }
  // Cache-first; anything fetched later (like the receipt reader) is kept for offline use.
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  })));
});

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('ourgear', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      ['kv', 'blobs', 'thumbs', 'share'].forEach((s) => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function handleShare(request) {
  try {
    const fd = await request.formData();
    const files = fd.getAll('files').filter((f) => f && f.size);
    const batch = { files: files.map((f) => ({ blob: f, name: f.name || 'shared', type: f.type || '' })),
      title: String(fd.get('title') || ''), text: [fd.get('text'), fd.get('url')].filter(Boolean).join('\n') };
    if (!batch.files.length && !batch.title && !batch.text) return Response.redirect('./#/inbox', 303);
    const db = await openDb();
    await new Promise((res, rej) => {
      const t = db.transaction('share', 'readwrite');
      t.objectStore('share').put(batch, Date.now() + '-' + Math.random().toString(16).slice(2, 8));
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
  } catch (err) { /* fall through to the app; it will show nothing new */ }
  return Response.redirect('./?share=1#/inbox', 303);
}
