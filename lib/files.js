// Reference-photo storage.
// Production: a PRIVATE Vercel Blob store (env BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID). Clients' photos are never
// public; the shop inbox shows them through /api/admin/photo, which checks the admin login first.
// Local dev: .data/uploads, served at /uploads/.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("../config/studio");
const tenantOf = () => config.tenant;

const MAX_BYTES = 1.5 * 1024 * 1024; // per image, after the browser shrinks it
const MAX_FILES = 4;

function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", type: "image/png" };
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return { ext: "webp", type: "image/webp" };
  return null;
}

// images: array of data URLs ("data:image/jpeg;base64,....")
function decode(images) {
  if (!Array.isArray(images)) return { files: [] };
  if (images.length > MAX_FILES) return { error: `Up to ${MAX_FILES} photos, please.` };
  const files = [];
  for (const d of images) {
    if (typeof d !== "string") return { error: "Bad photo upload." };
    const m = d.match(/^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return { error: "Photos must be JPG, PNG or WebP." };
    const buf = Buffer.from(m[1], "base64");
    if (buf.length > MAX_BYTES) return { error: "One of the photos is too large." };
    const kind = sniff(buf);
    if (!kind) return { error: "Photos must be JPG, PNG or WebP." };
    files.push({ buf, ...kind });
  }
  return { files };
}

function useBlob() { return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID); }

async function save(files, requestId) {
  const urls = [];
  for (const [i, f] of files.entries()) {
    const name = `${tenantOf()}/requests/${requestId}/${i + 1}-${crypto.randomBytes(8).toString("hex")}.${f.ext}`;
    if (useBlob()) {
      const { put } = require("@vercel/blob");
      await put(name, f.buf, { access: "private", contentType: f.type, addRandomSuffix: false });
      urls.push(`/api/admin/photo?p=${encodeURIComponent(name)}`);
    } else {
      const dir = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "uploads");
      const file = path.join(dir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, f.buf);
      urls.push(`/uploads/${name}`);
    }
  }
  return urls;
}

// Finished-tattoo photos (added by the client or the shop once a request is done). Returns stored names, not URLs,
// because the client and the shop reach the same private file through different, separately-checked addresses.
const MAX_DONE = 12;
async function saveDone(files, requestId) {
  const names = [];
  for (const f of files) {
    const name = `${tenantOf()}/requests/${requestId}/done-${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${f.ext}`;
    if (useBlob()) {
      const { put } = require("@vercel/blob");
      await put(name, f.buf, { access: "private", contentType: f.type, addRandomSuffix: false });
    } else {
      const file = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "uploads", name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, f.buf);
    }
    names.push(name);
  }
  return names;
}
const donePattern = (requestId) => new RegExp(`^${tenantOf()}/requests/${requestId.replace(/[^\w-]/g, "")}/done-\\d+-[a-f0-9]{16}\\.(jpg|png|webp)$`);
const adminUrl = (name) => (useBlob() ? `/api/admin/photo?p=${encodeURIComponent(name)}` : `/uploads/${name}`);
const clientUrl = (name, r, token) => (useBlob()
  ? `/api/status?id=${encodeURIComponent(r.id)}&t=${encodeURIComponent(token)}&photo=${encodeURIComponent(name)}` : `/uploads/${name}`);

// Send one private photo from the Blob store.
async function stream(res, name, send) {
  const { Readable } = require("stream");
  try {
    const { get } = require("@vercel/blob");
    const r = await get(name, { access: "private" });
    if (!r || r.statusCode !== 200) return send(res, 404, { error: "Photo not found." });
    res.statusCode = 200;
    res.setHeader("Content-Type", r.blob.contentType || "image/jpeg");
    if (!res.getHeader("Cache-Control")) res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    Readable.fromWeb(r.stream).pipe(res);
  } catch (e) {
    console.error("[photo]", e.message);
    if (!res.headersSent) send(res, 500, { error: "Couldn't load that photo." });
  }
}

// Delete stored photos (reference and finished) for good. Accepts stored names or the URLs the app hands out.
async function removeAll(namesOrUrls) {
  const names = namesOrUrls.map((u) => {
    if (u.startsWith("/api/admin/photo?p=")) return decodeURIComponent(u.slice("/api/admin/photo?p=".length));
    if (u.startsWith("/uploads/")) return u.slice("/uploads/".length);
    return u;
  }).filter((n) => n.startsWith(`${tenantOf()}/requests/`));
  if (!names.length) return;
  try {
    if (useBlob()) { const { del } = require("@vercel/blob"); await del(names); }
    else for (const n of names) fs.rmSync(path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "uploads", n), { force: true });
  } catch (e) { console.error("[photos] delete", e.message); } // a leftover private file shouldn't block deleting the request
}

// Artist portraits (shown publicly on the Artists page, served through /api/artists?photo=).
async function saveArtistPhoto(slug, f) {
  const name = `${tenantOf()}/artists/${slug}-${crypto.randomBytes(8).toString("hex")}.${f.ext}`;
  if (useBlob()) { const { put } = require("@vercel/blob"); await put(name, f.buf, { access: "private", contentType: f.type, addRandomSuffix: false }); }
  else { const file = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "uploads", name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, f.buf); }
  return name;
}
async function sendLocal(res, name, send) {
  const file = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "uploads", name);
  if (!fs.existsSync(file)) return send(res, 404, { error: "Photo not found." });
  res.statusCode = 200; res.setHeader("Content-Type", name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg");
  res.end(fs.readFileSync(file));
}

// Beam Book: the shop's logo (uploaded on the control page, served through /api/artists?logo=1).
async function saveLogo(f) {
  const name = `${tenantOf()}/brand/logo-${crypto.randomBytes(8).toString("hex")}.${f.ext}`;
  if (useBlob()) { const { put } = require("@vercel/blob"); await put(name, f.buf, { access: "private", contentType: f.type, addRandomSuffix: false }); }
  else { const file = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "uploads", name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, f.buf); }
  return name;
}

module.exports = { saveLogo, saveArtistPhoto, sendLocal, decode, save, useBlob, MAX_FILES, MAX_DONE, removeAll, saveDone, donePattern, adminUrl, clientUrl, stream };
