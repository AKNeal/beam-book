// POST /api/callback — "Request a call" form on the Beam splash page (public/home.html).
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
