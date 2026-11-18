// Copy a shop over from Squire into Beam (sandbox testing first, then for real).
// What Squire lets us read: the team and their weekly hours, the service catalog, and the calendar (past and booked ahead,
// with client name, barber, services and times). Payment, tips and contact details aren't in that view; the client list
// comes separately from Squire's client export.
// Everything brought in is marked source "squire" so it can be taken back out (clear) without touching anything made in Beam.
// Squire doesn't say WHEN an appointment was booked, so imported visits don't count for or against rebook rates;
// rebook tracking starts with bookings made in Beam.

const config = require("../config/studio");
const store = require("./store");
const cal = require("./calendar");
const T = require("./time");
const artists = require("./artists");
const templates = require("./templates");
const tenant = require("./tenant");
const crypto = require("crypto");

const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// "Beard trim, w/ razor, Standard Haircut" → ["Beard trim, w/ razor", "Standard Haircut"], using the catalog's own names.
function splitServices(raw, names) {
  const parts = String(raw || "").split(", "), out = [];
  for (let i = 0; i < parts.length; i++) {
    let hit = null;
    for (let j = parts.length; j > i; j--) { const cand = parts.slice(i, j).join(", ").trim(); if (names.has(cand.toLowerCase())) { hit = [cand, j]; break; } }
    if (hit) { out.push(hit[0]); i = hit[1] - 1; } else if (parts[i].trim()) out.push(parts[i].trim());
  }
  return out;
}

// data: {team:[{name, hours:{"0".."6": "HH:MM-HH:MM"}, category}], catalog:{category:[[name, price, minutes, visible]]},
//        days:["YYYY-MM-DD"], raw:["service text"], rows:[[dayIdx, startMin, durMin, teamIdx, clientName, rawIdx, isNew]],
//        blocks:[[dayIdx, startMin, durMin, teamIdx]], teamOrder:["name", ...] (teamIdx refers to this)}
async function fromSquire(data, { now = Date.now() } = {}) {
  if (!config.instant) throw new Error("This shop isn't in barbershop (instant booking) mode.");
  const team = (data.team || []).slice(0, 20), order = data.teamOrder || team.map((t) => t.name);

  // 1. Barbers, listed and open, with their Squire weekly hours.
  const have = await artists.list(), slugOf = {};
  for (const t of team) {
    let a = have.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
    const slug = a ? a.slug : await artists.add(t.name);
    slugOf[t.name] = slug;
    const hours = {}; for (let d = 0; d < 7; d++) { const h = t.hours?.[d]; const m = h && /^(\d\d:\d\d)-(\d\d:\d\d)$/.exec(h); hours[d] = m ? { open: m[1], close: m[2] } : null; }
    const working = Object.values(hours).some(Boolean);
    await artists.setListed(slug, working);
    await artists.setOpen(slug, working);
    await cal.saveSettings(slug, { hours, stepMin: 15, bufferMin: 0, leadHours: 1, windowDays: 60 });
  }

  // Anyone on Beam who isn't on the Squire team (a starter or demo barber) comes off the booking page.
  for (const a of await artists.list()) if (!Object.values(slugOf).includes(a.slug)) { await artists.setListed(a.slug, false); await artists.setOpen(a.slug, false); }

  // 2. Services: the visible catalog, each offered by the barbers seen doing it (else the barbers of its category).
  const catalog = [];
  for (const [cat, list] of Object.entries(data.catalog || {})) for (const [name, price, mins, visible] of list) catalog.push({ cat, name: String(name).trim(), price: Number(price) || 0, mins: Number(mins) || 30, visible });
  const names = new Set(catalog.map((c) => c.name.toLowerCase()));
  const seen = {}; // service name (lower) → Set of barber slugs
  for (const r of data.rows || []) for (const s of splitServices(data.raw[r[5]], names)) {
    const k = s.toLowerCase(), who = slugOf[order[r[3]]]; if (who) (seen[k] || (seen[k] = new Set())).add(who);
  }
  const byCat = {}; for (const t of team) for (const c of [].concat(t.category || [])) (byCat[c] || (byCat[c] = [])).push(slugOf[t.name]);
  const services = [], used = new Set();
  // Barbers' own menus first (the owner's category, then the barbers'), the rest after.
  const rank = (c) => { const who = byCat[c.cat] || []; const i = team.findIndex((t) => (byCat[c.cat] || []).includes(slugOf[t.name])); return who.length ? i : 99; };
  catalog.sort((a, b) => rank(a) - rank(b));
  const listedSlugs = new Set(team.filter((t) => Object.values(t.hours || {}).some(Boolean)).map((t) => slugOf[t.name]));
  for (const c of catalog) {
    const k = c.name.toLowerCase();
    if (!c.visible || used.has(k)) continue;
    used.add(k);
    const barbers = seen[k] ? [...seen[k]] : byCat[c.cat] || [];
    if (!barbers.some((b) => listedSlugs.has(b))) continue; // nobody on the booking page offers it
    services.push({ name: c.name, price: c.price, durationMin: Math.max(5, Math.min(600, c.mins)), barbers });
  }
  const clean = templates.cleanServices(services);
  const rec = await tenant.getRecord(config.tenant);
  await tenant.saveRecord({ ...rec, services: clean });
  const priceOf = (s) => { const c = catalog.find((x) => x.name.toLowerCase() === s.toLowerCase() && x.visible) || catalog.find((x) => x.name.toLowerCase() === s.toLowerCase()); return c ? c.price : 0; };

  // 3. Appointments, past and booked ahead. Re-running replaces the earlier import.
  await clearAppts();
  const ops = []; let appts = 0, ahead = 0;
  for (const r of data.rows || []) {
    const [di, startMin, dur, ti, client, ri] = r, slug = slugOf[order[ti]], day = T.parseDate(data.days[di]);
    if (!slug || !day || !(dur > 0)) continue;
    const start = T.toUtc(day.y, day.m, day.d, Math.floor(startMin / 60), startMin % 60);
    const svcs = splitServices(data.raw[ri], names);
    const appt = { id: crypto.randomBytes(6).toString("hex"), artist: slug, requestId: null, start, end: start + dur * 60e3, durationMin: dur,
      clientName: String(client || "").slice(0, 80), title: svcs.join(" + ").slice(0, 120), price: svcs.reduce((a, s) => a + priceOf(s), 0),
      source: "squire", pending: false, createdAt: null, isNewClient: Boolean(r[6]) };
    ops.push({ set: [`cal:appt:${appt.id}`, appt] }, { zadd: [`cal:appts:${slug}`, appt.id, start] });
    appts++; if (start > now) ahead++;
  }
  for (let i = 0; i < ops.length; i += 400) await store.batch(ops.slice(i, i + 400));

  // 4. Blocked time from today on (lunches, time off).
  let blocks = 0;
  for (const [di, startMin, dur, ti] of data.blocks || []) {
    const slug = slugOf[order[ti]], date = data.days[di], d = T.parseDate(date);
    if (!slug || !d || T.toUtc(d.y, d.m, d.d, 23, 59) < now) continue;
    try { await cal.addBlock(slug, { startDate: date, endDate: date, from: hm(startMin), to: hm(Math.min(startMin + dur, 23 * 60 + 59)), note: "From Squire" }); blocks++; } catch {}
  }
  await store.setJSON("import:squire", { at: now, appts, ahead, blocks, services: clean.length, barbers: team.length });
  return { barbers: team.length, services: clean.length, appointments: appts, bookedAhead: ahead, blocks };
}

async function clearAppts() {
  const roster = await artists.list(), ops = [];
  for (const a of roster) for (const x of await cal.apptsBetween(a.slug, 0, Date.now() + 400 * 864e5))
    if (x.source === "squire") ops.push({ del: `cal:appt:${x.id}` }, { zrem: [`cal:appts:${a.slug}`, x.id] });
  for (let i = 0; i < ops.length; i += 400) await store.batch(ops.slice(i, i + 400));
  return ops.length / 2;
}

async function clear() {
  const removed = await clearAppts();
  for (const a of await artists.list()) {
    const keep = (await cal.getBlocks(a.slug)).filter((b) => b.note !== "From Squire");
    await store.setJSON(`cal:blocks:${a.slug}`, keep);
  }
  await store.del("import:squire");
  return { appointments: removed };
}

module.exports = { fromSquire, clear, splitServices };
