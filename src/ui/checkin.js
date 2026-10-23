// The Monday check-in. Stays on Today until done, so late is never missed.
// Body photos, weight and reflections stay on the phone and her Drive only.
import { h, fill } from './dom.js';
import { weekHearts, NUTRITION_PER_WEEK, WORKOUTS_PER_WEEK } from '../tally.js';
import { isCheckInDay } from '../calendar.js';
import { shrinkPhoto } from '../estimate.js';

const SIDES = ['front', 'side', 'back'];

export function checkInCard(app, week) {
  const late = !isCheckInDay(app.today());
  return h('div.card.accent', null,
    h('div.section-title', null, week === 1 ? 'Day 1 · your baseline' : `Week ${week} check-in`),
    h('h3', null, week === 1 ? 'Photos and weight, the starting line.' : 'Your Monday check-in'),
    late ? h('p.small.muted', { style: 'margin-top:6px' }, "Any day this week counts. It's still this week's.") : null,
    h('div', { style: 'height:12px' }),
    h('button.btn', { on: { click: () => openCheckIn(app, week) } }, 'Start check-in'),
  );
}

export async function openCheckIn(app, week) {
  const prev = week > 1 ? weekHearts(app.meals, app.days, app.checkIns, week - 1) : null;
  const existing = app.checkIns.find((c) => c.week === week);
  const photos = {};          // side -> Blob (new this session)
  const urls = {};
  for (const side of SIDES) {
    const id = `week-${week}-${side}`;
    if (existing?.photoIds?.includes(id)) urls[side] = await app.photoUrl(id);
  }
  let tracked = existing?.tracked ?? (prev ? prev.nutrition : 0);
  let moved = existing?.moved ?? (prev ? prev.workouts : 0);
  let saving = false;

  const weight = h('input', { type: 'number', inputMode: 'decimal', step: 0.1, min: 50, max: 400, placeholder: 'lb', value: existing?.weight ?? '' });
  const wins = h('textarea', { placeholder: 'What went well, what you noticed in your body, your energy, your clothes', value: existing?.wins || '' });
  const realign = h('textarea', { placeholder: 'One or two things for next week', value: existing?.realign || '' });
  const err = h('p.small.hidden', { style: 'color:var(--gold)' });

  const slots = h('div.photo-slots');
  const counts = h('div');
  const body = h('div', null,
    h('h2', null, week === 0 ? 'Practice check-in' : week === 1 ? 'Day 1 baseline' : `Week ${week} check-in`),

    h('div.section-title', null, '1 · Body photos'),
    h('p.small.muted', null, 'Same spot, same light as last week. One is fine, three is the full set. Only you and your Drive ever see these.'),
    slots,
    h('div', { style: 'height:16px' }),

    h('div.section-title', null, '2 · Weight'),
    h('label.field', null, 'This morning, in pounds', weight),
    h('div', { style: 'height:16px' }),

    h('div.section-title', null, '3 · The week'),
    counts,
    h('div', { style: 'height:16px' }),

    h('div.section-title', null, '4 · Reflect'),
    h('div.stack', null,
      h('label.field', null, 'Wins and what I noticed', wins),
      h('label.field', null, 'Realign for next week', realign),
    ),
    err,
    h('div', { style: 'height:14px' }),
    h('button.btn', { on: { click: save } }, 'Save check-in'),
  );
  const sh = app.sheet(body, { onClose: () => { for (const side of SIDES) if (photos[side]) URL.revokeObjectURL(urls[side]); } });
  drawSlots();
  drawCounts();

  function drawSlots() {
    fill(slots, ...SIDES.map((side) => {
      const input = h('input', { type: 'file', accept: 'image/*', 'aria-label': `${side} photo` });
      input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        try {
          photos[side] = await shrinkPhoto(f, 1600);
          urls[side] = URL.createObjectURL(photos[side]);
          drawSlots();
        } catch {
          app.toast("That photo didn't open. Try another?");
        }
      });
      return h(`label.slot${urls[side] ? '.filled' : ''}`, { style: urls[side] ? `background-image:url("${urls[side]}")` : '' },
        input, h('span', null, side));
    }));
  }

  function stepper(value, max, onChange) {
    return h('div.row', { style: 'flex:none;gap:6px' },
      h('button.chip', { 'aria-label': 'less', on: { click: () => onChange(Math.max(0, value - 1)) } }, '−'),
      h('b', { style: 'min-width:22px;text-align:center;font-family:var(--head);font-size:20px' }, String(value)),
      h('button.chip', { 'aria-label': 'more', on: { click: () => onChange(Math.min(max, value + 1)) } }, '+'),
    );
  }

  function drawCounts() {
    if (week <= 1) {
      fill(counts, h('p.muted', null, week === 1
        ? 'Nothing to count yet. This is the starting line.'
        : 'In a real week this shows how many days you tracked and moved, ready for you to confirm.'));
      return;
    }
    fill(counts, 
      h('p', null, `Last week you tracked ${tracked} and moved ${moved}. Change either if that's not right.`),
      h('div.stack', null,
        h('div.row', null, h('span', null, `Days tracked (of ${NUTRITION_PER_WEEK})`), stepper(tracked, NUTRITION_PER_WEEK, (v) => { tracked = v; drawCounts(); })),
        h('div.row', null, h('span', null, `Workouts (of ${WORKOUTS_PER_WEEK})`), stepper(moved, WORKOUTS_PER_WEEK, (v) => { moved = v; drawCounts(); })),
        h('p.small.muted', null, 'Did you check in? Yes. You are doing it now.'),
      ),
    );
  }

  async function save(e) {
    if (saving) return;
    const w = weight.value === '' ? null : Number(weight.value);
    if (w !== null && (!Number.isFinite(w) || w < 50 || w > 400)) {
      err.textContent = 'That weight looks off. Pounds, like 120.5.';
      err.classList.remove('hidden');
      return;
    }
    saving = true;
    e.currentTarget.disabled = true;
    const photoIds = new Set(existing?.photoIds || []);
    for (const side of SIDES) {
      if (!photos[side]) continue;
      const id = `week-${week}-${side}`;
      await app.store.putPhoto(id, photos[side]);
      app.forgetPhotoUrl(id);
      photoIds.add(id);
    }
    await app.store.putCheckIn({
      week,
      date: existing?.date || app.today(),
      photoIds: SIDES.map((s) => `week-${week}-${s}`).filter((id) => photoIds.has(id)),
      weight: w,
      tracked: week > 1 ? tracked : 0,
      moved: week > 1 ? moved : 0,
      checkedIn: true,
      wins: wins.value.trim(),
      realign: realign.value.trim(),
    });
    sh.close();
    await app.afterChange();
    app.toast(week === 0 ? 'Practice check-in saved.' : 'Check-in saved.');
  }
}
