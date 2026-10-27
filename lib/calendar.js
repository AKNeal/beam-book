// Booking calendar: weekly hours, blocked time, appointments, open slots, and iCalendar (.ics) output.
// All times are stored as UTC milliseconds; everything shown to people is in the shop's time zone.

const crypto = require("crypto");
const config = require("../config/studio");
const store = require("./store");
const T = require("./time");

const DAY = 24 * 3600e3;
const MAX_SESSION_MIN = 12 * 60;

// ---------- Settings ----------
function cleanHours(h) {
  const out = {};
  for (let wd = 0; wd < 7; wd++) {
    const v = h && h[wd];
    const o = v && T.parseHM(v.open), c = v && T.parseHM(v.close);
    out[wd] = o && c && (c.h * 60 + c.mi) > (o.h * 60 + o.mi) ? { open: v.open.padStart(5, "0"), close: v.close.padStart(5, "0") } : null;
  }
  return out;
}
const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

function normalizeSettings(s = {}) {
  const d = config.calendarDefaults;
  return {
    hours: cleanHours(s.hours || d.hours),
    stepMin: [15, 30, 60].includes(Number(s.stepMin)) ? Number(s.stepMin) : d.stepMin,
    bufferMin: clampInt(s.bufferMin ?? d.bufferMin, 0, 240, d.bufferMin),
    leadHours: clampInt(s.leadHours ?? d.leadHours, 0, 24 * 30, d.leadHours),
    windowDays: clampInt(s.windowDays ?? d.windowDays, 7, 366, d.windowDays),
  };
}
async function getSettings(slug) { return normalizeSettings((await store.getJSON(`cal:settings:${slug}`)) || {}); }
async function saveSettings(slug, s) { const n = normalizeSettings(s); await store.setJSON(`cal:settings:${slug}`, n); return n; }

// ---------- Blocked time (days off, travel, guest spots, conventions) ----------
async function getBlocks(slug) { return (await store.getJSON(`cal:blocks:${slug}`)) || []; }
async function addBlock(slug, { startDate, endDate, from, to, note }) {
  const s = T.parseDate(startDate), e = T.parseDate(endDate || startDate);
  if (!s || !e) throw new Error("Pick a start and end date.");
  const fromT = from ? T.parseHM(from) : null, toT = to ? T.parseHM(to) : null;
  if ((from && !fromT) || (to && !toT)) throw new Error("Times look wrong.");
  const start = fromT ? T.toUtc(s.y, s.m, s.d, fromT.h, fromT.mi) : T.toUtc(s.y, s.m, s.d);
  const endDay = T.addDays(e, 1);
  const end = toT ? T.toUtc(e.y, e.m, e.d, toT.h, toT.mi) : T.toUtc(endDay.y, endDay.m, endDay.d);
  if (end <= start) throw new Error("The end has to be after the start.");
  if (end - start > 366 * DAY) throw new Error("Block a year or less at a time.");
  const blocks = await getBlocks(slug);
  const b = { id: crypto.randomBytes(5).toString("hex"), start, end, allDay: !fromT && !toT, note: String(note || "").trim().slice(0, 120) };
  blocks.push(b);
  // Keep the list tidy: drop blocks that ended more than a week ago.
  const keep = blocks.filter((x) => x.end > Date.now() - 7 * DAY).sort((a, z) => a.start - z.start);
  await store.setJSON(`cal:blocks:${slug}`, keep);
  return keep;
}
async function removeBlock(slug, id) {
  const keep = (await getBlocks(slug)).filter((b) => b.id !== id);
  await store.setJSON(`cal:blocks:${slug}`, keep);
  return keep;
}

// ---------- Appointments ----------
async function apptsBetween(slug, from, to) {
  // Appointments are indexed by start time; look back far enough to catch ones that started earlier but overlap.
  const ids = await store.indexRangeByScore(`cal:appts:${slug}`, from - MAX_SESSION_MIN * 60e3, to);
  const list = (await Promise.all(ids.map((id) => store.getJSON(`cal:appt:${id}`)))).filter(Boolean);
  return list.filter((a) => a.end > from && a.start < to).sort((a, z) => a.start - z.start);
}

const overlaps = (s1, e1, s2, e2) => s1 < e2 && s2 < e1;

// Why a time can't be booked, or null if it's free. (Shop-side checks ignore working hours and lead time.)
function conflictFor({ start, end, settings, blocks, appts, ignoreApptId, strict = true, now = Date.now() }) {
  const buf = settings.bufferMin * 60e3;
  for (const a of appts) {
    if (a.id === ignoreApptId) continue;
    if (overlaps(start, end, a.start - buf, a.end + buf)) return { reason: "appointment", with: a };
  }
  for (const b of blocks) if (overlaps(start, end, b.start, b.end)) return { reason: "blocked", with: b };
  if (!strict) return null;
  if (start < now + settings.leadHours * 3600e3) return { reason: "too-soon" };
  if (start > now + settings.windowDays * DAY) return { reason: "too-far" };
  const p = T.parts(start), hours = settings.hours[p.wd];
  if (!hours) return { reason: "closed" };
  const o = T.parseHM(hours.open), c = T.parseHM(hours.close);
  const open = T.toUtc(p.y, p.m, p.d, o.h, o.mi), close = T.toUtc(p.y, p.m, p.d, c.h, c.mi);
  if (start < open || end > close) return { reason: "outside-hours" };
  return null;
}

// Open start times for a session of `durationMin`, grouped by day.
async function openSlots(slug, durationMin, now = Date.now()) {
  const settings = await getSettings(slug);
  const blocks = await getBlocks(slug);
  const dur = durationMin * 60e3;
  const horizonEnd = now + (settings.windowDays + 1) * DAY;
  // The site's own bookings plus everything on the artist's connected outside calendars.
  const appts = [...await apptsBetween(slug, now - DAY, horizonEnd), ...await require("./extcal").busyAsAppts(slug)];
  const first = T.parseDate(T.dateKey(now));
  const days = [];
  for (let i = 0; i <= settings.windowDays; i++) {
    const day = T.addDays(first, i);
    const hours = settings.hours[T.weekdayOf(day)];
    if (!hours) continue;
    const o = T.parseHM(hours.open), c = T.parseHM(hours.close);
    const open = T.toUtc(day.y, day.m, day.d, o.h, o.mi), close = T.toUtc(day.y, day.m, day.d, c.h, c.mi);
    const slots = [];
    for (let t = open; t + dur <= close; t += settings.stepMin * 60e3) {
      if (!conflictFor({ start: t, end: t + dur, settings, blocks, appts, now })) slots.push({ start: t, label: T.timeLabel(t) });
    }
    if (slots.length) days.push({ date: T.keyOf(day), label: T.dayLabel(open), slots });
  }
  return { days, timeZone: T.zoneName(now), settings };
}

// pending = a time the client asked for: it's held (nobody else can take it) until the artist confirms or turns it down.
async function createAppt({ slug, start, durationMin, requestId, clientName, title, source, pending = false }) {
  const appt = {
    id: crypto.randomBytes(6).toString("hex"), artist: slug, requestId: requestId || null,
    start, end: start + durationMin * 60e3, durationMin, clientName: clientName || "", title: title || "",
    source: source || "shop", pending: Boolean(pending), createdAt: Date.now(),
  };
  await store.setJSON(`cal:appt:${appt.id}`, appt);
  await store.indexAdd(`cal:appts:${slug}`, appt.id, appt.start);
  return appt;
}
async function cancelAppt(slug, id) {
  if (!id) return;
  await store.indexRemove(`cal:appts:${slug}`, id);
  await store.del(`cal:appt:${id}`);
}
const getAppt = (id) => (id ? store.getJSON(`cal:appt:${id}`) : null);
async function confirmAppt(id) {
  const a = await getAppt(id);
  if (!a) return null;
  a.pending = false; a.confirmedAt = Date.now();
  await store.setJSON(`cal:appt:${id}`, a);
  return a;
}

// ---------- iPhone / Google / Outlook subscription feed ----------
// Private calendar-feed keys: one for the whole shop, and one per artist (artists only see their own bookings).
const feedKey = (slug) => (slug ? `cal:feed:${slug}` : "cal:feed");
async function feedToken(create = true, slug = null) {
  let t = await store.getJSON(feedKey(slug));
  if (!t && create) { t = crypto.randomBytes(18).toString("base64url"); await store.setJSON(feedKey(slug), t); }
  return t;
}
async function resetFeedToken(slug = null) { const t = crypto.randomBytes(18).toString("base64url"); await store.setJSON(feedKey(slug), t); return t; }

// iCalendar text helpers (RFC 5545): escape, fold long lines, UTC timestamps.
const icsEscape = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([;,])/g, "\\$1");
const icsTime = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out = []; let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}
function icsCalendar(name, events) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Beam Book//Bookings//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(name)}`, `X-WR-TIMEZONE:${T.TZ}`, "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M"];
  const stamp = icsTime(Date.now());
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`, `DTSTART:${icsTime(e.start)}`, `DTEND:${icsTime(e.end)}`,
      `SUMMARY:${icsEscape(e.summary)}`);
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

module.exports = {
  normalizeSettings, getSettings, saveSettings, getBlocks, addBlock, removeBlock,
  apptsBetween, conflictFor, openSlots, createAppt, cancelAppt, getAppt, confirmAppt,
  feedToken, resetFeedToken, icsCalendar, MAX_SESSION_MIN, DAY,
};
