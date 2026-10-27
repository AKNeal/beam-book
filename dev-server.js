// Local server that mimics Vercel: static files from public/ with clean URLs + the same /api handlers.
// Usage: ADMIN_PASSWORD=test node dev-server.js   →   http://localhost:3000

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const UPLOADS = path.join(process.env.DATA_DIR || path.join(ROOT, ".data"), "uploads");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json" };

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end("Not found"); }
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    res.end(data);
  });
}

function inside(base, p) { const r = path.resolve(base, "." + p); return r.startsWith(base) ? r : null; }

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let p = decodeURIComponent(url.pathname);
  // Same rewrite as vercel.json: Instagram sends people back to /instagram/callback.
  if (p === "/instagram/daily") { req.url = "/api/artists?ig=cron"; p = "/api/artists"; }
  if (p === "/instagram/callback") { url.searchParams.set("ig", "callback"); req.url = "/api/artists?" + url.searchParams; p = "/api/artists"; }

  if (p.startsWith("/api/")) {
    const file = inside(path.join(ROOT, "api"), p.slice(4) + ".js");
    if (!file || !fs.existsSync(file)) { res.statusCode = 404; return res.end('{"error":"No such endpoint"}'); }
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 4.5 * 1024 * 1024) { res.statusCode = 413; return res.end('{"error":"Request too large"}'); } chunks.push(c); }
    const raw = Buffer.concat(chunks).toString();
    try { req.body = raw && (req.headers["content-type"] || "").includes("json") ? JSON.parse(raw) : {}; }
    catch { res.statusCode = 400; return res.end('{"error":"Bad JSON"}'); }
    try { await require(file)(req, res); }
    catch (e) { console.error(e); if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ error: "Something went wrong on our end. Please call the shop." })); } }
    return;
  }

  if (p.startsWith("/uploads/")) { const f = inside(UPLOADS, p.slice(8)); return f ? serveFile(res, f) : res.end(); }
  if (/^\/artists\/[^/]+$/.test(p)) p = "/artist";
  if (p === "/") p = "/index";
  const candidates = [p, p + ".html"].map((x) => inside(PUBLIC, x)).filter(Boolean);
  const hit = candidates.find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  if (!hit) { res.statusCode = 404; return serveFile(res, path.join(PUBLIC, "404.html")); }
  serveFile(res, hit);
}).listen(PORT, () => console.log(`Beam Book running at http://localhost:${PORT}`));
