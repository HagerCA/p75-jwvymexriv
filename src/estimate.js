// Photo or typed line -> relay -> validated items. Meals wait on the phone
// until there is signal; processQueue reads them once each.
import { validateEstimate } from './validate.js';

const RELAY_ERRORS = { pass: 'pass', cap: 'cap', gemini: 'down', bad: 'down', busy: 'down' };
const TIMEOUT_MS = 30000;
// A fetch that throws while the phone says it is online is usually the relay, not the signal.
const MAX_TRIES_ONLINE = 3;

const defaultOnline = () => (globalThis.navigator ? navigator.onLine !== false : true);

export async function shrinkPhoto(file, maxPx = 1024) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not shrink photo'))), 'image/jpeg', 0.8),
  );
}

async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function requestEstimate(input, { url, pass, fetchImpl = globalThis.fetch, online = defaultOnline, timeoutMs = TIMEOUT_MS } = {}) {
  if (!url) return { ok: false, reason: 'down' };
  if (!pass) return { ok: false, reason: 'pass' };
  if (!online()) return { ok: false, reason: 'offline' };

  const body = { pass, kind: input.kind, note: input.note || '', requestId: input.requestId };
  if (input.kind === 'photo') {
    body.image = await toBase64(input.blob);
    body.mime = input.blob.type || 'image/jpeg';
  } else {
    body.text = input.text || '';
  }

  let res;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => { ctrl?.abort(); resolve('timeout'); }, timeoutMs);
  });
  try {
    res = await Promise.race([
      fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
        signal: ctrl?.signal,
      }),
      timedOut,
    ]);
  } catch {
    return { ok: false, reason: 'offline' };
  } finally {
    clearTimeout(timer);
  }
  if (res === 'timeout') return { ok: false, reason: 'down' };
  if (!res.ok) return { ok: false, reason: 'down' };
  let json;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: 'down' };
  }
  if (!json || json.ok !== true) return { ok: false, reason: RELAY_ERRORS[json?.error] || 'down' };
  const v = validateEstimate(json.estimate);
  if (!v.ok) return { ok: false, reason: 'unreadable' };
  return v;
}

const running = new WeakMap();

// One pass at a time per store. A call that arrives mid-pass returns 0 at once
// and asks the running pass to look again before it finishes.
export async function processQueue(store, opts) {
  const state = running.get(store);
  if (state) {
    state.again = true;
    return 0;
  }
  const me = { again: true };
  running.set(store, me);
  let moved = 0;
  let offline = false;
  try {
    while (me.again && !offline) {
      me.again = false;
      moved += await onePass(store, opts, () => { offline = true; });
    }
  } finally {
    running.delete(store);
  }
  return moved;
}

async function onePass(store, opts, onOffline) {
  let moved = 0;
  const waiting = (await store.allMeals()).filter((m) => m.status === 'waiting');
  for (const meal of waiting) {
    const input = { kind: meal.photoId ? 'photo' : 'text', note: meal.note, requestId: meal.id };
    if (meal.photoId) {
      input.blob = await store.getPhoto(meal.photoId);
      if (!input.blob) input.kind = 'text';
    }
    if (input.kind === 'text') input.text = meal.text || meal.note || '';
    const r = await requestEstimate(input, opts);
    const online = (opts && opts.online) || defaultOnline;
    if (!r.ok && r.reason === 'offline') {
      if (!online()) {
        onOffline();
        break;
      }
      const cur = await store.getMeal(meal.id);
      if (!cur || cur.status !== 'waiting') continue;
      const tries = (cur.tries || 0) + 1;
      if (tries < MAX_TRIES_ONLINE) {
        await store.putMeal({ ...cur, tries });
        onOffline();
        break;
      }
      await store.putMeal({ ...cur, tries, status: 'to-confirm', items: [], problem: 'down' });
      moved++;
      continue;
    }
    const current = await store.getMeal(meal.id);
    if (!current || current.status !== 'waiting') continue;
    const next = { ...current, status: 'to-confirm' };
    if (r.ok) {
      next.items = r.items;
      next.kind = r.kind;
      delete next.problem;
    } else {
      next.items = [];
      next.problem = r.reason;
    }
    await store.putMeal(next);
    moved++;
  }
  return moved;
}
