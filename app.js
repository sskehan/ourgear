/* Our Gear v1.0 — purchases, receipts and warranties.
   Offline web app. Records live on the phone (IndexedDB) and sync to Dropbox. */
'use strict';
const APP_VERSION = '1.0';
const DROPBOX_KEY = '5ddeosl2pq5dl33';
const DATA_PATH = '/data/ourgear-data.json';
const OWNERS = ['Shaun', 'Lyndsey', 'Shared'];
const PROPERTY_TYPES = ['Main residence', 'Investment', 'Holiday home', 'Other'];
const FILE_KINDS = ['Receipt', 'Tax invoice', 'Warranty card', 'Manual', 'Photo', 'Serial plate', 'Certificate', 'Other'];
const ITEM_STATUS = ['Active', 'Sold', 'Disposed', 'Replaced'];
const THEMES = [
  { id: 'midnight', name: 'Midnight and blue', a: '#0B1220', b: '#2F6BFF' },
  { id: 'indigo', name: 'Clean white and indigo', a: '#FFFFFF', b: '#4F46E5' },
  { id: 'slate', name: 'Slate and signal orange', a: '#1E293B', b: '#F97316' },
  { id: 'ink', name: 'Deep ink and teal', a: '#0F2A2E', b: '#14B8A6' }
];
const DEFAULT_LISTS = {
  categories: ['Kitchen appliances', 'Laundry', 'Heating and cooling', 'Hot water', 'Solar and energy', 'Security and CCTV',
    'Computers and network', 'TV and audio', 'Phones and tablets', 'Tools', 'Garden and outdoor', 'Furniture', 'Hobbies', 'Other'],
  locations: ['Kitchen', 'Laundry', 'Living', 'Dining', 'Bedroom 1', 'Bedroom 2', 'Bedroom 3', 'Bedroom 4', 'Bathroom', 'Ensuite',
    'Garage', 'Shed', 'Under house', 'Yard', 'Roof', 'Server cupboard'],
  warrantyTypes: ['Maker', 'Extended', 'Installer', 'Workmanship', 'Store'],
  properties: [{ id: 'home', name: 'Home', type: 'Main residence', address: '' }],
  updatedAt: 0
};

/* ---------- small helpers ---------- */
function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return Date.now().toString(16) + Math.random().toString(16).slice(2, 14);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function todayISO(now) {
  const d = now || new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
/* Add a warranty term. Month-end safe: 31 Jan + 1 month = 28/29 Feb. */
function addTerm(iso, n, unit) {
  const p = parseISO(iso);
  if (!p || !(n > 0)) return null;
  const months = unit === 'years' ? n * 12 : n;
  let y = p.y, m = p.m - 1 + months;
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return y + '-' + pad2(m + 1) + '-' + pad2(Math.min(p.d, last));
}
function daysUntil(iso, now) {
  const p = parseISO(iso);
  if (!p) return null;
  const t = now || new Date();
  const a = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((Date.UTC(p.y, p.m - 1, p.d) - a) / 864e5);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso) {
  const p = parseISO(iso);
  return p ? p.d + ' ' + MONTHS[p.m - 1] + ' ' + p.y : '';
}
function fmtMoney(n) {
  if (n === '' || n == null || isNaN(+n)) return '';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(+n);
}
function safeName(s, max) {
  const out = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, max || 40);
  return out || 'Unnamed';
}

/* ---------- data ---------- */
let D = null;          // synced data
let S = null;          // this phone's settings
function emptyData() {
  return { schema: 1, items: {}, warranties: {}, files: {}, lists: JSON.parse(JSON.stringify(DEFAULT_LISTS)) };
}
function defaultSettings() {
  return { theme: 'indigo', wifiOnly: true, owner: 'Shaun', lastSync: 0, lastSyncMsg: '' };
}
function live(coll) { return Object.values(D[coll]).filter((r) => !r.deleted); }
function touch(rec) { rec.updatedAt = Date.now(); rec.by = S ? S.owner : ''; return rec; }
function itemWarranties(itemId) { return live('warranties').filter((w) => w.itemId === itemId); }
function itemFiles(itemId) { return live('files').filter((f) => f.itemId === itemId); }
function inboxFiles() { return live('files').filter((f) => !f.itemId || !D.items[f.itemId] || D.items[f.itemId].deleted); }
function propById(id) { return D.lists.properties.find((p) => p.id === id) || null; }
function propName(id) { const p = propById(id); return p ? p.name : 'No property'; }

/* Merge another copy of the data into ours: newest record wins, by id. */
function mergeInto(local, remote) {
  let changed = false;
  ['items', 'warranties', 'files'].forEach((c) => {
    const L = local[c], R = (remote && remote[c]) || {};
    Object.keys(R).forEach((id) => {
      if (!L[id] || (R[id].updatedAt || 0) > (L[id].updatedAt || 0)) { L[id] = R[id]; changed = true; }
    });
  });
  if (remote && remote.lists && (remote.lists.updatedAt || 0) > (local.lists.updatedAt || 0)) { local.lists = remote.lists; changed = true; }
  return changed;
}

/* ---------- warranty logic ---------- */
function warrantyStart(w, item) {
  if (w.startFrom === 'install') return (item && (item.installDate || item.purchaseDate)) || null;
  if (w.startFrom === 'custom') return w.startDate || null;
  return (item && item.purchaseDate) || null;
}
function warrantyExpiry(w, item) {
  if (w.termUnit === 'lifetime') return null;
  if (w.expiryOverride) return w.expiryOverride;
  return addTerm(warrantyStart(w, item), +w.termValue, w.termUnit);
}
function warrantyStatus(w, item, now) {
  if (w.termUnit === 'lifetime') return { kind: 'life', label: 'Lifetime', expiry: null, days: Infinity };
  const exp = warrantyExpiry(w, item);
  if (!exp) return { kind: 'none', label: 'No date', expiry: null, days: null };
  const d = daysUntil(exp, now);
  if (d < 0) return { kind: 'gone', label: 'Expired', expiry: exp, days: d };
  if (d <= 90) return { kind: 'soon', label: d === 0 ? 'Today' : d === 1 ? '1 day' : d + ' days', expiry: exp, days: d };
  return { kind: 'ok', label: 'Covered', expiry: exp, days: d };
}
/* One badge per item. Expiring soon beats everything, then lifetime, covered, expired. */
function itemStatus(item, ws, now) {
  const st = ws.map((w) => warrantyStatus(w, item, now));
  if (!st.length) return { kind: 'nowar', label: 'No warranty' };
  const soon = st.filter((s) => s.kind === 'soon').sort((a, b) => a.days - b.days);
  if (soon.length) return soon[0];
  if (st.some((s) => s.kind === 'life')) return { kind: 'life', label: 'Lifetime' };
  if (st.some((s) => s.kind === 'ok')) return { kind: 'ok', label: 'Covered' };
  if (st.some((s) => s.kind === 'gone')) return { kind: 'gone', label: 'Expired' };
  return { kind: 'none', label: 'No date' };
}
/* Archive suggestion: not archived, and either gone from the house or every warranty expired over 2 years ago. */
function suggestArchive(item, ws, now) {
  if (item.archived || item.deleted) return false;
  if (item.status && item.status !== 'Active') return true;
  if (!ws.length) return false;
  return ws.every((w) => { const s = warrantyStatus(w, item, now); return s.kind === 'gone' && s.days < -730; });
}

/* ---------- Dropbox paths ---------- */
function fileExt(f) {
  if (f.mime === 'application/pdf') return 'pdf';
  if (f.mime === 'image/jpeg') return 'jpg';
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(f.origName || '');
  return m ? m[1].toLowerCase() : 'bin';
}
function fileBaseName(f) {
  return (f.date || 'nodate') + '_' + (f.store ? safeName(f.store, 24) + '_' : '') + safeName(f.kind || 'File', 16) + '_' + f.id.slice(0, 6) + '.' + fileExt(f);
}
function desiredPath(f, data) {
  const d = data || D;
  const item = f.itemId ? d.items[f.itemId] : null;
  if (!item || item.deleted) return '/Inbox/' + fileBaseName(f);
  const p = (d.lists.properties.find((x) => x.id === item.propertyId) || { name: 'No-property' }).name;
  const seg = safeName(p, 30) + '/' + safeName(item.name, 40) + '_' + item.id.slice(0, 4);
  if (item.archived) {
    const yr = new Date(item.archivedAt || Date.now()).getFullYear();
    return '/Archive/' + yr + '/' + seg + '/' + fileBaseName(f);
  }
  return '/Files/' + seg + '/' + fileBaseName(f);
}
function thumbPath(id) { return '/.thumbs/' + id + '.jpg'; }

/* ---------- IndexedDB ---------- */
const idb = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('ourgear', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        ['kv', 'blobs', 'thumbs', 'share'].forEach((s) => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  run(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode);
      const rq = fn(t.objectStore(store));
      let out;
      if (rq) rq.onsuccess = () => { out = rq.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  get(st, k) { return this.run(st, 'readonly', (s) => s.get(k)); },
  put(st, k, v) { return this.run(st, 'readwrite', (s) => s.put(v, k)); },
  del(st, k) { return this.run(st, 'readwrite', (s) => s.delete(k)); },
  keys(st) { return this.run(st, 'readonly', (s) => s.getAllKeys()); }
};
async function saveData() { await idb.put('kv', 'data', D); scheduleSync(); }
function saveSettings() { try { localStorage.setItem('og_settings', JSON.stringify(S)); } catch (e) { /* ignore */ } }
/* ---------- Dropbox (PKCE sign-in, no secret) ---------- */
const REDIRECT_URI = (typeof location !== 'undefined') ? location.origin + location.pathname.replace(/index\.html$/, '') : '';
function randStr(n) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return Array.from(a, (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'[b % 66]).join('');
}
async function sha256url(s) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return btoa(String.fromCharCode.apply(null, new Uint8Array(h))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function apiArg(o) {
  return JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));
}
const DBX = {
  access: null, exp: 0,
  connected() { return !!localStorage.getItem('og_refresh'); },
  async connect() {
    const verifier = randStr(64), state = randStr(16);
    localStorage.setItem('og_pkce', verifier); localStorage.setItem('og_state', state);
    const q = new URLSearchParams({ client_id: DROPBOX_KEY, response_type: 'code', code_challenge: await sha256url(verifier),
      code_challenge_method: 'S256', token_access_type: 'offline', redirect_uri: REDIRECT_URI, state });
    location.href = 'https://www.dropbox.com/oauth2/authorize?' + q.toString();
  },
  async finishSignIn() {
    const p = new URLSearchParams(location.search);
    const code = p.get('code');
    if (!code && !p.get('error')) return false;
    history.replaceState(null, '', location.pathname + '#/settings');
    if (!code) { toast('Dropbox sign-in was cancelled'); return true; }
    if (p.get('state') !== localStorage.getItem('og_state')) { toast('Sign-in check failed. Try again.'); return true; }
    const body = new URLSearchParams({ code, grant_type: 'authorization_code', code_verifier: localStorage.getItem('og_pkce') || '',
      client_id: DROPBOX_KEY, redirect_uri: REDIRECT_URI });
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.refresh_token) { toast('Dropbox sign-in failed: ' + (j.error_description || r.status)); return true; }
    localStorage.setItem('og_refresh', j.refresh_token);
    localStorage.removeItem('og_pkce'); localStorage.removeItem('og_state');
    this.access = j.access_token; this.exp = Date.now() + (j.expires_in - 60) * 1000;
    toast('Dropbox connected');
    return true;
  },
  disconnect() { localStorage.removeItem('og_refresh'); this.access = null; },
  async token() {
    if (this.access && Date.now() < this.exp) return this.access;
    const rt = localStorage.getItem('og_refresh');
    if (!rt) throw new Error('Dropbox not connected');
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST',
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: DROPBOX_KEY }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (r.status === 400 || r.status === 401) this.disconnect(); throw new Error('Dropbox sign-in expired. Connect again in Settings.'); }
    this.access = j.access_token; this.exp = Date.now() + (j.expires_in - 60) * 1000;
    return this.access;
  },
  async fail(r) {
    const t = await r.text(); let j = {};
    try { j = JSON.parse(t); } catch (e) { j = { error_summary: t }; }
    const e = new Error(j.error_summary || ('Dropbox error ' + r.status)); e.status = r.status; e.summary = j.error_summary || '';
    throw e;
  },
  async rpc(ep, args) {
    const r = await fetch('https://api.dropboxapi.com/2/' + ep, { method: 'POST',
      headers: { Authorization: 'Bearer ' + await this.token(), 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    if (!r.ok) await this.fail(r);
    return r.json();
  },
  async upload(path, blob, mode) {
    const r = await fetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST',
      headers: { Authorization: 'Bearer ' + await this.token(), 'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': apiArg({ path, mode: mode || 'add', autorename: false, mute: true }) }, body: blob });
    if (!r.ok) await this.fail(r);
    return r.json();
  },
  /* Returns {blob, meta} or null when the file isn't there. */
  async download(path) {
    const r = await fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST',
      headers: { Authorization: 'Bearer ' + await this.token(), 'Dropbox-API-Arg': apiArg({ path }) } });
    if (r.status === 409) {
      const t = await r.text();
      if (/not_found/.test(t)) return null;
      const e = new Error(t); e.status = 409; e.summary = t; throw e;
    }
    if (!r.ok) await this.fail(r);
    const blob = await r.blob();
    let meta = JSON.parse(r.headers.get('dropbox-api-result') || '{}');
    if (!meta.rev) meta = await this.rpc('files/get_metadata', { path });
    return { blob, meta };
  },
  move(from, to) { return this.rpc('files/move_v2', { from_path: from, to_path: to, autorename: false }); },
  del(path) { return this.rpc('files/delete_v2', { path }); },
  async exists(path) {
    try { await this.rpc('files/get_metadata', { path }); return true; } catch (e) { if (/not_found/.test(e.summary)) return false; throw e; }
  },
  async link(path) { return (await this.rpc('files/get_temporary_link', { path })).link; }
};

/* ---------- sync ---------- */
let syncing = false, syncTimer = null, syncAgain = false;
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(false), 4000); }
function onCellular() { return !!(navigator.connection && navigator.connection.type === 'cellular'); }
function setSyncMsg(m) { S.lastSyncMsg = m; saveSettings(); const el = document.getElementById('syncmsg'); if (el) el.textContent = syncLabel(); }
function syncLabel() {
  if (!DBX.connected()) return 'Not synced';
  if (syncing) return 'Syncing…';
  if (S.lastSyncMsg && S.lastSyncMsg !== 'ok') return S.lastSyncMsg;
  if (!S.lastSync) return 'Not synced yet';
  const mins = Math.round((Date.now() - S.lastSync) / 60000);
  return mins < 1 ? 'Synced just now' : mins < 60 ? 'Synced ' + mins + ' min ago' : 'Synced ' + new Date(S.lastSync).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
async function sync(manual) {
  if (!DBX.connected() || !navigator.onLine) { if (manual) toast(navigator.onLine ? 'Connect Dropbox in Settings first' : 'No internet connection'); return; }
  if (!manual && S.wifiOnly && onCellular()) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true; setSyncMsg('Syncing…');
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await DBX.download(DATA_PATH);
      let remoteText = null, rev = null;
      if (remote) {
        remoteText = await remote.blob.text(); rev = remote.meta.rev;
        const rd = JSON.parse(remoteText);
        if (mergeInto(D, rd)) await idb.put('kv', 'data', D);
      }
      await reconcileFiles();
      await idb.put('kv', 'data', D);
      const text = JSON.stringify(D);
      if (text === remoteText) break;
      try {
        await DBX.upload(DATA_PATH, new Blob([text], { type: 'application/json' }), rev ? { '.tag': 'update', update: rev } : { '.tag': 'add' });
        break;
      } catch (e) {
        if (e.status === 409 && attempt < 2) continue; // the other phone saved first: pull again and merge
        throw e;
      }
    }
    S.lastSync = Date.now(); syncing = false; setSyncMsg('ok');
    if (manual) toast('Synced');
    render();
  } catch (e) {
    syncing = false; setSyncMsg('Sync failed: ' + e.message.slice(0, 80));
    if (manual) toast('Sync failed: ' + e.message.slice(0, 120));
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(); }
  }
}
/* Upload new files, move files whose place changed (filed, renamed, archived), delete removed ones. */
async function reconcileFiles() {
  for (const f of Object.values(D.files)) {
    if (f.deleted) {
      if (f.path && !f.remoteGone) {
        try { await DBX.del(f.path); } catch (e) { if (!/not_found/.test(e.summary)) throw e; }
        try { await DBX.del(thumbPath(f.id)); } catch (e) { /* no thumb */ }
        f.remoteGone = true; touch(f);
      }
      await idb.del('blobs', f.id);
      continue;
    }
    const want = desiredPath(f);
    if (!f.uploaded) {
      const blob = await idb.get('blobs', f.id);
      if (!blob) continue; // added on the other phone; it will upload it
      let res;
      try { res = await DBX.upload(want, blob, 'add'); }
      catch (e) { if (/conflict/.test(e.summary)) res = { path_display: want }; else throw e; }
      const th = await idb.get('thumbs', f.id);
      if (th) await DBX.upload(thumbPath(f.id), th, 'overwrite');
      f.path = res.path_display; f.uploaded = true; touch(f);
      await idb.del('blobs', f.id);
      continue;
    }
    if (f.path && f.path.toLowerCase() !== want.toLowerCase()) {
      try { await DBX.move(f.path, want); f.path = want; touch(f); }
      catch (e) {
        if (/not_found|conflict/.test(e.summary) && await DBX.exists(want)) { f.path = want; touch(f); }
        else if (!/not_found/.test(e.summary)) throw e;
      }
    }
  }
}

/* ---------- thumbnails ---------- */
const thumbUrls = {};
async function thumbUrl(f) {
  if (thumbUrls[f.id]) return thumbUrls[f.id];
  let b = await idb.get('thumbs', f.id);
  if (!b && f.uploaded && f.mime !== 'application/pdf' && DBX.connected() && navigator.onLine) {
    const item = f.itemId && D.items[f.itemId];
    if (item && item.archived) return null;
    try { const r = await DBX.download(thumbPath(f.id)); if (r) { b = r.blob; await idb.put('thumbs', f.id, b); } } catch (e) { /* offline */ }
  }
  if (!b) return null;
  thumbUrls[f.id] = URL.createObjectURL(b);
  return thumbUrls[f.id];
}
async function dropThumb(id) {
  if (thumbUrls[id]) { URL.revokeObjectURL(thumbUrls[id]); delete thumbUrls[id]; }
  await idb.del('thumbs', id);
}
async function hydrateThumbs() {
  const imgs = document.querySelectorAll('img[data-thumb]');
  for (const img of imgs) {
    const f = D.files[img.dataset.thumb];
    if (!f) continue;
    const u = await thumbUrl(f);
    if (u && img.isConnected) img.src = u;
  }
}
/* Open the full file: local copy if not yet uploaded, otherwise a short-lived Dropbox link. */
async function openFile(f) {
  const blob = await idb.get('blobs', f.id);
  if (blob) { window.open(URL.createObjectURL(blob), '_blank'); return; }
  if (!f.uploaded) { toast('This file is still on the other phone. It appears after that phone syncs.'); return; }
  if (!DBX.connected() || !navigator.onLine) { toast('Needs internet and Dropbox to open the full file'); return; }
  const w = window.open('', '_blank');
  try { const link = await DBX.link(f.path); if (w) w.location = link; else location.href = link; }
  catch (e) { if (w) w.close(); toast('Could not open: ' + e.message.slice(0, 100)); }
}
/* ---------- images: crop, rotate, straighten, document clean-up, compression ---------- */
function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
async function loadSource(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
  const s = Math.min(1, 2400 / Math.max(w, h));
  const c = newCanvas(w * s, h * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}
function rotateCanvas(src, quarter, deg) {
  const ang = ((quarter * 90) + deg) * Math.PI / 180;
  const w = src.width, h = src.height, cos = Math.abs(Math.cos(ang)), sin = Math.abs(Math.sin(ang));
  const c = newCanvas(w * cos + h * sin, w * sin + h * cos);
  const x = c.getContext('2d');
  x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, c.width, c.height);
  x.translate(c.width / 2, c.height / 2); x.rotate(ang); x.drawImage(src, -w / 2, -h / 2);
  return c;
}
/* Greyscale, stretch paper to white and ink to black. Helps faded thermal receipts. */
function documentFilter(c) {
  const x = c.getContext('2d');
  const im = x.getImageData(0, 0, c.width, c.height), d = im.data, hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = g; hist[g]++; }
  const total = d.length / 4;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.25) { hi = v; break; } }
  if (hi - lo < 30) { lo = Math.max(0, hi - 30); }
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) { const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo))); lut[v] = Math.round(255 * Math.pow(t, 1.6)); }
  for (let i = 0; i < d.length; i += 4) { const g = lut[d[i]]; d[i] = d[i + 1] = d[i + 2] = g; }
  x.putImageData(im, 0, 0);
}
function canvasBlob(c, q) { return new Promise((res) => c.toBlob(res, 'image/jpeg', q)); }
function scaledCopy(src, maxSide) {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  const c = newCanvas(src.width * s, src.height * s), x = c.getContext('2d');
  x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
/* Final saved image: receipts in black and white (smaller), photos in colour. */
async function finishImage(work, crop, docMode) {
  const cut = newCanvas(crop.w, crop.h);
  cut.getContext('2d').drawImage(work, crop.x, crop.y, crop.w, crop.h, 0, 0, cut.width, cut.height);
  const out = scaledCopy(cut, 1600);
  if (docMode) documentFilter(out);
  const full = await canvasBlob(out, docMode ? 0.6 : 0.78);
  const thumb = await canvasBlob(scaledCopy(out, 320), 0.7);
  return { full, thumb };
}
/* A shared image goes straight to the inbox: colour, compressed, no crop. */
async function quickCompress(file) {
  const src = await loadSource(file);
  return finishImage(src, { x: 0, y: 0, w: src.width, h: src.height }, false);
}

/* ---------- crop screen state ---------- */
let SNAP = null; // { step, file, isPdf, src, quarter, deg, docMode, work, crop, view, itemId, result }
async function startSnap(file, itemId) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  SNAP = { step: isPdf ? 'details' : 'crop', file, isPdf, quarter: 0, deg: 0, docMode: true, itemId: itemId || null,
    kind: isPdf ? 'Tax invoice' : 'Receipt', date: todayISO(), store: '', total: '' };
  if (!isPdf) {
    try { SNAP.src = await loadSource(file); }
    catch (e) { toast('Could not read that image'); SNAP = null; return; }
    rebuildWork();
  }
  go('#/snap');
}
function rebuildWork() {
  SNAP.work = rotateCanvas(SNAP.src, SNAP.quarter, SNAP.deg);
  const m = Math.round(Math.min(SNAP.work.width, SNAP.work.height) * 0.04);
  SNAP.crop = { x: m, y: m, w: SNAP.work.width - 2 * m, h: SNAP.work.height - 2 * m };
}
function drawCropView() {
  const wrap = document.getElementById('cropwrap');
  if (!wrap || !SNAP || !SNAP.work) return;
  const maxW = Math.min(wrap.parentElement.clientWidth, 600), maxH = Math.max(260, window.innerHeight - 330);
  const s = Math.min(maxW / SNAP.work.width, maxH / SNAP.work.height);
  SNAP.view = s;
  const cv = document.getElementById('cropcanvas');
  cv.width = Math.round(SNAP.work.width * s); cv.height = Math.round(SNAP.work.height * s);
  cv.getContext('2d').drawImage(SNAP.work, 0, 0, cv.width, cv.height);
  wrap.style.width = cv.width + 'px'; wrap.style.height = cv.height + 'px';
  placeCropRect();
}
function placeCropRect() {
  const r = document.getElementById('croprect'), s = SNAP.view, c = SNAP.crop;
  r.style.left = c.x * s + 'px'; r.style.top = c.y * s + 'px'; r.style.width = c.w * s + 'px'; r.style.height = c.h * s + 'px';
}
function bindCropDrag() {
  const wrap = document.getElementById('cropwrap');
  if (!wrap) return;
  let drag = null;
  wrap.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.h'), inRect = e.target.closest('#croprect');
    if (!h && !inRect) return;
    e.preventDefault();
    drag = { mode: h ? h.dataset.c : 'move', x: e.clientX, y: e.clientY, start: Object.assign({}, SNAP.crop) };
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const s = SNAP.view, dx = (e.clientX - drag.x) / s, dy = (e.clientY - drag.y) / s;
    const W = SNAP.work.width, H = SNAP.work.height, min = 60 / s, st = drag.start;
    let { x, y, w, h } = st;
    if (drag.mode === 'move') {
      x = Math.min(Math.max(0, st.x + dx), W - st.w); y = Math.min(Math.max(0, st.y + dy), H - st.h);
    } else {
      let x2 = st.x + st.w, y2 = st.y + st.h;
      if (drag.mode.includes('l')) x = Math.min(Math.max(0, st.x + dx), x2 - min);
      if (drag.mode.includes('r')) x2 = Math.max(Math.min(W, x2 + dx), x + min);
      if (drag.mode.includes('t')) y = Math.min(Math.max(0, st.y + dy), y2 - min);
      if (drag.mode.includes('b')) y2 = Math.max(Math.min(H, y2 + dy), y + min);
      w = x2 - x; h = y2 - y;
    }
    SNAP.crop = { x, y, w, h };
    placeCropRect();
  });
  const end = () => { drag = null; };
  wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end);
}
/* ---------- UI helpers ---------- */
const $ = (sel) => document.querySelector(sel);
function toast(msg) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.tm); toast.tm = setTimeout(() => { t.hidden = true; }, 3200);
}
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function groupBy(arr, key) { const o = {}; arr.forEach((x) => { (o[x[key]] = o[x[key]] || []).push(x); }); return o; }
function badge(st) { return '<span class="badge b-' + st.kind + '">' + esc(st.label) + '</span>'; }
function opt(v, cur, label) { return '<option value="' + esc(v) + '"' + (String(v) === String(cur == null ? '' : cur) ? ' selected' : '') + '>' + esc(label == null ? v : label) + '</option>'; }
const I = {
  back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 11l8-7 8 7v9H4z"/></svg>',
  list: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  cam: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  inbox: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 13l3-8h10l3 8v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/></svg>',
  gear: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
  sync: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/></svg>'
};
function logoSVG(size) {
  const fg = 'fill:var(--logo-fg)', st = 'fill:none;stroke:var(--logo-fg);stroke-linecap:round;stroke-linejoin:round', kn = 'fill:var(--hdr-bg)';
  let teeth = '';
  for (let i = 0; i < 8; i++) teeth += '<rect x="341" y="312" width="22" height="26" rx="4" style="' + fg + '" transform="rotate(' + (i * 45) + ' 352 372)"/>';
  const rec = 'M198 328 H302 V442 L285 428 L267 442 L250 428 L232 442 L215 428 L198 442 Z';
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 512 512" role="img" aria-label="Our Gear logo">' +
    '<path d="M256 76 L396 124 V244 C396 336 338 394 256 418 C174 394 116 336 116 244 V124 Z" style="' + st + ';stroke-width:26"/>' +
    '<path d="M160 256 L250 178 L322 240" style="' + st + ';stroke-width:24"/>' +
    '<path d="M316 176 L338 198 L372 156" style="' + st + ';stroke-width:26"/>' +
    [[186, 256], [218, 256], [186, 288], [218, 288]].map((p) => '<rect x="' + p[0] + '" y="' + p[1] + '" width="26" height="26" rx="4" style="' + fg + '"/>').join('') +
    '<path d="' + rec + '" style="' + kn + ';stroke:var(--hdr-bg);stroke-width:44;stroke-linejoin:round"/>' +
    '<path d="' + rec + '" style="' + kn + ';stroke:var(--logo-fg);stroke-width:20;stroke-linejoin:round"/>' +
    '<path d="M226 362 H278 M226 390 H278" style="' + st + ';stroke-width:14"/>' +
    '<circle cx="352" cy="372" r="68" style="' + kn + '"/>' + teeth +
    '<circle cx="352" cy="372" r="42" style="' + fg + '"/><circle cx="352" cy="372" r="17" style="' + kn + '"/></svg>';
}
function header(title, opts) {
  const o = opts || {};
  return '<header class="hdr"><div class="hdr-row">' +
    (o.back ? '<a class="iconbtn" href="' + esc(o.back) + '" aria-label="Back">' + I.back + '</a>' : (o.logo ? logoSVG(36) : '')) +
    '<div style="flex:1;min-width:0"><h1>' + esc(title) + '</h1>' + (o.sub ? '<div class="sub">' + esc(o.sub) + '</div>' : '') + '</div>' +
    (o.right || '') + '</div>' + (o.extra || '') + '</header>';
}
function nav(active) {
  const n = inboxFiles().length;
  const a = (id, href, icon, label, cls) => '<a href="' + href + '"' + (active === id ? ' aria-current="page"' : '') + (cls ? ' class="' + cls + '"' : '') + '>' + icon + label + '</a>';
  return '<nav class="nav">' + a('home', '#/home', I.home, 'Home') + a('items', '#/items', I.list, 'Items') +
    a('snap', '#/snap', '<span class="ring">' + I.cam + '</span>', 'Snap', 'snap') +
    '<a href="#/inbox"' + (active === 'inbox' ? ' aria-current="page"' : '') + '>' + I.inbox + 'Inbox' + (n ? '<span class="dot">' + n + '</span>' : '') + '</a>' +
    a('settings', '#/settings', I.gear, 'Settings') + '</nav>';
}
function syncButton() {
  return '<button class="iconbtn" data-act="syncnow" aria-label="Sync now">' + I.sync + '</button>';
}

/* ---------- views ---------- */
let ITEMS_F = { q: '', prop: 'all', cat: '', arch: false };
let ITEM_TAB = 'details';
let SNAP_TARGET = null;

function viewHome() {
  const items = live('items').filter((i) => !i.archived);
  const byItem = groupBy(live('warranties'), 'itemId');
  const soon = []; let life = 0;
  items.forEach((it) => (byItem[it.id] || []).forEach((w) => {
    const s = warrantyStatus(w, it);
    if (s.kind === 'soon') soon.push({ it, w, s });
    if (s.kind === 'life') life++;
  }));
  soon.sort((a, b) => a.s.days - b.s.days);
  const sugg = items.filter((i) => suggestArchive(i, byItem[i.id] || []));
  const inbox = inboxFiles().length;
  let h = header('Our Gear', { logo: true, right: '<div class="sync" id="syncmsg">' + esc(syncLabel()) + '</div>' + syncButton() });
  h += '<main>';
  h += '<a class="btn primary big" href="#/snap">' + I.cam + 'Snap a receipt</a>';
  h += '<div class="stats">' +
    '<a class="stat" href="#/inbox"><div class="l">Inbox to file</div><div class="n">' + inbox + '</div></a>' +
    '<a class="stat" href="#/items"><div class="l">Expiring in 90 days</div><div class="n" style="color:#8A5A00">' + soon.length + '</div></a>' +
    '<a class="stat" href="#/items"><div class="l">Items</div><div class="n">' + items.length + '</div></a>' +
    '<a class="stat" href="#/items"><div class="l">Lifetime warranties</div><div class="n">' + life + '</div></a></div>';
  h += '<section class="section"><div class="section-head"><h2>Expiring soon</h2></div>';
  if (soon.length) {
    h += '<div class="card list">' + soon.slice(0, 6).map((x) =>
      '<a class="row" href="#/item/' + x.it.id + '"><div class="grow"><div class="t">' + esc(x.it.name) + '</div><div class="s">' +
      esc((x.w.type || 'Warranty') + (x.w.covers ? ' (' + x.w.covers + ')' : '') + ' · ends ' + fmtDate(x.s.expiry)) + '</div></div>' + badge(x.s) + '</a>').join('') + '</div>';
  } else h += '<div class="card empty">Nothing expiring in the next 90 days.</div>';
  h += '</section>';
  if (sugg.length) {
    h += '<a class="card pad row" href="#/suggest" style="border-bottom:1px solid var(--border)"><div class="grow"><div class="t">' + sugg.length + ' item' + (sugg.length > 1 ? 's' : '') + ' could be archived</div>' +
      '<div class="s">Gone from the house, or warranties ended over 2 years ago</div></div><span class="badge b-arch">Review</span></a>';
  }
  if (!DBX.connected()) h += '<div class="warn">Dropbox isn\'t connected, so nothing is backed up yet. <a href="#/settings">Connect in Settings</a>.</div>';
  return h + '</main>' + nav('home');
}

function filteredItems() {
  const q = ITEMS_F.q.trim().toLowerCase();
  const byItem = groupBy(live('warranties'), 'itemId');
  return live('items').filter((i) => (ITEMS_F.arch || !i.archived) &&
    (ITEMS_F.prop === 'all' || i.propertyId === ITEMS_F.prop) && (!ITEMS_F.cat || i.category === ITEMS_F.cat) &&
    (!q || [i.name, i.brand, i.model, i.serial, i.store, i.notes, i.location, i.spot].some((v) => v && String(v).toLowerCase().includes(q))))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => ({ i, st: i.archived ? { kind: 'arch', label: 'Archived' } : itemStatus(i, byItem[i.id] || []) }));
}
function itemsListHTML() {
  const rows = filteredItems();
  if (!rows.length) return '<div class="card empty">' + (live('items').length ? 'No items match.' : 'No items yet. Snap a receipt or tap + to add one.') + '</div>';
  return '<div class="card list">' + rows.map(({ i, st }) =>
    '<a class="row" href="#/item/' + i.id + '"><div class="grow"><div class="t">' + esc(i.name) + '</div><div class="s">' +
    esc([i.category, propName(i.propertyId) + (i.location ? ', ' + i.location : '')].filter(Boolean).join(' · ')) + '</div></div>' + badge(st) + '</a>').join('') + '</div>';
}
function viewItems() {
  const props = D.lists.properties;
  let h = header('Items', { right: '<a class="iconbtn" href="#/new" aria-label="Add item" style="background:var(--accent);color:var(--accent-ink)">' + I.plus + '</a>' });
  h += '<main><label class="search">' + I.search + '<span class="sr">Search</span><input id="q" type="search" placeholder="Name, brand, model, serial, store" value="' + esc(ITEMS_F.q) + '"></label>';
  h += '<div class="chips">' + '<button class="chip" data-act="fprop" data-v="all" aria-pressed="' + (ITEMS_F.prop === 'all') + '">All</button>' +
    props.map((p) => '<button class="chip" data-act="fprop" data-v="' + esc(p.id) + '" aria-pressed="' + (ITEMS_F.prop === p.id) + '">' + esc(p.name) + '</button>').join('') +
    '<button class="chip" data-act="farch" aria-pressed="' + ITEMS_F.arch + '">Include archived</button></div>';
  h += '<label class="field"><span>Category</span><select id="fcat">' + opt('', ITEMS_F.cat, 'All categories') + D.lists.categories.map((c) => opt(c, ITEMS_F.cat)).join('') + '</select></label>';
  h += '<div id="itemlist">' + itemsListHTML() + '</div></main>';
  return h + nav('items');
}

function viewItem(id) {
  const it = D.items[id];
  if (!it || it.deleted) return header('Not found', { back: '#/items' }) + '<main><div class="card empty">This item was deleted.</div></main>' + nav('items');
  const p = propById(it.propertyId);
  const tabs = '<div class="tabs" role="tablist">' + ['details', 'warranties', 'files'].map((t) =>
    '<button role="tab" data-act="tab" data-v="' + t + '" aria-selected="' + (ITEM_TAB === t) + '">' + t[0].toUpperCase() + t.slice(1) + '</button>').join('') + '</div>';
  let h = header(it.name, { back: '#/items', sub: [it.brand, it.model].filter(Boolean).join(' ') + (it.brand || it.model ? ' · ' : '') + propName(it.propertyId) + (it.location ? ', ' + it.location : ''), extra: tabs });
  h += '<main>';
  if (it.archived) h += '<div class="note">Archived. Files are in the Dropbox archive folder and still searchable. <button class="btn quiet" style="margin-top:8px;width:100%" data-act="restore" data-id="' + id + '">Restore</button></div>';
  if (ITEM_TAB === 'details') {
    const kv = [['Category', it.category], ['Brand', it.brand], ['Model', it.model], ['Serial', it.serial],
      ['Property', p ? p.name + ' (' + p.type + ')' : ''], ['Location', it.location], ['Exact spot', it.spot], ['Owner', it.owner],
      ['Store', it.store], ['Purchased', fmtDate(it.purchaseDate)], ['Installed', fmtDate(it.installDate)], ['Price paid', fmtMoney(it.price)],
      ['Replacement value', fmtMoney(it.replacementValue)], ['Status', it.status || 'Active'], ['Work deduction', it.work ? 'Yes' : ''], ['Notes', it.notes]]
      .filter((r) => r[1]);
    h += '<div class="card kv">' + kv.map((r) => '<div>' + esc(r[0]) + '</div><div style="white-space:pre-line">' + esc(r[1]) + '</div>').join('') + '</div>';
    h += '<div class="btns"><a class="btn primary" href="#/item/' + id + '/edit">Edit</a>' +
      (it.archived ? '<button class="btn" data-act="restore" data-id="' + id + '">Restore</button>' : '<button class="btn" data-act="archive" data-id="' + id + '">Archive</button>') + '</div>';
    h += '<button class="btn danger" data-act="delitem" data-id="' + id + '">Delete item</button>';
  } else if (ITEM_TAB === 'warranties') {
    const ws = itemWarranties(id);
    const sts = ws.map((w) => warrantyStatus(w, it));
    h += ws.map((w, n) => {
      const s = sts[n];
      const term = w.termUnit === 'lifetime' ? 'Lifetime' : (w.termValue ? w.termValue + ' ' + (w.termUnit === 'years' ? (+w.termValue === 1 ? 'year' : 'years') : (+w.termValue === 1 ? 'month' : 'months')) : 'No term set');
      const from = w.startFrom === 'install' ? 'from install' : w.startFrom === 'custom' ? 'from ' + fmtDate(w.startDate) : 'from purchase';
      return '<a class="card pad" href="#/warranty/' + id + '/' + w.id + '" style="display:flex;flex-direction:column;gap:6px;text-decoration:none;color:var(--text)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="t" style="font-weight:700">' + esc((w.type || 'Warranty') + ' warranty') + '</span>' + badge(s) + '</div>' +
        '<div class="muted">' + esc((w.covers || 'Whole item') + ' · ' + term + (w.termUnit === 'lifetime' ? '' : ' ' + from)) + '</div>' +
        (s.expiry ? '<div style="font-size:14px">' + (s.kind === 'gone' ? 'Ended ' : 'Ends ') + esc(fmtDate(s.expiry)) + '</div>' : '') +
        (w.provider ? '<div class="muted">' + esc(w.provider + (w.contact ? ' · ' + w.contact : '')) + '</div>' : '') +
        (w.conditions ? '<div class="muted" style="white-space:pre-line">' + esc(w.conditions) + '</div>' : '') + '</a>';
    }).join('');
    if (!ws.length) h += '<div class="card empty">No warranties recorded.</div>';
    h += '<a class="btn primary" href="#/warranty/' + id + '/new">Add warranty</a>';
    if (sts.some((s) => s.kind === 'life') && !itemFiles(id).some((f) => f.kind === 'Receipt' || f.kind === 'Tax invoice'))
      h += '<div class="warn">Lifetime warranty with no receipt saved. A lifetime claim needs proof of purchase, so add the receipt.</div>';
    if (sts.some((s) => s.kind === 'gone')) h += '<div class="note">After a maker\'s warranty ends, Australian Consumer Law guarantees may still apply.</div>';
  } else {
    const fs = itemFiles(id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    h += fs.length ? '<div class="inbox-grid">' + fs.map(fileTile).join('') + '</div>' : '<div class="card empty">No files yet.</div>';
    h += '<button class="btn primary" data-act="addfile" data-id="' + id + '">Add receipt or file</button>';
  }
  return h + '</main>' + nav('items');
}
function fileTile(f) {
  const pic = f.mime === 'application/pdf' ? '<div class="ph">PDF</div>' : '<img data-thumb="' + f.id + '" alt="' + esc(f.kind) + '">';
  return '<button data-act="filesheet" data-id="' + f.id + '">' + pic + '<div class="cap">' + esc(f.kind) + '</div><div class="cap">' + esc(fmtDate(f.date) || 'No date') + (f.store ? ' · ' + esc(f.store) : '') + '</div></button>';
}

function viewItemEdit(id) {
  const isNew = !id;
  const it = isNew ? Object.assign({ propertyId: (D.lists.properties[0] || {}).id, owner: S.owner === 'Lyndsey' ? 'Lyndsey' : 'Shared', status: 'Active' }, NEW_ITEM_PREFILL || {}) : D.items[id];
  if (!it) return viewItems();
  const stores = Array.from(new Set(live('items').map((i) => i.store).concat(live('files').map((f) => f.store)).filter(Boolean))).sort();
  const f = (name, label, val, type, extra) => '<label class="field' + (extra === 'req' ? ' req' : '') + '"><span>' + label + '</span><input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '"' + (type === 'number' ? ' inputmode="decimal" step="0.01" min="0"' : '') + (extra && extra !== 'req' ? ' ' + extra : '') + (extra === 'req' ? ' required' : '') + '></label>';
  let h = header(isNew ? 'New item' : 'Edit item', { back: isNew ? '#/items' : '#/item/' + id });
  h += '<main><form class="form" data-form="item" data-id="' + esc(id || '') + '">';
  h += f('name', 'Item name', it.name, 'text', 'req');
  h += '<label class="field"><span>Category</span><select name="category">' + opt('', it.category, 'Choose…') + D.lists.categories.map((c) => opt(c, it.category)).join('') + '</select></label>';
  h += '<div class="grid2">' + f('brand', 'Brand', it.brand) + f('model', 'Model', it.model) + '</div>';
  h += f('serial', 'Serial number', it.serial);
  h += '<label class="field"><span>Property</span><select name="propertyId">' + D.lists.properties.map((p) => opt(p.id, it.propertyId, p.name + ' (' + p.type + ')')).join('') + '</select></label>';
  h += '<div class="grid2"><label class="field"><span>Location</span><input name="location" list="locs" value="' + esc(it.location || '') + '" placeholder="Living"></label>' +
    '<label class="field"><span>Owner</span><select name="owner">' + OWNERS.map((o) => opt(o, it.owner)).join('') + '</select></label></div>';
  h += '<datalist id="locs">' + D.lists.locations.map((l) => '<option value="' + esc(l) + '">').join('') + '</datalist>';
  h += f('spot', 'Exact spot', it.spot, 'text', 'placeholder="Indoor unit north wall, outdoor unit side path"');
  h += '<label class="field"><span>Store</span><input name="store" list="stores" value="' + esc(it.store || '') + '"></label><datalist id="stores">' + stores.map((s) => '<option value="' + esc(s) + '">').join('') + '</datalist>';
  h += '<div class="grid2">' + f('purchaseDate', 'Purchase date', it.purchaseDate, 'date') + f('installDate', 'Install date', it.installDate, 'date') + '</div>';
  h += '<div class="grid2">' + f('price', 'Price paid (AUD)', it.price, 'number') + f('replacementValue', 'Replacement value (AUD)', it.replacementValue, 'number') + '</div>';
  h += '<label class="field"><span>Status</span><select name="status">' + ITEM_STATUS.map((s) => opt(s, it.status || 'Active')).join('') + '</select></label>';
  h += '<label class="check"><input type="checkbox" name="work"' + (it.work ? ' checked' : '') + '> Work deduction (for Our Tax)</label>';
  h += '<label class="field"><span>Notes</span><textarea name="notes">' + esc(it.notes || '') + '</textarea></label>';
  h += '<button class="btn primary big" type="submit">' + (isNew ? 'Add item' : 'Save') + '</button></form></main>';
  return h + nav('items');
}
let NEW_ITEM_PREFILL = null;

function viewWarranty(itemId, wid) {
  const it = D.items[itemId];
  if (!it) return viewItems();
  const isNew = wid === 'new';
  const w = isNew ? { type: 'Maker', startFrom: 'purchase', termUnit: 'years', termValue: '' } : D.warranties[wid];
  if (!w) return viewItem(itemId);
  let h = header(isNew ? 'Add warranty' : 'Edit warranty', { back: '#/item/' + itemId, sub: it.name });
  h += '<main><form class="form" data-form="warranty" data-item="' + itemId + '" data-id="' + esc(isNew ? '' : wid) + '">';
  h += '<div class="grid2"><label class="field"><span>Type</span><select name="type">' + D.lists.warrantyTypes.map((t) => opt(t, w.type)).join('') + '</select></label>' +
    '<label class="field"><span>Covers</span><input name="covers" value="' + esc(w.covers || '') + '" placeholder="Whole item"></label></div>';
  h += '<div class="grid2"><label class="field"><span>Term</span><input name="termValue" type="number" inputmode="numeric" min="0" step="1" value="' + esc(w.termValue || '') + '"></label>' +
    '<label class="field"><span>Unit</span><select name="termUnit">' + opt('years', w.termUnit, 'Years') + opt('months', w.termUnit, 'Months') + opt('lifetime', w.termUnit, 'Lifetime') + '</select></label></div>';
  h += '<label class="field"><span>Starts from</span><select name="startFrom">' + opt('purchase', w.startFrom, 'Purchase date') + opt('install', w.startFrom, 'Install date') + opt('custom', w.startFrom, 'Another date') + '</select></label>';
  h += '<label class="field"><span>Start date (if another date)</span><input name="startDate" type="date" value="' + esc(w.startDate || '') + '"></label>';
  h += '<label class="field"><span>Expiry date override (leave blank to work it out)</span><input name="expiryOverride" type="date" value="' + esc(w.expiryOverride || '') + '"></label>';
  h += '<div class="grid2"><label class="field"><span>Provider</span><input name="provider" value="' + esc(w.provider || '') + '"></label>' +
    '<label class="field"><span>Phone or website</span><input name="contact" value="' + esc(w.contact || '') + '"></label></div>';
  h += '<label class="field"><span>Conditions</span><textarea name="conditions" placeholder="Original purchaser only, registration needed, parts only…">' + esc(w.conditions || '') + '</textarea></label>';
  h += '<div class="muted" id="wpreview"></div>';
  h += '<button class="btn primary big" type="submit">Save warranty</button>';
  if (!isNew) h += '<button class="btn danger" type="button" data-act="delwarranty" data-id="' + wid + '">Delete warranty</button>';
  h += '</form></main>';
  return h + nav('items');
}

function viewInbox() {
  const fs = inboxFiles().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  let h = header('Inbox', { sub: fs.length ? fs.length + ' to file' : 'All filed' });
  h += '<main>';
  h += fs.length ? '<div class="inbox-grid">' + fs.map(fileTile).join('') + '</div>' : '<div class="card empty">Nothing waiting. Snap a receipt, or share a PDF or photo to Our Gear from another app.</div>';
  return h + '</main>' + nav('inbox');
}

function viewSnap() {
  if (!SNAP) {
    const target = SNAP_TARGET && D.items[SNAP_TARGET];
    let h = header(target ? 'Add file' : 'Snap', { back: target ? '#/item/' + target.id : '', sub: target ? target.name : 'Receipts, invoices, manuals and photos' });
    h += '<main><div class="snapstart">' +
      '<label class="btn primary big" for="camIn">' + I.cam + 'Take photo</label><input id="camIn" class="sr" type="file" accept="image/*" capture="environment">' +
      '<label class="btn big" for="pickIn">Choose photo or PDF</label><input id="pickIn" class="sr" type="file" accept="image/*,application/pdf">' +
      '<p class="muted">Tip: snap thermal receipts on the day. They fade.</p></div></main>';
    return h + nav('snap');
  }
  if (SNAP.step === 'crop') {
    let h = header('Crop', { right: '<button class="iconbtn" data-act="snapcancel" aria-label="Cancel" style="font-size:14px;width:auto;padding:0 8px">Cancel</button>' });
    h += '<main><div class="snapbody">' +
      '<div id="cropwrap" class="cropwrap"><canvas id="cropcanvas"></canvas><div id="croprect" class="croprect">' +
      '<span class="h tl" data-c="tl"></span><span class="h tr" data-c="tr"></span><span class="h bl" data-c="bl"></span><span class="h br" data-c="br"></span></div></div>' +
      '<div class="btns three"><button class="darkbtn" data-act="rot">Rotate</button><button class="darkbtn" data-act="cropall">Full photo</button>' +
      '<button class="darkbtn" data-act="docmode" aria-pressed="' + SNAP.docMode + '">Document</button></div>' +
      '<label class="slider">Straighten<input id="deg" type="range" min="-15" max="15" step="0.5" value="' + SNAP.deg + '"><span id="degv">' + SNAP.deg + '°</span></label>' +
      '<button class="btn primary big" data-act="cropnext">Next</button></div></main>';
    return h + nav('snap');
  }
  const it = SNAP.itemId && D.items[SNAP.itemId];
  let h = header('Details', { right: '<button class="iconbtn" data-act="snapcancel" aria-label="Cancel" style="font-size:14px;width:auto;padding:0 8px">Cancel</button>', sub: it ? 'For ' + it.name : '' });
  h += '<main>' + (SNAP.isPdf ? '<div class="card empty">PDF: ' + esc(SNAP.file.name || 'document') + '</div>' : '<img class="preview" id="snapprev" alt="Cropped image">');
  h += '<form class="form" data-form="snap">';
  h += '<label class="field"><span>What is it?</span><select name="kind">' + FILE_KINDS.map((k) => opt(k, SNAP.kind)).join('') + '</select></label>';
  h += '<div class="grid2"><label class="field"><span>Date</span><input name="date" type="date" value="' + esc(SNAP.date) + '"></label>' +
    '<label class="field"><span>Total (AUD)</span><input name="total" type="number" inputmode="decimal" step="0.01" min="0" value="' + esc(SNAP.total) + '"></label></div>';
  h += '<label class="field"><span>Store</span><input name="store" value="' + esc(SNAP.store) + '"></label>';
  h += it ? '<button class="btn primary big" type="submit" name="dest" value="item">Save to ' + esc(it.name) + '</button>'
    : '<div class="btns"><button class="btn" type="submit" name="dest" value="inbox">Save to inbox</button><button class="btn primary" type="submit" name="dest" value="file">File to item</button></div>';
  h += '</form></main>';
  return h + nav('snap');
}

function viewSuggest() {
  const byItem = groupBy(live('warranties'), 'itemId');
  const items = live('items').filter((i) => suggestArchive(i, byItem[i.id] || []));
  let h = header('Archive suggestions', { back: '#/home', sub: items.length + ' item' + (items.length === 1 ? '' : 's') });
  h += '<main>';
  if (!items.length) h += '<div class="card empty">Nothing to archive.</div>';
  else {
    h += '<div class="card list">' + items.map((i) => '<a class="row" href="#/item/' + i.id + '"><div class="grow"><div class="t">' + esc(i.name) + '</div><div class="s">' +
      esc(i.status && i.status !== 'Active' ? i.status : 'Warranties ended over 2 years ago') + '</div></div></a>').join('') + '</div>';
    h += '<button class="btn primary big" data-act="archiveall">Archive all ' + items.length + '</button><p class="muted">Archived items stay searchable and can be restored any time.</p>';
  }
  return h + '</main>' + nav('home');
}

function viewSettings() {
  const props = D.lists.properties;
  let h = header('Settings', { sub: 'Our Gear ' + APP_VERSION });
  h += '<main>';
  h += '<section class="section"><h2>Dropbox</h2><div class="card pad form">';
  if (DBX.connected()) {
    h += '<div>Connected. <span id="syncmsg">' + esc(syncLabel()) + '</span></div>' +
      '<div class="btns"><button class="btn primary" data-act="syncnow">Sync now</button><button class="btn quiet" data-act="dbxoff">Disconnect</button></div>';
  } else {
    h += '<div class="muted">Sign in to the shared Dropbox account. Both phones use the same account so they share one set of records.</div>' +
      '<button class="btn primary" data-act="dbxon">Connect Dropbox</button>';
  }
  h += '<label class="check"><input type="checkbox" data-act="wifionly"' + (S.wifiOnly ? ' checked' : '') + '> Sync automatically on Wi-Fi only</label></div></section>';
  h += '<section class="section"><h2>This phone</h2><div class="card pad form"><label class="field"><span>Who uses this phone?</span><select id="ownerSel">' +
    ['Shaun', 'Lyndsey'].map((o) => opt(o, S.owner)).join('') + '</select></label>' +
    '<div class="field"><span>Theme</span></div><div class="swatches">' + THEMES.map((t) =>
      '<button class="swatch" data-act="theme" data-v="' + t.id + '" aria-pressed="' + (S.theme === t.id) + '"><i style="background:' + t.a + ';border:6px solid ' + t.b + '"></i>' + esc(t.name) + '</button>').join('') + '</div></div></section>';
  h += '<section class="section"><div class="section-head"><h2>Properties</h2><button class="btn quiet" style="min-height:36px" data-act="propsheet" data-id="">Add</button></div><div class="card list">' +
    props.map((p) => '<button class="row" data-act="propsheet" data-id="' + esc(p.id) + '"><div class="grow"><div class="t">' + esc(p.name) + '</div><div class="s">' + esc(p.type + (p.address ? ' · ' + p.address : '')) + '</div></div></button>').join('') + '</div></section>';
  h += '<section class="section"><h2>Lists</h2><div class="card pad form">' +
    [['categories', 'Categories'], ['locations', 'Locations'], ['warrantyTypes', 'Warranty types']].map((x) =>
      '<label class="field"><span>' + x[1] + ' (one per line)</span><textarea id="list-' + x[0] + '" rows="5">' + esc(D.lists[x[0]].join('\n')) + '</textarea></label>').join('') +
    '<button class="btn primary" data-act="savelists">Save lists</button></div></section>';
  h += '<section class="section"><h2>Backup</h2><div class="card pad form"><div class="muted">Dropbox already holds everything. This is an extra copy of your records and previews in one file.</div>' +
    '<div class="btns"><button class="btn" data-act="export">Save backup file</button><label class="btn quiet" for="restoreIn">Restore from file</label></div>' +
    '<input id="restoreIn" class="sr" type="file" accept="application/json,.json"></div></section>';
  h += '<section class="section"><h2>App</h2><div class="card pad form"><div class="muted" id="storageInfo">Version ' + APP_VERSION + '</div>' +
    '<button class="btn quiet" data-act="update">Check for update</button></div></section>';
  return h + '</main>' + nav('settings');
}

/* ---------- sheets ---------- */
function openSheet(html) { const s = $('#sheet'); s.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + html + '</div>'; s.hidden = false; hydrateThumbs(); }
function closeSheet() { const s = $('#sheet'); s.hidden = true; s.innerHTML = ''; }
function sheetHead(t) { return '<div class="sheet-head"><h2>' + esc(t) + '</h2><button class="iconbtn" data-act="closesheet" aria-label="Close">✕</button></div>'; }
function fileSheet(id) {
  const f = D.files[id]; if (!f) return;
  const it = f.itemId && D.items[f.itemId] && !D.items[f.itemId].deleted ? D.items[f.itemId] : null;
  let h = sheetHead(f.kind || 'File');
  h += f.mime === 'application/pdf' ? '<div class="card empty">PDF document</div>' : '<img class="preview" data-thumb="' + f.id + '" alt="' + esc(f.kind) + '">';
  h += '<button class="btn" data-act="openfile" data-id="' + id + '">Open full file</button>';
  h += '<form class="form" data-form="file" data-id="' + id + '">' +
    '<label class="field"><span>What is it?</span><select name="kind">' + FILE_KINDS.map((k) => opt(k, f.kind)).join('') + '</select></label>' +
    '<div class="grid2"><label class="field"><span>Date</span><input name="date" type="date" value="' + esc(f.date || '') + '"></label>' +
    '<label class="field"><span>Total (AUD)</span><input name="total" type="number" inputmode="decimal" step="0.01" min="0" value="' + esc(f.total || '') + '"></label></div>' +
    '<label class="field"><span>Store</span><input name="store" value="' + esc(f.store || '') + '"></label>' +
    '<button class="btn primary" type="submit">Save changes</button></form>';
  h += '<div class="muted">' + (it ? 'Filed to ' + esc(it.name) : 'In the inbox') + (f.uploaded ? ' · in Dropbox' : ' · waiting to upload') + '</div>';
  h += '<div class="btns"><button class="btn" data-act="picker" data-id="' + id + '">' + (it ? 'Move to another item' : 'File to item') + '</button>' +
    (it ? '<button class="btn quiet" data-act="unfile" data-id="' + id + '">Back to inbox</button>' : '<button class="btn quiet" data-act="newfromfile" data-id="' + id + '">New item from this</button>') + '</div>';
  h += '<button class="btn danger" data-act="delfile" data-id="' + id + '">Delete file</button>';
  openSheet(h);
}
function pickerList(fileId, q) {
  const s = (q || '').toLowerCase();
  const rows = live('items').filter((i) => !i.archived && (!s || [i.name, i.brand, i.model, i.store].some((v) => v && v.toLowerCase().includes(s))))
    .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60);
  return rows.length ? rows.map((i) => '<button class="row" data-act="pick" data-file="' + fileId + '" data-id="' + i.id + '"><div class="grow"><div class="t">' + esc(i.name) + '</div><div class="s">' +
    esc(propName(i.propertyId) + (i.location ? ', ' + i.location : '')) + '</div></div></button>').join('') : '<div class="empty">No matching items.</div>';
}
function openPicker(fileId) {
  openSheet(sheetHead('File to item') + '<label class="search">' + I.search + '<span class="sr">Search items</span><input id="pickq" type="search" placeholder="Search items" data-file="' + fileId + '"></label>' +
    '<button class="btn primary" data-act="newfromfile" data-id="' + fileId + '">' + I.plus + 'New item from this file</button>' +
    '<div class="card list" id="picklist">' + pickerList(fileId, '') + '</div>');
}
function propSheet(id) {
  const p = id ? propById(id) : { name: '', type: 'Investment', address: '' };
  if (!p) return;
  const used = id ? live('items').filter((i) => i.propertyId === id).length : 0;
  openSheet(sheetHead(id ? 'Edit property' : 'Add property') + '<form class="form" data-form="prop" data-id="' + esc(id || '') + '">' +
    '<label class="field req"><span>Name</span><input name="name" required value="' + esc(p.name) + '" placeholder="Darwin unit"></label>' +
    '<label class="field"><span>Type</span><select name="type">' + PROPERTY_TYPES.map((t) => opt(t, p.type)).join('') + '</select></label>' +
    '<label class="field"><span>Address</span><input name="address" value="' + esc(p.address || '') + '"></label>' +
    '<button class="btn primary" type="submit">Save</button>' +
    (id ? (used ? '<div class="muted">' + used + ' item' + (used > 1 ? 's use' : ' uses') + ' this property, so it can\'t be deleted.</div>' : '<button class="btn danger" type="button" data-act="delprop" data-id="' + esc(id) + '">Delete property</button>') : '') +
    '</form>');
}
function addFileSheet(itemId) {
  SNAP_TARGET = itemId; go('#/snap');
}
/* ---------- routing ---------- */
function render() {
  const app = $('#app'); if (!app || !D) return;
  const h = location.hash || '#/home';
  const parts = h.replace(/^#\//, '').split('/');
  let html;
  switch (parts[0]) {
    case 'items': html = viewItems(); break;
    case 'item': html = parts[2] === 'edit' ? viewItemEdit(parts[1]) : viewItem(parts[1]); break;
    case 'new': html = viewItemEdit(null); break;
    case 'warranty': html = viewWarranty(parts[1], parts[2]); break;
    case 'inbox': html = viewInbox(); break;
    case 'snap': html = viewSnap(); break;
    case 'settings': html = viewSettings(); break;
    case 'suggest': html = viewSuggest(); break;
    default: html = viewHome();
  }
  app.innerHTML = html;
  if (parts[0] === 'snap' && SNAP && SNAP.step === 'crop') { drawCropView(); bindCropDrag(); }
  if (parts[0] === 'snap' && SNAP && SNAP.step === 'details' && SNAP.result) { const im = $('#snapprev'); if (im) im.src = URL.createObjectURL(SNAP.result.full); }
  if (parts[0] === 'warranty') warrantyPreview();
  if (parts[0] === 'settings') storageInfo();
  hydrateThumbs();
}
let lastRoute = '';
window.addEventListener('hashchange', () => {
  const r = location.hash.split('/')[1] || '';
  if (r !== 'item' && r !== 'warranty') ITEM_TAB = 'details';
  if (r !== 'snap') { SNAP = null; }
  if (r !== 'snap' && r !== 'item') SNAP_TARGET = null;
  if (r !== 'new') { /* keep prefill only for the new-item screen */ if (lastRoute === 'new') NEW_ITEM_PREFILL = null; }
  lastRoute = r;
  closeSheet(); render(); window.scrollTo(0, 0);
});

/* ---------- actions ---------- */
const ACT = {
  syncnow() { sync(true); },
  tab(el) { ITEM_TAB = el.dataset.v; render(); },
  fprop(el) { ITEMS_F.prop = el.dataset.v; render(); },
  farch() { ITEMS_F.arch = !ITEMS_F.arch; render(); },
  async archive(el) {
    const it = D.items[el.dataset.id];
    it.archived = true; it.archivedAt = Date.now(); touch(it);
    for (const f of itemFiles(it.id)) await dropThumb(f.id);
    await saveData(); toast('Archived. Restore it any time.'); render();
  },
  async restore(el) {
    const it = D.items[el.dataset.id];
    it.archived = false; it.archivedAt = null; touch(it);
    await saveData(); toast('Restored'); render();
  },
  async archiveall() {
    const byItem = groupBy(live('warranties'), 'itemId');
    const items = live('items').filter((i) => suggestArchive(i, byItem[i.id] || []));
    for (const it of items) { it.archived = true; it.archivedAt = Date.now(); touch(it); for (const f of itemFiles(it.id)) await dropThumb(f.id); }
    await saveData(); toast(items.length + ' archived'); go('#/home');
  },
  async delitem(el) {
    const it = D.items[el.dataset.id];
    const nf = itemFiles(it.id).length;
    if (!confirm('Delete "' + it.name + '"' + (nf ? ' and its ' + nf + ' file' + (nf > 1 ? 's' : '') : '') + '? This can\'t be undone.')) return;
    it.deleted = true; touch(it);
    itemWarranties(it.id).forEach((w) => { w.deleted = true; touch(w); });
    for (const f of itemFiles(it.id)) { f.deleted = true; touch(f); await dropThumb(f.id); }
    await saveData(); toast('Deleted'); go('#/items');
  },
  async delwarranty(el) {
    if (!confirm('Delete this warranty?')) return;
    const w = D.warranties[el.dataset.id]; w.deleted = true; touch(w);
    await saveData(); ITEM_TAB = 'warranties'; go('#/item/' + w.itemId);
  },
  addfile(el) { addFileSheet(el.dataset.id); },
  filesheet(el) { fileSheet(el.dataset.id); },
  closesheet() { closeSheet(); },
  openfile(el) { openFile(D.files[el.dataset.id]); },
  picker(el) { openPicker(el.dataset.id); },
  async pick(el) {
    const f = D.files[el.dataset.file]; f.itemId = el.dataset.id; touch(f);
    await saveData(); closeSheet(); ITEM_TAB = 'files'; go('#/item/' + f.itemId); toast('Filed');
  },
  async unfile(el) { const f = D.files[el.dataset.id]; f.itemId = null; touch(f); await saveData(); closeSheet(); render(); toast('Moved to inbox'); },
  newfromfile(el) {
    const f = D.files[el.dataset.id];
    NEW_ITEM_PREFILL = { store: f.store || '', purchaseDate: f.date || '', price: f.total || '', _fileId: f.id };
    closeSheet(); go('#/new');
  },
  async delfile(el) {
    if (!confirm('Delete this file? It is removed from Dropbox too.')) return;
    const f = D.files[el.dataset.id]; f.deleted = true; touch(f); await dropThumb(f.id);
    await saveData(); closeSheet(); render(); toast('File deleted');
  },
  snapcancel() { SNAP = null; go(SNAP_TARGET ? '#/item/' + SNAP_TARGET : '#/home'); },
  rot() { SNAP.quarter = (SNAP.quarter + 1) % 4; rebuildWork(); drawCropView(); },
  cropall() { SNAP.crop = { x: 0, y: 0, w: SNAP.work.width, h: SNAP.work.height }; placeCropRect(); },
  docmode(el) { SNAP.docMode = !SNAP.docMode; el.setAttribute('aria-pressed', SNAP.docMode); },
  async cropnext(el) {
    el.disabled = true; el.textContent = 'Working…';
    SNAP.result = await finishImage(SNAP.work, SNAP.crop, SNAP.docMode);
    SNAP.step = 'details'; render();
  },
  dbxon() { DBX.connect(); },
  dbxoff() { if (confirm('Disconnect Dropbox on this phone? Your records stay on the phone and in Dropbox.')) { DBX.disconnect(); render(); } },
  wifionly(el) { S.wifiOnly = el.checked; saveSettings(); },
  theme(el) { S.theme = el.dataset.v; saveSettings(); applyTheme(); render(); },
  propsheet(el) { propSheet(el.dataset.id); },
  async delprop(el) {
    if (!confirm('Delete this property?')) return;
    D.lists.properties = D.lists.properties.filter((p) => p.id !== el.dataset.id); D.lists.updatedAt = Date.now();
    await saveData(); closeSheet(); render();
  },
  async savelists() {
    const read = (k) => Array.from(new Set($('#list-' + k).value.split('\n').map((s) => s.trim()).filter(Boolean)));
    const c = read('categories'), l = read('locations'), w = read('warrantyTypes');
    if (!c.length || !w.length) { toast('Categories and warranty types need at least one entry'); return; }
    D.lists.categories = c; D.lists.locations = l; D.lists.warrantyTypes = w; D.lists.updatedAt = Date.now();
    await saveData(); toast('Lists saved');
  },
  async export() {
    const thumbs = {};
    for (const k of await idb.keys('thumbs')) {
      const b = await idb.get('thumbs', k);
      thumbs[k] = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
    }
    const blob = new Blob([JSON.stringify({ app: 'Our Gear', version: APP_VERSION, exportedAt: new Date().toISOString(), data: D, thumbs })], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ourgear-backup-' + todayISO() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    toast('Backup saved to Downloads');
  },
  async update() {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) { await reg.update(); toast('Checked. A new version loads next time you open the app.'); } else toast('Updates aren\'t available in this browser');
  }
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  if (el.dataset.act in ACT) { e.preventDefault(); ACT[el.dataset.act](el, e); }
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.act === 'wifionly') { ACT.wifionly(t); return; }
  if (t.id === 'camIn' || t.id === 'pickIn') { const f = t.files && t.files[0]; if (f) startSnap(f, SNAP_TARGET); return; }
  if (t.id === 'fcat') { ITEMS_F.cat = t.value; $('#itemlist').innerHTML = itemsListHTML(); return; }
  if (t.id === 'ownerSel') { S.owner = t.value; saveSettings(); toast('Saved'); return; }
  if (t.id === 'deg') { SNAP.deg = +t.value; rebuildWork(); drawCropView(); return; }
  if (t.id === 'restoreIn') { restoreBackup(t.files && t.files[0]); return; }
  if (t.closest && t.closest('[data-form="warranty"]')) warrantyPreview();
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'q') { ITEMS_F.q = t.value; $('#itemlist').innerHTML = itemsListHTML(); }
  if (t.id === 'pickq') { $('#picklist').innerHTML = pickerList(t.dataset.file, t.value); }
  if (t.id === 'deg') { $('#degv').textContent = t.value + '°'; }
  if (t.closest && t.closest('[data-form="warranty"]')) warrantyPreview();
});
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const fd = new FormData(form), v = (k) => (fd.get(k) || '').toString().trim();
  const kind = form.dataset.form;
  if (kind === 'item') {
    const id = form.dataset.id;
    const it = id ? D.items[id] : { id: uid(), createdAt: Date.now() };
    if (!v('name')) { toast('Give the item a name'); return; }
    ['name', 'category', 'brand', 'model', 'serial', 'propertyId', 'location', 'spot', 'owner', 'store', 'purchaseDate', 'installDate', 'status', 'notes']
      .forEach((k) => { it[k] = v(k); });
    it.price = v('price') === '' ? '' : +v('price');
    it.replacementValue = v('replacementValue') === '' ? '' : +v('replacementValue');
    it.work = fd.get('work') === 'on';
    D.items[it.id] = touch(it);
    if (!id && NEW_ITEM_PREFILL && NEW_ITEM_PREFILL._fileId && D.files[NEW_ITEM_PREFILL._fileId]) {
      const f = D.files[NEW_ITEM_PREFILL._fileId]; f.itemId = it.id; touch(f);
    }
    NEW_ITEM_PREFILL = null;
    await saveData(); toast(id ? 'Saved' : 'Item added');
    ITEM_TAB = id ? 'details' : 'warranties';
    go('#/item/' + it.id);
  } else if (kind === 'warranty') {
    const id = form.dataset.id, itemId = form.dataset.item;
    const w = id ? D.warranties[id] : { id: uid(), itemId, createdAt: Date.now() };
    ['type', 'covers', 'termUnit', 'startFrom', 'startDate', 'expiryOverride', 'provider', 'contact', 'conditions'].forEach((k) => { w[k] = v(k); });
    w.termValue = w.termUnit === 'lifetime' ? '' : v('termValue');
    if (w.termUnit !== 'lifetime' && !w.termValue && !w.expiryOverride) { toast('Enter a term, choose Lifetime, or set an expiry date'); return; }
    D.warranties[w.id] = touch(w);
    await saveData(); toast('Warranty saved'); ITEM_TAB = 'warranties'; go('#/item/' + itemId);
  } else if (kind === 'snap') {
    const dest = e.submitter ? e.submitter.value : 'inbox';
    SNAP.kind = v('kind'); SNAP.date = v('date'); SNAP.store = v('store'); SNAP.total = v('total');
    const btns = form.querySelectorAll('button'); btns.forEach((b) => { b.disabled = true; });
    const full = SNAP.isPdf ? SNAP.file : SNAP.result.full, thumb = SNAP.isPdf ? null : SNAP.result.thumb;
    const f = touch({ id: uid(), itemId: SNAP.itemId || null, kind: SNAP.kind, date: SNAP.date, store: SNAP.store, total: SNAP.total === '' ? '' : +SNAP.total,
      mime: SNAP.isPdf ? 'application/pdf' : 'image/jpeg', origName: SNAP.file.name || '', size: full.size, uploaded: false, path: null, createdAt: Date.now() });
    await idb.put('blobs', f.id, full);
    if (thumb) await idb.put('thumbs', f.id, thumb);
    D.files[f.id] = f;
    await saveData();
    const target = f.itemId;
    SNAP = null; SNAP_TARGET = null;
    if (target) { ITEM_TAB = 'files'; go('#/item/' + target); toast('Saved'); }
    else if (dest === 'file') { go('#/inbox'); setTimeout(() => openPicker(f.id), 50); }
    else { go('#/inbox'); toast('Saved to inbox'); }
  } else if (kind === 'file') {
    const f = D.files[form.dataset.id];
    f.kind = v('kind'); f.date = v('date'); f.store = v('store'); f.total = v('total') === '' ? '' : +v('total');
    touch(f); await saveData(); closeSheet(); render(); toast('Saved');
  } else if (kind === 'prop') {
    const id = form.dataset.id;
    if (!v('name')) return;
    if (id) { const p = propById(id); p.name = v('name'); p.type = v('type'); p.address = v('address'); }
    else D.lists.properties.push({ id: uid().slice(0, 10), name: v('name'), type: v('type'), address: v('address') });
    D.lists.updatedAt = Date.now();
    await saveData(); closeSheet(); render(); toast('Property saved');
  }
});
function warrantyPreview() {
  const form = document.querySelector('form[data-form="warranty"]'), out = $('#wpreview');
  if (!form || !out) return;
  const fd = new FormData(form), w = {}; fd.forEach((val, k) => { w[k] = String(val); });
  const it = D.items[form.dataset.item];
  if (w.termUnit === 'lifetime') { out.textContent = 'Lifetime: no expiry and no alerts. Keep the receipt.'; return; }
  const exp = warrantyExpiry(w, it);
  if (exp) { const d = daysUntil(exp); out.textContent = 'Ends ' + fmtDate(exp) + (d < 0 ? ' (ended ' + (-d) + ' days ago)' : ' (' + d + ' days from today)'); }
  else out.textContent = w.startFrom === 'install' || w.startFrom === 'purchase' ? 'Add the item\'s ' + (w.startFrom === 'install' ? 'install or purchase' : 'purchase') + ' date to work out the expiry.' : 'Enter a start date and term.';
}
async function storageInfo() {
  const el = $('#storageInfo');
  if (!el || !navigator.storage || !navigator.storage.estimate) return;
  const e = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
  el.textContent = 'Version ' + APP_VERSION + ' · using ' + (e.usage / 1048576).toFixed(1) + ' MB on this phone' + (persisted ? ' · protected storage' : '');
}
async function restoreBackup(file) {
  if (!file) return;
  try {
    const j = JSON.parse(await file.text());
    if (!j || !j.data || !j.data.items) throw new Error('Not an Our Gear backup');
    mergeInto(D, j.data);
    for (const [k, url] of Object.entries(j.thumbs || {})) {
      if (!(await idb.get('thumbs', k))) await idb.put('thumbs', k, await (await fetch(url)).blob());
    }
    await saveData(); toast('Backup restored'); render();
  } catch (e) { toast('Restore failed: ' + e.message); }
}
function applyTheme() {
  document.documentElement.dataset.theme = S.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = { midnight: '#0B1220', indigo: '#FFFFFF', slate: '#1E293B', ink: '#0F2A2E' }[S.theme] || '#FFFFFF';
}
/* Files shared to Our Gear from other apps land in the inbox. */
async function importShared() {
  const keys = await idb.keys('share');
  if (!keys.length) return;
  let n = 0;
  for (const k of keys) {
    const s = await idb.get('share', k);
    try {
      const isPdf = s.type === 'application/pdf' || /\.pdf$/i.test(s.name);
      let full = s.blob, thumb = null;
      if (!isPdf && /^image\//.test(s.type)) { const r = await quickCompress(s.blob); full = r.full; thumb = r.thumb; }
      else if (!isPdf) continue;
      const f = touch({ id: uid(), itemId: null, kind: isPdf ? 'Tax invoice' : 'Receipt', date: todayISO(), store: '', total: '',
        mime: isPdf ? 'application/pdf' : 'image/jpeg', origName: s.name, size: full.size, uploaded: false, path: null, createdAt: Date.now() });
      await idb.put('blobs', f.id, full); if (thumb) await idb.put('thumbs', f.id, thumb);
      D.files[f.id] = f; n++;
    } finally { await idb.del('share', k); }
  }
  if (n) { await saveData(); toast(n + ' file' + (n > 1 ? 's' : '') + ' added to inbox'); }
}

/* ---------- start ---------- */
async function boot() {
  try { S = Object.assign(defaultSettings(), JSON.parse(localStorage.getItem('og_settings') || '{}')); } catch (e) { S = defaultSettings(); }
  applyTheme();
  await idb.open();
  D = (await idb.get('kv', 'data')) || emptyData();
  if (!D.lists) D.lists = JSON.parse(JSON.stringify(DEFAULT_LISTS));
  const signedIn = await DBX.finishSignIn().catch((e) => { toast('Sign-in error: ' + e.message); return true; });
  if (location.search.includes('share=1')) history.replaceState(null, '', location.pathname + '#/inbox');
  await importShared().catch(() => {});
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('online', () => scheduleSync());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(); });
  window.addEventListener('resize', () => { if (SNAP && SNAP.step === 'crop') drawCropView(); });
  if (DBX.connected()) sync(!!signedIn);
}
if (typeof document !== 'undefined' && typeof module === 'undefined') boot();
if (typeof module !== 'undefined') module.exports = { addTerm, daysUntil, warrantyStatus, itemStatus, mergeInto, desiredPath, suggestArchive, safeName, fileBaseName, emptyData };
