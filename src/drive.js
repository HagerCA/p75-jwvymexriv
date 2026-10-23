// Google sign-in and the Drive mirror. The phone is the primary copy; Drive is
// the mirror and the restore source. Layout:
//   75 Petite/data.json
//   75 Petite/Meals/<date>-<mealId>.jpg
//   75 Petite/Check-ins/week-<n>-<front|side|back>.jpg
//   75 Petite/Test/   (dry-run data moved by "Start fresh")
import { AuthError } from './drive-api.js';

export { AuthError };

const ROOT = '75 Petite';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_KEY = '75petite.driveToken';

// ---- sign-in (Google Identity Services, token model) ----

let tokenClient = null;
let pending = null;

function saveToken(t) {
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch { /* private mode */ }
}

export function getToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    if (t && t.expiresAt > Date.now() + 60000) return t.accessToken;
  } catch { /* no storage */ }
  return null;
}

export function forgetToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* no storage */ }
}

function ensureClient(clientId) {
  if (tokenClient) return tokenClient;
  if (!globalThis.google?.accounts?.oauth2) return null;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: (resp) => {
      const p = pending;
      pending = null;
      if (resp && resp.access_token) {
        saveToken({ accessToken: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000 });
        p?.resolve(true);
      } else {
        p?.resolve(false);
      }
    },
    error_callback: () => {
      const p = pending;
      pending = null;
      p?.resolve(false);
    },
  });
  return tokenClient;
}

function ask(clientId, prompt) {
  const client = ensureClient(clientId);
  if (!client) return Promise.resolve(false);
  if (pending) return pending.promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  pending = { promise, resolve };
  try {
    client.requestAccessToken({ prompt });
  } catch {
    pending = null;
    return Promise.resolve(false);
  }
  return promise;
}

let configuredClientId = null;

export function connect(clientId) {
  configuredClientId = clientId;
  return ask(clientId, 'consent');
}

export function renew(clientId = configuredClientId) {
  if (!clientId) return Promise.resolve(false);
  configuredClientId = clientId;
  return ask(clientId, '');
}

// ---- mirror ----

// Every Drive operation runs one at a time: Drive's "look, then create" is not
// atomic, and two overlapping syncs would make two folders or two data.json files.
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

// Stores that have pulled Drive's copy in this session. The first push of a
// session always merges first, so a new or wiped phone never writes over the backup.
const merged = new WeakSet();

const photoPlace = (id) =>
  id.startsWith('meal-') ? { folder: 'Meals', name: `${id.slice('meal-'.length)}.jpg` } : { folder: 'Check-ins', name: `${id}.jpg` };

const photoIdFrom = (folder, name) => {
  const base = name.replace(/\.jpg$/, '');
  return folder === 'Meals' ? `meal-${base}` : base;
};

async function folders(api) {
  const root = await api.findOrCreateFolder(ROOT, null);
  return {
    root,
    Meals: await api.findOrCreateFolder('Meals', root),
    'Check-ins': await api.findOrCreateFolder('Check-ins', root),
  };
}

const jsonBlob = (obj) => new Blob([JSON.stringify(obj)], { type: 'application/json' });

// Pull Drive's data.json (newer copy of each record wins) and any photo this phone lacks.
async function pull(store, api) {
  const f = await folders(api);
  const top = await api.listFiles(f.root);
  const data = top.find((x) => x.name === 'data.json');
  let restored = 0;
  if (data) {
    const obj = JSON.parse(await (await api.download(data.id)).text());
    await store.importAll(obj);
    for (const k of ['meals', 'days', 'checkIns', 'usuals']) restored += (obj[k] || []).length;
  }
  for (const folder of ['Meals', 'Check-ins']) {
    for (const file of await api.listFiles(f[folder])) {
      if (!file.name.endsWith('.jpg')) continue;
      const id = photoIdFrom(folder, file.name);
      if (await store.getPhoto(id)) continue;
      const blob = await api.download(file.id);
      await store.putPhoto(id, new Blob([blob], { type: 'image/jpeg' }), { clean: true });
    }
  }
  merged.add(store);
  return restored;
}

async function pushOnce(store, api, count) {
  if (!merged.has(store)) await pull(store, api);
  const d = await store.dirty();
  if (!d.records.length && !d.photoIds.length) return;
  const f = await folders(api);
  if (d.records.length) {
    await api.upsertFile('data.json', f.root, jsonBlob(await store.exportAll()), 'application/json');
    await store.markSynced(d.records);
    count.uploaded++;
  }
  for (let i = 0; i < d.photoIds.length; i++) {
    const id = d.photoIds[i];
    const blob = await store.getPhoto(id);
    if (blob) {
      const place = photoPlace(id);
      await api.upsertFile(place.name, f[place.folder], blob, 'image/jpeg');
      count.uploaded++;
    }
    await store.markSynced([d.photoTags[i]]);
  }
}

async function syncOnce(store, api, doRenew) {
  const count = { uploaded: 0 };
  if (!api) return { uploaded: 0, waiting: false };
  try {
    await pushOnce(store, api, count);
    return { uploaded: count.uploaded, waiting: false };
  } catch (e) {
    if (!(e instanceof AuthError)) return { uploaded: count.uploaded, waiting: false, error: 'offline' };
  }
  if (!(await doRenew())) return { uploaded: count.uploaded, waiting: true };
  try {
    await pushOnce(store, api, count);
    return { uploaded: count.uploaded, waiting: false };
  } catch (e) {
    return e instanceof AuthError ? { uploaded: count.uploaded, waiting: true } : { uploaded: count.uploaded, waiting: false, error: 'offline' };
  }
}

export function syncNow(store, api, { renew: doRenew = renew } = {}) {
  return serial(() => syncOnce(store, api, doRenew));
}

export function restore(store, api) {
  return serial(() => pull(store, api));
}

// "Start fresh for Day 1": everything from the dry run goes to 75 Petite/Test/,
// Drive's own copy is emptied, and only then is the phone cleared, keeping its
// settings and usuals. A failure part way leaves the phone untouched.
export function moveToTest(store, api) {
  return serial(async () => {
    if (!api) {
      await store.startFresh();
      return;
    }
    const f = await folders(api);
    const test = await api.findOrCreateFolder('Test', f.root);
    const dump = await store.exportAll();
    const d = await store.dirty();
    for (const id of d.photoIds) {
      const blob = await store.getPhoto(id);
      if (blob) await api.upsertFile(photoPlace(id).name, test, blob, 'image/jpeg');
    }
    await api.upsertFile('data.json', test, jsonBlob(dump), 'application/json');
    for (const folder of ['Meals', 'Check-ins']) {
      for (const file of await api.listFiles(f[folder])) await api.moveFile(file.id, test, f[folder]);
    }
    await api.upsertFile('data.json', f.root, jsonBlob({ ...dump, meals: [], days: [], checkIns: [] }), 'application/json');
    await store.startFresh();
    merged.add(store);
  });
}
