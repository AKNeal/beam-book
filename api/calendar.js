// GET /api/calendar?k=<private key> — the shop's bookings as a calendar Nathan can subscribe to
// on his iPhone (or Google / Outlook). The key is private; resetting it in the inbox cuts off old links.

const crypto = require("crypto");
const config = require("../config/studio");
const cal = require("../lib/calendar");
const store = require("../lib/store");
const artists = require("../lib/artists");
const { send, baseUrl } = require("../lib/http");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed" });
  const key = new URL(req.url, "http://x").searchParams.get("k") || "";
  const same = (real) => real && key.length === real.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(real));
  const roster = await artists.list();
  let only = null; // null = whole shop
  if (!same(await cal.feedToken(false))) {
    only = null;
    for (const a of roster) if (same(await cal.feedToken(false, a.slug))) { only = a.slug; break; }
    if (!only) return send(res, 404, { error: "Calendar not found." });
  }

  // Remember that a phone picked up this calendar (the setup checklist turns green from this). At most once an hour.
  try {
    const k = `calfeed:seen:${only || "shop"}`, seen = await store.getJSON(k);
    if (!seen || Date.now() - seen.at > 3600 * 1000) await store.setJSON(k, { at: Date.now() });
  } catch (e) { console.error("[calfeed]", e.message); }

  const site = baseUrl(req);
  const from = Date.now() - 60 * cal.DAY, to = Date.now() + 400 * cal.DAY;
  const events = [];
  for (const a of roster.filter((x) => !only || x.slug === only)) {
    for (const appt of await cal.apptsBetween(a.slug, from, to)) {
      const r = appt.requestId ? await store.getJSON(`req:${appt.requestId}`) : null;
      const lines = [];
      if (r) {
        lines.push(r.details.idea, `${r.details.placement}${r.details.color ? `, ${r.details.color}` : ""}`);
        lines.push([r.client.phone, r.client.email].filter(Boolean).join(" · "));
      } else if (appt.title) lines.push(appt.title);
      if (roster.length > 1 && !only) lines.push(`Artist: ${a.name}`);
      if (r) lines.push(`${site}/admin#${r.id}`);
      events.push({
        uid: `${appt.id}@${config.tenant}.beambook`, start: appt.start, end: appt.end,
        summary: `${appt.pending ? "Requested (not confirmed): " : `${(config.words?.job || "Booking").replace(/^./, (c) => c.toUpperCase())}: `}${appt.clientName || "Client"}`, location: config.studio.address,
        description: lines.join("\n"),
      });
    }
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("X-Robots-Tag", "noindex");
  const calName = only ? `${roster.find((a) => a.slug === only).name.split(" ")[0]}'s ${config.words?.jobs || "bookings"}` : `${config.studio.name} bookings`;
  res.end(req.method === "HEAD" ? "" : cal.icsCalendar(calName, events));
};

// Beam Book: run this endpoint for the shop at this web address — except the daily reminder job
// (/reminders/daily, Vercel cron), which comes in on the main address and goes through every shop.
const forShop = require("../lib/tenant").handler(module.exports);
module.exports = async function (req, res) {
  if (new URL(req.url, "http://x").searchParams.get("cron") === "reminders") {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { error: "Not allowed." });
    return send(res, 200, await require("../lib/reminders").daily());
  }
  return forShop(req, res);
};
