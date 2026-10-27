// GET /api/admin/inbox — requests, artists, waitlists, reply templates, and the booking calendar.

const config = require("../../config/studio");
const store = require("../../lib/store");
const artists = require("../../lib/artists");
const cal = require("../../lib/calendar");
const T = require("../../lib/time");
const auth = require("../../lib/auth");
const { send, method, baseUrl } = require("../../lib/http");
const reqs = require("../../lib/requests");
const files = require("../../lib/files");
const extcal = require("../../lib/extcal");
const { emailReady } = require("../../lib/email");

module.exports = async function handler(req, res) {
  if (!method(req, res, "GET")) return;
  const me = await auth.currentUser(req);
  if (!me) return send(res, 401, { error: "Log in first." });

  const ids = await store.indexRange("reqs", 500);
  // Artists only get requests assigned to them; Owner, Site admin and Front desk get everything.
  const requests = (await Promise.all(ids.map((id) => store.getJSON(`req:${id}`)))).filter((r) => r && auth.canSeeRequest(me, r));
  const site = baseUrl(req);
  // The raw token stays server-side; the inbox only gets the client's two ready-made links (admin-only, so Nathan can text them).
  for (const r of requests) {
    r.links = { status: reqs.statusUrl(site, r), schedule: reqs.scheduleUrl(site, r) }; delete r.token;
    if (auth.isOpenToAll(r)) r.openToAll = true;
    r.donePhotos = (r.donePhotos || []).map((ph) => ({ ...ph, url: files.adminUrl(ph.name) }));
    // Artists see the idea and photos of open requests, but not the client's contact details until they take it.
    if (!auth.seesAll(me) && r.artist !== me.artist) { r.client = { name: r.client.name }; delete r.links; r.messages = []; r.notes = []; }
  }

  const roster = (await artists.list()).filter((a) => auth.canSeeArtist(me, a.slug)).map((a) => ({ ...a, photoUrl: artists.photoUrl(a) }));
  const waitlists = {}, calendar = {};
  const from = Date.now() - 7 * cal.DAY, to = Date.now() + 180 * cal.DAY;
  for (const a of roster) {
    waitlists[a.slug] = (await store.getJSON(`waitlist:${a.slug}`)) || [];
    const appts = await cal.apptsBetween(a.slug, from, to);
    const ext = (await extcal.busyFor(a.slug, { refresh: false })).filter((b) => b.end > Date.now() && b.start < to);
    calendar[a.slug] = {
      external: await extcal.summary(a.slug),
      busy: ext.slice(0, 300).map((b) => ({ ...b, day: T.dateKey(b.start), dayLabel: T.dayLabel(b.start),
        time: b.allDay ? "All day" : `${T.timeLabel(b.start)} to ${T.timeLabel(b.end)}` })),
      settings: await cal.getSettings(a.slug),
      blocks: (await cal.getBlocks(a.slug)).map((b) => ({ ...b, label: blockLabel(b) })),
      appts: appts.map((x) => ({ ...x, localStart: T.localInputValue(x.start), when: T.rangeLabel(x.start, x.end), day: T.dateKey(x.start), dayLabel: T.dayLabel(x.start),
        time: `${T.timeLabel(x.start)} to ${T.timeLabel(x.end)}` })),
    };
  }

  const mine = auth.seesAll(me) ? null : me.artist; // artists get a feed of just their own bookings
  const feedUrl = `${site}/api/calendar?k=${await cal.feedToken(true, mine)}`;

  return send(res, 200, {
    me: { ...auth.publicUser(me), shopKey: me.id === "shop", full: auth.isFull(me), seesAll: auth.seesAll(me) },
    requests, artists: roster, waitlists, calendar,
    feed: { https: feedUrl, webcal: feedUrl.replace(/^https?:/, "webcal:"), live: process.env.VERCEL_ENV === "production" },
    sessionLengths: config.sessionLengths, timeZone: T.zoneName(Date.now()),
    templates: config.templates, statuses: config.statuses, words: config.words, negotiate: config.negotiate, form: config.form || [], kind: config.kind, ageCheck: Boolean(config.ageCheck), policyCheck: Boolean(config.policyCheck), depositPolicy: config.depositPolicy,
    sizes: config.sizes, storage: store.backend, emailReady: emailReady(), smsReady: require("../../lib/sms").smsReady(), shopName: config.studio.name, instagram: auth.isFull(me) ? await require("../../lib/instagram").status().catch(() => null) : null,
  });
};

function blockLabel(b) {
  const lastDay = b.allDay ? b.end - 1 : b.end;
  const sameDay = T.dateKey(b.start) === T.dateKey(lastDay);
  if (b.allDay) return sameDay ? `${T.dayLabel(b.start)}, all day` : `${T.dayLabel(b.start)} to ${T.dayLabel(lastDay)}, all day`;
  return sameDay ? `${T.dayLabel(b.start)}, ${T.timeLabel(b.start)} to ${T.timeLabel(b.end)}`
    : `${T.dayLabel(b.start)} ${T.timeLabel(b.start)} to ${T.dayLabel(b.end)} ${T.timeLabel(b.end)}`;
}

// Beam Book: run this endpoint for the shop at this web address.
module.exports = require("../../lib/tenant").handler(module.exports);
