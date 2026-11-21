// The one welcome email a new client gets (Phase 3 of the onboarding doc): their example site, the link to pick their
// password, their private setup page and where their inbox is, all in one email from Neal Media.
// Sent by Beam from the control page (instead of a text from Neal's phone). Previews and local runs only log it.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const host = (u) => String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");

function compose({ shopName, ownerName, ownerEmail, bookingUrl, shellUrl, passwordLink, setupLink, building }) {
  const first = String(ownerName || "").trim().split(/\s+/)[0] || "there";
  const subject = building ? `Your new website is ready to try, ${first}` : `Your Beam booking page is ready, ${first}`;
  const intro = building
    ? `Here's the example site we built for ${shopName}. It's yours to try on real clients for up to 90 days, and there's nothing to sign until you're 100% happy.`
    : `${shopName}'s Beam booking page is set up and ready for you.`;
  const steps = [
    { title: "Pick your password", text: `You'll log in with ${ownerEmail}. This link works once, for 7 days.`, url: passwordLink, label: "Pick my password" },
    { title: "Your setup page", text: "Your details, getting paid, calendars and your team, in small steps. Come back to it any time.", url: setupLink, label: "Open my setup page" },
    { title: "Try it out", text: "Book a test as if you were a client (use TEST as the name), then send your booking link to a few real clients.", url: bookingUrl, label: "Open my booking page" },
  ].filter((s) => s.url);

  const text = [
    `Hi ${first},`, "", intro, "",
    ...(shellUrl ? [`Your example site: ${shellUrl}`, ""] : []),
    ...steps.flatMap((s, i) => [`${i + 1}. ${s.title}: ${s.text}`, `   ${s.url}`, ""]),
    `Your inbox: ${bookingUrl}/admin`, "",
    "Questions? Just reply to this email, or text Neal at 907-669-2274.", "",
    "Neal Media & Production · Powered by Beam",
  ].join("\n");

  const btn = (url, label, main) => `<a href="${esc(url)}" style="display:inline-block;background:${main ? "#1265B8" : "#ffffff"};color:${main ? "#ffffff" : "#0D2236"};border:1px solid ${main ? "#1265B8" : "#d5dce4"};padding:11px 18px;border-radius:999px;text-decoration:none;font-weight:600">${esc(label)}</a>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0D2236">
<p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#1265B8;margin:0 0 8px">Neal Media &amp; Production</p>
<h1 style="font-size:24px;margin:0 0 14px">${esc(building ? "Your new website is ready to try" : "Your booking page is ready")}</h1>
<p style="margin:0 0 14px;line-height:1.55">Hi ${esc(first)},</p>
<p style="margin:0 0 18px;line-height:1.55">${esc(intro)}</p>
${shellUrl ? `<p style="margin:0 0 24px">${btn(shellUrl, `See ${host(shellUrl)}`, true)}</p>` : ""}
${steps.map((s, i) => `<div style="border:1px solid #e3e8ee;border-radius:14px;padding:16px 18px;margin:0 0 12px">
<p style="margin:0 0 4px;font-weight:700">${i + 1}. ${esc(s.title)}</p>
<p style="margin:0 0 12px;color:#5b6b7b;line-height:1.5">${esc(s.text)}</p>${btn(s.url, s.label, !shellUrl && i === 0)}</div>`).join("\n")}
<p style="margin:20px 0 6px;line-height:1.55">Your inbox lives at <a href="${esc(bookingUrl)}/admin" style="color:#1265B8">${esc(host(bookingUrl))}/admin</a>. Put it on your phone's home screen and it works like an app.</p>
<p style="margin:0 0 14px;line-height:1.55">Questions? Just reply to this email, or text Neal at 907-669-2274.</p>
<p style="font-size:12px;color:#8a97a5;margin-top:28px">Neal Media &amp; Production · Powered by <a href="https://www.beam-book.com" style="color:#8a97a5">Beam</a></p></div>`;
  return { subject, text, html };
}

async function send({ to, ...parts }) {
  const { subject, text, html } = compose({ ownerEmail: to, ...parts });
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || (process.env.STORE_NAMESPACE && !process.env.SANDBOX_SEND)) {
    console.log(`\n[welcome:dev] to=${to} subject="${subject}"\n${text}\n`);
    return { ok: true, dev: true };
  }
  const base = String(process.env.EMAIL_FROM), addr = (base.match(/<([^>]+)>/) || [, base])[1].trim();
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `"Neal Media & Production" <${addr}>`, to: [to], subject, text, html, reply_to: "Nealmedia@yahoo.com" }),
  });
  if (!r.ok) { console.error("[welcome] send failed", r.status, await r.text()); return { ok: false }; }
  return { ok: true };
}

module.exports = { compose, send };
