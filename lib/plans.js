// Beam pricing (what each shop pays Neal Media). One flat plan:
//   core  $150/mo  everything: website, booking, dashboards, scoreboard, reminders and confirmations by text and
//                  email (no text or email limits), clients change/cancel by text, checkout.
//   plus  a 1% admin fee on card payments taken through Beam's checkout (Stripe Connect application fee, collected
//         automatically on each payment). Stripe's own fees are the shop's, passed to clients as the credit-card fee.
// Texts and emails are still counted per shop per month (lib/sms.js, lib/email.js) so Neal Media can see its costs.
// Older shop records with "shop"/"shop_ai" fall back to core.

const PLANS = {
  core: { label: "Beam", price: 150, texts: null, textBooking: true, ai: false, adminFeePct: 1 },
};
const ADMIN_FEE_PCT = 1;
const COST = { perTextSegment: 0.0125, perEmail: 0.0004 }; // Neal Media's own costs (Twilio + carrier fee; Resend Pro), for the control page
const DEFAULT_PLAN = "core";

const planOf = (cfg) => (PLANS[cfg?.plan] ? cfg.plan : DEFAULT_PLAN);
const features = (cfg) => ({ plan: planOf(cfg), ...PLANS[planOf(cfg)] });
const monthKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);

// This shop's usage for a month (run inside the shop: tenant.runAs). Texts are counted in segments, as carriers bill them.
async function usage(month = monthKey()) {
  const store = require("./store");
  const texts = Number(await store.getJSON(`usage:sms:${month}`).catch(() => 0)) || 0;
  const emails = Number(await store.getJSON(`usage:email:${month}`).catch(() => 0)) || 0;
  return { month, texts, emails };
}

// What to bill for a month: the flat price. Usage and Neal Media's cost to send it are shown alongside.
function bill(planKey, texts = 0, emails = 0) {
  const p = PLANS[planKey] || PLANS[DEFAULT_PLAN];
  const cost = Math.round((texts * COST.perTextSegment + emails * COST.perEmail) * 100) / 100;
  return { plan: PLANS[planKey] ? planKey : DEFAULT_PLAN, price: p.price, texts, emails, adminFeePct: p.adminFeePct, sendCost: cost, total: p.price };
}

module.exports = { PLANS, ADMIN_FEE_PCT, COST, DEFAULT_PLAN, planOf, features, usage, bill, monthKey };
