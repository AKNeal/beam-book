// Beam checkout: cash (with the shop's cash discount) or card on a Stripe Terminal reader at the front desk.
// Each shop has its own Stripe account under Neal Media's Stripe Connect platform (direct charges; the shop pays
// Stripe's fees; Beam can take a platform fee). Card fee passed to the client = an optional surcharge on CREDIT cards only,
// at the shop's rate, never on debit or prepaid. Default 0%: shops recover card costs through card prices and a cash
// discount (Neal, Nov 17). A shop that turns a surcharge on must post it at the counter and online.
// Needs STRIPE_SECRET_KEY (the platform's key; a test key on the sandbox). Without it, cash checkout still works.

const config = require("../config/studio");
const store = require("./store");
const cal = require("./calendar");
const T = require("./time");

const API = "https://api.stripe.com/v1";
const SURCHARGE_VERSION = "2026-03-25.preview";
const key = () => process.env.STRIPE_SECRET_KEY || "";
const enabled = () => Boolean(key());
const testMode = () => key().startsWith("sk_test_") || key().startsWith("rk_test_");

function form(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? form(x, `${name}[${i}]`, out) : out.push([`${name}[]`, String(x)])));
    else if (typeof v === "object") form(v, name, out);
    else out.push([name, String(v)]);
  }
  return out;
}

async function stripe(method, path, params, { account, version } = {}) {
  if (!enabled()) throw new Error("Card payments aren't set up yet (STRIPE_SECRET_KEY).");
  const headers = { Authorization: `Bearer ${key()}` };
  if (account) headers["Stripe-Account"] = account;
  if (version) headers["Stripe-Version"] = version;
  let url = API + path, body;
  if (method === "GET") { const q = new URLSearchParams(form(params)).toString(); if (q) url += "?" + q; }
  else { headers["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(form(params)).toString(); }
  const r = await fetch(url, { method, headers, body });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error?.message || `Stripe error ${r.status}`); e.stripe = data.error; throw e; }
  return data;
}

// ---------- shop settings ----------
const DEFAULTS = { surchargePct: 0, stripePct: 2.7, stripeCents: 5, // Stripe in-person card rate, paid by Neal Media and taken back in the application fee
  platformFeePct: require("./plans").ADMIN_FEE_PCT, account: null, location: null, reader: null };
async function settings() { return { ...DEFAULTS, ...((await store.getJSON("pay:settings")) || {}) }; }
async function saveSettings(patch) { const s = { ...(await settings()), ...patch }; await store.setJSON("pay:settings", s); return s; }
async function updateRates(b) {
  const out = {};
  if (b.surchargePct !== undefined) { const n = Number(b.surchargePct); if (!(n >= 0 && n <= 3)) throw new Error("Credit card fee: 0 to 3%."); out.surchargePct = Math.round(n * 100) / 100; }
  return saveSettings(out);
}

// ---------- the shop's Stripe account (Connect) ----------
async function connectLink(returnUrl) {
  const s = await settings();
  let account = s.account;
  if (!account) {
    const a = await stripe("POST", "/accounts", {
      country: "US", email: config.studio.contactEmail || undefined,
      business_profile: { name: config.studio.name, url: config.studio.siteUrl || undefined },
      // Fully managed by Neal Media: the shop fills in Stripe's form once (ID + bank) and never needs a Stripe login.
      // Neal Media pays Stripe's fees (taken back in the application fee) and covers disputes and refunds.
      controller: { fees: { payer: "application" }, losses: { payments: "application" }, stripe_dashboard: { type: "none" }, requirement_collection: "stripe" },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { beam_shop: config.tenant },
    });
    account = a.id; await saveSettings({ account });
  }
  const link = await stripe("POST", "/account_links", { account, type: "account_onboarding", refresh_url: returnUrl, return_url: returnUrl });
  return link.url;
}

async function status() {
  const s = await settings();
  const out = { enabled: enabled(), testMode: testMode(), surchargePct: s.surchargePct, account: null, reader: null };
  if (!enabled() || !s.account) return out;
  try {
    const a = await stripe("GET", `/accounts/${s.account}`);
    out.account = { id: a.id, ready: Boolean(a.charges_enabled), details: Boolean(a.details_submitted) };
  } catch (e) { out.account = { id: s.account, ready: false, error: e.message }; }
  if (s.reader) {
    try { const r = await stripe("GET", `/terminal/readers/${s.reader}`, null, { account: s.account }); out.reader = { id: r.id, label: r.label, type: r.device_type, online: r.status === "online", simulated: /simulated/.test(r.device_type || "") || r.serial_number?.startsWith("simulated") }; }
    catch (e) { out.reader = { id: s.reader, error: e.message }; }
  }
  return out;
}

// Register the shop's reader: the code shown on the S700, or (test mode) a simulated reader.
async function addReader({ code, label }) {
  const s = await settings();
  if (!s.account) throw new Error("Connect Stripe first.");
  let location = s.location;
  if (!location) {
    const addr = config.studio.address || "";
    const zip = (addr.match(/\b\d{5}\b/) || ["99705"])[0];
    const loc = await stripe("POST", "/terminal/locations", { display_name: config.studio.name, address: { line1: addr.split(",")[0] || config.studio.name, city: "North Pole", state: "AK", country: "US", postal_code: zip } }, { account: s.account });
    location = loc.id;
  }
  const registration_code = testMode() && !code ? "simulated-wpe" : String(code || "").trim();
  if (!registration_code) throw new Error("Enter the code shown on the reader.");
  const r = await stripe("POST", "/terminal/readers", { registration_code, location, label: String(label || "Front desk").slice(0, 60) }, { account: s.account });
  await saveSettings({ location, reader: r.id });
  return status();
}

// ---------- checkout ----------
const cents = (d) => Math.round(Number(d) * 100);
const dollars = (c) => Math.round(c) / 100;

async function apptInfo(apptId) {
  const a = await cal.getAppt(apptId);
  if (!a) throw new Error("That appointment isn't on the calendar.");
  const r = a.requestId ? await store.getJSON(`req:${a.requestId}`) : null;
  const svc = r?.service || (config.services || []).find((s) => s.name.toLowerCase() === String(a.title || "").toLowerCase());
  const price = a.price != null ? Number(a.price) : Number(svc?.price) || 0;
  return { appt: a, price, service: svc?.name || a.title || "Service", client: r?.client?.name || a.clientName || "" };
}

async function record(apptId) { return store.getJSON(`pay:appt:${apptId}`); }
async function saveRecord(apptId, rec) {
  await store.setJSON(`pay:appt:${apptId}`, rec);
  await store.indexAdd("pay:index", apptId, rec.at);
  return rec;
}

// The amounts the screen shows before anyone pays.
async function quote(apptId, { tip = 0, price } = {}) {
  const info = await apptInfo(apptId), D = await require("./analytics").settings(), S = await settings();
  const subtotal = price != null && Number(price) >= 0 ? Number(price) : info.price, t = Math.max(0, Number(tip) || 0);
  const discount = Math.min(subtotal, Number(D.cashDiscount) || 0);
  const creditFee = dollars(cents((subtotal + t) * S.surchargePct / 100));
  return { ...info, subtotal, tip: t, cash: { discount, total: subtotal - discount + t }, card: { total: subtotal + t, creditFee, creditTotal: dollars(cents(subtotal + t) + cents(creditFee)) },
    surchargePct: S.surchargePct, cardReady: Boolean(enabled() && S.account && S.reader), testMode: testMode(), paid: await record(apptId) };
}

async function payCash(apptId, { tip = 0, price, by } = {}) {
  if (await record(apptId)) throw new Error("This appointment is already paid.");
  const q = await quote(apptId, { tip, price });
  return saveRecord(apptId, { method: "cash", subtotal: q.subtotal, discount: q.cash.discount, tip: q.tip, surcharge: 0, total: q.cash.total,
    barber: q.appt.artist, at: Date.now(), by: by || "" });
}

// Card, step 1: put the amount on the reader and wait for a tap/insert.
async function startCard(apptId, { tip = 0, price, by } = {}) {
  if (await record(apptId)) throw new Error("This appointment is already paid.");
  const S = await settings(); if (!S.account || !S.reader) throw new Error("Connect Stripe and add the reader first.");
  const q = await quote(apptId, { tip, price });
  const amount = cents(q.subtotal + q.tip); if (amount < 50) throw new Error("Card payments must be at least $0.50.");
  const fee = Math.round(amount * ((S.platformFeePct || 0) + (S.stripePct || 0)) / 100) + (S.stripeCents || 0); // 1% to Neal Media + Stripe's fee, which Neal Media pays
  const pi = await stripe("POST", "/payment_intents", {
    amount, currency: "usd", payment_method_types: ["card_present"], capture_method: "manual",
    ...(fee ? { application_fee_amount: fee } : {}), description: `${q.service} · ${config.studio.name}`,
    metadata: { beam_shop: config.tenant, appt: apptId, barber: q.appt.artist, tip: cents(q.tip), subtotal: cents(q.subtotal) },
  }, { account: S.account });
  await stripe("POST", `/terminal/readers/${S.reader}/collect_payment_method`, { payment_intent: pi.id, collect_config: { enable_customer_cancellation: true } }, { account: S.account });
  await store.setJSON(`pay:pending:${apptId}`, { pi: pi.id, subtotal: q.subtotal, tip: q.tip, at: Date.now(), by: by || "" });
  return { pi: pi.id, state: "waiting" };
}

// Card, step 2 (polled by the screen): once the card is read, add the credit-card fee if it's a credit card.
async function cardStatus(apptId) {
  const S = await settings(), p = await store.getJSON(`pay:pending:${apptId}`);
  if (await record(apptId)) return { state: "paid", paid: await record(apptId) };
  if (!p) return { state: "none" };
  const reader = await stripe("GET", `/terminal/readers/${S.reader}`, null, { account: S.account });
  const act = reader.action || {};
  if (act.status === "failed") return { state: "failed", message: act.failure_message || "The card didn't go through. Try again or take another payment." };
  let pi = await stripe("GET", `/payment_intents/${p.pi}`, { expand: ["payment_method"] }, { account: S.account });
  if (pi.status === "requires_payment_method") return { state: "waiting" };
  if (pi.status === "requires_confirmation") {
    const funding = pi.payment_method?.card_present?.funding || "unknown";
    const base = cents(p.subtotal + p.tip);
    const surcharge = funding === "credit" ? Math.round(base * S.surchargePct / 100) : 0;
    if (!p.surchargeSet) {
      if (surcharge) pi = await stripe("POST", `/payment_intents/${p.pi}`, { amount: base + surcharge, amount_details: { surcharge: { amount: surcharge, enforce_validation: "enabled" } } }, { account: S.account, version: SURCHARGE_VERSION });
      await store.setJSON(`pay:pending:${apptId}`, { ...p, surchargeSet: true, surcharge, funding });
    }
    return { state: "confirm", funding, surcharge: dollars(surcharge), total: dollars(base + surcharge), brand: pi.payment_method?.card_present?.brand || "" };
  }
  if (pi.status === "requires_capture") {
    const cap = await stripe("POST", `/payment_intents/${p.pi}/capture`, {}, { account: S.account });
    const surcharge = p.surcharge || 0;
    const rec = await saveRecord(apptId, { method: "card", funding: p.funding || "", subtotal: p.subtotal, discount: 0, tip: p.tip, surcharge: dollars(surcharge),
      total: dollars(cap.amount_received || cap.amount), pi: p.pi, barber: (await cal.getAppt(apptId))?.artist || "", at: Date.now(), by: p.by || "" });
    await store.del(`pay:pending:${apptId}`);
    return { state: "paid", paid: rec };
  }
  if (pi.status === "canceled") { await store.del(`pay:pending:${apptId}`); return { state: "canceled" }; }
  return { state: "processing" };
}

// Card, step 3: the client agreed to the total shown (fee included) → charge it.
async function confirmCard(apptId) {
  const S = await settings(), p = await store.getJSON(`pay:pending:${apptId}`);
  if (!p) throw new Error("No card payment in progress.");
  await stripe("POST", `/terminal/readers/${S.reader}/confirm_payment_intent`, { payment_intent: p.pi }, { account: S.account });
  return { state: "processing" };
}

async function cancelCard(apptId) {
  const S = await settings(), p = await store.getJSON(`pay:pending:${apptId}`);
  if (!p) return { state: "none" };
  try { await stripe("POST", `/terminal/readers/${S.reader}/cancel_action`, {}, { account: S.account }); } catch {}
  try { await stripe("POST", `/payment_intents/${p.pi}/cancel`, {}, { account: S.account }); } catch {}
  await store.del(`pay:pending:${apptId}`);
  return { state: "canceled" };
}

// Test mode only: pretend a client tapped a card on the simulated reader.
const TEST_CARDS = { credit: "4242424242424242", debit: "4000056655665556" };
async function simulateTap(kind) {
  if (!testMode()) throw new Error("Only in test mode.");
  const S = await settings();
  await stripe("POST", `/test_helpers/terminal/readers/${S.reader}/present_payment_method`, { type: "card_present", card_present: { number: TEST_CARDS[kind] || TEST_CARDS.credit } }, { account: S.account });
  return { ok: true };
}

// Today's appointments with what each one paid (for the checkout screen).
async function day({ who = null, dateKey, now = Date.now() } = {}) {
  const d = T.parseDate(dateKey || T.dateKey(now)), from = T.toUtc(d.y, d.m, d.d, 0, 0), to = from + 864e5;
  const roster = await require("./artists").list(), out = [];
  for (const a of roster) {
    if (who && a.slug !== who) continue;
    for (const x of await cal.apptsBetween(a.slug, from, to)) {
      if (x.pending) continue;
      out.push({ id: x.id, barber: a.slug, barberName: a.name, start: x.start, end: x.end, time: T.timeLabel(x.start), client: x.clientName || "", service: x.title || "" });
    }
  }
  const recs = await store.getMany(out.map((x) => `pay:appt:${x.id}`));
  out.forEach((x, i) => (x.paid = recs[i] || null));
  return out.sort((a, b) => a.start - b.start);
}

module.exports = { enabled, testMode, settings, updateRates, connectLink, status, addReader, quote, payCash, startCard, cardStatus, confirmCard, cancelCard, simulateTap, day, record, form };
