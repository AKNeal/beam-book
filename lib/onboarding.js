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

async function makeLink(base) {
  const t = crypto.randomBytes(18).toString("base64url");
  await store.setJSON("onboard:token", t);
  return `${base}/onboarding?shop=${encodeURIComponent(config.tenant)}&t=${t}`;
}
async function check(t) { const want = await store.getJSON("onboard:token"); return Boolean(want && t && want.length === String(t).length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(t)))); }

// What the page shows: current values, so the owner corrects rather than retypes.
async function view() {
  const st = config.studio, prev = (await store.getJSON("onboard:answers")) || {};
  const team = (await artists.list()).map((a) => ({ slug: a.slug, name: a.name, title: a.title || "", years: a.years || "", styles: (a.styles || []).join(", "),
    bio: a.bio || "", instagram: a.instagram || "", listed: a.listed !== false, photo: a.photo ? artists.photoUrl(a) : "" }));
  return {
    shop: { name: st.name, phone: st.phone, email: st.contactEmail, address: st.address, website: st.website, about: st.about || "", founded: st.founded || "",
      hoursNote: st.hoursNote || "", walkIns: st.walkIns || "", parking: st.parking || "", payments: st.payments || "" },
    socials: Object.fromEntries(SOCIALS.map((k) => [k, (config.socials || {})[k] || (k === "instagram" && st.instagram ? st.instagram : "")])),
    socialLabels: SOCIAL_LABEL, team, extra: prev.extra || {}, submittedAt: prev.at || null,
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
    if (m.photo) { const d = files.decode([m.photo]); if (!d.error) { patch.photo = await files.saveArtistPhoto(a.slug, d.files[0]); photos++; } }
    await artists.setProfile(a.slug, patch);
    if (m.listed !== undefined) await artists.setListed(a.slug, Boolean(m.listed));
  }
  const extra = {}; for (const [k, v] of Object.entries(b.extra || {}).slice(0, 30)) extra[s(k, 40)] = s(v, 1500);
  await store.setJSON("onboard:answers", { at: Date.now(), extra });
  return { ok: true, photos };
}

module.exports = { makeLink, check, view, save, SOCIALS, SOCIAL_LABEL };
