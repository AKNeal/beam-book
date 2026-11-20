// Business categories and add-ons.
//
// Every shop starts with its category's basic booking type (what that industry needs to take bookings), included in
// the base price. Everything else is an add-on Neal Media charges extra for, switched on per shop on the control page.
// Prices live in one place (the control page → Pricing, stored as `pricing` in the global store) so Neal can change
// them without code.
//
// Older shop records have no `category` / `addons`: the category is worked out from what they use (instant booking =
// barbershop, tattoo template = tattoo, cafe template = cafe, else other) and they keep every add-on they already had,
// so nothing changes for them until Neal edits them.

const FEATURES = {
  // basic booking pieces (come with a category)
  booking:        { label: "Instant booking", hint: "Services, prices and open times; clients are booked right away" },
  requests:       { label: "Requests & offers", hint: "Clients send a request; the shop replies with a price and time" },
  dayview:        { label: "Shop calendar", hint: "Everyone's day side by side, for walk-in shops" },
  calendar:       { label: "Calendar", hint: "Each person's calendar, hours and time off" },
  books:          { label: "Books and waitlist", hint: "Open or close each person's books; waitlist" },
  // add-ons (charged extra)
  social:         { label: "Social media connector", hint: "Connects the shop's Instagram: posts show on its website and artist pages", addon: true },
  rankings:       { label: "Google ranking tracker", hint: "Daily Google search positions and the ranking badge", addon: true },
  checkout:       { label: "Checkout", hint: "Card reader and cash at the counter, tips, card-on-phone QR", addon: true },
  dashboard:      { label: "Dashboard & scoreboard", hint: "Sales, rebooking rate and the team scoreboard / TV", addon: true },
  apprenticeship: { label: "Apprenticeship", hint: "Applications, hours, checkoffs, paperwork and forms", addon: true },
};
const ADDONS = Object.keys(FEATURES).filter((k) => FEATURES[k].addon);

const CATEGORIES = {
  barbershop: { label: "Barbershop / salon", kind: "barbershop", basic: ["booking", "dayview", "calendar", "books"],
    booking: "Instant booking: pick a barber, a service and a time" },
  tattoo: { label: "Tattoo shop", kind: "tattoo", basic: ["requests", "calendar", "books"],
    booking: "Tattoo requests: placement, size and photos; the artist replies with a price" },
  cafe: { label: "Cafe / bakery", kind: "cafe", basic: ["requests", "calendar"],
    booking: "Custom & catering orders: what, how many, pickup date; the cafe replies with a price" },
  other: { label: "Other business", kind: "blank", basic: ["requests", "calendar", "books"],
    booking: "Booking requests with the business's own questions; offers back and forth" },
};

const DEFAULT_PRICING = { base: { barbershop: 150, tattoo: 150, cafe: 150, other: 150 }, addons: Object.fromEntries(ADDONS.map((k) => [k, null])) };

function categoryOf(cfg = {}) {
  if (CATEGORIES[cfg.category]) return cfg.category;
  if (cfg.instant) return "barbershop";
  if (cfg.kind === "tattoo") return "tattoo";
  if (cfg.kind === "cafe") return "cafe";
  return "other";
}

// The add-ons a shop has. No `addons` saved yet = an older shop: it keeps everything it had.
function addonsOf(cfg = {}) {
  if (Array.isArray(cfg.addons)) return cfg.addons.filter((k) => ADDONS.includes(k));
  return categoryOf(cfg) === "barbershop" ? [...ADDONS] : ADDONS.filter((k) => k !== "apprenticeship");
}

function featuresOf(cfg = {}) {
  const on = new Set([...CATEGORIES[categoryOf(cfg)].basic, ...addonsOf(cfg)]);
  if (cfg.instant) on.add("booking"); // the instant-booking engine is on: show it
  return Object.fromEntries(Object.keys(FEATURES).map((k) => [k, on.has(k)]));
}

const cleanAddons = (list) => [...new Set((Array.isArray(list) ? list : []).filter((k) => ADDONS.includes(k)))];

async function pricing() {
  const G = require("./store").global;
  const p = (await G.getJSON("pricing").catch(() => null)) || {};
  return { base: { ...DEFAULT_PRICING.base, ...(p.base || {}) }, addons: { ...DEFAULT_PRICING.addons, ...(p.addons || {}) } };
}
async function savePricing(b) {
  const G = require("./store").global, cur = await pricing();
  const num = (v) => (v === "" || v === null || v === undefined ? null : Math.max(0, Math.round(Number(v) * 100) / 100));
  for (const k of Object.keys(CATEGORIES)) if (b.base && b.base[k] !== undefined) { const n = num(b.base[k]); if (n === null || !Number.isFinite(n)) throw new Error("Each category needs a base price."); cur.base[k] = n; }
  for (const k of ADDONS) if (b.addons && b.addons[k] !== undefined) { const n = num(b.addons[k]); if (n !== null && !Number.isFinite(n)) throw new Error("Prices are numbers."); cur.addons[k] = n; }
  await G.setJSON("pricing", cur);
  return cur;
}

// What a shop pays each month: its category's base price plus each add-on it has.
function monthly(cfg, P) {
  const cat = categoryOf(cfg), lines = [{ key: "base", label: `${CATEGORIES[cat].label} (basic booking)`, price: P.base[cat] }];
  for (const k of addonsOf(cfg)) lines.push({ key: k, label: FEATURES[k].label, price: P.addons[k], unset: P.addons[k] === null });
  return { lines, total: Math.round(lines.reduce((n, l) => n + (Number(l.price) || 0), 0) * 100) / 100 };
}

module.exports = { FEATURES, ADDONS, CATEGORIES, DEFAULT_PRICING, categoryOf, addonsOf, featuresOf, cleanAddons, pricing, savePricing, monthly };
