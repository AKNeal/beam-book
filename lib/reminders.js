// Day-before reminders (daily Vercel cron, all shops). For every confirmed appointment tomorrow (shop time) that came
// from a booking, the client gets an email if they gave one, and a text only if they agreed to texts.
// Each appointment is reminded once (remindedAt), so running the job twice never double-sends.

const config = require("../config/studio");
const store = require("./store");
const cal = require("./calendar");
const T = require("./time");
const artists = require("./artists");
const reqs = require("./requests");
const sms = require("./sms");
const { sendEmail } = require("./email");

async function forShop(now = Date.now()) {
  const today = T.parseDate(T.dateKey(now));
  const tom = T.addDays(today, 1), after = T.addDays(today, 2);
  const from = T.toUtc(tom.y, tom.m, tom.d, 0, 0), to = T.toUtc(after.y, after.m, after.d, 0, 0);
  const site = (config.studio.siteUrl || "").replace(/\/$/, "");
  const out = { sent: 0, skipped: 0 };
  for (const a of await artists.list()) {
    for (const appt of await cal.apptsBetween(a.slug, from, to)) {
      if (appt.start < from || appt.pending || appt.remindedAt || !appt.requestId) { out.skipped++; continue; }
      const r = await store.getJSON(`req:${appt.requestId}`);
      if (!r || r.status !== "booked") { out.skipped++; continue; }
      const what = r.service?.name || (config.words?.session || "appointment");
      const when = `${T.dayLabel(appt.start)} at ${T.timeLabel(appt.start)}`;
      const link = site ? reqs.statusUrl(site, r) : "";
      await Promise.all([
        r.client.email ? sendEmail({
          to: r.client.email, replyTo: config.studio.contactEmail || undefined,
          subject: `Reminder: ${what} tomorrow at ${T.timeLabel(appt.start)}`, title: `See you tomorrow, ${r.client.name.split(" ")[0]}`,
          paragraphs: [`${what.charAt(0).toUpperCase() + what.slice(1)} with ${a.name}, ${when}.`, config.studio.address ? `Where: ${config.studio.address}` : "",
            config.studio.phone ? `Can't make it? Call or text ${config.studio.phone} so someone else can have the spot.` : ""],
          button: link ? { label: "View your booking", url: link } : undefined,
        }) : null,
        sms.textClient(r, `Reminder: ${what} with ${a.name.split(" ")[0]} tomorrow at ${T.timeLabel(appt.start)}.${config.studio.phone ? ` Can't make it? Call ${config.studio.phone}.` : ""}`),
      ]);
      appt.remindedAt = Date.now();
      await store.setJSON(`cal:appt:${appt.id}`, appt);
      out.sent++;
    }
  }
  return out;
}

async function daily() {
  const tenant = require("./tenant");
  const out = {};
  for (const shop of await tenant.listShops()) {
    if (shop.active === false) continue;
    try { out[shop.slug] = await tenant.runAs(shop.slug, () => forShop()); } catch (e) { out[shop.slug] = { error: e.message }; }
  }
  return out;
}

module.exports = { daily, forShop };
