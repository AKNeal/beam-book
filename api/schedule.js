// Client self-booking, for requests the shop has approved ("Send booking link").
//   GET  /api/schedule?id=&t=          → open times for this client's session length
//   GET  /api/schedule?id=&t=&ics=1    → "add to my calendar" file for a booked appointment
//   POST /api/schedule {id, t, start}  → book that time

const config = require("../config/studio");
const store = require("../lib/store");
const cal = require("../lib/calendar");
const T = require("../lib/time");
const artists = require("../lib/artists");
const reqs = require("../lib/requests");
const sms = require("../lib/sms");
const { sendEmail } = require("../lib/email");
const { send, body, ip, baseUrl } = require("../lib/http");

const NOT_FOUND = "We couldn't find that booking link. Use the link from your email.";
const artistSlug = (r) => (r.artist && r.artist !== "any" ? r.artist : config.artists[0].slug);

module.exports = async function handler(req, res) {
  if (req.method === "GET") return get(req, res);
  if (req.method === "POST") return post(req, res);
  res.setHeader("Allow", "GET, POST");
  return send(res, 405, { error: "Method not allowed" });
};

async function get(req, res) {
  const q = new URL(req.url, "http://x").searchParams;
  const r = await reqs.byToken(q.get("id"), q.get("t"));
  if (!r) return send(res, 404, { error: NOT_FOUND });
  const slug = artistSlug(r);
  const artist = await artists.bySlug(slug);

  if (q.get("ics")) {
    const appt = r.status === "booked" ? await cal.getAppt(r.apptId) : null;
    if (!appt) return send(res, 404, { error: "There's no appointment on this request yet." });
    const ics = cal.icsCalendar(`${config.studio.name}`, [{
      uid: `${appt.id}@${config.tenant}.beambook`, start: appt.start, end: appt.end,
      summary: `${(config.words?.job || "Booking").replace(/^./, (c) => c.toUpperCase())} with ${artist ? artist.name : config.studio.name}`, location: config.studio.address,
      description: [config.studio.name, config.studio.address, config.words?.prep, config.studio.phone ? `Questions: ${config.studio.phone}` : ""].filter(Boolean).join("\n"),
    }]);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="black-wolf-appointment.ics"');
    res.setHeader("Cache-Control", "no-store");
    return res.end(ics);
  }

  const base = { artist: artist ? artist.name : config.studio.name, status: r.status, idea: r.details.idea, phone: config.studio.phone, prep: config.words?.prep || "", session: config.words?.session || "session" };
  if (r.status === "pending") {
    const appt = await cal.getAppt(r.apptId);
    return send(res, 200, { ...base, pending: true, when: appt ? T.rangeLabel(appt.start, appt.end) : r.clientView?.when || "" });
  }
  if (r.status === "booked") {
    const appt = await cal.getAppt(r.apptId);
    return send(res, 200, { ...base, booked: true, when: appt ? T.rangeLabel(appt.start, appt.end) : r.clientView?.when || "" });
  }
  if (r.status !== "scheduling" || !r.session) return send(res, 200, { ...base, open: false });

  const { days, timeZone } = await cal.openSlots(slug, r.session.durationMin);
  return send(res, 200, {
    ...base, open: true, durationMin: r.session.durationMin, timeZone,
    deposit: r.clientView?.deposit || "", message: r.clientView?.message || "", days,
  });
}

async function post(req, res) {
  const b = body(req);
  if ((await store.hit(`rl:book:${ip(req)}`, 3600)) > 20) return send(res, 429, { error: "Too many tries. Please call the shop." });
  const r = await reqs.byToken(b.id, b.t);
  if (!r) return send(res, 404, { error: NOT_FOUND });
  if (r.status === "booked") return send(res, 409, { error: "You're already booked. Call the shop to change your time.", booked: true });
  if (r.status === "pending") return send(res, 409, { error: "You've already asked for a time. You'll hear back once it's confirmed.", pending: true });
  if (r.status !== "scheduling" || !r.session) return send(res, 409, { error: "This booking link isn't open right now. Call the shop to book." });

  const start = Number(b.start);
  if (!Number.isFinite(start)) return send(res, 400, { error: "Pick a time." });
  const slug = artistSlug(r);
  const dur = r.session.durationMin;

  // One booking at a time per artist, so two people can't take the same slot.
  if (!(await store.lock(`book:${slug}`))) return send(res, 409, { error: "Someone is booking right now. Try again in a few seconds.", retry: true });
  let appt;
  try {
    // Re-check against the live calendar: the time must still be one of the open slots.
    const { days } = await cal.openSlots(slug, dur);
    const stillOpen = days.some((d) => d.slots.some((s) => s.start === start));
    if (!stillOpen) return send(res, 409, { error: "That time was just taken. Pick another one.", taken: true });
    appt = await cal.createAppt({ slug, start, durationMin: dur, requestId: r.id, clientName: r.client.name, title: r.details.idea.slice(0, 80), source: "client", pending: true });
  } finally {
    await store.unlock(`book:${slug}`);
  }

  // The client's pick is a request: the time is held, and the artist confirms it (or asks for another) from the inbox.
  const when = T.rangeLabel(appt.start, appt.end);
  const now = new Date().toISOString();
  r.apptId = appt.id;
  r.status = "pending";
  r.unread = true;
  r.clientView = { ...r.clientView, when };
  r.history.push({ at: now, status: "pending", by: "client", note: `Asked for ${when}` });
  await reqs.save(r);

  const site = baseUrl(req);
  const artist = await artists.bySlug(slug);
  const artistLogins = await require("../lib/auth").artistEmails(slug);
  const who = artist ? artist.name : "the shop";
  await Promise.all([
    sendEmail({
      to: r.client.email, replyTo: config.studio.contactEmail || undefined,
      subject: `Time requested: ${when}`, title: "We got your time",
      paragraphs: [`Hi ${r.client.name.split(" ")[0]},`, `You asked for ${when} with ${who}. It's held for you while ${artist ? artist.name.split(" ")[0] : "the shop"} confirms it; you'll get another email once it's set.`],
      button: { label: "View your request", url: reqs.statusUrl(site, r) },
    }),
    sendEmail({
      to: [config.studio.contactEmail, artist?.email, ...artistLogins], replyTo: r.client.email,
      subject: `Confirm: ${r.client.name}, ${when}`, title: "A client picked a time",
      paragraphs: [`${r.client.name} asked for ${when}.`, `Idea: ${r.details.idea}`, "The time is held. Confirm it, or ask for another time, from the inbox."],
      button: { label: "Confirm in the inbox", url: `${site}/admin#${r.id}` },
    }),
  ]);
  await Promise.all([
    sms.textClient(r, `We got your time: ${when}. It's held for you while ${who.split(" ")[0]} confirms it.`),
    sms.textArtists(slug, `${r.client.name} asked for ${when}. Confirm or ask for another time: ${site}/admin#${r.id}`),
  ]);
  return send(res, 200, { ok: true, when, pending: true });
}

// Beam Book: run this endpoint for the shop at this web address.
module.exports = require("../lib/tenant").handler(module.exports);
