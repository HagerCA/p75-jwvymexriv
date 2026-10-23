// The estimate contract. Anything Gemini returns passes through here; whatever
// does not fit the shape is "unreadable", never a 0 g meal.

const UNREADABLE = Object.freeze({ ok: false, reason: 'unreadable' });
const CONFIDENCE = new Set(['low', 'medium', 'high']);
const MAX_ITEMS = 20;
const MAX_GRAMS = 300;

function grams(v, { required }) {
  if (v === undefined) return required ? NaN : 0;
  if (typeof v === 'string' && v.trim() !== '') v = Number(v);
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_GRAMS) return NaN;
  return Math.round(v * 10) / 10;
}

export function validateEstimate(raw) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return { ...UNREADABLE }; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...UNREADABLE };
  const { items } = raw;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) return { ...UNREADABLE };

  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') return { ...UNREADABLE };
    const name = typeof it.name === 'string' ? it.name.trim() : '';
    if (!name) return { ...UNREADABLE };
    const protein = grams(it.protein, { required: true });
    const fat = grams(it.fat, { required: false });
    const fiber = grams(it.fiber, { required: false });
    const carbs = grams(it.carbs, { required: false });
    if ([protein, fat, fiber, carbs].some(Number.isNaN)) return { ...UNREADABLE };
    out.push({
      name,
      portion: typeof it.portion === 'string' ? it.portion : '',
      multiplier: 1,
      protein,
      fat,
      fiber,
      carbs,
      confidence: CONFIDENCE.has(it.confidence) ? it.confidence : 'low',
    });
  }
  return { ok: true, kind: raw.kind === 'label' ? 'label' : 'plate', items: out };
}
