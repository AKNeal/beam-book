// Demo data for showing Beam Book to a prospective shop (control page only).
// Made-up barbers, clients and bookings. Nothing here sends an email or a text, and every record is marked demo,
// so "Remove demo data" takes it all away before the shop's real barbers and clients go in.
// Phone numbers use the 555-01xx range, which is reserved for fiction; emails use example.com.

const config = require("../config/studio");
const store = require("./store");
const cal = require("./calendar");
const T = require("./time");
const artists = require("./artists");
const clients = require("./clients");
const { id } = require("./http");

const DEFAULT_BARBERS = ["Marcus Reed", "Tony Vega", "Dre Collins"];
const FIRST = ["Tyler", "Andre", "Luis", "Kevin", "Chris", "Noah", "Eli", "Mateo", "Sam", "Ray", "Ivan", "Jordan", "Isaiah", "Caleb", "Owen", "Miles", "Jalen", "Diego", "Aaron", "Brandon"];
const LAST = ["Hall", "Nguyen", "Brooks", "Ward", "Reyes", "Diaz", "Foster", "Cole", "Price", "Young", "Carter", "Lopez", "James", "Bennett", "Hayes", "Ortiz"];
const NOTES = ["#2 on the sides, scissors on top", "Low taper, keep the length", "Skin fade, beard lined up", "#1 all over", "Mid fade, part on the left", ""];
const HOURS = { 0: null, 1: null, 2: { open: "09:00", close: "18:00" }, 3: { open: "09:00", close: "18:00" }, 4: { open: "09:00", close: "18:00" },
  5: { open: "09:00", close: "19:00" }, 6: { open: "09:00", close: "17:00" } };

// Small seeded random so the demo looks the same each time.
function rng(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

// opts (all optional, from the control page): barbers: ["Snow D", ...] (the shop's own team names), services: the shop's menu
// [{name, price, durationMin}] (saved as the shop's services), weeks: how many weeks of past visits to make up (0 to 26, default 8),
// rebook: {"Snow D": 63, ...} each barber's rough rebook rate (%) for the made-up history, so the dashboard has something real-looking to show.
async function fill(opts = {}) {
  if (!config.instant) throw new Error("Turn on instant booking for this shop first (business type Barbershop / salon).");
  const rand = rng(42);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const BARBERS = Array.isArray(opts.barbers) && opts.barbers.length ? opts.barbers.map((x) => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 12) : DEFAULT_BARBERS;
  let SERVICES = config.services;
  if (Array.isArray(opts.services) && opts.services.length) {
    const tenant = require("./tenant");
    SERVICES = require("./templates").cleanServices(opts.services);
    const rec = await tenant.getRecord(config.tenant);
    await tenant.saveRecord({ ...rec, services: SERVICES });
  }
  if (!SERVICES.length) throw new Error("Add the shop's services first.");

  // Barbers: listed, with shop hours, books open.
  const have = await artists.list();
  const slugs = [];
  for (const name of BARBERS) {
    let a = have.find((x) => x.name === name);
    const slug = a ? a.slug : await artists.add(name);
    await artists.setListed(slug, true);
    await artists.setOpen(slug, true);
    await cal.saveSettings(slug, { hours: HOURS, stepMin: 15, bufferMin: 0, leadHours: 1, windowDays: 28 });
    slugs.push(slug);
  }
  const marks = (await store.getJSON("demo")) || { artists: [], clients: 0 };
  marks.artists = [...new Set([...marks.artists, ...slugs.filter((s) => !have.some((x) => x.slug === s))])];

  // Clients
  const rows = [];
  for (let i = 0; i < 120; i++) {
    rows.push({ name: `${pick(FIRST)} ${pick(LAST)}`, phone: i < 100 ? `907-555-01${String(i).padStart(2, "0")}` : "",
      email: `demo${i}@example.com`, barber: pick(slugs), lastVisit: Date.now() - Math.floor(rand() * 120) * 86400e3,
      lastService: pick(SERVICES).name, notes: pick(NOTES) });
  }
  await clients.importRows(rows);
  // Mark them as demo so they can be removed later.
  const ids = await store.indexRange("clients", 1000);
  const cs = (await store.getMany(ids.map((x) => `client:${x}`))).filter((c) => c && /@example\.com$/.test(c.email || "") && /^demo\d+@/.test(c.email));
  await store.batch(cs.map((c) => ({ set: [`client:${c.id}`, { ...c, demo: true }] })));

  // Past visits: each client comes back every 2 to 5 weeks. A visit is "rebooked" when the next one was booked in the chair;
  // otherwise the next one was booked days later (or the client didn't come back). Some of those next visits land in the future.
  const now = Date.now();
  let made = 0;
  const weeks = Math.max(0, Math.min(26, Number(opts.weeks ?? 8)));
  if (weeks) {
    const busy = new Map(slugs.map((x) => [x, []]));
    const free = (slug, a, b) => !busy.get(slug).some(([x, y]) => x < b && a < y);
    const rateOf = (slug, i) => { const n = Number((opts.rebook || {})[BARBERS[i]]); return Number.isFinite(n) ? n / 100 : 0.5 + rand() * 0.25; };
    const rates = Object.fromEntries(slugs.map((x, i) => [x, rateOf(x, i)]));
    const place = (slug, svc, dayMs) => { // a free time that day inside the hours, or null
      const day = T.parseDate(T.dateKey(dayMs)), hours = HOURS[T.weekdayOf(day)];
      if (!hours) return null;
      const o = T.parseHM(hours.open), c = T.parseHM(hours.close), open = T.toUtc(day.y, day.m, day.d, o.h, o.mi), close = T.toUtc(day.y, day.m, day.d, c.h, c.mi);
      const steps = Math.floor((close - open - svc.durationMin * 60e3) / (15 * 60e3));
      for (let k = 0; k < 8 && steps >= 0; k++) { const t = open + Math.floor(rand() * (steps + 1)) * 15 * 60e3, e = t + svc.durationMin * 60e3; if (free(slug, t, e)) { busy.get(slug).push([t, e]); return t; } }
      return null;
    };
    const ops = [];
    for (const cl of cs) {
      const slug = slugs.includes(cl.barber) ? cl.barber : pick(slugs), svc = pick(SERVICES);
      let day = now - weeks * 7 * 864e5 + Math.floor(rand() * 21) * 864e5, createdAt = day - (1 + Math.floor(rand() * 5)) * 864e5;
      for (let n = 0; n < 12 && day < now + 28 * 864e5; n++) {
        let t = null; for (let tries = 0; tries < 6 && t == null; tries++, day += 864e5) t = place(slug, svc, day);
        if (t == null) break;
        ops.push(...visit(slug, svc, cl, t, createdAt));
        made++;
        if (t > now) break; // one future visit is enough
        const gap = (14 + Math.floor(rand() * 22)) * 864e5;
        if (rand() < rates[slug]) createdAt = t + (10 + Math.floor(rand() * 20)) * 60e3; // booked in the chair
        else if (rand() < 0.75) createdAt = t + (3 + Math.floor(rand() * 10)) * 864e5;  // booked later
        else break; // didn't come back
        day = t + gap; if (createdAt >= day) createdAt = day - 864e5;
        if (createdAt > now) break;
      }
    }
    for (let i = 0; i < ops.length; i += 400) await store.batch(ops.slice(i, i + 400));
  }

  // Bookings: today and the next six days, about 60% full, inside each barber's hours.
  const today = T.parseDate(T.dateKey(now));
  for (let d = 0; d < 7; d++) {
    const day = T.addDays(today, d);
    const hours = HOURS[T.weekdayOf(day)];
    if (!hours) continue;
    for (const slug of slugs) {
      const o = T.parseHM(hours.open), c = T.parseHM(hours.close);
      let t = T.toUtc(day.y, day.m, day.d, o.h, o.mi) + Math.floor(rand() * 2) * 15 * 60e3;
      const close = T.toUtc(day.y, day.m, day.d, c.h, c.mi);
      while (t < close) {
        const svc = pick(SERVICES);
        const end = t + svc.durationMin * 60e3;
        if (end > close) break;
        if (rand() < 0.6) {
          const cl = pick(cs);
          if (!(await clash(slug, t, end))) { await book(slug, svc, cl, t); made++; }
          t = end;
        } else t += 15 * 60e3 * (1 + Math.floor(rand() * 3));
      }
    }
  }
  marks.clients = cs.length;
  await store.setJSON("demo", marks);
  return { barbers: slugs.length, clients: cs.length, bookings: made, weeks };
}

async function clash(slug, start, end) {
  return (await cal.apptsBetween(slug, start - 8 * 3600e3, end)).some((a) => a.start < end && start < a.end);
}

// One made-up visit (any time, past or future), as the writes for a booked request and its calendar time.
function visit(slug, svc, c, start, createdAtMs) {
  const apptId = require("crypto").randomBytes(6).toString("hex"), reqId = `${createdAtMs.toString(36)}-${id(3)}`, at = new Date(createdAtMs).toISOString();
  const end = start + svc.durationMin * 60e3, when = T.rangeLabel(start, end);
  const appt = { id: apptId, artist: slug, requestId: reqId, start, end, durationMin: svc.durationMin, clientName: c.name, title: svc.name, source: "demo", pending: false, createdAt: createdAtMs, demo: true };
  const r = {
    id: reqId, token: id(12), createdAt: at, updatedAt: at, status: start + svc.durationMin * 60e3 < Date.now() ? "done" : "booked", artist: slug, instant: true, demo: true,
    client: { name: c.name, email: c.email, phone: c.phone, instagram: "", smsOk: false, smsOkAt: null },
    details: { idea: svc.name, answers: [] }, service: { id: svc.id, name: svc.name, price: svc.price, durationMin: svc.durationMin },
    session: { durationMin: svc.durationMin }, apptId, clientId: c.id, offers: [], images: [], notes: [],
    clientView: { message: "", quote: svc.price != null ? `$${svc.price}` : "", when, depositUrl: "" },
    history: [{ at, status: "booked", by: "client", note: `Booked ${svc.name} for ${when} (demo)` }], consent: { at },
  };
  return [{ set: [`req:${reqId}`, r] }, { zadd: ["reqs", reqId, createdAtMs] }, { set: [`cal:appt:${apptId}`, appt] }, { zadd: [`cal:appts:${slug}`, apptId, start] }];
}

async function book(slug, svc, c, start) {
  const appt = await cal.createAppt({ slug, start, durationMin: svc.durationMin, clientName: c.name, title: svc.name, source: "demo" });
  const reqId = `${Date.now().toString(36)}-${id(3)}`, now = new Date().toISOString();
  const when = T.rangeLabel(appt.start, appt.end);
  const r = {
    id: reqId, token: id(12), createdAt: now, updatedAt: now, status: "booked", artist: slug, instant: true, demo: true,
    client: { name: c.name, email: c.email, phone: c.phone, instagram: "", smsOk: false, smsOkAt: null },
    details: { idea: svc.name, answers: [] }, service: { id: svc.id, name: svc.name, price: svc.price, durationMin: svc.durationMin },
    session: { durationMin: svc.durationMin }, apptId: appt.id, clientId: c.id, offers: [], images: [], notes: [],
    clientView: { message: "", quote: svc.price != null ? `$${svc.price}` : "", when, depositUrl: "" },
    history: [{ at: now, status: "booked", by: "client", note: `Booked ${svc.name} online for ${when} (demo)` }], consent: { at: now },
  };
  await store.batch([{ set: [`req:${reqId}`, r] }, { zadd: ["reqs", reqId, Date.now()] },
    { set: [`cal:appt:${appt.id}`, { ...appt, requestId: reqId, demo: true }] }]);
}

// Take every demo record away: bookings, their calendar times, demo clients and demo barbers.
async function clear() {
  const marks = (await store.getJSON("demo")) || { artists: [] };
  let bookings = 0;
  for (;;) {
    const ids = await store.indexRange("reqs", 5000);
    const rs = (await store.getMany(ids.map((x) => `req:${x}`)));
    const demo = rs.filter((r) => r && r.demo);
    if (!demo.length) break;
    const ops = [];
    for (const r of demo) {
      ops.push({ del: `req:${r.id}` }, { zrem: ["reqs", r.id] });
      if (r.apptId) ops.push({ del: `cal:appt:${r.apptId}` }, { zrem: [`cal:appts:${r.artist}`, r.apptId] });
    }
    await store.batch(ops);
    bookings += demo.length;
    if (demo.length === rs.length && ids.length < 5000) break;
    if (demo.length < 1) break;
  }
  const ids = await store.indexRange("clients", 5000);
  const cs = (await store.getMany(ids.map((x) => `client:${x}`))).filter((c) => c && c.demo);
  for (const c of cs) await clients.remove(c.id);
  // Demo barbers: hidden from the booking page (their extra record stays harmlessly, with no bookings).
  const xs = (await store.getJSON("artists:extra")) || [];
  await store.setJSON("artists:extra", xs.filter((a) => !marks.artists.includes(a.slug)));
  await store.del("demo");
  return { bookings, clients: cs.length, barbers: marks.artists.length };
}

module.exports = { fill, clear };
