// Beam: the shop's own website, managed from the inbox.
//  - Checklist: facts and photos the owner fills in (license number, price range, crew photo...). Saved answers
//    show on the website right away, through GET /api/artists?site=1.
//  - Change requests: anything else the owner wants changed on the site. These wait for the Site manager to review.
//  - Google reviews: pulled from Google Places (env GOOGLE_PLACES_KEY + the shop's googlePlaceId), cached a few hours.
// The checklist's items are set per shop on the Beam control page (record.siteChecklist).

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const config = require("../config/studio");
const store = require("./store");
const files = require("./files");

const TYPES = new Set(["text", "long", "photo", "form"]); // form = a private questionnaire: answers go to the Site manager, never on the site
const MAX = { text: 160, long: 1200 };
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

// What the control page may set as a shop's checklist.
function cleanChecklist(list) {
  if (!Array.isArray(list)) throw new Error("The checklist should be a list.");
  const seen = new Set();
  return list.slice(0, 20).map((x) => {
    const key = String(x?.key || "").trim();
    if (!KEY_RE.test(key) || seen.has(key)) throw new Error(`Checklist item "${key}" needs a unique short key (letters, numbers, _).`);
    seen.add(key);
    const type = TYPES.has(x.type) ? x.type : "text";
    const label = String(x.label || "").trim().slice(0, 80);
    if (!label) throw new Error(`Checklist item "${key}" needs a label.`);
    const out = { key, type, label, hint: String(x.hint || "").trim().slice(0, 200) };
    if (type === "form") {
      const qs = Array.isArray(x.questions) ? x.questions.slice(0, 20) : [];
      out.questions = qs.map((q, i) => {
        const qk = String(q?.key || `q${i + 1}`).trim();
        if (!KEY_RE.test(qk)) throw new Error(`Question ${i + 1} in "${key}" needs a short key.`);
        const qt = ["text", "long", "choice"].includes(q.type) ? q.type : "text";
        const o = { key: qk, type: qt, label: String(q.label || "").trim().slice(0, 160), hint: String(q.hint || "").trim().slice(0, 200) };
        if (!o.label) throw new Error(`Question ${i + 1} in "${key}" needs a label.`);
        if (qt === "choice") { o.options = (Array.isArray(q.options) ? q.options : []).map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 8); if (o.options.length < 2) throw new Error(`"${o.label}" needs at least two choices.`); }
        return o;
      });
      if (!out.questions.length) throw new Error(`Questionnaire "${key}" needs questions.`);
    }
    return out;
  });
}

const items = () => (Array.isArray(config.siteChecklist) ? config.siteChecklist : []);
async function load() { return (await store.getJSON("site")) || { values: {}, skipped: {}, updated: {} }; }
async function saveState(s) { await store.setJSON("site", s); }

const photoUrl = (p, v) => `/api/artists?sitephoto=${encodeURIComponent(p)}&v=${v || 1}`;
const isSitePhoto = (p) => typeof p === "string" && p.startsWith(`${config.tenant}/site/`) && !p.includes("..");

async function savePhoto(f, prefix) {
  const name = `${config.tenant}/site/${prefix}-${crypto.randomBytes(8).toString("hex")}.${f.ext}`;
  if (files.useBlob()) { const { put } = require("@vercel/blob"); await put(name, f.buf, { access: "private", contentType: f.type, addRandomSuffix: false }); }
  else { const file = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "uploads", name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, f.buf); }
  return name;
}
async function removePhotos(names) {
  names = names.filter(isSitePhoto);
  if (!names.length) return;
  try {
    if (files.useBlob()) { const { del } = require("@vercel/blob"); await del(names); }
    else for (const n of names) fs.rmSync(path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "uploads", n), { force: true });
  } catch (e) { console.error("[site] delete", e.message); }
}

// ----- for the inbox -----
async function adminView(me) {
  const s = await load();
  const list = items().map((it) => {
    const v = s.values[it.key];
    return { ...it, value: it.type === "photo" ? (v ? photoUrl(v, s.updated[it.key]) : "") : it.type === "form" ? (v && Object.keys(v).length ? v : "") : (v || ""),
      skipped: Boolean(s.skipped[it.key]), updatedAt: s.updated[it.key] || null };
  });
  const changes = ((await store.getJSON("site:changes")) || []).map((c) => ({ ...c, photos: (c.photos || []).map((p) => photoUrl(p)) }));
  const g = config.googlePlaceId ? await googleReviews().catch(() => null) : null;
  return { items: list, done: list.filter((x) => x.value || x.skipped).length, changes,
    google: { linked: Boolean(config.googlePlaceId && process.env.GOOGLE_PLACES_KEY), rating: g?.rating || null, count: g?.count || 0 },
    canReview: me.role === "admin" };
}

async function saveItem(b) {
  const it = items().find((x) => x.key === b.key);
  if (!it) throw new Error("That checklist item isn't there any more.");
  const s = await load();
  const old = s.values[it.key];
  if (b.skip !== undefined) { if (b.skip) s.skipped[it.key] = true; else delete s.skipped[it.key]; await saveState(s); return; }
  if (it.type === "form") {
    const a = {};
    for (const q of it.questions || []) {
      let x = typeof b.answers?.[q.key] === "string" ? b.answers[q.key].trim().slice(0, q.type === "long" ? 1200 : 200) : "";
      if (q.type === "choice" && x && !q.options.includes(x)) x = "";
      if (x) a[q.key] = x;
    }
    if (Object.keys(a).length) s.values[it.key] = a; else delete s.values[it.key];
  } else if (it.type === "photo") {
    if (b.remove) { delete s.values[it.key]; await removePhotos([old]); }
    else {
      const d = files.decode([b.photo]);
      if (d.error || !d.files.length) throw new Error(d.error || "Pick a photo.");
      s.values[it.key] = await savePhoto(d.files[0], it.key);
      if (old) await removePhotos([old]);
    }
  } else {
    const v = typeof b.value === "string" ? b.value.trim().slice(0, MAX[it.type]) : "";
    if (v) s.values[it.key] = v; else delete s.values[it.key];
  }
  delete s.skipped[it.key];
  s.updated[it.key] = Date.now();
  await saveState(s);
}

async function addChange(me, b) {
  const text = typeof b.text === "string" ? b.text.trim().slice(0, 2000) : "";
  if (text.length < 3) throw new Error("Say what you'd like changed.");
  const d = files.decode(Array.isArray(b.photos) ? b.photos : []);
  if (d.error) throw new Error(d.error);
  const id = crypto.randomBytes(5).toString("hex");
  const photos = [];
  for (const [i, f] of d.files.entries()) photos.push(await savePhoto(f, `change-${id}-${i + 1}`));
  const list = (await store.getJSON("site:changes")) || [];
  list.unshift({ id, text, photos, by: me.name, at: Date.now(), status: "open", note: "" });
  await store.setJSON("site:changes", list.slice(0, 200));
}

async function setChange(me, b) {
  if (me.role !== "admin") throw new Error("Only the Site manager marks change requests.");
  const list = (await store.getJSON("site:changes")) || [];
  const c = list.find((x) => x.id === b.id);
  if (!c) throw new Error("That request isn't there any more.");
  if (b.status !== undefined) c.status = ["open", "done", "declined"].includes(b.status) ? b.status : "open";
  if (b.note !== undefined) c.note = String(b.note || "").trim().slice(0, 600);
  c.reviewedAt = Date.now();
  await store.setJSON("site:changes", list);
}

// ----- for the public website -----
async function publicView() {
  const s = await load();
  const out = {};
  for (const it of items()) {
    if (it.type === "form") continue; // questionnaires are private
    const v = s.values[it.key];
    if (v) out[it.key] = it.type === "photo" ? photoUrl(v, s.updated[it.key]) : v;
  }
  let google = null;
  try { google = await googleReviews(); } catch (e) { console.error("[google]", e.message); }
  return { values: out, google };
}
async function photoFor(p) { return isSitePhoto(p) ? p : null; }

// Google Places (New): rating, review count and up to 5 reviews. Kept for 6 hours so the page stays fast.
const GOOGLE_TTL = 6 * 3600 * 1000;
async function googleReviews({ fresh = false } = {}) {
  const id = config.googlePlaceId, key = process.env.GOOGLE_PLACES_KEY;
  if (!id || !key) return null;
  const cached = await store.getJSON("site:google");
  if (!fresh && cached && cached.placeId === id && Date.now() - cached.at < GOOGLE_TTL) return cached.data;
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "rating,userRatingCount,reviews,googleMapsUri" } });
  const j = await r.json();
  if (!r.ok) { if (cached?.data) return cached.data; throw new Error(j.error?.message || `Google ${r.status}`); }
  const data = {
    rating: j.rating || null, count: j.userRatingCount || 0, url: j.googleMapsUri || "",
    reviews: (j.reviews || []).filter((x) => x.text?.text).map((x) => ({
      name: x.authorAttribution?.displayName || "Google user", rating: x.rating || 5, text: x.text.text.slice(0, 700),
      when: x.relativePublishTimeDescription || "", url: x.authorAttribution?.uri || "" })),
  };
  await store.setJSON("site:google", { placeId: id, at: Date.now(), data });
  return data;
}

module.exports = { cleanChecklist, adminView, saveItem, addChange, setChange, publicView, photoFor, googleReviews };
