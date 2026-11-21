// POST /api/callback — "Request a call" form on the Beam splash page (public/home.html),
// and {kind:"application"} — the new-client application (public/start.html, Phase 2 of the onboarding doc):
// the bare minimum to start an example site. Applications are saved ("beambook:apps", shown on the control page)
// and emailed to Neal Media, with the logo or photo attached when one was added.
// Not tied to a shop: it emails Neal Media directly through Resend (RESEND_API_KEY, EMAIL_FROM).
// Recipients can be changed with CALLBACK_TO (comma-separated) without touching code.

const store = require("../lib/store");
const { send, method, body, ip, str } = require("../lib/http");

const DEFAULT_TO = ["Nealmedia@yahoo.com", "Artemis.nealmedia@gmail.com"];
const recipients = () => {
  const list = String(process.env.CALLBACK_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_TO;
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  const b = body(req);
  if (str(b.website)) return send(res, 200, { ok: true }); // honeypot: bots fill the hidden field
  if (b.kind === "application") return application(req, res, b);

  try {
    if ((await store.global.hit(`rl:callback:${ip(req)}`, 3600)) > 6) {
      return send(res, 429, { error: "Too many requests from here. Please try again in an hour, or email Nealmedia@yahoo.com." });
    }
  } catch { /* storage hiccup: still take the request */ }

  const f = {
    name: str(b.name, 80),
    business: str(b.business, 120),
    phone: str(b.phone, 40),
    email: str(b.email, 120).toLowerCase(),
    type: str(b.type, 60),
    when: str(b.when, 60),
    day: /^\d{4}-\d{2}-\d{2}$/.test(str(b.day, 10)) ? str(b.day, 10) : "",
    need: str(b.need, 80),
    notes: str(b.notes, 1500),
  };
  if (f.name.length < 2) return send(res, 400, { error: "Please enter your name." });
  if (f.phone.replace(/\D/g, "").length < 7) return send(res, 400, { error: "Please enter a phone number we can call." });
  if (f.email && !EMAIL_RE.test(f.email)) return send(res, 400, { error: "That email doesn't look right." });

  const rows = [
    ["Name", f.name], ["Business", f.business], ["Phone", f.phone], ["Email", f.email],
    ["Looking for", f.need], ["Business type", f.type], ["Best day to call", f.day ? new Date(`${f.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) : ""], ["Best time to call", f.when], ["Notes", f.notes],
  ].filter(([, v]) => v);
  const subject = `Beam call request: ${f.name}${f.business ? ` (${f.business})` : ""}`;
  const text = [`New call request from the Beam website`, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", `Sent ${new Date().toISOString()}`].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0D2236">
<p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#1265B8;margin:0 0 8px">Beam</p>
<h1 style="font-size:22px;margin:0 0 18px">New call request</h1>
<table style="border-collapse:collapse;width:100%">${rows.map(([k, v]) => `<tr><td style="padding:8px 12px 8px 0;color:#5b6b7b;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:8px 0;white-space:pre-wrap">${k === "Phone" ? `<a href="tel:${esc(v.replace(/[^\d+]/g, ""))}">${esc(v)}</a>` : esc(v)}</td></tr>`).join("")}</table>
<p style="font-size:12px;color:#8a97a5;margin-top:24px">Sent from the Request a call form on the Beam website</p></div>`;

  // Previews (sandbox) and local runs only log, like the rest of Beam Book.
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || (process.env.STORE_NAMESPACE && !process.env.SANDBOX_SEND)) {
    console.log(`\n[callback:dev] to=${recipients().join(", ")} subject="${subject}"\n${text}\n`);
    return send(res, 200, { ok: true, dev: true });
  }

  const base = String(process.env.EMAIL_FROM);
  const addr = (base.match(/<([^>]+)>/) || [, base])[1].trim();
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `"Beam" <${addr}>`, to: recipients(), subject, text, html, ...(f.email ? { reply_to: f.email } : {}) }),
    });
    if (!r.ok) {
      console.error("[callback] send failed", r.status, await r.text());
      return send(res, 502, { error: "We couldn't send that just now. Please email Nealmedia@yahoo.com and we'll call you." });
    }
  } catch (e) {
    console.error("[callback] error", e.message);
    return send(res, 502, { error: "We couldn't send that just now. Please email Nealmedia@yahoo.com and we'll call you." });
  }
  return send(res, 200, { ok: true });
};

// ---------------------------------------------------------------- new-client application
const APP_LIMIT = 300;
async function application(req, res, b) {
  try {
    if ((await store.global.hit(`rl:apply:${ip(req)}`, 3600)) > 6) return send(res, 429, { error: "Too many tries from here. Please try again in an hour, or email Nealmedia@yahoo.com." });
  } catch { /* storage hiccup: still take it */ }
  const { APP_TYPES } = require("../lib/starter");
  const url = (v) => { const x = str(v, 300); return !x ? "" : /^https?:\/\//i.test(x) ? x : `https://${x.replace(/^\/+/, "")}`; };
  const a = {
    business: str(b.business, 120), name: str(b.name, 80), phone: str(b.phone, 40), email: str(b.email, 120).toLowerCase(),
    type: APP_TYPES[b.type] ? b.type : "", noSite: Boolean(b.noSite), site: b.noSite ? "" : url(b.site), social: url(b.social),
    address: str(b.address, 200), publicPhone: str(b.publicPhone, 40), hours: str(b.hours, 200), offering: str(b.offering, 200),
  };
  const err = !a.business || a.business.length < 2 ? "Please enter your business name."
    : a.name.length < 2 ? "Please enter your name."
    : a.phone.replace(/\D/g, "").length < 7 ? "Please enter a cell number we can reach you on."
    : !EMAIL_RE.test(a.email) ? "Please enter your email. It becomes your login."
    : !a.type ? "Pick the kind of business."
    : !a.noSite && !a.site ? "Add your current website, or tick \"I don't have one\"."
    : a.noSite && !a.social ? "With no website, add your Instagram or Facebook link so we can see your work."
    : !a.address ? "Add your address or the area you serve."
    : !a.hours ? "Add your hours (one line is fine)."
    : !a.offering ? "Tell us what people book or order from you." : "";
  if (err) return send(res, 400, { error: err });

  // Optional logo or photo: a data URL shrunk in the browser. Attached to the email, not stored.
  let attachment = null;
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.photo || ""));
  if (m && m[2].length < 4_000_000) attachment = { filename: `${a.business.replace(/[^\w-]+/g, "-").slice(0, 40) || "logo"}.${m[1] === "jpeg" ? "jpg" : m[1]}`, content: m[2] };

  const crypto = require("crypto");
  const rec = { id: crypto.randomBytes(6).toString("base64url"), at: new Date().toISOString(), status: "new", ...a, photo: Boolean(attachment) };
  try {
    const apps = (await store.global.getJSON("apps")) || [];
    apps.unshift(rec); await store.global.setJSON("apps", apps.slice(0, APP_LIMIT));
  } catch (e) { console.error("[apply] save", e.message); } // the email still goes out

  const rows = [
    ["Business", a.business], ["Name", a.name], ["Cell", a.phone], ["Email", a.email], ["Type", APP_TYPES[a.type].label],
    ["Website", a.noSite ? "None yet" : a.site], ["Instagram / Facebook", a.social], ["Address or area", a.address], ["Public phone", a.publicPhone],
    ["Hours", a.hours], ["People book or order", a.offering], ["Logo or photo", attachment ? "Attached" : ""],
  ].filter(([, v]) => v);
  const subject = `Beam application: ${a.business}`;
  const startUrl = `${process.env.BEAMBOOK_URL || "https://www.beam-book.com"}/platform?app=${rec.id}`;
  const text = [`New application from beam-book.com/start`, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", `Start building: ${startUrl}`].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0D2236">
<p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#1265B8;margin:0 0 8px">Beam · new application</p>
<h1 style="font-size:22px;margin:0 0 18px">${esc(a.business)}</h1>
<table style="border-collapse:collapse;width:100%">${rows.map(([k, v]) => `<tr><td style="padding:8px 12px 8px 0;color:#5b6b7b;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:8px 0;white-space:pre-wrap">${/^https?:/.test(v) ? `<a href="${esc(v)}">${esc(v)}</a>` : k === "Cell" ? `<a href="tel:${esc(v.replace(/[^\d+]/g, ""))}">${esc(v)}</a>` : esc(v)}</td></tr>`).join("")}</table>
<p style="margin:22px 0"><a href="${esc(startUrl)}" style="background:#1265B8;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">Start building</a></p></div>`;

  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || (process.env.STORE_NAMESPACE && !process.env.SANDBOX_SEND)) {
    console.log(`\n[apply:dev] to=${recipients().join(", ")} subject="${subject}"${attachment ? " (photo attached)" : ""}\n${text}\n`);
    return send(res, 200, { ok: true, dev: true });
  }
  const base = String(process.env.EMAIL_FROM), addr = (base.match(/<([^>]+)>/) || [, base])[1].trim();
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `"Beam" <${addr}>`, to: recipients(), subject, text, html, reply_to: a.email, ...(attachment ? { attachments: [attachment] } : {}) }),
    });
    if (!r.ok) console.error("[apply] send failed", r.status, await r.text()); // it's saved; it shows on the control page
  } catch (e) { console.error("[apply] error", e.message); }
  return send(res, 200, { ok: true });
}
