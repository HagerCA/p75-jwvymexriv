// Everything on the phone lives here, in IndexedDB. Every record put is also
// marked dirty (with a version) so the Drive mirror knows what changed.

export const DEFAULT_SETTINGS = Object.freeze({
  proteinBand: { min: 100, max: 105 },
  fat: { on: false, target: 50 },
  fiber: { on: false, min: 20, max: 30 },
  calories: { on: false, target: 1800 },
  relay: { url: null, pass: null },
  drive: { connected: false },
});

const RECORD_STORES = { meals: 'id', days: 'date', checkins: 'week', usuals: 'id' };
const ALL_STORES = [...Object.keys(RECORD_STORES), 'photos', 'settings', 'dirty'];
// Settings that belong to this phone, never exported to Drive or overwritten by a restore.
const LOCAL_SETTINGS = ['relay', 'drive'];

const clone = (o) => JSON.parse(JSON.stringify(o));

let lastVersion = 0;
function nextVersion() {
  lastVersion = Math.max(Date.now(), lastVersion + 1);
  return lastVersion;
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function openStore(name = '75petite') {
  const open = indexedDB.open(name, 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    for (const [store, keyPath] of Object.entries(RECORD_STORES)) {
      const os = db.createObjectStore(store, { keyPath });
      if (store === 'meals') os.createIndex('date', 'date');
    }
    db.createObjectStore('photos');
    db.createObjectStore('settings');
    db.createObjectStore('dirty');
  };
  const db = await req(open);

  async function put(store, value, { clean = false } = {}) {
    const rec = { ...value, updatedAt: clean && value.updatedAt ? value.updatedAt : Date.now() };
    const tx = db.transaction([store, 'dirty'], 'readwrite');
    tx.objectStore(store).put(rec);
    if (!clean) tx.objectStore('dirty').put(nextVersion(), `${store}/${rec[RECORD_STORES[store]]}`);
    await done(tx);
    return rec;
  }

  async function getAll(store, query) {
    const tx = db.transaction(store, 'readonly');
    return req(query ? tx.objectStore(store).index('date').getAll(query) : tx.objectStore(store).getAll());
  }

  async function get(store, key) {
    const v = await req(db.transaction(store, 'readonly').objectStore(store).get(key));
    return v === undefined ? null : v;
  }

  async function getSettings() {
    const s = await get('settings', 'settings');
    return s ? { ...clone(DEFAULT_SETTINGS), ...s } : clone(DEFAULT_SETTINGS);
  }

  async function putSettings(s) {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put(clone(s), 'settings');
    await done(tx);
  }

  async function putPhoto(id, blob, { clean = false } = {}) {
    const tx = db.transaction(['photos', 'dirty'], 'readwrite');
    tx.objectStore('photos').put(blob, id);
    if (!clean) tx.objectStore('dirty').put(nextVersion(), `photos/${id}`);
    await done(tx);
  }

  async function dirty() {
    const tx = db.transaction('dirty', 'readonly');
    const store = tx.objectStore('dirty');
    const [keys, versions] = await Promise.all([req(store.getAllKeys()), req(store.getAll())]);
    const out = { records: [], photoIds: [], photoTags: [] };
    keys.forEach((k, i) => {
      const tag = `${k}@${versions[i]}`;
      if (k.startsWith('photos/')) {
        out.photoIds.push(k.slice('photos/'.length));
        out.photoTags.push(tag);
      } else {
        out.records.push(tag);
      }
    });
    return out;
  }

  // Clears a dirty mark only if nothing changed since dirty() handed out the tag.
  async function markSynced(tags) {
    const tx = db.transaction('dirty', 'readwrite');
    const store = tx.objectStore('dirty');
    for (const tag of tags) {
      const at = tag.lastIndexOf('@');
      const key = tag.slice(0, at);
      const version = Number(tag.slice(at + 1));
      const r = store.get(key);
      r.onsuccess = () => {
        if (r.result === version) store.delete(key);
      };
    }
    await done(tx);
  }

  async function exportAll() {
    const settings = await getSettings();
    for (const k of LOCAL_SETTINGS) delete settings[k];
    return {
      format: 1,
      exportedAt: new Date().toISOString(),
      meals: await getAll('meals'),
      days: await getAll('days'),
      checkIns: await getAll('checkins'),
      usuals: await getAll('usuals'),
      settings,
    };
  }

  // Merge, newer copy wins: a record already on this phone is only replaced by
  // a copy with a later updatedAt.
  async function importAll(obj) {
    const sets = { meals: obj.meals, days: obj.days, checkins: obj.checkIns, usuals: obj.usuals };
    const tx = db.transaction(Object.keys(sets), 'readwrite');
    for (const [store, list] of Object.entries(sets)) {
      const os = tx.objectStore(store);
      for (const rec of list || []) {
        const r = os.get(rec[RECORD_STORES[store]]);
        r.onsuccess = () => {
          if (!r.result || (rec.updatedAt || 0) > (r.result.updatedAt || 0)) os.put(rec);
        };
      }
    }
    await done(tx);
    if (obj.settings) {
      const mine = await getSettings();
      const next = { ...mine, ...obj.settings };
      for (const k of LOCAL_SETTINGS) next[k] = mine[k];
      await putSettings(next);
    }
  }

  async function startFresh() {
    const out = await exportAll();
    out.photos = {};
    const tx0 = db.transaction('photos', 'readonly');
    const [keys, blobs] = await Promise.all([req(tx0.objectStore('photos').getAllKeys()), req(tx0.objectStore('photos').getAll())]);
    keys.forEach((k, i) => { out.photos[k] = blobs[i]; });
    // Settings and usuals survive: usuals are her real meals, built during the dry run.
    const stores = ALL_STORES.filter((s) => s !== 'settings' && s !== 'usuals');
    const tx = db.transaction(stores, 'readwrite');
    for (const s of stores) tx.objectStore(s).clear();
    for (const u of out.usuals) tx.objectStore('dirty').put(nextVersion(), `usuals/${u.id}`);
    await done(tx);
    return out;
  }

  async function requestPersist() {
    try {
      if (globalThis.navigator?.storage?.persist) return await navigator.storage.persist();
    } catch { /* fall through */ }
    return false;
  }

  return {
    putMeal: (m) => put('meals', m),
    getMeal: (id) => get('meals', id),
    mealsByDate: (iso) => getAll('meals', iso),
    allMeals: () => getAll('meals'),
    putDay: (d) => put('days', d),
    allDays: () => getAll('days'),
    putCheckIn: (c) => put('checkins', c),
    allCheckIns: () => getAll('checkins'),
    putUsual: (u) => put('usuals', u),
    allUsuals: () => getAll('usuals'),
    getSettings,
    putSettings,
    putPhoto,
    getPhoto: (id) => get('photos', id),
    dirty,
    markSynced,
    exportAll,
    importAll,
    startFresh,
    requestPersist,
  };
}
