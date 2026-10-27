// /api/admin/login — inbox logins, password resets and the Team screen (kept in one function for Vercel's limit).
//   GET                         who am I? {user, needsSetup, emailReady}
//   GET ?reset=<token>          is this set-password link still good? {valid, name, email}
//   DELETE                      log out
//   POST {action:"login", email, password}         (blank email + shop key = owner, for setup and recovery)
//   POST {action:"forgot", email}                  emails a reset link (1 hour) when email is connected
//   POST {action:"reset", token, password}         sets a new password from a link, logs in
//   POST {action:"password", current, password}    change my own password
//   POST {action:"alerts", phone, smsAlerts}        my text alerts (new requests, requested times, bookings)
//   Owner / site admin only:
//   POST {action:"team"}                                         everyone + artists
//   POST {action:"add", name, email, role, artist | newArtist, password?, mustChange?}
//        with a password: the login works right away (mustChange = they pick their own at first login)
//        without one: returns a set-password link (72 hours)
//   POST {action:"setPassword", id, password, mustChange?}       type a new password for someone (logs them out)
//   POST {action:"update", id, name?, role?, artist?, active?}
//   POST {action:"remove", id}
//   POST {action:"resetLink", id}                                new set-password link (72 hours)

const auth = require("../../lib/auth");
const store = require("../../lib/store");
const artists = require("../../lib/artists");
const config = require("../../config/studio");
const { sendEmail, emailReady } = require("../../lib/email");
const { send, body, ip, id, str, baseUrl } = require("../../lib/http");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INVITE_HOURS = 72, FORGOT_HOURS = 1;

module.exports = async function handler(req, res) {
  if (req.method === "GET") return get(req, res);
  if (req.method === "DELETE") { auth.clearSession(req, res); return send(res, 200, { ok: true }); }
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST, DELETE"); return send(res, 405, { error: "Method not allowed" }); }
  const b = body(req);
  try {
    switch (b.action || "login") {
      case "login": return await login(req, res, b);
      case "forgot": return await forgot(req, res, b);
      case "reset": return await reset(req, res, b);
      case "password": return await changeOwn(req, res, b);
      case "alerts": return await alerts(req, res, b);
      case "team": case "add": case "update": case "remove": case "resetLink": case "setPassword": return await team(req, res, b);
      default: return send(res, 400, { error: "Unknown action." });
    }
  } catch (e) {
    console.error("[login]", e);
    return send(res, 400, { error: e.message || "Something went wrong." });
  }
};

async function get(req, res) {
  const token = new URL(req.url, "http://x").searchParams.get("reset");
  if (token) {
    const t = await auth.takeReset(token, true);
    const u = t && (await auth.users()).find((x) => x.id === t.uid && x.active !== false);
    return send(res, 200, u ? { valid: true, name: u.name, email: u.email } : { valid: false });
  }
  const me = await auth.currentUser(req, { allowMustChange: true });
  return send(res, 200, {
    admin: Boolean(me), user: me ? { ...auth.publicUser(me), shopKey: me.id === "shop" } : null,
    needsSetup: false, emailReady: emailReady(), smsReady: require("../../lib/sms").smsReady(),
  });
}

async function login(req, res, b) {
  if ((await store.hit(`rl:login:${ip(req)}`, 900)) > 10) return send(res, 429, { error: "Too many attempts. Wait 15 minutes." });
  const email = str(b.email, 120).toLowerCase();
  const pw = typeof b.password === "string" ? b.password : "";
  if (!email) return send(res, 400, { error: "Enter your email and password." });
  const list = await auth.users();
  const u = list.find((x) => x.email === email);
  const good = auth.verifyPassword(pw, u?.hash);
  if (!u || !good || u.active === false) return send(res, 401, { error: u && good ? "This login has been turned off. Ask the shop owner." : "Wrong email or password." });
  u.lastLogin = new Date().toISOString();
  await auth.saveUsers(list);
  auth.setSession(req, res, u);
  return send(res, 200, { ok: true });
}

async function forgot(req, res, b) {
  if ((await store.hit(`rl:forgot:${ip(req)}`, 3600)) > 5) return send(res, 429, { error: "Too many tries. Wait an hour, or ask the shop owner for a reset link." });
  const email = str(b.email, 120).toLowerCase();
  if (!EMAIL_RE.test(email)) return send(res, 400, { error: "Enter the email you log in with." });
  if (!emailReady()) return send(res, 200, { ok: true, emailed: false,
    message: "Email isn't connected yet, so reset links can't be sent. Ask the shop owner to make you one from the Team screen." });
  const u = (await auth.users()).find((x) => x.email === email && x.active !== false);
  if (u) {
    const link = await auth.makeResetLink(baseUrl(req), u, FORGOT_HOURS);
    await sendEmail({ to: u.email, subject: `Reset your ${config.studio.name} inbox password`, title: "Reset your password",
      paragraphs: [`Hi ${u.name.split(" ")[0]},`, "Use the button below to choose a new password. The link works once and expires in an hour.",
        "If you didn't ask for this, you can ignore this email; your password hasn't changed."], button: { label: "Choose a new password", url: link } });
  }
  // Same answer whether or not the email has a login, so this can't be used to find out who works here.
  return send(res, 200, { ok: true, emailed: true, message: "If that email has a login, a reset link is on its way. It expires in an hour." });
}

async function reset(req, res, b) {
  if ((await store.hit(`rl:reset:${ip(req)}`, 900)) > 20) return send(res, 429, { error: "Too many attempts. Wait 15 minutes." });
  const problem = auth.passwordProblem(b.password);
  if (problem) return send(res, 400, { error: problem });
  const t = await auth.takeReset(str(b.token, 100));
  if (!t) return send(res, 400, { error: "This link has expired or was already used. Ask for a new one." });
  const list = await auth.users();
  const u = list.find((x) => x.id === t.uid && x.active !== false);
  if (!u) return send(res, 400, { error: "This login no longer exists." });
  u.hash = auth.hashPassword(b.password); u.ver = (u.ver || 0) + 1; u.mustChange = false; u.lastLogin = new Date().toISOString();
  await auth.saveUsers(list);
  auth.setSession(req, res, u);
  return send(res, 200, { ok: true });
}

async function alerts(req, res, b) {
  const me = await auth.currentUser(req);
  if (!me) return send(res, 401, { error: "Log in first." });
  if (me.id === "shop") return send(res, 400, { error: "Log in with your own account to set up text alerts." });
  const sms = require("../../lib/sms");
  const phone = str(b.phone, 30), on = b.smsAlerts === true;
  if (on && !sms.toE164(phone)) return send(res, 400, { error: "Enter a US mobile number to get text alerts." });
  const list = await auth.users();
  const u = list.find((x) => x.id === me.id);
  u.phone = phone; u.smsAlerts = on;
  await auth.saveUsers(list);
  if (on && b.test === true) await sms.sendSms(phone, "Text alerts are on. You'll get new requests, requested times and bookings here.");
  return send(res, 200, { ok: true, user: auth.publicUser(u) });
}

async function changeOwn(req, res, b) {
  const me = await auth.currentUser(req, { allowMustChange: true });
  if (!me) return send(res, 401, { error: "Log in first." });
  if (me.id === "shop") return send(res, 400, { error: "The shop key is changed in Vercel (ADMIN_PASSWORD), not here." });
  const list = await auth.users();
  const u = list.find((x) => x.id === me.id);
  // Right after logging in with a starting password they just typed it, so it isn't asked for again.
  if (!u.mustChange && !auth.verifyPassword(b.current, u.hash)) return send(res, 400, { error: "Your current password isn't right." });
  const problem = auth.passwordProblem(b.password);
  if (problem) return send(res, 400, { error: problem });
  if (u.mustChange && auth.verifyPassword(b.password, u.hash)) return send(res, 400, { error: "Pick a different password from the one you were given." });
  u.hash = auth.hashPassword(b.password); u.ver = (u.ver || 0) + 1; u.mustChange = false;
  await auth.saveUsers(list);
  auth.setSession(req, res, u); // stay logged in here; other devices are logged out
  return send(res, 200, { ok: true });
}

async function team(req, res, b) {
  const me = await auth.currentUser(req);
  if (!me) return send(res, 401, { error: "Log in first." });
  if (!auth.isFull(me)) return send(res, 403, { error: "Only the Owner or a Site admin can manage logins." });
  const site = baseUrl(req);
  const list = await auth.users();
  const find = () => { const u = list.find((x) => x.id === str(b.id, 40)); if (!u) throw new Error("That person isn't on the team."); return u; };
  const fullLeft = (without) => list.some((x) => x.id !== without && auth.isFull(x) && x.active !== false);
  const checkRole = async (role, artistSlug) => {
    if (!auth.ROLES[role]) throw new Error("Pick a role.");
    if (role === "artist" && !(await artists.bySlug(artistSlug))) throw new Error("Pick which artist this login is for.");
  };
  async function inviteOut(u, hours, verb) {
    const link = await auth.makeResetLink(site, u, hours);
    let emailed = false;
    if (emailReady()) {
      const r = await sendEmail({ to: u.email, subject: `Your ${config.studio.name} inbox login`, title: verb === "reset" ? "Reset your password" : "You've been added to the shop inbox",
        paragraphs: [`Hi ${u.name.split(" ")[0]},`, verb === "reset" ? "Here's a link to choose a new password for the shop inbox." : `${me.name} gave you a login for the ${config.studio.name} inbox.`,
          `Your login email is ${u.email}. The link works once and expires in ${hours} hours.`], button: { label: "Choose a password", url: link } });
      emailed = Boolean(r.ok);
    }
    return { link, emailed, hours };
  }

  switch (b.action) {
    case "team": break;

    case "add": {
      const name = str(b.name, 60), email = str(b.email, 120).toLowerCase(), role = str(b.role, 10);
      if (name.length < 2) throw new Error("Enter their name.");
      if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email. It's what they'll log in with.");
      if (list.some((x) => x.email === email)) throw new Error("Someone already logs in with that email.");
      let artist = null;
      if (role === "artist") artist = str(b.newArtist, 60) ? await artists.add(b.newArtist) : str(b.artist, 60);
      await checkRole(role, artist);
      if (artist && list.some((x) => x.role === "artist" && x.artist === artist && x.active !== false)) throw new Error("That artist already has a login.");
      const pw = typeof b.password === "string" && b.password ? b.password : "";
      if (pw) { const problem = auth.passwordProblem(pw); if (problem) throw new Error(`Password: ${problem}`); }
      const u = { id: id(8), name, email, role, artist, hash: pw ? auth.hashPassword(pw) : "", mustChange: Boolean(pw) && b.mustChange !== false,
        ver: 0, active: true, createdAt: new Date().toISOString(), createdBy: me.name };
      list.push(u); await auth.saveUsers(list);
      return send(res, 200, { ok: true, created: { id: u.id, withPassword: Boolean(pw) }, invite: pw ? null : await inviteOut(u, INVITE_HOURS, "add"), ...(await teamOut(list)) });
    }

    case "update": {
      const u = find();
      if (b.name !== undefined) { const n = str(b.name, 60); if (n.length < 2) throw new Error("Enter their name."); u.name = n; }
      const role = b.role !== undefined ? str(b.role, 10) : u.role;
      const artist = role === "artist" ? (b.artist !== undefined ? str(b.artist, 60) : u.artist) : null;
      if (u.id === me.id && (role !== u.role || b.active === false)) throw new Error("You can't change your own role or turn off your own login.");
      await checkRole(role, artist);
      if (auth.isFull(u) && (!auth.ROLES[role] || !["owner", "admin"].includes(role) || b.active === false) && !fullLeft(u.id))
        throw new Error("Keep at least one Owner or Site admin login.");
      const changedAccess = role !== u.role || artist !== u.artist || (b.active !== undefined && Boolean(b.active) !== (u.active !== false));
      u.role = role; u.artist = artist;
      if (b.active !== undefined) u.active = Boolean(b.active);
      if (changedAccess) u.ver = (u.ver || 0) + 1; // log them out so the new access applies right away
      await auth.saveUsers(list);
      return send(res, 200, { ok: true, ...(await teamOut(list)) });
    }

    case "remove": {
      const u = find();
      if (u.id === me.id) throw new Error("You can't remove your own login.");
      if (auth.isFull(u) && !fullLeft(u.id)) throw new Error("Keep at least one Owner or Site admin login.");
      const next = list.filter((x) => x.id !== u.id);
      await auth.saveUsers(next);
      return send(res, 200, { ok: true, ...(await teamOut(next)) });
    }

    case "setPassword": {
      const u = find();
      if (u.id === me.id) throw new Error("Change your own password under Account.");
      const problem = auth.passwordProblem(b.password);
      if (problem) throw new Error(`Password: ${problem}`);
      u.hash = auth.hashPassword(b.password); u.mustChange = b.mustChange !== false; u.ver = (u.ver || 0) + 1; // logged out everywhere
      await auth.saveUsers(list);
      return send(res, 200, { ok: true, ...(await teamOut(list)) });
    }

    case "resetLink": {
      const u = find(); // their old password keeps working until they use the link (then they're logged out elsewhere)
      return send(res, 200, { ok: true, invite: await inviteOut(u, INVITE_HOURS, "reset"), ...(await teamOut(list)) });
    }
  }
  return send(res, 200, { ok: true, ...(await teamOut(list)) });
}

async function teamOut(list) {
  return { users: list.map(auth.publicUser), artists: await artists.list(), roles: auth.ROLES, emailReady: emailReady() };
}

// Beam Book: run this endpoint for the shop at this web address.
module.exports = require("../../lib/tenant").handler(module.exports);
