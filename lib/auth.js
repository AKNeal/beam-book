// Inbox logins. Everyone has their own account (email + password, stored as a scrypt hash) and a role:
//   owner, admin  — everything, including the Team screen (add people, reset passwords)
//   desk          — every request and calendar, but not the Team screen
//   artist        — only requests assigned to them and their own calendar
// Beam Book: there is no shared shop password. A shop's first Owner gets a setup link from the Beam Book control page,
// and the control page can make a new Owner link if every password is lost.
// Sessions are a signed, HttpOnly cookie that carries the user's id and a version; changing or resetting a password
// bumps the version, which logs that person out everywhere.

const crypto = require("crypto");
const store = require("./store");

const COOKIE = "bw_admin";
const MAX_AGE = 60 * 60 * 24 * 14; // 14 days
const ROLES = { owner: "Owner", admin: "Site manager", desk: "Staff", artist: "Team member" };
const FULL = new Set(["owner", "admin"]);
const SHOP = { id: "shop", name: "Shop key", email: "", role: "owner", artist: null, ver: 0 };

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("Set SESSION_SECRET in Vercel to use the inbox.");
  return s;
}
const shopTag = () => require("./tenant").current().tenant;
const sign = (v) => crypto.createHmac("sha256", secret()).update(v).digest("base64url");
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
function safeEqual(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }

// ----- users -----
async function users() { return (await store.getJSON("users")) || []; }
async function saveUsers(list) { await store.setJSON("users", list); }
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, roleName: ROLES[u.role], artist: u.artist || null,
  active: u.active !== false, hasPassword: Boolean(u.hash), phone: u.phone || "", smsAlerts: Boolean(u.smsAlerts), mustChange: Boolean(u.mustChange), createdAt: u.createdAt, lastLogin: u.lastLogin || null });

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("base64url")}.${crypto.scryptSync(pw, salt, 32).toString("base64url")}`;
}
function verifyPassword(pw, stored) {
  if (!stored || typeof pw !== "string") { crypto.scryptSync("x", "y", 32); return false; } // same work either way
  const [salt, h] = stored.split(".");
  return safeEqual(crypto.scryptSync(pw, Buffer.from(salt, "base64url"), 32).toString("base64url"), h);
}
function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 200) return "That password is too long.";
  if (/^(.)\1+$/.test(pw) || /^(password|tattoo|beambook)/i.test(pw)) return "Pick something harder to guess.";
  return null;
}
// Beam Book has no shared shop password: every shop's Owner gets their own login from the control page.
function checkShopKey() { return false; }

// ----- sessions -----
function isSecure(req) { return (req.headers["x-forwarded-proto"] || "").includes("https") || process.env.VERCEL === "1"; }
function setSession(req, res, u) {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  const payload = `${u.id}.${u.ver || 0}.${exp}`;
  res.setHeader("Set-Cookie", `${COOKIE}=${payload}.${sign(`${shopTag()}|${payload}`)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}${isSecure(req) ? "; Secure" : ""}`);
}
function clearSession(req, res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isSecure(req) ? "; Secure" : ""}`);
}
// The logged-in person, or null. Someone who must pick a new password first only gets through where allowMustChange is set
// (the login endpoint), so they can't use the inbox until they've changed the password they were given.
async function currentUser(req, { allowMustChange = false } = {}) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const parts = m[1].split(".");
  if (parts.length !== 4) return null;
  const [uid, ver, exp, sig] = parts;
  // The signature includes the shop, so a login cookie from one shop is useless at another.
  try { if (!safeEqual(sig, sign(`${shopTag()}|${uid}.${ver}.${exp}`))) return null; } catch { return null; }
  if (Number(exp) <= Date.now() / 1000) return null;
  if (uid === "shop") return null;
  const u = (await users()).find((x) => x.id === uid);
  if (!u || u.active === false || String(u.ver || 0) !== ver) return null;
  if (u.mustChange && !allowMustChange) return null;
  return u;
}

// ----- what each role can do -----
const isFull = (u) => FULL.has(u.role);
const seesAll = (u) => u.role !== "artist";
const canSeeArtist = (u, slug) => seesAll(u) || (u.artist && u.artist === slug);
// "First available artist" requests are open to every artist until one of them takes it.
const isOpenToAll = (r) => (!r.artist || r.artist === "any") && r.status === "new";
const canSeeRequest = (u, r) => seesAll(u) || Boolean(u.artist && (r.artist === u.artist || isOpenToAll(r)));
// Login emails of active artists (all of them, or the one for an artist slug) — for new-request alerts.
async function artistEmails(slug = null) {
  return (await users()).filter((u) => u.role === "artist" && u.active !== false && u.email && (!slug || u.artist === slug)).map((u) => u.email);
}

// ----- one-time links (invite / reset) -----
async function makeResetLink(site, u, hours) {
  const token = crypto.randomBytes(24).toString("base64url");
  await store.setJSON(`pwreset:${sha(token).toString("hex")}`, { uid: u.id, exp: Date.now() + hours * 3600e3 });
  return `${site}/admin?reset=${token}`;
}
async function takeReset(token, peek = false) {
  if (typeof token !== "string" || token.length < 20 || token.length > 80) return null;
  const key = `pwreset:${sha(token).toString("hex")}`;
  const t = await store.getJSON(key);
  if (!t || t.exp < Date.now()) return null;
  if (!peek) await store.setJSON(key, { ...t, exp: 0 }); // one use
  return t;
}

module.exports = {
  ROLES, users, saveUsers, publicUser, hashPassword, verifyPassword, passwordProblem, checkShopKey,
  setSession, clearSession, currentUser, isFull, seesAll, canSeeArtist, canSeeRequest, isOpenToAll, artistEmails, makeResetLink, takeReset,
};
