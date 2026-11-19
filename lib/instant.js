// Instant booking (barbershop mode): the client picks a fixed service, a barber (or "anyone"), and an open time,
// and they're booked on the spot. No request, no back-and-forth. Each booking also makes a regular request record
// (status "booked") so it shows in the shop's inbox, the client gets a status link, and the client list gets the visit.

const config = require("../config/studio");
const store = require("./store");
const cal = require("./calendar");
const T = require("./time");
const artists = require("./artists");
const reqs = require("./requests");
const clients = require("./clients");
const sms = require("./sms");
const { sendEmail } = require("./email");
const { send, body, ip, id, str, baseUrl } = require("./http");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const money = (p) => (p == null ? "" : `$${Number(p) % 1 ? Number(p).toFixed(2) : Number(p)}`);

async function barbersFor(service) {
  const all = (await artists.list({ publicOnly: true })).filter((a) => a.booksOpen !== false);
  return service?.barbers?.length ? all.filter((a) => service.barbers.includes(a.slug)) : all;
}
const serviceById = (sid) => (config.services || []).find((s) => s.id === sid) || null;

// Open times across one barber, or every barber who does this service ("any"): each slot knows who's free.
async function slotsFor(service, barberSlug) {
  const pool = await barbersFor(service);
  const list = barberSlug && barberSlug !== "any" ? pool.filter((a) => a.slug === barberSlug) : pool;
  const byDay = new Map();
  for (const a of list) {
    const { days } = await cal.openSlots(a.slug, service.durationMin);
    for (const d of days) {
      if (!byDay.has(d.date)) byDay.set(d.date, { date: d.date, label: d.label, slots: new Map() });
      const m = byDay.get(d.date).slots;
      for (const sl of d.slots) if (!m.has(sl.start)) m.set(sl.start, { start: sl.start, label: sl.label, barber: a.slug });
    }
  }
  return [...byDay.values()].sort((x, y) => (x.date < y.date ? -1 : 1))
    .map((d) => ({ date: d.date, label: d.label, slots: [...d.slots.values()].sort((x, y) => x.start - y.start) }));
}

async function handle(req, res) {
  if (!config.instant) return send(res, 404, { error: "This shop takes booking requests instead. Use the booking form." });
  if (req.method === "GET") return get(req, res);
  if (req.method === "POST") return post(req, res);
  res.setHeader("Allow", "GET, POST");
  return send(res, 405, { error: "Method not allowed" });
}

async function get(req, res) {
  const q = new URL(req.url, "http://x").searchParams;
  const service = serviceById(q.get("service"));
  if (!service) {
    const roster = await barbersFor(null);
    return send(res, 200, {
      services: (config.services || []).map((s) => ({ ...s, priceLabel: money(s.price) })),
      barbers: roster.map((a) => ({ slug: a.slug, name: a.name, photo: artists.photoUrl(a) })),
      shopName: config.studio.name, timeZone: T.zoneName(Date.now()), phone: config.studio.phone, prep: config.words?.prep || "",
    });
  }
  const barber = str(q.get("barber"), 60) || "any";
  const pool = await barbersFor(service);
  if (barber !== "any" && !pool.some((a) => a.slug === barber)) return send(res, 400, { error: "That barber doesn't do this service. Pick someone else." });
  return send(res, 200, { service, days: await slotsFor(service, barber), timeZone: T.zoneName(Date.now()) });
}

async function post(req, res) {
  const b = body(req);
  if (str(b.website)) return send(res, 200, { ok: true }); // bots fill the hidden field
  const service = serviceById(str(b.service, 40));
  if (!service) return send(res, 400, { error: "Pick a service." });
  const f = { name: str(b.name, 80), phone: str(b.phone, 30), email: str(b.email, 120).toLowerCase(), textOk: b.textOk === true, note: str(b.note, 300) };
  const errors = {};
  if (f.name.length < 2) errors.name = "Tell us your name.";
  if (!sms.toE164(f.phone)) errors.phone = "Enter a US phone number so the shop can reach you.";
  if (f.email && !EMAIL_RE.test(f.email)) errors.email = "That email doesn't look right (or leave it blank).";
  if (Object.keys(errors).length) return send(res, 400, { error: "Please fix the highlighted fields.", fields: errors });
  const start = Number(b.start);
  if (!Number.isFinite(start)) return send(res, 400, { error: "Pick a time." });
  if ((await store.hit(`rl:instant:${ip(req)}`, 3600)) > 10) return send(res, 429, { error: "Too many bookings from this connection. Please call the shop." });

  // Who can take it: the barber picked, or anyone who does this service and is free then.
  const pool = await barbersFor(service);
  const wanted = str(b.barber, 60) || "any";
  const candidates = wanted === "any" ? pool : pool.filter((a) => a.slug === wanted);
  if (!candidates.length) return send(res, 400, { error: "That barber doesn't do this service. Pick someone else." });

  let appt = null, barber = null;
  for (const a of candidates) {
    if (!(await store.lock(`book:${a.slug}`))) continue;
    try {
      const { days } = await cal.openSlots(a.slug, service.durationMin);
      if (!days.some((d) => d.slots.some((sl) => sl.start === start))) continue;
      appt = await cal.createAppt({ slug: a.slug, start, durationMin: service.durationMin, clientName: f.name, title: service.name, source: "online" });
      barber = a;
    } finally { await store.unlock(`book:${a.slug}`); }
    if (appt) break;
  }
  if (!appt) return send(res, 409, { error: "That time was just taken. Pick another one.", taken: true });

  const now = new Date().toISOString();
  const when = T.rangeLabel(appt.start, appt.end);
  const reqId = `${Date.now().toString(36)}-${id(3)}`;
  const record = {
    id: reqId, token: id(12), createdAt: now, updatedAt: now, status: "booked", artist: barber.slug, instant: true,
    client: { name: f.name, email: f.email, phone: f.phone, instagram: "", smsOk: f.textOk, smsOkAt: f.textOk ? now : null },
    details: { idea: service.name, answers: f.note ? [{ key: "note", label: "Note", type: "long", value: f.note }] : [] },
    service: { id: service.id, name: service.name, price: service.price, durationMin: service.durationMin },
    session: { durationMin: service.durationMin }, apptId: appt.id,
    offers: [], images: [], notes: [],
    clientView: { message: "", quote: money(service.price), when, depositUrl: "" },
    history: [{ at: now, status: "booked", by: "client", note: `Booked ${service.name} online for ${when}` }],
    consent: { at: now },
  };
  await store.setJSON(`req:${reqId}`, record);
  await store.indexAdd("reqs", reqId, Date.now());
  // Link the appointment back to the booking, and add the visit to the client list.
  const fullAppt = await cal.getAppt(appt.id);
  if (fullAppt) { fullAppt.requestId = reqId; await store.setJSON(`cal:appt:${appt.id}`, fullAppt); }
  try {
    const c = await clients.recordVisit({ name: f.name, phone: f.phone, email: f.email, textOk: f.textOk, barber: barber.slug,
      service: service.name, at: appt.start, apptId: appt.id, requestId: reqId });
    record.clientId = c.id; await reqs.save(record);
  } catch (e) { console.error("[clients] visit not recorded", e.message); } // never lose a booking over this

  const site = baseUrl(req);
  const statusUrl = reqs.statusUrl(site, record);
  const first = barber.name.split(" ")[0];
  const artistLogins = await require("./auth").artistEmails(barber.slug);
  const test = await require("./testbook").isTest(f); // the team booking themselves / "test": no shop alerts
  if (test) { record.test = true; await reqs.save(record); }
  await Promise.all([
    f.email ? sendEmail({
      to: f.email, replyTo: config.studio.contactEmail || undefined,
      subject: `You're booked: ${service.name}, ${when}`, title: `You're booked, ${f.name.split(" ")[0]}`,
      paragraphs: [`${service.name} with ${barber.name}, ${when}.`, config.studio.address ? `Where: ${config.studio.address}` : "",
        config.words?.prep || "", `Need to change it? Use the button below to move or cancel${config.changeCutoffHours ? ` (up to ${config.changeCutoffHours} hours before)` : ""}${config.studio.phone ? `, or call ${config.studio.phone}` : ""}.`],
      button: { label: "View your booking", url: statusUrl },
    }) : null,
    test ? null : sendEmail({
      to: [config.studio.contactEmail, barber.email, ...artistLogins], replyTo: f.email || undefined,
      subject: `Booked online: ${f.name}, ${service.name}, ${when}`, title: "New online booking",
      paragraphs: [`${f.name} booked ${service.name} with ${barber.name}, ${when}.`, `Phone: ${f.phone}${f.email ? ` · ${f.email}` : ""}`, f.note ? `Note: ${f.note}` : ""],
      button: { label: "Open the inbox", url: `${site}/admin#${reqId}` },
    }),
  ]);
  await Promise.all([
    sms.textClient(record, `You're booked: ${service.name} with ${first}, ${when}. Change or cancel: ${statusUrl} Reply STOP to opt out.`),
    test ? null : sms.textArtists(barber.slug, `Booked online: ${f.name}, ${service.name}, ${when}.`),
  ]);
  return send(res, 200, { ok: true, when, barber: barber.name, service: service.name, price: money(service.price), statusUrl: `/request?id=${encodeURIComponent(reqId)}&t=${encodeURIComponent(record.token)}`,
    ics: `/api/schedule?id=${encodeURIComponent(reqId)}&t=${encodeURIComponent(record.token)}&ics=1` });
}

// The front desk (or a barber) books someone in from the shop calendar. Any time the barber has free on the calendar,
// even outside the online-booking rules (short notice, start-time grid); a clash with another booking needs force.
// The client gets the usual confirmation (email if given, text only if they agreed). No "new booking" alert to the shop.
async function staffBook(b, me, site) {
  const service = serviceById(str(b.service, 40)); if (!service) throw new Error("Pick a service.");
  const roster = await artists.list();
  const anyone = str(b.barber, 60) === "any";
  const pool = anyone ? (await barbersFor(service)) : roster.filter((a) => a.slug === str(b.barber, 60));
  if (!pool.length) throw new Error(anyone ? "Nobody does this service." : "Pick a barber.");
  const f = { name: str(b.name, 80), phone: str(b.phone, 30), email: str(b.email, 120).toLowerCase(), textOk: b.textOk === true, note: str(b.note, 300) };
  if (f.name.length < 2) throw new Error("Enter the client's name.");
  if (f.phone && !sms.toE164(f.phone)) throw new Error("That phone number doesn't look right.");
  if (f.email && !EMAIL_RE.test(f.email)) throw new Error("That email doesn't look right.");
  let start = Number(b.start);
  if (!Number.isFinite(start)) { // shop-local date + "HH:MM"
    const d = T.parseDate(String(b.date || "")), m = /^(\d{1,2}):(\d{2})$/.exec(String(b.time || ""));
    if (!d || !m) throw new Error("Pick a day and time."); start = T.toUtc(d.y, d.m, d.d, +m[1], +m[2]);
  }
  const dur = Math.max(5, Math.min(600, Number(b.durationMin) || service.durationMin));
  // Repeat: every 1-4 weeks, up to 12 visits in all.
  const every = Math.max(0, Math.min(4, Math.round(Number(b.repeatWeeks) || 0))), times = every ? Math.max(1, Math.min(12, Math.round(Number(b.repeatTimes) || 1))) : 1;
  const starts = Array.from({ length: times }, (_, i) => start + i * every * 7 * 864e5);
  const clashFor = async (slug, st) => (await cal.apptsBetween(slug, st - 12 * 3600e3, st + dur * 6e4 + 3600e3)).find((x) => x.start < st + dur * 6e4 && x.end > st);
  // Who: the barber picked, or (Any) the first one free for every visit.
  let barber = null;
  for (const a of pool) { let ok = true; for (const st of starts) if (await clashFor(a.slug, st)) { ok = false; break; } if (ok) { barber = a; break; } }
  if (!barber) {
    if (anyone && !b.force) { const e = new Error("Nobody who does this service is free then."); e.clash = true; throw e; }
    barber = pool[0];
    if (!b.force) { const c = await clashFor(barber.slug, starts.find(() => true)); const e = new Error(`${barber.name} already has ${c?.clientName || "a booking"} then${c ? ` (${T.timeLabel(c.start)} to ${T.timeLabel(c.end)})` : times > 1 ? " on one of the repeat dates" : ""}.`); e.clash = true; throw e; }
  }
  const made = [];
  for (const st of starts) made.push(await bookOne({ service, barber, f, start: st, dur, me, site, notify: b.notify !== false, series: times > 1 ? `${made.length + 1} of ${times}` : "" }));
  return { ok: true, id: made[0].id, apptId: made[0].apptId, when: made[0].when, barber: barber.name, service: service.name, count: made.length };
}

async function bookOne({ service, barber, f, start, dur, me, site, notify, series }) {
  if (!(await store.lock(`book:${barber.slug}`))) throw new Error("Someone is booking with this barber right now. Try again.");
  let appt;
  try { appt = await cal.createAppt({ slug: barber.slug, start, durationMin: dur, clientName: f.name, title: service.name, source: "desk" }); }
  finally { await store.unlock(`book:${barber.slug}`); }
  const now = new Date().toISOString(), when = T.rangeLabel(appt.start, appt.end);
  const reqId = `${Date.now().toString(36)}-${id(3)}`;
  const record = {
    id: reqId, token: id(12), createdAt: now, updatedAt: now, status: "booked", artist: barber.slug, instant: true, bookedBy: me.name || "Shop",
    client: { name: f.name, email: f.email, phone: f.phone, instagram: "", smsOk: f.textOk, smsOkAt: f.textOk ? now : null },
    details: { idea: service.name, answers: f.note ? [{ key: "note", label: "Note", type: "long", value: f.note }] : [] },
    service: { id: service.id, name: service.name, price: service.price, durationMin: dur },
    session: { durationMin: dur }, apptId: appt.id, offers: [], images: [], notes: [],
    clientView: { message: "", quote: money(service.price), when, depositUrl: "" },
    history: [{ at: now, status: "booked", by: me.name || "shop", note: `Booked ${service.name} for ${when} from the shop calendar${series ? ` (repeat ${series})` : ""}` }],
  };
  await store.setJSON(`req:${reqId}`, record); await store.indexAdd("reqs", reqId, Date.now());
  const full = await cal.getAppt(appt.id); if (full) { full.requestId = reqId; await store.setJSON(`cal:appt:${appt.id}`, full); }
  try {
    const c = await clients.recordVisit({ name: f.name, phone: f.phone, email: f.email, textOk: f.textOk, barber: barber.slug, service: service.name, at: appt.start, apptId: appt.id, requestId: reqId });
    record.clientId = c.id; await reqs.save(record);
  } catch (e) { console.error("[clients] visit not recorded", e.message); }
  const statusUrl = reqs.statusUrl(site, record), test = await require("./testbook").isTest(f);
  if (test) { record.test = true; await reqs.save(record); }
  if (notify) await Promise.all([
    f.email ? sendEmail({ to: f.email, replyTo: config.studio.contactEmail || undefined, subject: `You're booked: ${service.name}, ${when}`, title: `You're booked, ${f.name.split(" ")[0]}`,
      paragraphs: [`${service.name} with ${barber.name}, ${when}.`, config.studio.address ? `Where: ${config.studio.address}` : "", config.words?.prep || "",
        `Need to change it? Use the button below${config.studio.phone ? `, or call ${config.studio.phone}` : ""}.`], button: { label: "View your booking", url: statusUrl } }).catch(() => {}) : null,
    sms.textClient(record, `You're booked: ${service.name} with ${barber.name.split(" ")[0]}, ${when}. Change or cancel: ${statusUrl} Reply STOP to opt out.`).catch(() => {}),
    test || me.artist === barber.slug ? null : sms.textArtists(barber.slug, `Booked by ${me.name || "the desk"}: ${f.name}, ${service.name}, ${when}.`).catch(() => {}),
  ]);
  return { id: reqId, apptId: appt.id, when };
}

module.exports = { handle, slotsFor, staffBook };
