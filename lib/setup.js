// Setup checklist: what each login still needs to do to get the shop fully running (Google access for SEO,
// Instagram, payments, texting...). Each item belongs to one login; some tick themselves off (auto).
// The Owner / Administrator see everyone's list and can add, edit or remove items.
//
// Store: setup:list  [{ id, user, title, details, link: {label, url}?, auto?, doneAt?, doneBy?, order, phase?, after? }]
//
// New shops get the onboarding phases (the "New Client Onboarding" doc): 3 Build the shell (Neal Media), 4 Try it out,
// 5 Fill in your website, 6 Happy and signed. Items marked `after` stay locked (grey, not counted) until the shop's
// Neal Media status is "signed" (lib/starter.js). Lists made before phases existed have no `phase` and work as before.
const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");

const id = () => crypto.randomBytes(5).toString("hex");
const clip = (s, n) => String(s ?? "").trim().slice(0, n);

// Starting items, by who the login is. Written for any shop: the shop's name and team fill in when a list is first made.
// Bank info goes straight into Stripe's own secure form (opened from the button), never into Beam.
const STRIPE_ITEM = {
  title: "Add the shop's bank account for card payments",
  details: "So card payments deposit into your business's bank. Tap the button to open Stripe's secure form (about 5 minutes) and have ready:\n• The business's legal name and EIN\n• The owner's name, date of birth, home address and last 4 of SSN (Stripe verifies it's really the business owner)\n• The bank's routing and account number for deposits\nNeal Media runs everything else; there's no Stripe login to keep track of. Ticks itself off when Stripe says the shop can take payments.",
  link: { label: "Open Stripe's secure form", url: "beam:payConnect" },
};
const HOME_SCREEN = "iPhone: open your inbox in Safari, tap Share (the square with the arrow), then Add to Home Screen.\nAndroid: open it in Chrome, tap the ⋮ menu, then Add to Home screen.";
const OWNER = (c) => [
  // Phase 4: Try it out
  { phase: 4, auto: "password", title: "Pick your password and log in", details: "Use the link in your welcome email (or ask Neal for a fresh one)." },
  { phase: 4, title: "Put your inbox on your phone", details: HOME_SCREEN },
  { phase: 4, title: "Book a test as if you were a client", details: "Use \"TEST\" as the name, so no emails or texts go out. Walk through it the way a client would.", link: { label: "Open your booking page", url: "/booking" } },
  { phase: 4, title: "Check your services, prices and hours", details: "Fix anything that's off, or tell Neal Media.", link: { label: "Open your booking page", url: "/booking" } },
  { phase: 4, auto: "calendar", title: "Connect your phone's calendar", details: "Calendar → Show bookings on your iPhone. Add your other calendars there too, so outside plans block time." },
  { phase: 4, title: "Send your booking link to 1 to 3 real clients", details: "Try it on people you already book. Tell us how it went." },
  ...(c.team.length ? [{ phase: 4, title: "Invite your team", details: `Team → Password link on each person (${c.team.join(", ")}). Each gets a 2-minute page to pick a password and fill in their card.` }]
    : [{ phase: 4, title: "Invite your team", details: "Team → add a login for each person who takes bookings or works the front desk. Each gets a 2-minute page to pick a password and fill in their card." }]),
  { phase: 4, auto: "stripe", ...STRIPE_ITEM },
  ...(c.website ? [
    // Phase 5: Fill in your website
    { phase: 5, auto: "site", title: "Fill in your website checklist", details: "One small question per item: type it or upload a photo. Ticks itself off when every required item is in.", link: { label: "Open the checklist", url: "/admin#site" } },
    // Phase 6: Happy and signed (opens once the agreement is signed, except the first item)
    { phase: 6, title: "Tell Neal Media you're happy with the site", details: "Anything still not right? Use Website → Change requests first. You sign only when you're 100% happy." },
    { phase: 6, after: true, title: "Give Neal Media access to your Google Business Profile", details: "This lets us start your SEO, keep your hours and photos right, and show your Google reviews on the site.\n1. Open business.google.com (or search your business name on Google while logged in) and open your profile.\n2. Menu (⋮) → Business Profile settings → People and access → Add.\n3. Add Neal Media's Google account as a Manager (Neal will send you the address).\n4. Tick this off once it's sent. We accept it on our side.", link: { label: "Open Google Business", url: "https://business.google.com/" } },
    { phase: 6, after: true, auto: "instagram", title: "Connect your Instagram", details: "Shows your latest posts on the website.\n1. In the Instagram app: Settings → Account type and tools → switch to a Professional account (Business or Creator) if it isn't one.\n2. Here in the dashboard: Account → Connect Instagram, and log in to Instagram on Instagram's page.\nIt ticks itself off once connected." },
    { phase: 6, after: true, title: "Send your business details for texting", details: `Carriers need the business's legal name, EIN, address and contact so texts come from ${c.shop} instead of Neal Media. It's on your setup link, under Texting.` },
    { phase: 6, after: true, title: "Add the email records to your domain", details: "So emails come from your own address. The records are on Website → Checklist; add them wherever your domain is managed (GoDaddy, Squarespace, Google, etc.)." },
  ] : []),
];
const BARBER = () => [
  { phase: 4, auto: "password", title: "Pick your password and log in", details: "Use the link in your email (or ask for a fresh one)." },
  { phase: 4, title: "Fill in your card", details: "Your photo, what you do and a line about you, for the team page. Books and waitlist → Edit profile." },
  { phase: 4, title: "Put the inbox on your phone", details: HOME_SCREEN },
  { phase: 4, title: "Sync your calendar", details: "Put your bookings on your phone's calendar and keep outside appointments from double-booking. Calendar → Show bookings on your iPhone." },
  { phase: 4, title: "Check your services, prices and hours", details: "Make sure what clients see on the booking page is right for you.", link: { label: "Open the booking page", url: "/booking" } },
];
// Neal Media's own login on the shop (role admin).
const ADMIN = (c) => [
  ...(c.website ? [
    // Phase 3: Build the shell
    { phase: 3, title: "Clone their current site to the example address", details: `${c.shellUrl || "<company>.nealmedia.app"}: their look and words, or built from their Instagram or Facebook if they have no site.` },
    { phase: 3, title: "Put Beam booking on the example site", details: "Set their hours and the one thing people book or order (from the application)." },
    { phase: 3, title: "Book one test yourself, start to finish" },
    { phase: 3, title: "Write down which add-ons fit them", details: "Beam control page → this shop → Neal Media. Website, SEO, review requests, reviews on the site, change requests." },
    { phase: 3, auto: "welcome", title: "Send the welcome email", details: "Beam control page → this shop → Send welcome email. Example site, password link and setup link in one email." },
    { phase: 3, title: `15-minute walkthrough call with ${c.owner}`, details: "On their phone: the inbox, the booking page and this checklist." },
    // Phase 4: check-ins during the try-it period
    { phase: 4, title: "Check in at day 30" },
    { phase: 4, title: "Check in at day 60" },
    { phase: 4, title: "Check in at day 80", details: "Ten days left. Are they happy? What's still in the way?" },
    // Phase 6
    { phase: 6, title: "Price the add-ons and send the agreement", details: "The add-ons they used during the build are on the Beam control page." },
    { phase: 6, auto: "signed", title: `${c.owner} signs the agreement`, details: "Beam control page → this shop → Neal Media status → Agreement signed. That unlocks the rest of the list." },
    { phase: 6, after: true, title: "Accept Google Business manager access", details: `Once ${c.owner} adds Neal Media, accept the invite (email from Google), then link the profile on the Beam control page so reviews show.` },
    { phase: 6, after: true, title: "Move the site to their domain", details: "Their web address on the Beam control page and in Vercel, and the site's own project." },
    { phase: 6, after: true, title: "Google Search Console", details: "Add and verify the business's domain, submit the sitemap, and connect rank tracking for the SEO report.", link: { label: "Open Search Console", url: "https://search.google.com/search-console" } },
    { phase: 6, after: true, title: "Texting number and campaign", details: `Register ${c.shop}'s texting (A2P campaign) once the owner sends their business details, then set the shop's texting number on the Beam control page.` },
    { phase: 6, after: true, title: "Add \"Managed by Neal Media\" to their pages" },
  ] : [
    { title: "Accept Google Business manager access", details: `Once ${c.owner} adds Neal Media, accept the invite (email from Google), then link the profile on the Beam control page so reviews show.` },
    { title: "Check the web address", details: `Beam control page → ${c.shop} → web addresses. Client links in emails and texts use the first address, so it must be one that serves the booking pages.` },
    { title: "Welcome call", details: `Walk ${c.owner} through the inbox, the booking page and this checklist. Agree a go-live date.` },
  ]),
];

async function users() { return (await auth.users()).filter((u) => u.active !== false); }
async function list() {
  let l = await store.getJSON("setup:list");
  if (!l) { l = await seed(); } else l = await addNewPeople(l);
  let changed = false; // older lists: the payments item becomes the bank-account item with Stripe's form button
  for (const it of l) if (it.auto === "stripe" && it.link?.url !== STRIPE_ITEM.link.url) { Object.assign(it, STRIPE_ITEM); changed = true; }
  if (changed) await store.setJSON("setup:list", l);
  return l;
}
function ctx(us) {
  const cfg = require("../config/studio"), neal = require("./starter").nealOf(cfg);
  const owner = us.find((u) => u.role === "owner");
  return { shop: cfg.studio?.name || "your business", owner: (owner?.name || "the owner").split(" ")[0],
    team: us.filter((u) => !["owner", "admin"].includes(u.role)).map((u) => u.name.split(" ")[0]),
    // Booking-only shops get the Beam steps; shops we're building a site for (and current clients) get the website steps too.
    website: neal.status !== "booking", shellUrl: neal.shellUrl || "" };
}
const itemsFor = (u, c) => (u.role === "owner" ? OWNER : u.role === "admin" ? ADMIN : BARBER)(c);
async function seed() {
  const out = []; let n = 0; const us = await users(), c = ctx(us);
  for (const u of us) for (const t of itemsFor(u, c)) out.push({ id: id(), user: u.id, order: n++, ...t });
  await store.setJSON("setup:list", out);
  await store.setJSON("setup:seeded", us.map((u) => u.id));
  return out;
}
// Someone added after the list was made (a new barber, Neal Media's login) gets their own starting items, once.
async function addNewPeople(l) {
  const us = await users();
  let seeded = await store.getJSON("setup:seeded");
  if (!seeded) { // a list made before this existed: everyone already here stays as they are; only people added from now on get items
    await store.setJSON("setup:seeded", us.map((u) => u.id));
    return l;
  }
  const fresh = us.filter((u) => !seeded.includes(u.id) && !l.some((x) => x.user === u.id));
  if (!fresh.length) return l;
  if (require("./starter").nealOf(require("../config/studio")).status === "current") { // current clients: lists stay as they are
    await store.setJSON("setup:seeded", [...seeded, ...fresh.map((u) => u.id)]);
    return l;
  }
  const c = ctx(us); let n = Math.max(0, ...l.map((x) => x.order || 0)) + 1;
  for (const u of fresh) for (const t of itemsFor(u, c)) l.push({ id: id(), user: u.id, order: n++, ...t });
  await store.setJSON("setup:list", l);
  await store.setJSON("setup:seeded", [...seeded, ...fresh.map((u) => u.id)]);
  return l;
}

// Things that tick themselves off.
async function autoDone(item, u) {
  try {
    if (item.auto === "password") return Boolean(u && u.hash && u.lastLogin);
    if (item.auto === "instagram") return Boolean((await require("./instagram").status())?.connected);
    if (item.auto === "stripe") { const s = await require("./payments").status(); return Boolean(s.account?.ready); }
    if (item.auto === "calendar") { const cfg = require("../config/studio"), slugs = ["shop", ...(cfg.artists || []).map((a) => a.slug)];
      const seen = await Promise.all(slugs.map((k) => store.getJSON(`calfeed:seen:${k}`))); return seen.some((x) => x && Date.now() - x.at < 30 * 24 * 3600 * 1000); }
    if (item.auto === "site") { const v = await require("./site").progress(); return v.total > 0 && v.done >= v.total; }
    if (item.auto === "welcome") return Boolean(require("../config/studio").neal?.welcomeSentAt);
    if (item.auto === "signed") return require("./starter").nealOf(require("../config/studio")).status === "signed";
  } catch {}
  return false;
}

async function view(me, all) {
  const l = await list(), us = await users(), byId = new Map(us.map((u) => [u.id, u]));
  const neal = require("./starter").nealOf(require("../config/studio"));
  const locked = neal.status === "building"; // "after" items wait for the agreement; signed, booking-only and current clients see everything
  const out = [];
  for (const it of l) {
    if (!all && it.user !== me.id) continue;
    const u = byId.get(it.user); if (!u) continue;
    const auto = it.auto ? await autoDone(it, u) : false;
    out.push({ ...it, done: Boolean(it.doneAt) || auto, autoDone: auto, userName: u.name, mine: it.user === me.id, locked: Boolean(it.after && locked) });
  }
  return { items: out.sort((a, b) => a.order - b.order), people: all ? us.map((u) => ({ id: u.id, name: u.name, role: u.role })) : undefined,
    neal: { status: neal.status, label: neal.label, day: neal.day || null, daysLeft: neal.daysLeft ?? null } };
}

async function setDone(me, itemId, done, full) {
  const l = await list(), it = l.find((x) => x.id === itemId); if (!it) throw new Error("That item isn't there any more.");
  if (it.user !== me.id && !full) throw new Error("That's on someone else's list.");
  if (it.after && require("./starter").nealOf(require("../config/studio")).status === "building") throw new Error("This one opens once the agreement is signed.");
  if (done) { it.doneAt = Date.now(); it.doneBy = me.name; } else { delete it.doneAt; delete it.doneBy; }
  await store.setJSON("setup:list", l);
}
async function save(b) { // add or edit
  const l = await list(), us = await users();
  const title = clip(b.title, 120); if (title.length < 3) throw new Error("Give the item a title.");
  if (!us.some((u) => u.id === b.user)) throw new Error("Pick whose list it goes on.");
  const url = clip(b.linkUrl, 400), link = url && /^(https:\/\/|\/)/.test(url) ? { label: clip(b.linkLabel, 40) || "Open", url } : undefined;
  let it = b.id ? l.find((x) => x.id === b.id) : null;
  if (!it) { it = { id: id(), order: Math.max(0, ...l.map((x) => x.order || 0)) + 1 }; l.push(it); }
  Object.assign(it, { user: b.user, title, details: String(b.details ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 1500), link });
  if (!link) delete it.link;
  await store.setJSON("setup:list", l); return it;
}
async function remove(itemId) { await store.setJSON("setup:list", (await list()).filter((x) => x.id !== itemId)); }

module.exports = { list, view, setDone, save, remove, seed };
