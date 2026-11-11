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

const BARBERS = ["Marcus Reed", "Tony Vega", "Dre Collins"];
const FIRST = ["Tyler", "Andre", "Luis", "Kevin", "Chris", "Noah", "Eli", "Mateo", "Sam", "Ray", "Ivan", "Jordan", "Isaiah", "Caleb", "Owen", "Miles", "Jalen", "Diego", "Aaron", "Brandon"];
const LAST = ["Hall", "Nguyen", "Brooks", "Ward", "Reyes", "Diaz", "Foster", "Cole", "Price", "Young", "Carter", "Lopez", "James", "Bennett", "Hayes", "Ortiz"];
const NOTES = ["#2 on the sides, scissors on top", "Low taper, keep the length", "Skin fade, beard lined up", "#1 all over", "Mid fade, part on the left", ""];
const HOURS = { 0: null, 1: null, 2: { open: "09:00", close: "18:00" }, 3: { open: "09:00", close: "18:00" }, 4: { open: "09:00", close: "18:00" },
  5: { open: "09:00", close: "19:00" }, 6: { open: "09:00", close: "17:00" } };

// Small seeded random so the demo looks the same each time.
function rng(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

async function fill() {
  if (!config.instant) throw new Error("Turn on instant booking for this shop first (business type Barbershop / salon).");
  const rand = rng(42);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];

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
      lastService: pick(config.services).name, notes: pick(NOTES) });
  }
  await clients.importRows(rows);
  // Mark them as demo so they can be removed later.
  const ids = await store.indexRange("clients", 1000);
  const cs = (await store.getMany(ids.map((x) => `client:${x}`))).filter((c) => c && /@example\.com$/.test(c.email || "") && /^demo\d+@/.test(c.email));
  await store.batch(cs.map((c) => ({ set: [`client:${c.id}`, { ...c, demo: true }] })));

  // Bookings: today and the next six days, about 60% full, inside each barber's hours.
  let made = 0;
  const now = Date.now();
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
        const svc = pick(config.services);
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
  return { barbers: slugs.length, clients: cs.length, bookings: made };
}

async function clash(slug, start, end) {
  return (await cal.apptsBetween(slug, start - 8 * 3600e3, end)).some((a) => a.start < end && start < a.end);
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
