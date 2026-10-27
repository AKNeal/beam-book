// The shop's Instagram feed on the website (Instagram API with Instagram Login, read-only).
//
// Setup (once): a Meta developer app with the Instagram product. Its Instagram app ID and secret go in Vercel as
// IG_APP_ID and IG_APP_SECRET, and https://<site>/instagram/callback is added as a redirect URL.
// Then an Owner or Site admin clicks "Connect Instagram" in the inbox (Account) and logs in to Instagram there.
// The shop's account must be a Professional account (Business or Creator).
//
// Instagram's key lasts 60 days; it is renewed automatically (weekly, plus a daily Vercel cron) so it never lapses.
// Posts are re-read at most once an hour. Pictures are passed through this site so they keep loading after
// Instagram's own picture links expire.

const crypto = require("crypto");
const store = require("./store");

const HOUR = 3600e3, DAY = 24 * HOUR;
const FEED_TTL = HOUR;
const RENEW_EVERY = 7 * DAY;
const KEEP = 24;

// Automated tests point these at a fake Instagram on this machine; never on the live site.
const testBase = process.env.IG_TEST_BASE && !process.env.VERCEL ? process.env.IG_TEST_BASE.replace(/\/$/, "") : "";
const API = testBase || "https://api.instagram.com";
const GRAPH = testBase || "https://graph.instagram.com";
const AUTHORIZE = testBase ? `${testBase}/oauth/authorize` : "https://www.instagram.com/oauth/authorize";

const ready = () => Boolean(process.env.IG_APP_ID && process.env.IG_APP_SECRET);

async function getJSON(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    const text = await r.text();
    let j = {}; try { j = JSON.parse(text); } catch {}
    if (!r.ok || j.error || j.error_message) {
      const msg = j.error?.message || j.error_message || `Instagram answered ${r.status}`;
      const err = new Error(msg); err.status = r.status; err.code = j.error?.code; throw err;
    }
    return j;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Instagram took too long to answer.");
    throw e;
  } finally { clearTimeout(t); }
}

// ----- connecting -----
// A one-time "state" ties the Instagram login back to the person who clicked Connect (login cookies don't come back
// from instagram.com, so this is how we know who it was).
async function startConnect(user, redirectUri) {
  if (!ready()) throw new Error("Instagram isn't set up on the site yet (IG_APP_ID and IG_APP_SECRET in Vercel).");
  const state = crypto.randomBytes(18).toString("base64url");
  // Beam Book: one Instagram callback address for every shop, so the state remembers which shop asked.
  await store.global.setJSON(`ig:state:${state}`, { tenant: require("./tenant").current().tenant, uid: user.id, name: user.name, exp: Date.now() + 15 * 60e3 });
  const q = new URLSearchParams({ client_id: process.env.IG_APP_ID, redirect_uri: redirectUri, response_type: "code",
    scope: "instagram_business_basic", state });
  return `${AUTHORIZE}?${q}`;
}

async function takeState(state) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(String(state || ""))) return null;
  const key = `ig:state:${state}`;
  const s = await store.global.getJSON(key);
  await store.global.del(key);
  return s && s.exp > Date.now() ? s : null;
}

async function finishConnect(code, redirectUri, by) {
  const form = new URLSearchParams({ client_id: process.env.IG_APP_ID, client_secret: process.env.IG_APP_SECRET,
    grant_type: "authorization_code", redirect_uri: redirectUri, code: String(code).replace(/#_$/, "") });
  const short = await getJSON(`${API}/oauth/access_token`, { method: "POST", body: form,
    headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  const s = Array.isArray(short.data) ? short.data[0] : short; // Instagram has used both shapes
  if (!s?.access_token) throw new Error("Instagram didn't send a key back. Try Connect again.");
  const long = await getJSON(`${GRAPH}/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token",
    client_secret: process.env.IG_APP_SECRET, access_token: s.access_token })}`);
  const me = await getJSON(`${GRAPH}/me?${new URLSearchParams({ fields: "user_id,username", access_token: long.access_token })}`);
  const now = Date.now();
  await store.setJSON("ig:auth", { token: long.access_token, expiresAt: now + (Number(long.expires_in) || 60 * 86400) * 1000,
    refreshedAt: now, connectedAt: now, connectedBy: by || "", username: me.username || "", userId: String(me.user_id || s.user_id || "") });
  await store.setJSON("ig:feed", null);
  return syncFeed({ force: true });
}

async function disconnect() {
  await store.setJSON("ig:auth", null);
  await store.setJSON("ig:feed", null);
}

// ----- keeping the key alive -----
async function renewIfDue(auth) {
  const now = Date.now();
  if (!auth?.token || now - (auth.refreshedAt || 0) < RENEW_EVERY || now - (auth.connectedAt || 0) < DAY) return auth;
  try {
    const r = await getJSON(`${GRAPH}/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: auth.token })}`);
    const next = { ...auth, token: r.access_token || auth.token, refreshedAt: now,
      expiresAt: now + (Number(r.expires_in) || 60 * 86400) * 1000, renewError: "" };
    await store.setJSON("ig:auth", next);
    return next;
  } catch (e) {
    const next = { ...auth, renewError: e.message };
    await store.setJSON("ig:auth", next);
    return next;
  }
}

// ----- the feed -----
const clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

async function syncFeed({ force = false } = {}) {
  let auth = await store.getJSON("ig:auth");
  if (!auth?.token) return { items: [], fetchedAt: null, error: "" };
  const prev = (await store.getJSON("ig:feed")) || {};
  if (!force && prev.fetchedAt && Date.now() - prev.fetchedAt < FEED_TTL) return prev;
  if (!force && !(await store.lock("ig:sync", 20000))) return prev; // someone else is already updating it
  try {
    auth = await renewIfDue(auth);
    const q = new URLSearchParams({ fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp", limit: String(KEEP), access_token: auth.token });
    const r = await getJSON(`${GRAPH}/me/media?${q}`);
    const items = (r.data || []).map((m) => ({
      id: String(m.id), type: m.media_type, caption: clean(m.caption, 300), permalink: m.permalink, at: m.timestamp,
      src: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url,
    })).filter((m) => /^\d+$/.test(m.id) && (/^https:\/\//.test(m.src || "") || (testBase && String(m.src).startsWith(testBase))) && /^https:\/\/(www\.)?instagram\.com\//.test(m.permalink || ""));
    const rec = { fetchedAt: Date.now(), items, error: "" };
    await store.setJSON("ig:feed", rec);
    return rec;
  } catch (e) {
    const rec = { ...prev, fetchedAt: Date.now(), error: e.message }; // keep showing the last good posts
    await store.setJSON("ig:feed", rec);
    return rec;
  } finally {
    if (!force) await store.unlock("ig:sync");
  }
}

// What the public site gets: no picture addresses or keys, just ids it can ask this site for.
async function publicFeed(limit = 12) {
  const f = await syncFeed();
  const auth = await store.getJSON("ig:auth");
  return { username: auth?.username || "", items: (f.items || []).slice(0, limit).map(({ src, ...m }) => m) };
}

// Pass one picture through (only ones that are in the current feed, so this can't fetch anything else).
async function picture(id) {
  const f = (await store.getJSON("ig:feed")) || {};
  const m = (f.items || []).find((x) => x.id === String(id));
  if (!m) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(m.src, { signal: ctl.signal });
    if (!r.ok) return null;
    const type = r.headers.get("content-type") || "image/jpeg";
    if (!/^image\//.test(type)) return null;
    return { type, buf: Buffer.from(await r.arrayBuffer()) };
  } catch { return null; } finally { clearTimeout(t); }
}

// For the inbox.
async function status() {
  const auth = await store.getJSON("ig:auth");
  const f = (await store.getJSON("ig:feed")) || {};
  return { ready: ready(), connected: Boolean(auth?.token), username: auth?.username || "", connectedAt: auth?.connectedAt || null,
    connectedBy: auth?.connectedBy || "", expiresAt: auth?.expiresAt || null, renewError: auth?.renewError || "",
    fetchedAt: f.fetchedAt || null, count: (f.items || []).length, error: f.error || "" };
}

// Daily cron: renew the key if due and refresh the posts.
async function daily() {
  const auth = await store.getJSON("ig:auth");
  if (!auth?.token) return { connected: false };
  await renewIfDue(auth);
  const f = await syncFeed({ force: true });
  return { connected: true, count: (f.items || []).length, error: f.error || "" };
}

module.exports = { ready, startConnect, takeState, finishConnect, disconnect, syncFeed, publicFeed, picture, status, daily };
