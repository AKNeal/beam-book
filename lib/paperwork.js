// Apprentice paperwork: the official PDFs (fetched from the government sites when needed) filled in from the
// apprentice's application, their private portal details, and the shop's paperwork settings.
const { PDFDocument } = require("pdf-lib");

const FORMS = {
  ak4194: { title: "Alaska Apprentice Enrollment (08-4194, 08-4194a, 08-4194b)", url: "https://www.commerce.alaska.gov/web/portals/5/pub/bah4194.pdf" },
  ak4315: { title: "Alaska Quarterly Report (08-4315)", url: "https://www.commerce.alaska.gov/web/portals/5/pub/bah4315.pdf" },
  eta671: { title: "DOL Apprentice Agreement (ETA-671 Section II)", url: "https://www.apprenticeship.gov/sites/default/files/ETA_Form_671_Section_II.pdf" },
  w4: { title: "IRS Form W-4", url: "https://www.irs.gov/pub/irs-pdf/fw4.pdf" },
  i9: { title: "USCIS Form I-9", url: "https://www.uscis.gov/sites/default/files/document/forms/i-9.pdf" },
};

const cache = new Map();
async function load(id) {
  const f = FORMS[id]; if (!f) throw new Error("Unknown form.");
  if (!cache.has(id)) {
    const r = await fetch(f.url, { headers: { "User-Agent": "Mozilla/5.0 (Beam paperwork)" } });
    if (!r.ok) throw new Error(`Couldn't download ${f.title} (${r.status}).`);
    cache.set(id, Buffer.from(await r.arrayBuffer()));
  }
  return PDFDocument.load(cache.get(id), { ignoreEncryption: true });
}

// For setting up the fill maps: every field's name, type and (for checkboxes / radios) its options.
async function fields(id) {
  const doc = await load(id);
  return doc.getForm().getFields().map((f) => {
    const t = f.constructor.name.replace(/^PDF/, "");
    const out = { name: f.getName(), type: t };
    try { if (f.getOptions) out.options = f.getOptions(); } catch {}
    try { if (t === "CheckBox") out.onValue = f.acroField.getOnValue()?.decodeText?.() || String(f.acroField.getOnValue() || ""); } catch {}
    return out;
  });
}

module.exports = { FORMS, load, fields };
