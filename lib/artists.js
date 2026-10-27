// Artists: the ones in config/studio.js plus any the owner adds from the inbox (Team → add an artist login).
// Added artists only show on the public booking form once "Show on booking form" is switched on.

const config = require("../config/studio");
const store = require("./store");

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
    instagram: a.instagram || "", email: a.email || "",
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

module.exports = { list, bySlug, setOpen, setListed, setProfile, photoUrl, add };
