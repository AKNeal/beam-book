// Freshest Unit: Level Up's monthly event. Clients tally for their unit on the shop whiteboard; at the end of the month the
// shop names the winner here. The winning unit gets the prize (20% off) for the month. A unit can only win once a year.
// Store: units:winners [{ month: "2026-11", unit, at, by }] · units:settings { prize, title }
const store = require("./store");
const T = require("./time");

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const norm = (s) => clip(s, 60).toUpperCase().replace(/[^A-Z0-9]/g, "");
const DEFAULTS = { title: "Freshest Unit", prize: "20% off for the month" };

async function settings() { return { ...DEFAULTS, ...((await store.getJSON("units:settings")) || {}) }; }
async function saveSettings(b) {
  const s = { title: clip(b.title, 40) || DEFAULTS.title, prize: clip(b.prize, 120) || DEFAULTS.prize };
  await store.setJSON("units:settings", s); return s;
}
async function winners() { return ((await store.getJSON("units:winners")) || []).sort((a, b) => b.month.localeCompare(a.month)); }

async function setWinner(b, by) {
  const month = String(b.month || ""); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Pick the month.");
  const unit = clip(b.unit, 60); if (unit.length < 2) throw new Error("Enter the unit (for example 354 CES).");
  const list = await winners();
  const dup = list.find((w) => w.month !== month && w.month.slice(0, 4) === month.slice(0, 4) && norm(w.unit) === norm(unit));
  if (dup) throw new Error(`${dup.unit} already won in ${label(dup.month)}. A unit can only win once a year.`);
  const out = [...list.filter((w) => w.month !== month), { month, unit, at: Date.now(), by: by || "" }];
  await store.setJSON("units:winners", out); return winners();
}
async function removeWinner(month) { await store.setJSON("units:winners", (await winners()).filter((w) => w.month !== month)); return winners(); }

function label(month) { return new Date(`${month}-15T12:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }); }

// What the website, the TV and the dashboards show. The current winner is this month's; if it hasn't been named yet,
// the most recent one (shown as last month's champ).
async function publicView(now = Date.now()) {
  const S = await settings(), list = await winners(), month = T.dateKey(now).slice(0, 7);
  const cur = list.find((w) => w.month === month) || null, last = list.find((w) => w.month < month) || null;
  const year = month.slice(0, 4);
  return {
    title: S.title, prize: S.prize, month, monthLabel: label(month),
    current: cur ? { unit: cur.unit, month: cur.month, monthLabel: label(cur.month) } : null,
    previous: last ? { unit: last.unit, month: last.month, monthLabel: label(last.month) } : null,
    past: list.filter((w) => w.month <= month).slice(0, 24).map((w) => ({ unit: w.unit, month: w.month, monthLabel: label(w.month) })),
    wonThisYear: list.filter((w) => w.month.startsWith(year)).map((w) => w.unit),
  };
}

module.exports = { settings, saveSettings, winners, setWinner, removeWinner, publicView, label };
