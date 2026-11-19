/* Our Gear v1.0 — purchases, receipts and warranties.
   Offline web app. Records live on the phone (IndexedDB) and sync to Dropbox. */
'use strict';
const APP_VERSION = '1.07';
const DROPBOX_KEY = '5ddeosl2pq5dl33';
const DATA_PATH = '/data/ourgear-data.json';
const OWNERS = ['Shaun', 'Lyndsey', 'Alex', 'Shared'];
const PROPERTY_TYPES = ['Main residence', 'Investment', 'Holiday home', 'Other'];
const FILE_KINDS = ['Receipt', 'Tax invoice', 'Warranty card', 'Manual', 'Photo', 'Serial plate', 'Certificate', 'Claim pack', 'Other'];
/* Kinds of file: receipts carry store/date/total; photos carry nothing; other documents just a date. */
const RECEIPT_KINDS = ['Receipt', 'Tax invoice'];
const PHOTO_KINDS = ['Photo', 'Serial plate'];
function kindGroup(k) { return RECEIPT_KINDS.includes(k) ? 'receipt' : PHOTO_KINDS.includes(k) ? 'photo' : 'doc'; }
const SNAP_TYPES = [['receipt', 'Receipt or invoice', 'Receipt'], ['photo', 'Item photo', 'Photo'], ['doc', 'Other document', 'Warranty card']];
const ITEM_STATUS = ['Active', 'Sold', 'Disposed', 'Replaced'];
const THEMES = [
  { id: 'indigo', name: 'Clean white and indigo', a: '#FFFFFF', b: '#4F46E5' },
  { id: 'midnight', name: 'Midnight and blue', a: '#0B1220', b: '#2F6BFF' },
  { id: 'slate', name: 'Slate and signal orange', a: '#1E293B', b: '#F97316' },
  { id: 'ink', name: 'Deep ink and teal', a: '#0F2A2E', b: '#14B8A6' },
  { id: 'emerald', name: 'Graphite and emerald', a: '#111827', b: '#10B981' },
  { id: 'sky', name: 'Clean white and sky', a: '#FFFFFF', b: '#0284C7' },
  { id: 'plum', name: 'Plum and violet', a: '#3B0764', b: '#7E22CE' },
  { id: 'sand', name: 'Stone and amber', a: '#44403C', b: '#D97706' },
  { id: 'night', name: 'Night (dark)', a: '#0B1220', b: '#60A5FA' }
];
const DEFAULT_LISTS = {
  categories: ['Kitchen appliances', 'Laundry', 'Heating and cooling', 'Hot water', 'Solar and energy', 'Security and CCTV',
    'Computers and network', 'TV and audio', 'Phones and tablets', 'Tools', 'Garden and outdoor', 'Furniture', 'Hobbies', 'Other'],
  locations: ['Kitchen', 'Laundry', 'Living', 'Dining', 'Bedroom 1', 'Bedroom 2', 'Bedroom 3', 'Bedroom 4', 'Bathroom', 'Ensuite',
    'Garage', 'Shed', 'Under house', 'Yard', 'Roof', 'Server cupboard'],
  warrantyTypes: ['Maker', 'Extended', 'Installer', 'Workmanship', 'Store'],
  people: OWNERS.slice(),
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
  return { schema: 1, items: {}, warranties: {}, files: {}, claims: {}, logs: {}, services: {}, lists: JSON.parse(JSON.stringify(DEFAULT_LISTS)) };
}
function defaultSettings() {
  return { theme: 'indigo', wifiOnly: true, autoRead: true, owner: 'Shaun', lastSync: 0, lastSyncMsg: '' };
}
function live(coll) { return Object.values(D[coll] || {}).filter((r) => !r.deleted); }
const COLLECTIONS = ['items', 'warranties', 'files', 'claims', 'logs', 'services'];
function touch(rec) { rec.updatedAt = Date.now(); rec.by = S ? S.owner : ''; return rec; }
function itemWarranties(itemId) { return live('warranties').filter((w) => w.itemId === itemId); }
function itemFiles(itemId) { return live('files').filter((f) => f.itemId === itemId); }
function inboxFiles() { return live('files').filter((f) => !f.itemId || !D.items[f.itemId] || D.items[f.itemId].deleted); }
function propById(id) { return D.lists.properties.find((p) => p.id === id) || null; }
/* People things can belong to (editable in Settings). */
function peopleList() { return D && D.lists && D.lists.people && D.lists.people.length ? D.lists.people : OWNERS; }
function propName(id) { const p = propById(id); return p ? p.name : 'No property'; }

/* Merge another copy of the data into ours: newest record wins, by id. */
function mergeInto(local, remote) {
  let changed = false;
  COLLECTIONS.forEach((c) => {
    if (!local[c]) local[c] = {};
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
/* Same data always gives the same text, whatever order records were added in. */
function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
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
        rev = remote.meta.rev;
        const rd = JSON.parse(await remote.blob.text());
        remoteText = stableStringify(rd);
        if (mergeInto(D, rd)) await idb.put('kv', 'data', D);
      }
      await reconcileFiles();
      await idb.put('kv', 'data', D);
      const text = stableStringify(D);
      if (text === remoteText) break; // nothing new to send
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
    syncing = false;
    const why = /failed to fetch|networkerror|load failed/i.test(e.message || '') ? "couldn't reach Dropbox" : (e.message || 'unknown error');
    setSyncMsg('Sync failed: ' + why.slice(0, 80));
    if (manual) toast('Sync failed: ' + why.slice(0, 120));
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
      if (!blob) {
        // Added on the other phone (it will upload it), or uploaded here just before the app was closed.
        if (f.by === S.owner && await DBX.exists(want)) { f.path = want; f.uploaded = true; touch(f); }
        continue;
      }
      let res;
      if (f.replace) {
        res = await DBX.upload(want, blob, 'overwrite');
        if (f.path && f.path.toLowerCase() !== want.toLowerCase()) { try { await DBX.del(f.path); } catch (e) { /* already gone */ } }
        delete f.replace;
      } else {
        try { res = await DBX.upload(want, blob, 'add'); }
        catch (e) { if (/conflict/.test(e.summary)) res = { path_display: want }; else throw e; }
      }
      const th = await idb.get('thumbs', f.id);
      if (th) await DBX.upload(thumbPath(f.id), th, 'overwrite');
      f.path = res.path_display; f.uploaded = true; touch(f);
      await idb.put('kv', 'data', D); // record the upload before dropping the local copy
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
function thumbRevs() { try { return JSON.parse(localStorage.getItem('og_trev') || '{}'); } catch (e) { return {}; } }
function setThumbRev(id, rev) { const m = thumbRevs(); m[id] = rev; try { localStorage.setItem('og_trev', JSON.stringify(m)); } catch (e) { /* full */ } }
async function thumbUrl(f) {
  if (f.imgRev && thumbRevs()[f.id] !== f.imgRev && f.uploaded && !(await idb.get('blobs', f.id))) {
    // edited on the other phone: drop the old preview and fetch the new one
    if (thumbUrls[f.id]) { URL.revokeObjectURL(thumbUrls[f.id]); delete thumbUrls[f.id]; }
    await idb.del('thumbs', f.id);
    if (DBX.connected() && navigator.onLine) {
      try { const r = await DBX.download(thumbPath(f.id)); if (r) { await idb.put('thumbs', f.id, r.blob); setThumbRev(f.id, f.imgRev); } } catch (e) { /* try later */ }
    }
  }
  if (thumbUrls[f.id]) return thumbUrls[f.id];
  let b = await idb.get('thumbs', f.id);
  if (!b && isPdfFile(f)) {
    const local = await idb.get('blobs', f.id);
    if (local) { try { b = await pdfThumbBlob(local); await idb.put('thumbs', f.id, b); } catch (e) { /* unreadable PDF */ } }
  }
  if (!b && f.uploaded && DBX.connected() && navigator.onLine) {
    const item = f.itemId && D.items[f.itemId];
    if (item && item.archived) return null;
    try {
      const r = await DBX.download(thumbPath(f.id));
      if (r) b = r.blob;
      else if (isPdfFile(f)) { const p = await DBX.download(f.path); if (p) b = await pdfThumbBlob(p.blob); }
      if (b) await idb.put('thumbs', f.id, b);
    } catch (e) { /* offline or unreadable */ }
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
    const f = D.files[img.dataset.thumb] || { id: img.dataset.thumb, uploaded: false };
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
async function startSnap(file, itemId, type) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  let t = type || 'receipt';
  if (isPdf && t === 'photo') t = 'doc';
  const kind = isPdf && t === 'receipt' ? 'Tax invoice' : (SNAP_TYPES.find((x) => x[0] === t) || SNAP_TYPES[0])[2];
  SNAP = { step: isPdf ? 'details' : 'crop', file, isPdf, quarter: 0, deg: 0, docMode: t !== 'photo', itemId: itemId || null,
    kind, type: t, date: todayISO(), store: '', total: '' };
  if (!isPdf) {
    try { SNAP.src = await loadSource(file); }
    catch (e) { toast('Could not read that image'); SNAP = null; return; }
    rebuildWork();
  }
  go('#/snap');
}
function rebuildWork() {
  SNAP.work = rotateCanvas(SNAP.src, SNAP.quarter, SNAP.deg);
  const m = SNAP.fullCrop ? 0 : Math.round(Math.min(SNAP.work.width, SNAP.work.height) * 0.04);
  SNAP.crop = { x: m, y: m, w: SNAP.work.width - 2 * m, h: SNAP.work.height - 2 * m };
}
function drawCropView() {
  const wrap = document.getElementById('cropwrap');
  if (!wrap || !SNAP || !SNAP.work) return;
  const ps = getComputedStyle(wrap.parentElement);
  const avail = wrap.parentElement.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight) - 16; // room for the corner handles
  const maxW = Math.min(avail, 600), maxH = Math.max(260, window.innerHeight - 330);
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
const SV = (paths, size) => '<svg width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
const I = {
  back: SV('<path d="M15 6l-6 6l6 6"/>', 24),
  home: SV('<path d="M5 12l-2 0l9 -9l9 9l-2 0"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"/><path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6"/>'),
  list: SV('<path d="M12 3l8 4.5v9l-8 4.5l-8 -4.5v-9l8 -4.5"/><path d="M12 12l8 -4.5"/><path d="M12 12v9"/><path d="M12 12l-8 -4.5"/>'),
  cam: SV('<path d="M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2"/><circle cx="12" cy="13" r="3"/>', 24),
  inbox: SV('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 13h3l3 3h4l3 -3h3"/>'),
  claim: SV('<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><path d="M12 11v3"/><path d="M12 17h.01"/>'),
  gear: SV('<path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z"/><circle cx="12" cy="12" r="3"/>'),
  plus: SV('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  search: SV('<circle cx="10" cy="10" r="7"/><path d="M21 21l-6 -6"/>', 18),
  sync: SV('<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>', 20),
  doc: SV('<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><path d="M9 9h1"/><path d="M9 13h6"/><path d="M9 17h6"/>', 20),
  phone: SV('<path d="M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2"/>', 16),
  clock: SV('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>', 16)
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
    '<div style="flex:1;min-width:0"><h1>' + esc(title) + '</h1>' + (o.sub ? '<div class="sub"' + (o.subId ? ' id="' + o.subId + '"' : '') + '>' + esc(o.sub) + '</div>' : '') + '</div>' +
    (o.right || '') + '</div>' + (o.extra || '') + '</header>';
}
function nav(active) {
  const n = inboxFiles().length;
  const a = (id, href, icon, label, cls) => '<a href="' + href + '"' + (active === id ? ' aria-current="page"' : '') + (cls ? ' class="' + cls + '"' : '') + '>' + icon + label + '</a>';
  return '<nav class="nav">' + a('home', '#/home', I.home, 'Home') + a('items', '#/items', I.list, 'Items') +
    a('snap', '#/snap', '<span class="ring">' + I.cam + '</span>', 'Snap', 'snap') +
    '<a href="#/inbox"' + (active === 'inbox' ? ' aria-current="page"' : '') + '>' + I.inbox + 'Inbox' + (n ? '<span class="dot">' + n + '</span>' : '') + '</a>' +
    a('claims', '#/claims', I.claim, 'Claims') + a('settings', '#/settings', I.gear, 'Settings') + '</nav>';
}
function syncButton() {
  return '<button class="iconbtn" data-act="syncnow" aria-label="Sync now">' + I.sync + '</button>';
}

/* ---------- views ---------- */
let ITEMS_F = { q: '', prop: 'all', cat: '', arch: false, st: 'all', owner: '' };
const ST_FILTERS = [['all', 'Any warranty'], ['soon', 'Expiring soon'], ['ok', 'Covered'], ['life', 'Lifetime'], ['gone', 'Expired'], ['nowar', 'No warranty']];
let ITEM_TAB = 'details';
let SNAP_TARGET = null;
let SNAP_TYPE = 'receipt';

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
  let h = header('Our Gear', { logo: true, sub: syncLabel(), subId: 'syncmsg', right: syncButton() });
  h += '<main>';
  h += '<a class="btn primary big" href="#/snap">' + I.cam + 'Snap a receipt</a>';
  h += '<a class="stat statwide" href="#/items"><div class="l">Items in Our Gear</div><div class="n">' + items.length + '</div></a>';
  h += '<div class="stats">' +
    '<a class="stat" href="#/inbox"><div class="l">Inbox to file</div><div class="n">' + inbox + '</div></a>' +
    '<button class="stat" data-act="gofilter" data-k="st" data-v="soon"><div class="l">Expiring in 90 days</div><div class="n" style="color:#8A5A00">' + soon.length + '</div></button>' +
    '<a class="stat" href="#/claims"><div class="l">Open claims</div><div class="n">' + openClaims().length + '</div></a>' +
    '<a class="stat" href="#/service"><div class="l">Service due</div><div class="n">' + servicesDue().length + '</div></a></div>';
  h += '<section class="section"><div class="section-head"><h2>Expiring soon</h2></div>';
  if (soon.length) {
    h += '<div class="card list">' + soon.slice(0, 6).map((x) =>
      '<a class="row" href="#/item/' + x.it.id + '"><div class="grow"><div class="t">' + esc(x.it.name) + '</div><div class="s">' +
      esc((x.w.type || 'Warranty') + (x.w.covers ? ' (' + x.w.covers + ')' : '') + ' · ends ' + fmtDate(x.s.expiry)) + '</div></div>' + badge(x.s) + '</a>').join('') + '</div>';
  } else h += '<div class="card empty">Nothing expiring in the next 90 days.</div>';
  h += '</section>';
  const fd = followUpsDue();
  if (fd.length) h += '<section class="section"><h2>Follow up</h2><div class="card list">' + fd.map((x) =>
    '<a class="row" href="#/claim/' + x.c.id + '"><div class="grow"><div class="t">' + esc(x.c.title) + '</div><div class="s">' + esc(D.items[x.c.itemId].name + (x.c.provider ? ' · ' + x.c.provider : '') + (x.c.ticket ? ' · Ticket ' + x.c.ticket : '')) + '</div></div>' + badge(x.f) + '</a>').join('') + '</div></section>';
  const oc = openClaims();
  if (oc.length) h += '<section class="section"><div class="section-head"><h2>Open claims</h2><a href="#/claims">See all</a></div><div class="card list">' + oc.slice(0, 3).map((c) => claimRow(c, true)).join('') + '</div></section>';
  const sd = servicesDue();
  if (sd.length) h += '<section class="section"><h2>Service due</h2><div class="card list">' + sd.slice(0, 5).map((x) =>
    '<a class="row" href="#/item/' + x.it.id + '"><div class="grow"><div class="t">' + esc(x.s.job) + '</div><div class="s">' + esc(x.it.name) + ' · ' + esc(fmtDate(x.st.next)) + '</div></div>' + badge(x.st) + '</a>').join('') + '</div></section>';
  if (sugg.length) {
    h += '<a class="card pad row" href="#/suggest" style="border-bottom:1px solid var(--border)"><div class="grow"><div class="t">' + sugg.length + ' item' + (sugg.length > 1 ? 's' : '') + ' could be archived</div>' +
      '<div class="s">Gone from the house, or warranties ended over 2 years ago</div></div><span class="badge b-arch">Review</span></a>';
  }
  const impLeft = impPending().length;
  if (impLeft) h += '<a class="card pad row" href="#/import"><div class="grow"><div class="t">Import review</div><div class="s">' + impLeft + ' note' + (impLeft > 1 ? 's' : '') + ' still to check</div></div><span class="badge b-life">Continue</span></a>';
  if (!DBX.connected()) h += '<div class="warn">Dropbox isn\'t connected, so nothing is backed up yet. <a href="#/settings">Connect in Settings</a>.</div>';
  return h + '</main>' + nav('home');
}

function filteredItems() {
  const q = ITEMS_F.q.trim().toLowerCase();
  const byItem = groupBy(live('warranties'), 'itemId');
  return live('items').filter((i) => (ITEMS_F.arch || !i.archived) &&
    (ITEMS_F.prop === 'all' || i.propertyId === ITEMS_F.prop) && (!ITEMS_F.cat || i.category === ITEMS_F.cat) && (!ITEMS_F.owner || i.owner === ITEMS_F.owner) &&
    (!q || [i.name, i.brand, i.model, i.serial, i.store, i.notes, i.location, i.spot].some((v) => v && String(v).toLowerCase().includes(q))))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => ({ i, st: i.archived ? { kind: 'arch', label: 'Archived' } : itemStatus(i, byItem[i.id] || []), all: (byItem[i.id] || []).map((w) => warrantyStatus(w, i).kind) }))
    .filter((r) => ITEMS_F.st === 'all' || (ITEMS_F.st === 'nowar' ? !r.all.length : ITEMS_F.st === 'ok' ? r.st.kind === 'ok' : r.all.includes(ITEMS_F.st)))
    .sort((a, b) => ITEMS_F.st === 'soon' ? (a.st.days || 0) - (b.st.days || 0) : 0);
}
function itemsListHTML() {
  const rows = filteredItems();
  const cnt = document.getElementById('itemcount');
  if (cnt) cnt.textContent = rows.length + ' item' + (rows.length === 1 ? '' : 's');
  if (!rows.length) return '<div class="card empty">' + (live('items').length ? 'No items match.' : 'No items yet. Snap a receipt or tap + to add one.') + '</div>';
  return '<div class="card list">' + rows.map(({ i, st }) =>
    '<a class="row" href="#/item/' + i.id + '"><div class="grow"><div class="t">' + esc(i.name) + '</div><div class="s">' +
    esc([i.owner && i.owner !== 'Shared' ? i.owner + '\'s' : '', i.category, propName(i.propertyId) + (i.location ? ', ' + i.location : ''), live('claims').some((c) => c.itemId === i.id && isOpenClaim(c)) ? 'claim open' : ''].filter(Boolean).join(' · ')) + '</div></div>' + badge(st) + '</a>').join('') + '</div>';
}
function viewItems() {
  const props = D.lists.properties;
  let h = header('Items', { right: '<a class="iconbtn" href="#/new" aria-label="Add item" style="background:var(--accent);color:var(--accent-ink)">' + I.plus + '</a>' });
  h += '<main><label class="search">' + I.search + '<span class="sr">Search</span><input id="q" type="search" placeholder="Name, brand, model, serial, store" value="' + esc(ITEMS_F.q) + '"></label>';
  h += '<div class="chips">' + '<button class="chip" data-act="fprop" data-v="all" aria-pressed="' + (ITEMS_F.prop === 'all') + '">All</button>' +
    props.map((p) => '<button class="chip" data-act="fprop" data-v="' + esc(p.id) + '" aria-pressed="' + (ITEMS_F.prop === p.id) + '">' + esc(p.name) + '</button>').join('') +
    '<button class="chip" data-act="farch" aria-pressed="' + ITEMS_F.arch + '">Include archived</button></div>';
  h += '<div class="grid2"><label class="field"><span>Warranty</span><select id="fst">' + ST_FILTERS.map(([k, l]) => opt(k, ITEMS_F.st, l)).join('') + '</select></label>' +
    '<label class="field"><span>Category</span><select id="fcat">' + opt('', ITEMS_F.cat, 'All categories') + D.lists.categories.map((c) => opt(c, ITEMS_F.cat)).join('') + '</select></label></div>' +
    '<label class="field"><span>Belongs to</span><select id="fowner">' + opt('', ITEMS_F.owner, 'Anyone') + peopleList().map((o) => opt(o, ITEMS_F.owner)).join('') + '</select></label>';
  h += '<div class="muted" id="itemcount"></div><div id="itemlist">' + itemsListHTML() + '</div></main>';
  return h + nav('items');
}

function viewItem(id) {
  const it = D.items[id];
  if (!it || it.deleted) return header('Not found', { back: '#/items' }) + '<main><div class="card empty">This item was deleted.</div></main>' + nav('items');
  const p = propById(it.propertyId);
  const tabs = '<div class="tabs" role="tablist">' + ['details', 'warranties', 'files', 'log'].map((t) =>
    '<button role="tab" data-act="tab" data-v="' + t + '" aria-selected="' + (ITEM_TAB === t) + '">' + { details: 'Details', warranties: 'Warranty', files: 'Files', log: 'Claims' }[t] + '</button>').join('') + '</div>';
  let h = header(it.name, { back: '#/items', sub: [it.brand, it.model].filter(Boolean).join(' ') + (it.brand || it.model ? ' · ' : '') + propName(it.propertyId) + (it.location ? ', ' + it.location : ''), extra: tabs });
  h += '<main>';
  if (it.archived) h += '<div class="note">Archived. Files are in the Dropbox archive folder and still searchable. <button class="btn quiet" style="margin-top:8px;width:100%" data-act="restore" data-id="' + id + '">Restore</button></div>';
  if (ITEM_TAB === 'details') {
    const kv = [['Category', it.category], ['Brand', it.brand], ['Model', it.model], ['Serial', it.serial],
      ['Property', p ? p.name + ' (' + p.type + ')' : ''], ['Location', it.location], ['Exact spot', it.spot], ['Belongs to', it.owner],
      ['Store', it.store], ['Purchased', fmtDate(it.purchaseDate)], ['Installed', fmtDate(it.installDate)], ['Price paid', fmtMoney(it.price)],
      ['Replacement value', fmtMoney(it.replacementValue)], ['Status', it.status || 'Active'], ['Work deduction', it.work ? 'Yes' : ''], ['Notes', it.notes]]
      .filter((r) => r[1]);
    h += '<div class="card kv">' + kv.map((r) => '<div>' + esc(r[0]) + '</div><div style="white-space:pre-line">' + esc(r[1]) + '</div>').join('') + '</div>';
    h += ourTaxHTML(it);
    h += servicesHTML(it);
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
  } else if (ITEM_TAB === 'log') {
    h += itemLogTab(it);
  } else {
    const fs = itemFiles(id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    h += fs.length ? '<div class="inbox-grid">' + fs.map(fileTile).join('') + '</div>' : '<div class="card empty">No files yet.</div>';
    h += '<button class="btn primary" data-act="addfile" data-id="' + id + '">Add receipt or file</button>';
  }
  return h + '</main>' + nav('items');
}
function fileTile(f) {
  const pic = '<span class="tilepic"><img data-thumb="' + f.id + '" alt="">' + (isPdfFile(f) ? '<span class="pdftag">PDF</span>' : '') + '</span>';
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
    '<label class="field"><span>Belongs to</span><select name="owner">' + peopleList().concat(it.owner && !peopleList().includes(it.owner) ? [it.owner] : []).map((o) => opt(o, it.owner)).join('') + '</select></label></div>';
  h += '<datalist id="locs">' + D.lists.locations.map((l) => '<option value="' + esc(l) + '">').join('') + '</datalist>';
  h += f('spot', 'Exact spot', it.spot, 'text', 'placeholder="Indoor unit north wall, outdoor unit side path"');
  h += '<label class="field"><span>Store</span><input name="store" list="stores" value="' + esc(it.store || '') + '"></label><datalist id="stores">' + stores.map((s) => '<option value="' + esc(s) + '">').join('') + '</datalist>';
  h += '<div class="grid2">' + f('purchaseDate', 'Purchase date', it.purchaseDate, 'date') + f('installDate', 'Install date', it.installDate, 'date') + '</div>';
  h += '<div class="grid2">' + f('price', 'Price paid (AUD)', it.price, 'number') + f('replacementValue', 'Replacement value (AUD)', it.replacementValue, 'number') + '</div>';
  h += '<label class="field"><span>Status</span><select name="status">' + ITEM_STATUS.map((s) => opt(s, it.status || 'Active')).join('') + '</select></label>';
  h += '<label class="check"><input type="checkbox" name="work"' + (it.work ? ' checked' : '') + '> Work deduction (for Our Tax)</label>';
  h += '<label class="field"><span>Notes</span><textarea name="notes">' + esc(it.notes || '') + '</textarea></label>';
  if (isNew && NEW_ITEM_PREFILL && NEW_ITEM_PREFILL._lifetime) h += '<div class="note">The note mentions a lifetime warranty, so a Lifetime warranty will be added. You can change it after saving.</div>';
  if (isNew && NEW_ITEM_PREFILL && NEW_ITEM_PREFILL._fileIds && NEW_ITEM_PREFILL._fileIds.length > 1) h += '<div class="muted">' + NEW_ITEM_PREFILL._fileIds.length + ' files will be attached.</div>';
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
    const tip = { receipt: 'Receipts are cleaned up in black and white and read for you. Snap thermal receipts on the day, before they fade.',
      photo: 'Item photos are kept in colour. No details to fill in.', doc: 'Manuals, warranty cards and certificates. Photo or PDF.' }[SNAP_TYPE];
    let h = header(target ? 'Add to ' + target.name : 'Snap', { back: target ? '#/item/' + target.id : '' });
    h += '<main><div class="snapstart"><h2>What are you adding?</h2><div class="typechoice">' + SNAP_TYPES.map(([k, l]) =>
      '<button class="typebtn" data-act="snaptype" data-v="' + k + '" aria-pressed="' + (SNAP_TYPE === k) + '">' + (k === 'receipt' ? I.doc : k === 'photo' ? I.cam : I.doc) + '<span>' + l + '</span></button>').join('') + '</div>' +
      '<p class="muted">' + esc(tip) + '</p>' +
      '<label class="btn primary big" for="camIn">' + I.cam + 'Take photo</label><input id="camIn" class="sr" type="file" accept="image/*" capture="environment">' +
      '<label class="btn big" for="pickIn">' + (SNAP_TYPE === 'photo' ? 'Choose from gallery' : 'Choose photo or PDF') + '</label><input id="pickIn" class="sr" type="file" accept="' + (SNAP_TYPE === 'photo' ? 'image/*' : 'image/*,application/pdf') + '">' +
      '</div></main>';
    return h + nav('snap');
  }
  if (SNAP.step === 'crop') {
    let h = header(SNAP.editFileId ? 'Edit picture' : 'Crop', { right: '<button class="iconbtn" data-act="snapcancel" aria-label="Cancel" style="font-size:14px;width:auto;padding:0 8px">Cancel</button>' });
    h += '<main><div class="snapbody">' +
      '<div id="cropwrap" class="cropwrap"><canvas id="cropcanvas"></canvas><div id="croprect" class="croprect">' +
      '<span class="h tl" data-c="tl"></span><span class="h tr" data-c="tr"></span><span class="h bl" data-c="bl"></span><span class="h br" data-c="br"></span></div></div>' +
      '<div class="btns three"><button class="darkbtn" data-act="rot">Rotate</button><button class="darkbtn" data-act="cropall">Full photo</button>' +
      '<button class="darkbtn" data-act="docmode" aria-pressed="' + SNAP.docMode + '">' + (SNAP.docMode ? 'Black and white' : 'Colour') + '</button></div>' +
      '<label class="slider">Straighten<input id="deg" type="range" min="-15" max="15" step="0.5" value="' + SNAP.deg + '"><span id="degv">' + SNAP.deg + '°</span></label>' +
      (SNAP.editFileId ? '<button class="btn primary big" data-act="editsave">Save changes</button><div class="muted" style="color:#D1D5DB">Black and white can\'t be turned back into colour later.</div>'
        : kindGroup(SNAP.kind) === 'photo'
        ? (SNAP.itemId && D.items[SNAP.itemId] ? '<button class="btn primary big" data-act="photosave" data-v="item">Save photo</button>'
          : '<div class="btns"><button class="btn" data-act="photosave" data-v="inbox">Save to inbox</button><button class="btn primary" data-act="photosave" data-v="file">File to item</button></div>')
        : '<button class="btn primary big" data-act="cropnext">Next</button>') + '</div></main>';
    return h + nav('snap');
  }
  const it = SNAP.itemId && D.items[SNAP.itemId];
  let h = header('Details', { right: '<button class="iconbtn" data-act="snapcancel" aria-label="Cancel" style="font-size:14px;width:auto;padding:0 8px">Cancel</button>', sub: it ? 'For ' + it.name : '' });
  h += '<main><img class="preview" id="snapprev" alt="' + (SNAP.isPdf ? 'First page of the PDF' : 'Cropped image') + '">';
  if (S.autoRead && kindGroup(SNAP.kind) === 'receipt') h += '<div class="muted" id="ocrmsg">' + esc(SNAP.ocrMsg || (SNAP.isPdf ? 'Reading the PDF…' : 'Reading receipt…')) + '</div>';
  h += '<form class="form" data-form="snap">' + kindFields(SNAP.kind, SNAP);
  h += it ? '<button class="btn primary big" type="submit" name="dest" value="item">Save to ' + esc(it.name) + '</button>'
    : '<div class="btns"><button class="btn" type="submit" name="dest" value="inbox">Save to inbox</button><button class="btn primary" type="submit" name="dest" value="file">File to item</button></div>';
  if (SNAP.isPdf) h += '<button class="btn quiet" type="submit" name="dest" value="crop">Save, then crop a receipt out of it</button>';
  if (SNAP.fromFile) h += '<div class="muted">Cut from a PDF. The full PDF stays saved alongside it.</div>';
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
    [['people', 'People things belong to'], ['categories', 'Categories'], ['locations', 'Locations'], ['warrantyTypes', 'Warranty types']].map((x) =>
      '<label class="field"><span>' + x[1] + ' (one per line)</span><textarea id="list-' + x[0] + '" rows="5">' + esc((x[0] === 'people' ? peopleList() : D.lists[x[0]]).join('\n')) + '</textarea></label>').join('') +
    '<button class="btn primary" data-act="savelists">Save lists</button></div></section>';
  h += '<section class="section"><h2>Reports</h2><div class="card pad form"><a class="btn" href="#/reports">Insurance inventory</a><div class="muted">Contents list by property and room, with values, as a PDF or spreadsheet.</div></div></section>';
  h += '<section class="section"><h2>Import</h2><div class="card pad form"><div class="muted">Bring in old receipts from Evernote, or share notes from OneNote.</div><a class="btn" href="#/import">Import from Evernote</a>' +
    '<label class="check"><input type="checkbox" data-act="autoread"' + (S.autoRead ? ' checked' : '') + '> Read receipts automatically after cropping</label>' +
    '<div class="muted">Reading happens on this phone. The first time, it downloads about 7 MB, then works offline.</div></div></section>';
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
  h += '<img class="preview" data-thumb="' + f.id + '" alt="' + esc(f.kind) + '">';
  h += '<div class="btns"><button class="btn primary" data-act="viewfile" data-id="' + id + '">View</button>' +
    ((f.mime === 'image/jpeg' || isPdfFile(f)) && kindGroup(f.kind) === 'receipt' ? '<button class="btn quiet" data-act="readfile" data-id="' + id + '">Read receipt</button>' : '<button class="btn quiet" data-act="openfile" data-id="' + id + '">Open in other app</button>') + '</div>';
  if (isPdfFile(f)) h += '<button class="btn" data-act="viewfile" data-id="' + id + '">Crop a receipt out of this PDF</button>';
  if (/^image\//.test(f.mime || '')) h += '<button class="btn" data-act="editpic" data-id="' + id + '">Edit picture (crop, rotate, black and white)</button>';
  if (f.note) h += '<details><summary class="muted">Shared note text' + (f.lifetime ? ' (mentions lifetime)' : '') + '</summary><div style="white-space:pre-line;font-size:13px;margin-top:6px">' + esc(f.note.slice(0, 2000)) + '</div></details>';
  const grp = groupFiles(f).length;
  if (!it && grp > 1) h += '<div class="muted">Shared together with ' + (grp - 1) + ' other file' + (grp > 2 ? 's' : '') + '. Filing this one files them all.</div>';
  h += '<form class="form" data-form="file" data-id="' + id + '">' + kindFields(f.kind, f) + '<button class="btn primary" type="submit">Save changes</button></form>';
  h += '<div class="muted">' + (it ? 'Filed to ' + esc(it.name) : 'In the inbox') + (f.uploaded ? ' · in Dropbox' : ' · waiting to upload') + '</div>';
  h += '<div class="btns"><button class="btn" data-act="picker" data-id="' + id + '">' + (it ? 'Move to another item' : 'File to item') + '</button>' +
    (it ? '<button class="btn quiet" data-act="unfile" data-id="' + id + '">Back to inbox</button>' : '<button class="btn quiet" data-act="newfromfile" data-id="' + id + '">New item from this</button>') + '</div>';
  h += '<button class="btn danger" data-act="delfile" data-id="' + id + '">Delete file</button>';
  openSheet(h);
}
/* The boxes a file needs depend on what it is: receipts get store, date and total; documents a date; photos nothing. */
function kindFields(kind, v) {
  const g = kindGroup(kind);
  return '<label class="field"><span>What is it?</span><select name="kind" data-kindsel>' + FILE_KINDS.map((k) => opt(k, kind)).join('') + '</select></label>' +
    '<div class="grid2" data-show="receipt doc"' + (g === 'photo' ? ' hidden' : '') + '><label class="field"><span>Date</span><input name="date" type="date" value="' + esc(v.date || '') + '"></label>' +
    '<label class="field" data-show="receipt"' + (g !== 'receipt' ? ' hidden' : '') + '><span>Total (AUD)</span><input name="total" type="number" inputmode="decimal" step="0.01" min="0" value="' + esc(v.total === undefined ? '' : v.total) + '"></label></div>' +
    '<label class="field" data-show="receipt"' + (g !== 'receipt' ? ' hidden' : '') + '><span>Store</span><input name="store" value="' + esc(v.store || '') + '"></label>';
}
function applyKindFields(sel) {
  const g = kindGroup(sel.value), form = sel.closest('form');
  form.querySelectorAll('[data-show]').forEach((el) => { el.hidden = !el.dataset.show.split(' ').includes(g); });
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
/* ---------- v1.01: reading receipts (on the phone, free) ---------- */
const KNOWN_STORES = ['Bunnings', 'Harvey Norman', 'JB Hi-Fi', 'The Good Guys', 'Officeworks', 'Kmart', 'Big W', 'Costco', 'Amazon',
  'Appliances Online', 'Aldi', 'Woolworths', 'Coles', 'Reece', 'Total Tools', 'Sydney Tools', 'Supercheap Auto', 'Repco', 'IKEA', 'Myer',
  'David Jones', 'Apple', 'Samsung', 'eBay', 'Mitre 10', 'Home Hardware', 'Godfreys', 'Bing Lee', 'Domayne', 'Joyce Mayne', 'Retravision',
  'Betta', 'Anaconda', 'BCF', 'Rebel', 'Catch', 'Temu', 'Spotlight', 'Freedom', 'Fantastic Furniture', 'Amart', 'Beacon Lighting',
  'Tradelink', 'Middys', 'Jaycar', 'Altronics', 'Dick Smith', 'Telstra', 'Optus', 'Vodafone', 'Autobarn', 'Bob Jane', 'Beaurepaires',
  'Ozito', 'Makita', 'Dyson', 'Kogan', 'Reolink', 'Tesla'];
function validDate(y, m, d, now) {
  if (y < 100) y += 2000;
  if (y < 1990 || m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  const iso = y + '-' + pad2(m) + '-' + pad2(d);
  if (daysUntil(iso, now) > 1) return null; // a receipt can't be in the future
  return iso;
}
function findDate(text, now) {
  const mon = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
  const pats = [
    [/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g, (m) => validDate(+m[1], +m[2], +m[3], now)],
    [/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g, (m) => validDate(+m[3], +m[2], +m[1], now)],
    [new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+(' + mon + ')[a-z]*\\.?,?[\\s-]+(\\d{2,4})\\b', 'gi'),
      (m) => validDate(+m[3], ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1], now)],
    [new RegExp('\\b(' + mon + ')[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b', 'gi'),
      (m) => validDate(+m[3], ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2], now)]
  ];
  let best = null;
  for (const [re, fn] of pats) {
    let m;
    while ((m = re.exec(text))) { const iso = fn(m); if (iso && (!best || m.index < best.at)) best = { iso, at: m.index }; }
  }
  return best ? best.iso : '';
}
function amountsIn(line) {
  const out = [], re = /(?:\$|aud\s?)?\s?(\d{1,3}(?:,\d{3})+|\d{1,6})[.,](\d{2})(?!\d)/gi;
  let m;
  while ((m = re.exec(line))) out.push(+(m[1].replace(/,/g, '') + '.' + m[2]));
  const whole = /\$\s?(\d{1,3}(?:,\d{3})+|\d{1,6})(?![\d.,]*\d)/g; // "$450" in hand-typed notes
  while ((m = whole.exec(line))) out.push(+m[1].replace(/,/g, ''));
  return out.filter((v) => v > 0 && v < 200000);
}
function findTotal(text) {
  const lines = text.split(/\r?\n/);
  let best = null;
  lines.forEach((ln, i) => {
    if (!/\b(total|amount\s+due|balance\s+due|amount\s+paid|eftpos|visa|mastercard|card\s+payment|purchase)\b/i.test(ln)) return;
    if (/sub\s*-?\s*total|gst|tax\b|change|saving|discount|rounding|points/i.test(ln)) return;
    let am = amountsIn(ln);
    if (!am.length && lines[i + 1]) am = amountsIn(lines[i + 1]);
    am.forEach((v) => { if (best == null || v > best) best = v; });
  });
  if (best == null) { const all = amountsIn(text); if (all.length) best = Math.max.apply(null, all); }
  return best == null ? '' : best;
}
function findStore(text, knownOnly) {
  const low = text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
  for (const s of KNOWN_STORES) {
    const k = s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
    if (new RegExp('\\b' + k.replace(/\s+/g, '\\s*') + '\\b').test(low)) return s;
  }
  if (knownOnly) return '';
  for (const raw of text.split(/\r?\n/).slice(0, 6)) {
    const ln = raw.replace(/[^A-Za-z0-9&' -]+/g, ' ').replace(/\s+/g, ' ').trim();
    if ((ln.match(/[A-Za-z]/g) || []).length < 3) continue;
    if (/tax\s*invoice|receipt|abn|invoice|welcome|thank|phone|ph\b|www|http|^date/i.test(ln)) continue;
    return ln.slice(0, 40).replace(/(^|[\s-])([a-z])([a-z']*)/gi, (m, sp, a, b) => sp + a.toUpperCase() + b.toLowerCase());
  }
  return '';
}
/* Pull store, date, total and a lifetime flag out of receipt or note text. */
/* knownOnly: for typed notes, only name a store we recognise (the first line is usually the item, not the shop). */
function parseReceiptText(text, now, knownOnly) {
  const t = String(text || '');
  return { store: findStore(t, knownOnly), date: findDate(t, now), total: findTotal(t), lifetime: /life\s?-?time/i.test(t) };
}

let ocrWorker = null, ocrLoading = null;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
}
async function getOcr() {
  if (ocrWorker) return ocrWorker;
  if (!ocrLoading) {
    ocrLoading = (async () => {
      if (typeof Tesseract === 'undefined') await loadScript('tesseract.min.js');
      const abs = (p) => new URL(p, location.href).href;
      ocrWorker = await Tesseract.createWorker('eng', 1, {
        workerPath: abs('worker.min.js'), corePath: abs('tesseract-core-simd-lstm.wasm.js'), langPath: abs('./').replace(/\/$/, ''), gzip: true
      });
      return ocrWorker;
    })();
  }
  try { return await ocrLoading; } catch (e) { ocrLoading = null; throw e; }
}
async function readReceipt(blob) {
  const w = await getOcr();
  const r = await w.recognize(blob);
  return Object.assign({ text: r.data.text || '' }, parseReceiptText(r.data.text || ''));
}
/* Fill only the empty boxes in a form, so nothing typed is overwritten. */
function fillEmpty(form, vals) {
  let n = 0;
  [['store', vals.store], ['date', vals.date], ['total', vals.total]].forEach(([k, v]) => {
    const el = form && form.querySelector('[name="' + k + '"]');
    if (!el || v === '' || v == null) return;
    if (k === 'date' ? (el.value && el.value !== todayISO()) : el.value) return;
    el.value = v; n++;
  });
  return n;
}
/* ---------- v1.01: shared notes and files ---------- */
function firstLine(s) { return String(s || '').split(/\r?\n/).map((x) => x.trim()).find(Boolean) || ''; }
async function importShared() {
  const keys = await idb.keys('share');
  if (!keys.length) return;
  let n = 0;
  for (const k of keys) {
    const s = await idb.get('share', k);
    try {
      const batch = s && s.files ? s : { files: s ? [s] : [], title: '', text: '' };
      const text = [batch.title, batch.text].filter(Boolean).join('\n').trim();
      const p = text ? parseReceiptText(text, null, true) : {};
      if (!batch.files.length) {
        if (text) NEW_ITEM_PREFILL = { name: firstLine(batch.title || text).slice(0, 80), notes: text, store: p.store || '', purchaseDate: p.date || '', price: p.total === '' ? '' : p.total, _lifetime: !!p.lifetime };
        continue;
      }
      const gid = uid();
      for (const sf of batch.files) {
        const isPdf = sf.type === 'application/pdf' || /\.pdf$/i.test(sf.name || '');
        const isImg = /^image\//.test(sf.type || '');
        let full = sf.blob, thumb = null, pp = {};
        if (isImg) { const r = await quickCompress(sf.blob); full = r.full; thumb = r.thumb; }
        if (isPdf) {
          try { thumb = await pdfThumbBlob(sf.blob); } catch (e) { /* unreadable */ }
          try { pp = await readPdf(sf.blob); } catch (e) { /* no text */ }
        }
        const f = touch({ id: uid(), itemId: null, kind: isPdf ? 'Tax invoice' : isImg ? 'Receipt' : 'Other', date: p.date || pp.date || todayISO(), store: p.store || pp.store || '',
          total: p.total !== undefined && p.total !== '' ? p.total : (pp.total === undefined ? '' : pp.total), mime: isImg ? 'image/jpeg' : (sf.type || 'application/octet-stream'), origName: sf.name || '',
          size: full.size, uploaded: false, path: null, createdAt: Date.now(), groupId: gid, title: batch.title || '', note: text, lifetime: !!p.lifetime });
        await idb.put('blobs', f.id, full); if (thumb) await idb.put('thumbs', f.id, thumb);
        D.files[f.id] = f; n++;
      }
    } finally { await idb.del('share', k); }
  }
  if (n) { await saveData(); toast(n + ' file' + (n > 1 ? 's' : '') + ' added to inbox'); }
  if (NEW_ITEM_PREFILL && !n) { location.hash = '#/new'; toast('Note shared: check the details and save'); }
}
function groupFiles(f) { return f.groupId ? inboxFiles().filter((x) => x.groupId === f.groupId) : [f]; }

/* ---------- v1.01: Evernote (.enex) import ---------- */
let IMP = null;          // import state, saved in IndexedDB
let IMP_PILE = 'recent';
let IMP_RUN = null;      // {done, size} while reading the file
const PILES = [['life', 'Lifetime'], ['recent', 'Last 5 years'], ['old', 'Older']];
async function loadImport() { IMP = (await idb.get('kv', 'import')) || null; }
async function saveImport() { await idb.put('kv', 'import', IMP); }
function impPending(pile) { return IMP ? IMP.order.map((id) => IMP.drafts[id]).filter((d) => d.status === 'pending' && (!pile || d.pile === pile)) : []; }

function bytesIndexOf(hay, needle, from) {
  const first = needle[0];
  for (let i = hay.indexOf(first, from || 0); i !== -1 && i <= hay.length - needle.length; i = hay.indexOf(first, i + 1)) {
    let ok = true;
    for (let j = 1; j < needle.length; j++) if (hay[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}
/* Read the export a few MB at a time, one note at a time, so big files don't run the phone out of memory. */
async function* enexNotes(file, start) {
  const enc = new TextEncoder(), dec = new TextDecoder('utf-8'), OPEN = enc.encode('<note>'), CLOSE = enc.encode('</note>'), CH = window.OG_CHUNK || 4 * 1024 * 1024;
  let pos = start || 0, buf = new Uint8Array(0), bufStart = pos;
  while (true) {
    let c;
    while ((c = bytesIndexOf(buf, CLOSE, 0)) !== -1) {
      const o = bytesIndexOf(buf, OPEN, 0);
      const end = c + CLOSE.length;
      yield { xml: dec.decode(buf.subarray(o !== -1 && o < c ? o : 0, end)), endOffset: bufStart + end };
      buf = buf.slice(end); bufStart += end;
    }
    if (pos >= file.size) break;
    const chunk = new Uint8Array(await file.slice(pos, pos + CH).arrayBuffer());
    pos += chunk.length;
    const nb = new Uint8Array(buf.length + chunk.length); nb.set(buf); nb.set(chunk, buf.length); buf = nb;
    IMP_RUN.done = pos;
  }
}
function enmlToText(enml) {
  const doc = new DOMParser().parseFromString(String(enml || '').replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>/gi, ''), 'text/html');
  doc.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  doc.querySelectorAll('div,p,li,tr,h1,h2,h3,h4,en-todo').forEach((b) => b.append('\n'));
  return (doc.body ? doc.body.textContent : '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function enDate(s) { const m = /^(\d{4})(\d{2})(\d{2})T/.exec(s || ''); return m ? m[1] + '-' + m[2] + '-' + m[3] : ''; }
function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function findDuplicate(d) {
  const n = normName(d.title);
  for (const it of live('items')) {
    if (n && n.length > 3 && normName(it.name) === n) return it.id;
    if (d.date && d.total !== '' && itemFiles(it.id).some((f) => f.date === d.date && +f.total === +d.total)) return it.id;
  }
  return null;
}
function pileFor(d) {
  if (d.lifetime) return 'life';
  const days = d.date ? daysUntil(d.date) : null;
  return days != null && days >= -365 * 5 ? 'recent' : 'old';
}
async function draftFromNote(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const q = (sel) => { const e = doc.querySelector(sel); return e ? e.textContent : ''; };
  const title = q('note > title').trim() || 'Untitled note';
  const text = enmlToText(q('note > content'));
  const p = parseReceiptText(title + '\n' + text, null, true);
  const created = enDate(q('note > created'));
  const d = { id: uid(), title: title.slice(0, 120), text: text.slice(0, 6000), created, store: p.store, date: p.date || created, total: p.total,
    lifetime: p.lifetime, tags: Array.from(doc.querySelectorAll('note > tag')).map((t) => t.textContent).join(', '), files: [], status: 'pending' };
  for (const r of doc.querySelectorAll('note > resource')) {
    const mime = (r.querySelector('mime') || {}).textContent || 'application/octet-stream';
    const dataEl = r.querySelector('data');
    if (!dataEl) continue;
    const b64 = dataEl.textContent.replace(/\s+/g, '');
    if (b64.length < 16000 && /^image\//.test(mime)) continue; // skip tiny images (logos, icons)
    const name = (r.querySelector('resource-attributes > file-name') || {}).textContent || '';
    let blob = await (await fetch('data:' + mime + ';base64,' + b64)).blob();
    const fid = uid();
    let outMime = mime, thumb = null;
    if (/^image\/(jpeg|png|gif|webp|bmp|heic|heif)/.test(mime)) {
      try { const c = await quickCompress(blob); blob = c.full; thumb = c.thumb; outMime = 'image/jpeg'; } catch (e) { /* keep original */ }
    } else if (mime === 'application/pdf') {
      try { thumb = await pdfThumbBlob(blob); } catch (e) { /* unreadable */ }
      if (!d.date || d.date === created || d.total === '') {
        try { const r = await readPdf(blob); if (r.date && (!d.date || d.date === created)) d.date = r.date; if (d.total === '' && r.total !== '') d.total = r.total; if (!d.store) d.store = r.store; } catch (e) { /* no text */ }
      }
    }
    await idb.put('blobs', fid, blob); if (thumb) await idb.put('thumbs', fid, thumb);
    d.files.push({ id: fid, mime: outMime, origName: name, size: blob.size, thumb: !!thumb });
  }
  d.pile = pileFor(d);
  d.dup = findDuplicate(d);
  return d;
}
async function startEnex(file) {
  if (!file) return;
  if (IMP && !IMP.done && (IMP.fileName !== file.name || IMP.size !== file.size)) { toast('Finish or clear the current import first'); return; }
  if (IMP && IMP.done && impPending().length) { toast('Finish or clear the current review first'); return; }
  if (!IMP || IMP.done) IMP = { source: 'Evernote', fileName: file.name, size: file.size, offset: 0, count: 0, done: false, drafts: {}, order: [] };
  IMP_RUN = { done: IMP.offset, size: file.size };
  render();
  let since = 0;
  try {
    for await (const note of enexNotes(file, IMP.offset)) {
      const d = await draftFromNote(note.xml);
      if (d) { IMP.drafts[d.id] = d; IMP.order.push(d.id); IMP.count++; }
      IMP.offset = note.endOffset;
      if (++since >= 10 || IMP.count === 1) { since = 0; await saveImport(); }
      const el = $('#impprog'); if (el) el.textContent = IMP.count + ' notes read · ' + Math.round(100 * IMP_RUN.done / IMP_RUN.size) + '%';
    }
    IMP.done = true; await saveImport(); IMP_RUN = null;
    const piles = PILES.map(([k]) => impPending(k).length);
    IMP_PILE = piles[1] ? 'recent' : piles[0] ? 'life' : 'old';
    toast(IMP.count + ' notes ready to review'); render();
  } catch (e) {
    await saveImport(); IMP_RUN = null; render();
    toast('Import stopped: ' + e.message.slice(0, 100) + '. Pick the same file to carry on.');
  }
}
async function clearImport() {
  if (!IMP) return;
  for (const d of Object.values(IMP.drafts)) if (d.status === 'pending') for (const f of d.files) { await idb.del('blobs', f.id); await dropThumb(f.id); }
  IMP = null; await idb.del('kv', 'import');
}
/* Turn a reviewed draft into an item (or add it to an existing one). */
function draftFileRecs(d, itemId) {
  return d.files.map((x) => touch({ id: x.id, itemId, kind: /^image\//.test(x.mime) ? 'Receipt' : x.mime === 'application/pdf' ? 'Tax invoice' : 'Other',
    date: d.date || '', store: d.store || '', total: d.total === undefined ? '' : d.total, mime: x.mime, origName: x.origName, size: x.size,
    uploaded: false, path: null, createdAt: Date.now() }));
}
function acceptDraft(d, vals, archived) {
  const it = touch({ id: uid(), createdAt: Date.now(), name: vals.name || d.title, category: vals.category || '', brand: '', model: '', serial: '',
    propertyId: vals.propertyId || (D.lists.properties[0] || {}).id, location: vals.location || '', spot: '', owner: 'Shared', store: vals.store || '',
    purchaseDate: vals.date || '', installDate: '', price: vals.total === '' || vals.total == null ? '' : +vals.total, replacementValue: '', status: 'Active',
    work: false, notes: d.text + (d.tags ? '\n\nTags: ' + d.tags : '') + '\n\n(Imported from ' + IMP.source + ')', archived: !!archived, archivedAt: archived ? Date.now() : null });
  D.items[it.id] = it;
  draftFileRecs(Object.assign({}, d, { date: vals.date, store: vals.store, total: vals.total }), it.id).forEach((f) => { D.files[f.id] = f; });
  const term = vals.warranty || (d.lifetime ? 'lifetime' : '');
  if (term) {
    const w = touch({ id: uid(), itemId: it.id, createdAt: Date.now(), type: 'Maker', covers: '', startFrom: 'purchase', startDate: '', expiryOverride: '',
      provider: '', contact: '', conditions: '', termUnit: term === 'lifetime' ? 'lifetime' : 'years', termValue: term === 'lifetime' ? '' : term });
    D.warranties[w.id] = w;
  }
  d.status = 'accepted'; d.itemId = it.id;
  return it;
}

function viewImport() {
  let h = header('Import', { back: '#/settings', sub: IMP ? IMP.source + ' · ' + IMP.fileName : 'Evernote export file' });
  h += '<main>';
  if (IMP_RUN) {
    h += '<div class="card pad"><div class="t" style="font-weight:700">Reading notes…</div><div class="muted" id="impprog">' + (IMP ? IMP.count : 0) + ' notes read</div>' +
      '<p class="muted">Keep the app open. If it stops, pick the same file again and it carries on where it left off.</p></div>';
    return h + '</main>' + nav('settings');
  }
  if (!IMP || (IMP.done && !impPending().length)) {
    if (IMP && IMP.done) h += '<div class="note">Import finished: ' + IMP.order.filter((id) => IMP.drafts[id].status === 'accepted').length + ' added, ' +
      IMP.order.filter((id) => IMP.drafts[id].status === 'skipped').length + ' skipped. <button class="btn quiet" style="margin-top:8px;width:100%" data-act="impclear">Clear import record</button></div>';
    h += '<div class="card pad form"><div class="t" style="font-weight:700">Evernote</div><div class="muted">Export each notebook as an .enex file from the Evernote desktop app (Windows or Mac), save it to Dropbox, then pick it here. Every note becomes a draft for you to check.</div>' +
      '<label class="btn primary" for="enexIn">Pick .enex file</label><input id="enexIn" class="sr" type="file"></div>';
    h += '<div class="card pad form"><div class="t" style="font-weight:700">OneNote and anything else</div><div class="muted">Open a note on your phone, tap Share and choose Our Gear. Photos and PDFs land in the inbox with the note\'s text, and the store, date, price and "lifetime" are picked up for you.</div></div>';
    return h + '</main>' + nav('settings');
  }
  if (!IMP.done) {
    h += '<div class="warn">Reading stopped part-way (' + IMP.count + ' notes so far). Pick the same file to carry on.</div>' +
      '<label class="btn primary big" for="enexIn">Pick ' + esc(IMP.fileName) + '</label><input id="enexIn" class="sr" type="file">' +
      '<button class="btn danger" data-act="impclear">Cancel import</button>';
    return h + '</main>' + nav('settings');
  }
  const all = impPending().length, total = IMP.order.length;
  h += '<div class="card pad"><div style="height:8px;border-radius:4px;background:var(--border)"><div style="height:8px;border-radius:4px;background:var(--accent);width:' + Math.round(100 * (total - all) / total) + '%"></div></div>' +
    '<div class="muted" style="margin-top:6px">' + (total - all) + ' of ' + total + ' done · progress is saved</div></div>';
  h += '<div class="btns three">' + PILES.map(([k, l]) => '<button class="chip" style="min-height:48px;border-radius:10px" data-act="imppile" data-v="' + k + '" aria-pressed="' + (IMP_PILE === k) + '">' + l + '<br>' + impPending(k).length + '</button>').join('') + '</div>';
  const d = impPending(IMP_PILE)[0];
  if (!d) {
    h += '<div class="card empty">Nothing left in this pile.</div>';
  } else {
    const dupItem = d.dup && D.items[d.dup] && !D.items[d.dup].deleted ? D.items[d.dup] : null;
    h += '<form class="card pad form" data-form="draft" data-id="' + d.id + '">';
    h += '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="muted">From "' + esc(d.title) + '"</span>' +
      (dupItem ? '<span class="badge b-soon">Possible duplicate</span>' : '') + '</div>';
    if (d.files.length) h += '<div class="files">' + d.files.map((f) => f.thumb ? '<img class="thumb" style="width:100%;height:auto;aspect-ratio:3/4" data-thumb="' + f.id + '" alt="Attachment">' : '<div class="thumb" style="width:100%;height:auto;aspect-ratio:3/4">' + esc(f.mime === 'application/pdf' ? 'PDF' : 'File') + '</div>').join('') + '</div>';
    if (dupItem) h += '<div class="warn">Looks like <a href="#/item/' + dupItem.id + '">' + esc(dupItem.name) + '</a>, already in Our Gear. Merge adds these files and notes to it.</div>';
    h += '<label class="field req"><span>Item name</span><input name="name" value="' + esc(d.title) + '" required></label>';
    h += '<div class="grid2"><label class="field"><span>Date</span><input name="date" type="date" value="' + esc(d.date || '') + '"></label>' +
      '<label class="field"><span>Price (AUD)</span><input name="total" type="number" inputmode="decimal" step="0.01" min="0" value="' + esc(d.total) + '"></label></div>';
    h += '<label class="field"><span>Store</span><input name="store" value="' + esc(d.store || '') + '"></label>';
    h += '<div class="grid2"><label class="field"><span>Category</span><select name="category">' + opt('', '', 'Choose…') + D.lists.categories.map((c) => opt(c, '')).join('') + '</select></label>' +
      '<label class="field"><span>Warranty</span><select name="warranty">' + opt('', d.lifetime ? 'lifetime' : '', 'None or unknown') + opt('lifetime', d.lifetime ? 'lifetime' : '', 'Lifetime') +
      [1, 2, 3, 5, 7, 10, 25].map((y) => opt(String(y), '', y + ' year' + (y > 1 ? 's' : ''))).join('') + '</select></label></div>';
    h += '<div class="grid2"><label class="field"><span>Property</span><select name="propertyId">' + D.lists.properties.map((p) => opt(p.id, IMP.lastProp || D.lists.properties[0].id, p.name)).join('') + '</select></label>' +
      '<label class="field"><span>Location</span><input name="location" list="locs2"></label></div><datalist id="locs2">' + D.lists.locations.map((l) => '<option value="' + esc(l) + '">').join('') + '</datalist>';
    if (d.text) h += '<details><summary class="muted">Note text</summary><div style="white-space:pre-line;font-size:13px;margin-top:6px">' + esc(d.text.slice(0, 2000)) + '</div></details>';
    if (d.files.some((f) => f.thumb)) h += '<button class="btn quiet" type="button" data-act="impocr" data-id="' + d.id + '">Read receipt</button>';
    h += '<div class="btns three"><button class="btn quiet" type="submit" name="act" value="skip">Skip</button><button class="btn" type="submit" name="act" value="merge">Merge</button>' +
      '<button class="btn primary" type="submit" name="act" value="accept">Accept</button></div></form>';
  }
  if (IMP_PILE === 'old' && impPending('old').length) {
    const n = impPending('old').length;
    h += '<button class="btn" data-act="impoldall">Import all ' + n + ' older as archived</button><button class="btn quiet" data-act="impskipold">Skip all ' + n + ' older</button>' +
      '<p class="muted">Archived items keep their receipts in Dropbox and stay searchable.</p>';
  }
  h += '<button class="btn danger" data-act="impclear">Cancel import</button>';
  return h + '</main>' + nav('settings');
}
/* ---------- v1.02: PDFs (previews, viewer, reading, crop a receipt out of a page) ---------- */
let pdfjsLib = null;
const absUrl = (p) => new URL(p, location.href).href;
async function getPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  const m = await import(absUrl('pdf.min.mjs'));
  m.GlobalWorkerOptions.workerSrc = absUrl('pdf.worker.min.mjs');
  pdfjsLib = m;
  return m;
}
function isPdfFile(f) { return f && (f.mime === 'application/pdf' || /\.pdf$/i.test(f.origName || f.name || '')); }
async function openPdf(blob) {
  const m = await getPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const task = m.getDocument({ data, wasmUrl: absUrl('./'), isEvalSupported: false });
  const pdf = await task.promise;
  pdf._task = task;
  return pdf;
}
function closePdf(pdf) {
  try { if (pdf && pdf._task) pdf._task.destroy(); else if (pdf && typeof pdf.destroy === 'function') pdf.destroy(); } catch (e) { /* already closed */ }
}
async function renderPdfPage(pdf, n, width) {
  const page = await pdf.getPage(n);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(width / vp1.width, 4) });
  const c = newCanvas(vp.width, vp.height), ctx = c.getContext('2d');
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise;
  return c;
}
async function pdfThumbBlob(blob) {
  const pdf = await openPdf(blob);
  try { return await canvasBlob(scaledCopy(await renderPdfPage(pdf, 1, 480), 320), 0.7); } finally { closePdf(pdf); }
}
/* Digital invoices carry their text, so store, date and total can be read exactly. */
async function pdfText(blob, maxPages) {
  const pdf = await openPdf(blob);
  try {
    let out = '';
    for (let i = 1; i <= Math.min(pdf.numPages, maxPages || 3); i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      out += tc.items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
    }
    return out;
  } finally { closePdf(pdf); }
}
async function readPdf(blob) { const t = await pdfText(blob); return Object.assign({ text: t }, parseReceiptText(t)); }
async function getFileBlob(f) {
  const b = await idb.get('blobs', f.id);
  if (b) return b;
  if (!f.uploaded) throw new Error('this file is still on the other phone');
  if (!DBX.connected() || !navigator.onLine) throw new Error('needs internet and Dropbox');
  const r = await DBX.download(f.path);
  if (!r) throw new Error('not found in Dropbox');
  return r.blob;
}

/* ---------- viewer ---------- */
let VIEW = null; // { f, blob, pdf, zoom, url }
function closeViewer() {
  const v = $('#viewer'); if (v) { v.hidden = true; v.innerHTML = ''; }
  if (VIEW) { if (VIEW.pdf) closePdf(VIEW.pdf); if (VIEW.url) URL.revokeObjectURL(VIEW.url); }
  VIEW = null;
}
async function openViewer(id) {
  const f = D.files[id]; if (!f) return;
  closeSheet();
  const v = $('#viewer');
  v.hidden = false;
  v.innerHTML = '<div class="vbar"><button class="vbtn" data-act="vclose">Close</button><span class="vtitle">' + esc(f.kind || 'File') + '</span></div><div class="vbody"><p class="vmsg">Opening…</p></div>';
  try {
    const blob = await getFileBlob(f);
    VIEW = { f, blob, zoom: 1 };
    if (isPdfFile(f)) VIEW.pdf = await openPdf(blob);
    else if (/^image\//.test(f.mime)) VIEW.url = URL.createObjectURL(blob);
    else { closeViewer(); openFile(f); return; }
    await drawViewer();
  } catch (e) { closeViewer(); toast('Could not open: ' + e.message.slice(0, 100)); }
}
async function drawViewer() {
  if (!VIEW) return;
  const v = $('#viewer'), f = VIEW.f, pdf = VIEW.pdf;
  const w = Math.round((Math.min(window.innerWidth, 640) - 16) * VIEW.zoom);
  v.innerHTML = '<div class="vbar"><button class="vbtn" data-act="vclose">Close</button><span class="vtitle">' + esc(f.kind || 'File') + (pdf ? ' · ' + pdf.numPages + ' page' + (pdf.numPages > 1 ? 's' : '') : '') + '</span>' +
    '<button class="vbtn" data-act="vzoom" data-v="-1" aria-label="Zoom out">−</button><button class="vbtn" data-act="vzoom" data-v="1" aria-label="Zoom in">+</button>' +
    '<button class="vbtn" data-act="vext">Other app</button></div><div class="vbody" id="vbody"></div>';
  const body = $('#vbody');
  if (!pdf) { body.innerHTML = '<img src="' + VIEW.url + '" alt="' + esc(f.kind) + '" style="width:' + w + 'px;max-width:none;display:block;margin:0 auto">'; return; }
  const n = Math.min(pdf.numPages, 30), dpr = Math.min(window.devicePixelRatio || 1, 2), mine = VIEW;
  for (let i = 1; i <= n; i++) {
    const c = await renderPdfPage(pdf, i, w * dpr);
    if (VIEW !== mine) return;
    c.style.width = w + 'px'; c.className = 'vpage';
    body.appendChild(c);
    const b = document.createElement('button');
    b.className = 'vcrop'; b.dataset.act = 'vcrop'; b.dataset.v = String(i);
    b.textContent = 'Crop a receipt from page ' + i;
    body.appendChild(b);
  }
  if (pdf.numPages > n) body.insertAdjacentHTML('beforeend', '<p class="vmsg">Showing the first 30 pages. Use Other app for the rest.</p>');
}
async function cropFromPdfPage(n) {
  const src = await renderPdfPage(VIEW.pdf, n, 1800);
  const f = VIEW.f;
  closeViewer();
  if (!f.groupId) { f.groupId = uid(); touch(f); await saveData(); }
  SNAP = { step: 'crop', file: { name: 'page-' + n + '.jpg', type: 'image/jpeg' }, isPdf: false, quarter: 0, deg: 0, docMode: false,
    itemId: f.itemId || null, kind: 'Receipt', date: f.date || todayISO(), store: f.store || '', total: f.total === undefined ? '' : f.total,
    src, fromFile: f.id, groupId: f.groupId };
  rebuildWork();
  SNAP_TARGET = f.itemId || null;
  if (location.hash === '#/snap') render(); else location.hash = '#/snap';
}
/* ---------- v1.03: claims and fault log, service jobs, Send to Our Tax ---------- */
const CLAIM_STATUS = ['Open', 'Waiting', 'Resolved', 'Rejected'];
const CONTACT_KINDS = ['Phone call', 'Email', 'Online form', 'Live chat', 'In person', 'Letter'];
const LOG_KINDS = CONTACT_KINDS.concat(['Technician visit', 'Repair', 'Replacement', 'Service', 'Note']);
const DIRECTIONS = [['out', 'You contacted them'], ['in', 'They contacted you'], ['', 'Not a contact (a note)']];
function isContact(l) { return CONTACT_KINDS.includes(l.kind) || l.kind === 'Visit'; }
function daysBetween(a, b) { const x = parseISO(a), y = parseISO(b); return x && y ? Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / 864e5) : null; }
/* Plain-English summary of a claim: when and how it was reported, follow-ups, replies, gaps. */
function claimStats(c) {
  const logs = claimLogs(c.id).slice().reverse();
  const first = logs.find((l) => l.first) || logs[0] || null;
  const reported = c.opened || (first && first.date) || '';
  const end = isOpenClaim(c) ? todayISO() : (c.closed || todayISO());
  const later = logs.filter((l) => l !== first);
  const out = later.filter((l) => l.direction === 'out' || (!l.direction && isContact(l)));
  const inn = later.filter((l) => l.direction === 'in');
  const contacts = logs.filter((l) => l.first || l.direction === 'in' || l.direction === 'out');
  const last = contacts[contacts.length - 1] || null;
  let longestGap = 0;
  for (let i = 1; i < logs.length; i++) longestGap = Math.max(longestGap, daysBetween(logs[i - 1].date, logs[i].date) || 0);
  if (isOpenClaim(c) && logs.length) longestGap = Math.max(longestGap, daysBetween(logs[logs.length - 1].date, todayISO()) || 0);
  return { logs, first, reported, how: first && first.first ? first.kind : '', days: daysBetween(reported, end), followUps: out.length, replies: inn.length, last, longestGap };
}
function followUpStatus(c) {
  if (!c.followUp || !isOpenClaim(c)) return null;
  const d = daysUntil(c.followUp);
  return { kind: d < 0 ? 'gone' : d <= 2 ? 'soon' : 'life', label: d < 0 ? 'Follow up overdue' : d === 0 ? 'Follow up today' : 'Follow up ' + fmtDate(c.followUp), days: d };
}
function followUpsDue() { return openClaims().map((c) => ({ c, f: followUpStatus(c) })).filter((x) => x.f && x.f.days <= 2).sort((a, b) => a.f.days - b.f.days); }
function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
const OURTAX_URL = 'https://sskehan.github.io/ourtax/';
function claimBadge(c) { return { kind: { Open: 'soon', Waiting: 'life', Resolved: 'ok', Rejected: 'gone' }[c.status] || 'none', label: c.status || 'Open' }; }
function isOpenClaim(c) { return c.status === 'Open' || c.status === 'Waiting'; }
function itemClaims(itemId) { return live('claims').filter((c) => c.itemId === itemId).sort((a, b) => (isOpenClaim(b) - isOpenClaim(a)) || (b.opened || '').localeCompare(a.opened || '')); }
function sortLogs(a, b) { return (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0); }
function claimLogs(claimId) { return live('logs').filter((l) => l.claimId === claimId).sort(sortLogs); }
function itemLogs(itemId) { return live('logs').filter((l) => l.itemId === itemId).sort(sortLogs); }
function liveItem(id) { const it = D.items[id]; return it && !it.deleted ? it : null; }
function openClaims() { return live('claims').filter((c) => isOpenClaim(c) && liveItem(c.itemId)); }
function itemServices(itemId) { return live('services').filter((s) => s.itemId === itemId); }
function serviceStatus(s, now) {
  const from = s.lastDone || s.startDate || todayISO(new Date(s.createdAt || Date.now()));
  const next = addTerm(from, +s.everyMonths, 'months');
  if (!next) return { kind: 'none', label: 'No date', next: null, days: null };
  const d = daysUntil(next, now);
  if (d < 0) return { kind: 'gone', label: 'Overdue', next, days: d };
  if (d <= 30) return { kind: 'soon', label: d === 0 ? 'Due today' : 'Due in ' + d + ' day' + (d === 1 ? '' : 's'), next, days: d };
  return { kind: 'ok', label: 'Next ' + fmtDate(next), next, days: d };
}
function servicesDue(now) {
  return live('services').filter((s) => { const it = liveItem(s.itemId); return it && !it.archived; })
    .map((s) => ({ s, st: serviceStatus(s, now), it: D.items[s.itemId] })).filter((x) => x.st.kind === 'gone' || x.st.kind === 'soon')
    .sort((a, b) => a.st.days - b.st.days);
}

/* ---------- claims screens ---------- */
function claimRow(c, showItem) {
  const it = D.items[c.itemId], last = claimLogs(c.id)[0];
  return '<a class="row" href="#/claim/' + c.id + '"><div class="grow"><div class="t">' + esc(c.title) + '</div><div class="s">' +
    esc([showItem && it ? it.name : '', c.ticket ? 'Ticket ' + c.ticket : '', last ? 'Last entry ' + fmtDate(last.date) : 'Opened ' + fmtDate(c.opened)].filter(Boolean).join(' · ')) +
    '</div></div>' + badge(followUpStatus(c) && followUpStatus(c).days <= 2 ? followUpStatus(c) : claimBadge(c)) + '</a>';
}
function viewClaims() {
  const all = live('claims').filter((c) => liveItem(c.itemId));
  const open = all.filter(isOpenClaim).sort((a, b) => (b.opened || '').localeCompare(a.opened || ''));
  const done = all.filter((c) => !isOpenClaim(c)).sort((a, b) => (b.closed || b.opened || '').localeCompare(a.closed || a.opened || ''));
  let h = header('Claims', { sub: open.length + ' open' });
  h += '<main>';
  if (!all.length) h += '<div class="card empty">No claims yet. To start one, open an item, go to its Log tab and tap Log a fault.</div>';
  if (open.length) h += '<section class="section"><h2>Open</h2><div class="card list">' + open.map((c) => claimRow(c, true)).join('') + '</div></section>';
  if (done.length) h += '<section class="section"><h2>Finished</h2><div class="card list">' + done.map((c) => claimRow(c, true)).join('') + '</div></section>';
  return h + '</main>' + nav('claims');
}
function entryHTML(l, showClaim) {
  const c = l.claimId && D.claims[l.claimId];
  const files = (l.fileIds || []).map((id) => D.files[id]).filter((f) => f && !f.deleted);
  const who = c && !c.deleted ? (c.provider || 'them') : 'them';
  const dir = l.first ? 'Fault reported' + (isContact(l) ? ' to ' + who : '') : l.direction === 'in' ? who + ' contacted you' : l.direction === 'out' ? 'You contacted ' + who : '';
  return '<button class="entry' + (l.direction === 'in' ? ' entry-in' : '') + '" data-act="logsheet" data-id="' + l.id + '"><div class="entry-head"><span class="t">' + esc(l.kind) + '</span><span class="muted">' + esc(fmtDate(l.date)) + '</span></div>' +
    (dir ? '<div class="entry-dir">' + esc(dir) + '</div>' : '') +
    (showClaim && c && !c.deleted ? '<div class="muted">Claim: ' + esc(c.title) + '</div>' : '') +
    (l.ticket || l.contact ? '<div class="muted">' + esc([l.ticket ? 'Ticket ' + l.ticket : '', l.contact ? 'Spoke with ' + l.contact : ''].filter(Boolean).join(' · ')) + '</div>' : '') +
    (l.text ? '<div style="white-space:pre-line">' + esc(l.text) + '</div>' : '') +
    (files.length ? '<div class="entry-files">' + files.map((f) => '<img data-thumb="' + f.id + '" alt="' + esc(f.kind) + '">').join('') + '</div>' : '') + '</button>';
}
function viewClaim(id) {
  const c = D.claims[id];
  if (!c || c.deleted || !liveItem(c.itemId)) return header('Not found', { back: '#/claims' }) + '<main><div class="card empty">This claim was deleted.</div></main>' + nav('claims');
  const it = D.items[c.itemId], w = c.warrantyId && D.warranties[c.warrantyId] && !D.warranties[c.warrantyId].deleted ? D.warranties[c.warrantyId] : null;
  const logs = claimLogs(id);
  let h = header(c.title, { back: '#/item/' + it.id, sub: it.name });
  h += '<main>';
  const st = claimStats(c), fu = followUpStatus(c);
  h += '<div class="card pad summary"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="t" style="font-weight:700">At a glance</span>' + badge(claimBadge(c)) + '</div><ul>' +
    '<li>Reported ' + esc(fmtDate(st.reported)) + (st.how ? ' by ' + esc(st.how.toLowerCase()) : '') + (c.provider ? ' to ' + esc(c.provider) : '') + '</li>' +
    '<li>' + (isOpenClaim(c) ? 'Open for ' : 'Took ') + esc(plural(st.days || 0, 'day')) + '</li>' +
    '<li>You followed up ' + esc(plural(st.followUps, 'time')) + ' · they contacted you ' + esc(plural(st.replies, 'time')) + '</li>' +
    (st.last ? '<li>Last contact ' + esc(fmtDate(st.last.date)) + ' (' + esc(st.last.kind.toLowerCase()) + ')</li>' : '') +
    (st.longestGap >= 7 ? '<li>Longest wait with no contact: ' + esc(plural(st.longestGap, 'day')) + '</li>' : '') + '</ul>' +
    (fu ? badge(fu) : '') + '</div>';
  h += '<button class="btn primary big" data-act="logsheet" data-id="" data-item="' + it.id + '" data-claim="' + id + '">' + I.plus + 'Add an update</button>';
  h += '<div class="btns"><button class="btn" data-act="faultreport" data-id="' + id + '">' + I.doc + 'Fault report</button><button class="btn" data-act="packsheet" data-id="' + id + '">' + I.doc + 'Claim pack</button></div>';
  h += '<div class="muted">Fault report: the history of the fault on one page or two. Claim pack: the same plus receipts, invoices and photos, ready to send.</div>';
  h += '<button class="btn quiet" data-act="claimphoto" data-id="' + id + '">Add a photo of the fault</button>';
  h += '<section class="section"><h2>Claim details</h2><div class="card pad form"><label class="field"><span>Status</span><select id="claimStatus" data-id="' + id + '">' +
    CLAIM_STATUS.map((s) => opt(s, c.status)).join('') + '</select></label>';
  const kv = [['Opened', fmtDate(c.opened)], ['Ticket', c.ticket], ['Claim with', c.provider], ['Contact', c.contact],
    ['Warranty', w ? (w.type || 'Warranty') + (w.covers ? ' (' + w.covers + ')' : '') + ' · ' + warrantyStatus(w, it).label : ''],
    ['Closed', fmtDate(c.closed)], ['Outcome', c.resolution]].filter((r) => r[1]);
  h += '<div class="kv" style="margin:0 -14px">' + kv.map((r) => '<div>' + esc(r[0]) + '</div><div style="white-space:pre-line">' + esc(r[1]) + '</div>').join('') + '</div>';
  h += '<a class="btn quiet" href="#/claimform/' + it.id + '/' + id + '">Edit claim details</a></div></section>';
  h += '<section class="section"><h2>Timeline</h2>' + (logs.length ? '<div class="timeline">' + logs.map((l) => entryHTML(l, false)).join('') + '</div>' : '<div class="card empty">No entries yet.</div>') + '</section>';
  h += '<button class="btn danger" data-act="delclaim" data-id="' + id + '">Delete claim</button>';
  return h + '</main>' + nav('claims');
}
function viewClaimForm(itemId, cid) {
  const it = liveItem(itemId);
  if (!it) return viewItems();
  const isNew = !cid || cid === 'new';
  const c = isNew ? { opened: todayISO(), status: 'Open', title: '' } : D.claims[cid];
  if (!c) return viewItem(itemId);
  const ws = itemWarranties(itemId);
  const best = isNew ? (ws.map((w) => ({ w, s: warrantyStatus(w, it) })).filter((x) => ['ok', 'soon', 'life'].includes(x.s.kind))[0] || {}).w : null;
  let h = header(isNew ? 'Log a fault' : 'Edit claim', { back: isNew ? '#/item/' + itemId : '#/claim/' + cid, sub: it.name });
  h += '<main><form class="form" data-form="claim" data-item="' + itemId + '" data-id="' + esc(isNew ? '' : cid) + '">';
  const wsel = '<label class="field"><span>Warranty it\'s claimed under</span><select name="warrantyId">' + opt('', isNew ? (best ? best.id : '') : c.warrantyId, 'None or not sure') +
    ws.map((w) => opt(w.id, isNew ? (best ? best.id : '') : c.warrantyId, (w.type || 'Warranty') + (w.covers ? ' (' + w.covers + ')' : '') + ' · ' + warrantyStatus(w, it).label)).join('') + '</select></label>';
  h += '<label class="field req"><span>What\'s wrong?</span><input name="title" required value="' + esc(c.title) + '" placeholder="Not cooling, error E5"></label>';
  if (isNew) {
    h += '<div class="grid2"><label class="field"><span>Date reported</span><input name="opened" type="date" value="' + esc(c.opened || '') + '"></label>' +
      '<label class="field"><span>How did you report it?</span><select name="how">' + CONTACT_KINDS.map((k) => opt(k, 'Phone call')).join('') + opt('Note', '', 'Not reported yet') + '</select></label></div>';
    h += '<input type="hidden" name="status" value="Open">';
  } else {
    h += '<div class="grid2"><label class="field"><span>Date reported</span><input name="opened" type="date" value="' + esc(c.opened || '') + '"></label>' +
      '<label class="field"><span>Status</span><select name="status">' + CLAIM_STATUS.map((s) => opt(s, c.status)).join('') + '</select></label></div>';
  }
  h += '<div class="grid2"><label class="field"><span>Reported to</span><input name="provider" value="' + esc(c.provider || (best && best.provider) || it.store || '') + '" placeholder="Maker or store"></label>' +
    '<label class="field"><span>Ticket or reference</span><input name="ticket" value="' + esc(c.ticket || '') + '"></label></div>';
  h += '<label class="field"><span>Their phone, email or contact person</span><input name="contact" value="' + esc(c.contact || (best && best.contact) || '') + '"></label>';
  h += wsel;
  if (isNew) h += '<label class="field"><span>What happened</span><textarea name="text" placeholder="When it started, what you tried, error codes, what they said"></textarea></label>' +
    '<label class="field"><span>Follow up by (optional)</span><input name="followUp" type="date"></label>';
  else h += '<div class="grid2"><label class="field"><span>Closed</span><input name="closed" type="date" value="' + esc(c.closed || '') + '"></label><span></span></div>' +
    '<label class="field"><span>Outcome</span><textarea name="resolution" placeholder="Repaired, replaced, refunded…">' + esc(c.resolution || '') + '</textarea></label>';
  h += '<button class="btn primary big" type="submit">' + (isNew ? 'Start claim' : 'Save') + '</button></form></main>';
  return h + nav('claims');
}
function logSheet(id, itemId, claimId) {
  const l = id ? D.logs[id] : { date: todayISO(), kind: claimId ? 'Phone call' : 'Note', fileIds: [], direction: claimId ? 'out' : '' };
  if (!l) return;
  const iid = id ? l.itemId : itemId;
  const fs = itemFiles(iid).filter((f) => f.kind !== 'Claim pack');
  let h = sheetHead(id ? 'Edit update' : 'Add an update') + '<form class="form" data-form="log" data-id="' + esc(id || '') + '" data-item="' + esc(iid) + '" data-claim="' + esc(id ? (l.claimId || '') : (claimId || '')) + '">';
  const cl = (id ? l.claimId : claimId) && D.claims[id ? l.claimId : claimId];
  h += '<div class="grid2"><label class="field"><span>Date</span><input name="date" type="date" value="' + esc(l.date || '') + '"></label>' +
    '<label class="field"><span>Type</span><select name="kind">' + LOG_KINDS.map((k) => opt(k, l.kind)).join('') + '</select></label></div>';
  if (!l.first) h += '<label class="field"><span>Who made contact?</span><select name="direction">' + DIRECTIONS.map(([k, t]) => opt(k, id ? (l.direction || '') : (claimId ? 'out' : ''), t)).join('') + '</select></label>';
  h += '<label class="field"><span>What happened</span><textarea name="text" placeholder="What was said or done, any promises made">' + esc(l.text || '') + '</textarea></label>';
  h += '<div class="grid2"><label class="field"><span>Person you dealt with</span><input name="contact" value="' + esc(l.contact || '') + '"></label>' +
    '<label class="field"><span>Ticket or reference</span><input name="ticket" value="' + esc(l.ticket || '') + '"></label></div>';
  if (cl) h += '<label class="field"><span>Follow up by</span><input name="followUp" type="date" value="' + esc(cl.followUp || '') + '"></label><div class="muted">Leave blank if nothing is due. It shows on Home when it\'s close.</div>';
  if (fs.length) h += '<div class="field"><span>Attach files from this item</span></div><div class="pickfiles">' + fs.map((f) =>
    '<label><input type="checkbox" name="file" value="' + f.id + '"' + ((l.fileIds || []).includes(f.id) ? ' checked' : '') + '><img data-thumb="' + f.id + '" alt=""><span>' + esc(f.kind) + '</span></label>').join('') + '</div>';
  h += '<button class="btn primary" type="submit">Save update</button>';
  if (id) h += '<button class="btn danger" type="button" data-act="dellog" data-id="' + id + '">Delete update</button>';
  openSheet(h + '</form>');
}
function itemLogTab(it) {
  const cs = itemClaims(it.id), logs = itemLogs(it.id);
  let h = '<section class="section"><div class="section-head"><h2>Claims</h2></div>' +
    (cs.length ? '<div class="card list">' + cs.map((c) => claimRow(c, false)).join('') + '</div>' : '<div class="card empty">No claims for this item.</div>') + '</section>';
  h += '<div class="btns"><a class="btn primary" href="#/claimform/' + it.id + '/new">Log a fault</a><button class="btn" data-act="logsheet" data-id="" data-item="' + it.id + '" data-claim="">Add a note</button></div>';
  h += '<div class="muted">Log a fault starts a claim with its own timeline. Notes are for anything else about this item.</div>';
  h += '<section class="section"><h2>History</h2>' + (logs.length ? '<div class="timeline">' + logs.map((l) => entryHTML(l, true)).join('') + '</div>' : '<div class="card empty">Nothing logged yet.</div>') + '</section>';
  return h;
}

/* ---------- service jobs ---------- */
function servicesHTML(it) {
  const ss = itemServices(it.id);
  let h = '<section class="section"><div class="section-head"><h2>Service jobs</h2><button class="btn quiet" style="min-height:36px" data-act="svcsheet" data-id="" data-item="' + it.id + '">Add</button></div>';
  if (!ss.length) return h + '<div class="muted">Nothing set up. Add repeating jobs like a filter clean or an annual service.</div></section>';
  h += '<div class="card list">' + ss.map((s) => {
    const st = serviceStatus(s);
    return '<div class="row" style="cursor:default"><button class="grow" style="background:none;border:0;text-align:left;padding:0;cursor:pointer" data-act="svcsheet" data-id="' + s.id + '" data-item="' + it.id + '"><div class="t">' + esc(s.job) + '</div><div class="s">Every ' + esc(s.everyMonths) + ' month' + (+s.everyMonths === 1 ? '' : 's') +
      (s.lastDone ? ' · last done ' + esc(fmtDate(s.lastDone)) : '') + '</div></button>' + badge(st) + '<button class="btn quiet" style="min-height:36px;padding:0 10px" data-act="svcdone" data-id="' + s.id + '">Done</button></div>';
  }).join('') + '</div>';
  return h + '</section>';
}
function svcSheet(id, itemId) {
  const s = id ? D.services[id] : { everyMonths: 12 };
  if (!s) return;
  openSheet(sheetHead(id ? 'Edit service job' : 'Add service job') + '<form class="form" data-form="svc" data-id="' + esc(id || '') + '" data-item="' + esc(itemId) + '">' +
    '<label class="field req"><span>Job</span><input name="job" required value="' + esc(s.job || '') + '" placeholder="Clean air con filters"></label>' +
    '<div class="grid2"><label class="field req"><span>Every (months)</span><input name="everyMonths" type="number" inputmode="numeric" min="1" step="1" required value="' + esc(s.everyMonths || '') + '"></label>' +
    '<label class="field"><span>Last done</span><input name="lastDone" type="date" value="' + esc(s.lastDone || '') + '"></label></div>' +
    '<label class="field"><span>Notes</span><textarea name="notes" placeholder="Who does it, parts, cost">' + esc(s.notes || '') + '</textarea></label>' +
    '<button class="btn primary" type="submit">Save</button>' + (id ? '<button class="btn danger" type="button" data-act="delsvc" data-id="' + id + '">Delete job</button>' : '') + '</form>');
}

/* ---------- Send to Our Tax ---------- */
function ourTaxLink(it) {
  const rec = itemFiles(it.id).find((f) => (f.kind === 'Receipt' || f.kind === 'Tax invoice') && f.path);
  const q = new URLSearchParams({ from: 'ourgear', item: it.id, desc: [it.name, it.brand, it.model].filter(Boolean).join(' '),
    amount: it.price === '' || it.price == null ? '' : String(it.price), date: it.purchaseDate || '', store: it.store || '', receipt: rec ? rec.path : '' });
  return OURTAX_URL + '#/expense?' + q.toString();
}
function ourTaxText(it) {
  return [it.name + (it.brand || it.model ? ' (' + [it.brand, it.model].filter(Boolean).join(' ') + ')' : ''), it.purchaseDate ? 'Bought ' + fmtDate(it.purchaseDate) : '',
    it.store ? 'From ' + it.store : '', it.price !== '' && it.price != null ? 'Price ' + fmtMoney(it.price) : ''].filter(Boolean).join('\n');
}
function ourTaxHTML(it) {
  if (!it.work) return '';
  return '<div class="card pad form"><div class="t" style="font-weight:700">Work deduction</div>' +
    (it.sentToTax ? '<div class="muted">Sent to Our Tax on ' + esc(fmtDate(it.sentToTax)) + '.</div>' : '<div class="muted">Not sent to Our Tax yet.</div>') +
    '<button class="btn' + (it.sentToTax ? ' quiet' : ' primary') + '" data-act="sendtax" data-id="' + it.id + '">' + (it.sentToTax ? 'Send again' : 'Send to Our Tax') + '</button></div>';
}

function viewService() {
  const all = live('services').filter((s) => { const it = liveItem(s.itemId); return it && !it.archived; })
    .map((s) => ({ s, st: serviceStatus(s), it: D.items[s.itemId] })).sort((a, b) => (a.st.days == null ? 9e9 : a.st.days) - (b.st.days == null ? 9e9 : b.st.days));
  let h = header('Service jobs', { back: '#/home', sub: all.length ? plural(servicesDue().length, 'job') + ' due' : '' });
  h += '<main>';
  if (!all.length) h += '<div class="card empty">No service jobs yet. Open an item and use Add under Service jobs, for example "Clean air con filters, every 3 months".</div>';
  else h += '<div class="card list">' + all.map((x) => '<div class="row" style="cursor:default"><a class="grow" href="#/item/' + x.it.id + '" style="text-decoration:none;color:inherit"><div class="t">' + esc(x.s.job) + '</div><div class="s">' +
    esc(x.it.name + ' · every ' + plural(+x.s.everyMonths, 'month') + (x.s.lastDone ? ' · last done ' + fmtDate(x.s.lastDone) : '')) + '</div><div style="margin-top:4px">' + badge(x.st) + '</div></a>' +
    '<button class="btn quiet" style="min-height:40px;padding:0 12px" data-act="svcdone" data-id="' + x.s.id + '">Done</button></div>').join('') + '</div>';
  return h + '</main>' + nav('home');
}
/* ---------- v1.03: claim pack PDF, insurance inventory, CSV ---------- */
async function getPdfLib() { if (typeof PDFLib === 'undefined') await loadScript('pdf-lib.min.js'); return PDFLib; }
/* The built-in PDF fonts only know Western characters: swap or drop anything else. */
function pdfSafe(s) {
  return String(s == null ? '' : s).replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/•/g, '-').replace(/ /g, ' ').replace(/\t/g, '  ')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, '?');
}
class PdfWriter {
  constructor(lib, doc, fonts, opts) {
    this.lib = lib; this.doc = doc; this.f = fonts; this.o = Object.assign({ w: 595.28, h: 841.89, m: 46 }, opts || {});
    this.newPage();
  }
  newPage() { this.page = this.doc.addPage([this.o.w, this.o.h]); this.y = this.o.h - this.o.m; return this.page; }
  ensure(h) { if (this.y - h < this.o.m + 14) this.newPage(); }
  wrap(text, size, font, width) {
    const out = [];
    pdfSafe(text).split('\n').forEach((para) => {
      let line = '';
      para.split(/(\s+)/).forEach((word) => {
        const t = line + word;
        if (font.widthOfTextAtSize(t.trimEnd(), size) <= width || !line.trim()) {
          if (font.widthOfTextAtSize(t.trimEnd(), size) > width) { // a single long word: break it
            let chunk = '';
            for (const ch of t) { if (font.widthOfTextAtSize(chunk + ch, size) > width) { out.push(chunk); chunk = ch; } else chunk += ch; }
            line = chunk;
          } else line = t;
        } else { out.push(line.trimEnd()); line = word.trimStart(); }
      });
      out.push(line.trimEnd());
    });
    return out;
  }
  text(str, o) {
    const p = Object.assign({ size: 10, bold: false, x: this.o.m, width: this.o.w - 2 * this.o.m, color: [0.07, 0.09, 0.15], gap: 1.35 }, o || {});
    const font = p.bold ? this.f.bold : this.f.reg;
    this.wrap(str, p.size, font, p.width).forEach((ln) => {
      this.ensure(p.size * p.gap);
      this.page.drawText(ln, { x: p.x, y: this.y - p.size, size: p.size, font, color: this.lib.rgb(p.color[0], p.color[1], p.color[2]) });
      this.y -= p.size * p.gap;
    });
  }
  rule() { this.page.drawLine({ start: { x: this.o.m, y: this.y }, end: { x: this.o.w - this.o.m, y: this.y }, thickness: 0.6, color: this.lib.rgb(0.85, 0.86, 0.89) }); this.y -= 8; }
  heading(str) { this.ensure(48); this.y -= 10; this.text(str, { size: 13, bold: true }); this.y -= 2; this.rule(); }
  kv(rows) {
    rows.filter((r) => r[1] !== '' && r[1] != null).forEach(([k, v]) => {
      const lines = this.wrap(v, 10, this.f.reg, this.o.w - 2 * this.o.m - 150);
      this.ensure(13.5 * Math.min(lines.length, 3));
      const y0 = this.y;
      this.page.drawText(pdfSafe(k), { x: this.o.m, y: this.y - 10, size: 9.5, font: this.f.reg, color: this.lib.rgb(0.42, 0.45, 0.5) });
      this.text(v, { x: this.o.m + 150, width: this.o.w - 2 * this.o.m - 150 });
      if (this.y === y0) this.y -= 13.5;
      this.y -= 2;
    });
  }
  footer(title) {
    const pages = this.doc.getPages(), n = pages.length;
    pages.forEach((pg, i) => {
      const { width } = pg.getSize();
      pg.drawText(pdfSafe(title + ' · page ' + (i + 1) + ' of ' + n), { x: 30, y: 16, size: 7.5, font: this.f.reg, color: this.lib.rgb(0.45, 0.47, 0.52) });
      pg.drawText(pdfSafe('Made with Our Gear ' + fmtDate(todayISO())), { x: width - 30 - this.f.reg.widthOfTextAtSize('Made with Our Gear ' + fmtDate(todayISO()), 7.5), y: 16, size: 7.5, font: this.f.reg, color: this.lib.rgb(0.45, 0.47, 0.52) });
    });
  }
}
async function newPdf(opts) {
  const lib = await getPdfLib();
  const doc = await lib.PDFDocument.create();
  const fonts = { reg: await doc.embedFont(lib.StandardFonts.Helvetica), bold: await doc.embedFont(lib.StandardFonts.HelveticaBold) };
  return new PdfWriter(lib, doc, fonts, opts);
}
function fileCaption(f) { return [f.kind, fmtDate(f.date), f.store, f.total !== '' && f.total != null ? fmtMoney(f.total) : ''].filter(Boolean).join(' · '); }
/* Add a document to the pack: photos get their own page, PDFs keep their original pages. */
async function addDocument(W, f, n) {
  const lib = W.lib, cap = 'Attachment ' + n + ': ' + fileCaption(f);
  const blob = await getFileBlob(f);
  if (isPdfFile(f)) {
    try {
      const src = await lib.PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
      const pages = await W.doc.copyPages(src, src.getPageIndices());
      pages.forEach((p, i) => {
        W.doc.addPage(p);
        const { width, height } = p.getSize();
        const t = pdfSafe(cap + (pages.length > 1 ? ' (page ' + (i + 1) + ' of ' + pages.length + ')' : ''));
        p.drawRectangle({ x: 0, y: height - 16, width, height: 16, color: lib.rgb(1, 1, 1), opacity: 0.85 });
        p.drawText(t, { x: 8, y: height - 11, size: 7.5, font: W.f.reg, color: lib.rgb(0.3, 0.32, 0.38) });
      });
      return;
    } catch (e) { /* protected or unusual PDF: fall back to pictures of its pages */ }
    const pdf = await openPdf(blob);
    try {
      for (let i = 1; i <= Math.min(pdf.numPages, 15); i++) {
        const jpg = await canvasBlob(await renderPdfPage(pdf, i, 1400), 0.82);
        await addImagePage(W, jpg, cap + (pdf.numPages > 1 ? ' (page ' + i + ')' : ''));
      }
    } finally { closePdf(pdf); }
    return;
  }
  if (/^image\//.test(f.mime)) { await addImagePage(W, blob, cap); return; }
  throw new Error('can\'t add ' + (f.origName || 'this file type') + ' to a PDF');
}
async function addImagePage(W, blob, cap) {
  let bytes = new Uint8Array(await blob.arrayBuffer());
  if (blob.type !== 'image/jpeg') { const c = await loadSource(blob); bytes = new Uint8Array(await (await canvasBlob(c, 0.85)).arrayBuffer()); }
  const img = await W.doc.embedJpg(bytes);
  const pg = W.newPage();
  W.text(cap, { size: 10, bold: true });
  const maxW = W.o.w - 2 * W.o.m, maxH = W.y - W.o.m - 20;
  const s = Math.min(maxW / img.width, maxH / img.height, 1.5);
  pg.drawImage(img, { x: (W.o.w - img.width * s) / 2, y: W.y - 8 - img.height * s, width: img.width * s, height: img.height * s });
  W.y = W.o.m; // page is full
}

/* ---------- claim pack ---------- */
function packFiles(c) {
  const fromLogs = new Set();
  claimLogs(c.id).forEach((l) => (l.fileIds || []).forEach((id) => fromLogs.add(id)));
  return itemFiles(c.itemId).filter((f) => f.kind !== 'Claim pack').map((f) => ({ f,
    on: fromLogs.has(f.id) || f.claimId === c.id || ['Receipt', 'Tax invoice', 'Warranty card', 'Certificate'].includes(f.kind) }));
}
function packSheet(claimId) {
  const c = D.claims[claimId], it = D.items[c.itemId], fs = packFiles(c);
  let h = sheetHead('Claim pack') + '<div class="muted">One PDF with the item, its warranties, this claim\'s timeline, and the documents ticked below.</div>';
  h += '<form class="form" data-form="pack" data-id="' + claimId + '">';
  h += fs.length ? '<div class="pickfiles">' + fs.map(({ f, on }) => '<label><input type="checkbox" name="file" value="' + f.id + '"' + (on ? ' checked' : '') + '><img data-thumb="' + f.id + '" alt=""><span>' + esc(fileCaption(f)) + '</span></label>').join('') + '</div>'
    : '<div class="warn">This item has no files. Add the receipt to ' + esc(it.name) + ' first if you can: a claim usually needs proof of purchase.</div>';
  h += '<label class="check"><input type="checkbox" name="keep" checked> Save a copy to the item\'s files</label>';
  h += '<button class="btn primary big" type="submit">Make claim pack</button><div class="muted" id="packmsg"></div></form>';
  openSheet(h);
}
async function buildClaimPack(c, fileIds) {
  const it = D.items[c.itemId], p = propById(it.propertyId);
  const W = await newPdf();
  W.text('Warranty claim', { size: 20, bold: true, color: [0.31, 0.27, 0.9] });
  W.text(it.name, { size: 15, bold: true });
  W.text(c.title, { size: 11, color: [0.42, 0.45, 0.5] });
  W.y -= 6;
  W.heading('Item');
  W.kv([['Item', it.name], ['Belongs to', it.owner], ['Brand', it.brand], ['Model', it.model], ['Serial number', it.serial], ['Category', it.category],
    ['Location', [p ? p.name + (p.address ? ', ' + p.address : '') : '', it.location, it.spot].filter(Boolean).join(' · ')],
    ['Bought from', it.store], ['Purchase date', fmtDate(it.purchaseDate)], ['Install date', fmtDate(it.installDate)], ['Price paid', fmtMoney(it.price)]]);
  const ws = itemWarranties(it.id);
  if (ws.length) {
    W.heading('Warranties');
    ws.forEach((w) => {
      const s = warrantyStatus(w, it);
      W.kv([[w.type + ' warranty' + (w.covers ? ' (' + w.covers + ')' : ''), w.termUnit === 'lifetime' ? 'Lifetime' : (w.termValue ? w.termValue + ' ' + w.termUnit : '') + (s.expiry ? ', ends ' + fmtDate(s.expiry) : '') + ' · ' + s.label],
        ['Provider', [w.provider, w.contact].filter(Boolean).join(' · ')], ['Conditions', w.conditions]]);
      W.y -= 4;
    });
  }
  W.heading('Claim');
  W.kv([['Fault', c.title], ['Status', c.status], ['Opened', fmtDate(c.opened)], ['Ticket or reference', c.ticket], ['Claim with', c.provider], ['Contact', c.contact],
    ['Closed', fmtDate(c.closed)], ['Outcome', c.resolution]]);
  const logs = claimLogs(c.id).slice().reverse();
  if (logs.length) {
    W.heading('Timeline');
    logs.forEach((l) => {
      W.ensure(40);
      W.text(fmtDate(l.date) + ' · ' + l.kind + (l.ticket ? ' · Ticket ' + l.ticket : '') + (l.contact ? ' · ' + l.contact : ''), { bold: true });
      if (l.text) W.text(l.text, { x: W.o.m + 10, width: W.o.w - 2 * W.o.m - 10 });
      W.y -= 6;
    });
  }
  const files = fileIds.map((id) => D.files[id]).filter(Boolean);
  if (files.length) {
    W.heading('Attached documents');
    files.forEach((f, i) => W.text((i + 1) + '. ' + fileCaption(f)));
  }
  const missed = [];
  for (let i = 0; i < files.length; i++) {
    const msg = $('#packmsg'); if (msg) msg.textContent = 'Adding document ' + (i + 1) + ' of ' + files.length + '…';
    try { await addDocument(W, files[i], i + 1); } catch (e) { missed.push(fileCaption(files[i]) + ' (' + e.message + ')'); }
  }
  if (missed.length) { W.newPage(); W.heading('Not included'); missed.forEach((m) => W.text(m)); }
  W.footer('Claim pack: ' + it.name);
  return { bytes: await W.doc.save(), missed };
}

/* ---------- insurance inventory ---------- */
let REP = { prop: 'all', arch: false };
function inventoryRows() {
  return live('items').filter((i) => (REP.arch || !i.archived) && (REP.prop === 'all' || i.propertyId === REP.prop) && (i.status || 'Active') === 'Active')
    .sort((a, b) => propName(a.propertyId).localeCompare(propName(b.propertyId)) || (a.location || '~').localeCompare(b.location || '~') || a.name.localeCompare(b.name));
}
function num(v) { return v === '' || v == null || isNaN(+v) ? 0 : +v; }
function viewReports() {
  const rows = inventoryRows(), props = D.lists.properties;
  const by = groupBy(rows, 'propertyId');
  let h = header('Insurance inventory', { back: '#/settings', sub: rows.length + ' items' });
  h += '<main><div class="card pad form"><label class="field"><span>Property</span><select id="repProp">' + opt('all', REP.prop, 'All properties') +
    props.map((p) => opt(p.id, REP.prop, p.name)).join('') + '</select></label>' +
    '<label class="check"><input type="checkbox" id="repArch"' + (REP.arch ? ' checked' : '') + '> Include archived items</label>' +
    '<div class="muted">Sold, disposed and replaced items are left out.</div></div>';
  h += '<div class="card list">' + Object.keys(by).map((pid) => {
    const r = by[pid], noVal = r.filter((i) => !num(i.replacementValue) && !num(i.price)).length;
    return '<div class="row" style="cursor:default"><div class="grow"><div class="t">' + esc(propName(pid)) + '</div><div class="s">' + r.length + ' items' +
      (noVal ? ' · ' + noVal + ' with no value' : '') + '</div></div><div style="text-align:right"><div class="t">' + esc(fmtMoney(r.reduce((s, i) => s + (num(i.replacementValue) || num(i.price)), 0))) + '</div><div class="s">replacement</div></div></div>';
  }).join('') + (rows.length ? '' : '<div class="empty">No items to list.</div>') + '</div>';
  h += '<div class="muted">Totals use the replacement value, or the price paid where no replacement value is set.</div>';
  h += '<div class="btns"><button class="btn primary" data-act="invpdf"' + (rows.length ? '' : ' disabled') + '>Make PDF</button><button class="btn" data-act="invcsv"' + (rows.length ? '' : ' disabled') + '>Make spreadsheet (CSV)</button></div>';
  h += '<button class="btn quiet" data-act="allcsv">All items and warranties (CSV)</button>';
  return h + '</main>' + nav('settings');
}
async function buildInventoryPdf() {
  const rows = inventoryRows(), by = groupBy(rows, 'propertyId');
  const W = await newPdf({ w: 841.89, h: 595.28, m: 34 });
  const lib = W.lib, cols = [{ k: 'Item', w: 230 }, { k: 'Location', w: 120 }, { k: 'Serial', w: 120 }, { k: 'Purchased', w: 80 }, { k: 'Price paid', w: 80, r: 1 }, { k: 'Replacement', w: 90, r: 1 }];
  const tableW = cols.reduce((s, c) => s + c.w, 0);
  W.text('Contents inventory', { size: 20, bold: true, color: [0.31, 0.27, 0.9] });
  W.text('As at ' + fmtDate(todayISO()) + ' · ' + rows.length + ' items' + (REP.prop === 'all' ? '' : ' · ' + propName(REP.prop)), { size: 10, color: [0.42, 0.45, 0.5] });
  let grand = 0;
  const head = () => {
    W.ensure(30);
    let x = W.o.m;
    W.page.drawRectangle({ x: W.o.m, y: W.y - 16, width: tableW, height: 16, color: lib.rgb(0.95, 0.96, 0.97) });
    cols.forEach((c) => { const t = c.k; W.page.drawText(t, { x: c.r ? x + c.w - 6 - W.f.bold.widthOfTextAtSize(t, 8.5) : x + 4, y: W.y - 11.5, size: 8.5, font: W.f.bold, color: lib.rgb(0.25, 0.27, 0.32) }); x += c.w; });
    W.y -= 20;
  };
  Object.keys(by).forEach((pid) => {
    const p = propById(pid), r = by[pid];
    W.ensure(70); W.y -= 8;
    W.text((p ? p.name : 'No property') + (p ? ' (' + p.type + ')' : '') + (p && p.address ? ' · ' + p.address : ''), { size: 12.5, bold: true });
    W.y -= 2; head();
    let sub = 0;
    r.forEach((i) => {
      const nameLines = W.wrap(i.name, 9.5, W.f.bold, cols[0].w - 8).concat(i.brand || i.model ? W.wrap([i.brand, i.model].filter(Boolean).join(' '), 8.5, W.f.reg, cols[0].w - 8) : []);
      const locLines = W.wrap([i.location, i.spot].filter(Boolean).join(', '), 8.5, W.f.reg, cols[1].w - 8);
      const serLines = W.wrap(i.serial || '', 8.5, W.f.reg, cols[2].w - 8);
      const hgt = Math.max(nameLines.length, locLines.length, serLines.length, 1) * 11 + 6;
      if (W.y - hgt < W.o.m + 14) { W.newPage(); head(); }
      const top = W.y; let x = W.o.m;
      const cell = (lines, col, size, font) => { lines.forEach((ln, n) => W.page.drawText(ln, { x: x + 4, y: top - 10 - n * 11, size, font, color: lib.rgb(0.07, 0.09, 0.15) })); };
      nameLines.forEach((ln, n) => W.page.drawText(ln, { x: x + 4, y: top - 10 - n * 11, size: n === 0 ? 9.5 : 8.5, font: n === 0 ? W.f.bold : W.f.reg, color: lib.rgb(0.07, 0.09, 0.15) }));
      x += cols[0].w; cell(locLines, 1, 8.5, W.f.reg); x += cols[1].w; cell(serLines, 2, 8.5, W.f.reg); x += cols[2].w;
      cell([pdfSafe(fmtDate(i.purchaseDate))], 3, 8.5, W.f.reg); x += cols[3].w;
      [[i.price, cols[4]], [i.replacementValue, cols[5]]].forEach(([v, c]) => {
        const t = num(v) ? pdfSafe(fmtMoney(v)) : '';
        if (t) W.page.drawText(t, { x: x + c.w - 6 - W.f.reg.widthOfTextAtSize(t, 8.5), y: top - 10, size: 8.5, font: W.f.reg, color: lib.rgb(0.07, 0.09, 0.15) });
        x += c.w;
      });
      W.y -= hgt;
      W.page.drawLine({ start: { x: W.o.m, y: W.y + 2 }, end: { x: W.o.m + tableW, y: W.y + 2 }, thickness: 0.4, color: lib.rgb(0.88, 0.89, 0.91) });
      sub += num(i.replacementValue) || num(i.price);
    });
    grand += sub;
    W.ensure(20);
    const t = 'Subtotal ' + pdfSafe(fmtMoney(sub));
    W.page.drawText(t, { x: W.o.m + tableW - 6 - W.f.bold.widthOfTextAtSize(t, 9.5), y: W.y - 12, size: 9.5, font: W.f.bold, color: lib.rgb(0.07, 0.09, 0.15) });
    W.y -= 22;
  });
  W.ensure(30);
  const g = 'Total replacement value ' + pdfSafe(fmtMoney(grand));
  W.page.drawText(g, { x: W.o.m + tableW - 6 - W.f.bold.widthOfTextAtSize(g, 11.5), y: W.y - 14, size: 11.5, font: W.f.bold, color: lib.rgb(0.07, 0.09, 0.15) });
  W.y -= 24;
  W.text('Replacement value is used where set; otherwise the price paid. Receipts and photos for each item are kept in Our Gear and Dropbox.', { size: 8.5, color: [0.42, 0.45, 0.5] });
  W.footer('Contents inventory');
  return W.doc.save();
}
function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(rows) { return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'); }
function inventoryCsv() {
  return toCsv([['Property', 'Property type', 'Address', 'Location', 'Exact spot', 'Item', 'Belongs to', 'Category', 'Brand', 'Model', 'Serial', 'Store', 'Purchase date', 'Price paid', 'Replacement value']]
    .concat(inventoryRows().map((i) => { const p = propById(i.propertyId) || {}; return [p.name, p.type, p.address, i.location, i.spot, i.name, i.owner, i.category, i.brand, i.model, i.serial, i.store, i.purchaseDate, i.price, i.replacementValue]; })));
}
function allCsv() {
  const head = ['Item', 'Belongs to', 'Status', 'Archived', 'Property', 'Location', 'Category', 'Brand', 'Model', 'Serial', 'Store', 'Purchase date', 'Install date', 'Price paid', 'Replacement value', 'Work deduction', 'Warranty type', 'Covers', 'Term', 'Expiry', 'Warranty status', 'Provider'];
  const out = [head];
  live('items').sort((a, b) => a.name.localeCompare(b.name)).forEach((i) => {
    const base = [i.name, i.owner, i.status || 'Active', i.archived ? 'Yes' : '', propName(i.propertyId), i.location, i.category, i.brand, i.model, i.serial, i.store, i.purchaseDate, i.installDate, i.price, i.replacementValue, i.work ? 'Yes' : ''];
    const ws = itemWarranties(i.id);
    if (!ws.length) out.push(base.concat(['', '', '', '', '', '']));
    ws.forEach((w) => { const s = warrantyStatus(w, i); out.push(base.concat([w.type, w.covers, w.termUnit === 'lifetime' ? 'Lifetime' : (w.termValue ? w.termValue + ' ' + w.termUnit : ''), s.expiry || '', s.label, w.provider])); });
  });
  return toCsv(out);
}
/* Sharing needs a fresh tap, so finished files are offered on a sheet. */
let READY = null;
function readySheet(blob, name, title, note) {
  READY = { blob, name, title };
  openSheet(sheetHead(title) + (note ? '<div class="muted">' + esc(note) + '</div>' : '') +
    '<div class="btns"><button class="btn primary" data-act="readyshare">Share or email</button><button class="btn" data-act="readysave">Save to phone</button></div>' +
    '<button class="btn quiet" data-act="readyview">Open</button>');
}
async function shareReady() {
  const file = new File([READY.blob], READY.name, { type: READY.blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: READY.title }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  saveReady();
}
function saveReady() {
  const a = document.createElement('a'); a.href = URL.createObjectURL(READY.blob); a.download = READY.name;
  document.body.appendChild(a); a.click(); a.remove(); toast('Saved to Downloads');
}

/* ---------- v1.04: fault report (the history of a fault, for complaints and escalations) ---------- */
async function buildFaultReport(c) {
  const it = D.items[c.itemId], p = propById(it.propertyId), st = claimStats(c), lib = (await getPdfLib());
  const W = await newPdf();
  const grey = [0.42, 0.45, 0.5];
  W.text('Fault report', { size: 20, bold: true, color: [0.31, 0.27, 0.9] });
  W.text(c.title, { size: 14, bold: true });
  W.text(it.name + (it.brand || it.model ? ' · ' + [it.brand, it.model].filter(Boolean).join(' ') : '') + ' · Status: ' + c.status, { size: 10.5, color: grey });
  W.y -= 6;
  W.heading('Summary');
  const w = c.warrantyId && D.warranties[c.warrantyId] && !D.warranties[c.warrantyId].deleted ? D.warranties[c.warrantyId] : null;
  let wtxt = '';
  if (w) {
    const ex = warrantyExpiry(w, it);
    wtxt = (w.type || 'Warranty') + (w.covers ? ' (' + w.covers + ')' : '') + (w.termUnit === 'lifetime' ? ', lifetime' : ex ? ', ends ' + fmtDate(ex) : '') +
      (ex && st.reported ? (daysBetween(st.reported, ex) >= 0 ? ' - in warranty when reported' : ' - had ended when reported') : w.termUnit === 'lifetime' ? ' - in warranty when reported' : '');
  }
  W.kv([['Fault first reported', fmtDate(st.reported) + (st.how ? ' by ' + st.how.toLowerCase() : '') + (c.provider ? ' to ' + c.provider : '')],
    ['Ticket or reference', c.ticket], ['Their contact', c.contact],
    [isOpenClaim(c) ? 'Open for' : 'Took', plural(st.days || 0, 'day') + (isOpenClaim(c) ? ' (as at ' + fmtDate(todayISO()) + ')' : ' (closed ' + fmtDate(c.closed) + ')')],
    ['Follow-ups by you', String(st.followUps)], ['Contact from them', String(st.replies)],
    ['Last contact', st.last ? fmtDate(st.last.date) + ' (' + st.last.kind.toLowerCase() + (st.last.direction === 'in' ? ', from them' : ', by you') + ')' : ''],
    ['Longest wait with no contact', st.longestGap >= 1 ? plural(st.longestGap, 'day') : ''],
    ['Next follow-up due', isOpenClaim(c) && c.followUp ? fmtDate(c.followUp) : ''],
    ['Outcome', c.resolution]]);
  W.heading('Item');
  W.kv([['Item', it.name], ['Belongs to', it.owner], ['Brand and model', [it.brand, it.model].filter(Boolean).join(' ')], ['Serial number', it.serial],
    ['Location', [p ? p.name + (p.address ? ', ' + p.address : '') : '', it.location, it.spot].filter(Boolean).join(' · ')],
    ['Bought', [fmtDate(it.purchaseDate), it.store, fmtMoney(it.price)].filter(Boolean).join(' · ')], ['Warranty', wtxt]]);
  W.heading('What happened, in order');
  const cols = [{ k: 'Date', w: 66 }, { k: 'Day', w: 34 }, { k: 'How', w: 74 }, { k: 'Who', w: 96 }, { k: 'Details', w: W.o.w - 2 * W.o.m - 270 }];
  const head = () => {
    W.ensure(26);
    let x = W.o.m;
    W.page.drawRectangle({ x: W.o.m, y: W.y - 16, width: W.o.w - 2 * W.o.m, height: 16, color: lib.rgb(0.95, 0.96, 0.97) });
    cols.forEach((col) => { W.page.drawText(col.k, { x: x + 4, y: W.y - 11.5, size: 8.5, font: W.f.bold, color: lib.rgb(0.25, 0.27, 0.32) }); x += col.w; });
    W.y -= 20;
  };
  head();
  const who = c.provider || 'Them';
  st.logs.forEach((l, i) => {
    if (i > 0) {
      const gap = daysBetween(st.logs[i - 1].date, l.date);
      if (gap >= 7) { W.ensure(16); W.text(plural(gap, 'day') + ' with no contact', { size: 8.5, color: [0.63, 0.16, 0.16], x: W.o.m + 104 }); W.y -= 2; }
    }
    const day = daysBetween(st.reported, l.date);
    const whoTxt = l.first ? 'You reported it' : l.direction === 'in' ? who + ' contacted you' : l.direction === 'out' ? 'You contacted ' + who : 'Note';
    const detail = [l.text, l.ticket ? 'Ticket ' + l.ticket : '', l.contact ? 'Spoke with ' + l.contact : '', (l.fileIds || []).length ? plural(l.fileIds.length, 'file') + ' attached' : ''].filter(Boolean).join('\n');
    const cells = [[fmtDate(l.date)], [day == null ? '' : 'Day ' + (day + 1)], W.wrap(l.kind, 8.5, W.f.reg, cols[2].w - 8), W.wrap(whoTxt, 8.5, W.f.reg, cols[3].w - 8), W.wrap(detail, 8.5, W.f.reg, cols[4].w - 8)];
    const hgt = Math.max.apply(null, cells.map((x) => x.length)) * 11 + 6;
    if (W.y - hgt < W.o.m + 14) { W.newPage(); head(); }
    let x = W.o.m; const top = W.y;
    cells.forEach((lines, n) => {
      lines.forEach((ln, k) => W.page.drawText(pdfSafe(ln), { x: x + 4, y: top - 10 - k * 11, size: 8.5, font: n === 0 || (n === 3 && l.first) ? W.f.bold : W.f.reg, color: lib.rgb(0.07, 0.09, 0.15) }));
      x += cols[n].w;
    });
    W.y -= hgt;
    W.page.drawLine({ start: { x: W.o.m, y: W.y + 2 }, end: { x: W.o.w - W.o.m, y: W.y + 2 }, thickness: 0.4, color: lib.rgb(0.88, 0.89, 0.91) });
  });
  if (isOpenClaim(c) && st.logs.length) {
    const since = daysBetween(st.logs[st.logs.length - 1].date, todayISO());
    if (since >= 1) { W.y -= 4; W.text('No contact for ' + plural(since, 'day') + ' since the last entry (as at ' + fmtDate(todayISO()) + ').', { size: 9, color: [0.63, 0.16, 0.16] }); }
  }
  const docs = itemFiles(it.id).filter((f) => f.kind !== 'Claim pack');
  if (docs.length) { W.heading('Documents on file'); docs.forEach((f) => W.text('- ' + fileCaption(f), { size: 9.5 })); W.y -= 2; W.text('Copies are available on request, or in the claim pack.', { size: 8.5, color: grey }); }
  W.footer('Fault report: ' + it.name);
  return W.doc.save();
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
    case 'import': html = viewImport(); break;
    case 'claims': html = viewClaims(); break;
    case 'claim': html = viewClaim(parts[1]); break;
    case 'claimform': html = viewClaimForm(parts[1], parts[2]); break;
    case 'reports': html = viewReports(); break;
    case 'service': html = viewService(); break;
    default: html = viewHome();
  }
  app.innerHTML = html;
  if (parts[0] === 'snap' && SNAP && SNAP.step === 'crop') { drawCropView(); bindCropDrag(); }
  if (parts[0] === 'snap' && SNAP && SNAP.step === 'details' && SNAP.result) { const im = $('#snapprev'); if (im) im.src = URL.createObjectURL(SNAP.result.full); }
  if (parts[0] === 'snap' && SNAP && SNAP.step === 'details' && SNAP.isPdf) snapPdfDetails();
  if (parts[0] === 'items') { const l = $('#itemlist'); if (l) l.innerHTML = itemsListHTML(); }
  if (parts[0] === 'warranty') warrantyPreview();
  if (parts[0] === 'settings') storageInfo();
  hydrateThumbs();
}
let lastRoute = '';
let CLAIM_TARGET = null;
window.addEventListener('hashchange', () => {
  const r = location.hash.split('/')[1] || '';
  if (r !== 'item' && r !== 'warranty' && r !== 'claim' && r !== 'claimform') ITEM_TAB = 'details';
  if (r !== 'snap') { SNAP = null; }
  if (r !== 'snap') { SNAP_TARGET = null; CLAIM_TARGET = null; SNAP_TYPE = 'receipt'; }
  if (r !== 'new') { /* keep prefill only for the new-item screen */ if (lastRoute === 'new') NEW_ITEM_PREFILL = null; }
  lastRoute = r;
  closeSheet(); closeViewer(); render(); window.scrollTo(0, 0);
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
    for (const f of itemFiles(it.id)) if (f.uploaded) await dropThumb(f.id);
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
    for (const it of items) { it.archived = true; it.archivedAt = Date.now(); touch(it); for (const f of itemFiles(it.id)) if (f.uploaded) await dropThumb(f.id); }
    await saveData(); toast(items.length + ' archived'); go('#/home');
  },
  async delitem(el) {
    const it = D.items[el.dataset.id];
    const nf = itemFiles(it.id).length;
    if (!confirm('Delete "' + it.name + '"' + (nf ? ' and its ' + nf + ' file' + (nf > 1 ? 's' : '') : '') + '? This can\'t be undone.')) return;
    it.deleted = true; touch(it);
    itemWarranties(it.id).forEach((w) => { w.deleted = true; touch(w); });
    for (const f of itemFiles(it.id)) { f.deleted = true; touch(f); await dropThumb(f.id); }
    ['claims', 'logs', 'services'].forEach((c) => live(c).filter((r) => r.itemId === it.id).forEach((r) => { r.deleted = true; touch(r); }));
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
    const f = D.files[el.dataset.file];
    groupFiles(f).forEach((g) => { g.itemId = el.dataset.id; touch(g); });
    f.itemId = el.dataset.id; touch(f);
    await saveData(); closeSheet(); ITEM_TAB = 'files'; go('#/item/' + f.itemId); toast('Filed');
  },
  async unfile(el) { const f = D.files[el.dataset.id]; f.itemId = null; touch(f); await saveData(); closeSheet(); render(); toast('Moved to inbox'); },
  newfromfile(el) {
    const f = D.files[el.dataset.id];
    const grp = f.itemId ? [f] : groupFiles(f);
    NEW_ITEM_PREFILL = { name: (f.title || '').slice(0, 80), notes: f.note || '', store: f.store || '', purchaseDate: f.date || '', price: f.total === undefined ? '' : f.total,
      _fileIds: grp.map((x) => x.id), _lifetime: grp.some((x) => x.lifetime) };
    closeSheet(); go('#/new');
  },
  async delfile(el) {
    if (!confirm('Delete this file? It is removed from Dropbox too.')) return;
    const f = D.files[el.dataset.id]; f.deleted = true; touch(f); await dropThumb(f.id);
    await saveData(); closeSheet(); render(); toast('File deleted');
  },
  snapcancel() { const t = SNAP_TARGET, back = SNAP && SNAP.editFileId ? SNAP.back : null; SNAP = null; SNAP_TARGET = null; go(back || (t ? '#/item/' + t : '#/home')); },
  rot() { SNAP.quarter = (SNAP.quarter + 1) % 4; rebuildWork(); drawCropView(); },
  cropall() { SNAP.crop = { x: 0, y: 0, w: SNAP.work.width, h: SNAP.work.height }; placeCropRect(); },
  docmode(el) { SNAP.docMode = !SNAP.docMode; el.setAttribute('aria-pressed', SNAP.docMode); el.textContent = SNAP.docMode ? 'Black and white' : 'Colour'; },
  async editpic(el) {
    const f = D.files[el.dataset.id];
    el.disabled = true; el.textContent = 'Opening picture…';
    try {
      const blob = await getFileBlob(f);
      const src = await loadSource(blob);
      const back = location.hash;
      closeSheet();
      SNAP = { step: 'crop', file: { name: f.origName || 'picture.jpg', type: 'image/jpeg' }, isPdf: false, quarter: 0, deg: 0, docMode: false, fullCrop: true,
        itemId: f.itemId || null, kind: f.kind, src, editFileId: f.id, back };
      rebuildWork();
      if (location.hash === '#/snap') render(); else location.hash = '#/snap';
    } catch (e) { toast('Could not open the picture: ' + e.message.slice(0, 80)); el.disabled = false; el.textContent = 'Edit picture (crop, rotate, black and white)'; }
  },
  async editsave(el) {
    el.disabled = true; el.textContent = 'Saving…';
    const f = D.files[SNAP.editFileId], back = SNAP.back || (f.itemId ? '#/item/' + f.itemId : '#/inbox');
    const r = await finishImage(SNAP.work, SNAP.crop, SNAP.docMode);
    await idb.put('blobs', f.id, r.full);
    await dropThumb(f.id); await idb.put('thumbs', f.id, r.thumb);
    if (f.uploaded) f.replace = true;
    f.uploaded = false; f.size = r.full.size; f.imgRev = Date.now();
    setThumbRev(f.id, f.imgRev);
    touch(f); await saveData();
    SNAP = null;
    if (f.itemId) ITEM_TAB = 'files';
    go(back.indexOf('#/snap') === 0 ? '#/home' : back); toast('Picture updated');
  },
  snaptype(el) { SNAP_TYPE = el.dataset.v; render(); },
  async photosave(el) {
    document.querySelectorAll('[data-act="photosave"]').forEach((b) => { b.disabled = true; });
    el.textContent = 'Saving…';
    SNAP.result = await finishImage(SNAP.work, SNAP.crop, SNAP.docMode);
    await saveSnapFile(el.dataset.v);
  },
  async cropnext(el) {
    el.disabled = true; el.textContent = 'Working…';
    SNAP.result = await finishImage(SNAP.work, SNAP.crop, SNAP.docMode);
    SNAP.step = 'details'; SNAP.ocrMsg = ''; render();
    if (S.autoRead && kindGroup(SNAP.kind) === 'receipt') {
      const mine = SNAP;
      readReceipt(SNAP.result.full).then((r) => {
        if (SNAP !== mine) return;
        const n = fillEmpty(document.querySelector('form[data-form="snap"]'), r);
        mine.ocrMsg = n ? 'Filled ' + n + ' detail' + (n > 1 ? 's' : '') + ' from the receipt. Check them before saving.' : 'Couldn\'t read the details. Type them in.';
        const m = $('#ocrmsg'); if (m) m.textContent = mine.ocrMsg;
      }).catch(() => { mine.ocrMsg = 'Receipt reading isn\'t available right now. Type the details in.'; const m = $('#ocrmsg'); if (m) m.textContent = mine.ocrMsg; });
    }
  },
  async readfile(el) {
    const f = D.files[el.dataset.id];
    el.disabled = true; el.textContent = 'Reading…';
    try {
      let blob = await idb.get('blobs', f.id);
      if (!blob && f.uploaded) { const r = await DBX.download(f.path); blob = r && r.blob; }
      if (!blob) throw new Error('file not available offline');
      const r = isPdfFile(f) ? await readPdf(blob) : await readReceipt(blob);
      const n = fillEmpty(document.querySelector('form[data-form="file"]'), r);
      toast(n ? 'Filled ' + n + ' detail' + (n > 1 ? 's' : '') + '. Check, then Save changes.' : 'Couldn\'t read the details');
    } catch (e) { toast('Could not read: ' + e.message.slice(0, 80)); }
    el.disabled = false; el.textContent = 'Read receipt';
  },
  autoread(el) { S.autoRead = el.checked; saveSettings(); },
  imppile(el) { IMP_PILE = el.dataset.v; render(); },
  async impocr(el) {
    const d = IMP.drafts[el.dataset.id], img = d.files.find((x) => x.thumb);
    el.disabled = true; el.textContent = 'Reading…';
    try {
      const r = await readReceipt(await idb.get('blobs', img.id));
      const form = document.querySelector('form[data-form="draft"]');
      [['store', r.store], ['date', r.date], ['total', r.total]].forEach(([k, v]) => { const i = form.querySelector('[name="' + k + '"]'); if (i && !i.value && v !== '') i.value = v; });
      if (r.lifetime) form.querySelector('[name="warranty"]').value = 'lifetime';
      toast('Read. Check the details.');
    } catch (e) { toast('Could not read: ' + e.message.slice(0, 80)); }
    el.disabled = false; el.textContent = 'Read receipt';
  },
  async impoldall(el) {
    const ds = impPending('old');
    if (!confirm('Import all ' + ds.length + ' older notes as archived items?')) return;
    el.disabled = true;
    ds.forEach((d) => acceptDraft(d, { name: d.title, date: d.date, total: d.total, store: d.store, propertyId: IMP.lastProp }, true));
    await saveImport(); await saveData(); toast(ds.length + ' imported to the archive'); render();
  },
  async impskipold() {
    const ds = impPending('old');
    if (!confirm('Skip all ' + ds.length + ' older notes? Their attachments are not imported.')) return;
    for (const d of ds) { d.status = 'skipped'; for (const f of d.files) { await idb.del('blobs', f.id); await dropThumb(f.id); } }
    await saveImport(); render();
  },
  async impclear() {
    if (!confirm('Cancel the import? Notes not yet accepted are dropped. Items already added stay.')) return;
    await clearImport(); render();
  },
  viewfile(el) { openViewer(el.dataset.id); },
  vclose() { closeViewer(); },
  vext() { const f = VIEW && VIEW.f; closeViewer(); if (f) openFile(f); },
  vzoom(el) { if (!VIEW) return; VIEW.zoom = Math.min(3, Math.max(1, VIEW.zoom + (+el.dataset.v) * 0.5)); drawViewer(); },
  async vcrop(el) { el.disabled = true; el.textContent = 'Preparing page…'; try { await cropFromPdfPage(+el.dataset.v); } catch (e) { toast('Could not open that page: ' + e.message.slice(0, 80)); el.disabled = false; } },
  gofilter(el) {
    ITEMS_F = Object.assign(ITEMS_F, { st: 'all', q: '', prop: 'all', cat: '', arch: false, owner: '' });
    const k = el.dataset.k || 'st', v = el.dataset.v;
    if (k === 'st') ITEMS_F.st = v; else if (k === 'prop') ITEMS_F.prop = v || 'all'; else if (k === 'owner') ITEMS_F.owner = v; else if (k === 'cat') ITEMS_F.cat = v;
    go('#/items');
  },
  async faultreport(el) {
    const c = D.claims[el.dataset.id], it = D.items[c.itemId];
    el.disabled = true; const was = el.innerHTML; el.textContent = 'Making report…';
    try {
      const bytes = await buildFaultReport(c);
      const st = claimStats(c);
      readySheet(new Blob([bytes], { type: 'application/pdf' }), 'Fault-report-' + safeName(it.name, 30) + '-' + todayISO() + '.pdf', 'Fault report ready',
        'Reported ' + fmtDate(st.reported) + ' · ' + plural(st.logs.length, 'entry').replace('entrys', 'entries') + ' · ' + plural(st.days || 0, 'day') + (isOpenClaim(c) ? ' open' : ''));
    } catch (e) { toast('Could not make the report: ' + e.message.slice(0, 80)); }
    el.disabled = false; el.innerHTML = was;
  },
  logsheet(el) { logSheet(el.dataset.id, el.dataset.item, el.dataset.claim); },
  async dellog(el) { if (!confirm('Delete this entry?')) return; const l = D.logs[el.dataset.id]; l.deleted = true; touch(l); await saveData(); closeSheet(); render(); },
  async delclaim(el) {
    if (!confirm('Delete this claim and its timeline? Files stay with the item.')) return;
    const c = D.claims[el.dataset.id]; c.deleted = true; touch(c);
    claimLogs(c.id).forEach((l) => { l.deleted = true; touch(l); });
    await saveData(); ITEM_TAB = 'log'; go('#/item/' + c.itemId);
  },
  claimphoto(el) { const c = D.claims[el.dataset.id]; CLAIM_TARGET = c.id; SNAP_TARGET = c.itemId; SNAP_TYPE = 'photo'; go('#/snap'); },
  packsheet(el) { packSheet(el.dataset.id); },
  svcsheet(el) { svcSheet(el.dataset.id, el.dataset.item); },
  async svcdone(el) {
    const s = D.services[el.dataset.id]; s.lastDone = todayISO(); touch(s);
    const l = touch({ id: uid(), itemId: s.itemId, claimId: null, date: todayISO(), kind: 'Service', ticket: '', contact: '', text: s.job + ' done', fileIds: [], createdAt: Date.now() });
    D.logs[l.id] = l;
    await saveData(); toast('Marked done. Next due ' + fmtDate(serviceStatus(s).next)); render();
  },
  async delsvc(el) { if (!confirm('Delete this service job?')) return; const s = D.services[el.dataset.id]; s.deleted = true; touch(s); await saveData(); closeSheet(); render(); },
  async sendtax(el) {
    const it = D.items[el.dataset.id];
    try { await navigator.clipboard.writeText(ourTaxText(it)); } catch (e) { /* clipboard not allowed */ }
    window.open(ourTaxLink(it), '_blank');
    it.sentToTax = todayISO(); touch(it); await saveData(); render();
    toast('Sent to Our Tax. The details are also copied, ready to paste.');
  },
  async invpdf(el) {
    el.disabled = true; el.textContent = 'Making PDF…';
    try { const bytes = await buildInventoryPdf(); readySheet(new Blob([bytes], { type: 'application/pdf' }), 'Contents-inventory-' + todayISO() + '.pdf', 'Inventory ready', inventoryRows().length + ' items'); }
    catch (e) { toast('Could not make the PDF: ' + e.message.slice(0, 80)); }
    el.disabled = false; el.textContent = 'Make PDF';
  },
  invcsv() { readySheet(new Blob([inventoryCsv()], { type: 'text/csv' }), 'Contents-inventory-' + todayISO() + '.csv', 'Spreadsheet ready', 'Opens in Excel or Google Sheets'); },
  allcsv() { readySheet(new Blob([allCsv()], { type: 'text/csv' }), 'Our-Gear-items-' + todayISO() + '.csv', 'Spreadsheet ready', 'Every item with its warranties'); },
  readyshare() { shareReady(); },
  readysave() { saveReady(); },
  readyview() { window.open(URL.createObjectURL(READY.blob), '_blank'); },
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
    const c = read('categories'), l = read('locations'), w = read('warrantyTypes'), pp = read('people');
    if (!c.length || !w.length || !pp.length) { toast('People, categories and warranty types need at least one entry'); return; }
    D.lists.categories = c; D.lists.locations = l; D.lists.warrantyTypes = w; D.lists.people = pp; D.lists.updatedAt = Date.now();
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
  if (t.id === 'camIn' || t.id === 'pickIn') { const f = t.files && t.files[0]; if (f) { const cl = CLAIM_TARGET; await startSnap(f, SNAP_TARGET, cl ? 'photo' : SNAP_TYPE); if (SNAP) SNAP.claimId = cl; } return; }
  if (t.id === 'fcat') { ITEMS_F.cat = t.value; $('#itemlist').innerHTML = itemsListHTML(); return; }
  if (t.id === 'claimStatus') {
    const c = D.claims[t.dataset.id]; c.status = t.value;
    if (!isOpenClaim(c) && !c.closed) c.closed = todayISO();
    if (!isOpenClaim(c)) c.followUp = '';
    if (isOpenClaim(c)) c.closed = '';
    touch(c); await saveData(); render(); toast('Status: ' + c.status); return;
  }
  if (t.dataset && t.dataset.kindsel !== undefined) { applyKindFields(t); return; }
  if (t.id === 'fowner') { ITEMS_F.owner = t.value; $('#itemlist').innerHTML = itemsListHTML(); return; }
  if (t.id === 'fst') { ITEMS_F.st = t.value; $('#itemlist').innerHTML = itemsListHTML(); return; }
  if (t.id === 'repProp') { REP.prop = t.value; render(); return; }
  if (t.id === 'repArch') { REP.arch = t.checked; render(); return; }
  if (t.id === 'ownerSel') { S.owner = t.value; saveSettings(); toast('Saved'); return; }
  if (t.id === 'deg') { SNAP.deg = +t.value; rebuildWork(); drawCropView(); return; }
  if (t.id === 'restoreIn') { restoreBackup(t.files && t.files[0]); return; }
  if (t.id === 'enexIn') { const f = t.files && t.files[0]; if (f && !/\.enex$/i.test(f.name)) { toast('That isn\'t an .enex file'); return; } startEnex(f); return; }
  if (t.dataset && t.dataset.act === 'autoread') { ACT.autoread(t); return; }
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
    if (!id && NEW_ITEM_PREFILL) {
      (NEW_ITEM_PREFILL._fileIds || []).forEach((fid) => { const f = D.files[fid]; if (f) { f.itemId = it.id; touch(f); } });
      if (NEW_ITEM_PREFILL._lifetime) {
        const w = touch({ id: uid(), itemId: it.id, createdAt: Date.now(), type: 'Maker', covers: '', termUnit: 'lifetime', termValue: '', startFrom: 'purchase',
          startDate: '', expiryOverride: '', provider: '', contact: '', conditions: '' });
        D.warranties[w.id] = w;
      }
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
    form.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    await saveSnapFile(dest);
  } else if (kind === 'file') {
    const f = D.files[form.dataset.id];
    f.kind = v('kind');
    const g = kindGroup(f.kind);
    if (g !== 'photo') f.date = v('date');
    f.store = g === 'receipt' ? v('store') : ''; f.total = g === 'receipt' && v('total') !== '' ? +v('total') : '';
    touch(f); await saveData(); closeSheet(); render(); toast('Saved');
  } else if (kind === 'draft') {
    const d = IMP.drafts[form.dataset.id], act = e.submitter ? e.submitter.value : 'accept';
    if (act === 'skip') {
      d.status = 'skipped';
      for (const f of d.files) { await idb.del('blobs', f.id); await dropThumb(f.id); }
      await saveImport(); render(); return;
    }
    const vals = { name: v('name'), date: v('date'), total: v('total'), store: v('store'), category: v('category'), warranty: v('warranty'), propertyId: v('propertyId'), location: v('location') };
    IMP.lastProp = vals.propertyId;
    if (act === 'merge') {
      openMergePicker(d.id, vals); return;
    }
    if (!vals.name) { toast('Give the item a name'); return; }
    acceptDraft(d, vals, false);
    await saveImport(); await saveData(); toast('Added'); render();
  } else if (kind === 'claim') {
    const id = form.dataset.id, itemId = form.dataset.item;
    if (!v('title')) { toast('Say what\'s wrong'); return; }
    const c = id ? D.claims[id] : { id: uid(), itemId, createdAt: Date.now() };
    ['title', 'opened', 'status', 'warrantyId', 'provider', 'ticket', 'contact'].forEach((k) => { c[k] = v(k); });
    if (id) { c.closed = v('closed'); c.resolution = v('resolution'); }
    else c.followUp = v('followUp');
    if (!isOpenClaim(c) && !c.closed) c.closed = todayISO();
    if (!isOpenClaim(c)) c.followUp = '';
    D.claims[c.id] = touch(c);
    if (!id) {
      const l = touch({ id: uid(), itemId, claimId: c.id, date: c.opened || todayISO(), kind: v('how') || 'Note', first: true, direction: v('how') && v('how') !== 'Note' ? 'out' : '',
        ticket: c.ticket, contact: c.contact, text: v('text') || 'Fault: ' + c.title, fileIds: [], createdAt: Date.now() });
      D.logs[l.id] = l;
    }
    await saveData(); toast(id ? 'Saved' : 'Claim started'); go('#/claim/' + c.id);
  } else if (kind === 'log') {
    const id = form.dataset.id;
    const l = id ? D.logs[id] : { id: uid(), itemId: form.dataset.item, claimId: form.dataset.claim || null, createdAt: Date.now() };
    ['date', 'kind', 'ticket', 'contact', 'text'].forEach((k) => { l[k] = v(k); });
    if (!l.first) l.direction = v('direction');
    l.fileIds = fd.getAll('file').map(String);
    const cl = l.claimId && D.claims[l.claimId];
    if (cl && fd.has('followUp') && (cl.followUp || '') !== v('followUp')) { cl.followUp = v('followUp'); touch(cl); }
    if (!l.text && !l.fileIds.length && !l.ticket) { toast('Add some details first'); return; }
    D.logs[l.id] = touch(l);
    if (l.claimId && l.ticket && D.claims[l.claimId] && !D.claims[l.claimId].ticket) { D.claims[l.claimId].ticket = l.ticket; touch(D.claims[l.claimId]); }
    await saveData(); closeSheet(); render(); toast('Update saved');
  } else if (kind === 'svc') {
    const id = form.dataset.id;
    if (!v('job') || !(+v('everyMonths') > 0)) { toast('Enter the job and how often'); return; }
    const s = id ? D.services[id] : { id: uid(), itemId: form.dataset.item, createdAt: Date.now() };
    s.job = v('job'); s.everyMonths = String(Math.round(+v('everyMonths'))); s.lastDone = v('lastDone'); s.notes = v('notes');
    D.services[s.id] = touch(s);
    await saveData(); closeSheet(); render(); toast('Service job saved');
  } else if (kind === 'pack') {
    const c = D.claims[form.dataset.id], ids = fd.getAll('file').map(String), keep = fd.get('keep') === 'on';
    const btn = form.querySelector('button[type="submit"]'); btn.disabled = true; btn.textContent = 'Making claim pack…';
    try {
      const r = await buildClaimPack(c, ids);
      const blob = new Blob([r.bytes], { type: 'application/pdf' });
      const it = D.items[c.itemId], name = 'Claim-pack-' + safeName(it.name, 30) + '-' + todayISO() + '.pdf';
      if (keep) {
        const f = touch({ id: uid(), itemId: it.id, kind: 'Claim pack', date: todayISO(), store: '', total: '', mime: 'application/pdf', origName: name,
          size: blob.size, uploaded: false, path: null, createdAt: Date.now(), claimId: c.id });
        await idb.put('blobs', f.id, blob);
        try { await idb.put('thumbs', f.id, await pdfThumbBlob(blob)); } catch (e) { /* no preview */ }
        D.files[f.id] = f;
        const l = touch({ id: uid(), itemId: it.id, claimId: c.id, date: todayISO(), kind: 'Note', ticket: '', contact: '', text: 'Claim pack made (' + ids.length + ' document' + (ids.length === 1 ? '' : 's') + ')', fileIds: [f.id], createdAt: Date.now() });
        D.logs[l.id] = l;
        await saveData(); render();
      }
      readySheet(blob, name, 'Claim pack ready', r.missed.length ? r.missed.length + ' document(s) couldn\'t be added: see the last page.' : 'Send it to ' + (c.provider || 'the maker or store') + '.');
    } catch (e) { toast('Could not make the claim pack: ' + e.message.slice(0, 100)); btn.disabled = false; btn.textContent = 'Make claim pack'; }
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
function openMergePicker(draftId, vals) {
  const rows = live('items').filter((i) => !i.archived).sort((a, b) => a.name.localeCompare(b.name));
  const d = IMP.drafts[draftId];
  openSheet(sheetHead('Merge into…') + '<div class="card list">' + (d.dup && D.items[d.dup] ? '<button class="row" data-act="impmerge" data-draft="' + draftId + '" data-id="' + d.dup + '"><div class="grow"><div class="t">' + esc(D.items[d.dup].name) + '</div><div class="s">Suggested match</div></div></button>' : '') +
    rows.map((i) => '<button class="row" data-act="impmerge" data-draft="' + draftId + '" data-id="' + i.id + '"><div class="grow"><div class="t">' + esc(i.name) + '</div><div class="s">' + esc(propName(i.propertyId)) + '</div></div></button>').join('') + '</div>');
  MERGE_VALS = vals;
}
let MERGE_VALS = null;
ACT.impmerge = async (el) => {
  const d = IMP.drafts[el.dataset.draft], it = D.items[el.dataset.id], vals = MERGE_VALS || {};
  draftFileRecs(Object.assign({}, d, { date: vals.date || d.date, store: vals.store || d.store, total: vals.total === undefined ? d.total : vals.total }), it.id).forEach((f) => { D.files[f.id] = f; });
  it.notes = (it.notes ? it.notes + '\n\n' : '') + d.text + '\n(Merged from ' + IMP.source + ' note "' + d.title + '")';
  touch(it); d.status = 'accepted'; d.itemId = it.id;
  await saveImport(); await saveData(); closeSheet(); toast('Merged into ' + it.name); render();
};

/* Save whatever is on the Snap screen as a file, then go where the person asked. */
async function saveSnapFile(dest) {
  const g = kindGroup(SNAP.kind);
  const full = SNAP.isPdf ? SNAP.file : SNAP.result.full, thumb = SNAP.isPdf ? null : SNAP.result.thumb;
  const f = touch({ id: uid(), itemId: SNAP.itemId || null, kind: SNAP.kind, date: g === 'photo' ? todayISO() : SNAP.date,
    store: g === 'receipt' ? SNAP.store : '', total: g === 'receipt' && SNAP.total !== '' ? +SNAP.total : '',
    mime: SNAP.isPdf ? 'application/pdf' : 'image/jpeg', origName: SNAP.file.name || '', size: full.size, uploaded: false, path: null, createdAt: Date.now(),
    groupId: SNAP.groupId || null, derivedFrom: SNAP.fromFile || null, claimId: SNAP.claimId || null });
  await idb.put('blobs', f.id, full);
  if (thumb) await idb.put('thumbs', f.id, thumb);
  else if (SNAP.isPdf) { try { await idb.put('thumbs', f.id, await pdfThumbBlob(full)); } catch (err) { /* unreadable PDF */ } }
  D.files[f.id] = f;
  await saveData();
  const target = f.itemId;
  SNAP = null; SNAP_TARGET = null;
  if (f.claimId && D.claims[f.claimId]) {
    const l = touch({ id: uid(), itemId: f.itemId, claimId: f.claimId, date: todayISO(), kind: 'Note', ticket: '', contact: '', text: f.kind + ' added', fileIds: [f.id], createdAt: Date.now() });
    D.logs[l.id] = l; await saveData(); go('#/claim/' + f.claimId); toast('Photo added to the claim');
  } else if (dest === 'crop') { go(target ? '#/item/' + target : '#/inbox'); setTimeout(() => openViewer(f.id), 60); }
  else if (target) { ITEM_TAB = 'files'; go('#/item/' + target); toast(g === 'photo' ? 'Photo saved' : 'Saved'); }
  else if (dest === 'file') { go('#/inbox'); setTimeout(() => openPicker(f.id), 50); }
  else { go('#/inbox'); toast('Saved to inbox'); }
}

/* PDF picked on the Snap screen: show its first page and read its text. */
async function snapPdfDetails() {
  const mine = SNAP;
  try {
    const t = await pdfThumbBlob(mine.file);
    if (SNAP === mine) { const im = $('#snapprev'); if (im) im.src = URL.createObjectURL(t); }
  } catch (e) { const im = $('#snapprev'); if (im) im.remove(); }
  if (!S.autoRead || mine.pdfRead || kindGroup(mine.kind) !== 'receipt') return;
  mine.pdfRead = true;
  try {
    const r = await readPdf(mine.file);
    if (SNAP !== mine) return;
    const n = fillEmpty(document.querySelector('form[data-form="snap"]'), r);
    mine.ocrMsg = n ? 'Filled ' + n + ' detail' + (n > 1 ? 's' : '') + ' from the PDF. Check them before saving.' : 'No details found in the PDF text. If it\'s a scan, save it, then crop the receipt out of it.';
  } catch (e) { mine.ocrMsg = 'Couldn\'t read this PDF. Type the details in.'; }
  const m = $('#ocrmsg'); if (m) m.textContent = mine.ocrMsg;
}

/* ---------- start ---------- */
async function boot() {
  try { S = Object.assign(defaultSettings(), JSON.parse(localStorage.getItem('og_settings') || '{}')); } catch (e) { S = defaultSettings(); }
  applyTheme();
  await idb.open();
  D = (await idb.get('kv', 'data')) || emptyData();
  if (!D.lists) D.lists = JSON.parse(JSON.stringify(DEFAULT_LISTS));
  COLLECTIONS.forEach((c) => { if (!D[c]) D[c] = {}; });
  const signedIn = await DBX.finishSignIn().catch((e) => { toast('Sign-in error: ' + e.message); return true; });
  if (location.search.includes('share=1')) history.replaceState(null, '', location.pathname + '#/inbox');
  await loadImport().catch(() => {});
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
