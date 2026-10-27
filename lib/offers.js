// Offers and counter-offers between a client and a business.
// A request carries a list of offers, oldest first. At most one is "open" at a time; sending a new offer
// marks the open one "countered". Accepting an offer settles the deal: it's copied to r.agreed.
//
// An offer: { id, from: "client"|"shop", by, at, price, date, time, durationMin, scope, terms, deposit, note, status }
//   status: open | accepted | countered | declined | withdrawn
// What a client may change is set per business (config.negotiate). Anything they can't change is copied from the
// business's last offer, so a counter never quietly drops a term.

const crypto = require("crypto");
const T = require("./time");
const { money } = require("./templates");

const TERMS = ["price", "date", "time", "durationMin", "scope", "terms", "deposit"];
const CLIENT_TERM = { price: "price", date: "datetime", time: "datetime", durationMin: "datetime", scope: "scope", terms: "terms", deposit: "terms" };

const open = (r) => (r.offers || []).find((o) => o.status === "open") || null;
const lastFrom = (r, who) => [...(r.offers || [])].reverse().find((o) => o.from === who) || null;
const allowed = (cfg, term) => Boolean(cfg.negotiate?.[CLIENT_TERM[term]]);

function hrs(min) { return min % 60 ? `${(min / 60).toFixed(1)} hours` : `${min / 60} hour${min === 60 ? "" : "s"}`; }

// Clean the terms someone typed. Returns { terms, error }.
function readTerms(b, cfg) {
  const t = {};
  if (b.price !== undefined && String(b.price).trim()) { t.price = money(b.price); if (!t.price) return { error: "Enter a price, like 400 or 300-500." }; }
  if (b.date) { if (!T.parseDate(b.date)) return { error: "Pick a real date." }; t.date = String(b.date); }
  if (b.time) { if (!T.parseHM(b.time)) return { error: "Pick a start time." }; t.time = String(b.time).padStart(5, "0"); }
  if (b.durationMin !== undefined && b.durationMin !== "" && b.durationMin !== null) {
    const d = Number(b.durationMin);
    if (!(cfg.sessionLengths || []).includes(d)) return { error: "Pick a length from the list." };
    t.durationMin = d;
  }
  for (const k of ["scope", "terms"]) if (b[k] !== undefined && String(b[k]).trim()) t[k] = String(b[k]).trim().slice(0, 1500);
  if (b.deposit !== undefined && String(b.deposit).trim()) t.deposit = String(b.deposit).trim().slice(0, 120);
  if (t.time && !t.date) return { error: "Pick a date to go with the time." };
  if (t.date) {
    const d = T.parseDate(t.date);
    if (T.toUtc(d.y, d.m, d.d, 23, 59) < Date.now()) return { error: "That date has already passed." };
  }
  return { terms: t };
}

function make(from, by, terms, note) {
  return { id: crypto.randomBytes(5).toString("hex"), from, by: by || undefined, at: new Date().toISOString(), ...terms,
    note: note ? String(note).slice(0, 1500) : undefined, status: "open" };
}

// The business sends an offer (first offer or a counter). It may set any term.
function shopOffer(r, cfg, b, by) {
  const { terms, error } = readTerms(b, cfg);
  if (error) return { error };
  if (!terms.price && !terms.date && !terms.scope && !terms.durationMin) return { error: "Give at least a price, a date or what's included." };
  if (terms.date && terms.time && !terms.durationMin) return { error: `Pick how long the ${cfg.words?.session || "session"} is.` };
  const prev = open(r);
  if (prev) prev.status = "countered";
  const o = make("shop", by, terms, b.message);
  (r.offers ||= []).push(o);
  return { offer: o, countered: prev };
}

// The client makes an offer: their first one (from the request form) or a counter. Terms they're not allowed to
// change are copied from the business's last offer.
function clientOffer(r, cfg, b, { first = false } = {}) {
  const { terms, error } = readTerms(b, cfg);
  if (error) return { error };
  const base = lastFrom(r, "shop") || {};
  const out = {};
  for (const k of TERMS) {
    if (allowed(cfg, k)) { if (terms[k] !== undefined) out[k] = terms[k]; else if (!first && base[k] !== undefined) out[k] = base[k]; }
    else if (base[k] !== undefined) out[k] = base[k];
  }
  if (out.date && out.time && !out.durationMin) out.durationMin = base.durationMin || (cfg.sessionLengths || [])[0];
  if (!first) {
    const changed = TERMS.some((k) => String(out[k] ?? "") !== String(base[k] ?? ""));
    if (!changed) return { error: "Change at least one thing to send a counter-offer, or accept the offer as it is." };
  }
  if (!out.price && !out.date && !out.scope) return { error: "Add a price, a date, or what you need." };
  const prev = open(r);
  if (prev) prev.status = "countered";
  const o = make("client", null, out, b.message);
  (r.offers ||= []).push(o);
  return { offer: o, countered: prev };
}

// Someone accepts the open offer from the other side.
function accept(r, who) {
  const o = open(r);
  if (!o) return { error: "There's no open offer to accept." };
  if (o.from === who) return { error: "You can't accept your own offer. Wait for their answer." };
  o.status = "accepted";
  o.acceptedAt = new Date().toISOString();
  r.agreed = { ...o };
  return { offer: o };
}
function decline(r, who) {
  const o = open(r);
  if (!o || o.from === who) return { error: "There's no offer to turn down." };
  o.status = "declined";
  return { offer: o };
}

// One-line summary for emails, texts and history.
function summary(o, cfg) {
  const parts = [];
  if (o.price) parts.push(o.price);
  if (o.date) {
    const d = T.parseDate(o.date);
    const start = o.time ? T.toUtc(d.y, d.m, d.d, ...o.time.split(":").map(Number)) : T.toUtc(d.y, d.m, d.d, 12);
    parts.push(o.time ? `${T.dayLabel(start)} at ${T.timeLabel(start)}` : T.dayLabel(start));
  }
  if (o.durationMin) parts.push(hrs(o.durationMin));
  if (o.deposit) parts.push(`deposit ${o.deposit}`);
  return parts.join(", ") || (o.scope ? o.scope.slice(0, 60) : "an offer");
}
// Lines for an email body.
function lines(o, cfg) {
  const L = [];
  if (o.price) L.push(`Price: ${o.price}`);
  if (o.date) L.push(`When: ${summary({ date: o.date, time: o.time }, cfg)}`);
  if (o.durationMin) L.push(`Length: ${hrs(o.durationMin)}`);
  if (o.scope) L.push(`Included: ${o.scope}`);
  if (o.terms) L.push(`Terms: ${o.terms}`);
  if (o.deposit) L.push(`Deposit: ${o.deposit}`);
  return L.join("\n");
}
// UTC start of an offer's date + time (null if it has none).
function startOf(o) {
  if (!o?.date || !o?.time) return null;
  const d = T.parseDate(o.date); const [h, mi] = o.time.split(":").map(Number);
  return T.toUtc(d.y, d.m, d.d, h, mi);
}

module.exports = { TERMS, open, lastFrom, allowed, readTerms, shopOffer, clientOffer, accept, decline, summary, lines, startOf, hrs };
