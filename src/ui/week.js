// This Week: Monday to Sunday, protein per day against the band, hearts, check-in.
import { h, heart } from './dom.js';
import { weekNumber, weekDates, CHALLENGE, dayNumber } from '../calendar.js';
import { dayTotals, weekHearts, WEEKS, NUTRITION_PER_WEEK, WORKOUTS_PER_WEEK } from '../tally.js';
import { shortDate, gramsText } from '../format.js';

let shown = null;   // week being looked at; null follows today

export function renderWeek(app) {
  const today = app.today();
  const current = weekNumber(today) ?? (dayNumber(today) < 1 ? 1 : WEEKS);
  const week = shown ?? current;
  const band = app.settings.proteinBand;
  const hearts = weekHearts(app.meals, app.days, app.checkIns, week);
  const dates = weekDates(week);

  const nav = h('div.row', { style: 'margin-bottom:12px' },
    h('button.chip', { style: 'flex:none', disabled: week <= 1, 'aria-label': 'Previous week', on: { click: () => { shown = week - 1; app.render(); } } }, '‹'),
    h('h2', { style: 'text-align:center' }, `Week ${week}`, h('div.small.muted', { style: 'font-family:var(--body);font-weight:400' }, `${shortDate(dates[0])} to ${shortDate(dates[dates.length - 1])}`)),
    h('button.chip', { style: 'flex:none', disabled: week >= WEEKS, 'aria-label': 'Next week', on: { click: () => { shown = week + 1; app.render(); } } }, '›'),
  );

  return h('div', null,
    h('div.card', null,
      nav,
      h('div.tally', null,
        h('div', null, h('div.n.p', null, `${hearts.nutrition}/${NUTRITION_PER_WEEK}`), h('div.l', null, 'nutrition hearts')),
        h('div', null, h('div.n.g', null, `${hearts.workouts}/${WORKOUTS_PER_WEEK}`), h('div.l', null, 'workout hearts')),
        h('div', null, h('div.n.s', null, hearts.checkIn ? 'Done' : '—'), h('div.l', null, 'check-in')),
      ),
      h('div.hearts', { style: 'justify-content:center;margin-top:12px;gap:6px' },
        Array.from({ length: NUTRITION_PER_WEEK }, (_, i) => heart(i < hearts.nutrition, 'n')),
        h('span', { style: 'width:10px' }),
        Array.from({ length: WORKOUTS_PER_WEEK }, (_, i) => heart(i < hearts.workouts, 'w')),
      ),
    ),
    h('div.card', null,
      h('div.section-title', null, `Protein, ${band.min} to ${band.max} g a day`),
      dates.map((d) => dayRow(app, d, today, band)),
    ),
    week !== current ? h('button.link', { on: { click: () => { shown = null; app.render(); } } }, 'Back to this week') : null,
    dayNumber(today) > CHALLENGE.days ? h('p.muted', { style: 'text-align:center' }, 'All 75 days are in.') : null,
  );
}

function dayRow(app, iso, today, band) {
  const t = dayTotals(app.meals, iso);
  const worked = app.days.some((d) => d.date === iso && d.workedOut);
  const state = t.protein > band.max ? 'over' : t.protein >= band.min ? 'met' : '';
  const future = iso > today;
  return h(`div.week-day${iso === today ? '.today' : ''}`, { style: future ? 'opacity:.45' : '' },
    h('div.d', null, shortDate(iso).replace(/, \w+ /, ' ')),
    h(`div.bar${state ? '.' + state : ''}`, null,
      h('div.track', null, h('div.fill', { style: `width:${Math.min(100, (t.protein / band.max) * 100)}%` }))),
    h('div.gr', null, t.protein ? gramsText(t.protein) : '', worked ? h('span', { style: 'color:var(--gold);margin-left:6px', title: 'worked out' }, '●') : null),
  );
}
