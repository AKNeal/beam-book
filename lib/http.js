// Shared HTTP helpers for the API routes.

const crypto = require("crypto");

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function method(req, res, allowed) {
  if (req.method !== allowed) { res.setHeader("Allow", allowed); send(res, 405, { error: "Method not allowed" }); return false; }
  return true;
}

function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

function ip(req) {
  const f = req.headers["x-forwarded-for"];
  return (f ? String(f).split(",")[0] : req.socket?.remoteAddress || "unknown").trim();
}

// Public address for links in emails and feeds: the production domain when live, otherwise the address being used (previews).
function baseUrl(req) {
  const { studio } = require("../config/studio");
  if ((process.env.VERCEL_ENV === "production" || !req) && studio.siteUrl) return studio.siteUrl.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0];
  return host ? `${proto}://${host}` : studio.siteUrl.replace(/\/$/, "");
}

function id(bytes = 6) { return crypto.randomBytes(bytes).toString("base64url"); }

function str(v, max = 500) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }

module.exports = { send, method, body, ip, id, str, baseUrl };
