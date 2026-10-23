// Words and numbers as she reads them.
import { CHALLENGE, dayNumber, weekNumber, inChallenge } from './calendar.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, wd };
}

export function shortDate(iso) {
  const p = parts(iso);
  return `${DAYS[p.wd]}, ${MONTHS[p.m - 1]} ${p.d}`;
}

export function headerText(todayIso) {
  if (inChallenge(todayIso)) return `Day ${dayNumber(todayIso)} of ${CHALLENGE.days} · Week ${weekNumber(todayIso)}`;
  if (dayNumber(todayIso) < 1) {
    const p = parts(CHALLENGE.start);
    return `Starts ${DAYS_LONG[p.wd]}, ${MONTHS[p.m - 1]} ${p.d}`;
  }
  return `${CHALLENGE.days} days done`;
}

const num = (n) => String(Math.round(n * 10) / 10);

export const gramsText = (g) => `${num(g)} g`;

export function ringText(ps) {
  if (ps.state === 'met') return 'Goal met';
  if (ps.state === 'over') return `+${num(ps.over)} g over`;
  return `${num(ps.toGo)} g to go`;
}

export function time12(date = new Date()) {
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

export const PORTIONS = [0.5, 1, 1.5, 2];

export function portionLabel(k) {
  const whole = Math.floor(k);
  const half = k - whole === 0.5;
  if (!half) return String(k);
  return whole === 0 ? '½' : `${whole}½`;
}

const REASONS = {
  offline: "No signal, it's saved and will be read when you're back online.",
  cap: 'The daily limit is reached, add it by hand for now.',
  pass: 'Meal reading is not switched on yet, add it by hand.',
};

export function reasonText(reason) {
  return REASONS[reason] || 'Something went wrong reading it, add it by hand.';
}

let idSeq = 0;
export function newId() {
  idSeq = (idSeq + 1) % 1296;
  return Date.now().toString(36) + idSeq.toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, '');
}
