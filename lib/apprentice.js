// Apprentice portal (barbershops): an apprentice logs their hours toward the state requirement, works through the
// course modules and the shop's practical checkoffs, and reads the course materials. The Owner / Administrator signs
// off hours and checkoffs, and edits the checklist and materials.
//
// Store:
//   appr:list           [slug, ...]            team members who are apprentices
//   appr:settings       { goalHours }          shop-wide (default 1,650: Alaska's barber apprenticeship hours)
//   appr:checklist      [{id, title, group}]   the shop's checkoffs (starts with the 8 course modules)
//   appr:materials      [{id, title, url}]     links to course materials
//   appr:<slug>         { startDate, hours:[{id, date, hours, note, status, by, at}], checks:{id:{at, by}} }
//   appr:apps           [{id, at, first, last, email, phone, about, status}]   applications from the public /apply page
//   appr:files:<slug>   [{id, kind, label, name, filename, type, size, at, by}]  paperwork the shop uploaded (already filled out, scanned)

const crypto = require("crypto");
const store = require("./store");
const T = require("./time");

const id = () => crypto.randomBytes(5).toString("hex");
const line = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const DEFAULT_GOAL = 1650;
const MODULES = [
  "Professional Foundations, Alaska Law & Business", "Infection Control, Safety & Sanitation", "Anatomy, Physiology & Trichology",
  "Barbering Chemistry & Product Science", "Tools, Implements & Equipment", "Hair Care & Hair Design", "Shaving & Facial Hair Design", "Chemical Services",
].map((t, i) => ({ id: `m${i + 1}`, title: `Volume ${i + 1}: ${t}`, group: "Course modules" }));
// Practical skills: the apprentice logs supervised reps, the instructor approves them, then marks the skill Qualified.
// Starting numbers only; the shop sets its own under "Hours, tasks and materials".
const TASKS = [
  ["Sanitation & disinfection of station and tools", 10], ["Shampoo & scalp treatment", 20], ["Clipper cut", 50], ["Shear cut", 40],
  ["Fade / taper", 50], ["Beard trim & shaping", 30], ["Lineup / edge-up", 30], ["Straight-razor shave", 15], ["Facial", 10],
  ["Hair color", 10], ["Chemical texture (perm / relaxer)", 5], ["Client consultation", 20],
].map(([t, n], i) => ({ id: `t${i + 1}`, title: t, group: "Qualified tasks", target: n }));

async function list() { return (await store.getJSON("appr:list")) || []; }
async function setApprentice(slug, on) {
  const l = new Set(await list()); on ? l.add(slug) : l.delete(slug);
  await store.setJSON("appr:list", [...l]);
  if (on && !(await store.getJSON(`appr:${slug}`))) await store.setJSON(`appr:${slug}`, { startDate: T.dateKey(Date.now()), hours: [], checks: {} });
  return [...l];
}
async function settings() { return { goalHours: DEFAULT_GOAL, ...((await store.getJSON("appr:settings")) || {}) }; }
async function checklist() { return (await store.getJSON("appr:checklist")) || [...MODULES, ...TASKS]; }
async function materials() { return (await store.getJSON("appr:materials")) || []; }

async function record(slug) { const r = (await store.getJSON(`appr:${slug}`)) || { startDate: null, hours: [], checks: {} }; r.reps = r.reps || {}; return r; }

async function view(slug) {
  const [r, S, C, M] = [await record(slug), await settings(), await checklist(), await materials()];
  const approved = r.hours.filter((h) => h.status === "approved").reduce((a, h) => a + h.hours, 0);
  const theory = r.hours.filter((h) => h.status === "approved" && h.kind === "theory").reduce((a, h) => a + h.hours, 0);
  const pending = r.hours.filter((h) => h.status === "pending").reduce((a, h) => a + h.hours, 0);
  const done = C.filter((c) => r.checks[c.id]).length;
  return { slug, startDate: r.startDate, goalHours: S.goalHours, approvedHours: Math.round(approved * 100) / 100, pendingHours: Math.round(pending * 100) / 100,
    pct: Math.min(100, Math.round(1000 * approved / S.goalHours) / 10),
    theoryHours: Math.round(theory * 100) / 100, practicalHours: Math.round((approved - theory) * 100) / 100,
    permit: r.permit || "", appId: r.appId || "", email: r.email || "", phone: r.phone || "",
    reps: Object.fromEntries(Object.entries(r.reps).map(([k, l]) => [k, [...l].sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at)])),
    hours: [...r.hours].sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at),
    checklist: C.map((c) => ({ ...c, done: Boolean(r.checks[c.id]), at: r.checks[c.id]?.at || null, by: r.checks[c.id]?.by || "",
      repsApproved: (r.reps[c.id] || []).filter((x) => x.status === "approved").length, repsPending: (r.reps[c.id] || []).filter((x) => x.status === "pending").length })),
    checksDone: done, checksTotal: C.length, materials: M };
}

async function logHours(slug, b, by) {
  const date = T.parseDate(String(b.date || "")); if (!date) throw new Error("Pick the date you worked.");
  const key = T.keyOf(date); if (key > T.dateKey(Date.now() + 864e5)) throw new Error("That date is in the future.");
  const hours = Math.round(Number(b.hours) * 4) / 4; if (!(hours > 0 && hours <= 16)) throw new Error("Hours: between 0.25 and 16 for one day.");
  const r = await record(slug);
  r.hours.push({ id: id(), date: key, hours, kind: b.kind === "theory" ? "theory" : "practical", note: line(b.note, 300), status: b.approved ? "approved" : "pending", by: b.approved ? by : "", at: Date.now() });
  r.hours = r.hours.slice(-3000);
  await store.setJSON(`appr:${slug}`, r);
}
async function reviewHours(slug, hid, approve, by) {
  const r = await record(slug), h = r.hours.find((x) => x.id === hid); if (!h) throw new Error("That entry isn't there any more.");
  if (approve === "delete") r.hours = r.hours.filter((x) => x.id !== hid);
  else { h.status = approve ? "approved" : "pending"; h.by = approve ? by : ""; }
  await store.setJSON(`appr:${slug}`, r);
}
async function deleteOwnPending(slug, hid) {
  const r = await record(slug), h = r.hours.find((x) => x.id === hid);
  if (!h || h.status !== "pending") throw new Error("Only hours that haven't been signed off can be removed.");
  r.hours = r.hours.filter((x) => x.id !== hid); await store.setJSON(`appr:${slug}`, r);
}
async function setCheck(slug, cid, on, by) {
  const r = await record(slug); if (on) r.checks[cid] = { at: Date.now(), by }; else delete r.checks[cid];
  await store.setJSON(`appr:${slug}`, r);
}
// Qualified tasks: supervised reps
async function logRep(slug, cid, b, by) {
  const item = (await checklist()).find((c) => c.id === cid); if (!item) throw new Error("That task isn't on the list any more.");
  const d = b.date ? T.parseDate(String(b.date)) : null; const key = d ? T.keyOf(d) : T.dateKey(Date.now());
  if (key > T.dateKey(Date.now() + 864e5)) throw new Error("That date is in the future.");
  const n = Math.max(1, Math.min(20, Math.round(Number(b.count) || 1)));
  const r = await record(slug); const l = r.reps[cid] || [];
  for (let i = 0; i < n; i++) l.push({ id: id(), date: key, note: line(b.note, 200), status: b.approved ? "approved" : "pending", by: b.approved ? by : "", at: Date.now() + i });
  r.reps[cid] = l.slice(-500); await store.setJSON(`appr:${slug}`, r);
}
async function reviewRep(slug, cid, rid, approve, by, own) {
  const r = await record(slug), l = r.reps[cid] || [], x = l.find((y) => y.id === rid); if (!x) throw new Error("That entry isn't there any more.");
  if (own && x.status !== "pending") throw new Error("Only reps that haven't been approved can be removed.");
  if (approve === "delete") r.reps[cid] = l.filter((y) => y.id !== rid); else { x.status = approve ? "approved" : "pending"; x.by = approve ? by : ""; }
  await store.setJSON(`appr:${slug}`, r);
}
async function setMeta(slug, b) {
  const r = await record(slug);
  if (b.permit !== undefined) r.permit = line(b.permit, 30);
  if (b.appId !== undefined) r.appId = line(b.appId, 20);
  if (b.email !== undefined) r.email = line(b.email, 120).toLowerCase();
  if (b.phone !== undefined) r.phone = line(b.phone, 30);
  await store.setJSON(`appr:${slug}`, r);
}
async function setStart(slug, date) {
  const d = T.parseDate(String(date || "")); if (!d) throw new Error("Pick a start date.");
  const r = await record(slug); r.startDate = T.keyOf(d); await store.setJSON(`appr:${slug}`, r);
}
async function saveSettings(b) {
  const g = Math.round(Number(b.goalHours)); if (!(g >= 1 && g <= 10000)) throw new Error("Required hours: 1 to 10,000.");
  await store.setJSON("appr:settings", { goalHours: g });
}
async function saveChecklist(items) {
  const out = (Array.isArray(items) ? items : []).slice(0, 300).map((x) => {
    const t = Math.round(Number(x.target) || 0);
    return { id: line(x.id, 20) || id(), title: line(x.title, 140), group: line(x.group, 60) || "Checkoffs", ...(t > 0 && t <= 1000 ? { target: t } : {}) };
  }).filter((x) => x.title);
  await store.setJSON("appr:checklist", out); return out;
}
async function saveMaterials(items) {
  const out = (Array.isArray(items) ? items : []).slice(0, 100).map((x) => ({ id: line(x.id, 20) || id(), title: line(x.title, 140), url: line(x.url, 500) }))
    .filter((x) => x.title && /^https:\/\//i.test(x.url));
  await store.setJSON("appr:materials", out); return out;
}

// ----- applications (public /apply page) -----
const APP_STATUS = ["new", "contacted", "accepted", "declined"];
async function applications() { return (await store.getJSON("appr:apps")) || []; }
async function apply(b) {
  const first = line(b.first, 60), last = line(b.last, 60), email = line(b.email, 120), phone = line(b.phone, 30);
  const about = String(b.about ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 1500);
  const errors = {};
  if (!first) errors.first = "Enter your first name.";
  if (!last) errors.last = "Enter your last name.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = "Enter a valid email.";
  if (phone.replace(/\D/g, "").length < 10) errors.phone = "Enter a phone number we can reach you at.";
  const st = line(b.state, 2).toUpperCase(), zip = line(b.zip, 10);
  if (!line(b.street, 120)) errors.street = "Enter your mailing address.";
  if (!line(b.city, 60)) errors.city = "Enter your city.";
  if (!/^[A-Z]{2}$/.test(st)) errors.state = "2-letter state.";
  if (!/^\d{5}(-\d{4})?$/.test(zip)) errors.zip = "5-digit ZIP.";
  if (about.length < 2) errors.about = "Tell us why you want to be a barber.";
  if (Object.keys(errors).length) { const e = new Error("Please fix the highlighted fields."); e.fields = errors; throw e; }
  const num = (v) => { const n = Math.round(Number(v) || 0); return n > 0 && n < 5000 ? n : 0; };
  const app = { id: id(), at: Date.now(), first, middle: line(b.middle, 60), last, suffix: line(b.suffix, 10), otherNames: line(b.otherNames, 200),
    email, phone, street: line(b.street, 120), city: line(b.city, 60), state: st, zip, correspondence: b.correspondence === "mail" ? "mail" : "email",
    trained: b.trained === "yes" ? "yes" : "no",
    prior: (Array.isArray(b.prior) ? b.prior : []).slice(0, 4).map((x) => ({ name: line(x?.name, 120), hours: num(x?.hours) })).filter((x) => x.name),
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(b.startDate || "")) ? String(b.startDate) : "", availability: line(b.availability, 200),
    about, status: "new" };
  const all = await applications(); all.unshift(app); await store.setJSON("appr:apps", all.slice(0, 500));
  return app;
}
async function setAppStatus(appId, status) {
  const all = await applications(); const a = all.find((x) => x.id === appId);
  if (!a) throw new Error("That application isn't here any more.");
  if (status === "delete") { await store.setJSON("appr:apps", all.filter((x) => x.id !== appId)); return null; }
  if (!APP_STATUS.includes(status)) throw new Error("Unknown status.");
  a.status = status; await store.setJSON("appr:apps", all); return a;
}

// ----- uploaded paperwork (forms already filled out on paper, scans, ID copies) -----
// Owner / Administrator only. Files live in the private Blob store under <shop>/appr/<slug>/ and are only served
// through /api/admin/photo to a logged-in Owner or Administrator.
const DOC_KINDS = {
  ak4194: "Alaska enrollment form (08-4194 / 4194a / 4194b)", eta671: "DOL apprentice agreement (ETA-671)", w4: "W-4", i9: "I-9",
  permit: "Apprentice permit from the state", id: "ID / work eligibility copies", hours: "Hours reports", other: "Other",
};
const FILE_MAX = 3 * 1024 * 1024;
function sniffDoc(buf) {
  if (buf.slice(0, 5).toString() === "%PDF-") return { ext: "pdf", type: "application/pdf" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", type: "image/png" };
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return { ext: "webp", type: "image/webp" };
  return null;
}
async function files(slug) { return (await store.getJSON(`appr:files:${slug}`)) || []; }
async function addFile(slug, b, by) {
  const F = require("./files"), config = require("../config/studio");
  const m = /^data:[\w/+.-]*;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || ""));
  if (!m) throw new Error("Pick a PDF or a photo of the form.");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > FILE_MAX) throw new Error("That file is over 3 MB. Save the scan smaller, or upload it as photos.");
  const t = sniffDoc(buf); if (!t) throw new Error("Upload a PDF, JPG, PNG or WebP.");
  const kind = DOC_KINDS[b.kind] ? b.kind : "other";
  const fid = id(), name = `${config.tenant}/appr/${slug}/${fid}-${crypto.randomBytes(8).toString("hex")}.${t.ext}`;
  if (F.useBlob()) await F.blob.put(name, buf, { access: "private", contentType: t.type, addRandomSuffix: false });
  else { const fs = require("fs"), path = require("path"); const file = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "uploads", name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); }
  const rec = { id: fid, kind, label: line(b.label, 120) || DOC_KINDS[kind], name, filename: line(b.filename, 120).replace(/[^\w .()-]/g, "") || `${kind}.${t.ext}`, type: t.type, size: buf.length, at: Date.now(), by };
  const l = await files(slug); l.unshift(rec); await store.setJSON(`appr:files:${slug}`, l.slice(0, 100));
  return l;
}
async function removeFile(slug, fid) {
  const F = require("./files"); const l = await files(slug), f = l.find((x) => x.id === fid);
  if (!f) throw new Error("That file isn't here any more.");
  try { if (F.useBlob()) await F.blob.del(f.name); else require("fs").rmSync(require("path").join(process.env.DATA_DIR || require("path").join(process.cwd(), ".data"), "uploads", f.name), { force: true }); } catch (e) { console.error("[appr file]", e.message); }
  const next = l.filter((x) => x.id !== fid); await store.setJSON(`appr:files:${slug}`, next); return next;
}
// Who may open a stored paperwork file: the path must be one this shop stored for an apprentice.
const filePattern = (tenant) => new RegExp(`^${tenant}/appr/([a-z0-9-]+)/[a-f0-9]{10}-[a-f0-9]{16}\\.(pdf|jpg|png|webp)$`);

module.exports = { DOC_KINDS, files, addFile, removeFile, filePattern, logRep, reviewRep, setMeta, TASKS, applications, apply, setAppStatus, APP_STATUS, list, setApprentice, settings, checklist, materials, view, logHours, reviewHours, deleteOwnPending, setCheck, setStart, saveSettings, saveChecklist, saveMaterials, MODULES, DEFAULT_GOAL };
