// Shared helpers for tattoo requests.

const crypto = require("crypto");
const store = require("./store");

// Look up a request from the private id + token in the client's email link. Returns null if it doesn't match.
async function byToken(id, token) {
  const r = await store.getJSON(`req:${String(id || "").slice(0, 40)}`);
  if (!r || typeof token !== "string") return null;
  const a = Buffer.from(token), b = Buffer.from(r.token);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? r : null;
}

const save = (r) => { r.updatedAt = new Date().toISOString(); return store.setJSON(`req:${r.id}`, r); };

function statusUrl(base, r) { return `${base}/request?id=${encodeURIComponent(r.id)}&t=${encodeURIComponent(r.token)}`; }
function scheduleUrl(base, r) { return `${base}/schedule?id=${encodeURIComponent(r.id)}&t=${encodeURIComponent(r.token)}`; }

module.exports = { byToken, save, statusUrl, scheduleUrl };
