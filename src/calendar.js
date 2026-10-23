// The challenge calendar. Pure functions over local calendar dates (YYYY-MM-DD).
// Day arithmetic runs on UTC midnights so no time zone or DST touches the count;
// only todayISO reads the phone's local clock.

export const CHALLENGE = { start: '2026-10-26', days: 75 };

const DAY_MS = 86400000;

function toIndex(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function fromIndex(i) {
  const dt = new Date(i * DAY_MS);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

const START = toIndex(CHALLENGE.start);

export function dayNumber(iso) {
  return toIndex(iso) - START + 1;
}

export function inChallenge(iso) {
  const n = dayNumber(iso);
  return n >= 1 && n <= CHALLENGE.days;
}

export function dateOfDay(n) {
  return fromIndex(START + n - 1);
}

export function weekNumber(iso) {
  if (!inChallenge(iso)) return null;
  return Math.floor((dayNumber(iso) - 1) / 7) + 1;
}

export function weekDates(week) {
  const out = [];
  for (let n = (week - 1) * 7 + 1; n <= Math.min(week * 7, CHALLENGE.days); n++) out.push(dateOfDay(n));
  return out;
}

export function checkInDates() {
  const out = [];
  for (let n = 1; n <= CHALLENGE.days; n += 7) out.push(dateOfDay(n));
  return out;
}

export function isCheckInDay(iso) {
  return inChallenge(iso) && (dayNumber(iso) - 1) % 7 === 0;
}

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
