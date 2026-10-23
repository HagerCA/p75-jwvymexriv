// Totals and hearts. Pure functions over the stored records.
import { weekNumber, weekDates, CHALLENGE } from './calendar.js';

export const NUTRITION_PER_WEEK = 5;
export const WORKOUTS_PER_WEEK = 3;
export const WEEKS = Math.ceil(CHALLENGE.days / 7);

const r1 = (n) => Math.round(n * 10) / 10;

const isSaved = (meal) => meal.status === 'saved';

export function mealTotals(meal) {
  const t = { protein: 0, fat: 0, fiber: 0, carbs: 0 };
  for (const it of meal.items || []) {
    const k = it.multiplier ?? 1;
    t.protein += (it.protein || 0) * k;
    t.fat += (it.fat || 0) * k;
    t.fiber += (it.fiber || 0) * k;
    t.carbs += (it.carbs || 0) * k;
  }
  return t;
}

export function dayTotals(meals, iso) {
  const t = { protein: 0, fat: 0, fiber: 0, carbs: 0 };
  for (const meal of meals) {
    if (meal.date !== iso || !isSaved(meal)) continue;
    const mt = mealTotals(meal);
    for (const k of Object.keys(t)) t[k] += mt[k];
  }
  const out = { protein: r1(t.protein), fat: r1(t.fat), fiber: r1(t.fiber), carbs: r1(t.carbs) };
  out.calories = Math.round(4 * t.protein + 9 * t.fat + 4 * t.carbs);
  return out;
}

export function proteinState(protein, band = { min: 100, max: 105 }) {
  if (protein < band.min) return { state: 'under', toGo: r1(band.min - protein), over: 0 };
  if (protein > band.max) return { state: 'over', toGo: 0, over: r1(protein - band.max) };
  return { state: 'met', toGo: 0, over: 0 };
}

export function weekHearts(meals, days, checkIns, week) {
  const dates = new Set(weekDates(week));
  const fed = new Set(meals.filter((m) => isSaved(m) && dates.has(m.date)).map((m) => m.date));
  const moved = new Set(days.filter((d) => d.workedOut && dates.has(d.date)).map((d) => d.date));
  return {
    nutrition: Math.min(fed.size, NUTRITION_PER_WEEK),
    workouts: Math.min(moved.size, WORKOUTS_PER_WEEK),
    checkIn: checkIns.some((c) => c.week === week),
  };
}

export function totalHearts(meals, days, checkIns) {
  const out = { nutrition: 0, workouts: 0, checkIns: 0 };
  for (let w = 1; w <= WEEKS; w++) {
    const h = weekHearts(meals, days, checkIns, w);
    out.nutrition += h.nutrition;
    out.workouts += h.workouts;
    out.checkIns += h.checkIn ? 1 : 0;
  }
  return out;
}

export function pendingCheckIn(todayIso, checkIns) {
  const w = weekNumber(todayIso);
  if (w === null) return null;
  return checkIns.some((c) => c.week === w) ? null : w;
}
