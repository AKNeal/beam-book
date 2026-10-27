// The client's private status page (link from their email or text).
//   GET  /api/status?id=&t=                                  where the request stands
//   POST /api/status {id, t, action:"accept"}                 accept the business's offer (booked, or pick a time)
//   POST /api/status {id, t, action:"counter", price?, date?, time?, durationMin?, scope?, terms?, deposit?, message?}
//                                                            counter-offer (only the terms this business lets clients change)
//   POST /api/status {id, t, action:"decline", message?}      turn the offer down
//   POST /api/status {id, t, action:"ask", message}           send the shop a question (shows in the inbox)
//   POST /api/status {id, t, action:"addPhotos", images}      photos of the finished tattoo (once it's done)
//   GET  /api/status?id=&t=&photo=<name>                      one of this request's finished-tattoo photos

const config = require("../config/studio");
const cal = require("../lib/calendar");
const store = require("../lib/store");
const artists = require("../lib/artists");
const reqs = require("../lib/requests");
const { sendEmail } = require("../lib/email");
const files = require("../lib/files");
const offers = require("../lib/offers");
const deal = require("../lib/deal");
const { answerText } = require("../lib/templates");
const { send, body, ip, str, baseUrl } = require("../lib/http");

const LABELS = {
  new: "Received — waiting for a reply",
  quoted: "Offer — accept, counter or ask",
  agreed: "Agreed — the time is being set",
  scheduling: "Approved — pick your appointment time",
  pending: "Time requested — waiting for the artist to confirm",
  deposit: "Deposit requested",
  booked: "Booked",
  done: "Complete",
  declined: "Not taken on",
};
const NOT_FOUND = "We couldn't find that request. Use the link from your email or text.";
const hours = (min) => (min % 60 ? `${(min / 60).toFixed(1)} hours` : `${min / 60} hour${min === 60 ? "" : "s"}`);

module.exports = async function handler(req, res) {
  if (req.method === "GET") return get(req, res);
  if (req.method === "POST") return post(req, res);
  res.setHeader("Allow", "GET, POST");
  return send(res, 405, { error: "Method not allowed" });
};

async function view(r, token) {
  const a = await artists.bySlug(r.artist);
  const appt = r.status === "booked" ? await cal.getAppt(r.apptId) : null;
  return {
    status: r.status,
    label: LABELS[r.status] || r.status,
    steps: ["new", "quoted", "scheduling", "pending", "booked", "done"],
    artist: a ? a.name : `the first available ${config.words?.provider || "artist"}`,
    createdAt: r.createdAt,
    idea: r.details.idea,
    placement: r.details.placement || "",
    answers: (r.details.answers || []).map((x) => ({ label: x.label, value: answerText(x) })),
    words: config.words, negotiate: config.negotiate, sessionLengths: config.sessionLengths, timeZone: config.studio.timeZone,
    offers: (r.offers || []).map((o) => ({ ...o, by: undefined, from: o.from === "client" ? "you" : "shop", summary: offers.summary(o, config) })),
    agreed: r.agreed ? { ...r.agreed, by: undefined, summary: offers.summary(r.agreed, config) } : null,
    canCounter: !["booked", "done", "declined"].includes(r.status) && ["price", "datetime", "scope", "terms"].some((k) => config.negotiate?.[k]) && offers.open(r)?.from === "shop",
    canSchedule: r.status === "scheduling" && Boolean(r.session),
    canAccept: offers.open(r)?.from === "shop" || (r.status === "quoted" && !r.quoteAccepted && !(r.offers || []).length),
    quoteAccepted: Boolean(r.quoteAccepted),
    session: r.session ? hours(r.session.durationMin) : "",
    canMessage: !["done", "declined"].includes(r.status),
    messages: (r.messages || []).map((m) => ({ at: m.at, from: m.from === "client" ? "you" : "shop", text: m.text })),
    hasCalendarFile: Boolean(appt),
    donePhotos: (r.donePhotos || []).map((ph) => ({ url: files.clientUrl(ph.name, r, token), byYou: ph.by === "client", at: ph.at })),
    canAddPhotos: r.status === "done" && (r.donePhotos || []).length < files.MAX_DONE,
    ...r.clientView,
  };
}

async function get(req, res) {
  const q = new URL(req.url, "http://x").searchParams;
  const r = await reqs.byToken(q.get("id"), q.get("t"));
  if (!r) return send(res, 404, { error: NOT_FOUND });
  const photo = q.get("photo");
  if (photo) {
    if (!files.donePattern(r.id).test(photo) || !(r.donePhotos || []).some((ph) => ph.name === photo)) return send(res, 404, { error: "Photo not found." });
    return files.stream(res, photo, send);
  }
  return send(res, 200, await view(r, q.get("t")));
}

async function post(req, res) {
  if ((await store.hit(`rl:status:${ip(req)}`, 3600)) > 30) return send(res, 429, { error: "Too many tries. Please call the shop." });
  const b = body(req);
  const r = await reqs.byToken(str(b.id, 40), str(b.t, 40));
  if (!r) return send(res, 404, { error: NOT_FOUND });
  const now = new Date().toISOString();
  const message = str(b.message, 1500);
  const site = baseUrl(req);
  const artist = await artists.bySlug(r.artist);
  const shopTo = [config.studio.contactEmail, artist?.email].filter(Boolean);
  const inboxBtn = { label: "Open in the inbox", url: `${site}/admin#${r.id}` };
  let alert = null;

  switch (b.action) {
    case "accept": {
      if (offers.open(r)?.from === "shop") {
        const acc = offers.accept(r, "client");
        const st = await deal.settle(r, config, { slug: r.artist !== "any" ? r.artist : config.artists[0].slug });
        if (st.conflict) { // the business offered a time that's since been taken
          offers.open(r) || (acc.offer.status = "open"); r.agreed = null;
          return send(res, 409, { error: "That time was just taken. Ask for another time, or send a counter-offer." });
        }
        r.unread = true;
        r.history.push({ at: now, status: r.status, by: "client", note: `Accepted the offer: ${offers.summary(acc.offer, config)}` });
        alert = { subject: `${r.client.name} accepted your offer`, title: st.status === "booked" ? "Offer accepted — booked" : "Offer accepted",
          paragraphs: [`${r.client.name} accepted: ${offers.summary(acc.offer, config)}`, `For: ${r.details.idea}`,
            st.status === "booked" ? `It's on the calendar: ${r.clientView.when}.` : st.status === "scheduling" ? "They're picking a time now." : "Set the time from the inbox (Book a time)."] };
        if (st.status === "booked") {
          const auth = require("../lib/auth");
          await require("../lib/sms").textArtists(r.artist !== "any" ? r.artist : null, `Booked: ${r.client.name}, ${r.clientView.when}. ${r.details.idea.slice(0, 60)}`);
          shopTo.push(...await auth.artistEmails(r.artist !== "any" ? r.artist : null));
        }
        break;
      }
      if (r.status !== "quoted") return send(res, 409, { error: "This offer can't be accepted right now. Refresh the page." });
      r.quoteAccepted = now;
      r.unread = true;
      if (r.session) {
        r.status = "scheduling";
        r.history.push({ at: now, status: "scheduling", by: "client", note: `Accepted the quote (${r.clientView?.quote || "no price"}) and is picking a time` });
      } else { // older quotes without a session length: Nathan sends the booking link
        r.history.push({ at: now, status: "quoted", by: "client", note: `Accepted the quote (${r.clientView?.quote || "no price"}). Send the booking link.` });
      }
      alert = { subject: `${r.client.name} accepted your quote`, title: "Quote accepted",
        paragraphs: [`${r.client.name} accepted ${r.clientView?.quote || "the quote"} for: ${r.details.idea}`,
          r.session ? "They're picking a time now. You'll get another email when they book." : "Send them a booking link from the inbox."] };
      break;
    }
    case "counter": {
      if (offers.open(r)?.from !== "shop") return send(res, 409, { error: "There's no offer to answer right now. Refresh the page." });
      const made = offers.clientOffer(r, config, b);
      if (made.error) return send(res, 400, { error: made.error });
      r.status = "quoted"; r.unread = true;
      r.history.push({ at: now, status: "quoted", by: "client", note: `Countered: ${offers.summary(made.offer, config)}${message ? ` — ${message}` : ""}` });
      alert = { subject: `${r.client.name} sent a counter-offer`, title: "Counter-offer",
        paragraphs: [`${r.client.name} countered your offer for: ${r.details.idea}`, offers.lines(made.offer, config), message ? `Their note: ${message}` : "",
          "Accept it, counter again or decline from the inbox."] };
      break;
    }
    case "decline": {
      if (offers.open(r)?.from === "shop") offers.decline(r, "client");
      else if (r.status !== "quoted") return send(res, 409, { error: "This offer can't be declined right now. Refresh the page." });
      r.status = "declined";
      r.declinedBy = "client";
      r.unread = true;
      r.clientView = { ...r.clientView, message: "You turned down this offer. You're welcome to send a new request any time." };
      if (message) (r.messages ||= []).push({ at: now, from: "client", text: message });
      r.history.push({ at: now, status: "declined", by: "client", note: `Client turned down the offer${message ? ` — ${message}` : ""}` });
      alert = { subject: `${r.client.name} turned down your offer`, title: "Offer turned down",
        paragraphs: [`${r.client.name} turned down ${r.clientView?.quote || "the offer"} for: ${r.details.idea}`, message ? `Their note: ${message}` : ""] };
      break;
    }
    case "ask": {
      if (["done", "declined"].includes(r.status)) return send(res, 409, { error: "This request is closed. Call the shop or send a new request." });
      if (message.length < 2) return send(res, 400, { error: "Type your question first." });
      if ((r.messages || []).filter((m) => m.from === "client" && Date.parse(m.at) > Date.now() - 3600e3).length >= 5)
        return send(res, 429, { error: "That's a lot of messages in an hour. The shop will reply soon, or give them a call." });
      (r.messages ||= []).push({ at: now, from: "client", text: message });
      r.unread = true;
      alert = { subject: `Question from ${r.client.name}`, title: `${r.client.name} asked a question`,
        paragraphs: [message, `About: ${r.details.idea}`, "Reply from the inbox so it shows on their request page."] };
      break;
    }
    case "addPhotos": {
      if (r.status !== "done") return send(res, 409, { error: "You can add photos once it's marked done." });
      const decoded = files.decode(b.images);
      if (decoded.error) return send(res, 400, { error: decoded.error });
      if (!decoded.files.length) return send(res, 400, { error: "Pick at least one photo." });
      if ((r.donePhotos || []).length + decoded.files.length > files.MAX_DONE) return send(res, 400, { error: `Up to ${files.MAX_DONE} photos.` });
      const names = await files.saveDone(decoded.files, r.id);
      (r.donePhotos ||= []).push(...names.map((name) => ({ name, by: "client", at: now })));
      r.unread = true;
      r.history.push({ at: now, status: r.status, by: "client", note: `Added ${names.length} photo${names.length > 1 ? "s" : ""}` });
      alert = { subject: `${r.client.name} added photos`, title: "New photos",
        paragraphs: [`${r.client.name} added ${names.length} photo${names.length > 1 ? "s" : ""}: ${r.details.idea}`] };
      break;
    }
    default:
      return send(res, 400, { error: "Unknown action." });
  }

  await reqs.save(r);
  if (alert && shopTo.length) await sendEmail({ to: shopTo, replyTo: r.client.email, ...alert, paragraphs: alert.paragraphs.filter(Boolean), button: inboxBtn });
  const out = await view(r, str(b.t, 40));
  if (b.action === "accept" && out.canSchedule) out.scheduleUrl = `/schedule?id=${encodeURIComponent(r.id)}&t=${encodeURIComponent(str(b.t, 40))}`;
  return send(res, 200, out);
}

// Beam Book: run this endpoint for the shop at this web address.
module.exports = require("../lib/tenant").handler(module.exports);
