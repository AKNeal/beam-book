// POST /api/requests — a client sends a booking request to a business.
// The questions come from the business's form (lib/templates.js). If the business lets clients make the first
// offer, the request can carry one ({offer: {price, date, time, durationMin, scope}}), which opens the negotiation.

const config = require("../config/studio");
const store = require("../lib/store");
const artists = require("../lib/artists");
const files = require("../lib/files");
const sms = require("../lib/sms");
const offers = require("../lib/offers");
const { readAnswers, answerText } = require("../lib/templates");
const { sendEmail } = require("../lib/email");
const { send, method, body, ip, id, str, baseUrl } = require("../lib/http");
const reqs = require("../lib/requests");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  const b = body(req);
  const W = config.words, form = config.form || [];

  // Bots fill hidden fields; act as if it worked.
  if (str(b.website)) return send(res, 200, { ok: true, id: "x", token: "x" });

  const f = {
    artist: str(b.artist, 60) || "any",
    name: str(b.name, 80),
    email: str(b.email, 120).toLowerCase(),
    phone: str(b.phone, 30),
    smsOk: b.smsOk === true,
    instagram: str(b.instagram, 60),
    idea: str(b.idea, 2000),
  };

  const errors = {};
  if (f.name.length < 2) errors.name = "Tell us your name.";
  if (!EMAIL_RE.test(f.email)) errors.email = "Enter a valid email so we can reply.";
  if (f.idea.length < 10) errors.idea = "Describe it in a sentence or two.";
  if (f.smsOk && !sms.toE164(f.phone)) errors.phone = "Enter a US mobile number to get texts, or untick the text box.";
  const { answers, errors: answerErrors } = readAnswers(form, b);
  Object.assign(errors, answerErrors);
  if (config.ageCheck && b.age18 !== true) errors.age18 = `You must be ${config.studio.minAge} or older to book.`;
  if (config.policyCheck && b.agreePolicy !== true) errors.agreePolicy = "Please accept the deposit policy.";

  let artist = null;
  if (f.artist !== "any") {
    artist = (await artists.list({ publicOnly: true })).find((a) => a.slug === f.artist) || null;
    if (!artist) errors.artist = `Pick a ${W.provider}.`;
    else if (!artist.booksOpen) return send(res, 409, { error: `${artist.name} isn't taking new bookings right now. Join the waitlist instead.`, booksClosed: true });
  }

  const photoField = form.find((q) => q.type === "photos");
  const decoded = photoField ? files.decode(b.images) : { files: [] };
  if (decoded.error) errors.images = decoded.error;

  // The client's opening offer, if this business negotiates that way.
  const draft = { offers: [] };
  if (config.negotiate?.clientOffersFirst && b.offer && typeof b.offer === "object" && Object.values(b.offer).some((v) => String(v ?? "").trim())) {
    const made = offers.clientOffer(draft, config, b.offer, { first: true });
    if (made.error) errors.offer = made.error;
  }
  if (Object.keys(errors).length) return send(res, 400, { error: "Please fix the highlighted fields.", fields: errors });

  // 5 submitted requests per connection per hour (fixing form mistakes doesn't count).
  if ((await store.hit(`rl:req:${ip(req)}`, 3600)) > 5) {
    return send(res, 429, { error: "Too many requests from this connection. Please try again in an hour." });
  }

  const reqId = `${Date.now().toString(36)}-${id(3)}`;
  const token = id(12);
  let images = [];
  try { images = await files.save(decoded.files, reqId); }
  catch (e) { console.error("[upload]", e); return send(res, 500, { error: "Your photos didn't upload. Try again, or send without photos." }); }

  const now = new Date().toISOString();
  const record = {
    id: reqId, token, createdAt: now, updatedAt: now, status: "new",
    artist: artist ? artist.slug : "any",
    client: { name: f.name, email: f.email, phone: f.phone, instagram: f.instagram, smsOk: f.smsOk, smsOkAt: f.smsOk ? now : null },
    details: { idea: f.idea, answers },
    offers: draft.offers,
    images, notes: [],
    clientView: { message: "", quote: "", when: "", depositUrl: "" },
    history: [{ at: now, status: "new", by: "client", note: draft.offers[0] ? `Offered ${offers.summary(draft.offers[0], config)}` : undefined }],
    consent: { age18: Boolean(config.ageCheck), policy: Boolean(config.policyCheck), policyText: config.policyCheck ? config.depositPolicy : "", at: now },
  };

  await store.setJSON(`req:${reqId}`, record);
  await store.indexAdd("reqs", reqId, Date.now());

  const site = baseUrl(req);
  const statusUrl = reqs.statusUrl(site, record);
  const who = artist ? artist.name : `the first available ${W.provider}`;
  const facts = answers.map((a) => `${a.label}: ${answerText(a)}`).join("\n");
  const offerText = draft.offers[0] ? `Their offer:\n${offers.lines(draft.offers[0], config)}` : "";

  const auth = require("../lib/auth");
  const openToAll = !artist;
  const artistLogins = await auth.artistEmails(artist ? artist.slug : null);
  await Promise.all([
    openToAll && artistLogins.length ? sendEmail({ // everyone hears about open requests; first to take it gets it
      to: artistLogins, subject: `Open request: ${f.idea.slice(0, 60)}`, title: `New request open to all ${W.providers}`,
      paragraphs: [`${f.name.split(" ")[0]} wants: ${f.idea}`, facts, offerText, `Photos: ${images.length}`, "The first to take it in the inbox gets it."],
      button: { label: "See it in the inbox", url: `${site}/admin#${reqId}` },
    }) : null,
    sendEmail({
      to: [config.studio.contactEmail, artist?.email, ...(artist ? artistLogins : [])],
      replyTo: f.email,
      subject: `New ${W.job} request — ${f.name}${artist ? ` (${artist.name})` : ""}`,
      title: `New ${W.job} request`,
      paragraphs: [`${f.name} wants: ${f.idea}`, `For: ${who}`, facts, offerText, images.length ? `Photos: ${images.length}` : "",
        `Contact: ${f.email}${f.phone ? ` · ${f.phone}` : ""}${f.instagram ? ` · ${f.instagram}` : ""}`],
      button: { label: "Open the inbox", url: `${site}/admin#${reqId}` },
    }),
    sendEmail({
      to: f.email,
      replyTo: config.studio.contactEmail || undefined,
      subject: `We got your request — ${config.studio.name}`,
      title: `Thanks, ${f.name.split(" ")[0]}. Your request is in.`,
      paragraphs: [`${artist ? artist.name : config.studio.name} will review it and get back to you${draft.offers[0] ? " about your offer" : ""}.`,
        "You can check where it stands, answer offers and send questions with the link below."],
      button: { label: "View your request", url: statusUrl },
    }),
  ]);

  await Promise.all([
    sms.textClient(record, `Got your request. You'll get a text when ${artist ? artist.name.split(" ")[0] : "the team"} replies. Status: ${statusUrl}`),
    sms.textArtists(artist ? artist.slug : null, artist
      ? `New request from ${f.name}: ${f.idea.slice(0, 80)}${draft.offers[0] ? ` (offers ${offers.summary(draft.offers[0], config)})` : ""}. ${site}/admin#${reqId}`
      : `Open request from ${f.name.split(" ")[0]}: ${f.idea.slice(0, 80)}. First to take it gets it. ${site}/admin#${reqId}`),
  ]);
  return send(res, 201, { ok: true, id: reqId, token });
};

// Beam Book: run this endpoint for the shop at this web address.
module.exports = require("../lib/tenant").handler(module.exports);
