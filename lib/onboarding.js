// Shop onboarding: a private link (no login) where the owner fills in the shop's details, socials and team.
// Answers go straight where they're used: shop details and socials into the shop's settings (the website reads them
// from GET /api/artists), each barber's title, bio, Instagram and photo into their profile (Meet the Team), and the
// rest (promotions, policies, notes) into the shop's onboarding record that Neal Media reads.
// One link per shop; making a new link stops the old one.

const crypto = require("crypto");
const config = require("../config/studio");
const store = require("./store");
const tenant = require("./tenant");
const artists = require("./artists");
const files = require("./files");

const s = (v, n) => String(v ?? "").trim().slice(0, n);
const SOCIALS = ["instagram", "facebook", "tiktok", "youtube", "google", "x", "other"];
const SOCIAL_LABEL = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube", google: "Google Business", x: "X (Twitter)", other: "Other link" };
const url = (v) => { const x = s(v, 300); if (!x) return ""; return /^https?:\/\//i.test(x) ? x : x.startsWith("@") ? x : `https://${x}`; };

async function makeLink(base, { keep = false } = {}) {
  const old = keep ? await store.getJSON("onboard:token") : null;
  const t = old || crypto.randomBytes(18).toString("base64url");
  if (!old) await store.setJSON("onboard:token", t);
  return `${base}/onboarding?shop=${encodeURIComponent(config.tenant)}&t=${t}`;
}
async function check(t) { const want = await store.getJSON("onboard:token"); return Boolean(want && t && want.length === String(t).length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(t)))); }

// What the page shows: current values, so the owner corrects rather than retypes.
async function view() {
  const st = config.studio, prev = (await store.getJSON("onboard:answers")) || {};
  const team = (await artists.list()).map((a) => ({ slug: a.slug, name: a.name, title: a.title || "", years: a.years || "", styles: (a.styles || []).join(", "),
    bio: a.bio || "", instagram: a.instagram || "", socials: a.socials || {}, listed: a.listed !== false, photo: a.photo ? artists.photoUrl(a) : "" }));
  const th = config.theme || {};
  return {
    logo: th.logo ? `/api/artists?logo=1&v=${encodeURIComponent(String(th.logoV || 1))}` : "", accent: /^#[0-9a-f]{6}$/i.test(th.accent || "") ? th.accent : "#e3262f",
    shop: { name: st.name, phone: st.phone, email: st.contactEmail, address: st.address, website: st.website, about: st.about || "", founded: st.founded || "",
      hoursNote: st.hoursNote || "", walkIns: st.walkIns || "", parking: st.parking || "", payments: st.payments || "" },
    socials: Object.fromEntries(SOCIALS.map((k) => [k, (config.socials || {})[k] || (k === "instagram" && st.instagram ? st.instagram : "")])),
    socialLabels: SOCIAL_LABEL, barberSocials: artists.BARBER_SOCIALS, team, extra: prev.extra || {}, submittedAt: prev.at || null,
  };
}

async function save(b) {
  const rec = await tenant.getRecord(config.tenant);
  const sh = b.shop || {}, st = { ...(rec.studio || {}) };
  const set = (k, v, n) => { if (v !== undefined) st[k] = s(v, n); };
  set("phone", sh.phone, 30); set("contactEmail", sh.email, 120); set("address", sh.address, 200); set("website", sh.website ? url(sh.website) : sh.website, 200);
  set("about", sh.about, 1500); set("founded", sh.founded, 10); set("hoursNote", sh.hoursNote, 300); set("walkIns", sh.walkIns, 200);
  set("parking", sh.parking, 200); set("payments", sh.payments, 200);
  const socials = { ...(rec.socials || {}) };
  for (const k of SOCIALS) if (b.socials && b.socials[k] !== undefined) socials[k] = url(b.socials[k]);
  if (socials.instagram) { const h = socials.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").replace(/^@/, ""); if (/^[A-Za-z0-9._]{1,30}$/.test(h)) st.instagram = h; }
  await tenant.saveRecord({ ...rec, studio: st, socials });

  // The team, as they'll show on Meet the Team.
  const roster = await artists.list();
  let photos = 0;
  for (const m of (Array.isArray(b.team) ? b.team : []).slice(0, 30)) {
    const a = roster.find((x) => x.slug === m.slug); if (!a) continue;
    let ig = s(m.instagram, 60).replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").replace(/^@/, "");
    if (ig && !/^[A-Za-z0-9._]{1,30}$/.test(ig)) ig = "";
    const patch = { title: s(m.title, 60), years: s(m.years, 10), bio: s(m.bio, 800), instagram: ig ? `@${ig}` : "",
      styles: s(m.styles, 200).split(",").map((x) => x.trim().slice(0, 40)).filter(Boolean).slice(0, 8) };
    if (m.socials) patch.socials = artists.cleanSocials(m.socials);
    if (m.photo) { const d = files.decode([m.photo]); if (!d.error) { patch.photo = await files.saveArtistPhoto(a.slug, d.files[0]); photos++; } }
    await artists.setProfile(a.slug, patch);
    if (m.listed !== undefined) await artists.setListed(a.slug, Boolean(m.listed));
  }
  const prevAns = (await store.getJSON("onboard:answers")) || {};
  let extra = prevAns.extra || {}; // keep earlier answers when a save doesn't include them
  if (b.extra) { extra = {}; for (const [k, v] of Object.entries(b.extra).slice(0, 30)) extra[s(k, 40)] = s(v, 1500); }
  await store.setJSON("onboard:answers", { at: Date.now(), extra });
  return { ok: true, photos };
}

// ----- Setup steps (same private link): get paid, calendars, texting, email, try it, feedback -----
async function setup(base) {
  const pay = require("./payments"), sms = require("./sms"), email = require("./email"), extcal = require("./extcal"), cs = require("../api/calsync");
  let p = { enabled: pay.enabled() };
  try { p = await pay.status(); } catch (e) { p.error = e.message; }
  const team = await artists.list();
  const calendars = await Promise.all(team.filter((a) => a.listed).map(async (a) => {
    const c = await extcal.summary(a.slug);
    return { slug: a.slug, name: a.name, synced: c.filter((x) => !x.error).length, link: cs.linkFor(base, a.slug) };
  }));
  const dns = (config.siteChecklist || []).find((x) => x.key === "email_dns");
  const siteVals = ((await store.getJSON("site")) || {}).values || {};
  return {
    pay: { enabled: Boolean(p.enabled), testMode: Boolean(p.testMode), connected: Boolean(p.account), ready: Boolean(p.account?.ready), details: Boolean(p.account?.details), reader: Boolean(p.reader) },
    calendars, texting: sms.smsReady(), emailReady: email.emailReady(),
    emailDomain: dns ? { label: dns.label, details: dns.details || "", records: dns.records || [], done: Boolean(siteVals.email_dns) } : null,
    links: { booking: `${base}/appointment`, inbox: `${base}/admin` },
    feedback: ((await store.getJSON("onboard:feedback")) || []).slice(-20),
    done: (await store.getJSON("onboard:done")) || {},
    a2p: a2pView(await store.getJSON("onboard:a2p")),
  };
}
const STEPS = ["details", "pay", "calendar", "texting", "email", "test"];
async function markDone(step, on) {
  if (!STEPS.includes(step)) throw new Error("Unknown step.");
  const d = (await store.getJSON("onboard:done")) || {};
  if (on) d[step] = Date.now(); else delete d[step];
  await store.setJSON("onboard:done", d);
  return d;
}
async function addFeedback(b) {
  const text = s(b.text, 2000);
  if (text.length < 2) throw new Error("Type your feedback first.");
  const item = { id: crypto.randomBytes(4).toString("hex"), at: Date.now(), area: s(b.area, 40) || "General", mood: s(b.mood, 20), text, from: s(b.from, 80) };
  const list = (await store.getJSON("onboard:feedback")) || [];
  list.push(item); await store.setJSON("onboard:feedback", list.slice(-200));
  try { // to Neal Media, if email is set up
    const email = require("./email");
    if (email.emailReady()) await email.sendEmail({ to: process.env.NOTIFY_EMAIL || "nealmedia@yahoo.com", subject: `${config.studio.name} feedback: ${item.area}`,
      title: `Feedback from ${item.from || config.studio.name}`, paragraphs: [`Area: ${item.area}${item.mood ? ` · ${item.mood}` : ""}`, text] });
  } catch { /* saved either way */ }
  return item;
}
// Texting sign-up (A2P 10DLC brand for the shop's own local number). Private: only this link and Neal Media see it.
const A2P = ["legalName", "businessType", "ein", "industry", "street", "city", "state", "zip", "website", "contactName", "contactTitle", "contactEmail", "contactPhone"];
async function saveA2p(b) {
  const prev = (await store.getJSON("onboard:a2p")) || {};
  const out = { ...prev };
  for (const k of A2P) if (b[k] !== undefined && !(k === "ein" && !String(b[k]).trim())) out[k] = s(b[k], k === "street" ? 160 : 100);
  if (out.ein) { const d = out.ein.replace(/\D/g, ""); if (d.length !== 9) throw new Error("An EIN has 9 digits (like 12-3456789). Leave it blank if you don't have one."); out.ein = `${d.slice(0, 2)}-${d.slice(2)}`; }
  if (!out.legalName || !out.contactEmail) throw new Error("Add at least the legal business name and an email.");
  out.at = Date.now();
  await store.setJSON("onboard:a2p", out);
  try {
    const email = require("./email");
    if (email.emailReady()) await email.sendEmail({ to: process.env.NOTIFY_EMAIL || "nealmedia@yahoo.com", subject: `${config.studio.name}: texting sign-up details`,
      title: "Texting sign-up details (A2P 10DLC brand)", paragraphs: A2P.map((k) => `${k}: ${out[k] || ""}`) });
  } catch { /* saved either way */ }
  return a2pView(out);
}
const a2pView = (x) => (x ? { ...Object.fromEntries(A2P.map((k) => [k, x[k] || ""])), ein: x.ein ? `••-•••${x.ein.slice(-4)}` : "", einSet: Boolean(x.ein), at: x.at || null } : null);

const feedback = async () => (await store.getJSON("onboard:feedback")) || [];

module.exports = { makeLink, check, view, save, setup, saveA2p, markDone, addFeedback, feedback, STEPS, SOCIALS, SOCIAL_LABEL };
