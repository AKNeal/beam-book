// Google ranking for every shop that has it (ported from Black Wolf's own site, Nov 2026).
// Real ranks come from a real Google search: a scheduled task in Neal Media's Chrome searches each phrase every morning
// (after 1 am shop time) and sends what it read with ingest() (POST /api/artists?rank=ingest, Bearer RANK_INGEST_TOKEN).
// The Places API check below ranks by distance, not like Google Search, so it only runs (and only counts) with RANK_SOURCE=places.
// Up to 5 searches per shop: Neal Media sets the first ones (the first ingest sets them if none are saved), the owner
// can change them in the inbox. Fee scale (results-based, same as every Neal Media SEO client): the month's average of
// the Friday checks, rounded: #1 +$150, #2 +$100, #3 +$75, #4-5 +$50, below #5 $0.
//
// (Places API notes kept below.)
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
  return { report: reportId(r.report) ? r.report : "", placeId: config.googlePlaceId || "", searches: (r.searches || []).filter(Boolean).slice(0, 5),
    center: Number.isFinite(r.lat) && Number.isFinite(r.lng) ? { latitude: r.lat, longitude: r.lng } : null, radius: r.radius || 5000 };
};
const enabled = () => setup().searches.length > 0 || Boolean(setup().report);

// The official report (Local Rankings at localdata.tools): when a shop has one, the average of its Google Maps and Google Organic ranks is what Beam reports,
// awards and bills on. Reviews and stars still come from Beam's own morning check. Cached for an hour.
const REPORT = "rankings:report:v2"; // v2: Maps + Organic
function reportId(url) { const m = String(url || "").match(/^https:\/\/localdata\.tools\/results\/(\d{1,9})\/?$/); return m ? m[1] : null; }
async function reportChecks({ now = Date.now(), fetchFn = globalThis.fetch, fresh = false } = {}) {
  const id = reportId(setup().report); if (!id) return null;
  const cached = await store.getJSON(REPORT);
  if (!fresh && cached && cached.id === id && now - cached.fetched < 3600e3) return cached;
  try {
    // Both Google Maps and Google Organic from the same report; a search's rank for the day is the average of the two
    // (11 = not in the top 10). Only one of them for a day: that one.
    const start = T.dateKey(now - 70 * 864e5), end = T.dateKey(now);
    const pull = async (type) => {
      const rows = [];
      for (let page = 1; page <= 6; page++) {
        const u = `https://localdata.tools/v2/campaigns/${id}/rankings?type=${type}&start=${start}&end=${end}&period=all&page%5Bnumber%5D=${page}&page%5Bsize%5D=50`;
        const r = await fetchFn(u, { headers: { accept: "application/json" } });
        if (!r.ok) throw new Error(`The report answered ${r.status}.`);
        const d = (await r.json()).rankings || {}; rows.push(...(d.data || []));
        if (!d.last_page || page >= d.last_page) break;
      }
      return rows;
    };
    const maps = await pull("google-maps"), organic = await pull("google-organic").catch(() => []);
    const keywords = [...new Set([...maps, ...organic].filter((x) => x.enabled !== false).map((x) => String(x.keyword)))];
    const byDate = {};
    const add = (rows, kind) => { for (const x of rows) for (const [date, v] of Object.entries(x.bestRankings || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const rk = Number(v?.rank); ((byDate[date] ||= {})[x.keyword] ||= {})[kind] = rk >= 1 && rk <= 10 ? rk : 11;
    } };
    add(maps, "maps"); add(organic, "organic");
    for (const day of Object.values(byDate)) for (const [k, v] of Object.entries(day)) {
      const parts = [v.maps, v.organic].filter(Number.isFinite);
      day[k] = { rank: Math.round(10 * parts.reduce((a, b) => a + b, 0) / parts.length) / 10, maps: v.maps ?? null, organic: v.organic ?? null, top: [] };
    }
    const checks = Object.keys(byDate).sort().map((date) => ({ date, at: `${date}T12:00:00Z`, source: "report", ranks: byDate[date],
      ...(T.weekdayOf(T.parseDate(date)) === 5 ? { weekly: true } : {}) }));
    const out = { id, fetched: now, keywords, checks };
    await store.setJSON(REPORT, out); return out;
  } catch (e) { return cached && cached.id === id ? { ...cached, stale: e.message } : { id, keywords: [], checks: [], error: e.message }; }
}
const placesOn = () => process.env.RANK_SOURCE === "places" && Boolean(setup().placeId);
const FEE = (avg) => { const r = Math.round(avg); return r <= 1 ? 150 : r === 2 ? 100 : r === 3 ? 75 : r <= 5 ? 50 : 0; };

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

async function checks() { const v = await store.getJSON(KEY); return (Array.isArray(v) ? v : []).filter((c) => c.source !== "places-api" || process.env.RANK_SOURCE === "places"); }
async function rawChecks() { const v = await store.getJSON(KEY); return Array.isArray(v) ? v : []; }
async function lastRun() { return store.getJSON(RUN); }

// Today's check for the current shop. Skips if today's is already saved, unless force.
async function run({ now = Date.now(), force = false, fetchImpl = fetch } = {}) {
  const s = setup(), key = apiKey(), date = T.dateKey(now);
  if (!enabled() || !placesOn()) return { skipped: "checks come from the morning Google search (ingest)" };
  if (!key) { await store.setJSON(RUN, { at: new Date(now).toISOString(), date, ok: false, error: "GOOGLE_PLACES_KEY isn't set in Vercel." }); return { skipped: "no key" }; }
  const all = await checks();
  if (!force && all.some((c) => c.date === date)) return { skipped: "already checked today", date };
  try {
    const ranks = {};
    for (const q of s.searches) ranks[q] = await search(fetchImpl, key, q, s);
    const me = await places(fetchImpl, key, null, "rating,userRatingCount", `https://places.googleapis.com/v1/places/${encodeURIComponent(s.placeId)}`, "GET");
    const check = { date, at: new Date(now).toISOString(), source: "places-api", reviews: me.userRatingCount ?? null, rating: me.rating ?? null, ranks };
    if (T.weekdayOf(T.parseDate(date)) === 5) check.weekly = true;
    await store.setJSON(KEY, (await rawChecks()).filter((c) => c.date !== date).concat(check).sort((a, b) => a.date.localeCompare(b.date)).slice(-KEEP));
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
    if (process.env.RANK_SOURCE !== "places") break;
    if (shop.active === false || !shop.googlePlaceId || !shop.ranking?.searches?.length) continue;
    try { out[shop.slug] = await tenant.runAs(shop.slug, () => run()); } catch (e) { out[shop.slug] = { error: e.message }; }
  }
  return out;
}

// A check read off a real Google search (the business list under the search box), sent by the morning task.
// body: { date?, searches: { "<phrase>": { rank: 1-10 or null (not listed), top: [names] } }, rating?, reviews?, note? }.
// If the shop has no searches saved yet, these phrases become its searches (up to 5). Same day again replaces that day.
async function ingest(body, { now = Date.now() } = {}) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.date || "")) ? body.date : T.dateKey(now);
  let want = setup().searches;
  if (!want.length) {
    want = Object.keys(body?.searches || {}).map((q) => String(q).trim().slice(0, 80)).filter(Boolean).slice(0, 5);
    if (!want.length) throw new Error("Send at least one search.");
    await saveSearches(want);
  }
  const ranks = {};
  for (const q of want) {
    const x = body?.searches?.[q];
    if (!x) throw new Error(`Missing the search "${q}".`);
    const r = x.rank == null ? 11 : Number(x.rank);
    if (!Number.isInteger(r) || r < 1 || r > 11) throw new Error(`"${q}": rank should be 1 to 10, or null if the shop wasn't listed.`);
    ranks[q] = { rank: r, top: (Array.isArray(x.top) ? x.top : []).slice(0, 10).map((n) => String(n).slice(0, 80)) };
  }
  const num = (v, lo, hi) => (v == null || v === "" ? null : Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null);
  const check = { date, at: new Date(now).toISOString(), source: "google-search", reviews: num(body.reviews, 0, 100000), rating: num(body.rating, 1, 5), ranks };
  if (T.weekdayOf(T.parseDate(date)) === 5) check.weekly = true;
  if (body.note) check.note = String(body.note).slice(0, 300);
  await store.setJSON(KEY, (await rawChecks()).filter((c) => c.date !== date).concat(check).sort((a, b) => a.date.localeCompare(b.date)).slice(-KEEP));
  await store.setJSON(RUN, { at: check.at, date, ok: true, source: "google-search" });
  return check;
}

// Is a search due? Yes once a day, after 1 am shop time, if today's check isn't in yet.
async function due({ now = Date.now() } = {}) {
  if (!enabled()) return { due: false, reason: "no searches set up" };
  const all = await checks(), last = all[all.length - 1], today = T.dateKey(now);
  if ((!last || last.date !== today) && T.parts(now).h >= 1) return { due: true, reason: "morning check", searches: setup().searches };
  return { due: false, lastCheck: last ? last.at : null, searches: setup().searches };
}

// The owner's searches (up to 5).
async function saveSearches(list) {
  const tenant = require("./tenant");
  const clean = [...new Set((Array.isArray(list) ? list : []).map((q) => String(q).trim().replace(/\s+/g, " ").slice(0, 80)).filter(Boolean))];
  if (clean.length > 5) throw new Error("Up to 5 searches.");
  const rec = await tenant.getRecord(config.tenant);
  await tenant.saveRecord({ ...rec, ranking: { ...(rec.ranking || {}), searches: clean } });
  return clean;
}

// Neal Media links the shop's official report ("" removes it).
async function saveReport(url) {
  const tenant = require("./tenant"), u = String(url || "").trim().replace(/\/$/, "");
  if (u && !reportId(u)) throw new Error("Use the report's link, like https://localdata.tools/results/12345.");
  const rec = await tenant.getRecord(config.tenant);
  await tenant.saveRecord({ ...rec, ranking: { ...(rec.ranking || {}), report: u } });
  await store.del(REPORT).catch(() => {});
  return u;
}

const avgOf = (c) => { const r = Object.values(c?.ranks || {}).map((x) => x.rank).filter(Number.isFinite); return r.length ? Math.round(10 * r.reduce((a, b) => a + b, 0) / r.length) / 10 : null; };

// For the shop's inbox: latest ranks per search with the change since the check before, reviews, and the month's Friday average.
async function summary({ searches, now } = {}) {
  const rep = await reportChecks({ now }), report = setup().report || null;
  const list = rep ? rep.keywords : searches || setup().searches;
  if (!list.length) return rep ? { pending: true, report, searches: [], lastRun: await lastRun() } : null;
  let all = await checks();
  if (rep) { // ranks from the report; reviews and stars from Beam's own check on or before that day
    const own = all.filter((c) => Number.isFinite(c.reviews));
    all = rep.checks.map((c) => { const o = own.filter((x) => x.date <= c.date).pop() || own[0]; return o ? { ...c, reviews: o.reviews, rating: o.rating } : c; });
  }
  if (!all.length) return { pending: true, report, searches: list.map((q) => ({ q, rank: null, change: null, top: [] })), lastRun: await lastRun() };
  const last = all[all.length - 1], prev = all[all.length - 2], month = T.dateKey(Date.now()).slice(0, 7);
  const ranksIn = (cs) => cs.flatMap((c) => Object.values(c.ranks || {}).map((x) => x.rank)).filter(Number.isFinite);
  const weekly = all.filter((c) => c.weekly && c.date.startsWith(month)), mr = ranksIn(weekly);
  return {
    report, date: last.date, reviews: last.reviews, rating: last.rating, changeSince: prev ? prev.date : null,
    reviewsGained: Number.isFinite(all[0].reviews) && Number.isFinite(last.reviews) ? last.reviews - all[0].reviews : null, reviewsSince: all[0].date,
    checksThisMonth: weekly.length, monthAvg: mr.length ? Math.round(10 * mr.reduce((a, b) => a + b, 0) / mr.length) / 10 : null,
    searches: list.map((q) => { const n = last.ranks?.[q]?.rank, b = prev?.ranks?.[q]?.rank;
      return { q, rank: n ?? null, maps: last.ranks?.[q]?.maps ?? null, organic: last.ranks?.[q]?.organic ?? null,
        change: Number.isFinite(n) && Number.isFinite(b) ? Math.round(10 * (b - n)) / 10 : null, top: last.ranks?.[q]?.top || [] }; }),
    lastRun: await lastRun(), latestAvg: avgOf(last),
    // The results-based fee: this month's Friday average; before the first Friday, projected from the latest check.
    ...(() => { const ma = mr.length ? Math.round(10 * mr.reduce((a, b) => a + b, 0) / mr.length) / 10 : null, la = avgOf(last);
      return { fee: ma != null ? FEE(ma) : la != null ? FEE(la) : null, feeProjected: ma == null && la != null }; })(),
  };
}

module.exports = { reportChecks, reportId, saveReport, run, daily, summary, checks, lastRun, enabled, ingest, due, saveSearches, FEE, KEY };
