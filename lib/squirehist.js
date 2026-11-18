// Squire appointment history (from Squire's Appointments CSV export), so a shop's dashboard has its past from day one.
// The owner picks the CSV files in the inbox; the browser reads them and sends only these fields per row:
//   staff, date (M/D/YYYY), time ("1:30 pm"), cdate/ctime (when it was booked), pay, tip, cost, status, client, service, dur.
// Emails, phones and every other column stay on the owner's computer.
//
// Stored per month (`sq:hist:YYYY-MM`), keyed "<barber slug>|<start ms>". It adds to the calendar import (lib/importer.js):
//   - when the visit was booked, so Squire visits count toward rebook rates;
//   - how it was paid (cash or card) and the tip, for the payment mix and tips;
//   - no-shows and cancellations, for the no-show rate;
//   - finished visits older than the calendar import, as history.
// Re-uploading the same dates replaces those entries. clear() removes all of it.

const store = require("./store");
const artists = require("./artists");
const T = require("./time");

const DAY = 864e5;
const STATUS = { completed: "done", complete: "done", upcoming: "booked", booked: "booked", confirmed: "booked",
  cancelled: "cancelled", canceled: "cancelled", "no-show": "noshow", noshow: "noshow", "no show": "noshow" };
const monthKey = (ms) => T.dateKey(ms).slice(0, 7);

function when(date, time) {
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(date || "").trim());
  if (!d) return null;
  let h = 0, mi = 0;
  const t = /^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i.exec(String(time || "").trim());
  if (t) { h = (+t[1]) % 12 + (t[3].toLowerCase() === "p" ? 12 : 0); mi = +t[2]; }
  return T.toUtc(+d[3], +d[1], +d[2], h, mi);
}
const money = (v) => { const n = parseFloat(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; };
const method = (p) => { p = String(p || "").toLowerCase(); return !p ? null : p.includes("cash") ? "cash" : /card|squire|pos|credit|debit|apple|google|tap/.test(p) ? "card" : null; };

async function importRows(rows) {
  const roster = await artists.list();
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
  const slugFor = (name) => {
    const n = norm(name), first = norm(String(name || "").split(/\s+/)[0]);
    const hit = roster.find((a) => norm(a.name) === n) || roster.find((a) => norm(a.name).startsWith(first) && first.length >= 3);
    return hit ? hit.slug : null;
  };
  const months = new Map(), skipped = new Set(); let used = 0;
  for (const r of (Array.isArray(rows) ? rows : []).slice(0, 20000)) {
    const slug = slugFor(r?.staff), start = when(r?.date, r?.time);
    if (!slug) { if (r?.staff) skipped.add(String(r.staff).slice(0, 40)); continue; }
    if (!start) continue;
    const e = { c: when(r.cdate, r.ctime), m: method(r.pay), t: money(r.tip) || 0, p: money(r.cost), s: STATUS[String(r.status || "").toLowerCase().trim()] || "booked",
      cn: String(r.client || "").replace(/\s+/g, " ").trim().slice(0, 80), sv: String(r.service || "").replace(/\s+/g, " ").trim().slice(0, 120),
      d: Math.max(5, Math.min(600, parseInt(r.dur, 10) || 30)) };
    const mk = monthKey(start);
    if (!months.has(mk)) months.set(mk, {});
    months.get(mk)[`${slug}|${start}`] = e; used++;
  }
  for (const [mk, entries] of months) {
    const cur = (await store.getJSON(`sq:hist:${mk}`)) || {};
    await store.setJSON(`sq:hist:${mk}`, { ...cur, ...entries });
  }
  const list = new Set([...((await store.getJSON("sq:hist:months")) || []), ...months.keys()]);
  await store.setJSON("sq:hist:months", [...list].sort());
  const ms = [...list].sort();
  return { rows: used, months: months.size, from: ms[0] || null, to: ms[ms.length - 1] || null, unknownBarbers: [...skipped].slice(0, 10) };
}

// Every entry with a start in [from, to): Map "<slug>|<start>" → entry.
async function load(from, to) {
  const have = new Set((await store.getJSON("sq:hist:months")) || []), out = new Map();
  if (!have.size) return out;
  const wanted = []; for (let d = from - 31 * DAY; d < to + 31 * DAY; d += 28 * DAY) wanted.push(monthKey(d));
  wanted.push(monthKey(to));
  const keys = [...new Set(wanted)].filter((k) => have.has(k));
  const docs = await store.getMany(keys.map((k) => `sq:hist:${k}`));
  for (const doc of docs) for (const [k, e] of Object.entries(doc || {})) { const start = Number(k.split("|")[1]); if (start >= from && start < to) out.set(k, e); }
  return out;
}

async function status() { const m = (await store.getJSON("sq:hist:months")) || []; return { months: m.length, from: m[0] || null, to: m[m.length - 1] || null }; }
async function clear() { const m = (await store.getJSON("sq:hist:months")) || []; for (const k of m) await store.del(`sq:hist:${k}`); await store.del("sq:hist:months"); return { months: m.length }; }

module.exports = { importRows, load, status, clear, when, method };
