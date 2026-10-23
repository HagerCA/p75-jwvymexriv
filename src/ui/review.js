// The review card: what Gemini read, portions, add or remove items, Save.
import { h, fill } from './dom.js';
import { mealTotals } from '../tally.js';
import { PORTIONS, portionLabel, gramsText, reasonText, newId } from '../format.js';
import { requestEstimate } from '../estimate.js';
import { newMeal } from './today.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

export async function openReview(app, mealId, { manual = false } = {}) {
  let draft;
  if (mealId) {
    const m = await app.store.getMeal(mealId);
    if (!m) return;
    draft = clone(m);
  } else {
    draft = newMeal(newId(), app.today(), { source: 'manual', status: 'to-confirm' });
  }
  const wasSaved = draft.status === 'saved';
  // A meal still waiting for signal can be added by hand or discarded now.
  if (draft.status === 'waiting') draft.problem = 'offline';
  const photoUrl = draft.photoId ? await app.photoUrl(draft.photoId) : null;
  const s = app.settings;
  let showHand = manual || (draft.problem && draft.items.length === 0);
  let saving = false;

  const body = h('div');
  const sh = app.sheet(body);
  draw();

  function draw() {
    const isLabel = draft.kind === 'label';
    const total = mealTotals(draft).protein;
    fill(body, 
      h('h2', null, isLabel ? 'How many servings?' : wasSaved ? 'Edit this meal' : 'Check your plate'),
      photoUrl ? h('img.photo', { src: photoUrl, alt: '' }) : null,
      draft.text ? h('p.muted', null, `“${draft.text}”`) : null,
      draft.problem && draft.items.length === 0
        ? h('div.problem', null, h('b', null, draft.problem === 'offline' ? 'Not read yet. ' : "Couldn't read this one. "), reasonText(draft.problem), draft.problem === 'offline' ? ' Or add it by hand now.' : '')
        : null,
      isLabel ? servings() : null,
      draft.items.map((it, i) => itemCard(it, i, isLabel)),
      draft.items.length ? h('p', { style: 'text-align:right;margin:4px 2px 14px' }, h('span.muted', null, 'This meal: '), h('b', null, `${gramsText(total)} protein`)) : null,
      addTyped(),
      showHand ? handForm() : h('button.link.muted', { on: { click: () => { showHand = true; draw(); } } }, 'add it by hand'),
      h('div', { style: 'height:8px' }),
      h('button.btn', { disabled: draft.items.length === 0, on: { click: save } }, 'Save'),
      wasSaved || draft.status === 'to-confirm' || draft.status === 'waiting'
        ? h('button.link.muted', { on: { click: removeMeal } }, wasSaved ? 'Remove this meal' : 'Discard')
        : null,
    );
  }

  function servings() {
    const k = draft.items[0]?.multiplier ?? 1;
    return h('div.portions', { style: 'margin:0 0 14px' }, PORTIONS.map((p) =>
      h(`button${k === p ? '.on' : ''}`, { on: { click: () => { draft.items.forEach((i) => { i.multiplier = p; }); draw(); } } }, portionLabel(p))));
  }

  function itemCard(it, i, isLabel) {
    const k = it.multiplier ?? 1;
    const extras = [];
    if (s.fat.on) extras.push(`fat ${gramsText(it.fat * k)}`);
    if (s.fiber.on) extras.push(`fiber ${gramsText(it.fiber * k)}`);
    if (s.calories.on) extras.push(`${Math.round((4 * it.protein + 9 * it.fat + 4 * it.carbs) * k)} cal`);
    return h('div.item', null,
      h('div.head', null,
        h('div.nm', null, it.name, it.confidence === 'low' ? h('span', null, ' ', h('span.pill.gold', null, 'rough guess')) : null,
          it.portion ? h('span.por', null, it.portion) : null),
        h('div.g', null, gramsText(it.protein * k)),
        h('button.x', { 'aria-label': `Remove ${it.name}`, on: { click: () => { draft.items.splice(i, 1); draw(); } } }, '×'),
      ),
      extras.length ? h('div.extra', null, extras.join(' · ')) : null,
      isLabel ? null : h('div.portions', null, PORTIONS.map((p) =>
        h(`button${k === p ? '.on' : ''}`, { on: { click: () => { it.multiplier = p; draw(); } } }, portionLabel(p)))),
    );
  }

  function addTyped() {
    const input = h('input', { type: 'text', placeholder: 'add an item, like "1 cup of rice"', maxLength: 200, enterKeyHint: 'go' });
    const btn = h('button.btn.ghost', { style: 'width:auto;padding:12px 16px;flex:none', on: { click: go } }, 'Add');
    const msg = h('p.small.muted.hidden');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    async function go() {
      const t = input.value.trim();
      if (!t || btn.disabled) return;
      if (!app.relayOn()) {
        showHand = true;
        draw();
        app.toast(reasonText('pass'));
        return;
      }
      btn.disabled = true;
      btn.textContent = '…';
      const r = await requestEstimate({ kind: 'text', text: t, requestId: newId() }, app.relayOpts());
      if (r.ok) {
        draft.items.push(...r.items);
        draw();
      } else {
        btn.disabled = false;
        btn.textContent = 'Add';
        msg.textContent = reasonText(r.reason);
        msg.classList.remove('hidden');
        showHand = true;
        draw();
        app.toast(reasonText(r.reason));
      }
    }
    return h('div', { style: 'margin-bottom:6px' }, h('div.row', null, input, btn), msg);
  }

  function handForm() {
    const name = h('input', { type: 'text', placeholder: 'Greek yogurt', maxLength: 80 });
    const num = (ph) => h('input', { type: 'number', inputMode: 'decimal', min: 0, max: 300, step: 0.1, placeholder: ph });
    const protein = num('g');
    const fat = num('g');
    const fiber = num('g');
    const carbs = num('g');
    const err = h('p.small.hidden', { style: 'color:var(--gold)' });
    function add() {
      const g = (el) => (el.value === '' ? 0 : Number(el.value));
      const vals = [protein, fat, fiber, carbs].map(g);
      if (!name.value.trim() || protein.value === '' || vals.some((v) => !Number.isFinite(v) || v < 0 || v > 300)) {
        err.textContent = 'A name and the protein grams are needed (0 to 300).';
        err.classList.remove('hidden');
        return;
      }
      draft.items.push({ name: name.value.trim(), portion: '', multiplier: 1, protein: vals[0], fat: vals[1], fiber: vals[2], carbs: vals[3], confidence: 'high' });
      draw();
    }
    return h('div.item', null,
      h('div.section-title', null, 'Add it by hand'),
      h('div.stack', null,
        h('label.field', null, 'What it is', name),
        h('div.grid4', null,
          h('label.field', null, 'Protein', protein),
          h('label.field', null, 'Fat', fat),
          h('label.field', null, 'Fiber', fiber),
          h('label.field', null, 'Carbs', carbs),
        ),
        err,
        h('button.btn.ghost', { on: { click: add } }, 'Add this'),
      ),
    );
  }

  async function save() {
    if (saving || draft.items.length === 0) return;
    saving = true;
    draft.status = 'saved';
    delete draft.problem;
    await app.store.putMeal(draft);
    sh.close();
    await app.afterChange();
    if (!wasSaved && draft.source !== 'usual') offerUsual(app, draft);
  }

  async function removeMeal() {
    if (!confirm(wasSaved ? 'Remove this meal from today?' : 'Discard this one?')) return;
    await app.store.putMeal({ ...draft, status: 'removed' });
    sh.close();
    await app.afterChange();
  }
}

function offerUsual(app, meal) {
  const name = h('input', { type: 'text', value: meal.items.map((i) => i.name).join(' + ').slice(0, 40), maxLength: 40 });
  const sh = app.sheet(h('div', null,
    h('h2', null, 'Make this a usual?'),
    h('p.muted', null, 'It becomes a one-tap chip on Today, with the numbers you just saved.'),
    h('label.field', null, 'Call it', name),
    h('div', { style: 'height:12px' }),
    h('button.btn', { on: { click: async (e) => {
      if (!name.value.trim()) return;
      e.currentTarget.disabled = true;
      await app.store.putUsual({ id: newId(), name: name.value.trim(), items: meal.items.map((i) => ({ ...i })) });
      sh.close();
      await app.afterChange();
      app.toast('Saved to your usuals.');
    } } }, 'Save as a usual'),
    h('button.link.muted', { on: { click: () => sh.close() } }, 'Not now'),
  ));
}
