// POST /api/admin/books — the shop's books: open/closed, weekly hours, blocked time, and the iPhone calendar link.
//   {slug, open}                                  open or close an artist's books
//   {action:"settings", slug, settings}           weekly hours, start-time step, buffer, notice, booking window
//   {action:"block", slug, startDate, endDate, from?, to?, note}
//   {action:"unblock", slug, id}
//   {action:"profile", slug, name?, styles, bio, instagram, photo? (data URL), removePhoto?}   Artists page profile
//   {action:"addCalendar", slug, name, url, allDay}   connect an outside calendar (its events become busy time)
//   {action:"removeCalendar", slug, id} · {action:"syncCalendars", slug}
//   {action:"listed", slug, listed}                show/hide an added artist on the public booking form (Owner / Site admin)
//   {action:"igConnect"} -> {url}  · {action:"igSync"} · {action:"igDisconnect"}   the shop's Instagram (Owner / Site admin)
//   {action:"resetFeed"}                          new private calendar link (old one stops working); artists reset their own
// Artists can only change their own books, hours and time off.

const artists = require("../../lib/artists");
const cal = require("../../lib/calendar");
const auth = require("../../lib/auth");
const files = require("../../lib/files");
const extcal = require("../../lib/extcal");
const { send, method, body, str } = require("../../lib/http");

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  const me = await auth.currentUser(req);
  if (!me) return send(res, 401, { error: "Log in first." });
  const b = body(req);
  const slug = str(b.slug, 60);
  if (/^ig[A-Z]/.test(String(b.action || ""))) return instagram(req, res, me, b.action);
  if (b.action === "bookingSettings") return bookingSettings(req, res, me, b);
  if (b.action !== "resetFeed" && (!auth.canSeeArtist(me, slug) || !(await artists.bySlug(slug)))) return send(res, 400, { error: "Unknown artist." });
  const needArtist = () => true;

  try {
    switch (b.action) {
      case undefined:
      case "books": {
        if (!(await artists.setOpen(slug, b.open === true))) return send(res, 400, { error: "Unknown artist." });
        return send(res, 200, { ok: true, artists: (await artists.list()).filter((a) => auth.canSeeArtist(me, a.slug)) });
      }
      case "settings":
        if (!needArtist()) return;
        return send(res, 200, { ok: true, settings: await cal.saveSettings(slug, b.settings || {}) });
      case "block":
        if (!needArtist()) return;
        return send(res, 200, { ok: true, blocks: await cal.addBlock(slug, {
          startDate: str(b.startDate, 10), endDate: str(b.endDate, 10), from: str(b.from, 5), to: str(b.to, 5), note: str(b.note, 120) }) });
      case "unblock":
        if (!needArtist()) return;
        return send(res, 200, { ok: true, blocks: await cal.removeBlock(slug, str(b.id, 20)) });
      case "profile": {
        const styles = (Array.isArray(b.styles) ? b.styles : String(b.styles || "").split(","))
          .map((x) => str(String(x), 40)).filter(Boolean).slice(0, 8);
        let ig = str(b.instagram, 40).replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").replace(/^@?/, "");
        if (ig && !/^[A-Za-z0-9._]{1,30}$/.test(ig)) return send(res, 400, { error: "That Instagram handle doesn't look right." });
        const patch = { styles, bio: str(b.bio, 800), instagram: ig ? `@${ig}` : "" };
        if (b.name !== undefined) { const n = str(b.name, 60); if (n.length < 2) return send(res, 400, { error: "Enter a name." }); patch.name = n; }
        if (b.removePhoto) patch.photo = "";
        if (b.photo) {
          const d = files.decode([b.photo]);
          if (d.error) return send(res, 400, { error: d.error });
          patch.photo = await files.saveArtistPhoto(slug, d.files[0]);
        }
        await artists.setProfile(slug, patch);
        return send(res, 200, { ok: true, artists: (await artists.list()).filter((a) => auth.canSeeArtist(me, a.slug)).map((a) => ({ ...a, photoUrl: artists.photoUrl(a) })) });
      }
      case "addCalendar": {
        const src = await extcal.addSource(slug, { name: str(b.name, 60), url: str(b.url, 2000), allDay: b.allDay !== false });
        return send(res, 200, { ok: true, added: src.name, calendars: await extcal.summary(slug) });
      }
      case "removeCalendar":
        await extcal.removeSource(slug, str(b.id, 20));
        return send(res, 200, { ok: true, calendars: await extcal.summary(slug) });
      case "syncCalendars":
        await extcal.syncAll(slug);
        return send(res, 200, { ok: true, calendars: await extcal.summary(slug) });
      case "listed":
        if (!auth.isFull(me)) return send(res, 403, { error: "Only the Owner or a Site admin can change the booking form." });
        await artists.setListed(slug, b.listed === true);
        return send(res, 200, { ok: true, artists: await artists.list() });
      case "resetFeed":
        await cal.resetFeedToken(auth.seesAll(me) ? null : me.artist);
        return send(res, 200, { ok: true });
      default:
        return send(res, 400, { error: "Unknown action." });
    }
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
};

// The shop's Instagram feed (Owner / Site admin).
async function instagram(req, res, me, action) {
  if (!auth.isFull(me)) return send(res, 403, { error: "Only the Owner or a Site admin can change the shop's Instagram." });
  const ig = require("../../lib/instagram");
  const { baseUrl } = require("../../lib/http");
  try {
    const cb = `${(process.env.BEAMBOOK_URL || baseUrl(req)).replace(/\/$/, "")}/instagram/callback`; // one address for every shop
    if (action === "igConnect") return send(res, 200, { url: await ig.startConnect(me, cb) });
    if (action === "igSync") { const f = await ig.syncFeed({ force: true }); if (f.error) return send(res, 502, { error: f.error, instagram: await ig.status() }); return send(res, 200, { instagram: await ig.status() }); }
    if (action === "igDisconnect") { await ig.disconnect(); return send(res, 200, { instagram: await ig.status() }); }
    return send(res, 400, { error: "Unknown action." });
  } catch (e) { return send(res, 400, { error: e.message }); }
}

// Beam Book: run this endpoint for the shop at this web address.
module.exports = require("../../lib/tenant").handler(module.exports);

// The business's own request questions, words and negotiation rules (Owner / Site admin).
async function bookingSettings(req, res, me, b) {
  if (!auth.isFull(me)) return send(res, 403, { error: "Only the Owner or a Site admin can change the booking form." });
  const tenant = require("../../lib/tenant");
  const config = require("../../config/studio");
  try {
    const rec = await tenant.getRecord(config.tenant);
    const set = require("../../lib/templates").bookingSettings(b, { words: config.words, negotiate: config.negotiate });
    if (b.depositPolicy !== undefined) set.depositPolicy = String(b.depositPolicy).trim().slice(0, 600);
    const saved = await tenant.saveRecord({ ...rec, ...set });
    return send(res, 200, { ok: true, words: saved.words, form: saved.form, negotiate: saved.negotiate, ageCheck: saved.ageCheck, policyCheck: saved.policyCheck, sessionLengths: saved.sessionLengths });
  } catch (e) { return send(res, 400, { error: e.message }); }
}
