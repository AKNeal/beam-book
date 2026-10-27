// Beam Book business templates: the words a business uses, the questions on its request form, and how it negotiates.
// A new business starts from one of these on the control page; the business (or Neal) can change everything after.
//
// Form question types: text, long, number, date, time, choice (one), multi (several), check (yes/no), address, money, photos.
// The request always also asks for: who they want (if the business lists people), a short description ("summary"),
// name, email, phone (optional, with a text opt-in).
//
// Negotiation (per business): which terms a CLIENT may counter — price, datetime (date + start time + length),
// scope, terms (deposit, cancellation, anything else) — and whether the client names an offer first.
// The business can always change any term in its own offers.

const KINDS = {
  tattoo: {
    label: "Tattoo shop",
    words: { provider: "artist", providers: "artists", job: "tattoo", jobs: "tattoos", cta: "Request a tattoo", title: "Request a tattoo",
      intro: "Tell us what you're after and where. You'll get a reply with questions or an offer.",
      summary: "What do you want?", summaryHint: "Subject, style, anything it has to include. Spell out any lettering exactly.", session: "session",
      prep: "Eat a real meal beforehand, bring a photo ID, and skip alcohol the night before." },
    form: [
      { key: "images", label: "Reference photos", type: "photos", hint: "Inspiration, a sketch, or the spot on your body." },
      { key: "placement", label: "Where on your body?", type: "choice", required: true, options: ["Forearm", "Upper arm", "Shoulder", "Hand / fingers", "Chest", "Back", "Ribs / side", "Stomach", "Thigh", "Calf / shin", "Foot / ankle", "Neck", "Head / face", "Other"] },
      { key: "size", label: "Roughly how big?", type: "choice", required: true, options: ["Palm-sized or smaller", "About the size of a hand to a forearm", "Half sleeve, thigh or calf panel", "Full sleeve, chest, back — multiple sessions", "Not sure yet"] },
      { key: "sizeDetail", label: "Exact size, if you know it", type: "text", hint: "e.g. 5 × 3 inches" },
      { key: "color", label: "Style", type: "choice", options: ["Black and grey", "Color", "Not sure yet"] },
      { key: "coverUp", label: "It's a cover-up or rework of an old tattoo", type: "check" },
      { key: "firstTattoo", label: "It's my first tattoo", type: "check" },
      { key: "availability", label: "When are you free?", type: "text", hint: "e.g. weekday afternoons" },
    ],
    negotiate: { price: false, datetime: false, scope: false, terms: false, clientOffersFirst: false },
    ageCheck: true, policyCheck: true,
  },
  performer: {
    label: "Performer / DJ / band",
    words: { provider: "performer", providers: "performers", job: "gig", jobs: "gigs", cta: "Book a gig", title: "Book a gig",
      intro: "Tell us about your event. Make an offer, or ask for one. We'll go back and forth until it works.",
      summary: "Tell us about the event", summaryHint: "Occasion, crowd, music you want, anything special.", session: "set" },
    form: [
      { key: "eventType", label: "Type of event", type: "choice", required: true, options: ["Wedding", "Private party", "Corporate event", "Bar or venue night", "Festival", "Other"] },
      { key: "venue", label: "Venue or address", type: "address", required: true },
      { key: "guests", label: "About how many guests?", type: "number" },
      { key: "equipment", label: "Sound and lights", type: "choice", options: ["Bring everything", "Venue has sound", "Not sure"] },
    ],
    negotiate: { price: true, datetime: true, scope: true, terms: true, clientOffersFirst: true },
    ageCheck: false, policyCheck: false,
  },
  trades: {
    label: "Trades and services",
    words: { provider: "crew member", providers: "crew", job: "job", jobs: "jobs", cta: "Get a quote", title: "Get a quote",
      intro: "Tell us what needs doing. You'll get an offer you can accept, counter or ask about.",
      summary: "What needs doing?", summaryHint: "What, how much, and anything we should know before we come out.", session: "visit" },
    form: [
      { key: "address", label: "Job address", type: "address", required: true },
      { key: "images", label: "Photos of the job", type: "photos", hint: "Helps us price it without a visit." },
      { key: "window", label: "Best time of day", type: "choice", options: ["Morning", "Afternoon", "Evening", "Flexible"] },
      { key: "access", label: "Anything about access?", type: "text", hint: "Gate code, stairs, parking, pets" },
    ],
    negotiate: { price: true, datetime: true, scope: true, terms: false, clientOffersFirst: false },
    ageCheck: false, policyCheck: false,
  },
  creative: {
    label: "Photo / video / design",
    words: { provider: "creative", providers: "team", job: "project", jobs: "projects", cta: "Start a project", title: "Start a project",
      intro: "Tell us about the project. Make an offer or ask for one, and we'll settle the details together.",
      summary: "Tell us about the project", summaryHint: "What it's for, the look you want, and where it'll be used.", session: "shoot" },
    form: [
      { key: "projectType", label: "Type of project", type: "choice", required: true, options: ["Photo shoot", "Video", "Event coverage", "Design", "Other"] },
      { key: "location", label: "Location", type: "address" },
      { key: "deliverables", label: "What do you need delivered?", type: "long", hint: "e.g. 40 edited photos, a 60-second reel" },
      { key: "images", label: "Reference images", type: "photos" },
    ],
    negotiate: { price: true, datetime: true, scope: true, terms: true, clientOffersFirst: true },
    ageCheck: false, policyCheck: false,
  },
  blank: {
    label: "Any other business",
    words: { provider: "team member", providers: "team", job: "booking", jobs: "bookings", cta: "Request a booking", title: "Request a booking",
      intro: "Tell us what you need. You'll get an offer you can accept, counter or ask about.",
      summary: "What do you need?", summaryHint: "", session: "appointment" },
    form: [],
    negotiate: { price: true, datetime: true, scope: false, terms: false, clientOffersFirst: false },
    ageCheck: false, policyCheck: false,
  },
};

const TYPES = ["text", "long", "number", "date", "time", "choice", "multi", "check", "address", "money", "photos"];
const RESERVED_KEYS = new Set(["artist", "name", "email", "phone", "smsOk", "instagram", "idea", "website", "age18", "agreePolicy", "offer"]);

function template(kind) { return JSON.parse(JSON.stringify(KINDS[kind] || KINDS.blank)); }

// Clean a form definition coming from the control page or a business owner.
function cleanForm(list) {
  if (!Array.isArray(list)) throw new Error("The form must be a list of questions.");
  if (list.length > 25) throw new Error("Up to 25 questions.");
  const out = [], keys = new Set();
  let photoFields = 0;
  for (const q of list) {
    const label = String(q.label || "").trim().slice(0, 120);
    if (!label) throw new Error("Every question needs a label.");
    const type = TYPES.includes(q.type) ? q.type : "text";
    let key = String(q.key || label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || `q${out.length + 1}`;
    if (type === "photos") { key = "images"; if (++photoFields > 1) throw new Error("Only one photo question per form."); }
    if (RESERVED_KEYS.has(key)) key = `q_${key}`;
    while (keys.has(key)) key = `${key}_2`;
    keys.add(key);
    const f = { key, label, type, required: Boolean(q.required) && type !== "check" && type !== "photos" };
    const hint = String(q.hint || "").trim().slice(0, 200); if (hint) f.hint = hint;
    if (type === "choice" || type === "multi") {
      const opts = (Array.isArray(q.options) ? q.options : String(q.options || "").split("\n")).map((o) => String(o).trim().slice(0, 80)).filter(Boolean);
      if (opts.length < 2) throw new Error(`"${label}" needs at least two choices.`);
      f.options = [...new Set(opts)].slice(0, 30);
    }
    out.push(f);
  }
  return out;
}

const WORD_KEYS = ["provider", "providers", "job", "jobs", "cta", "title", "intro", "summary", "summaryHint", "session", "prep"];
function cleanWords(w, base) {
  const out = { ...base };
  for (const k of WORD_KEYS) if (w && w[k] !== undefined) out[k] = String(w[k]).trim().slice(0, ["intro", "summaryHint", "prep"].includes(k) ? 300 : 60) || (k === "prep" ? "" : base[k]);
  return out;
}
function cleanNegotiate(n, base) {
  const out = { ...base };
  for (const k of ["price", "datetime", "scope", "terms", "clientOffersFirst"]) if (n && n[k] !== undefined) out[k] = Boolean(n[k]);
  return out;
}

// Check a client's answers against the business's form. Returns { answers, errors }.
function readAnswers(form, b) {
  const answers = [], errors = {};
  for (const f of form) {
    if (f.type === "photos") continue; // handled with the uploads
    const raw = b[f.key];
    let v;
    switch (f.type) {
      case "check": v = Boolean(raw); break;
      case "multi": v = (Array.isArray(raw) ? raw : []).map(String).filter((x) => f.options.includes(x)); break;
      case "number": v = raw === "" || raw == null ? "" : Number(raw); if (v !== "" && !Number.isFinite(v)) errors[f.key] = "Enter a number."; break;
      case "date": v = String(raw || "").trim(); if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors[f.key] = "Pick a date."; break;
      case "time": v = String(raw || "").trim(); if (v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) errors[f.key] = "Pick a time."; break;
      case "choice": v = String(raw || "").trim(); if (v && !f.options.includes(v)) errors[f.key] = "Pick one of the options."; break;
      case "money": v = money(raw); if (raw && !v) errors[f.key] = "Enter an amount, like 400 or 300-500."; break;
      default: v = String(raw ?? "").trim().slice(0, f.type === "long" ? 2000 : 300);
    }
    const empty = v === "" || v == null || (Array.isArray(v) && !v.length);
    if (f.required && empty && !errors[f.key]) errors[f.key] = f.type === "choice" ? "Pick one." : "Please fill this in.";
    if (!empty) answers.push({ key: f.key, label: f.label, type: f.type, value: v });
  }
  return { answers, errors };
}

// "1200" → "$1,200"; "300-500" → "$300–$500"; text like "$150/hr" kept as typed.
function money(raw) {
  let s = String(raw ?? "").trim().slice(0, 60);
  if (!s) return "";
  const num = (n) => `$${Number(n.replace(/,/g, "")).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const m = /^\$?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:[-–]|to)\s*\$?\s*(\d[\d,]*(?:\.\d{1,2})?)$/.exec(s);
  if (m) return `${num(m[1])}–${num(m[2])}`;
  const one = /^\$?\s*(\d[\d,]*(?:\.\d{1,2})?)$/.exec(s);
  if (one) return num(one[1]);
  return /\d/.test(s) ? s : "";
}

// Show an answer as text (emails, inbox).
function answerText(a) {
  if (a.type === "check") return a.value ? "Yes" : "No";
  if (Array.isArray(a.value)) return a.value.join(", ");
  return String(a.value);
}

// Words, questions and negotiation rules sent from the control page or a business's inbox.
// Only the parts that were sent are returned; the caller merges them over the current settings.
function bookingSettings(b, current = {}) {
  const out = {};
  const base = current.words || KINDS.blank.words;
  if (b.words) out.words = cleanWords(b.words, base);
  if (b.form !== undefined) out.form = cleanForm(b.form);
  if (b.negotiate) out.negotiate = cleanNegotiate(b.negotiate, current.negotiate || KINDS.blank.negotiate);
  if (b.ageCheck !== undefined) out.ageCheck = Boolean(b.ageCheck);
  if (b.policyCheck !== undefined) out.policyCheck = Boolean(b.policyCheck);
  if (b.sessionLengths !== undefined) {
    const list = [...new Set((Array.isArray(b.sessionLengths) ? b.sessionLengths : []).map(Number))].filter((m) => Number.isInteger(m) && m >= 15 && m <= 24 * 60 * 3).sort((x, y) => x - y);
    if (!list.length) throw new Error("Add at least one length.");
    out.sessionLengths = list.slice(0, 15);
  }
  return out;
}

module.exports = { bookingSettings, KINDS, TYPES, template, cleanForm, cleanWords, cleanNegotiate, readAnswers, money, answerText };
