// Beam Book client list (barbershop mode, works for any shop).
// Each shop's clients live under its own key prefix, like its bookings, so shops never see each other's clients.
//
//   client:<id>          the client's record
//   clients              index of ids, newest visit first (score = last visit or when added)
//   clientkey:p:<digits> phone → id     clientkey:e:<email> → id   (to match bookings and imports to one client)
//   clientwords          search words: "<word>|<id>" (name words and phone digits)
//
// Only what booking needs is kept: name, phone, email, preferred barber, last visit, last service, notes and visits.
// Card details, payment method and tips are never accepted, even if an import file has them.
// Text reminders need the client's OK (textOk). Nothing here ever sends marketing.

const crypto = require("crypto");
const store = require("./store");

const MAX_NOTES = 1000;
const digits = (p) => String(p || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const cleanEmail = (e) => { const x = String(e || "").trim().toLowerCase().slice(0, 120); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x) ? x : ""; };
const s = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const norm = (w) => String(w).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

function words(c) {
  const out = new Set();
  for (const w of String(c.name || "").split(/[\s\-']+/)) { const n = norm(w); if (n) out.add(n); }
  const d = digits(c.phone); if (d.length >= 4) { out.add(`#${d}`); out.add(`#${d.slice(-4)}`); }
  if (c.email) out.add(`@${c.email}`);
  return [...out].map((w) => `${w}|${c.id}`);
}

function keysOf(c) {
  const out = [];
  const d = digits(c.phone); if (d.length >= 7) out.push(`clientkey:p:${d}`);
  if (c.email) out.push(`clientkey:e:${c.email}`);
  return out;
}

const scoreOf = (c) => c.lastVisit || c.createdAt || 0;

// Make a clean record from anything (import row, booking, edit). Unknown fields are dropped.
function clean(input, prev = {}) {
  const c = {
    id: prev.id || crypto.randomBytes(6).toString("hex"),
    name: s(input.name ?? prev.name, 80),
    phone: s(input.phone ?? prev.phone, 30),
    email: input.email !== undefined ? cleanEmail(input.email) : (prev.email || ""),
    barber: s(input.barber ?? prev.barber, 60),
    lastVisit: Number(input.lastVisit ?? prev.lastVisit) || 0,
    lastService: s(input.lastService ?? prev.lastService, 80),
    notes: String(input.notes ?? prev.notes ?? "").trim().slice(0, MAX_NOTES),
    textOk: input.textOk !== undefined ? input.textOk === true : Boolean(prev.textOk),
    textOkAt: prev.textOkAt || null,
    visits: Array.isArray(prev.visits) ? prev.visits : [],
    source: prev.source || input.source || "added",
    createdAt: prev.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  if (c.textOk && !prev.textOk) c.textOkAt = new Date().toISOString();
  if (!c.textOk) c.textOkAt = null;
  return c;
}

function writeOps(c, prev) {
  const ops = [];
  if (prev) {
    for (const k of keysOf(prev)) if (!keysOf(c).includes(k)) ops.push({ del: k });
    for (const w of words(prev)) if (!words(c).includes(w)) ops.push({ lexRem: ["clientwords", w] });
  }
  ops.push({ set: [`client:${c.id}`, c] }, { zadd: ["clients", c.id, scoreOf(c)] });
  for (const k of keysOf(c)) ops.push({ set: [k, c.id] });
  for (const w of words(c)) ops.push({ lexAdd: ["clientwords", w] });
  return ops;
}

const get = (id) => (/^[a-f0-9]{12}$/.test(String(id || "")) ? store.getJSON(`client:${id}`) : null);

// The client with this phone or email, if any.
async function find({ phone, email }) {
  const keys = [];
  const d = digits(phone); if (d.length >= 7) keys.push(`clientkey:p:${d}`);
  const e = cleanEmail(email); if (e) keys.push(`clientkey:e:${e}`);
  for (const id of await store.getMany(keys)) if (id) { const c = await get(id); if (c) return c; }
  return null;
}

async function save(input, prevId = null) {
  const prev = prevId ? await get(prevId) : null;
  if (prevId && !prev) throw new Error("That client isn't on the list any more.");
  const c = clean(input, prev || {});
  if (c.name.length < 2) throw new Error("Enter the client's name.");
  // Don't let an edit take another client's phone or email.
  const other = await find({ phone: c.phone, email: c.email });
  if (other && other.id !== c.id) throw new Error(`${other.name} already has that phone number or email.`);
  await store.batch(writeOps(c, prev));
  return c;
}

async function remove(id) {
  const c = await get(id);
  if (!c) return false;
  await store.batch([{ del: `client:${c.id}` }, { zrem: ["clients", c.id] }, ...keysOf(c).map((k) => ({ del: k })),
    ...words(c).map((w) => ({ lexRem: ["clientwords", w] }))]);
  return true;
}

// Newest first, a page at a time.
async function list({ before = null, limit = 50 } = {}) {
  const ids = before ? await store.indexBefore("clients", before, limit) : await store.indexRange("clients", limit);
  const rows = (await store.getMany(ids.map((id) => `client:${id}`))).filter(Boolean);
  return { clients: rows, next: rows.length === limit ? scoreOf(rows[rows.length - 1]) : null, total: await store.indexCount("clients") };
}

// Search by name, phone (any 4+ digits from the start, or the last 4) or email. Every word must match.
async function search(q, limit = 40) {
  const parts = String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  if (!parts.length) return [];
  let ids = null;
  const exact = new Map(); // id → how many words matched exactly (ranks "Client 3" above "Client 30")
  for (const p of parts) {
    const d = p.replace(/\D/g, "");
    const prefix = p.includes("@") ? `@${p}` : (d.length >= 3 && d.length === p.replace(/[\s().+-]/g, "").length) ? `#${digits(d) || d}` : norm(p);
    if (!prefix) continue;
    const hits = new Set();
    for (const m of await store.lexPrefix("clientwords", prefix, 5000)) {
      const i = m.lastIndexOf("|"), w = m.slice(0, i), id = m.slice(i + 1);
      hits.add(id);
      if (w === prefix) exact.set(id, (exact.get(id) || 0) + 1);
    }
    ids = ids ? new Set([...ids].filter((x) => hits.has(x))) : hits;
    if (!ids.size) break;
  }
  const ranked = [...(ids || [])].sort((a, b) => (exact.get(b) || 0) - (exact.get(a) || 0)).slice(0, 300);
  const found = (await store.getMany(ranked.map((id) => `client:${id}`))).filter(Boolean);
  return found.sort((a, b) => (exact.get(b.id) || 0) - (exact.get(a.id) || 0) || scoreOf(b) - scoreOf(a)).slice(0, limit);
}

// Import a batch of rows (already stripped of payment details by the browser; stripped again here).
// Rows matching an existing client by phone or email are merged: newer visit wins, notes are kept, nothing is lost.
async function importRows(rows, { textOk = false } = {}) {
  if (!Array.isArray(rows)) throw new Error("Nothing to import.");
  if (rows.length > 500) throw new Error("Send at most 500 clients at a time.");
  const result = { added: 0, merged: 0, skipped: 0 };
  const clean_ = rows.map((r) => ({
    name: s(r.name, 80), phone: s(r.phone, 30), email: cleanEmail(r.email), barber: s(r.barber, 60),
    lastVisit: Number(r.lastVisit) || 0, lastService: s(r.lastService, 80), notes: String(r.notes || "").trim().slice(0, MAX_NOTES),
  }));
  // Look up every phone and email in one round trip.
  const lookKeys = clean_.flatMap((r) => keysOf({ phone: r.phone, email: r.email }));
  const found = new Map(lookKeys.map((k, i) => [k, null]));
  const vals = await store.getMany([...found.keys()]);
  [...found.keys()].forEach((k, i) => found.set(k, vals[i]));
  const existingIds = [...new Set(vals.filter(Boolean))];
  const existing = new Map((await store.getMany(existingIds.map((id) => `client:${id}`))).filter(Boolean).map((c) => [c.id, c]));

  const ops = [];
  const seenThisBatch = new Map(); // key → client, so duplicates inside one file merge too
  for (const r of clean_) {
    if (r.name.length < 2 || (!digits(r.phone) && !r.email)) { result.skipped++; continue; }
    const ks = keysOf(r);
    let prev = null;
    for (const k of ks) { prev = seenThisBatch.get(k) || existing.get(found.get(k)) || null; if (prev) break; }
    let c;
    if (prev) {
      const newer = r.lastVisit > (prev.lastVisit || 0);
      c = clean({
        name: prev.name || r.name, phone: prev.phone || r.phone, email: prev.email || r.email,
        barber: newer && r.barber ? r.barber : (prev.barber || r.barber),
        lastVisit: Math.max(r.lastVisit, prev.lastVisit || 0),
        lastService: newer && r.lastService ? r.lastService : (prev.lastService || r.lastService),
        notes: [prev.notes, r.notes].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join("\n").slice(0, MAX_NOTES),
        textOk: prev.textOk || textOk,
      }, prev);
      result.merged++;
    } else {
      c = clean({ ...r, textOk, source: "import" });
      result.added++;
    }
    for (const k of keysOf(c)) seenThisBatch.set(k, c);
    existing.set(c.id, c);
  }
  for (const c of new Set(seenThisBatch.values())) ops.push(...writeOps(c, null));
  await store.batch(ops);
  return result;
}

// Remove every client (Owner only — e.g. to undo an import).
async function removeAll() {
  let n = 0;
  for (;;) {
    const ids = await store.indexRange("clients", 300);
    if (!ids.length) return n;
    const cs = (await store.getMany(ids.map((id) => `client:${id}`)));
    const ops = [];
    ids.forEach((id, i) => {
      const c = cs[i];
      ops.push({ del: `client:${id}` }, { zrem: ["clients", id] });
      if (c) { ops.push(...keysOf(c).map((k) => ({ del: k })), ...words(c).map((w) => ({ lexRem: ["clientwords", w] }))); }
    });
    await store.batch(ops);
    n += ids.length;
  }
}

// A booking happened: find or create the client, and add the visit. Returns the client.
async function recordVisit({ name, phone, email, textOk, barber, service, at, apptId, requestId }) {
  const prev = await find({ phone, email });
  const visit = { at, service: s(service, 80), barber: s(barber, 60), apptId: apptId || null, requestId: requestId || null };
  const base = prev || {};
  const c = clean({
    name: prev ? prev.name : name, phone: (prev && prev.phone) || phone, email: (prev && prev.email) || email,
    barber: barber || base.barber, textOk: textOk === true ? true : Boolean(base.textOk), source: prev ? undefined : "booking",
  }, base);
  c.visits = [visit, ...(c.visits || [])].slice(0, 100);
  // "Last visit" is a visit that has already happened; upcoming ones show under visits.
  if (at <= Date.now()) { c.lastVisit = Math.max(c.lastVisit || 0, at); c.lastService = visit.service || c.lastService; }
  await store.batch(writeOps(c, prev));
  return c;
}

async function dropVisit(clientId, apptId) {
  const c = await get(clientId);
  if (!c) return;
  c.visits = (c.visits || []).filter((v) => v.apptId !== apptId);
  await store.setJSON(`client:${c.id}`, c);
}

module.exports = { get, find, save, remove, list, search, importRows, removeAll, recordVisit, dropVisit, digits };
