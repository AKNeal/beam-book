// Beam plans (what each shop pays Neal Media for) and the features each one switches on.
// Prices and allowances match the "Neal Media Client Plans & Internal Costs" doc; change both together.
//   core     $150/mo  website, booking, reminders and confirmations by text and email
//   shop     $199/mo  + clients book, move and cancel by text (menu), staff dashboards, shop display
//   shop_ai  $249/mo  + an AI agent answers texts in plain language and books through the same rules
// Texts over the allowance are billed at OVERAGE_PER_TEXT. Usage is counted per shop per month (lib/sms.js).

const PLANS = {
  core: { label: "Core", price: 150, texts: 500, textBooking: false, ai: false },
  shop: { label: "Shop", price: 199, texts: 2000, textBooking: true, ai: false },
  shop_ai: { label: "Shop AI", price: 249, texts: 3500, textBooking: true, ai: true },
};
const OVERAGE_PER_TEXT = 0.03;
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

// What to bill for a month: plan price + texts over the allowance.
function bill(planKey, texts) {
  const p = PLANS[planKey] || PLANS[DEFAULT_PLAN];
  const over = Math.max(0, texts - p.texts);
  return { plan: planKey, price: p.price, allowance: p.texts, texts, overTexts: over, overage: Math.round(over * OVERAGE_PER_TEXT * 100) / 100,
    total: Math.round((p.price + over * OVERAGE_PER_TEXT) * 100) / 100 };
}

module.exports = { PLANS, OVERAGE_PER_TEXT, DEFAULT_PLAN, planOf, features, usage, bill, monthKey };
