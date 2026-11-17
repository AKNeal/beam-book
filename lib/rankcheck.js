// Daily Google rank check for every shop that has one set up (ported from Black Wolf's own site, Nov 2026).
// For each of the shop's searches, Google's Places API (Text Search, New) is asked for the top 10 near the shop, and the
// shop's position is found by its Google place ID. One check per shop per day is saved under "rankings:checks".
// Setup per shop (control page): Google place ID, the searches, and the point to search from (lat/lng, radius).
// Needs env GOOGLE_PLACES_KEY (or GOOGLE_PLACES_API_KEY). Without it, or without a place ID, nothing is guessed.
// Friday checks (shop time) are marked weekly:true; the month's average uses only those.

const config = require("../config/studio");
const store = require("./store");
const T = require("./time");

const KEY = "rankings:checks", RUN = "rankings:lastRun", KEEP = 400;
const apiKey = () => process.env.GOOGLE_PLACES_KEY || process.env.GOOGLE_PLACES_API_KEY || "";
const setup = () => {
  const r = config.ranking || {};
  return { placeId: config.googlePlaceId || "", searches: (r.searches || []).filter(Boolean).slice(0, 5),
    center: Number.isFinite(r.lat) && Number.isFinite(r.lng) ? { latitude: r.lat, longitude: r.lng } : null, radius: r.radius || 5000 };
};
const enabled = () => { const s = setup(); return Boolean(s.placeId && s.searches.length); };

async function places(fetchImpl, key, body, fieldMask, url = "https://places.googleapis.com/v1/places:searchText", method = "POST") {
  const r = await fetchImpl(url, { method, headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": fieldMask },
    body: body ? JSON.stringify(body) : undefined });
  let data = {}; try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(`Google Places ${r.status}: ${data.error?.message || "request failed"}`);
  return data;
}

// One search: rank is the shop's 1-based place in the top 10, or 11 (">10") if it isn't there.
async function search(fetchImpl, key, q, s) {
  const data = await places(fetchImpl, key, { textQuery: q, pageSize: 10, languageCode: "en", regionCode: "US",
    ...(s.center ? { locationBias: { circle: { center: s.center, radius: s.radius } } } : {}) }, "places.id,places.displayName,places.userRatingCount");
  const list = (data.places || []).slice(0, 10);
  const i = list.findIndex((p) => p.id === s.placeId);
  return { rank: i === -1 ? 11 : i + 1, top: list.slice(0, 5).map((p) => p.displayName?.text || "(no name)") };
}

async function checks() { const v = await store.getJSON(KEY); return Array.isArray(v) ? v : []; }
async function lastRun() { return store.getJSON(RUN); }

// Today's check for the current shop. Skips if today's is already saved, unless force.
async function run({ now = Date.now(), force = false, fetchImpl = fetch } = {}) {
  const s = setup(), key = apiKey(), date = T.dateKey(now);
  if (!enabled()) return { skipped: "not set up" };
  if (!key) { await store.setJSON(RUN, { at: new Date(now).toISOString(), date, ok: false, error: "GOOGLE_PLACES_KEY isn't set in Vercel." }); return { skipped: "no key" }; }
  const all = await checks();
  if (!force && all.some((c) => c.date === date)) return { skipped: "already checked today", date };
  try {
    const ranks = {};
    for (const q of s.searches) ranks[q] = await search(fetchImpl, key, q, s);
    const me = await places(fetchImpl, key, null, "rating,userRatingCount", `https://places.googleapis.com/v1/places/${encodeURIComponent(s.placeId)}`, "GET");
    const check = { date, at: new Date(now).toISOString(), reviews: me.userRatingCount ?? null, rating: me.rating ?? null, ranks };
    if (T.weekdayOf(T.parseDate(date)) === 5) check.weekly = true;
    await store.setJSON(KEY, all.filter((c) => c.date !== date).concat(check).sort((a, b) => a.date.localeCompare(b.date)).slice(-KEEP));
    await store.setJSON(RUN, { at: check.at, date, ok: true });
    return { ok: true, check };
  } catch (e) {
    await store.setJSON(RUN, { at: new Date(now).toISOString(), date, ok: false, error: e.message });
    return { error: e.message };
  }
}

// Daily job: every active shop with a rank check set up.
async function daily() {
  const tenant = require("./tenant"), out = {};
  for (const shop of await tenant.listShops()) {
    if (shop.active === false || !shop.googlePlaceId || !shop.ranking?.searches?.length) continue;
    try { out[shop.slug] = await tenant.runAs(shop.slug, () => run()); } catch (e) { out[shop.slug] = { error: e.message }; }
  }
  return out;
}

// For the shop's inbox: latest ranks per search with the change since the check before, reviews, and the month's Friday average.
async function summary() {
  if (!enabled()) return null;
  const all = await checks(); if (!all.length) return { pending: true, searches: setup().searches.map((q) => ({ q, rank: null, change: null, top: [] })), lastRun: await lastRun() };
  const last = all[all.length - 1], prev = all[all.length - 2], month = T.dateKey(Date.now()).slice(0, 7);
  const ranksIn = (cs) => cs.flatMap((c) => Object.values(c.ranks || {}).map((x) => x.rank)).filter(Number.isFinite);
  const weekly = all.filter((c) => c.weekly && c.date.startsWith(month)), mr = ranksIn(weekly);
  return {
    date: last.date, reviews: last.reviews, rating: last.rating, changeSince: prev ? prev.date : null,
    reviewsGained: Number.isFinite(all[0].reviews) && Number.isFinite(last.reviews) ? last.reviews - all[0].reviews : null, reviewsSince: all[0].date,
    checksThisMonth: weekly.length, monthAvg: mr.length ? Math.round(10 * mr.reduce((a, b) => a + b, 0) / mr.length) / 10 : null,
    searches: setup().searches.map((q) => { const n = last.ranks?.[q]?.rank, b = prev?.ranks?.[q]?.rank;
      return { q, rank: n ?? null, change: Number.isFinite(n) && Number.isFinite(b) ? b - n : null, top: last.ranks?.[q]?.top || [] }; }),
    lastRun: await lastRun(),
  };
}

module.exports = { run, daily, summary, checks, lastRun, enabled, KEY };
