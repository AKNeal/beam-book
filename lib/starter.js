// New-client onboarding (the "New Client Onboarding: Phased Checklist" doc):
//   - Neal Media status for each shop: booking only, building (the 90-day try-it period), signed, or a current client.
//     Shops made before this existed have no status and count as current clients, so nothing changes for them.
//   - Add-ons: the Neal Media upcharges, marked so they can be priced when the client signs.
//   - Phase 5 ("Fill it in"): the starting website checklist for each business type, one small question per item.
//     It becomes the shop's site checklist (lib/site.js), which the owner answers on the Website screen of their inbox.

const STATUSES = {
  booking: "Booking only",
  building: "Building (try-it period)",
  signed: "Agreement signed",
  current: "Current client",
};
const TRIAL_DAYS = 90;

// Upcharges that are Neal Media's, not Beam's. The key is stored on the shop; the label is shown everywhere.
const ADDONS = {
  website: "Website on their own domain",
  seo: "SEO and Google rank reports",
  reviewAsks: "Google review requests after a visit",
  reviews: "Google reviews on the site",
  changes: "Monthly website change requests",
};

const DAY = 24 * 3600 * 1000;

// The shop's Neal Media record, with what the screens need worked out. No record = a current client.
function nealOf(rec) {
  const n = rec && rec.neal;
  if (!n || !STATUSES[n.status]) return { status: "current", label: STATUSES.current, addons: [] };
  const out = { status: n.status, label: STATUSES[n.status], addons: (n.addons || []).filter((k) => ADDONS[k]), shellUrl: n.shellUrl || "",
    startedAt: n.startedAt || null, signedAt: n.signedAt || null, appId: n.appId || null };
  if (n.status === "building" && n.startedAt) {
    out.day = Math.max(1, Math.floor((Date.now() - Date.parse(n.startedAt)) / DAY) + 1);
    out.daysLeft = TRIAL_DAYS - out.day;
    out.over = out.day > TRIAL_DAYS;
  }
  return out;
}

// What the control page may set. Returns the new record.neal, or undefined when nothing was sent.
function cleanNeal(b, current) {
  if (!b || typeof b !== "object") return undefined;
  const cur = (current && current.neal) || {};
  const status = b.status !== undefined ? String(b.status) : cur.status;
  if (status !== undefined && !STATUSES[status]) throw new Error("Pick a Neal Media status.");
  const out = { ...cur, status };
  if (b.addons !== undefined) out.addons = (Array.isArray(b.addons) ? b.addons : []).map(String).filter((k) => ADDONS[k]);
  if (b.shellUrl !== undefined) {
    let u = String(b.shellUrl || "").trim().slice(0, 200);
    if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
    if (u && !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(u)) throw new Error("The example site address doesn't look right.");
    out.shellUrl = u;
  }
  if (b.startedAt !== undefined) {
    const d = String(b.startedAt || "").slice(0, 10);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("Pick the day the build started.");
    out.startedAt = d ? new Date(`${d}T12:00:00Z`).toISOString() : null;
  }
  if (status === "building" && !out.startedAt) out.startedAt = new Date().toISOString();
  if (status === "signed" && cur.status !== "signed") out.signedAt = new Date().toISOString();
  if (b.appId !== undefined) out.appId = String(b.appId || "").slice(0, 20) || null;
  return out;
}

// ---------------------------------------------------------------- Phase 5: the starting website checklist
// Item types are lib/site.js's: text, long, photo, photos (named slots), form (private questions), connect, task.
const COMMON_TOP = [
  { key: "story", type: "long", label: "How you started", hint: "Write it like you'd tell a regular. Messy is fine; we'll tidy it." },
  { key: "known_for", type: "text", label: "What you're known for", hint: "One or two lines." },
  { key: "opened", type: "text", label: "When you opened", hint: "Month and year, e.g. June 2018. Shown as \"Est.\" on the site.", optional: true },
  { key: "hours_ok", type: "text", label: "Are the hours on your site right?", hint: "Type \"yes\", or what to change." },
  { key: "web_address", type: "text", label: "Do you own a web address?", hint: "Which one and where it's registered, or \"no\".", private: true },
  { key: "link_instagram", type: "text", label: "Instagram link", hint: "In the app: your profile, Share, Copy link.", optional: true },
  { key: "link_facebook", type: "text", label: "Facebook link", optional: true },
  { key: "link_google", type: "text", label: "Your Google listing", hint: "Search your business on Google Maps, tap Share, copy the link." },
  { key: "link_other", type: "text", label: "Any other links", hint: "TikTok, Yelp, delivery apps.", optional: true },
];
const COMMON_PHOTOS = (workLabel) => [
  { key: "work_photos", type: "photos", label: workLabel, hint: "Phone photos are fine.",
    slots: [{ key: "work_1", label: "Photo 1" }, { key: "work_2", label: "Photo 2" }, { key: "work_3", label: "Photo 3" }, { key: "work_4", label: "Photo 4" }, { key: "work_5", label: "Photo 5" }] },
  { key: "shop_photos", type: "photos", label: "The shop", hint: "Out front and inside.", slots: [{ key: "shop_front", label: "Out front" }, { key: "shop_inside", label: "Inside" }] },
  { key: "team_photo", type: "photo", label: "Your team at work", hint: "Only people who said yes to being on the site.", optional: true },
  { key: "logo", type: "photo", label: "Your logo", hint: "The biggest, sharpest version you have." },
];
const COMMON_SELL = (pricesLabel, pricesHint) => [
  { key: "prices", type: "long", label: pricesLabel, hint: pricesHint },
  { key: "policy", type: "long", label: "Deposit, cancel and reschedule policy", hint: "What happens to a deposit, and how much notice you need." },
];
const BY_KIND = {
  tattoo: [ // from Black Wolf
    ...COMMON_PHOTOS("5 or more photos of your work"),
    ...COMMON_SELL("Shop minimum and how you price", "Hourly rate, shop minimum, or \"quoted per piece\"."),
    { key: "aftercare", type: "long", label: "Aftercare steps you give clients", hint: "Day by day is perfect." },
    { key: "faq", type: "long", label: "Questions clients always ask", hint: "And your answers: age, ID, deposits, touch-ups, numbing cream." },
  ],
  barbershop: [ // from Level Up
    ...COMMON_PHOTOS("5 or more photos of cuts"),
    ...COMMON_SELL("Services and prices", "A photo of your price board is fine."),
  ],
  catering: [ // from Crave
    ...COMMON_PHOTOS("5 or more photos of your food"),
    ...COMMON_SELL("Menu and catering prices", "A photo or PDF of the menu is fine. Include trays, minimums and notice needed."),
  ],
  trades: [
    ...COMMON_PHOTOS("5 or more photos of jobs you've done"),
    ...COMMON_SELL("Services and starting prices", "Or how you price: per job, per hour, free quotes."),
    { key: "service_area", type: "text", label: "Where you work", hint: "Towns or how far you'll travel." },
  ],
  performer: [
    ...COMMON_PHOTOS("5 or more photos from gigs"),
    ...COMMON_SELL("Packages and starting prices", "Set lengths, what's included, travel."),
  ],
  creative: [
    ...COMMON_PHOTOS("5 or more of your best shots or pieces"),
    ...COMMON_SELL("Packages and starting prices", "What's included in each."),
  ],
  blank: [
    ...COMMON_PHOTOS("5 or more photos of your work or products"),
    ...COMMON_SELL("Services and prices", "A photo of a price list is fine."),
  ],
};
function siteChecklistFor(kind) { return JSON.parse(JSON.stringify([...COMMON_TOP, ...(BY_KIND[kind] || BY_KIND.blank)])); }

// The application's business types, matched to Beam's starting templates (lib/templates.js).
const APP_TYPES = {
  tattoo: { label: "Tattoo shop", kind: "tattoo" },
  barbershop: { label: "Barbershop or salon", kind: "barbershop" },
  food: { label: "Food, cafe, bakery or catering", kind: "catering" },
  trades: { label: "Trades and services", kind: "trades" },
  performer: { label: "DJ, band or performer", kind: "performer" },
  creative: { label: "Photo, video or design", kind: "creative" },
  other: { label: "Something else", kind: "blank" },
};

module.exports = { STATUSES, TRIAL_DAYS, ADDONS, APP_TYPES, nealOf, cleanNeal, siteChecklistFor };
