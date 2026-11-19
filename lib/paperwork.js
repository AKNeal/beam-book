// Apprentice paperwork. Fills the official PDFs (downloaded from the government sites) from:
//   - the apprentice's paperwork details (they fill these in on their dashboard; stored encrypted, lib/pii.js)
//   - the shop's paperwork settings (instructor, licenses, sponsor / DOL program info)
//   - their signed-off hours (the monthly 08-4315 report)
// Forms: Alaska 08-4194 / 4194a / 4194b (one PDF), DOL ETA-671 Section II, IRS W-4, USCIS I-9 (Section 1 + employer box),
//        Alaska 08-4315 (monthly hours, three months per form).
//
// Store:
//   appr:paper         shop settings (plain)
//   appr:pw:<slug>     { enc: sealed profile, at }
const { PDFDocument, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFTextField } = require("pdf-lib");
const store = require("./store");
const pii = require("./pii");

const FORMS = {
  ak4194: { title: "Alaska apprentice enrollment (08-4194, 4194a, 4194b)", file: "AK-08-4194-enrollment", url: "https://www.commerce.alaska.gov/web/portals/5/pub/bah4194.pdf" },
  eta671: { title: "DOL apprentice agreement (ETA-671 Section II)", file: "ETA-671-apprentice-agreement", url: "https://www.apprenticeship.gov/sites/default/files/ETA_Form_671_Section_II.pdf" },
  w4: { title: "IRS Form W-4", file: "W-4", url: "https://www.irs.gov/pub/irs-pdf/fw4.pdf" },
  i9: { title: "USCIS Form I-9", file: "I-9", url: "https://www.uscis.gov/sites/default/files/document/forms/i-9.pdf" },
  ak4315: { title: "Alaska monthly hours report (08-4315)", file: "AK-08-4315-hours", url: "https://www.commerce.alaska.gov/web/portals/5/pub/bah4315.pdf" },
};

// ---------- download (cached per instance, and in the store for a week so a slow gov site doesn't block) ----------
const mem = new Map();
async function bytes(id) {
  const f = FORMS[id]; if (!f) throw new Error("Unknown form.");
  if (mem.has(id)) return mem.get(id);
  let buf = null;
  try {
    const r = await fetch(f.url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", Accept: "application/pdf,*/*" } });
    if (r.ok) buf = Buffer.from(await r.arrayBuffer());
    if (buf && buf.slice(0, 4).toString() !== "%PDF") buf = null;
  } catch {}
  const k = `pdf:${id}`;
  if (buf) { try { await store.global.setJSON(k, buf.toString("base64")); } catch {} }
  else { try { const s = await store.global.getJSON(k); if (s) buf = Buffer.from(s, "base64"); } catch {} }
  if (!buf) throw new Error(`Couldn't download the ${f.title} from the government site. Try again in a minute.`);
  mem.set(id, buf); return buf;
}
const load = async (id) => PDFDocument.load(await bytes(id), { ignoreEncryption: true });

async function fields(id) {
  const doc = await load(id);
  return doc.getForm().getFields().map((f) => ({ name: f.getName(), type: f.constructor.name.replace(/^PDF/, "") }));
}

// ---------- shop settings ----------
const SETTINGS = {
  shopName: 140, shopPhone: 30, shopMailing: 200, shopPhysical: 200, shopOwnerLicense: 40,
  instructorName: 100, instructorLicense: 40, ein: 12,
  employerRep: 100, // "Last, First, Title" for the I-9 employer box and the ETA-671 employer signature line
  programNumber: 40, sponsorName: 140, sponsorAddress: 240, sponsorPhone: 30, sponsorEmail: 120,
  occupation: 80, rapids: 20, onet: 20, termLength: 40, probation: 40,
  rtiProvider: 240, rtiHours: 40, rtiWhen: 10, rtiPaid: 5,
  entryWage: 20, journeyWage: 20, wageSteps: 600, complaints: 300,
};
const DEFAULTS = { occupation: "Barber", onet: "39-5011.00", termLength: "1,650 hours", probation: "", rtiWhen: "during", rtiPaid: "yes" };
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
async function settings() { return { ...DEFAULTS, ...((await store.getJSON("appr:paper")) || {}) }; }
async function saveSettings(b) {
  const out = {};
  for (const [k, n] of Object.entries(SETTINGS)) out[k] = k === "wageSteps" ? String(b[k] ?? "").replace(/\r\n?/g, "\n").trim().slice(0, n) : clip(b[k], n);
  if (out.ein && out.ein.replace(/\D/g, "").length !== 9) throw new Error("EIN: 9 digits.");
  await store.setJSON("appr:paper", out); return settings();
}

// ---------- the apprentice's details ----------
const ONE = (v, list, d = "") => (list.includes(v) ? v : d);
const num = (v, max = 1e6) => { const n = Math.round(Number(String(v ?? "").replace(/[$,]/g, "")) * 100) / 100; return n > 0 && n <= max ? n : 0; };
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
function cleanProfile(b, prev = {}) {
  const p = {
    first: clip(b.first, 60), middle: clip(b.middle, 60), last: clip(b.last, 60), suffix: clip(b.suffix, 10), otherNames: clip(b.otherNames, 200),
    street: clip(b.street, 120), city: clip(b.city, 60), state: clip(b.state, 2).toUpperCase(), zip: clip(b.zip, 10),
    phone: clip(b.phone, 30), email: clip(b.email, 120), correspondence: ONE(b.correspondence, ["email", "mail"], "email"),
    enrollType: ONE(b.enrollType, ["initial", "reenroll", "transfer"], "initial"), prevHours: num(b.prevHours, 5000), transferFrom: clip(b.transferFrom, 140),
    prior: (Array.isArray(b.prior) ? b.prior : []).slice(0, 4).map((x) => ({ name: clip(x?.name, 120), hours: num(x?.hours, 5000) })).filter((x) => x.name),
    dob: date(b.dob),
    ssn: !b.ssn || String(b.ssn).includes("*") ? prev.ssn || "" : String(b.ssn).replace(/\D/g, ""),
    i9Status: ONE(b.i9Status, ["citizen", "national", "lpr", "alien"]), aNumber: clip(b.aNumber, 20), workAuthExp: date(b.workAuthExp), i94: clip(b.i94, 20), passport: clip(b.passport, 60),
    w4Filing: ONE(b.w4Filing, ["single", "married", "hoh"]), w4TwoJobs: Boolean(b.w4TwoJobs), w4Children: Math.min(20, Math.max(0, Math.round(Number(b.w4Children) || 0))), w4Other: Math.min(20, Math.max(0, Math.round(Number(b.w4Other) || 0))),
    w4OtherIncome: num(b.w4OtherIncome), w4Deductions: num(b.w4Deductions), w4Extra: num(b.w4Extra, 1e5),
    sex: ONE(b.sex, ["male", "female", "none"], "none"), ethnicity: ONE(b.ethnicity, ["hispanic", "not", "none"], "none"),
    race: (Array.isArray(b.race) ? b.race : []).filter((r) => ["aian", "asian", "black", "nhpi", "white", "none"].includes(r)),
    veteran: ONE(b.veteran, ["non", "vet", "nonElig", "vetElig", "none"], "none"), education: ONE(b.education, ["nohs", "hs", "some", "bach", "mast", "doc"]),
    employment: ONE(b.employment, ["new", "current"], "new"), preAppr: ONE(b.preAppr, ["yes", "no"], "no"), preApprName: clip(b.preApprName, 200),
    emergencyName: clip(b.emergencyName, 100), emergencyPhone: clip(b.emergencyPhone, 30), emergencyRel: clip(b.emergencyRel, 40),
  };
  if (p.ssn && p.ssn.length !== 9) throw new Error("Social Security number: 9 digits.");
  return p;
}
// What's still needed before the forms come out complete.
function missing(p) {
  const need = { first: "First name", last: "Last name", street: "Mailing address", city: "City", state: "State", zip: "ZIP", phone: "Phone", email: "Email", dob: "Date of birth", ssn: "Social Security number", i9Status: "Citizenship / work status (I-9)", w4Filing: "W-4 filing status", education: "Education" };
  const out = Object.entries(need).filter(([k]) => !p?.[k]).map(([, l]) => l);
  if (p?.i9Status === "lpr" && !p.aNumber) out.push("USCIS / A-Number");
  if (p?.i9Status === "alien" && !(p.aNumber || p.i94 || p.passport)) out.push("A-Number, I-94 or passport number");
  return out;
}
async function profile(slug) { const r = await store.getJSON(`appr:pw:${slug}`); return r?.enc ? pii.open(r.enc) : null; }
async function saveProfile(slug, b) {
  const p = cleanProfile(b, (await profile(slug)) || {});
  await store.setJSON(`appr:pw:${slug}`, { enc: pii.seal(p), at: Date.now() });
  return p;
}
// What a screen gets: everything but the SSN (masked).
function masked(p) { if (!p) return null; const { ssn, ...rest } = p; return { ...rest, ssn: ssn ? `***-**-${ssn.slice(-4)}` : "", missing: missing(p) }; }
// Start from the public application if they haven't filled anything in yet.
function fromApplication(a) {
  if (!a) return null;
  return masked(cleanProfile({ ...a, correspondence: a.correspondence, prior: a.prior }));
}

// ---------- filling ----------
const mdy = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
const ssnFmt = (s) => (s ? `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5)}` : "");
const money = (n) => (n ? Math.round(n).toLocaleString("en-US") : "");
const fullName = (p) => [p.first, p.middle, p.last, p.suffix].filter(Boolean).join(" ");
const addr1 = (p) => [p.street, [p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ");

function filler(doc) {
  const form = doc.getForm();
  const get = (n) => { try { return form.getField(n); } catch { return null; } };
  return {
    form,
    text(n, v) { const f = get(n); if (f instanceof PDFTextField && v !== undefined && v !== null && v !== "") { try { const ml = f.getMaxLength(); f.setText(ml ? String(v).slice(0, ml) : String(v)); } catch { f.setMaxLength(undefined); f.setText(String(v)); } } },
    check(n, on = true) { const f = get(n); if (f instanceof PDFCheckBox && on) f.check(); },
    radio(n, opt) { const f = get(n); if (f instanceof PDFRadioGroup && opt) { try { f.select(opt); } catch {} } },
    pick(n, opt) { const f = get(n); if (f instanceof PDFDropdown && opt) { try { f.select(opt); } catch {} } },
    // the W-4's checkbox groups share one name with several widgets; tick widget i
    widget(n, i) {
      const f = get(n); if (!f) return;
      const w = f.acroField.getWidgets()[i]; if (!w) return;
      const on = w.getOnValue(); if (!on) return;
      f.acroField.dict.set(require("pdf-lib").PDFName.of("V"), on); w.setAppearanceState(on);
    },
  };
}

async function ak4194(p, S, ctx) {
  const doc = await load("ak4194"), F = filler(doc);
  F.check("barber");
  F.radio("enrollment type", { initial: "Choice1", transfer: "Choice2", reenroll: "Choice3" }[p.enrollType || "initial"]);
  if (p.enrollType === "reenroll") F.text("ReEnrollment with Previously Earned Number of Hours", p.prevHours || "");
  if (p.enrollType === "transfer") F.text("School Transfer From", p.transferFrom);
  F.check("permit fee (2)"); if (p.enrollType && p.enrollType !== "initial") F.check("re-enrollment or transfer fee");
  F.text("Full Legal Name", fullName(p));
  if (p.otherNames) { F.radio("other names", "Choice2"); F.text("other names used", p.otherNames); } else F.radio("other names", "Choice1");
  F.text("mailing address", addr1(p)); F.text("contact phone", p.phone); F.text("Date of Birth", mdy(p.dob)); F.text("email", p.email);
  F.radio("correspondence", p.correspondence === "mail" ? "Choice1" : "Choice3");
  const ssnField = F.form.getFields().find((f) => /^SOCIAL SECURITY NUMBER/.test(f.getName())); if (ssnField && p.ssn) ssnField.setText(ssnFmt(p.ssn));
  // 08-4194 page 2: shop + instructor + previous training
  F.text("Name of Shop Where You Will Apprentice", S.shopName); F.text("shop mailing address", S.shopMailing); F.text("shop physical address", S.shopPhysical || S.shopMailing);
  F.text("shop phone #", S.shopPhone); F.text("Shop Owner License Number", S.shopOwnerLicense);
  F.text("Name of Instructor Providing Training", S.instructorName); F.text("Instructor License Number", S.instructorLicense);
  (p.prior || []).slice(0, 4).forEach((x, i) => { F.text(`Name of School or Shop Where Previously TrainedRow${i + 1}`, x.name); F.text(`Number of HoursRow${i + 1}`, x.hours || ""); });
  F.text("Applicant Printed Name", fullName(p));
  // 08-4194a: instructor's statement
  F.text("Area of Practice", "Barber"); F.text("Instructor", S.instructorName); F.text("Instructor License Number_2", S.instructorLicense);
  F.text("shop business name - resp", S.shopName); F.text("Shop Owner License Number_2", S.shopOwnerLicense); F.text("Street City State Zip", S.shopPhysical || S.shopMailing);
  const others = (ctx.others || []).slice(0, 2);
  F.radio("apprentices", others.length ? "Choice1" : "Choice3");
  others.forEach((o, i) => { F.text(`Apprentice NameRow${i + 1}`, o.name); F.text(`Student Permit NumberRow${i + 1}`, o.permit || ""); });
  // 08-4194a responsibility + 08-4194b curriculum acknowledgements
  F.radio("practice of", "Choice2"); F.text("printed name - resp", S.instructorName); F.text("License Number", S.instructorLicense);
  for (const n of ["Apprentice Name", "Apprentice Name_2", "Apprentice Name_3", "Apprentice Name_4"]) F.text(n, fullName(p));
  return doc;
}

async function eta671(p, S, ctx) {
  const doc = await load("eta671"), F = filler(doc);
  F.text("First Name", p.first); F.text("Middle Name", p.middle); F.text("Last Name", p.last); F.text("Suffix", p.suffix);
  F.text("Address", addr1(p)); F.text("Telephone Number", p.phone); F.text("SSN", ssnFmt(p.ssn)); F.text("2 Date of Birth Mo Day Yr", mdy(p.dob));
  F.check({ male: "Male", female: "Female", none: "Participant Did Not Self_2" }[p.sex || "none"]);
  F.check({ hispanic: "Hispanic or Latino", not: "Not Hispanic or Latino", none: "Participant Did Not SelfIdentify" }[p.ethnicity || "none"]);
  const race = { aian: "American Indian or Alaska Native", asian: "Asian", black: "Black or African American", nhpi: "Native Hawaiian or other", white: "White", none: "Participant Did Not SelfIdentify_2" };
  (p.race?.length ? p.race : ["none"]).forEach((r) => F.check(race[r]));
  F.check({ non: "Non Veteran", vet: "Veteran", nonElig: "Non Veteran Other Eligible", vetElig: "Veteran Eligible", none: "Participant Did Not Self" }[p.veteran || "none"]);
  F.check({ nohs: "Not High School graduate", hs: "High School graduate", some: "Some College or Associates", bach: "Bachelors degree", mast: "Masters degree", doc: "Doctorate or professional" }[p.education]);
  F.check(p.employment === "current" ? "Current Employee" : "New Employee");
  F.radio("undefined", p.preAppr === "yes" ? "Yes" : "No"); if (p.preAppr === "yes") F.text("Pre-Apprenticeship Name and Address", p.preApprName);
  // Part B: sponsor
  F.text("Program Number", S.programNumber); F.text("Sponsor Name and Address", [S.sponsorName || S.shopName, S.sponsorAddress || S.shopMailing].filter(Boolean).join(", "));
  F.text("Cell Phone Number", S.sponsorPhone || S.shopPhone); F.text("Email Address", S.sponsorEmail);
  F.text("Occupation", S.occupation); F.text("RAPIDS Code", S.rapids); F.text("ONet Code", S.onet);
  F.radio("Interim Credentials Offered ie Career Lattice", "No_2");
  F.check("Timebased"); F.text("Term Length", S.termLength); F.text("Probationary Period", S.probation);
  if (S.shopPhysical && S.shopPhysical !== (S.sponsorAddress || S.shopMailing)) F.text("Sponsor's Address", S.shopPhysical);
  F.text("Employer Name and Address", [S.shopName, S.shopPhysical || S.shopMailing].filter(Boolean).join(", "));
  const credit = (p.prior || []).reduce((a, x) => a + (x.hours || 0), 0);
  F.text("Credit", credit ? `${credit} hours` : "0"); F.text("Date Begins", mdy(ctx.startDate));
  F.text("9 Related Instruction Providers Name and Addr", S.rtiProvider); F.text("a Total Length of Related Instruction", S.rtiHours);
  F.check(S.rtiPaid === "no" ? "undefined_3" : "undefined_2");
  F.check({ during: "During Work Hours", outside: "Not During Work Hours", both: "Both During and Not During Work Hours" }[S.rtiWhen || "during"]);
  F.text("a Apprentices Entry Wage", S.entryWage); F.text("b Journeyworkers ie Experienced Workers Wage", S.journeyWage);
  const steps = String(S.wageSteps || "").split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((x) => x[0]).slice(0, 10);
  if (steps.length) { F.check("amount of wage"); steps.forEach(([dur, rate], i) => { F.text(String(i + 1), dur); F.text(`${i + 1}Wage Rate`, rate || ""); }); }
  F.text("Name and Contact Info for Complaints", S.complaints || [S.instructorName, S.shopPhone].filter(Boolean).join(", "));
  return doc;
}

async function w4(p, S) {
  const doc = await load("w4"), F = filler(doc), P = "topmostSubform[0].Page1[0].";
  F.text(`${P}Step1a[0].f1_01[0]`, [p.first, p.middle ? p.middle[0] + "." : ""].filter(Boolean).join(" "));
  F.text(`${P}Step1a[0].f1_02[0]`, [p.last, p.suffix].filter(Boolean).join(" "));
  F.text(`${P}Step1a[0].f1_03[0]`, p.street); F.text(`${P}Step1a[0].f1_04[0]`, [p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "));
  F.text(`${P}f1_05[0]`, ssnFmt(p.ssn));
  const fi = { single: 0, married: 1, hoh: 2 }[p.w4Filing]; if (fi !== undefined) F.widget(`${P}c1_1[${fi}]`, 0);
  if (p.w4TwoJobs) F.widget(`${P}c1_2[0]`, 0);
  const a = (p.w4Children || 0) * 2200, b = (p.w4Other || 0) * 500;
  if (a) F.text(`${P}Step3_ReadOrder[0].f1_06[0]`, money(a)); if (b) F.text(`${P}Step3_ReadOrder[0].f1_07[0]`, money(b)); if (a + b) F.text(`${P}f1_08[0]`, money(a + b));
  if (p.w4OtherIncome) F.text(`${P}f1_09[0]`, money(p.w4OtherIncome)); if (p.w4Deductions) F.text(`${P}f1_10[0]`, money(p.w4Deductions)); if (p.w4Extra) F.text(`${P}f1_11[0]`, money(p.w4Extra));
  F.text(`${P}f1_12[0]`, [S.shopName, S.shopPhysical || S.shopMailing].filter(Boolean).join(", "));
  if (S.ein) F.text(`${P}f1_14[0]`, S.ein.replace(/\D/g, "").replace(/^(\d{2})/, "$1-"));
  return doc;
}

async function i9(p, S) {
  const doc = await load("i9"), F = filler(doc);
  F.text("Last Name (Family Name)", p.last); F.text("First Name Given Name", p.first); F.text("Employee Middle Initial (if any)", p.middle ? p.middle[0] : "");
  F.text("Employee Other Last Names Used (if any)", p.otherNames); F.text("Address Street Number and Name", p.street); F.text("City or Town", p.city);
  F.pick("State", p.state); F.text("ZIP Code", p.zip); F.text("Date of Birth mmddyyyy", mdy(p.dob)); F.text("US Social Security Number", p.ssn);
  F.text("Employees E-mail Address", p.email); F.text("Telephone Number", p.phone);
  const cb = { citizen: "CB_1", national: "CB_2", lpr: "CB_3", alien: "CB_4" }[p.i9Status]; if (cb) F.check(cb);
  if (p.i9Status === "lpr") F.text("3 A lawful permanent resident Enter USCIS or ANumber", p.aNumber);
  if (p.i9Status === "alien") { F.text("Exp Date mmddyyyy", mdy(p.workAuthExp)); F.text("USCIS ANumber", p.aNumber); F.text("Form I94 Admission Number", p.i94); F.text("Foreign Passport Number and Country of IssuanceRow1", p.passport); }
  F.text("Employers Business or Org Name", S.shopName); F.text("Employers Business or Org Address", S.shopPhysical || S.shopMailing);
  F.text("Last Name First Name and Title of Employer or Authorized Representative", S.employerRep);
  return doc;
}

// 08-4315: one form = three months. `months` = ["2026-11", ...] (up to 3); hours = [{date, hours, status}]
async function ak4315(p, S, ctx) {
  const doc = await load("ak4315"), F = filler(doc);
  F.text("StudentApprentice Name", fullName(p)); F.text("StudentApprentice Permit Number", ctx.permit); F.text("School or Shop Name", S.shopName);
  const names = ["For the Month of", "For the Month of_2", "For the Month of_3"], totals = ["Total Hours This Month", "Total Hours This Month_2", "Total Hours This Month_3"];
  const all = F.form.getFields().map((f) => f.getName());
  const label = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  (ctx.months || []).slice(0, 3).forEach((ym, mi) => {
    F.text(names[mi], label(ym)); if (mi === 0) F.text("Year", ym.slice(0, 4));
    const byDay = {}; for (const h of ctx.hours || []) if (h.status === "approved" && h.date.startsWith(ym)) byDay[+h.date.slice(8)] = (byDay[+h.date.slice(8)] || 0) + h.hours;
    let total = 0;
    for (let d = 1; d <= 31; d++) {
      const v = byDay[d]; if (!v) continue; total += v;
      const base = String(d).padStart(2, "0"), n = mi === 0 ? base : `${base}_${mi}`;
      if (all.includes(n)) F.text(n, String(Math.round(v * 100) / 100));
    }
    F.text(totals[mi], String(Math.round(total * 100) / 100));
  });
  return doc;
}

const BUILD = { ak4194, eta671, w4, i9, ak4315 };
async function build(form, p, S, ctx = {}) {
  if (!BUILD[form]) throw new Error("Unknown form.");
  const doc = await BUILD[form](p || {}, S, ctx);
  try { doc.getForm().deleteXFA(); } catch {}
  try { doc.getForm().updateFieldAppearances(); } catch {}
  return Buffer.from(await doc.save({ updateFieldAppearances: false }));
}
// Everything in one flattened PDF, to print in one go.
async function packet(p, S, ctx = {}) {
  const out = await PDFDocument.create();
  for (const id of ["ak4194", "eta671", "w4", "i9"]) {
    const doc = await BUILD[id](p, S, ctx);
    try { doc.getForm().deleteXFA(); } catch {}
    try { doc.getForm().flatten(); } catch {}
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((pg) => out.addPage(pg));
  }
  return Buffer.from(await out.save());
}

module.exports = { FORMS, fields, settings, saveSettings, profile, saveProfile, masked, missing, fromApplication, cleanProfile, build, packet };
