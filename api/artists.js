// GET /api/artists — roster + whether each artist's books are open. Also returns form options.
// GET /api/artists?photo=<slug> — an artist's portrait for the public Artists page.
// GET /api/artists?ig=feed — the shop's latest Instagram posts (no keys or picture addresses).
// GET /api/artists?ig=img&id=<post id> — one Instagram picture, passed through this site.
// GET /instagram/callback (rewritten to ?ig=callback) — where Instagram sends someone back after Connect.
// GET /api/artists?ig=cron — daily: keep Instagram's key renewed and the posts fresh (Vercel cron).
// (Instagram lives here so the site stays inside Vercel's 12-function limit.)

const config = require("../config/studio");
const artists = require("../lib/artists");
const files = require("../lib/files");
const { send, method } = require("../lib/http");

module.exports = async function handler(req, res) {
  if (!method(req, res, "GET")) return;
  const q = new URL(req.url, "http://x").searchParams;
  if (q.get("ig")) return instagram(req, res, q);
  const roster = await artists.list({ publicOnly: true });

  if (q.get("photo")) {
    const a = (await artists.list()).find((x) => x.slug === q.get("photo") && x.listed);
    if (!a || !a.photo || !a.photo.startsWith(`${config.tenant}/artists/`)) return send(res, 404, { error: "No photo." });
    if (!files.useBlob()) return files.sendLocal(res, a.photo, send);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return files.stream(res, a.photo, send);
  }

  if (q.get("logo")) { // the shop's logo (uploaded on the Beam Book control page)
    const p = config.theme?.logo;
    if (!p || !p.startsWith(`${config.tenant}/brand/`)) return send(res, 404, { error: "No logo." });
    if (!files.useBlob()) return files.sendLocal(res, p, send);
    res.setHeader("Cache-Control", "public, max-age=3600");
    return files.stream(res, p, send);
  }

  const st = config.studio, th = config.theme || {};
  return send(res, 200, {
    studio: { name: st.name, tagline: st.tagline, city: st.city, minAge: st.minAge },
    // Beam Book: what the booking pages need to look and read like this shop.
    shop: { name: st.name, tagline: st.tagline, city: st.city, phone: st.phone, address: st.address, instagram: st.instagram,
      website: st.website, timeZone: st.timeZone,
      theme: { mode: th.mode === "light" ? "light" : "dark", accent: /^#[0-9a-f]{6}$/i.test(th.accent || "") ? th.accent : "#d08a3c",
        deco: Boolean(th.deco),
        logo: th.logo ? `/api/artists?logo=1&v=${encodeURIComponent(String(th.logoV || 1))}` : "" } },
    depositPolicy: config.depositPolicy,
    artists: roster.map((a) => ({ ...a, photo: artists.photoUrl(a) })),
    options: { placements: config.placements, sizes: config.sizes, budgets: config.budgets, colorOptions: config.colorOptions },
    // Beam Book: this business's words, request questions and negotiation rules.
    kind: config.kind, words: config.words, form: config.form || [], negotiate: config.negotiate,
    ageCheck: Boolean(config.ageCheck), policyCheck: Boolean(config.policyCheck), sessionLengths: config.sessionLengths,
  });
};

// ----- Instagram -----
const ig = require("../lib/instagram");
const { baseUrl } = require("../lib/http");

async function instagram(req, res, q) {
  const what = q.get("ig");
  if (what === "feed") {
    let feed = { username: "", items: [] };
    try { feed = await ig.publicFeed(Math.min(24, Number(q.get("n")) || 12)); } catch (e) { console.error("[instagram]", e.message); }
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
    res.statusCode = 200; res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify(feed));
  }
  if (what === "img") {
    const id = String(q.get("id") || "");
    if (!/^\d{1,30}$/.test(id)) return send(res, 404, { error: "No picture." });
    const pic = await ig.picture(id);
    if (!pic) return send(res, 404, { error: "No picture." });
    res.statusCode = 200; res.setHeader("Content-Type", pic.type);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800");
    return res.end(pic.buf);
  }
  return send(res, 404, { error: "Not found." });
}

// Beam Book: run this endpoint for the shop at this web address, except Instagram's callback and the daily job,
// which come in on the main Beam Book address and work out the shop themselves.
const forShop = require("../lib/tenant").handler(module.exports);
module.exports = async function (req, res) {
  const what = new URL(req.url, "http://x").searchParams.get("ig");
  if (what === "callback") return igCallback(req, res);
  if (what === "cron") return igDaily(req, res);
  return forShop(req, res);
};

const platformUrl = (req) => (process.env.BEAMBOOK_URL || baseUrl(req)).replace(/\/$/, "");
const igRedirect = (req) => `${platformUrl(req)}/instagram/callback`;

async function igCallback(req, res) {
  const tenant = require("../lib/tenant");
  const q = new URL(req.url, "http://x").searchParams;
  let msg = "", back = "";
  try {
    const st = await ig.takeState(q.get("state"));
    if (!st) throw new Error("That Connect link expired. Click Connect Instagram again.");
    await tenant.runAs(st.tenant, async () => {
      back = require("../config/studio").studio.siteUrl;
      if (q.get("error")) throw new Error(q.get("error_reason") === "user_denied" ? "Instagram wasn't connected (the login was cancelled)." : (q.get("error_description") || "Instagram said no."));
      const auth = require("../lib/auth");
      const u = (await auth.users()).find((x) => x.id === st.uid);
      if (!u || u.active === false || !auth.isFull(u)) throw new Error("Only the Owner or a Site admin can connect Instagram.");
      await ig.finishConnect(q.get("code"), igRedirect(req), st.name);
    });
  } catch (e) { msg = e.message || "Instagram couldn't be connected."; }
  // Hop back to the shop's inbox from this page (not a redirect) so the shop's login cookie comes along.
  const to = `${back || ""}/admin?` + new URLSearchParams(msg ? { ig: "error", msg } : { ig: "connected" });
  res.statusCode = 200; res.setHeader("Content-Type", "text/html; charset=utf-8"); res.setHeader("Cache-Control", "no-store");
  return res.end(`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Instagram</title>
<p style="font:16px system-ui;padding:24px">${msg ? "Instagram wasn't connected." : "Instagram connected."} <a id="go" href="${to.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">Back to the inbox</a></p>
<script>location.replace(document.getElementById("go").getAttribute("href"));</script>`);
}

// Daily (Vercel cron): renew every shop's Instagram key and refresh posts.
async function igDaily(req, res) {
  const tenant = require("../lib/tenant");
  const out = {};
  for (const shop of await tenant.listShops()) {
    if (shop.active === false) continue;
    try { out[shop.slug] = await tenant.runAs(shop.slug, () => ig.daily()); } catch (e) { out[shop.slug] = { error: e.message }; }
  }
  return send(res, 200, out);
}
