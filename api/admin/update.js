// POST /api/admin/update {id, action, ...} — move a request through the pipeline and email the client.
// actions: quote (price + session length; client accepts and picks a time), schedule (send booking link without a quote step),
// delete (Owner / Site admin: remove the request, its appointment and photos for good),
// book (shop picks the time), cancelAppt, done, decline, reopen, note, assign, reply (message the client), seen (mark read)

const config = require("../../config/studio");
const store = require("../../lib/store");
const artists = require("../../lib/artists");
const cal = require("../../lib/calendar");
const T = require("../../lib/time");
const reqs = require("../../lib/requests");
const { sendEmail } = require("../../lib/email");
const sms = require("../../lib/sms");
const files = require("../../lib/files");
const offers = require("../../lib/offers");
const deal = require("../../lib/deal");
const auth = require("../../lib/auth");
const { send, method, body, str, baseUrl } = require("../../lib/http");

function isHttps(u) { try { return new URL(u).protocol === "https:"; } catch { return false; } }
const slugFor = (r) => (r.artist && r.artist !== "any" ? r.artist : config.artists[0].slug);
const hours = (min) => (min % 60 ? `${(min / 60).toFixed(1)} hours` : `${min / 60} hour${min === 60 ? "" : "s"}`);

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  const me = await auth.currentUser(req);
  if (!me) return send(res, 401, { error: "Log in first." });

  const b = body(req);
  const r = await store.getJSON(`req:${str(b.id, 40)}`);
  if (r && b.action === "claim" && !auth.canSeeRequest(me, r) && r.history.some((h) => /^Taken by/.test(h.note || ""))) {
    const who = (await artists.bySlug(r.artist))?.name;
    return send(res, 409, { error: who ? `${who} already took this one.` : "Someone already took this one.", taken: true });
  }
  if (!r || !auth.canSeeRequest(me, r)) return send(res, 404, { error: "Request not found." });
  const by = me.id === "shop" ? "shop" : me.name; // shown in the request's history

  // An artist looking at a request that's open to everyone can only take it.
  if (!auth.seesAll(me) && r.artist !== me.artist) {
    if (b.action !== "claim") return send(res, 403, { error: "Take this request first." });
    if (!(await store.lock(`claim:${r.id}`, 10000))) return send(res, 409, { error: "Someone else is taking this one right now." });
    try {
      const fresh = await store.getJSON(`req:${r.id}`);
      if (!auth.isOpenToAll(fresh)) {
        const who = (await artists.bySlug(fresh.artist))?.name;
        return send(res, 409, { error: who ? `${who} already took this one.` : "This request isn't open anymore.", taken: true });
      }
      fresh.artist = me.artist;
      fresh.history.push({ at: new Date().toISOString(), status: fresh.status, by, note: `Taken by ${(await artists.bySlug(me.artist))?.name || me.name}` });
      await reqs.save(fresh);
      const out = { ...fresh, links: { status: reqs.statusUrl(baseUrl(req), fresh), schedule: reqs.scheduleUrl(baseUrl(req), fresh) } }; delete out.token;
      return send(res, 200, { ok: true, emailed: null, request: out });
    } finally { await store.unlock(`claim:${r.id}`); }
  }

  const now = new Date().toISOString();
  const first = r.client.name.split(" ")[0];
  const artist = await artists.bySlug(r.artist);
  const artistName = artist ? artist.name : "our team";
  const message = str(b.message, 2000);
  const site = baseUrl(req);
  const statusBtn = { label: "View your request", url: reqs.statusUrl(site, r) };
  let email = null;
  let newStatus = null;
  let historyNote = message || undefined;

  if (b.action === "delete") {
    if (!auth.isFull(me)) return send(res, 403, { error: "Only the Owner or a Site admin can delete requests." });
    if (r.apptId) await cal.cancelAppt(slugFor(r), r.apptId);
    await files.removeAll([...(r.images || []), ...(r.donePhotos || []).map((ph) => ph.name)]);
    await store.indexRemove("reqs", r.id);
    await store.del(`req:${r.id}`);
    console.log(`[delete] request ${r.id} (${r.client.name}) deleted by ${me.name}`);
    return send(res, 200, { ok: true, deleted: r.id });
  }

  const W = config.words || {};
  switch (b.action) {
    case "quote": // older name for "offer": price + session length
      if (!str(b.quote, 60)) return send(res, 400, { error: "Enter a price or price range." });
      if (!config.sessionLengths.includes(Number(b.durationMin))) return send(res, 400, { error: "Pick a session length." });
      b.price = b.quote;
      // falls through
    case "offer": { // send the client an offer, or counter theirs
      if (["booked", "done", "declined"].includes(r.status)) return send(res, 400, { error: "This one is already settled. Reopen it to send a new offer." });
      const made = offers.shopOffer(r, config, b, by === "shop" ? undefined : by);
      if (made.error) return send(res, 400, { error: made.error });
      if (r.apptId) { await cal.cancelAppt(slugFor(r), r.apptId); r.apptId = null; }
      const o = made.offer;
      r.session = o.durationMin ? { durationMin: o.durationMin } : r.session;
      r.quoteAccepted = null; r.agreed = null;
      newStatus = "quoted";
      r.clientView = { ...r.clientView, quote: o.price || "", deposit: o.deposit || "", message, when: "" };
      historyNote = `${made.countered?.from === "client" ? "Countered" : "Offered"} ${offers.summary(o, config)}${message ? ` — ${message}` : ""}`;
      const can = ["price", "datetime", "scope", "terms"].filter((k) => config.negotiate?.[k]);
      email = { subject: `${made.countered ? "New offer" : "Your offer"} from ${config.studio.name}`, title: `${artistName} sent you an offer`,
        paragraphs: [`Hi ${first},`, offers.lines(o, config), message,
          `Accept it${can.length ? ", send a counter-offer" : ""}, ask a question or turn it down from your request page.`],
        button: { label: "Review the offer", url: reqs.statusUrl(site, r) } };
      break;
    }

    case "acceptOffer": { // accept the client's open offer
      const acc = offers.accept(r, "shop");
      if (acc.error) return send(res, 400, { error: acc.error });
      const st = await deal.settle(r, config, { slug: slugFor(r), force: b.force === true });
      if (st.conflict) return send(res, 409, { error: `That time overlaps ${deal.conflictText(st.conflict)}, including the gap between ${W.session || "session"}s. Accept anyway?`, conflict: true });
      historyNote = `Accepted their offer: ${offers.summary(acc.offer, config)}${message ? ` — ${message}` : ""}`;
      r.history.push({ at: now, status: r.status, by, note: historyNote });
      r.clientView.message = message;
      email = st.status === "booked"
        ? { subject: `You're booked: ${r.clientView.when}`, title: "Your offer was accepted. You're booked.", paragraphs: [`Hi ${first},`, `${artistName} accepted your offer.`, offers.lines(acc.offer, config), message,
            config.studio.address ? `${config.studio.name}, ${config.studio.address}.` : ""], button: statusBtn }
        : st.status === "scheduling"
        ? { subject: `Offer accepted — pick your time`, title: "Your offer was accepted", paragraphs: [`Hi ${first},`, `${artistName} accepted your offer.`, offers.lines(acc.offer, config), message, "Pick any open time that works for you."],
            button: { label: "Pick your time", url: reqs.scheduleUrl(site, r) } }
        : { subject: `Offer accepted — ${config.studio.name}`, title: "Your offer was accepted", paragraphs: [`Hi ${first},`, `${artistName} accepted your offer.`, offers.lines(acc.offer, config), message, "They'll confirm the time with you."], button: statusBtn };
      break;
    }

    case "reply": {
      if (!message) return send(res, 400, { error: "Type your reply first." });
      (r.messages ||= []).push({ at: now, from: "shop", by: me.id === "shop" ? undefined : me.name, text: message });
      email = { subject: `Reply about your request — ${config.studio.name}`, title: `${artistName} replied`,
        paragraphs: [`Hi ${first},`, message], button: statusBtn };
      break;
    }

    case "addPhotos": { // finished-tattoo photos from the artist
      if (r.status !== "done") return send(res, 400, { error: `Mark the ${W.job || "booking"} done first.` });
      const decoded = files.decode(b.images);
      if (decoded.error) return send(res, 400, { error: decoded.error });
      if (!decoded.files.length) return send(res, 400, { error: "Pick at least one photo." });
      if ((r.donePhotos || []).length + decoded.files.length > files.MAX_DONE) return send(res, 400, { error: `Up to ${files.MAX_DONE} photos per ${W.job || "booking"}.` });
      const names = await files.saveDone(decoded.files, r.id);
      (r.donePhotos ||= []).push(...names.map((name) => ({ name, by, at: now })));
      r.history.push({ at: now, status: r.status, by, note: `Added ${names.length} photo${names.length > 1 ? "s" : ""} of the finished ${W.job || "work"}` });
      break;
    }

    case "removePhoto": {
      const name = str(b.photo, 300);
      const before = (r.donePhotos || []).length;
      r.donePhotos = (r.donePhotos || []).filter((ph) => ph.name !== name);
      if (r.donePhotos.length === before) return send(res, 404, { error: "Photo not found." });
      r.history.push({ at: now, status: r.status, by, note: `Removed a photo of the finished ${W.job || "work"}` });
      break;
    }

    case "seen":
      r.unread = false;
      await reqs.save(r);
      return send(res, 200, { ok: true });

    case "schedule": { // approve + send the client a link to pick their own time
      const durationMin = Number(b.durationMin);
      if (!config.sessionLengths.includes(durationMin)) return send(res, 400, { error: "Pick a session length." });
      const deposit = str(b.deposit, 120); // money is a placeholder: free text like "$100 cash or card at the shop"
      const depositUrl = str(b.depositUrl, 500);
      if (depositUrl && !isHttps(depositUrl)) return send(res, 400, { error: "Payment link must start with https://" });
      if (r.apptId) { await cal.cancelAppt(slugFor(r), r.apptId); r.apptId = null; }
      r.session = { durationMin };
      newStatus = "scheduling";
      r.clientView = { ...r.clientView, deposit, depositUrl, message, when: "" };
      historyNote = `Booking link sent (${hours(durationMin)})${message ? ` — ${message}` : ""}`;
      email = { subject: `Pick your time — ${config.studio.name}`, title: "You're approved. Pick your time.",
        paragraphs: [`Hi ${first},`, `${artistName} is ready to book your ${hours(durationMin)} ${W.session || "session"}. Choose any open time that works for you.`,
          message, deposit ? `Deposit: ${deposit}. It holds your date and comes off the final price.` : ""],
        button: { label: "Pick your time", url: reqs.scheduleUrl(site, r) } };
      break;
    }

    case "book": { // shop books a specific time (phone / in-person bookings)
      const start = T.parseLocal(b.start);
      const durationMin = Number(b.durationMin);
      if (!start) return send(res, 400, { error: "Pick a date and start time." });
      if (!config.sessionLengths.includes(durationMin)) return send(res, 400, { error: "Pick a session length." });
      const slug = slugFor(r);
      const end = start + durationMin * 60e3;
      const conflict = cal.conflictFor({
        start, end, settings: await cal.getSettings(slug), blocks: await cal.getBlocks(slug),
        appts: [...await cal.apptsBetween(slug, start - cal.DAY, end + cal.DAY), ...await require("../../lib/extcal").busyAsAppts(slug)], ignoreApptId: r.apptId, strict: false,
      });
      if (conflict && b.force !== true) {
        const w = conflict.with;
        const what = conflict.reason === "appointment" ? (w.external ? `"${w.title || "an event"}" on your ${w.source || "other"} calendar (${w.allDay ? "all day" : T.timeLabel(w.start)})` : `${w.clientName || "another appointment"} at ${T.timeLabel(w.start)}`) : `blocked time${w.note ? ` (${w.note})` : ""}`;
        return send(res, 409, { error: `That overlaps ${what}, including the gap between sessions.`, conflict: true });
      }
      if (r.apptId) await cal.cancelAppt(slug, r.apptId);
      const appt = await cal.createAppt({ slug, start, durationMin, requestId: r.id, clientName: r.client.name, title: r.details.idea.slice(0, 80), source: "shop" });
      const when = T.rangeLabel(appt.start, appt.end);
      r.apptId = appt.id;
      r.session = { durationMin };
      newStatus = "booked";
      r.clientView = { ...r.clientView, when, message };
      historyNote = `${when}${message ? ` — ${message}` : ""}`;
      email = { subject: `You're booked: ${when}`, title: "You're booked",
        paragraphs: [`Hi ${first},`, `Appointment with ${artistName}: ${when}.`, message,
          config.studio.address ? `${config.studio.name}, ${config.studio.address}.` : "", W.prep || ""],
        button: statusBtn };
      break;
    }

    case "confirmTime": { // client's requested time → booked
      if (r.status !== "pending" || !r.apptId) return send(res, 400, { error: "There's no requested time to confirm." });
      const appt = await cal.confirmAppt(r.apptId);
      if (!appt) return send(res, 400, { error: "That time is no longer on the calendar. Ask the client for another time." });
      const when = T.rangeLabel(appt.start, appt.end);
      newStatus = "booked";
      r.clientView = { ...r.clientView, when, message };
      historyNote = `Confirmed ${when}${message ? ` — ${message}` : ""}`;
      email = { subject: `You're booked: ${when}`, title: "You're booked",
        paragraphs: [`Hi ${first},`, `${artistName} confirmed your appointment: ${when}.`, message,
          config.studio.address ? `${config.studio.name}, ${config.studio.address}.` : "", W.prep || "",
          config.studio.phone ? `Need to change it? Call ${config.studio.phone}.` : ""],
        button: { label: "View your booking", url: reqs.statusUrl(site, r) } };
      break;
    }

    case "declineTime": { // free the requested time; client picks again
      if (r.status !== "pending") return send(res, 400, { error: "There's no requested time to turn down." });
      if (r.apptId) { await cal.cancelAppt(slugFor(r), r.apptId); r.apptId = null; }
      newStatus = "scheduling";
      r.clientView = { ...r.clientView, when: "", message };
      historyNote = `Asked for another time${message ? ` — ${message}` : ""}`;
      email = { subject: `Please pick another time — ${config.studio.name}`, title: "That time doesn't work",
        paragraphs: [`Hi ${first},`, message || `${artistName} can't do that time. Please pick another one that works for you.`],
        button: { label: "Pick another time", url: reqs.scheduleUrl(site, r) } };
      break;
    }

    case "cancelAppt": { // free the time; client can pick again if a session length is set
      if (!r.apptId) return send(res, 400, { error: "There's no appointment to cancel." });
      await cal.cancelAppt(slugFor(r), r.apptId);
      r.apptId = null;
      newStatus = r.session ? "scheduling" : r.agreed ? "agreed" : "quoted";
      r.clientView = { ...r.clientView, when: "", message };
      historyNote = `Appointment cancelled${message ? ` — ${message}` : ""}`;
      email = { subject: `Your appointment was cancelled — ${config.studio.name}`, title: "Your appointment was cancelled",
        paragraphs: [`Hi ${first},`, message || "Your appointment time was cancelled.",
          r.session ? "You can pick a new time with the link below." : "Reply to this email to set a new time."],
        button: r.session ? { label: "Pick a new time", url: reqs.scheduleUrl(site, r) } : statusBtn };
      break;
    }

    case "done":
      newStatus = "done";
      break;

    case "decline":
      if (r.apptId) { await cal.cancelAppt(slugFor(r), r.apptId); r.apptId = null; }
      newStatus = "declined";
      r.clientView = { ...r.clientView, message, when: "" };
      email = { subject: `About your request — ${config.studio.name}`, title: "About your request",
        paragraphs: [message || `Hi ${first}, thanks for reaching out. We can't take this request on right now.`], button: null };
      break;

    case "reopen":
      newStatus = "new";
      break;

    case "note": {
      const text = str(b.text, 1000);
      if (!text) return send(res, 400, { error: "Note is empty." });
      r.notes.push({ at: now, text, by: me.id === "shop" ? undefined : me.name });
      break;
    }

    case "assign": {
      if (!auth.seesAll(me)) return send(res, 403, { error: "Ask the front desk or the shop owner to move this to another artist." });
      const slug = str(b.artist, 60);
      const to = slug === "any" ? null : await artists.bySlug(slug);
      if (slug !== "any" && !to) return send(res, 400, { error: "Unknown artist." });
      if (r.apptId) return send(res, 400, { error: "Cancel the appointment before moving this to another artist." });
      r.artist = slug;
      r.history.push({ at: now, status: r.status, by, note: to ? `Assigned to ${to.name}` : "Moved back to No preference" });
      break;
    }

    default:
      return send(res, 400, { error: "Unknown action." });
  }

  r.unread = false; // Nathan acted on it
  if (newStatus) {
    r.status = newStatus;
    r.history.push({ at: now, status: newStatus, by, note: historyNote });
  }
  await reqs.save(r);

  let emailed = null; // "sent" | "off" (email not set up) | "failed" | null (nothing to send)
  if (email && b.notify !== false) {
    const e = await sendEmail({ to: r.client.email, replyTo: artist?.email || config.studio.contactEmail || undefined,
      ...email, paragraphs: email.paragraphs.filter(Boolean) });
    emailed = e.dev ? "off" : e.ok ? "sent" : "failed";
  }

  // Texts: the client (if they opted in) for anything that changes what they should do next.
  const statusLink = reqs.statusUrl(site, r), pickLink = reqs.scheduleUrl(site, r);
  const clientText = {
    quote: `New offer from ${config.studio.name}: ${r.offers?.length ? offers.summary(r.offers[r.offers.length - 1], config) : r.clientView?.quote || ""}. Review it: ${statusLink}`,
    offer: `New offer from ${config.studio.name}: ${r.offers?.length ? offers.summary(r.offers[r.offers.length - 1], config) : ""}. Accept, counter or ask: ${statusLink}`,
    acceptOffer: r.status === "booked" ? `Your offer was accepted. You're booked: ${r.clientView?.when}. ${statusLink}` : r.status === "scheduling" ? `Your offer was accepted! Pick your time: ${pickLink}` : `Your offer was accepted: ${statusLink}`,
    schedule: `You're approved! Pick your appointment time: ${pickLink}`,
    reply: `${artistName.split(" ")[0]} replied about your request: ${statusLink}`,
    confirmTime: `You're booked: ${r.clientView?.when}. Details: ${statusLink}`,
    book: `You're booked: ${r.clientView?.when}. Details: ${statusLink}`,
    declineTime: `That time doesn't work. Please pick another: ${pickLink}`,
    cancelAppt: `Your appointment was cancelled. ${r.session ? `Pick a new time: ${pickLink}` : `Details: ${statusLink}`}`,
    decline: `An update on your request: ${statusLink}`,
  }[b.action];
  let texted = null;
  if (clientText && b.notify !== false && r.client.smsOk && r.client.phone) {
    const t = await sms.textClient(r, clientText);
    texted = t.dev ? "off" : t.ok ? "sent" : t.skipped ? null : "failed";
  }
  // A confirmed booking is also confirmed to the artist, by email and text.
  if (["confirmTime", "book", "acceptOffer"].includes(b.action) && r.status === "booked") {
    const slug = slugFor(r);
    const note = `${r.client.name}, ${r.clientView?.when}. ${r.details.idea.slice(0, 80)}`;
    await Promise.all([
      sendEmail({ to: [config.studio.contactEmail, artist?.email, ...(await auth.artistEmails(slug))].filter(Boolean), replyTo: r.client.email,
        subject: `Booked: ${r.client.name}, ${r.clientView?.when}`, title: "Appointment confirmed",
        paragraphs: [note, `Confirmed by ${by === "shop" ? "the shop" : by}.`, [r.client.phone, r.client.email].filter(Boolean).join(" · ")],
        button: { label: "Open in the inbox", url: `${site}/admin#${r.id}` } }),
      sms.textArtists(slug, `Booked: ${note}`),
    ]);
  }

  const out = { ...r, links: { status: reqs.statusUrl(site, r), schedule: reqs.scheduleUrl(site, r) },
    donePhotos: (r.donePhotos || []).map((ph) => ({ ...ph, url: files.adminUrl(ph.name) })) }; delete out.token;
  return send(res, 200, { ok: true, emailed, texted, request: out });
};

// Beam Book: run this endpoint for the shop at this web address.
module.exports = require("../../lib/tenant").handler(module.exports);
