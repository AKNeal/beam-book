// Shop dashboard numbers, the barber scoreboard and rebooking challenges, worked out from the shop's own calendar.
//
// Money: an appointment's price is its booked service price (shop-made appointments are matched to a service by title).
//   Past appointments count as earned; future ones as projected. Payment method isn't recorded (the shop keeps its own
//   card reader), so cash discounts and card fees use the shop's own cash share (Dashboard settings).
//   Net = gross − cash discounts − card fees − barber pay (+ booth rent coming in) − shop expenses (monthly, spread by day).
// Rebooks: a finished visit is "rebooked" when the same client's NEXT appointment was booked between the start of that
//   visit and `rebookWindowHours` after it ended (default 24 h: booked in the chair or the next day).
// Challenges: the owner sets a metric (rebook rate, rebooks, cuts or new clients), dates, a goal, who's in it
//   (each barber, or the shop as a team) and an optional prize. Progress is worked out live from the same numbers.

const config = require("../config/studio");
const store = require("./store");
const cal = require("./calendar");
const artists = require("./artists");
const T = require("./time");

const DAY = 864e5;
const DEFAULTS = { cashShare: 30, cashDiscount: 5, cardPct: 2.7, cardFixed: 0.05, feesPassedToClient: true,
  expenses: [], rebookWindowHours: 24, weeklyGoalCuts: 0, monthlyGoal: 0 };

async function settings() { return { ...DEFAULTS, ...((await store.getJSON("dash:settings")) || {}) }; }
async function saveSettings(b) {
  const cur = await settings(), num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
  const next = { ...cur };
  if (b.cashShare !== undefined) next.cashShare = num(b.cashShare, 0, 100, cur.cashShare);
  if (b.cashDiscount !== undefined) next.cashDiscount = num(b.cashDiscount, 0, 100, cur.cashDiscount);
  if (b.cardPct !== undefined) next.cardPct = num(b.cardPct, 0, 10, cur.cardPct);
  if (b.cardFixed !== undefined) next.cardFixed = num(b.cardFixed, 0, 2, cur.cardFixed);
  if (b.feesPassedToClient !== undefined) next.feesPassedToClient = Boolean(b.feesPassedToClient);
  if (b.rebookWindowHours !== undefined) next.rebookWindowHours = num(b.rebookWindowHours, 1, 24 * 14, cur.rebookWindowHours);
  if (b.weeklyGoalCuts !== undefined) next.weeklyGoalCuts = Math.round(num(b.weeklyGoalCuts, 0, 5000, 0));
  if (b.monthlyGoal !== undefined) next.monthlyGoal = Math.round(num(b.monthlyGoal, 0, 10000000, 0));
  if (b.expenses !== undefined) next.expenses = (Array.isArray(b.expenses) ? b.expenses : []).slice(0, 30)
    .map((x) => ({ name: String(x.name || "").trim().slice(0, 60), monthly: num(x.monthly, 0, 1000000, 0) })).filter((x) => x.name);
  await store.setJSON("dash:settings", next);
  return next;
}

// Each barber's pay: {model:"commission", rate:50} | {model:"booth", weeklyRent:250} | {model:"owner"}.
async function pay() { return (await store.getJSON("dash:pay")) || {}; }
async function savePay(slug, p) {
  const all = await pay(), model = ["commission", "booth", "owner", "hourly"].includes(p?.model) ? p.model : "commission";
  all[slug] = { model, ...(model === "commission" ? { rate: Math.min(100, Math.max(0, Number(p.rate) || 0)) } : {}),
    ...(model === "booth" ? { weeklyRent: Math.max(0, Number(p.weeklyRent) || 0) } : {}) };
  await store.setJSON("dash:pay", all);
  return all;
}

// ---------- the raw visits ----------
const serviceByTitle = (title) => (config.services || []).find((s) => s.name.toLowerCase() === String(title || "").toLowerCase());

// Every appointment from `from` to `to` (plus 120 days after, so rebooks can be seen), with price, client and barber.
async function visits(from, to) {
  const roster = await artists.list();
  const appts = [];
  for (const a of roster) for (const x of await cal.apptsBetween(a.slug, from, to + 120 * DAY)) appts.push(x);
  const reqIds = [...new Set(appts.map((x) => x.requestId).filter(Boolean))];
  const reqs = new Map((await store.getMany(reqIds.map((id) => `req:${id}`))).filter(Boolean).map((r) => [r.id, r]));
  const paid = new Map(); { const ids = appts.map((x) => x.id); const recs = await store.getMany(ids.map((i) => `pay:appt:${i}`)); ids.forEach((i, n) => recs[n] && paid.set(i, recs[n])); }
  const hist = await require("./squirehist").load(from, to + 120 * DAY), usedHist = new Set();
  const histPaid = (e, price) => (e && e.s === "done" && e.m ? { method: e.m, subtotal: e.p ?? price, discount: 0, tip: e.t || 0, surcharge: 0, total: (e.p ?? price) + (e.t || 0), source: "squire" } : null);
  const list = appts.filter((x) => !x.pending).map((x) => {
    const r = x.requestId ? reqs.get(x.requestId) : null;
    if (r && ["declined", "cancelled"].includes(r.status)) return null;
    const svc = r?.service || serviceByTitle(x.title);
    const name = (r?.client?.name || x.clientName || "").trim();
    return { id: x.id, barber: x.artist, start: x.start, end: x.end, mins: x.durationMin || Math.round((x.end - x.start) / 6e4),
      // Imported (Squire) visits: when they were booked isn't known.
      createdAt: r ? Date.parse(r.createdAt) || x.createdAt : x.source === "squire" ? null : x.createdAt || x.start,
      price: x.price != null ? Number(x.price) || 0 : Number(svc?.price) || 0, service: svc?.name || x.title || "",
      client: r?.clientId ? `id:${r.clientId}` : r?.client?.phone ? `ph:${String(r.client.phone).replace(/\D/g, "").slice(-10)}` : name ? `nm:${name.toLowerCase()}` : null,
      source: x.source || "shop", paid: paid.get(x.id) || null, name };
  }).filter(Boolean);
  // Squire history (CSV export): when each imported visit was booked, how it was paid, and visits older than the calendar import.
  if (hist.size) {
    const out = [];
    for (const v of list) {
      const k = `${v.barber}|${v.start}`, e = v.source === "squire" ? hist.get(k) : null;
      if (e) { usedHist.add(k); if (e.s === "cancelled" || e.s === "noshow") continue; if (e.c) v.createdAt = e.c; if (!v.paid) v.paid = histPaid(e, v.price); }
      out.push(v);
    }
    for (const [k, e] of hist) {
      if (usedHist.has(k) || e.s !== "done") continue;
      const [barber, st] = k.split("|"), start = Number(st), price = e.p ?? 0;
      out.push({ id: `sq-${barber}-${start}`, barber, start, end: start + e.d * 6e4, mins: e.d, createdAt: e.c || null, price, service: e.sv || "",
        client: e.cn ? `nm:${e.cn.toLowerCase()}` : null, source: "squire", paid: histPaid(e, price), name: e.cn || "" });
    }
    return out;
  }
  return list;
}

// No-shows and cancellations from Squire history in [from, to).
async function missed(from, to, who = null) {
  const hist = await require("./squirehist").load(from, to); let noShows = 0, cancelled = 0;
  for (const [k, e] of hist) { if (who && !k.startsWith(who + "|")) continue; if (e.s === "noshow") noShows++; else if (e.s === "cancelled") cancelled++; }
  return { noShows, cancelled };
}

// Mark each finished visit rebooked or not; also whether it was the client's first visit ever seen.
function markRebooks(all, windowHours, now) {
  const byClient = new Map();
  for (const v of all) if (v.client) (byClient.get(v.client) || byClient.set(v.client, []).get(v.client)).push(v);
  for (const list of byClient.values()) list.sort((a, b) => a.start - b.start);
  for (const v of all) {
    v.done = v.end <= now;
    if (!v.client) { v.rebooked = null; continue; }
    const list = byClient.get(v.client), i = list.indexOf(v), next = list.slice(i + 1).find((n) => n.start >= v.end);
    // Not judged: not finished yet; the next visit's booking time is unknown (imported); or an imported visit with no next visit.
    v.rebooked = !v.done ? null : next ? (next.createdAt == null ? null : next.createdAt >= v.start - 6e4 && next.createdAt <= v.end + windowHours * 3600e3)
      : v.createdAt == null ? null : false;
    v.firstSeen = i === 0;
  }
}

// ---------- periods ----------
function range(p, now = Date.now()) {
  const t = T.parts(now), today = T.toUtc(t.y, t.m, t.d, 0, 0);
  if (p === "today") return [today, today + DAY];
  if (p === "week") { const off = (t.wd + 6) % 7; return [today - off * DAY, today + (7 - off) * DAY]; } // Monday start
  if (p === "month") { const n = t.m === 12 ? { y: t.y + 1, m: 1 } : { y: t.y, m: t.m + 1 }; return [T.toUtc(t.y, t.m, 1, 0, 0), T.toUtc(n.y, n.m, 1, 0, 0)]; }
  if (p === "next30") return [now, now + 30 * DAY];
  if (p === "last30") return [now - 30 * DAY, now];
  return [today, today + DAY];
}

// ---------- the numbers ----------
function money(list, S, payMap, days, slugs) {
  const cashP = S.cashShare / 100, out = { gross: 0, earned: 0, projected: 0, disc: 0, card: 0, pay: 0, booth: 0, expenses: 0 };
  for (const v of list) {
    const p = payMap[v.barber] || { model: "commission", rate: 50 }; // not set yet: 50% commission
    // Paid through Beam's checkout: the real method, discount, card fee (less what the client paid toward it) and tip.
    // Otherwise: estimated from the shop's cash share.
    const R = v.paid, price = R ? R.subtotal : v.price;
    const disc = R ? R.discount : S.cashDiscount * cashP;
    const cardCost = R ? (R.method === "card" ? (R.total * S.cardPct / 100 + S.cardFixed) - (R.surcharge || 0) : 0) : (price * S.cardPct / 100 + S.cardFixed) * (1 - cashP);
    const card = S.feesPassedToClient && !R ? 0 : Math.max(0, cardCost), collected = price - disc;
    if (R) { out.tips = (out.tips || 0) + (R.tip || 0); out.paidCash = (out.paidCash || 0) + (R.method === "cash" ? 1 : 0); out.paidCard = (out.paidCard || 0) + (R.method === "card" ? 1 : 0); }
    out.gross += price; out[v.done || R ? "earned" : "projected"] += price; out.disc += disc; out.card += card;
    if (p.model === "commission") out.pay += collected * (p.rate || 0) / 100;
    else if (p.model === "booth") out.pay += collected;
  }
  for (const s of slugs) if (payMap[s]?.model === "booth") out.booth += (payMap[s].weeklyRent || 0) * days / 7;
  out.expenses = (S.expenses || []).reduce((a, x) => a + x.monthly, 0) * days / 30.44;
  out.net = out.gross - out.disc - out.card - out.pay + out.booth - out.expenses;
  out.take = out.pay - out.booth; // a barber's own take: commission, or sales less booth rent
  for (const k in out) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}

function counts(list) {
  const done = list.filter((v) => v.done), rb = done.filter((v) => v.rebooked !== null);
  return { cuts: list.length, done: done.length, upcoming: list.length - done.length, mins: list.reduce((a, v) => a + v.mins, 0),
    rebooks: rb.filter((v) => v.rebooked).length, rebookable: rb.length, rebookRate: rb.length ? Math.round(1000 * rb.filter((v) => v.rebooked).length / rb.length) / 10 : null,
    newClients: list.filter((v) => v.firstSeen).length };
}

// The dashboard for [from, to). who = null (whole shop) or a barber's slug (their own view).
// Open chair minutes for one barber in [from, to): their weekly hours, less full blocked days.
async function openMinutes(slug, from, to) {
  const S = await cal.getSettings(slug).catch(() => null); if (!S) return 0;
  const blocks = await cal.getBlocks(slug).catch(() => []);
  let mins = 0;
  for (let d = from; d < to; d += DAY) {
    const p = T.parts(d + 12 * 3600e3), h = S.hours[p.wd];
    if (!h) continue;
    if (blocks.some((b) => b.allDay && b.start <= d + 12 * 3600e3 && b.end > d + 12 * 3600e3)) continue;
    const o = T.parseHM(h.open), c = T.parseHM(h.close); mins += (c.h * 60 + c.mi) - (o.h * 60 + o.mi);
  }
  return mins;
}

// Clients whose last visit was in the last `days` days (and past the rebook window), with nothing booked. Oldest first.
function needsRebook(all, now, days = 21, who = null, graceHours = 24) {
  const last = new Map(), future = new Set();
  for (const v of all) { if (!v.client) continue; if (v.start > now) { future.add(v.client); continue; }
    const cur = last.get(v.client); if (!cur || v.start > cur.start) last.set(v.client, v); }
  return [...last.entries()].filter(([k, v]) => !future.has(k) && v.end <= now - graceHours * 3600e3 && v.start >= now - days * DAY && (!who || v.barber === who))
    .map(([, v]) => ({ name: v.name || "Client", barber: v.barber, last: v.start, service: v.service, daysAgo: Math.floor((now - v.start) / DAY) }))
    .sort((a, b) => a.last - b.last).slice(0, 40);
}

async function dashboard({ from, to, who = null, withMoney = true, now = Date.now() }) {
  const S = await settings(), payMap = await pay(), roster = await artists.list();
  const all = await visits(from - 60 * DAY, to); // a little history so first visits and rebooks are judged right
  markRebooks(all, S.rebookWindowHours, now);
  const inRange = all.filter((v) => v.start >= from && v.start < to);
  const mine = who ? inRange.filter((v) => v.barber === who) : inRange;
  const days = (to - from) / DAY;
  const barbers = roster.filter((a) => !who || a.slug === who).map((a) => {
    const l = inRange.filter((v) => v.barber === a.slug), c = counts(l);
    return { slug: a.slug, name: a.name, ...c, ...(withMoney ? { money: money(l, S, payMap, days, [a.slug]), pay: payMap[a.slug] || null } : {}) };
  });
  const svc = new Map(); for (const v of mine) { const s = svc.get(v.service) || { name: v.service, count: 0, gross: 0 }; s.count++; s.gross += v.price; svc.set(v.service, s); }
  const heat = {}; for (const v of all.filter((x) => x.done && x.start >= now - 56 * DAY && (!who || x.barber === who))) {
    const p = T.parts(v.start), k = `${p.wd}-${p.h}`; heat[k] = (heat[k] || 0) + 1; }
  // Chair utilization: booked minutes against the barbers' open hours in the period.
  let openMins = 0; for (const a of roster.filter((x) => !who || x.slug === who)) openMins += await openMinutes(a.slug, from, to);
  const bookedMins = mine.reduce((a, v) => a + v.mins, 0);
  const extra = { openMins, utilization: openMins ? Math.min(100, Math.round(1000 * bookedMins / openMins) / 10) : null,
    avgTicket: mine.length ? Math.round(100 * mine.reduce((a, v) => a + (v.paid ? v.paid.subtotal : v.price), 0) / mine.length) / 100 : null,
    needsRebook: needsRebook(all, now, 21, who, S.rebookWindowHours),
    names: Object.fromEntries(roster.map((a) => [a.slug, a.name])) };
  const ms = await missed(from, Math.min(to, now), who);
  extra.noShows = ms.noShows; extra.cancelled = ms.cancelled;
  const doneN = mine.filter((v) => v.end <= now).length;
  extra.noShowRate = ms.noShows + doneN && (ms.noShows || ms.cancelled) ? Math.round(1000 * ms.noShows / (ms.noShows + doneN)) / 10 : null;
  const daily = []; for (let d = from; d < to && daily.length < 62; d += DAY) {
    const l = mine.filter((v) => v.start >= d && v.start < d + DAY);
    daily.push({ date: T.dateKey(d + 12 * 3600e3), cuts: l.length, gross: l.reduce((a, v) => a + v.price, 0), past: d + DAY <= now }); }
  return { from, to, who, ...counts(mine), ...extra, ...(withMoney ? { money: money(mine, S, payMap, days, who ? [who] : roster.map((a) => a.slug)) } : {}),
    barbers, services: [...svc.values()].sort((a, b) => b.gross - a.gross).slice(0, 12), heat, daily, settings: withMoney ? S : undefined };
}

// ---------- week by week: trend, each week's rebook winner, and this week's rebooks ----------
// Weeks start Monday. A winner needs at least `minVisits` judged visits that week (so one lucky cut doesn't win).
async function weekly({ weeks = 8, who = null, now = Date.now(), minVisits = 5 } = {}) {
  const S = await settings(), roster = await artists.list({ publicOnly: true });
  const [ws] = range("week", now), from = ws - (weeks - 1) * 7 * DAY;
  const all = await visits(from - 60 * DAY, ws + 7 * DAY); markRebooks(all, S.rebookWindowHours, now);
  const out = [];
  for (let a = from; a <= ws; a += 7 * DAY) {
    const l = all.filter((v) => v.start >= a && v.start < a + 7 * DAY && (!who || v.barber === who)), k = counts(l);
    const per = roster.map((b) => { const c = counts(l.filter((v) => v.barber === b.slug)); return { slug: b.slug, name: b.name, rebookRate: c.rebookRate, rebooks: c.rebooks, visits: c.rebookable, cuts: c.cuts }; });
    const elig = per.filter((x) => x.visits >= minVisits).sort((x, y) => (y.rebookRate - x.rebookRate) || (y.rebooks - x.rebooks));
    out.push({ week: T.dateKey(a + 12 * 3600e3), current: a === ws, cuts: k.cuts, done: k.done, rebooks: k.rebooks, rebookable: k.rebookable, rebookRate: k.rebookRate,
      winner: !who && a < ws && elig[0] ? { name: elig[0].name, rebookRate: elig[0].rebookRate, rebooks: elig[0].rebooks, visits: elig[0].visits } : null,
      barbers: who ? undefined : per.filter((x) => x.cuts) });
  }
  // This week's rebooks: who rebooked whom, and for when
  const byClient = new Map(); for (const v of all) if (v.client) (byClient.get(v.client) || byClient.set(v.client, []).get(v.client)).push(v);
  const names = Object.fromEntries((await artists.list()).map((a) => [a.slug, a.name]));
  const rebooks = all.filter((v) => v.start >= ws && v.start < ws + 7 * DAY && v.rebooked === true && (!who || v.barber === who)).sort((a, b) => b.start - a.start).slice(0, 60).map((v) => {
    const next = (byClient.get(v.client) || []).filter((n) => n.start >= v.end).sort((a, b) => a.start - b.start)[0];
    return { client: v.name || "Client", barber: names[v.barber] || v.barber, on: T.dateKey(v.start), next: next ? T.dateKey(next.start) : null };
  });
  return { weeks: out, rebooks, minVisits };
}

// ---------- challenges ----------
const METRICS = { rebookRate: "Rebook rate", rebooks: "Rebooks", cuts: "Cuts", newClients: "New clients" };
async function challenges() { return (await store.getJSON("dash:challenges")) || []; }
async function saveChallenge(b) {
  const list = await challenges(), id = String(b.id || "") || require("crypto").randomBytes(5).toString("hex");
  const title = String(b.title || "").trim().slice(0, 80); if (title.length < 2) throw new Error("Give the challenge a name.");
  if (!METRICS[b.metric]) throw new Error("Pick what the challenge measures.");
  const start = T.parseDate(String(b.startDate || "")), end = T.parseDate(String(b.endDate || ""));
  if (!start || !end) throw new Error("Pick a start and end date.");
  const startDate = T.keyOf(start), endDate = T.keyOf(end); if (endDate < startDate) throw new Error("The end date is before the start.");
  const goal = Number(b.goal); if (!(goal > 0) || (b.metric === "rebookRate" && goal > 100)) throw new Error(b.metric === "rebookRate" ? "Goal: a rebook rate from 1 to 100%." : "Goal: a number above 0.");
  const c = { id, title, metric: b.metric, scope: b.scope === "shop" ? "shop" : "barbers", startDate, endDate, goal,
    prize: String(b.prize || "").trim().slice(0, 120), barbers: Array.isArray(b.barbers) ? b.barbers.map(String).slice(0, 40) : [], createdAt: list.find((x) => x.id === id)?.createdAt || Date.now() };
  await store.setJSON("dash:challenges", [...list.filter((x) => x.id !== id), c].sort((a, z) => a.startDate.localeCompare(z.startDate)));
  return c;
}
// Rebooks a barber adds by hand (the floating button): counted on top of the ones Beam detects.
async function manualAdds(id) { return (await store.getJSON(`dash:chadds:${id}`)) || []; }
async function addRebook(id, slug, by, undo = false) {
  const l = await manualAdds(id);
  if (undo) { const i = l.map((x) => x.slug).lastIndexOf(slug); if (i < 0) throw new Error("Nothing to undo."); l.splice(i, 1); }
  else { if (l.filter((x) => x.slug === slug && x.at > Date.now() - 5000).length) throw new Error("Got it. Tap again in a few seconds for another."); l.push({ slug, at: Date.now(), by }); }
  await store.setJSON(`dash:chadds:${id}`, l.slice(-5000));
}
async function deleteChallenge(id) { await store.setJSON("dash:challenges", (await challenges()).filter((x) => x.id !== id)); }

// Live standings for every challenge that hasn't ended more than a week ago.
async function standings({ now = Date.now() } = {}) {
  const list = (await challenges()).filter((c) => T.toUtc(...Object.values(T.parseDate(c.endDate)), 0, 0) + 8 * DAY > now);
  if (!list.length) return [];
  const S = await settings(), roster = await artists.list({ publicOnly: true });
  const from = Math.min(...list.map((c) => { const d = T.parseDate(c.startDate); return T.toUtc(d.y, d.m, d.d, 0, 0); }));
  const all = await visits(from - 60 * DAY, now + DAY); markRebooks(all, S.rebookWindowHours, now);
  const adds = {}; for (const c of list) adds[c.id] = await manualAdds(c.id);
  return list.map((c) => {
    const s = T.parseDate(c.startDate), e = T.parseDate(c.endDate), a = T.toUtc(s.y, s.m, s.d, 0, 0), z = T.toUtc(e.y, e.m, e.d, 0, 0) + DAY;
    const l = all.filter((v) => v.start >= a && v.start < Math.min(z, now));
    // hand-added rebooks count as rebooks (and toward the rate, against at least that many visits)
    const added = (slugs) => (adds[c.id] || []).filter((x) => x.at >= a && x.at < z && slugs.includes(x.slug)).length;
    const val = (x, slugs) => { const k = counts(x), m = added(slugs);
      if (c.metric === "rebooks") return k.rebooks + m;
      if (c.metric === "rebookRate") { const rb = k.rebooks + m, den = Math.max(k.rebookable, rb); return den ? Math.round(100 * rb / den) : 0; }
      return k[c.metric]; };
    const people = roster.filter((b) => !c.barbers.length || c.barbers.includes(b.slug));
    const rows = people.map((b) => { const x = l.filter((v) => v.barber === b.slug), k = counts(x), m = added([b.slug]), v = val(x, [b.slug]);
      return { slug: b.slug, name: b.name, value: v, rebooks: k.rebooks + m, added: m, visits: k.rebookable, pct: Math.min(100, Math.round(100 * v / c.goal)) }; })
      .sort((p, q) => q.value - p.value);
    const team = c.scope === "shop" ? val(l.filter((v) => people.some((b) => b.slug === v.barber)), people.map((b) => b.slug)) : null;
    const status = now < a ? "upcoming" : now >= z ? "ended" : "live";
    return { ...c, label: METRICS[c.metric], status, daysLeft: Math.max(0, Math.ceil((z - now) / DAY)), rows,
      team: team === null ? null : { value: team, pct: Math.min(100, Math.round(100 * team / c.goal)) },
      leader: rows[0] && rows[0].value > 0 ? rows[0].name : null };
  });
}

// ---------- the public scoreboard (shop TV): no money, a private link ----------
async function boardToken(reset = false) {
  let t = await store.getJSON("dash:boardToken");
  if (!t || reset) { t = require("crypto").randomBytes(15).toString("base64url"); await store.setJSON("dash:boardToken", t); }
  return t;
}
async function scoreboard({ now = Date.now() } = {}) {
  const [ws, we] = range("week", now), S = await settings();
  const d = await dashboard({ from: ws, to: we, withMoney: false, now });
  const t = T.parts(now), today = T.toUtc(t.y, t.m, t.d, 0, 0);
  const roster = await artists.list({ publicOnly: true });
  const chairs = [];
  for (const a of roster) {
    const l = await cal.apptsBetween(a.slug, today, today + DAY);
    const cur = l.find((x) => x.start <= now && x.end > now);
    const { days } = await cal.openSlots(a.slug, 30).catch(() => ({ days: [] }));
    const next = (days.find((x) => x.date === T.dateKey(now)) || { slots: [] }).slots.find((sl) => sl.start > now);
    chairs.push({ name: a.name, busy: Boolean(cur), doneToday: l.filter((x) => x.end <= now).length, nextOpen: next ? next.label : null });
  }
  return { shop: config.studio.name, week: { cuts: d.cuts, rebookRate: d.rebookRate, goal: S.weeklyGoalCuts || null },
    leaders: d.barbers.filter((b) => roster.some((r) => r.slug === b.slug)).map((b) => ({ name: b.name, cuts: b.cuts, rebookRate: b.rebookRate, rebooks: b.rebooks, newClients: b.newClients, hours: Math.round(b.mins / 6) / 10 })),
    challenges: (await standings({ now })).filter((c) => c.status !== "ended").map(({ prize, ...c }) => ({ ...c, prize })), chairs, at: now };
}

module.exports = { settings, saveSettings, pay, savePay, visits, markRebooks, range, dashboard, challenges, saveChallenge, deleteChallenge,
  standings, boardToken, scoreboard, weekly, addRebook, needsRebook, METRICS, DEFAULTS };
