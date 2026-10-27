// Text messages through Twilio (env TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM or
// TWILIO_MESSAGING_SERVICE_SID). Without them, texts are printed to the server log instead, like emails.
// US carriers only deliver business texts from numbers registered for A2P 10DLC (done once in the Twilio console).
// Twilio handles STOP / START / HELP replies itself; nothing here texts anyone who hasn't opted in.

const config = require("../config/studio");

const smsReady = () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN &&
  (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID));

// "907-555-0100", "(907) 555 0100", "+1 907..." → "+19075550100". US/Canada numbers only; anything else → null.
function toE164(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10 && /^[2-9]/.test(d)) return `+1${d}`;
  if (d.length === 11 && d[0] === "1" && /^[2-9]/.test(d[1])) return `+${d}`;
  return null;
}

async function sendSms(to, body) {
  const num = toE164(to);
  if (!num) return { skipped: true };
  const text = `${config.studio.name}: ${String(body).trim()}`.slice(0, 600);
  if (!smsReady()) {
    console.log(`\n[sms:dev] to=${num}\n${text}\n`);
    return { dev: true };
  }
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const form = new URLSearchParams({ To: num, Body: text });
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
    else form.set("From", process.env.TWILIO_FROM);
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!r.ok) console.error("[sms] send failed", r.status, (await r.text()).slice(0, 300));
    return { ok: r.ok };
  } catch (e) {
    console.error("[sms] error", e.message); // a text failing must never break a booking
    return { ok: false };
  }
}

// Text a client only if they ticked "Text me updates" and gave a number.
const textClient = (r, body) => (r.client?.smsOk && r.client.phone ? sendSms(r.client.phone, body) : Promise.resolve({ skipped: true }));

// Text every active login for an artist who turned on text alerts (Account page). slug null = every artist (open requests).
async function textArtists(slug, body) {
  const auth = require("./auth");
  // Artists get texts for their own clients (and open requests); Owner, Site admin and Front desk get every alert.
  const list = (await auth.users()).filter((u) => u.active !== false && u.smsAlerts && u.phone &&
    (u.role === "artist" ? (!slug || u.artist === slug) : true));
  return Promise.all(list.map((u) => sendSms(u.phone, body)));
}

module.exports = { sendSms, smsReady, toE164, textClient, textArtists };
