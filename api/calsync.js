// Calendar sync from a barber's own link (onboarding pages link here). No login: each barber's link carries a key
// made from SESSION_SECRET, so only someone with that barber's link can connect a calendar to their book.
//   GET  /api/calsync?b=<slug>&k=<key>        -> {name, shop, calendars:[{name, host, events, error}]}
//   POST {b, k, name, url, allDay}            -> connects the calendar (read once right away), same shape back
const crypto = require("crypto");
const config = require("../config/studio");
const artists = require("../lib/artists");
const extcal = require("../lib/extcal");
const store = require("../lib/store");
const { send, body, ip, str } = require("../lib/http");

function keyFor(slug) {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("Calendar sync isn't set up on this site yet.");
  return crypto.createHmac("sha256", s).update(`calsync:${config.tenant}:${slug}`).digest("hex").slice(0, 24);
}
const same = (a, b) => typeof a === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const linkFor = (base, slug) => `${base}/calsync?b=${encodeURIComponent(slug)}&k=${keyFor(slug)}`;

async function view(slug) {
  const a = await artists.bySlug(slug);
  const cals = await extcal.summary(slug);
  return { name: a.name, shop: config.studio.name, calendars: cals.map((c) => ({ id: c.id, name: c.name, host: c.host, error: c.error || "", events: c.count || 0, fetchedAt: c.fetchedAt || null })) };
}

async function handler(req, res) {
  const q = req.method === "GET" ? Object.fromEntries(new URL(req.url, "http://x").searchParams) : body(req);
  const slug = str(q.b, 60), k = str(q.k, 40);
  try {
    if (!slug || !(await artists.bySlug(slug)) || !same(k, keyFor(slug))) return send(res, 404, { error: "This sync link isn't right. Ask the shop for a fresh one." });
    if (req.method === "GET") return send(res, 200, await view(slug));
    if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST." });
    if ((await store.hit(`rl:calsync:${ip(req)}`, 3600)) > 20) return send(res, 429, { error: "Too many tries. Please try again later." });
    if (q.remove) { await extcal.removeSource(slug, str(q.remove, 20)); return send(res, 200, await view(slug)); }
    await extcal.addSource(slug, { name: str(q.name, 60) || "My calendar", url: str(q.url, 2000), allDay: q.allDay === true });
    return send(res, 200, { ok: true, ...(await view(slug)) });
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
}
module.exports = require("../lib/tenant").handler(handler);
module.exports.linkFor = linkFor;
