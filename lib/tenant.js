// Beam Book serves many shops from one app. Every request is tied to one shop ("tenant") by its web address:
//   - a shop's own domain or subdomain, registered in the Beam Book control page (e.g. book.blackwolftattooclub.com), or
//   - <shop>.<BEAMBOOK_DOMAIN> when a wildcard domain is set up (e.g. blackwolf.book.nealmedia.app).
// The shop's settings are loaded once per request and kept in an AsyncLocalStorage context, so the rest of the code
// reads `config.studio.name`, `config.artists`, etc. exactly as it did when it served a single shop.
// Each shop's data lives under its own key prefix ("<slug>:...") and file folder ("<slug>/..."), so shops never mix.

const { AsyncLocalStorage } = require("async_hooks");
const store = require("./store");

const als = new AsyncLocalStorage();
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const RESERVED = new Set(["www", "api", "admin", "app", "book", "beam", "platform", "control", "mail", "static", "assets", "help", "support"]);

// What a brand-new shop starts with. The control page and the shop's inbox change these.
const DEFAULTS = {
  studio: { name: "", tagline: "", city: "", phone: "", siteUrl: "", contactEmail: "", minAge: 18,
    timeZone: "America/Anchorage", address: "", instagram: "", website: "" },
  theme: { mode: "dark", accent: "#d08a3c", logo: "" },
  calendarDefaults: {
    hours: { 0: null, 1: { open: "10:00", close: "18:00" }, 2: { open: "10:00", close: "18:00" }, 3: { open: "10:00", close: "18:00" },
      4: { open: "10:00", close: "18:00" }, 5: { open: "10:00", close: "18:00" }, 6: null },
    stepMin: 60, bufferMin: 30, leadHours: 48, windowDays: 56,
  },
  sessionLengths: [60, 120, 180, 240, 300, 360, 480],
  depositPolicy: "A deposit holds your date and comes off the final price. You'll get the amount, how to pay, and the reschedule terms with your quote.",
  artists: [],
  placements: ["Forearm", "Upper arm", "Shoulder", "Hand / fingers", "Chest", "Back", "Ribs / side",
    "Stomach", "Thigh", "Calf / shin", "Foot / ankle", "Neck", "Head / face", "Other"],
  sizes: [
    { value: "small", label: "Palm-sized or smaller" },
    { value: "medium", label: "About the size of a hand to a forearm" },
    { value: "large", label: "Half sleeve, thigh or calf panel" },
    { value: "session", label: "Full sleeve, chest, back — multiple sessions" },
    { value: "unsure", label: "Not sure yet" },
  ],
  budgets: [],
  colorOptions: ["Black and grey", "Color", "Not sure yet"],
  templates: {
    decline_style: "Hi {name}, thanks for sending this over. It isn't a good fit for the work I do, and you deserve someone who'll do it justice. Happy to point you toward someone if you'd like.",
    decline_full: "Hi {name}, thanks for reaching out. I'm fully booked for now, so I can't take this one on. I'd love to hear from you again when books open back up.",
    need_info: "Hi {name}, thanks for your request. Could you send a bit more detail (size in inches and a clear photo of the placement)? Just reply to this email.",
  },
  statuses: ["new", "quoted", "agreed", "scheduling", "pending", "booked", "done", "declined"],
  hosts: [],
  active: true,
  // Instant booking (barbershop mode): clients pick a fixed service, a barber and a time, and they're booked.
  instant: false,
  services: [],
  // What kind of business, its words, its request questions and how it negotiates (lib/templates.js).
  kind: "blank",
  ...(({ words, form, negotiate, ageCheck, policyCheck }) => ({ words, form, negotiate, ageCheck, policyCheck }))(require("./templates").template("blank")),
};

const G = store.global; // keys outside any shop: "beambook:..."

// ----- shop records -----
const cache = new Map(); // slug -> { at, cfg }
const CACHE_MS = 15000;

function merge(rec) {
  const d = JSON.parse(JSON.stringify(DEFAULTS));
  const cfg = { ...d, ...rec, studio: { ...d.studio, ...(rec.studio || {}) }, theme: { ...d.theme, ...(rec.theme || {}) },
    calendarDefaults: { ...d.calendarDefaults, ...(rec.calendarDefaults || {}) }, templates: { ...d.templates, ...(rec.templates || {}) },
    words: { ...d.words, ...(rec.words || {}) }, negotiate: { ...d.negotiate, ...(rec.negotiate || {}) } };
  cfg.tenant = rec.slug;
  const host = (cfg.hosts || [])[0] || (process.env.BEAMBOOK_DOMAIN ? `${rec.slug}.${process.env.BEAMBOOK_DOMAIN}` : "");
  cfg.studio.siteUrl = host ? `https://${host}` : "";
  return cfg;
}

async function getShop(slug, { fresh = false } = {}) {
  if (!SLUG_RE.test(String(slug || ""))) return null;
  const hit = cache.get(slug);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.cfg;
  const rec = await G.getJSON(`tenant:${slug}`);
  const cfg = rec ? merge(rec) : null;
  cache.set(slug, { at: Date.now(), cfg });
  return cfg;
}
async function getRecord(slug) { return SLUG_RE.test(String(slug || "")) ? G.getJSON(`tenant:${slug}`) : null; }
async function listShops() {
  const slugs = await G.indexRange("tenants", 1000);
  return (await Promise.all(slugs.map(getRecord))).filter(Boolean);
}

const cleanHost = (h) => String(h || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "").replace(/\.$/, "");
const HOST_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^[a-z0-9-]+\.localhost$/;

async function saveRecord(rec, { isNew = false } = {}) {
  const prev = isNew ? null : await getRecord(rec.slug);
  // Web addresses: claim new ones, release removed ones. One address belongs to one shop.
  const hosts = [...new Set((rec.hosts || []).map(cleanHost).filter(Boolean))];
  for (const h of hosts) {
    if (!HOST_RE.test(h)) throw new Error(`"${h}" isn't a web address Beam can use.`);
    const owner = await G.getJSON(`host:${h}`);
    if (owner && owner !== rec.slug) throw new Error(`${h} already belongs to another shop.`);
  }
  for (const h of (prev?.hosts || [])) if (!hosts.includes(h)) await G.del(`host:${h}`);
  for (const h of hosts) await G.setJSON(`host:${h}`, rec.slug);
  const next = { ...prev, ...rec, hosts, updatedAt: Date.now(), createdAt: prev?.createdAt || Date.now() };
  await G.setJSON(`tenant:${rec.slug}`, next);
  if (isNew) await G.indexAdd("tenants", rec.slug, next.createdAt);
  cache.delete(rec.slug);
  return next;
}

// ----- which shop is this request for? -----
async function slugForRequest(req) {
  const host = cleanHost(req.headers["x-forwarded-host"] || req.headers.host);
  const viaHost = host && await G.getJSON(`host:${host}`);
  if (viaHost) return viaHost;
  const base = cleanHost(process.env.BEAMBOOK_DOMAIN);
  if (base && host.endsWith(`.${base}`)) {
    const sub = host.slice(0, -base.length - 1);
    if (SLUG_RE.test(sub) && !sub.includes(".")) return sub;
  }
  // Local testing only: http://<shop>.localhost:3000 picks the shop.
  if (!process.env.VERCEL && host.endsWith(".localhost")) return host.slice(0, -".localhost".length);
  return null;
}

// Wrap an API handler so it runs for one shop. Requests to an address with no shop get a plain 404.
function handler(fn) {
  return async (req, res) => {
    const slug = await slugForRequest(req);
    const cfg = slug && await getShop(slug);
    if (!cfg || cfg.active === false) {
      res.statusCode = 404; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store");
      return res.end(JSON.stringify({ error: "There's no booking page at this address.", noShop: true }));
    }
    return als.run({ cfg }, () => fn(req, res));
  };
}
// Run some work as a given shop (daily jobs, Instagram callback).
async function runAs(slug, fn) {
  const cfg = await getShop(slug, { fresh: true });
  if (!cfg) throw new Error("No such shop.");
  return als.run({ cfg }, fn);
}
function current() {
  const s = als.getStore();
  if (!s) throw new Error("No shop for this request (tenant context missing).");
  return s.cfg;
}
const currentOrNull = () => als.getStore()?.cfg || null;

module.exports = { DEFAULTS, SLUG_RE, RESERVED, handler, runAs, current, currentOrNull, getShop, getRecord, listShops, saveRecord, cleanHost, HOST_RE, slugForRequest };
