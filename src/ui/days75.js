// 75 Days: the 11-week grid, the weight line with 105 marked, the body photos.
import { h, svg } from './dom.js';
import { weekDates, CHALLENGE } from '../calendar.js';
import { totalHearts, WEEKS, NUTRITION_PER_WEEK, WORKOUTS_PER_WEEK } from '../tally.js';
import { shortDate } from '../format.js';

const CEILING = 105;

export function render75(app) {
  const today = app.today();
  const tot = totalHearts(app.meals, app.days, app.checkIns);
  const real = app.checkIns.filter((c) => c.week >= 1).sort((a, b) => a.week - b.week);
  return h('div', null,
    h('div.card', null,
      h('div.tally', null,
        h('div', null, h('div.n.p', null, `${tot.nutrition}`), h('div.l', null, `of ${NUTRITION_PER_WEEK * WEEKS} nutrition`)),
        h('div', null, h('div.n.g', null, `${tot.workouts}`), h('div.l', null, `of ${WORKOUTS_PER_WEEK * WEEKS} workouts`)),
        h('div', null, h('div.n.s', null, `${tot.checkIns}`), h('div.l', null, `of ${WEEKS} check-ins`)),
      ),
    ),
    h('div.card', null,
      h('div.section-title', null, `${CHALLENGE.days} days`),
      grid(app, today),
      h('p.small.muted', { style: 'margin:10px 0 0' },
        h('span', { style: 'color:var(--pink)' }, '●'), ' a day with a saved meal   ',
        h('span', { style: 'color:var(--gold)' }, '●'), ' a workout   ',
        h('span', { style: 'color:var(--sky)' }, '●'), ' check-in'),
    ),
    h('div.card', null,
      h('div.section-title', null, 'Weight'),
      real.some((c) => typeof c.weight === 'number') ? chart(real) : h('p.muted', null, 'Your Monday weights draw a line here, with 105 lb marked.'),
    ),
    photosCard(app, real),
  );
}

function grid(app, today) {
  const fed = new Set(app.meals.filter((m) => m.status === 'saved').map((m) => m.date));
  const moved = new Set(app.days.filter((d) => d.workedOut).map((d) => d.date));
  const checked = new Set(app.checkIns.map((c) => c.week));
  const rows = [h('div.g-row', null, h('span'), ...['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => h('span.wk', { style: 'text-align:center' }, d)), h('span'))];
  for (let w = 1; w <= WEEKS; w++) {
    const dates = weekDates(w);
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const iso = dates[i];
      if (!iso) { cells.push(h('span')); continue; }
      const cls = ['g-cell', iso === today ? 'today' : '', iso > today ? 'future' : ''].filter(Boolean).join('.');
      cells.push(h(`div.${cls}`, { title: shortDate(iso) },
        fed.has(iso) ? h('span.dn') : null,
        moved.has(iso) ? h('span.dw') : null));
    }
    rows.push(h('div.g-row', null,
      h('span.wk', null, `W${w}`), ...cells,
      h('span', { class: `wk-dot${checked.has(w) ? ' on' : ''}`, title: checked.has(w) ? 'checked in' : '' })));
  }
  return h('div.grid75', null, rows);
}

function chart(checkIns) {
  const pts = checkIns.filter((c) => typeof c.weight === 'number');
  const W = 340, H = 180, L = 34, R = 10, T = 14, B = 26;
  const ws = pts.map((p) => p.weight);
  const lo = Math.floor(Math.min(...ws, CEILING) - 2);
  const hi = Math.ceil(Math.max(...ws, CEILING) + 1);
  const x = (week) => L + ((week - 1) / (WEEKS - 1)) * (W - L - R);
  const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const els = [];
  for (let w = 1; w <= WEEKS; w++) els.push(svg('text', { x: x(w), y: H - 8, 'text-anchor': 'middle' }, String(w)));
  els.push(svg('line', { x1: L, x2: W - R, y1: y(CEILING), y2: y(CEILING), stroke: '#D9AE5E', 'stroke-width': 1.5, 'stroke-dasharray': '5 5' }));
  els.push(svg('text', { x: L - 4, y: y(CEILING) + 4, 'text-anchor': 'end', style: 'fill:#D9AE5E' }, String(CEILING)));
  els.push(svg('text', { x: L - 4, y: y(lo) + 4, 'text-anchor': 'end' }, String(lo)));
  if (pts.length > 1) {
    els.push(svg('polyline', { points: pts.map((p) => `${x(p.week)},${y(p.weight)}`).join(' '), fill: 'none', stroke: '#F48FB6', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
  }
  for (const p of pts) {
    els.push(svg('circle', { cx: x(p.week), cy: y(p.weight), r: 4.5, fill: '#F48FB6' }));
    els.push(svg('text', { x: x(p.week), y: y(p.weight) + (p.week % 2 ? -9 : 17), 'text-anchor': 'middle', style: 'fill:#EDE6DA;font-size:10px' }, String(p.weight)));
  }
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Weight by week' }, ...els);
}

function photosCard(app, checkIns) {
  const withPhotos = checkIns.filter((c) => c.photoIds && c.photoIds.length);
  if (!withPhotos.length) {
    return h('div.card', null, h('div.section-title', null, 'Body photos'), h('p.muted', null, 'Your Monday photos line up here, with Day 1 beside the latest.'));
  }
  const first = withPhotos[0];
  const last = withPhotos[withPhotos.length - 1];
  const firstId = first.photoIds[0];
  const lastId = last.photoIds.find((id) => id.endsWith(firstId.slice(firstId.lastIndexOf('-')))) || last.photoIds[0];
  const img = (id) => {
    const el = h('img', { alt: '', loading: 'lazy' });
    app.photoUrl(id).then((u) => { if (u) el.src = u; });
    return el;
  };
  return h('div.card', null,
    h('div.section-title', null, 'Body photos'),
    withPhotos.length > 1 ? h('div.compare', null,
      h('figure', null, img(firstId), h('figcaption', null, first.week === 1 ? 'Day 1' : `Week ${first.week}`)),
      h('figure', null, img(lastId), h('figcaption', null, `Latest · Week ${last.week}`)),
    ) : null,
    h('div', { style: 'height:10px' }),
    h('div.photo-strip', null, withPhotos.flatMap((c) => c.photoIds.map((id) => img(id)))),
  );
}
