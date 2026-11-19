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
//   Client list (lib/clients.js) — kept here so the app stays inside Vercel's function limit:
//   {action:"clients", q?, before?}  list (newest visit first) or search · {action:"client", id}
//   {action:"clientSave", id?, client} · {action:"clientDelete", id}          (not barbers)
//   {action:"clientsImport", rows, textOk} · {action:"clientsRemoveAll"}      (Owner / Site admin)
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
  if (/^(client|squireHistory)/.test(String(b.action || ""))) return clientsApi(req, res, me, b);
  if (/^site/.test(String(b.action || ""))) return siteApi(req, res, me, b);
  if (/^(dash|challenge|board)/.test(String(b.action || ""))) return dashApi(req, res, me, b);
  if (/^pay/.test(String(b.action || ""))) return payApi(req, res, me, b);
  if (/^appr/.test(String(b.action || ""))) return apprApi(req, res, me, b);
  if (b.action === "testEmail") { // Owner: check that booking email works (sent to the address given, or the shop's email)
    if (!auth.isFull(me)) return send(res, 403, { error: "Only the Owner or an Administrator can send a test." });
    const { sendEmail, emailReady } = require("../../lib/email");
    if (!emailReady()) return send(res, 400, { error: "Email isn't switched on yet (RESEND_API_KEY and EMAIL_FROM)." });
    const to = String(b.to || require("../../config/studio").studio.contactEmail || "").trim().slice(0, 120);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return send(res, 400, { error: "Give an email address to send the test to." });
    const r = await sendEmail({ to, subject: "Test from your booking system", title: "Email is working", paragraphs: ["This is a test from your booking system. Booking confirmations, reminders and changes will look like this."] });
    return send(res, r && r.ok ? 200 : 502, { ok: Boolean(r && r.ok), to, ...(r && r.ok ? {} : { error: "Resend didn't accept it. Check the domain and key." }) });
  }
  if (/^setup/.test(String(b.action || ""))) { // setup checklist (lib/setup.js): your own items; Owner / Administrator see and edit everyone's
    const SU = require("../../lib/setup"), full = auth.isFull(me);
    try {
      if (b.action === "setupList") return send(res, 200, { ...(await SU.view(me, full && b.all !== false)), full });
      if (b.action === "setupDone") { await SU.setDone(me, str(b.id, 20), Boolean(b.done), full); return send(res, 200, { ...(await SU.view(me, full)), full }); }
      if (!full) return send(res, 403, { error: "Only the Owner or an Administrator can change the checklist." });
      if (b.action === "setupSave") { await SU.save(b); return send(res, 200, { ...(await SU.view(me, true)), full }); }
      if (b.action === "setupRemove") { await SU.remove(str(b.id, 20)); return send(res, 200, { ...(await SU.view(me, true)), full }); }
      return send(res, 400, { error: "Unknown setup action." });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (b.action === "paperFields") { // Owner: field names in an official form (for setting up the paperwork maps)
    if (!auth.isFull(me)) return send(res, 403, { error: "Owner or an Administrator only." });
    try { const P = require("../../lib/paperwork"); return send(res, 200, { form: b.form, fields: await P.fields(String(b.form || "")) }); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (b.action === "onboardLink") { // Owner: the shop's private setup link (the current one; fresh:true makes a new one and stops the old)
    if (!auth.isFull(me)) return send(res, 403, { error: "Only the Owner or an Administrator can make the setup link." });
    const base = `https://${String(req.headers["x-forwarded-host"] || req.headers.host).split(",")[0]}`;
    return send(res, 200, { url: await require("../../lib/onboarding").makeLink(base, { keep: b.fresh !== true }) });
  }
  if (b.action === "onboardFeedback") { // Owner / Neal Media: what the shop sent from the setup page
    if (!auth.isFull(me)) return send(res, 403, { error: "Only the Owner or an Administrator can see this." });
    const ob = require("../../lib/onboarding");
    return send(res, 200, { feedback: await ob.feedback(), a2p: await require("../../lib/store").getJSON("onboard:a2p") });
  }
  if (b.action === "calsyncLinks") { // Owner: each barber's private calendar-sync link (for onboarding pages)
    if (!auth.isFull(me)) return send(res, 403, { error: "Only the Owner or an Administrator can see sync links." });
    const base = `https://${String(req.headers["x-forwarded-host"] || req.headers.host).split(",")[0]}`, cs = require("../calsync");
    return send(res, 200, { links: (await artists.list()).map((a) => ({ slug: a.slug, name: a.name, url: cs.linkFor(base, a.slug) })) });
  }
  if (b.action === "rankManual") { // Owner: record today's ranks by hand from a live Google search (when the morning check didn't run)
    if (!auth.isFull(me)) return send(res, 403, { error: "Only the Owner or an Administrator can record ranks." });
    try {
      const rc = require("../../lib/rankcheck");
      const searches = {}; for (const [q, r] of Object.entries(b.ranks || {})) searches[q] = { rank: r == null ? null : Number(r) };
      await rc.ingest({ searches, rating: b.rating, reviews: b.reviews, note: `Entered by hand by ${me.name || "the Owner"} from a live Google search` });
      return send(res, 200, { rankings: await rc.summary() });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (b.action === "rankSearches") { // Owner: the shop's Google searches (up to 5)
    if (!auth.isFull(me)) return send(res, 403, { error: "Only the Owner can change the searches." });
    try { const rc = require("../../lib/rankcheck"); const searches = await rc.saveSearches(b.searches); return send(res, 200, { rankings: await rc.summary({ searches }) }); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
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
        if (!auth.isFull(me)) return send(res, 403, { error: "Only the Owner or a Administrator can change the booking form." });
        await artists.setListed(slug, b.listed === true);
        return send(res, 200, { ok: true, artists: await artists.list() });
      case "removeBarber": {
        if (!auth.isFull(me)) return send(res, 403, { error: "Only the Owner or an Administrator can remove a barber." });
        const name = await artists.remove(slug);
        return send(res, 200, { ok: true, removed: name, artists: await artists.list() });
      }
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
  if (!auth.isFull(me)) return send(res, 403, { error: "Only the Owner or a Administrator can change the shop's Instagram." });
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

// ----- Client list -----
async function clientsApi(req, res, me, b) {
  const clients = require("../../lib/clients");
  const store = require("../../lib/store");
  const staffOnly = () => { if (!auth.seesAll(me)) { send(res, 403, { error: "Only the Owner, a Administrator or Staff can change clients." }); return false; } return true; };
  const ownerOnly = () => { if (!auth.isFull(me)) { send(res, 403, { error: "Only the Owner or a Administrator can do that." }); return false; } return true; };
  try {
    switch (b.action) {
      case "clients": {
        const q = str(b.q, 80);
        if (q) return send(res, 200, { clients: await clients.search(q), search: true });
        return send(res, 200, await clients.list({ before: Number(b.before) || null, limit: 50 }));
      }
      case "client": {
        const c = await clients.get(str(b.id, 20));
        return c ? send(res, 200, { client: c }) : send(res, 404, { error: "That client isn't on the list." });
      }
      case "clientSave": {
        if (!staffOnly()) return;
        const c = b.client || {};
        const saved = await clients.save({ name: c.name, phone: c.phone, email: c.email, barber: c.barber, notes: c.notes, textOk: c.textOk === true }, str(b.id, 20) || null);
        return send(res, 200, { ok: true, client: saved });
      }
      case "clientDelete":
        if (!staffOnly()) return;
        return send(res, 200, { ok: await clients.remove(str(b.id, 20)) });
      case "clientsImport": {
        if (!ownerOnly()) return;
        if ((await store.hit(`rl:import:${me.id}`, 3600)) > 200) return send(res, 429, { error: "That's a lot of imports. Try again in an hour." });
        // Only these fields are read; anything else in a row (payment method, tips, card details) is ignored.
        const rows = (Array.isArray(b.rows) ? b.rows : []).map((r) => ({ name: r?.name, phone: r?.phone, email: r?.email, barber: r?.barber,
          lastVisit: r?.lastVisit, lastService: r?.lastService, notes: r?.notes }));
        return send(res, 200, { ok: true, ...(await clients.importRows(rows, { textOk: b.textOk === true })) });
      }
      case "squireHistory": {
        if (!ownerOnly()) return;
        if ((await store.hit(`rl:import:${me.id}`, 3600)) > 200) return send(res, 429, { error: "That's a lot of imports. Try again in an hour." });
        // Only these fields are read; emails, phones and every other column never leave the owner's computer.
        const rows = (Array.isArray(b.rows) ? b.rows : []).map((r) => ({ staff: r?.staff, date: r?.date, time: r?.time, cdate: r?.cdate, ctime: r?.ctime,
          pay: r?.pay, tip: r?.tip, cost: r?.cost, status: r?.status, client: r?.client, service: r?.service, dur: r?.dur }));
        return send(res, 200, { ok: true, ...(await require("../../lib/squirehist").importRows(rows)) });
      }
      case "squireHistoryStatus":
        if (!ownerOnly()) return;
        return send(res, 200, await require("../../lib/squirehist").status());
      case "squireHistoryClear":
        if (!ownerOnly()) return;
        return send(res, 200, { ok: true, ...(await require("../../lib/squirehist").clear()) });
      case "clientsRemoveAll":
        if (!ownerOnly()) return;
        if (b.confirm !== "DELETE ALL") return send(res, 400, { error: 'Type DELETE ALL to confirm.' });
        return send(res, 200, { ok: true, removed: await clients.removeAll() });
      default:
        return send(res, 400, { error: "Unknown action." });
    }
  } catch (e) { return send(res, 400, { error: e.message }); }
}

// Beam Book: run this endpoint for the shop at this web address.
module.exports = require("../../lib/tenant").handler(module.exports);

// The business's own request questions, words and negotiation rules (Owner / Site admin).
// Beam: the shop's website checklist and change requests (lib/site.js). Owner and Administrator only.
//   {action:"site"} · {action:"siteSave", key, value | photo (data URL) | remove | skip}
//   {action:"siteChange", text, photos?} · {action:"siteReview", id, status?, note?} (Administrator)
async function siteApi(req, res, me, b) {
  if (!auth.isFull(me)) return send(res, 403, { error: "Only the Owner or a Administrator can work on the website." });
  const site = require("../../lib/site");
  try {
    if (b.action === "siteSave") await site.saveItem(b);
    else if (b.action === "siteChange") await site.addChange(me, b);
    else if (b.action === "siteReview") await site.setChange(me, b);
    else if (b.action !== "site") return send(res, 400, { error: "Unknown website action." });
    return send(res, 200, { ok: true, ...(await site.adminView(me)) });
  } catch (e) { return send(res, 400, { error: e.message }); }
}

// Beam: dashboard, scoreboard and rebooking challenges (lib/analytics.js).
//   {action:"dash", period?: today|week|month|last30|next30, from?, to?, barber?}   barbers only ever get their own numbers
//   {action:"dashSettings", settings} · {action:"dashPay", slug, pay}                Owner / Site admin
//   {action:"challenges"} · {action:"challengeSave", ...} · {action:"challengeDelete", id}
//   {action:"boardLink", reset?}                                                      the shop TV's private link
async function dashApi(req, res, me, b) {
  const an = require("../../lib/analytics"), T = require("../../lib/time");
  const owner = auth.isFull(me), all = auth.seesAll(me);
  try {
    if (b.action === "dash") {
      let [from, to] = an.range(String(b.period || "week"));
      const df = b.from && T.parseDate(String(b.from)), dt = b.to && T.parseDate(String(b.to));
      if (df && dt) { from = T.toUtc(df.y, df.m, df.d, 0, 0); to = T.toUtc(dt.y, dt.m, dt.d, 0, 0) + 864e5; }
      if (to - from > 400 * 864e5 || to <= from) return send(res, 400, { error: "Pick a shorter date range." });
      // Whole-shop numbers and money: the Owner only. Everyone else gets their own dashboard (their numbers and their pay),
      // or, with no barber linked (an Administrator / Staff login), the shop's counts without any dollar amounts.
      const isOwner = me.role === "owner";
      const who = isOwner ? (b.barber ? str(b.barber, 60) : null) : me.artist || null;
      const hideMoney = !isOwner && !who;
      const d = await an.dashboard({ from, to, who, withMoney: !hideMoney });
      if (hideMoney) { delete d.avgTicket; d.services = d.services.map(({ gross, ...x }) => x); d.daily = d.daily.map(({ gross, ...x }) => x); }
      d.weekly = await an.weekly({ who });
      if (!isOwner) { delete d.settings; for (const m of [d.money, ...d.barbers.map((x) => x.money)]) if (m) { delete m.net; delete m.expenses; delete m.booth; } }
      return send(res, 200, { dash: d, hideMoney, mine: Boolean(who && !isOwner), challenges: await an.standings(), owner, isOwner, barbers: isOwner ? (await artists.list()).map((a) => ({ slug: a.slug, name: a.name })) : [] });
    }
    if (b.action === "dashDay") { // the Day screen: projected earnings for the day (own; the Owner sees every barber)
      const d0 = T.parseDate(String(b.date || "")); if (!d0) return send(res, 400, { error: "Pick a day." });
      const from = T.toUtc(d0.y, d0.m, d0.d, 0, 0), to = from + 864e5, isOwner = me.role === "owner";
      if (!isOwner && !me.artist) return send(res, 200, { rows: [] });
      const d = await an.dashboard({ from, to, who: isOwner ? null : me.artist, withMoney: true });
      const rows = d.barbers.filter((x) => x.cuts).map((x) => ({ slug: x.slug, name: x.name, cuts: x.cuts, done: x.done, gross: x.money.gross, earned: x.money.earned, projected: x.money.projected,
        take: x.money.take, tips: x.money.tips || 0, model: x.pay?.model || "commission", rate: x.pay?.rate ?? 50 }));
      return send(res, 200, { rows, owner: isOwner });
    }
    if (b.action === "challenges") return send(res, 200, { challenges: await an.standings(), metrics: an.METRICS });
    if (!owner) return send(res, 403, { error: "Only the Owner or a Administrator can change this." });
    if (me.role !== "owner" && ["dashSettings", "dashPay", "dashConfig"].includes(b.action)) return send(res, 403, { error: "The shop's money settings are for the Owner." });
    if (b.action === "dashSettings") return send(res, 200, { settings: await an.saveSettings(b.settings || {}), pay: await an.pay() });
    if (b.action === "dashPay") { if (!(await artists.bySlug(str(b.slug, 60)))) return send(res, 400, { error: "Unknown barber." }); return send(res, 200, { pay: await an.savePay(str(b.slug, 60), b.pay || {}) }); }
    if (b.action === "dashConfig") return send(res, 200, { settings: await an.settings(), pay: await an.pay(), barbers: (await artists.list()).map((a) => ({ slug: a.slug, name: a.name })) });
    if (b.action === "challengeSave") { await an.saveChallenge(b); return send(res, 200, { challenges: await an.standings() }); }
    if (b.action === "challengeDelete") { await an.deleteChallenge(String(b.id || "")); return send(res, 200, { challenges: await an.standings() }); }
    if (b.action === "boardLink") { const t = await an.boardToken(Boolean(b.reset)); return send(res, 200, { token: t, url: `/scoreboard?t=${t}` }); }
    return send(res, 400, { error: "Unknown dashboard action." });
  } catch (e) { return send(res, 400, { error: e.message }); }
}

// Beam: checkout (lib/payments.js). Anyone on the team can check out appointments they can see;
// Stripe setup and the credit-card fee rate are Owner / Site admin only.
//   {action:"payDay", date?} · {action:"payQuote", appt, tip?, price?} · {action:"payCash", appt, tip?, price?}
//   {action:"payCard", appt, tip?, price?} · {action:"payCardStatus", appt} · {action:"payCardConfirm", appt} · {action:"payCardCancel", appt}
//   {action:"payTestTap", kind:"credit"|"debit"} (test mode) · {action:"paySetup"} · {action:"payConnect"} · {action:"payReader", code?, label?} · {action:"payRates", surchargePct}
async function payApi(req, res, me, b) {
  const pay = require("../../lib/payments");
  const owner = auth.isFull(me);
  try {
    if (["paySetup", "payConnect", "payReader", "payRates"].includes(b.action) && !owner) return send(res, 403, { error: "Only the Owner or a Administrator can set up payments." });
    if (b.action === "paySetup") return send(res, 200, await pay.status());
    if (b.action === "payConnect") { const base = require("../../lib/http").baseUrl(req); return send(res, 200, { url: await pay.connectLink(`${base}/admin?payments=1`) }); }
    if (b.action === "payReader") return send(res, 200, await pay.addReader({ code: b.code, label: b.label }));
    if (b.action === "payRates") { await pay.updateRates(b); return send(res, 200, await pay.status()); }
    if (b.action === "payTestTap") return send(res, 200, await pay.simulateTap(b.kind));
    if (b.action === "payDay") return send(res, 200, { appts: await pay.day({ who: auth.seesAll(me) ? null : me.artist, dateKey: b.date }), status: { enabled: pay.enabled(), testMode: pay.testMode() } });
    const id = str(b.appt, 40), appt = await cal.getAppt(id);
    if (!appt || !auth.canSeeArtist(me, appt.artist)) return send(res, 404, { error: "That appointment isn't on your calendar." });
    const o = { tip: b.tip, price: owner || auth.seesAll(me) ? b.price : undefined, by: me.name };
    if (b.action === "payQuote") return send(res, 200, await pay.quote(id, o));
    if (b.action === "payCash") return send(res, 200, { paid: await pay.payCash(id, o) });
    if (b.action === "payCard") return send(res, 200, await pay.startCard(id, o));
    if (b.action === "payCardStatus") return send(res, 200, await pay.cardStatus(id));
    if (b.action === "payCardConfirm") return send(res, 200, await pay.confirmCard(id));
    if (b.action === "payCardCancel") return send(res, 200, await pay.cancelCard(id));
    if (b.action === "payLink") return send(res, 200, await pay.startLink(id, o, require("../../lib/http").baseUrl(req)));
    if (b.action === "payLinkStatus") return send(res, 200, await pay.linkStatus(id));
    if (b.action === "payLinkCancel") return send(res, 200, await pay.cancelLink(id));
    return send(res, 400, { error: "Unknown payment action." });
  } catch (e) { return send(res, 400, { error: e.message }); }
}

async function bookingSettings(req, res, me, b) {
  if (!auth.isFull(me)) return send(res, 403, { error: "Only the Owner or a Administrator can change the booking form." });
  const tenant = require("../../lib/tenant");
  const config = require("../../config/studio");
  try {
    const rec = await tenant.getRecord(config.tenant);
    const set = require("../../lib/templates").bookingSettings(b, { words: config.words, negotiate: config.negotiate });
    if (b.depositPolicy !== undefined) set.depositPolicy = String(b.depositPolicy).trim().slice(0, 600);
    const saved = await tenant.saveRecord({ ...rec, ...set });
    return send(res, 200, { ok: true, instant: Boolean(saved.instant), services: saved.services || [], changeCutoffHours: saved.changeCutoffHours ?? 2, words: saved.words, form: saved.form, negotiate: saved.negotiate, ageCheck: saved.ageCheck, policyCheck: saved.policyCheck, askInstagram: saved.askInstagram !== false, sessionLengths: saved.sessionLengths });
  } catch (e) { return send(res, 400, { error: e.message }); }
}

// ---------- apprentice portal (lib/apprentice.js) ----------
//   {action:"apprView", slug?}                       an apprentice sees their own; Owner / Administrator see any (no slug: the list)
//   {action:"apprLog", date, hours, note, slug?}     an apprentice logs their own hours (waiting for sign-off); the Owner's are signed off
//   {action:"apprDelete", id}                        an apprentice removes their own hours that aren't signed off yet
//   {action:"apprReview", slug, id, approve}         Owner: approve true | false | "delete"
//   {action:"apprCheck", slug, id, on}               Owner: tick a checkoff
//   {action:"apprSet", slug, on} · {action:"apprStart", slug, date}
//   {action:"apprSettings", goalHours} · {action:"apprChecklist", items} · {action:"apprMaterials", items}
async function apprApi(req, res, me, b) {
  const A = require("../../lib/apprentice"), Demo = require("../../lib/apprdemo"), store = require("../../lib/store");
  // Demo apprentices exist only here (never on the team or the booking page).
  const team = await require("../../lib/artists").list(), demos = await Demo.people();
  const artists = { list: async () => [...team, ...demos], bySlug: async (s) => team.find((x) => x.slug === s) || demos.find((x) => x.slug === s) || null };
  const full = auth.isFull(me), mine = me.artist && (await A.list()).includes(me.artist);
  const by = me.name || "Owner";
  const needFull = () => { if (!full) { send(res, 403, { error: "Only the Owner or a Administrator can do that." }); return false; } return true; };
  try {
    switch (b.action) {
      case "apprView": {
        if (full && !b.slug) {
          const P = require("../../lib/paperwork");
          const roster = await artists.list(), slugs = await A.list();
          const people = [], docs = [];
          for (const s2 of slugs) {
            const a = roster.find((x) => x.slug === s2); if (!a) continue;
            const v = await A.view(s2), tasks = v.checklist.filter((c) => c.target);
            let prof = null; try { prof = await P.profile(s2); } catch {}
            people.push({ slug: s2, name: a.name, demo: Demo.isDemo(s2), approvedHours: v.approvedHours, pendingHours: v.pendingHours, practicalHours: v.practicalHours, theoryHours: v.theoryHours, pct: v.pct,
              checksDone: v.checksDone, checksTotal: v.checksTotal, tasksQualified: tasks.filter((c) => c.done).length, tasksTotal: tasks.length,
              repsPending: tasks.reduce((n, c) => n + c.repsPending, 0), modulesDone: v.checklist.filter((c) => !c.target && c.done).length, modulesTotal: v.checklist.filter((c) => !c.target).length,
              permit: v.permit, startDate: v.startDate, paperwork: prof ? P.missing(prof) : null });
            for (const d of (await store.getJSON(`appr:docs:${s2}`)) || []) docs.push({ ...d, slug: s2, name: a.name });
          }
          docs.sort((x, y) => y.at - x.at);
          return send(res, 200, { owner: true, applications: await A.applications(), apprentices: people, docs: docs.slice(0, 60), demo: demos.length > 0,
            team: team.map((a) => ({ slug: a.slug, name: a.name })), settings: await A.settings(), checklist: await A.checklist(), materials: await A.materials() });
        }
        const slug = full ? str(b.slug, 60) : me.artist;
        if (!full && !mine) return send(res, 403, { error: "This login isn't set up as an apprentice." });
        const a = await artists.bySlug(slug); if (!a) return send(res, 404, { error: "That team member isn't here." });
        return send(res, 200, { owner: full, name: a.name, ...(full ? { applications: (await A.applications()).map((x) => ({ id: x.id, first: x.first, last: x.last, status: x.status })) } : {}), ...(await A.view(slug)) });
      }
      case "apprRep": { // log reps on a qualified task (apprentice: waiting for approval; Owner: approved)
        const slug = full && b.slug ? str(b.slug, 60) : me.artist;
        if (!full && !mine) return send(res, 403, { error: "This login isn't set up as an apprentice." });
        await A.logRep(slug, str(b.id, 20), { date: b.date, count: b.count, note: b.note, approved: full }, by);
        return send(res, 200, { ok: true, ...(await A.view(slug)) });
      }
      case "apprRepReview": { // Owner: approve true | false | "delete"; apprentice: "delete" on their own pending rep
        const slug = full ? str(b.slug, 60) : me.artist;
        if (!full && !(mine && b.approve === "delete")) return send(res, 403, { error: "Only the Owner or a Administrator can do that." });
        await A.reviewRep(slug, str(b.id, 20), str(b.rep, 20), b.approve === "delete" ? "delete" : Boolean(b.approve), by, !full);
        return send(res, 200, { ok: true, ...(await A.view(slug)) });
      }
      case "apprMeta": { // Owner: permit number, linked application
        if (!needFull()) return;
        await A.setMeta(str(b.slug, 60), { permit: b.permit, appId: b.appId });
        return send(res, 200, { ok: true, ...(await A.view(str(b.slug, 60))) });
      }
      case "apprProfile": { // the apprentice's paperwork details. GET: {get:true}. The apprentice edits their own; the Owner only sees (SSN masked).
        const P = require("../../lib/paperwork");
        const slug = full && b.slug ? str(b.slug, 60) : me.artist;
        if (!full && !mine) return send(res, 403, { error: "This login isn't set up as an apprentice." });
        if (b.get) {
          const docs = full ? ((await store.getJSON(`appr:docs:${slug}`)) || []).map((d) => ({ ...d, slug })) : undefined;
          let p = await P.profile(slug);
          if (p) return send(res, 200, { ok: true, saved: true, docs, profile: P.masked(p) });
          const v = await A.view(slug), app = v.appId ? (await A.applications()).find((x) => x.id === v.appId) : null;
          return send(res, 200, { ok: true, saved: false, docs, profile: P.fromApplication(app) });
        }
        if (full && slug !== me.artist) return send(res, 403, { error: "Apprentices fill in their own details from their login." });
        const p = await P.saveProfile(slug, b.profile || {});
        return send(res, 200, { ok: true, saved: true, profile: P.masked(p) });
      }
      case "apprPaperSettings": { // Owner: shop paperwork settings. {get:true} to read.
        if (!needFull()) return;
        const P = require("../../lib/paperwork");
        const S = b.get ? await P.settings() : await P.saveSettings(b.settings || {}), shop = require("../../config/studio").studio || {};
        return send(res, 200, { ok: true, settings: { ...S, shopName: S.shopName || shop.name || "", shopPhone: S.shopPhone || shop.phone || "", shopPhysical: S.shopPhysical || shop.address || "" } });
      }
      case "apprPaper": { // Owner: fill a form. form: ak4194 | eta671 | w4 | i9 | ak4315 | packet. ak4315 takes months: ["2026-11", …]
        if (!needFull()) return;
        const P = require("../../lib/paperwork");
        const slug = str(b.slug, 60), a = await artists.bySlug(slug); if (!a) return send(res, 404, { error: "That team member isn't here." });
        const v = await A.view(slug);
        const p = (await P.profile(slug)) || P.cleanProfile((await A.applications()).find((x) => x.id === v.appId) || { first: a.name.split(" ")[0], last: a.name.split(" ").slice(1).join(" ") });
        const S = await P.settings(), shop = require("../../config/studio").studio || {};
        S.shopName = S.shopName || shop.name || ""; S.shopPhone = S.shopPhone || shop.phone || ""; S.shopPhysical = S.shopPhysical || shop.address || "";
        const roster = await artists.list(), others = [];
        for (const s2 of await A.list()) if (s2 !== slug) { const o = roster.find((x) => x.slug === s2); if (o) others.push({ name: o.name, permit: (await A.view(s2)).permit }); }
        const months = (Array.isArray(b.months) ? b.months : []).filter((m) => /^\d{4}-\d{2}$/.test(m)).slice(0, 3);
        const ctx2 = { startDate: v.startDate, permit: v.permit, others, hours: v.hours, months };
        const form = str(b.form, 10);
        const buf = form === "packet" ? await P.packet(p, S, ctx2) : await P.build(form, p, S, ctx2);
        const nm = (p.last || a.name).replace(/[^a-z0-9]+/gi, "-");
        const fname = form === "packet" ? `Apprentice-paperwork-${nm}.pdf` : `${P.FORMS[form].file}-${nm}${form === "ak4315" && months[0] ? `-${months[0]}` : ""}.pdf`;
        if (!b.view) { // keep a list of what was made (the PDFs themselves aren't stored: View makes a fresh one from the current details)
          const log = (await store.getJSON(`appr:docs:${slug}`)) || [];
          log.unshift({ form, title: form === "packet" ? "Full paperwork packet" : P.FORMS[form].title, months, at: Date.now(), by, filename: fname, missing: P.missing(p).length });
          await store.setJSON(`appr:docs:${slug}`, log.slice(0, 40));
        }
        return send(res, 200, { ok: true, filename: fname, pdf: buf.toString("base64"), missing: P.missing(p) });
      }
      case "apprDemo": { // Owner: add (on) or remove the demo apprentices
        if (!needFull()) return;
        if (b.on) await Demo.seed(by); else await Demo.clear();
        return send(res, 200, { ok: true });
      }
      case "apprApp": { // Owner: application status (new / contacted / accepted / declined) or "delete"
        if (!needFull()) return;
        await A.setAppStatus(str(b.id, 20), str(b.status, 20));
        return send(res, 200, { ok: true, applications: await A.applications() });
      }
      case "apprLog": {
        const slug = full && b.slug ? str(b.slug, 60) : me.artist;
        if (!full && !mine) return send(res, 403, { error: "This login isn't set up as an apprentice." });
        await A.logHours(slug, { date: b.date, hours: b.hours, kind: b.kind, note: b.note, approved: full }, by);
        return send(res, 200, { ok: true, ...(await A.view(slug)) });
      }
      case "apprDelete":
        if (!mine) return send(res, 403, { error: "This login isn't set up as an apprentice." });
        await A.deleteOwnPending(me.artist, str(b.id, 20)); return send(res, 200, { ok: true, ...(await A.view(me.artist)) });
      case "apprReview": if (!needFull()) return; await A.reviewHours(str(b.slug, 60), str(b.id, 20), b.approve === "delete" ? "delete" : Boolean(b.approve), by); return send(res, 200, { ok: true, ...(await A.view(str(b.slug, 60))) });
      case "apprCheck": if (!needFull()) return; await A.setCheck(str(b.slug, 60), str(b.id, 20), Boolean(b.on), by); return send(res, 200, { ok: true, ...(await A.view(str(b.slug, 60))) });
      case "apprStart": if (!needFull()) return; await A.setStart(str(b.slug, 60), b.date); return send(res, 200, { ok: true, ...(await A.view(str(b.slug, 60))) });
      case "apprSet": {
        if (!needFull()) return;
        if (!(await artists.bySlug(str(b.slug, 60)))) return send(res, 404, { error: "That team member isn't here." });
        return send(res, 200, { ok: true, list: await A.setApprentice(str(b.slug, 60), Boolean(b.on)) });
      }
      case "apprSettings": if (!needFull()) return; await A.saveSettings(b); return send(res, 200, { ok: true, settings: await A.settings() });
      case "apprChecklist": if (!needFull()) return; return send(res, 200, { ok: true, checklist: await A.saveChecklist(b.items) });
      case "apprMaterials": if (!needFull()) return; return send(res, 200, { ok: true, materials: await A.saveMaterials(b.items) });
      default: return send(res, 400, { error: "Unknown action." });
    }
  } catch (e) { return send(res, 400, { error: e.message }); }
}
