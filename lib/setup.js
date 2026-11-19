// Setup checklist: what each login still needs to do to get the shop fully running (Google access for SEO,
// Instagram, payments, texting...). Each item belongs to one login; some tick themselves off (auto).
// The Owner / Administrator see everyone's list and can add, edit or remove items.
//
// Store: setup:list  [{ id, user, title, details, link: {label, url}?, auto?, doneAt?, doneBy?, order }]
const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");

const id = () => crypto.randomBytes(5).toString("hex");
const clip = (s, n) => String(s ?? "").trim().slice(0, n);

// Starting items, by who the login is.
// Bank info goes straight into Stripe's own secure form (opened from the button), never into Beam.
const STRIPE_ITEM = {
  title: "Add the shop's bank account for card payments",
  details: "So card payments deposit into Level Up's bank. Tap the button to open Stripe's secure form (about 5 minutes) and have ready:\n• The business's legal name and EIN\n• The owner's name, date of birth, home address and last 4 of SSN (Stripe verifies it's really the business owner)\n• The bank's routing and account number for deposits\nNeal Media runs everything else; there's no Stripe login to keep track of. Ticks itself off when Stripe says the shop can take payments.",
  link: { label: "Open Stripe's secure form", url: "beam:payConnect" },
};
const OWNER = [
  { auto: "password", title: "Set your password and log in", details: "Use the link in your email (or ask Neal for a fresh one). Then log in at your dashboard." },
  { title: "Give Neal Media access to your Google Business Profile", details: "This lets us start your SEO, keep your hours and photos right, and show your Google reviews on the site.\n1. Open business.google.com (or search your shop name on Google while logged in) and open your profile.\n2. Menu (⋮) → Business Profile settings → People and access → Add.\n3. Add Neal Media's Google account as a Manager (Neal will send you the address).\n4. Tick this off once it's sent. We accept it on our side.", link: { label: "Open Google Business", url: "https://business.google.com/" } },
  { auto: "instagram", title: "Connect your Instagram", details: "Shows your latest posts on the website.\n1. In the Instagram app: Settings → Account type and tools → switch to a Professional account (Business or Creator) if it isn't one.\n2. Here in the dashboard: Account → Connect Instagram, and log in to Instagram on Instagram's page.\nIt ticks itself off once connected." },
  { auto: "stripe", ...STRIPE_ITEM },
  { title: "Send your business details for texting", details: "Carriers need the shop's legal name, EIN, address and contact so texts come from Level Up instead of Neal Media. It's on your setup link, under Texting." },
  { title: "Check your services, prices and hours", details: "Look over the booking page as a client would. Tell us anything that's wrong (Website → Change requests).", link: { label: "Open the booking page", url: "/appointment" } },
  { title: "Book a test appointment and check out", details: "Book yourself with \"TEST\" as the name (no email or text goes to the shop for test bookings), then try Checkout with the $5 cash discount." },
  { title: "Add the email records to your domain", details: "So the shop's emails come from your own address. The records are on Website → Checklist (Squarespace → Domains → DNS)." },
];
const BARBER = [
  { auto: "password", title: "Set your password and log in", details: "Use the link in your email (or ask for a fresh one)." },
  { title: "Sync your calendar", details: "Put your bookings on your phone's calendar and keep outside appointments from double-booking. Your link is on the setup page under Calendars." },
  { title: "Check your services, prices and hours", details: "Make sure what clients see on the booking page is right for you.", link: { label: "Open the booking page", url: "/appointment" } },
  { title: "Add your photo and bio", details: "Send Neal a photo and two or three lines about you (or add them under Website)." },
];
const ADMIN = [
  { title: "Accept Google Business manager access", details: "Once Snow adds Neal Media, accept the invite (email from Google), then link the profile on the Beam control page so reviews show." },
  { title: "Google Search Console", details: "Add and verify the shop's domain, submit the sitemap, and connect rank tracking for the SEO report.", link: { label: "Open Search Console", url: "https://search.google.com/search-console" } },
  { title: "Meta / Instagram app", details: "Meta developer app with Instagram (Instagram Login): IG_APP_ID and IG_APP_SECRET in Vercel, and https://levelup.beam-book.com/instagram/callback as a redirect URL. Add the shop's Instagram as a tester until the app is approved.", link: { label: "Open Meta for Developers", url: "https://developers.facebook.com/apps/" } },
  { title: "Stripe Connect platform approved", details: "Platform profile (ID review), then \"Confirm your integration choices\". After that, Snow's Get paid step works." },
  { title: "Twilio campaign submitted and keys in Vercel", details: "Submit the A2P campaign; add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_MESSAGING_SERVICE_SID to beam-book; set the shop's texting number." },
  { title: "Switch Level Up's web address to levelup.beam-book.com", details: "Beam control page → Level Up → web addresses. Fixes client links in emails and texts (they point at levelup.nealmedia.app, which doesn't serve the booking pages)." },
  { title: "Send Snow and Isacc their password links", details: "Team → Password link on each of them. They choose their own password; nothing else is needed from you." },
  { title: "Set PII_KEY in Vercel before real apprentice data", details: "A long random string. Encrypts SSNs and other paperwork details. Set it before anyone saves real details (changing it later makes saved details unreadable)." },
];

async function users() { return (await auth.users()).filter((u) => u.active !== false); }
async function list() {
  let l = await store.getJSON("setup:list");
  if (!l) { l = await seed(); }
  let changed = false; // older lists: the payments item becomes the bank-account item with Stripe's form button
  for (const it of l) if (it.auto === "stripe" && it.link?.url !== STRIPE_ITEM.link.url) { Object.assign(it, STRIPE_ITEM); changed = true; }
  if (changed) await store.setJSON("setup:list", l);
  return l;
}
async function seed() {
  const out = []; let n = 0;
  for (const u of await users()) {
    const tpl = u.role === "owner" ? OWNER : u.role === "admin" ? ADMIN : BARBER;
    for (const t of tpl) out.push({ id: id(), user: u.id, order: n++, ...t });
  }
  await store.setJSON("setup:list", out); return out;
}

// Things that tick themselves off.
async function autoDone(item, u) {
  try {
    if (item.auto === "password") return Boolean(u && u.hash && u.lastLogin);
    if (item.auto === "instagram") return Boolean((await require("./instagram").status())?.connected);
    if (item.auto === "stripe") { const s = await require("./payments").status(); return Boolean(s.account?.ready); }
  } catch {}
  return false;
}

async function view(me, all) {
  const l = await list(), us = await users(), byId = new Map(us.map((u) => [u.id, u]));
  const out = [];
  for (const it of l) {
    if (!all && it.user !== me.id) continue;
    const u = byId.get(it.user); if (!u) continue;
    const auto = it.auto ? await autoDone(it, u) : false;
    out.push({ ...it, done: Boolean(it.doneAt) || auto, autoDone: auto, userName: u.name, mine: it.user === me.id });
  }
  return { items: out.sort((a, b) => a.order - b.order), people: all ? us.map((u) => ({ id: u.id, name: u.name, role: u.role })) : undefined };
}

async function setDone(me, itemId, done, full) {
  const l = await list(), it = l.find((x) => x.id === itemId); if (!it) throw new Error("That item isn't there any more.");
  if (it.user !== me.id && !full) throw new Error("That's on someone else's list.");
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
