// Encryption at rest for private details (SSNs, dates of birth, I-9 / W-4 answers).
// AES-256-GCM. Key: PII_KEY (any long random string) if set, otherwise derived from SESSION_SECRET.
// Don't change the key once data is saved, or the saved details can't be read.
const crypto = require("crypto");

function key() {
  const s = process.env.PII_KEY || (process.env.SESSION_SECRET ? `pii:${process.env.SESSION_SECRET}` : "");
  if (!s) throw new Error("Private details need SESSION_SECRET (or PII_KEY) set in Vercel.");
  return crypto.createHash("sha256").update(s).digest();
}
function seal(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${data.toString("base64")}`;
}
function open(s) {
  if (!s) return null;
  const [v, iv, tag, data] = String(s).split(".");
  if (v !== "v1") throw new Error("Unreadable private details.");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8"));
}
module.exports = { seal, open };
