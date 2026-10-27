// POST /api/waitlist — join an artist's waitlist while their books are closed.

const store = require("../lib/store");
const artists = require("../lib/artists");
const { send, method, body, ip, str } = require("../lib/http");

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  const b = body(req);
  if (str(b.website)) return send(res, 200, { ok: true });
  if ((await store.hit(`rl:wl:${ip(req)}`, 3600)) > 10) return send(res, 429, { error: "Too many tries. Please try later." });

  const slug = str(b.artist, 60);
  const name = str(b.name, 80);
  const email = str(b.email, 120).toLowerCase();
  if (!(await artists.list({ publicOnly: true })).some((a) => a.slug === slug)) return send(res, 400, { error: "Pick an artist." });
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return send(res, 400, { error: "Enter your name and a valid email." });

  const key = `waitlist:${slug}`;
  const list = (await store.getJSON(key)) || [];
  if (!list.some((x) => x.email === email)) {
    list.push({ name, email, at: new Date().toISOString() });
    await store.setJSON(key, list);
  }
  return send(res, 200, { ok: true });
};

// Beam Book: run this endpoint for the shop at this web address.
module.exports = require("../lib/tenant").handler(module.exports);
