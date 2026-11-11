// Beam Book control page API (Neal only). Password: PLATFORM_PASSWORD in Vercel.
//   GET  /api/platform                       -> {loggedIn, shops?, domain}
//   GET  /api/platform?shop=<slug>           -> full settings for one shop
//   POST {action:"login", password} · {action:"logout"}
//   POST {action:"create", slug, name, ownerName, ownerEmail, artistName, ...settings}  -> {shop, ownerLink}
//   POST {action:"update", slug, ...settings}
//   POST {action:"logo", slug, image (data URL) | remove:true}
//   POST {action:"ownerLink", slug}          -> fresh setup link for the shop's Owner
//   POST {action:"active", slug, active}
// A shop's own people (artists, front desk) are added by the shop's Owner in their inbox, not here.

const crypto = require("crypto");
const tenant = require("../lib/tenant");
const store = require("../lib/store");
const { send, method, body, ip, id, str } = require("../lib/http");

const COOKIE = "bb_control";
const MAX_AGE = 12 * 3600;
const G = store.global;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const secret = () => { if (!process.env.SESSION_SECRET) throw new Error("Set SESSION_SECRET in Vercel."); return process.env.SESSION_SECRET; };
const sign = (v) => crypto.createHmac("sha256", secret()).update(`control|${v}`).digest("base64url");
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const secure = (req) => (req.headers["x-forwarded-proto"] || "").includes("https") || process.env.VERCEL === "1";

function loggedIn(req) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  try { return Number(exp) > Date.now() / 1000 && crypto.timingSafeEqual(Buffer.from(sig || ""), Buffer.from(sign(exp))); } catch { return false; }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") return await get(req, res);
    if (!method(req, res, "POST")) return;
    const b = body(req);
    if (b.action === "login") return await login(req, res, b);
    if (b.action === "logout") { res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure(req) ? "; Secure" : ""}`); return send(res, 200, { ok: true }); }
    if (!loggedIn(req)) return send(res, 401, { error: "Log in first." });
    switch (b.action) {
      case "create": return await create(req, res, b);
      case "update": return await update(req, res, b);
      case "logo": return await logo(req, res, b);
      case "ownerLink": return await ownerLink(req, res, b);
      case "active": return await active(req, res, b);
      case "demo": case "clearDemo": {
        const rec = await tenant.getRecord(b.slug);
        if (!rec) return send(res, 404, { error: "No such shop." });
        const demo = require("../lib/demo");
        return send(res, 200, await tenant.runAs(rec.slug, () => (b.action === "demo" ? demo.fill() : demo.clear())));
      }
      default: return send(res, 400, { error: "Unknown action." });
    }
  } catch (e) {
    console.error("[platform]", e);
    return send(res, 400, { error: e.message || "Something went wrong." });
  }
};

async function login(req, res, b) {
  if ((await G.hit(`rl:control:${ip(req)}`, 900)) > 8) return send(res, 429, { error: "Too many tries. Wait 15 minutes." });
  const real = process.env.PLATFORM_PASSWORD;
  if (!real) return send(res, 500, { error: "PLATFORM_PASSWORD isn't set in Vercel yet." });
  const pw = typeof b.password === "string" ? b.password : "";
  if (!crypto.timingSafeEqual(sha(pw), sha(real))) return send(res, 401, { error: "Wrong password." });
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  res.setHeader("Set-Cookie", `${COOKIE}=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}${secure(req) ? "; Secure" : ""}`);
  return send(res, 200, { ok: true });
}

const urlFor = (rec) => {
  const host = (rec.hosts || [])[0] || (process.env.BEAMBOOK_DOMAIN ? `${rec.slug}.${process.env.BEAMBOOK_DOMAIN}` : "");
  return host ? (host.endsWith(".localhost") ? `http://${host}` : `https://${host}`) : "";
};

async function get(req, res) {
  if (!loggedIn(req)) return send(res, 200, { loggedIn: false, ready: Boolean(process.env.PLATFORM_PASSWORD && process.env.SESSION_SECRET) });
  const slug = new URL(req.url, "http://x").searchParams.get("shop");
  if (slug) {
    const rec = await tenant.getRecord(slug);
    if (!rec) return send(res, 404, { error: "No such shop." });
    const counts = await tenant.runAs(slug, async () => ({
      people: (await require("../lib/auth").users()).filter((u) => u.active !== false).length,
      requests: (await store.indexRange("reqs", 5000)).length,
    })).catch(() => ({}));
    return send(res, 200, { shop: { ...rec, url: urlFor(rec), ...counts } });
  }
  const shops = (await tenant.listShops()).map((r) => ({ slug: r.slug, name: r.studio?.name || r.slug, city: r.studio?.city || "",
    hosts: r.hosts || [], active: r.active !== false, createdAt: r.createdAt, url: urlFor(r) }));
  const T = require("../lib/templates");
  return send(res, 200, { loggedIn: true, shops, domain: process.env.BEAMBOOK_DOMAIN || "", defaults: tenant.DEFAULTS,
    kinds: Object.fromEntries(Object.entries(T.KINDS).map(([k, v]) => [k, { label: v.label, words: v.words, form: v.form, negotiate: v.negotiate }])), types: T.TYPES });
}

// ----- settings -----
const TZS = new Set(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []);
const list = (v, max, n) => (Array.isArray(v) ? v : String(v || "").split("\n")).map((x) => str(x, max)).filter(Boolean).slice(0, n);
const hm = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));

// Only known fields, cleaned. Anything left out keeps its current value.
function settingsFrom(b) {
  const out = {};
  const s = b.studio || {};
  const studio = {};
  for (const [k, max] of [["name", 80], ["tagline", 160], ["city", 80], ["phone", 30], ["address", 160], ["instagram", 60], ["website", 200], ["contactEmail", 120]])
    if (s[k] !== undefined) studio[k] = str(s[k], max);
  if (studio.name !== undefined && studio.name.length < 2) throw new Error("Enter the shop's name.");
  if (studio.contactEmail && !EMAIL_RE.test(studio.contactEmail)) throw new Error("The shop email doesn't look right.");
  if (studio.website && !/^https?:\/\//i.test(studio.website)) studio.website = `https://${studio.website}`;
  if (s.timeZone !== undefined) { if (TZS.size && !TZS.has(s.timeZone)) throw new Error("Pick a time zone from the list."); studio.timeZone = s.timeZone; }
  if (s.minAge !== undefined) { const a = Number(s.minAge); if (!(a >= 16 && a <= 21)) throw new Error("Minimum age should be 16 to 21."); studio.minAge = a; }
  if (Object.keys(studio).length) out.studio = studio;

  if (b.theme) {
    out.theme = {};
    if (b.theme.mode !== undefined) out.theme.mode = b.theme.mode === "light" ? "light" : "dark";
    if (b.theme.deco !== undefined) out.theme.deco = Boolean(b.theme.deco);
    if (b.theme.accent !== undefined) { if (!/^#[0-9a-f]{6}$/i.test(b.theme.accent)) throw new Error("Pick an accent color."); out.theme.accent = b.theme.accent.toLowerCase(); }
  }
  if (b.depositPolicy !== undefined) out.depositPolicy = str(b.depositPolicy, 600);
  Object.assign(out, require("../lib/templates").bookingSettings(b));
  if (b.placements !== undefined) { out.placements = list(b.placements, 40, 30); if (!out.placements.length) throw new Error("Add at least one placement."); }
  if (b.colorOptions !== undefined) { out.colorOptions = list(b.colorOptions, 40, 12); if (!out.colorOptions.length) throw new Error("Add at least one style choice."); }
  if (b.hosts !== undefined) out.hosts = list(b.hosts, 253, 5).map(tenant.cleanHost);
  if (b.calendarDefaults) {
    const c = b.calendarDefaults, hours = {};
    for (let d = 0; d < 7; d++) {
      const h = c.hours?.[d];
      if (!h) { hours[d] = null; continue; }
      if (!hm(h.open) || !hm(h.close) || h.open >= h.close) throw new Error("Check the opening hours: each open day needs a start before its end.");
      hours[d] = { open: h.open, close: h.close };
    }
    out.calendarDefaults = { hours };
  }
  return out;
}

async function create(req, res, b) {
  const slug = str(b.slug, 40).toLowerCase();
  if (!tenant.SLUG_RE.test(slug) || tenant.RESERVED.has(slug)) throw new Error("Short name: 1–40 lowercase letters, numbers and dashes (e.g. blackwolf).");
  if (await tenant.getRecord(slug)) throw new Error("That short name is taken.");
  const ownerName = str(b.ownerName, 60), ownerEmail = str(b.ownerEmail, 120).toLowerCase(), artistName = str(b.artistName, 60) || ownerName;
  if (ownerName.length < 2) throw new Error("Enter the owner's name.");
  if (!EMAIL_RE.test(ownerEmail)) throw new Error("Enter the owner's email. It's what they'll log in with.");
  const set = settingsFrom({ ...b, studio: { contactEmail: ownerEmail, ...(b.studio || {}) } });
  if (!process.env.BEAMBOOK_DOMAIN && !(set.hosts || []).length) throw new Error("Add the shop's web address (or set BEAMBOOK_DOMAIN in Vercel for automatic ones).");
  if (!set.studio?.name) throw new Error("Enter the shop's name.");
  const artistSlug = artistName.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "artist";
  const T = require("../lib/templates");
  const kind = T.KINDS[b.kind] ? b.kind : "blank";
  const tpl = T.template(kind);
  const rec = await tenant.saveRecord({
    slug, active: true, kind, words: tpl.words, form: tpl.form, negotiate: tpl.negotiate, ageCheck: tpl.ageCheck, policyCheck: tpl.policyCheck,
    instant: Boolean(tpl.instant), services: T.cleanServices(tpl.services || []), ...set,
    calendarDefaults: { ...tenantDefaultsCal(), ...(tpl.calendar || {}), ...(set.calendarDefaults || {}) },
    artists: [{ slug: artistSlug, name: artistName, styles: [], bio: "", photo: "", sample: "", instagram: set.studio.instagram || "", email: "", booksOpenDefault: true }],
  }, { isNew: true });
  // The Owner's login, with a one-time link to choose their password.
  const link = await tenant.runAs(slug, async () => {
    const auth = require("../lib/auth");
    const u = { id: id(8), name: ownerName, email: ownerEmail, role: "owner", artist: null, hash: "", mustChange: false, ver: 0, active: true,
      createdAt: new Date().toISOString(), createdBy: "Beam Book" };
    await auth.saveUsers([u]);
    return auth.makeResetLink(urlFor(rec), u, 24 * 7);
  });
  return send(res, 201, { shop: { ...rec, url: urlFor(rec) }, ownerLink: link });
}

async function update(req, res, b) {
  const rec = await tenant.getRecord(b.slug);
  if (!rec) return send(res, 404, { error: "No such shop." });
  const set = settingsFrom(b);
  if (b.applyKind) { // start over from a template: words, questions and negotiation rules
    const T = require("../lib/templates");
    if (!T.KINDS[b.applyKind]) throw new Error("Unknown business type.");
    const tpl = T.template(b.applyKind);
    Object.assign(set, { kind: b.applyKind, words: tpl.words, form: tpl.form, negotiate: tpl.negotiate, ageCheck: tpl.ageCheck, policyCheck: tpl.policyCheck,
      instant: Boolean(tpl.instant), ...(tpl.services ? { services: T.cleanServices(tpl.services) } : {}) });
  }
  const next = { ...rec, ...set, studio: { ...rec.studio, ...(set.studio || {}) }, theme: { ...rec.theme, ...(set.theme || {}) },
    calendarDefaults: { ...rec.calendarDefaults, ...(set.calendarDefaults || {}) } };
  const saved = await tenant.saveRecord(next);
  return send(res, 200, { shop: { ...saved, url: urlFor(saved) } });
}

async function logo(req, res, b) {
  const rec = await tenant.getRecord(b.slug);
  if (!rec) return send(res, 404, { error: "No such shop." });
  const theme = { ...(rec.theme || {}) };
  if (b.remove) { theme.logo = ""; }
  else {
    const files = require("../lib/files");
    const d = files.decode([b.image]);
    if (d.error || !d.files.length) throw new Error(d.error || "Pick an image for the logo.");
    theme.logo = await tenant.runAs(rec.slug, () => files.saveLogo(d.files[0]));
    theme.logoV = Date.now();
  }
  const saved = await tenant.saveRecord({ ...rec, theme });
  return send(res, 200, { shop: { ...saved, url: urlFor(saved) } });
}

async function ownerLink(req, res, b) {
  const rec = await tenant.getRecord(b.slug);
  if (!rec) return send(res, 404, { error: "No such shop." });
  const link = await tenant.runAs(rec.slug, async () => {
    const auth = require("../lib/auth");
    const list = await auth.users();
    const owner = list.find((u) => u.role === "owner" && u.active !== false);
    if (!owner) throw new Error("This shop has no active Owner login.");
    return { link: await auth.makeResetLink(urlFor(rec), owner, 24 * 7), name: owner.name, email: owner.email };
  });
  return send(res, 200, link);
}

async function active(req, res, b) {
  const rec = await tenant.getRecord(b.slug);
  if (!rec) return send(res, 404, { error: "No such shop." });
  const saved = await tenant.saveRecord({ ...rec, active: b.active !== false });
  return send(res, 200, { shop: { ...saved, url: urlFor(saved) } });
}

function tenantDefaultsCal() { return JSON.parse(JSON.stringify(require("../lib/tenant").DEFAULTS.calendarDefaults)); }
