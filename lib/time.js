// Time helpers pinned to the shop's time zone (Alaska), DST-safe, using only the built-in Intl API.

// Beam Book: each shop has its own time zone, so formatters are made per zone and cached.
const tz = () => require("./tenant").currentOrNull()?.studio?.timeZone || "America/Anchorage"; // outside a request (tests): Alaska
const fmts = new Map();
function F(name, opts) {
  const key = `${tz()}|${name}`;
  if (!fmts.has(key)) fmts.set(key, new Intl.DateTimeFormat("en-US", { timeZone: tz(), ...opts }));
  return fmts.get(key);
}
const partsFmt = { formatToParts: (d) => F("parts", { hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }).formatToParts(d) };
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Wall-clock parts in the shop's time zone for a UTC instant (ms).
function parts(ms) {
  const o = {};
  for (const p of partsFmt.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: WD[o.weekday] };
}

// Offset (ms) of the shop's zone from UTC at an instant: local wall clock minus UTC.
function offsetAt(ms) {
  const p = parts(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

// Shop-local wall time → UTC ms. Handles DST changes (the 2 AM spring-forward gap never falls in shop hours).
function toUtc(y, m, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return t;
}

const pad = (n) => String(n).padStart(2, "0");
const dateKey = (ms) => { const p = parts(ms); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3] ? { y: +m[1], m: +m[2], d: +m[3] } : null; // rejects Feb 30 etc.
}
function parseHM(s) { const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s || "")); return m ? { h: +m[1], mi: +m[2] } : null; }
function parseLocal(s) { // "YYYY-MM-DDTHH:MM" in shop time → UTC ms
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(String(s || ""));
  const d = m && parseDate(m[1]);
  return d && +m[2] < 24 && +m[3] < 60 ? toUtc(d.y, d.m, d.d, +m[2], +m[3]) : null;
}
// Add days to a calendar date (no time zone involved).
function addDays({ y, m, d }, n) { const t = new Date(Date.UTC(y, m - 1, d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
const keyOf = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;
const weekdayOf = ({ y, m, d }) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

const lazy = (name, opts) => ({ format: (d) => F(name, opts).format(d), formatToParts: (d) => F(name, opts).formatToParts(d) });
const fTime = lazy("time", { hour: "numeric", minute: "2-digit" });
const fDay = lazy("day", { weekday: "short", month: "short", day: "numeric" });
const fDayLong = lazy("dayLong", { weekday: "long", month: "long", day: "numeric" });
const fZone = lazy("zone", { timeZoneName: "short" });
const zoneName = (ms) => (fZone.formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName") || {}).value || "";

const timeLabel = (ms) => fTime.format(new Date(ms));
const dayLabel = (ms) => fDay.format(new Date(ms));
function rangeLabel(start, end) { return `${fDayLong.format(new Date(start))}, ${timeLabel(start)} to ${timeLabel(end)} ${zoneName(start)}`; }
function localInputValue(ms) { const p = parts(ms); return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`; }

module.exports = { get TZ() { return tz(); }, parts, toUtc, dateKey, parseDate, parseHM, parseLocal, addDays, keyOf, weekdayOf, timeLabel, dayLabel, rangeLabel, zoneName, localInputValue };
