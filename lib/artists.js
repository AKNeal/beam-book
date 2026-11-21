// Artists: the ones in config/studio.js plus any the owner adds from the inbox (Team → add an artist login).
// Added artists only show on the public booking form once "Show on booking form" is switched on.

const config = require("../config/studio");
const store = require("./store");

// A barber's own social links (besides Instagram): TikTok/X/Snapchat as handles, the rest as links.
const BARBER_SOCIALS = { tiktok: "TikTok", facebook: "Facebook", snapchat: "Snapchat", youtube: "YouTube", x: "X", website: "Website" };
function cleanSocials(o) {
  const out = {};
  for (const k of Object.keys(BARBER_SOCIALS)) {
    let v = String((o || {})[k] || "").trim().slice(0, 200); if (!v) continue;
    if (["tiktok", "snapchat", "x"].includes(k) && !/^https?:\/\//i.test(v)) {
      v = v.replace(/^@/, ""); if (!/^[A-Za-z0-9._-]{1,30}$/.test(v)) continue; v = "@" + v;
    } else {
      if (!/^https?:\/\//i.test(v)) v = "https://" + v;
      try { const u = new URL(v); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) continue; v = u.href; } catch { continue; }
    }
    out[k] = v;
  }
  return out;
}
const slugify = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 40);

async function extras() { return (await store.getJSON("artists:extra")) || []; }

// All artists (inbox). Public pages pass {publicOnly:true} to hide unlisted ones.
async function list({ publicOnly = false } = {}) {
  const state = (await store.getJSON("artist-state")) || {};
  const profiles = (await store.getJSON("artist-profiles")) || {};
  const all = [
    ...config.artists.map((a) => ({ ...a, listed: true, added: false })),
    ...(await extras()).map((a) => ({ ...a, added: true })),
  ].map((a) => ({ ...a, ...(profiles[a.slug] || {}) })).map((a) => ({
    slug: a.slug, name: a.name, styles: a.styles || [], bio: a.bio || "", photo: a.photo || "", sample: a.sample || "",
    instagram: a.instagram || "", socials: a.socials || {}, email: a.email || "", title: a.title || "", years: a.years || "",
    listed: state[a.slug]?.listed ?? a.listed, added: a.added,
    booksOpen: state[a.slug]?.booksOpen ?? a.booksOpenDefault ?? true,
  }));
  return publicOnly ? all.filter((a) => a.listed).map(({ listed, added, email, ...pub }) => pub) : all;
}

async function bySlug(slug) { return (await list()).find((a) => a.slug === slug) || null; }

async function setState(slug, patch) {
  if (!(await bySlug(slug))) return false;
  const state = (await store.getJSON("artist-state")) || {};
  state[slug] = { ...(state[slug] || {}), ...patch };
  await store.setJSON("artist-state", state);
  return true;
}
const setOpen = (slug, open) => setState(slug, { booksOpen: Boolean(open) });
const setListed = (slug, listed) => setState(slug, { listed: Boolean(listed) });

// Profile shown on the public Artists page: name, styles, bio, Instagram, portrait (a stored file name).
async function setProfile(slug, patch) {
  if (!(await bySlug(slug))) return false;
  const all = (await store.getJSON("artist-profiles")) || {};
  all[slug] = { ...(all[slug] || {}), ...patch };
  await store.setJSON("artist-profiles", all);
  return true;
}
// Public address for an artist's portrait (or their sample work image, or nothing).
function photoUrl(a) {
  if (a.photo && a.photo.startsWith(`${config.tenant}/artists/`)) return `/api/artists?photo=${encodeURIComponent(a.slug)}&v=${a.photo.slice(-10, -4)}`;
  return a.photo || a.sample || "";
}

async function add(name) {
  name = String(name || "").trim().slice(0, 60);
  if (name.length < 2) throw new Error("Enter the artist's name.");
  const taken = new Set((await list()).map((a) => a.slug));
  let slug = slugify(name) || "artist", n = 2;
  while (taken.has(slug)) slug = `${slugify(name)}-${n++}`;
  const xs = await extras();
  xs.push({ slug, name, styles: [], bio: "", photo: "", listed: false, booksOpenDefault: true, createdAt: new Date().toISOString() });
  await store.setJSON("artists:extra", xs);
  return slug;
}

// Take a barber off the shop for good (Owner). Refused while they have upcoming appointments or a login.
async function remove(slug) {
  const a = await bySlug(slug);
  if (!a) throw new Error("Unknown barber.");
  const all = await list();
  if (all.length < 2) throw new Error("The shop needs at least one barber.");
  const cal = require("./calendar");
  const ahead = await cal.apptsBetween(slug, Date.now(), Date.now() + 400 * 864e5);
  if (ahead.length) throw new Error(`${a.name} still has ${ahead.length} upcoming appointment${ahead.length === 1 ? "" : "s"}. Move or cancel them first.`);
  const users = (await store.getJSON("users")) || [];
  if (users.some((u) => u.artist === slug)) throw new Error(`${a.name} still has a login. Remove it under Team first.`);
  if (a.added) await store.setJSON("artists:extra", (await extras()).filter((x) => x.slug !== slug));
  else {
    const tenant = require("./tenant");
    const rec = await tenant.getRecord(config.tenant);
    await tenant.saveRecord({ ...rec, artists: (rec.artists || []).filter((x) => x.slug !== slug) });
    const cfg = tenant.current(); cfg.artists = (cfg.artists || []).filter((x) => x.slug !== slug);
  }
  for (const k of ["artist-state", "artist-profiles"]) { const m = (await store.getJSON(k)) || {}; if (m[slug]) { delete m[slug]; await store.setJSON(k, m); } }
  return a.name;
}

module.exports = { BARBER_SOCIALS, cleanSocials, list, bySlug, setOpen, setListed, setProfile, photoUrl, add, remove };
