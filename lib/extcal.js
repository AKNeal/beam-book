// Outside calendars (iPhone/iCloud, Google, Outlook or any app with an iCal / .ics link).
// Every event on a connected calendar counts as busy time for that artist, so clients are only offered times that are
// really free. Calendars are re-read every 10 minutes when someone looks at open times (or on "Sync now").
// Event titles stay in the inbox; clients never see them.

const crypto = require("crypto");
const store = require("./store");
const T = require("./time");

const REFRESH_MS = 10 * 60e3;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SOURCES = 5;
const DAY = 864e5;
const OWN_FEED = /@(?:[a-z0-9-]+\.)?beambook$|@blackwolftattooclub\.com$/i; // our own booking feed, if it's been added to the same calendar app

const srcKey = (slug) => `cal:sources:${slug}`;
const busyKey = (slug, id) => `cal:busy:${slug}:${id}`;

async function sources(slug) { return (await store.getJSON(srcKey(slug))) || []; }
async function saveSources(slug, list) { await store.setJSON(srcKey(slug), list); }

// Only public https addresses (webcal:// is the same thing). No local or private-network addresses.
function cleanUrl(raw) {
  let u = String(raw || "").trim();
  if (/^webcals?:\/\//i.test(u)) u = u.replace(/^webcals?:/i, "https:");
  let url;
  try { url = new URL(u); } catch { throw new Error("That doesn't look like a calendar link. It should start with https:// or webcal://"); }
  // Automated tests serve a calendar from this machine; that's never allowed on the live site.
  if (process.env.EXTCAL_TEST_LOCAL === "1" && !process.env.VERCEL && url.protocol === "http:" && url.hostname === "127.0.0.1") return url.toString();
  if (url.protocol !== "https:") throw new Error("Use the https:// or webcal:// link for the calendar.");
  const h = url.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^[\d.]+$/.test(h) || h.includes(":") || !h.includes("."))
    throw new Error("That calendar address isn't reachable from the website.");
  if (u.length > 2000) throw new Error("That link is too long.");
  return url.toString();
}

async function download(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { Accept: "text/calendar, */*", "User-Agent": "BlackWolfBooking/1.0" } });
    if (r.status === 401 || r.status === 403 || r.status === 404) throw new Error("The calendar app refused the link. It may be private or turned off; make a new share link.");
    if (!r.ok) throw new Error(`The calendar didn't load (error ${r.status}).`);
    cleanUrl(r.url || url); // a redirect must also land on a public https address
    if (Number(r.headers.get("content-length") || 0) > MAX_BYTES) throw new Error("That calendar is too big to read.");
    const text = await r.text();
    if (text.length > MAX_BYTES) throw new Error("That calendar is too big to read.");
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That link isn't a calendar feed. Look for the iCal, .ics or subscribe link.");
    return text;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("The calendar took too long to answer.");
    throw e;
  } finally { clearTimeout(timer); }
}

// All-day events come back as midnight in the server's own time zone; rebuild them as whole days in Alaska time.
function shopDay(d) { return T.toUtc(d.getFullYear(), d.getMonth() + 1, d.getDate()); }

// Busy intervals from an .ics text, between `from` and `to`.
function busyFromIcs(text, { from, to, allDay = true }) {
  const ical = require("node-ical");
  const data = ical.sync.parseICS(text);
  const out = [];
  for (const e of Object.values(data)) {
    if (!e || e.type !== "VEVENT") continue;
    if (String(e.transparency || "").toUpperCase() === "TRANSPARENT") continue; // marked "free"
    if (String(e.status || "").toUpperCase() === "CANCELLED") continue;
    if (e.uid && OWN_FEED.test(String(e.uid))) continue;
    const title = String(e.summary?.val ?? e.summary ?? "").trim().slice(0, 80);
    const fullDay = e.datetype === "date" || Boolean(e.start?.dateOnly);
    if (fullDay && !allDay) continue;
    let items;
    if (e.rrule) {
      try { items = ical.expandRecurringEvent(e, { from: new Date(from), to: new Date(to), expandOngoing: true }); }
      catch { items = [{ start: e.start, end: e.end, isFullDay: fullDay }]; }
    } else items = [{ start: e.start, end: e.end, isFullDay: fullDay }];
    for (const it of items) {
      if (!it.start) continue;
      const s0 = new Date(it.start), e0 = it.end ? new Date(it.end) : null;
      let start, end;
      if (it.isFullDay ?? fullDay) {
        start = shopDay(s0);
        end = e0 && e0 > s0 ? shopDay(e0) : start + DAY;
        if (end <= start) end = start + DAY;
      } else {
        start = s0.getTime();
        end = e0 ? e0.getTime() : start + 60 * 60e3; // no end time: assume an hour
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= from || start >= to) continue;
      out.push({ start, end, title, allDay: Boolean(it.isFullDay ?? fullDay) });
    }
  }
  return out.sort((a, b) => a.start - b.start).slice(0, 5000);
}

// Re-read one calendar now. Keeps the last good copy if the calendar can't be reached.
async function syncSource(slug, src) {
  const now = Date.now();
  const prev = (await store.getJSON(busyKey(slug, src.id))) || {};
  try {
    const text = await download(src.url);
    const busy = busyFromIcs(text, { from: now - DAY, to: now + 400 * DAY, allDay: src.allDay !== false });
    const rec = { fetchedAt: now, busy, error: "" };
    await store.setJSON(busyKey(slug, src.id), rec);
    return rec;
  } catch (e) {
    const rec = { ...prev, fetchedAt: now, error: e.message || "Couldn't read the calendar." };
    await store.setJSON(busyKey(slug, src.id), rec);
    return rec;
  }
}

// Busy time from every calendar connected for an artist, re-reading any that are more than 10 minutes old.
async function busyFor(slug, { refresh = true } = {}) {
  const list = await sources(slug);
  const recs = await Promise.all(list.map(async (src) => {
    let rec = await store.getJSON(busyKey(slug, src.id));
    if (refresh && (!rec || Date.now() - (rec.fetchedAt || 0) > REFRESH_MS)) rec = await syncSource(slug, src);
    return (rec?.busy || []).map((b) => ({ ...b, source: src.name }));
  }));
  return recs.flat();
}

// Busy time shaped like appointments, so the shop's gap between sessions applies around them too.
async function busyAsAppts(slug, opts) {
  return (await busyFor(slug, opts)).map((b, i) => ({
    id: `ext-${i}-${b.start}`, external: true, start: b.start, end: b.end,
    clientName: b.title || "an event on your calendar", title: b.title, source: b.source, allDay: b.allDay,
  }));
}

async function addSource(slug, { name, url, allDay }) {
  const list = await sources(slug);
  if (list.length >= MAX_SOURCES) throw new Error(`Up to ${MAX_SOURCES} calendars per artist.`);
  const clean = cleanUrl(url);
  if (list.some((s) => s.url === clean)) throw new Error("That calendar is already connected.");
  const src = { id: crypto.randomBytes(5).toString("hex"), name: String(name || "").trim().slice(0, 60) || "My calendar",
    url: clean, allDay: allDay !== false, addedAt: Date.now() };
  // Read it once before saving, so a bad link is caught right away.
  const text = await download(clean);
  const busy = busyFromIcs(text, { from: Date.now() - DAY, to: Date.now() + 400 * DAY, allDay: src.allDay });
  list.push(src);
  await saveSources(slug, list);
  await store.setJSON(busyKey(slug, src.id), { fetchedAt: Date.now(), busy, error: "" });
  return src;
}
async function removeSource(slug, id) {
  await saveSources(slug, (await sources(slug)).filter((s) => s.id !== id));
  await store.setJSON(busyKey(slug, id), null);
}
async function syncAll(slug) { for (const s of await sources(slug)) await syncSource(slug, s); }

// What the inbox shows: each calendar (link hidden except its host), when it was read, any problem, and upcoming events.
async function summary(slug) {
  const list = await sources(slug);
  return Promise.all(list.map(async (s) => {
    const rec = (await store.getJSON(busyKey(slug, s.id))) || {};
    const upcoming = (rec.busy || []).filter((b) => b.end > Date.now());
    return { id: s.id, name: s.name, host: new URL(s.url).hostname, allDay: s.allDay !== false,
      fetchedAt: rec.fetchedAt || null, error: rec.error || "", count: upcoming.length };
  }));
}

module.exports = { sources, addSource, removeSource, syncSource, syncAll, busyFor, busyAsAppts, busyFromIcs, cleanUrl, summary, REFRESH_MS };
