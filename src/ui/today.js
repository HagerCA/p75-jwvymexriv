// Today: the ring, the camera, today's meals, usuals, the workout toggle.
import { h, svg } from './dom.js';
import { dayTotals, proteinState, weekHearts, mealTotals, pendingCheckIn, WORKOUTS_PER_WEEK } from '../tally.js';
import { weekNumber, dayNumber } from '../calendar.js';
import { ringText, gramsText, time12, newId, reasonText, shortDate } from '../format.js';
import { shrinkPhoto } from '../estimate.js';
import { openReview } from './review.js';
import { checkInCard } from './checkin.js';

export function renderToday(app) {
  const today = app.today();
  const s = app.settings;
  const totals = dayTotals(app.meals, today);
  const ps = proteinState(totals.protein, s.proteinBand);
  const todays = app.meals.filter((m) => m.date === today);
  const saved = todays.filter((m) => m.status === 'saved').sort(byTime);
  const pending = todays.filter((m) => m.status === 'waiting' || m.status === 'to-confirm');
  // Meals from earlier days still waiting or unconfirmed show here too, so none is lost.
  const older = app.meals.filter((m) => m.date !== today && (m.status === 'waiting' || m.status === 'to-confirm'));

  const wk = pendingCheckIn(today, app.checkIns);

  return h('div', null,
    app.driveWaiting ? reconnectChip(app) : null,
    wk !== null ? checkInCard(app, wk) : null,
    h('div.card', null,
      ring(totals.protein, ps, s.proteinBand),
      bars(totals, s),
    ),
    snapCard(app),
    pending.length || older.length ? pendingCard(app, [...older, ...pending]) : null,
    saved.length ? savedCard(app, saved) : null,
    app.usuals.length ? usualsCard(app) : null,
    workoutCard(app, today),
    dayNumber(today) < 1 ? practiceCard(app) : null,
  );
}

const byTime = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);

function ring(protein, ps, band) {
  const r = 92;
  const c = 2 * Math.PI * r;
  const frac = Math.min(protein / band.min, 1);
  return h('div.ring-wrap', null,
    svg('svg', { viewBox: '0 0 220 220', class: `ring ${ps.state}`, role: 'img', 'aria-label': `${protein} grams of protein, ${ringText(ps)}` },
      svg('circle', { cx: 110, cy: 110, r, fill: 'none', 'stroke-width': 16, class: 'track' }),
      svg('circle', {
        cx: 110, cy: 110, r, fill: 'none', 'stroke-width': 16, class: 'fill', 'stroke-linecap': 'round',
        'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - frac), transform: 'rotate(-90 110 110)',
      }),
      svg('text', { x: 110, y: 112, 'text-anchor': 'middle', class: 'big' }, ringText(ps)),
      svg('text', { x: 110, y: 140, 'text-anchor': 'middle', class: 'sub' }, `${fmt(protein)} of ${band.min}–${band.max} g protein`),
    ),
  );
}

const fmt = (n) => String(Math.round(n * 10) / 10);
const commas = (n) => Math.round(n).toLocaleString('en-US');

function bars(t, s) {
  const out = [];
  if (s.fat.on) out.push(bar('Fat', t.fat, s.fat.target, s.fat.target, (v) => `${fmt(v)} of ${s.fat.target} g`));
  if (s.fiber.on) out.push(bar('Fiber', t.fiber, s.fiber.min, s.fiber.max, (v) => `${fmt(v)} of ${s.fiber.min}–${s.fiber.max} g`));
  if (s.calories.on) out.push(bar('Calories', t.calories, s.calories.target, s.calories.target, (v) => `${commas(v)} of ${commas(s.calories.target)}`));
  return out.length ? h('div.bars', null, out) : null;
}

function bar(label, value, min, max, text) {
  const state = value > max ? 'over' : value >= min ? 'met' : '';
  return h(`div.bar${state ? '.' + state : ''}`, null,
    h('div.lbl', null, h('b', null, label), h('span', null, text(value))),
    h('div.track', null, h('div.fill', { style: `width:${Math.min(100, (value / max) * 100)}%` })),
  );
}

function cameraIcon() {
  return svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    svg('path', { d: 'M9 4 7.2 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.2L15 4H9zm3 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z' }));
}

function snapCard(app) {
  const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden' });
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (file) notePrompt(app, file);
  });
  return h('div.card', null,
    h('button.btn.big', { on: { click: () => input.click() } }, cameraIcon(), 'Snap a meal'),
    input,
    h('button.link', { on: { click: () => typePrompt(app) } }, 'type it instead'),
  );
}

async function notePrompt(app, file) {
  let blob;
  try {
    blob = await shrinkPhoto(file);
  } catch {
    app.toast("That photo didn't open. Try again or type it instead.");
    return;
  }
  const url = URL.createObjectURL(blob);
  const note = h('input', { type: 'text', placeholder: 'palm-sized, ate half', maxLength: 120, enterKeyHint: 'go' });
  const go = h('button.btn', { on: { click: () => send() } }, 'Read my plate');
  const sh = app.sheet(h('div', null,
    h('h2', null, 'Anything to add?'),
    h('img.photo', { src: url, alt: '' }),
    h('label.field', null, 'A short note helps (optional)', note),
    h('div', { style: 'height:12px' }),
    go,
  ), { onClose: () => URL.revokeObjectURL(url) });
  note.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  let sent = false;
  async function send() {
    if (sent) return;
    sent = true;
    go.disabled = true;
    const id = newId();
    const date = app.today();
    const photoId = `meal-${date}-${id}`;
    await app.store.putPhoto(photoId, blob);
    await app.store.putMeal(newMeal(id, date, { source: 'photo', photoId, note: note.value.trim() }));
    await readAndReview(app, id, sh);
  }
}

function typePrompt(app) {
  const text = h('textarea', { placeholder: '2 eggs, a slice of toast, half an avocado', maxLength: 300 });
  const go = h('button.btn', { on: { click: () => send() } }, 'Read it');
  const sh = app.sheet(h('div', null,
    h('h2', null, 'What did you eat?'),
    h('label.field', null, 'Say it the way you would say it', text),
    h('div', { style: 'height:12px' }),
    go,
    h('button.link.muted', { on: { click: () => { sh.close(); openReview(app, null, { manual: true }); } } }, 'add it by hand'),
  ));
  setTimeout(() => text.focus(), 50);
  let sent = false;
  async function send() {
    const t = text.value.trim();
    if (!t || sent) return;
    sent = true;
    go.disabled = true;
    const id = newId();
    await app.store.putMeal(newMeal(id, app.today(), { source: 'text', text: t }));
    await readAndReview(app, id, sh);
  }
}

export function newMeal(id, date, o) {
  const now = new Date();
  return {
    id, date, time: time12(now), createdAt: now.getTime(), status: 'waiting', source: 'text',
    note: '', text: undefined, photoId: null, items: [], ...o,
  };
}

// Show "Reading your plate…" until the queue has read this meal, then the review card.
async function readAndReview(app, id, sh) {
  sh.replace(h('div.reading', null, h('div.spinner'), h('p', null, 'Reading your plate…')));
  if (!app.relayOn()) {
    const m = await app.store.getMeal(id);
    await app.store.putMeal({ ...m, status: 'to-confirm', problem: 'pass' });
  } else {
    app.readMeals();
    const deadline = Date.now() + 45000;
    for (;;) {
      const m = await app.store.getMeal(id);
      if (!m || m.status !== 'waiting') break;
      // The pass finished and this meal is still waiting: the relay was unreachable.
      if (!navigator.onLine || !app._q || Date.now() > deadline) {
        sh.close();
        await app.refresh();
        app.toast(reasonText('offline'), 5000);
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  sh.close();
  await app.refresh();
  openReview(app, id);
}

function mealRow(app, m, extra) {
  const thumb = h('div.thumb', null, m.photoId ? '' : 'typed');
  if (m.photoId) app.photoUrl(m.photoId).then((u) => { if (u) thumb.style.backgroundImage = `url("${u}")`; });
  const names = m.items.length ? m.items.map((i) => i.name).join(', ') : m.text || m.note || 'Meal';
  const p = mealTotals(m).protein;
  return h('button.meal', { on: { click: () => openReview(app, m.id) } },
    thumb,
    h('div.what', null, h('div.names', null, names), h('div.time', null, m.date === app.today() ? m.time : `${shortDate(m.date)} · ${m.time}`)),
    extra || (m.status === 'saved' ? h('div.g', null, gramsText(p)) : null),
  );
}

function pendingCard(app, meals) {
  return h('div.card', null,
    h('div.section-title', null, 'Not counted yet'),
    meals.map((m) => mealRow(app, m, m.status === 'waiting'
      ? h('span.pill.sky', null, 'waiting for signal')
      : h('span.pill.gold', null, 'to confirm'))),
  );
}

function savedCard(app, meals) {
  return h('div.card', null, h('div.section-title', null, "Today's meals"), meals.map((m) => mealRow(app, m)));
}

function usualsCard(app) {
  return h('div.card', null,
    h('div.section-title', null, 'Your usuals'),
    h('div.chips', null, app.usuals
      .filter((u) => !u.hidden)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((u) => h('button.chip', { on: { click: (e) => addUsual(app, u, e.currentTarget) } }, u.name))),
  );
}

async function addUsual(app, u, btn) {
  if (btn.disabled) return;
  btn.disabled = true;
  const id = newId();
  const items = u.items.map((i) => ({ ...i }));
  await app.store.putMeal(newMeal(id, app.today(), { source: 'usual', status: 'saved', note: u.name, items }));
  await app.afterChange();
  app.toast(`Added ${u.name}, ${gramsText(mealTotals({ items }).protein)} protein. Tap it to change.`);
}

function workoutCard(app, today) {
  const day = app.days.find((d) => d.date === today);
  const on = Boolean(day && day.workedOut);
  const w = weekNumber(today);
  const count = w ? weekHearts(app.meals, app.days, app.checkIns, w).workouts : null;
  const btn = h(`button.toggle${on ? '.on' : ''}`, { 'aria-pressed': String(on), on: { click: toggle } },
    h('div', null,
      h('h3', null, 'I worked out today'),
      count !== null ? h('div.small.muted', null, `${count} of ${WORKOUTS_PER_WEEK} this week`) : null,
    ),
    h('span.switch'),
  );
  async function toggle() {
    btn.disabled = true;
    await app.store.putDay({ date: today, workedOut: !on });
    await app.afterChange();
  }
  return h('div.card', null, btn);
}

function reconnectChip(app) {
  return h('div.card.accent', null,
    h('p', null, 'Google Drive needs you to sign in again. Everything is safe on your phone until then.'),
    h('button.btn.ghost', { on: { click: async () => {
      const { renew } = await import('../drive.js');
      const { GOOGLE_CLIENT_ID } = await import('../config.js');
      if (await renew(GOOGLE_CLIENT_ID)) {
        app.driveWaiting = false;
        app.render();
        app.background();
      } else {
        app.toast("That didn't connect. Try again from Settings.");
      }
    } } }, 'Reconnect Drive'),
  );
}

function practiceCard(app) {
  return h('div.card', null,
    h('h3', null, 'Before Day 1'),
    h('p.small.muted', null, 'Try everything now. On Sunday night, Settings has "Start fresh for Day 1", which moves all of this to a Test folder.'),
    h('button.btn.ghost', { on: { click: () => import('./checkin.js').then((m) => m.openCheckIn(app, 0)) } }, 'Try a practice check-in'),
  );
}
