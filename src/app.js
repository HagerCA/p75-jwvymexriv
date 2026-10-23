// The app shell: loads everything from the phone, renders the current tab,
// and runs the meal queue and the Drive mirror after every change.
import { openStore } from './store.js';
import { processQueue } from './estimate.js';
import { makeDriveApi } from './drive-api.js';
import { syncNow, getToken, renew } from './drive.js';
import { todayISO } from './calendar.js';
import { headerText } from './format.js';
import { GOOGLE_CLIENT_ID, RELAY_URL } from './config.js';
import { renderToday } from './ui/today.js';
import { renderWeek } from './ui/week.js';
import { render75 } from './ui/days75.js';
import { openSettings } from './ui/settings.js';
import { h } from './ui/dom.js';

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

const app = {
  store: null,
  settings: null,
  meals: [],
  days: [],
  checkIns: [],
  usuals: [],
  tab: 'today',
  driveWaiting: false,
  photoUrls: new Map(),

  // The date override exists for testing on this machine only.
  today() {
    const q = new URLSearchParams(location.search).get('today');
    if (isLocal && q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
    return todayISO();
  },

  relayOpts() {
    return { url: this.settings.relay.url || RELAY_URL || null, pass: this.settings.relay.pass };
  },

  relayOn() {
    const o = this.relayOpts();
    return Boolean(o.url && o.pass);
  },

  driveApi() {
    if (!this.settings.drive.connected || !GOOGLE_CLIENT_ID) return null;
    return makeDriveApi(getToken);
  },

  async load() {
    const s = this.store;
    [this.settings, this.meals, this.days, this.checkIns, this.usuals] = await Promise.all([
      s.getSettings(), s.allMeals(), s.allDays(), s.allCheckIns(), s.allUsuals(),
    ]);
  },

  async refresh() {
    await this.load();
    this.render();
  },

  render() {
    document.getElementById('day-line').textContent = headerText(this.today());
    for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === this.tab);
    const main = document.getElementById('main');
    const scroll = window.scrollY;
    const view = this.tab === 'week' ? renderWeek(this) : this.tab === 'days75' ? render75(this) : renderToday(this);
    main.replaceChildren(view);
    window.scrollTo(0, scroll);
  },

  go(tab) {
    this.tab = tab;
    this.render();
    window.scrollTo(0, 0);
  },

  async photoUrl(id) {
    if (!id) return null;
    if (this.photoUrls.has(id)) return this.photoUrls.get(id);
    const blob = await this.store.getPhoto(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.photoUrls.set(id, url);
    return url;
  },

  forgetPhotoUrl(id) {
    const url = this.photoUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.photoUrls.delete(id);
  },

  sheet(content, { onClose } = {}) {
    const root = document.getElementById('sheet-root');
    const close = () => {
      root.replaceChildren();
      document.body.style.overflow = '';
      onClose?.();
    };
    const sheet = h('div.sheet', { role: 'dialog', 'aria-modal': 'true' },
      h('button.close', { 'aria-label': 'Close', on: { click: close } }, '×'), content);
    const backdrop = h('div.backdrop', { on: { click: (e) => { if (e.target === backdrop) close(); } } }, sheet);
    root.replaceChildren(backdrop);
    document.body.style.overflow = 'hidden';
    return { close, sheet, replace: (el) => { sheet.replaceChildren(sheet.firstChild, el); } };
  },

  toast(msg, ms = 3200) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  },

  // Called after every save: read waiting meals, mirror to Drive, redraw.
  async afterChange() {
    await this.refresh();
    this.persistOnce();
    this.background();
  },

  // Two independent jobs, so a slow Drive upload never holds up reading a meal.
  background() {
    this.readMeals();
    this.mirror();
  },

  async readMeals() {
    if (this._q) { this._qAgain = true; return; }
    this._q = true;
    try {
      do {
        this._qAgain = false;
        const moved = await processQueue(this.store, this.relayOpts());
        if (moved) {
          await this.refresh();
          this.mirror();
        }
      } while (this._qAgain);
    } finally {
      this._q = false;
    }
  },

  async mirror() {
    if (this._m) { this._mAgain = true; return; }
    this._m = true;
    try {
      do {
        this._mAgain = false;
        const r = await syncNow(this.store, this.driveApi(), { renew: () => renew(GOOGLE_CLIENT_ID) });
        if (r.waiting !== this.driveWaiting) {
          this.driveWaiting = r.waiting;
          this.render();
        }
      } while (this._mAgain);
    } finally {
      this._m = false;
    }
  },

  async persistOnce() {
    if (this._persisted) return;
    this._persisted = true;
    await this.store.requestPersist();
  },
};

async function takePassFromLink() {
  const m = location.hash.match(/(?:^#|&)k=([A-Za-z0-9_-]+)/);
  if (!m) return;
  const s = await app.store.getSettings();
  s.relay = { ...s.relay, pass: m[1] };
  await app.store.putSettings(s);
  history.replaceState(null, '', location.pathname + location.search);
}

async function start() {
  app.store = await openStore();
  await takePassFromLink();
  await app.load();
  for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => app.go(b.dataset.tab));
  document.getElementById('settings-btn').addEventListener('click', () => openSettings(app));
  window.addEventListener('online', () => app.background());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') app.refresh().then(() => app.background());
  });
  app.render();
  app.background();
  if ('serviceWorker' in navigator && (!isLocal || new URLSearchParams(location.search).has('sw'))) {
    // When a new version takes over a page that an older version was serving,
    // reload once so she runs the new code instead of the copy cached offline.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      try { sessionStorage.setItem('p75.updatedAt', String(Date.now())); } catch { /* private mode */ }
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  window.__app = isLocal ? app : undefined;
}

start();
