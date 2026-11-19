/* Beam inbox: the Apprenticeship screen (lib/apprentice.js).
   An apprentice sees their own hours (toward the shop's required hours), the checkoffs and the course materials, and logs hours.
   The Owner / Administrator picks who is an apprentice, signs off hours and checkoffs, and edits the checklist and materials. */
(function () {
  const { el, api } = window.BW;
  const call = (body) => api("/api/admin/books", { body });
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const fmtH = (n) => (Math.round(n * 100) / 100).toLocaleString();
  let ctx = null, R = null, who = null;

  const css = `
  .appr h1{font-size:44px;margin:28px 0 6px}.appr .big{font:700 52px/1 var(--head);margin:6px 0}
  .appr .prog{height:14px;background:var(--line);border-radius:99px;overflow:hidden;margin:10px 0}.appr .prog i{display:block;height:100%;background:var(--sign);border-radius:99px}
  .appr .row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}
  .appr .row .meta{color:var(--graphite);font-size:14px}.appr .pill{font-size:12px;padding:2px 8px;border-radius:99px;border:1px solid var(--line)}
  .appr .pill.ok{background:var(--soft);border-color:var(--sign-dark)}.appr .grid3{display:grid;grid-template-columns:1fr 110px;gap:10px}
  .appr .chk{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line)}.appr .chk input{width:20px;height:20px;margin-top:2px;accent-color:var(--sign)}
  .appr label{display:block;font-size:14px;margin:8px 0}.appr label input,.appr label textarea,.appr label select{display:block;width:100%;margin-top:4px}
  .appr h3{margin:16px 0 4px;font-size:18px}
  .appr .ex-panel{border:2px dashed var(--graphite);background:repeating-linear-gradient(135deg,transparent 0 14px,rgba(127,127,127,.07) 14px 28px)}
  .appr .ex-banner{display:flex;gap:12px;align-items:flex-start;background:var(--ink);color:var(--snow);padding:12px 14px;border-radius:8px;margin:8px 0 6px;font-size:15px}
  .appr .ex-banner b{display:block;font-size:16px;letter-spacing:.04em}
  .appr .ex-tag{display:inline-block;font:700 11px/1 var(--body);letter-spacing:.12em;text-transform:uppercase;background:var(--ink);color:var(--snow);padding:4px 7px;border-radius:4px;margin-right:8px;vertical-align:2px}
  .appr .ex-row{opacity:.85}
  .appr .onb{border:2px solid var(--sign)}.appr .onb .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:600px){.appr .onb .two{grid-template-columns:1fr}}
  .appr .linkbox{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--soft);padding:10px;border-radius:6px;word-break:break-all;font-size:14px}
  .appr .files .row{padding:8px 0}.appr .drop{border:2px dashed var(--field);border-radius:8px;padding:14px;margin-top:10px}`;

  async function show(c, slug) {
    ctx = c; ctx.only("apprView"); if (!document.getElementById("apprCss")) document.head.append(el("style", { id: "apprCss" }, css));
    const v = document.getElementById("apprView"); v.className = "appr"; v.replaceChildren(el("p", { class: "muted" }, "Loading…"));
    who = slug || null;
    try { R = await call({ action: "apprView", slug: who || undefined }); } catch (e) { v.replaceChildren(el("p", { class: "notice" }, e.message)); return; }
    R.owner && !who ? drawOwner() : drawOne();
  }

  // ---------- owner: everyone ----------
  const exName = (n) => String(n || "").replace(/\s*\((demo|example)\)\s*$/i, "");
  function apprRow(a) {
    const bar = (pct) => el("div", { class: "prog", style: "height:8px;margin:4px 0" }, el("i", { style: `width:${Math.min(100, pct)}%` }));
    const paper = a.paperwork === null ? (a.files ? `Paperwork: ${a.files} uploaded` : "Paperwork: details not filled in")
      : (a.paperwork.length ? `Paperwork: missing ${a.paperwork.length}` : "Paperwork: ready") + (a.files ? ` · ${a.files} uploaded` : "");
    const needsOnboard = !a.demo && !a.onboarded;
    const slot = el("div", { style: "flex-basis:100%" });
    const row = el("div", { class: "row", style: "align-items:flex-start" },
      el("div", { style: "flex:1;min-width:240px" }, a.demo ? el("span", { class: "ex-tag" }, "Example") : null, el("strong", {}, exName(a.name)),
        a.permit ? el("span", { class: "meta" }, ` · permit #${a.permit}`) : el("span", { class: "meta" }, " · no permit # yet"),
        el("div", { class: "meta" }, `Hours ${fmtH(a.approvedHours)} / ${fmtH(R.settings.goalHours)} (${fmtH(a.practicalHours)} practical, ${fmtH(a.theoryHours)} theory)${a.pendingHours ? ` · ${fmtH(a.pendingHours)} waiting for you` : ""}`), bar(a.pct),
        el("div", { class: "meta" }, `Qualified tasks ${a.tasksQualified} / ${a.tasksTotal}${a.repsPending ? ` · ${a.repsPending} reps waiting` : ""} · Modules ${a.modulesDone} / ${a.modulesTotal}`), bar(a.tasksTotal ? 100 * a.tasksQualified / a.tasksTotal : 0),
        el("div", { class: "meta" }, `${a.startDate ? `Started ${a.startDate} · ` : ""}${paper}`)),
      el("div", { class: "actions", style: "margin:0" },
        needsOnboard ? el("button", { class: "btn sm", type: "button", onclick: () => { if (slot.firstChild) slot.replaceChildren(); else { slot.replaceChildren(onboardForm(a)); slot.querySelector("input")?.focus(); } } }, "Onboard") : null,
        el("button", { class: "btn sm" + (needsOnboard || a.demo ? " line" : ""), type: "button", onclick: () => show(ctx, a.slug) }, "Open"),
        a.demo ? null : el("button", { class: "btn sm line", type: "button", onclick: async () => { if (!confirmTwice(`end ${a.name}'s apprenticeship`)) return; try { await call({ action: "apprSet", slug: a.slug, on: false }); show(ctx); } catch (e) { ctx.toast(e.message); } } }, "Remove")),
      slot);
    return row;
  }

  function drawOwner() {
    const v = document.getElementById("apprView"); v.textContent = "";
    v.append(el("h1", {}, "Apprenticeship"));
    // Examples first, real apprentices after them (newest at the bottom).
    const list = [...R.apprentices.filter((a) => a.demo), ...R.apprentices.filter((a) => !a.demo)];
    const sec = el("section", { class: "panel" }, el("h2", {}, "Apprentices"));
    if (!list.length) sec.append(el("p", { class: "muted" }, "No apprentices yet. Pick someone from your team below, or onboard someone new."));
    for (const a of list) sec.append(apprRow(a));
    const others = R.team.filter((t) => !R.apprentices.some((a) => a.slug === t.slug));
    const newSlot = el("div");
    const add = el("div", { class: "actions", style: "margin-top:14px;align-items:center" });
    if (others.length) {
      const sel = el("select", { "aria-label": "Team member" }, others.map((t) => el("option", { value: t.slug }, t.name)));
      add.append(el("span", { class: "small muted" }, "Add from your team:"), sel, el("button", { class: "btn sm line", type: "button", onclick: async () => { try { await call({ action: "apprSet", slug: sel.value, on: true }); ctx.toast("Added. Press Onboard next to their name."); show(ctx); } catch (e) { ctx.toast(e.message); } } }, "Add as apprentice"));
    }
    add.append(el("button", { class: "linkbtn small", type: "button", onclick: () => { if (newSlot.firstChild) newSlot.replaceChildren(); else { newSlot.replaceChildren(onboardForm(null)); newSlot.querySelector("input")?.focus(); } } }, "Someone not on the team yet?"));
    sec.append(add, newSlot,
      el("p", { class: "small", style: "margin-top:12px" }, el("button", { class: "linkbtn small", type: "button", onclick: async () => {
        if (R.demo && !confirmTwice("remove the example apprentices")) return;
        try { await call({ action: "apprDemo", on: !R.demo }); ctx.toast(R.demo ? "Examples removed" : "Examples added"); show(ctx); } catch (e) { ctx.toast(e.message); } } }, R.demo ? "Remove the examples" : "Show examples")));
    v.append(appsPanel(), sec, formsPanel(), paperSettingsPanel(), setupPanel());
  }

  // ---------- owner: onboard an apprentice (someone on the team: a; someone new: null) ----------
  function onboardForm(a) {
    const apps = (R.applications || []).filter((x) => x.status !== "declined" && !x.demo);
    const f = el("form", { class: "panel onb", style: "margin:12px 0" });
    const inp = (name, label, attrs = {}) => el("label", {}, label, el("input", { name, ...attrs }));
    const first = a ? exName(a.name).split(" ")[0] : "them";
    const appSel = apps.length ? el("select", { name: "appId", onchange: () => {
      const x = apps.find((y) => y.id === appSel.value); if (!x) return;
      for (const [k, v2] of [["first", x.first], ["last", x.last], ["email", x.email], ["phone", x.phone], ["startDate", x.startDate || ""]]) if (f.elements[k] && (!a || !["first", "last"].includes(k))) f.elements[k].value = v2 || "";
    } }, el("option", { value: "" }, "— not from an application —"), apps.map((x) => el("option", { value: x.id }, `${x.first} ${x.last} · applied ${new Date(x.at).toLocaleDateString()}`))) : null;
    const login = a && a.hasLogin;
    f.append(...[el("h3", { style: "margin-top:0" }, a ? `Onboard ${first}` : "Onboard someone new"),
      appSel ? el("label", {}, "From an application (fills in what they sent)", appSel) : null,
      a ? null : el("div", { class: "two" }, inp("first", "First name", { required: true, maxlength: 40, autocomplete: "off" }), inp("last", "Last name", { maxlength: 40, autocomplete: "off" })),
      el("div", { class: "two" }, inp("startDate", "Start date", { type: "date", value: a?.startDate || today() }), inp("permit", "Apprentice permit # (if they have one)", { maxlength: 30, value: a?.permit || "" })),
      login ? el("p", { class: "small muted" }, `${first} already has a login, so they'll see My training as soon as you save.`)
        : el("div", { class: "two" }, inp("email", "Email (for their own login)", { type: "email", maxlength: 120, autocomplete: "off", value: a?.email || "" }), inp("phone", "Phone", { type: "tel", maxlength: 30, autocomplete: "off", value: a?.phone || "" })),
      el("div", { class: "actions" }, el("button", { class: "btn", type: "submit" }, "Save and upload paperwork"), el("button", { class: "btn line", type: "button", onclick: () => f.remove() }, "Cancel"))].filter(Boolean));
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
      try {
        const r = await call({ action: "apprOnboard", ...(a ? { slug: a.slug } : {}), ...Object.fromEntries(new FormData(f)) });
        ctx.toast(`${r.name} is onboarded`);
        await show(ctx, r.slug);
        const v = document.getElementById("apprView"), nm = r.name.split(" ")[0];
        const next = el("section", { class: "panel onb" }, el("h2", {}, `${nm} is onboarded`),
          el("p", {}, "Next: upload the paperwork they already filled out (enrollment form, ETA-671, W-4, I-9, ID copies, permit)."),
          el("div", { class: "actions" }, el("button", { class: "btn", type: "button", onclick: () => document.getElementById("apprFiles")?.scrollIntoView({ behavior: "smooth" }) }, "Upload their paperwork")));
        if (r.invite) {
          const msg = `Hi ${nm}, here's your link to set up your apprentice login: ${r.invite.link}`;
          next.append(el("h3", {}, "Their login"),
            el("p", {}, r.invite.emailed ? `We emailed ${nm} a link to choose a password (${r.invite.email}). You can also send it yourself:` : `Send ${nm} this link to choose a password. It works once and lasts 12 days.`),
            el("div", { class: "linkbox" }, el("code", { style: "flex:1;min-width:200px" }, r.invite.link),
              el("button", { class: "btn sm line", type: "button", onclick: () => navigator.clipboard?.writeText(r.invite.link).then(() => ctx.toast("Copied")) }, "Copy"),
              r.invite.phone ? el("a", { class: "btn sm line", href: `sms:${r.invite.phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(msg)}` }, "Text it") : null));
        }
        v.insertBefore(next, v.children[2] || null);
        document.getElementById("apprFiles")?.scrollIntoView({ behavior: "smooth" });
      } catch (x) { ctx.toast(x.message); btn.disabled = false; }
    });
    return f;
  }

  // ---------- owner: every form that's been made ----------
  function formsPanel() {
    const sec = el("section", { class: "panel" }, el("h2", {}, "Forms"),
      el("p", { class: "small muted" }, "Every form you've generated. View opens a fresh copy with the apprentice's current details. Make new ones from an apprentice's page (Open → Paperwork)."));
    if (!(R.docs || []).length) sec.append(el("p", { class: "muted" }, "None yet."));
    for (const d of R.docs || []) sec.append(docRow(d, true));
    return sec;
  }
  function docRow(d, withName) {
    const go = async (open) => {
      const w = open ? window.open("", "_blank") : null;
      try { const r = await call({ action: "apprPaper", slug: d.slug || R.slug, form: d.form, months: d.months, view: true }); open ? viewPdf(r, w) : download(r); }
      catch (e) { if (w) w.close(); ctx.toast(e.message); }
    };
    return el("div", { class: "row" }, el("div", {}, /^demo-/.test(d.slug || "") && withName ? el("span", { class: "ex-tag" }, "Example") : null, el("strong", {}, d.title), el("div", { class: "meta" }, `${withName ? exName(d.name) + " · " : ""}${new Date(d.at).toLocaleString()}${d.by ? " · " + d.by : ""}${d.missing ? ` · ${d.missing} blanks` : ""}`)),
      el("div", { class: "actions", style: "margin:0" }, el("button", { class: "btn sm", type: "button", onclick: () => go(true) }, "View"), el("button", { class: "btn sm line", type: "button", onclick: () => go(false) }, "Download")));
  }
  function pdfUrl(r) { const bin = atob(r.pdf), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return URL.createObjectURL(new Blob([u8], { type: "application/pdf" })); }
  function viewPdf(r, w) { const url = pdfUrl(r); if (w) w.location.href = url; else window.open(url, "_blank"); setTimeout(() => URL.revokeObjectURL(url), 300000); }

  // ---------- owner: applications from the public /apply page ----------
  function appsPanel() {
    const apps = R.applications || [];
    const fresh = apps.filter((a) => a.status === "new").length;
    const sec = el("section", { class: "panel" }, el("h2", {}, "Applications", fresh ? el("span", { class: "meta", style: "margin-left:8px" }, `${fresh} new`) : null),
      el("p", { class: "small muted" }, "From the Apply page on your website (", el("a", { href: "/apply", target: "_blank", rel: "noopener" }, "see it"), "). You get an email for each one too."));
    if (!apps.length) { sec.append(el("p", { class: "muted" }, "No applications yet.")); return sec; }
    for (const a of apps) {
      const st = el("select", { onchange: async () => { try { R.applications = (await call({ action: "apprApp", id: a.id, status: st.value })).applications; ctx.toast("Saved"); } catch (e) { ctx.toast(e.message); } } },
        ["new", "contacted", "accepted", "declined"].map((x) => el("option", { value: x, selected: a.status === x }, x[0].toUpperCase() + x.slice(1))));
      sec.append(el("div", { class: "row", style: "align-items:flex-start" },
        el("div", {}, a.demo ? el("span", { class: "ex-tag" }, "Example") : null, el("strong", {}, exName(`${a.first} ${a.last}`)),
          el("div", { class: "meta" }, el("a", { href: `mailto:${a.email}` }, a.email), " · ", el("a", { href: `tel:${a.phone}` }, a.phone), " · ", new Date(a.at).toLocaleDateString()),
          a.about ? el("p", { class: "small", style: "white-space:pre-line;margin:6px 0 0" }, a.about) : null),
        el("div", { class: "actions", style: "margin:0" }, st,
          el("button", { class: "btn sm line", type: "button", onclick: async () => { if (!confirm(`Delete ${a.first}'s application?`)) return; try { R.applications = (await call({ action: "apprApp", id: a.id, status: "delete" })).applications; drawOwner(); } catch (e) { ctx.toast(e.message); } } }, "Delete"))));
    }
    return sec;
  }

  function paperSettingsPanel() {
    const box = el("details", { class: "panel" }, el("summary", {}, el("h2", { style: "display:inline" }, "Paperwork settings")));
    box.addEventListener("toggle", async () => {
      if (!box.open || box.dataset.loaded) return; box.dataset.loaded = "1";
      let S; try { S = (await call({ action: "apprPaperSettings", get: true })).settings; } catch (e) { box.append(el("p", { class: "notice" }, e.message)); return; }
      const f = el("form");
      const inp = (k, l, attrs = {}) => el("label", {}, l, el("input", { name: k, value: S[k] || "", ...attrs }));
      f.append(el("p", { class: "small muted" }, "Filled in once; used on every apprentice's forms."),
        el("h3", {}, "Shop"), inp("shopName", "Shop name"), inp("shopPhone", "Shop phone"), inp("shopMailing", "Shop mailing address"), inp("shopPhysical", "Shop physical address"),
        inp("shopOwnerLicense", "Shop owner license #"), inp("ein", "EIN (for the W-4)"),
        el("h3", {}, "Instructor"), inp("instructorName", "Instructor name"), inp("instructorLicense", "Instructor barber license #"),
        inp("employerRep", "Employer representative for the I-9 (Last, First, Title)"),
        el("h3", {}, "DOL registered apprenticeship (ETA-671)"), inp("programNumber", "Program number"), inp("sponsorName", "Sponsor name (blank = shop)"), inp("sponsorAddress", "Sponsor address (blank = shop mailing)"),
        inp("sponsorPhone", "Sponsor phone"), inp("sponsorEmail", "Sponsor email"), inp("occupation", "Occupation"), inp("rapids", "RAPIDS code"), inp("onet", "O*NET code"),
        inp("termLength", "Term length"), inp("probation", "Probationary period"),
        inp("rtiProvider", "Related instruction provider name and address"), inp("rtiHours", "Total length of related instruction"),
        el("label", {}, "Related instruction is", el("select", { name: "rtiWhen" }, [["during", "During work hours"], ["outside", "Not during work hours"], ["both", "Both"]].map(([v, l]) => el("option", { value: v, selected: S.rtiWhen === v }, l)))),
        el("label", {}, "Wages paid during related instruction", el("select", { name: "rtiPaid" }, [["yes", "Yes"], ["no", "No"]].map(([v, l]) => el("option", { value: v, selected: S.rtiPaid === v }, l)))),
        inp("entryWage", "Apprentice entry wage ($/hr)"), inp("journeyWage", "Journeyworker wage ($/hr)"),
        el("label", {}, "Wage steps (one per line: duration | $ rate), up to 10", el("textarea", { name: "wageSteps", rows: 4, placeholder: "0–550 hrs | 15.00" }, S.wageSteps || "")),
        el("label", {}, "Who receives complaints (name and contact)", el("input", { name: "complaints", value: S.complaints || "" })),
        el("button", { class: "btn", type: "submit" }, "Save"));
      f.addEventListener("submit", async (e) => { e.preventDefault(); try { await call({ action: "apprPaperSettings", settings: Object.fromEntries(new FormData(f)) }); ctx.toast("Saved"); } catch (x) { ctx.toast(x.message); } });
      box.append(f);
    });
    return box;
  }

  function setupPanel() {
    const box = el("details", { class: "panel" }, el("summary", {}, el("h2", { style: "display:inline" }, "Hours, tasks and materials")));
    const goal = el("input", { type: "number", min: 1, step: 1, value: R.settings.goalHours, style: "max-width:140px" });
    const chk = el("textarea", { rows: 14 }, R.checklist.map((c) => `${c.group} | ${c.title}${c.target ? ` | ${c.target}` : ""}`).join("\n"));
    const mat = el("textarea", { rows: 6, placeholder: "Volume 1: Professional Foundations | https://…" }, R.materials.map((m) => `${m.title} | ${m.url}`).join("\n"));
    const save = async () => {
      try {
        await call({ action: "apprSettings", goalHours: goal.value });
        const old = new Map(R.checklist.map((c) => [`${c.group}|${c.title}`, c.id]));
        await call({ action: "apprChecklist", items: chk.value.split("\n").map((l) => { const parts = l.split("|").map((x) => x.trim()); let target = 0; if (parts.length > 2 && /^\d+$/.test(parts[parts.length - 1])) target = +parts.pop(); const title = parts.length > 1 ? parts.slice(1).join(" | ") : parts[0], group = parts.length > 1 ? parts[0] : "Checkoffs"; return { id: old.get(`${group}|${title}`), group, title, target }; }).filter((x) => x.title) });
        await call({ action: "apprMaterials", items: mat.value.split("\n").map((l) => { const i = l.lastIndexOf("|"); return i > 0 ? { title: l.slice(0, i).trim(), url: l.slice(i + 1).trim() } : null; }).filter(Boolean) });
        ctx.toast("Saved"); show(ctx);
      } catch (e) { ctx.toast(e.message); }
    };
    box.append(el("label", {}, "Required hours", goal), el("p", { class: "small muted" }, "Alaska's barber apprenticeship is 1,650 hours. Check the current requirement with the state board."),
      el("label", {}, "Tasks and checkoffs (one per line: group | item | reps needed). Add a reps number to make it a qualified task.", chk),
      el("label", {}, "Course materials (one per line: title | https link)", mat),
      el("p", { class: "small muted" }, "Links to the Level Up Barbering Series or anything else the apprentice should study. Keep shared files view-only."),
      el("button", { class: "btn", type: "button", onclick: save }, "Save"));
    return box;
  }

  // ---------- one apprentice (their own view, or the owner's view of them) ----------
  const KIND = { practical: "Practical", theory: "Theory" };
  function drawOne() {
    const v = document.getElementById("apprView"); v.textContent = "";
    const owner = R.owner;
    if (owner) v.append(el("p", { style: "margin:24px 0 0" }, el("button", { class: "linkbtn", type: "button", onclick: () => show(ctx) }, "← All apprentices")));
    const isEx = /^demo-/.test(R.slug || "");
    v.append(el("h1", {}, isEx ? el("span", { class: "ex-tag", style: "font-size:14px;vertical-align:8px" }, "Example") : null, owner ? exName(R.name) : "My training"));
    const tasks = R.checklist.filter((c) => c.target), qualified = tasks.filter((c) => c.done).length;
    v.append(el("section", { class: "panel" },
      el("div", { class: "big" }, `${fmtH(R.approvedHours)} / ${fmtH(R.goalHours)} hours`),
      el("div", { class: "prog" }, el("i", { style: `width:${R.pct}%` })),
      el("p", { class: "muted", style: "margin:0" }, `${R.pct}% signed off · ${fmtH(R.practicalHours || 0)} practical · ${fmtH(R.theoryHours || 0)} theory${R.pendingHours ? ` · ${fmtH(R.pendingHours)} waiting for sign-off` : ""}`),
      el("p", { class: "muted", style: "margin:4px 0 0" }, `${tasks.length ? `${qualified} of ${tasks.length} tasks qualified · ` : ""}${R.checksDone - qualified} of ${R.checksTotal - tasks.length} other checkoffs${R.startDate ? ` · started ${R.startDate}` : ""}${R.permit ? ` · permit #${R.permit}` : ""}`),
      owner ? startEditor() : null));

    if (owner && !isEx) v.append(filesPanel());

    // Log hours
    const date = el("input", { type: "date", value: today(), max: today() }), hrs = el("input", { type: "number", min: 0.25, max: 16, step: 0.25, value: 8 }), note = el("input", { placeholder: "What you worked on (optional)" });
    const kind = el("select", {}, Object.entries(KIND).map(([k, l]) => el("option", { value: k }, l === "Theory" ? "Theory (course / classroom)" : "Practical (on the floor)")));
    v.append(el("section", { class: "panel" }, el("h2", {}, "Log hours"),
      el("div", { class: "grid3" }, el("label", {}, "Day", date), el("label", {}, "Hours", hrs)), el("label", {}, "Type", kind), el("label", {}, "Note", note),
      el("button", { class: "btn", type: "button", onclick: async () => { try { R = { ...R, ...(await call({ action: "apprLog", slug: owner ? R.slug : undefined, date: date.value, hours: hrs.value, kind: kind.value, note: note.value })) }; ctx.toast(owner ? "Hours added and signed off" : "Hours sent for sign-off"); drawOne(); } catch (e) { ctx.toast(e.message); } } }, owner ? "Add (signed off)" : "Log hours")));

    // Qualified tasks
    if (tasks.length) {
      const tk = el("section", { class: "panel" }, el("h2", {}, "Qualified tasks"),
        el("p", { class: "small muted" }, owner ? "Approve each supervised rep. Once they've done enough and you're happy with the work, mark the task Qualified." : "Log each one you do with your instructor watching. They approve it, and mark the task Qualified when you're ready."));
      for (const c of tasks) {
        const pct = Math.min(100, Math.round(100 * c.repsApproved / c.target));
        const reps = (R.reps?.[c.id] || []), pend = reps.filter((x) => x.status === "pending");
        const cnt = el("input", { type: "number", min: 1, max: 20, value: 1, style: "max-width:70px", "aria-label": "How many" });
        const body = el("div", { style: "padding:8px 0 4px" },
          el("div", { class: "prog", style: "height:8px;margin:4px 0 8px" }, el("i", { style: `width:${pct}%` })),
          el("div", { class: "actions", style: "margin:0;align-items:center" }, cnt,
            el("button", { class: "btn sm", type: "button", onclick: async () => { try { R = { ...R, ...(await call({ action: "apprRep", slug: owner ? R.slug : undefined, id: c.id, count: cnt.value, date: today() })) }; ctx.toast(owner ? "Approved" : "Sent for approval"); drawOne(); } catch (e) { ctx.toast(e.message); } } }, owner ? "Add approved" : "Log rep"),
            owner ? el("button", { class: "btn sm" + (c.done ? " line" : ""), type: "button", onclick: async () => { try { R = { ...R, ...(await call({ action: "apprCheck", slug: R.slug, id: c.id, on: !c.done })) }; drawOne(); } catch (e) { ctx.toast(e.message); } } }, c.done ? "Undo qualified" : "Mark qualified") : null));
        for (const x of pend.slice(0, 20)) body.append(el("div", { class: "row", style: "padding:6px 0" }, el("span", { class: "meta" }, `${x.date}${x.note ? " · " + x.note : ""} · waiting`),
          el("div", { class: "actions", style: "margin:0" },
            owner ? el("button", { class: "btn sm", type: "button", onclick: () => rep(c.id, x.id, true) }, "Approve") : null,
            el("button", { class: "btn sm line", type: "button", onclick: () => rep(c.id, x.id, "delete") }, owner ? "Reject" : "Remove"))));
        tk.append(el("details", { class: "chk", style: "display:block" },
          el("summary", { style: "cursor:pointer;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap" },
            el("strong", {}, c.title),
            el("span", {}, el("span", { class: "meta" }, `${c.repsApproved} / ${c.target}${c.repsPending ? ` · ${c.repsPending} waiting` : ""} `), el("span", { class: "pill" + (c.done ? " ok" : "") }, c.done ? "Qualified" : "In training"))),
          body));
      }
      v.append(tk);
    }

    // Hours list
    const hl = el("section", { class: "panel" }, el("h2", {}, "Hour log"));
    if (!R.hours.length) hl.append(el("p", { class: "muted" }, "No hours logged yet."));
    for (const h of R.hours.slice(0, 120)) {
      const acts = owner
        ? [h.status === "pending" ? el("button", { class: "btn sm", type: "button", onclick: () => review(h.id, true) }, "Sign off") : el("button", { class: "btn sm line", type: "button", onclick: () => review(h.id, false) }, "Undo"),
          el("button", { class: "btn sm line", type: "button", onclick: () => { if (confirmTwice("delete these hours")) review(h.id, "delete"); } }, "Delete")]
        : h.status === "pending" ? [el("button", { class: "btn sm line", type: "button", onclick: async () => { try { R = { ...R, ...(await call({ action: "apprDelete", id: h.id })) }; drawOne(); } catch (e) { ctx.toast(e.message); } } }, "Remove")] : [];
      hl.append(el("div", { class: "row" }, el("div", {}, el("strong", {}, `${h.date} · ${fmtH(h.hours)} h · ${KIND[h.kind] || "Practical"}`), h.note ? el("div", { class: "meta" }, h.note) : null),
        el("div", { class: "actions", style: "margin:0;align-items:center" }, el("span", { class: "pill" + (h.status === "approved" ? " ok" : "") }, h.status === "approved" ? `Signed off${h.by ? " by " + h.by : ""}` : "Waiting for sign-off"), ...acts)));
    }
    v.append(hl);

    // Other checkoffs (course modules etc.)
    const rest = R.checklist.filter((c) => !c.target);
    if (rest.length) {
      const ck = el("section", { class: "panel" }, el("h2", {}, "Course modules and checkoffs"), el("p", { class: "small muted" }, owner ? "Tick each one when it's done." : "Your instructor signs these off."));
      let group = null;
      for (const c of rest) {
        if (c.group !== group) { group = c.group; ck.append(el("h3", {}, group)); }
        const box = el("input", { type: "checkbox", checked: c.done, disabled: !owner, "aria-label": c.title, onchange: async (e) => { try { R = { ...R, ...(await call({ action: "apprCheck", slug: R.slug, id: c.id, on: e.target.checked })) }; drawOne(); } catch (x) { ctx.toast(x.message); } } });
        ck.append(el("label", { class: "chk" }, box, el("span", {}, c.title, c.done ? el("span", { class: "meta small" }, ` · ${c.at ? new Date(c.at).toLocaleDateString() : ""}${c.by ? " · " + c.by : ""}`) : null)));
      }
      v.append(ck);
    }

    // Materials
    const ml = el("section", { class: "panel" }, el("h2", {}, "Course materials"));
    if (!R.materials.length) ml.append(el("p", { class: "muted" }, owner ? "None yet. Add links under Apprenticeship → Hours, tasks and materials." : "Your instructor hasn't added any materials yet."));
    for (const m of R.materials) ml.append(el("div", { class: "row" }, el("strong", {}, m.title), el("a", { class: "btn sm line", href: m.url, target: "_blank", rel: "noopener" }, "Open")));
    v.append(ml);

    v.append(owner ? paperPanel() : profilePanel());
  }

  async function rep(cid, rid, approve) { try { R = { ...R, ...(await call({ action: "apprRepReview", slug: R.owner ? R.slug : undefined, id: cid, rep: rid, approve })) }; drawOne(); } catch (e) { ctx.toast(e.message); } }

  function startEditor() {
    const d = el("input", { type: "date", value: R.startDate || today(), style: "max-width:200px" });
    const permit = el("input", { value: R.permit || "", placeholder: "From the state", style: "max-width:200px" });
    return el("div", { class: "actions", style: "margin-top:12px;align-items:end;flex-wrap:wrap" }, el("label", { style: "margin:0" }, "Start date", d), el("label", { style: "margin:0" }, "Apprentice permit #", permit),
      el("button", { class: "btn sm line", type: "button", onclick: async () => { try { await call({ action: "apprStart", slug: R.slug, date: d.value }); R = { ...R, ...(await call({ action: "apprMeta", slug: R.slug, permit: permit.value })) }; ctx.toast("Saved"); drawOne(); } catch (e) { ctx.toast(e.message); } } }, "Save"));
  }

  // ---------- paperwork: the owner's side ----------
  const MONTHS = () => { const out = [], d = new Date(); d.setDate(1); for (let i = 0; i < 12; i++) { out.push(d.toISOString().slice(0, 7)); d.setMonth(d.getMonth() - 1); } return out; };
  function download(r) {
    const url = pdfUrl(r);
    const a = el("a", { href: url, download: r.filename }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  // ---------- owner: paperwork that's already filled out (uploads) ----------
  function shrinkImage(file) { // big phone photos of a form: scale to 2200px wide JPEG so they fit the upload limit
    return new Promise((ok, bad) => { const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, 2200 / Math.max(img.width, img.height)), c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); ok(c.toDataURL("image/jpeg", 0.85)); };
      img.onerror = () => { URL.revokeObjectURL(u); bad(new Error(`Couldn't read ${file.name}.`)); }; img.src = u; });
  }
  const readData = (file) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => bad(new Error(`Couldn't read ${file.name}.`)); r.readAsDataURL(file); });
  function filesPanel() {
    const first = exName(R.name).split(" ")[0];
    const sec = el("section", { class: "panel files", id: "apprFiles" }, el("h2", {}, "Uploaded paperwork"),
      el("p", { class: "small muted" }, `Forms ${first} already filled out and signed, scans of their ID, their permit from the state, anything on paper. Only the Owner and Administrators can open these.`));
    const list = el("div", {}, el("p", { class: "muted" }, "Loading…")); sec.append(list);
    let K = {};
    const paint = (F) => {
      list.replaceChildren();
      if (!F.length) list.append(el("p", { class: "muted" }, "Nothing uploaded yet."));
      for (const x of F) list.append(el("div", { class: "row" },
        el("div", {}, el("strong", {}, x.label), el("div", { class: "meta" }, `${x.filename} · ${(x.size / 1024 / 1024).toFixed(1)} MB · ${new Date(x.at).toLocaleDateString()}${x.by ? " · " + x.by : ""}`)),
        el("div", { class: "actions", style: "margin:0" }, el("a", { class: "btn sm", href: `/api/admin/photo?p=${encodeURIComponent(x.name)}`, target: "_blank", rel: "noopener" }, "View"),
          el("button", { class: "btn sm line", type: "button", onclick: async () => { if (!confirmTwice(`delete ${x.label}`)) return; try { paint((await call({ action: "apprFileDel", slug: R.slug, id: x.id })).files); ctx.toast("Deleted"); } catch (e) { ctx.toast(e.message); } } }, "Delete"))));
    };
    const kind = el("select", { name: "kind" }), label = el("input", { placeholder: "e.g. 08-4194 signed 11/12, page 1–3", maxlength: 120 });
    const pick = el("input", { type: "file", accept: "application/pdf,image/*", multiple: true });
    const go = el("button", { class: "btn", type: "button", onclick: async () => {
      if (!pick.files.length) return ctx.toast("Choose a file first.");
      go.disabled = true; let F = null;
      try {
        for (const file of pick.files) {
          ctx.toast(`Uploading ${file.name}…`);
          let data;
          if (file.type === "application/pdf") { if (file.size > 3 * 1024 * 1024) throw new Error(`${file.name} is over 3 MB. Save the scan smaller, or take photos of the pages.`); data = await readData(file); }
          else data = file.size > 1.5 * 1024 * 1024 ? await shrinkImage(file) : await readData(file);
          F = (await call({ action: "apprFileAdd", slug: R.slug, kind: kind.value, label: label.value, filename: file.name, data })).files;
        }
        pick.value = ""; label.value = ""; paint(F); ctx.toast("Uploaded");
      } catch (e) { ctx.toast(e.message); if (F) paint(F); }
      go.disabled = false;
    } }, "Upload");
    sec.append(el("div", { class: "drop" }, el("h3", { style: "margin-top:0" }, "Add a document"),
      el("label", {}, "What it is", kind), el("label", {}, "Note (optional)", label), el("label", {}, "File (PDF or photos, up to 3 MB each)", pick), go));
    (async () => { try { const r = await call({ action: "apprFiles", slug: R.slug }); K = r.kinds; kind.replaceChildren(...Object.entries(K).map(([k2, l]) => el("option", { value: k2 }, l))); paint(r.files); } catch (e) { list.replaceChildren(el("p", { class: "notice" }, e.message)); } })();
    return sec;
  }

  function paperPanel() {
    const sec = el("section", { class: "panel" }, el("h2", {}, "Paperwork"), el("p", { class: "muted" }, "Loading…"));
    (async () => {
      let P; try { P = await call({ action: "apprProfile", slug: R.slug, get: true }); } catch (e) { sec.lastChild.textContent = e.message; return; }
      sec.lastChild.remove();
      const p = P.profile, miss = p ? p.missing : ["everything"];
      sec.append(el("p", { class: "small" }, P.saved ? (miss.length ? `${R.name.split(" ")[0]} has filled in their details. Still missing: ${miss.join(", ")}.` : `${R.name.split(" ")[0]} has filled in all their details.`)
        : `${R.name.split(" ")[0]} hasn't filled in their private details yet (SSN, date of birth, I-9, W-4). They do that from their own login under My training → My paperwork details.${p ? " Their application details are used until then." : ""} If they already filled out the forms on paper, upload them under Uploaded paperwork above.`));
      // link to an application
      const apps = (R.applications || []);
      if (apps.length) {
        const sel = el("select", {}, el("option", { value: "" }, "— none —"), apps.map((a) => el("option", { value: a.id, selected: a.id === R.appId }, `${a.first} ${a.last} (${a.status})`)));
        sec.append(el("div", { class: "actions", style: "align-items:end" }, el("label", { style: "margin:0" }, "Their application", sel),
          el("button", { class: "btn sm line", type: "button", onclick: async () => { try { R = { ...R, ...(await call({ action: "apprMeta", slug: R.slug, appId: sel.value })) }; ctx.toast("Linked"); drawOne(); } catch (e) { ctx.toast(e.message); } } }, "Link")));
      }
      const gen = async (form, extra = {}) => {
        ctx.toast("Filling the form…");
        const w = extra.open ? window.open("", "_blank") : null; delete extra.open;
        try { const r = await call({ action: "apprPaper", slug: R.slug, form, ...extra }); w ? viewPdf(r, w) : download(r); setTimeout(() => { if (sec.isConnected) { const nb = paperPanel(); sec.replaceWith(nb); } }, 400); if (r.missing?.length) ctx.toast(`Downloaded. Blank: ${r.missing.slice(0, 3).join(", ")}${r.missing.length > 3 ? "…" : ""}`); } catch (e) { if (w) w.close(); ctx.toast(e.message); }
      };
      const forms = [["packet", "Everything, ready to print"], ["ak4194", "Alaska enrollment 08-4194 (+ 4194a, 4194b)"], ["eta671", "DOL ETA-671 apprentice agreement"], ["w4", "W-4"], ["i9", "I-9 (Section 1)"]];
      for (const [f, l] of forms) sec.append(el("div", { class: "row" }, el("span", {}, l), el("div", { class: "actions", style: "margin:0" },
        el("button", { class: "btn sm" + (f === "packet" ? "" : " line"), type: "button", onclick: () => gen(f, { open: true }) }, "Generate & view"),
        el("button", { class: "btn sm line", type: "button", onclick: () => gen(f) }, "Download"))));
      const m = el("select", {}, MONTHS().map((x) => el("option", { value: x }, new Date(x + "-15").toLocaleString(undefined, { month: "long", year: "numeric" }))));
      sec.append(el("div", { class: "row" }, el("span", {}, "Monthly hours report 08-4315 (3 months, from signed-off hours) starting "), el("div", { class: "actions", style: "margin:0" }, m,
        el("button", { class: "btn sm line", type: "button", onclick: () => { const s0 = m.value, d = new Date(s0 + "-15"); const ms = [0, 1, 2].map((i) => { const x = new Date(d); x.setMonth(d.getMonth() + i); return x.toISOString().slice(0, 7); }); gen("ak4315", { months: ms }); } }, "Download"))));
      if ((P.docs || []).length) { sec.append(el("h3", {}, "Made so far")); for (const d of P.docs) sec.append(docRow(d, false)); }
      sec.append(el("p", { class: "small muted" }, "The state doesn't take these by email: print, sign and date them, then mail them with the $125 permit fee. No hours count before the permit is issued. ETA-671 goes to your DOL apprenticeship office; keep the W-4 and I-9 in your records (the I-9 needs you to check their ID within 3 days of starting)."));
    })();
    return sec;
  }

  // ---------- paperwork: the apprentice's private details ----------
  function profilePanel() {
    const sec = el("details", { class: "panel" }, el("summary", {}, el("h2", { style: "display:inline" }, "My paperwork details")));
    sec.addEventListener("toggle", async () => {
      if (!sec.open || sec.dataset.loaded) return; sec.dataset.loaded = "1";
      let P; try { P = await call({ action: "apprProfile", get: true }); } catch (e) { sec.append(el("p", { class: "notice" }, e.message)); return; }
      const p = P.profile || {};
      const f = el("form", { class: "pw" });
      const inp = (name, label, attrs = {}) => el("label", {}, label, el("input", { name, value: p[name] ?? "", ...attrs }));
      const sel = (name, label, opts) => el("label", {}, label, el("select", { name }, el("option", { value: "" }, "Choose…"), opts.map(([v, l]) => el("option", { value: v, selected: p[name] === v }, l))));
      const box = (name, label) => el("label", { class: "chk", style: "border:0" }, el("input", { type: "checkbox", name, checked: Boolean(p[name]) }), el("span", {}, label));
      f.append(
        el("p", { class: "small muted" }, "This fills in your state permit application, your DOL apprentice agreement, your W-4 and your I-9. It's encrypted and only you and the shop owner can see it. Your full Social Security number is never shown again after you save it."),
        p.missing?.length ? el("p", { class: "notice small" }, `Still needed: ${p.missing.join(", ")}`) : null,
        el("h3", {}, "You"),
        el("div", { class: "grid3" }, inp("first", "First name", { autocomplete: "given-name" }), inp("middle", "Middle name", { autocomplete: "additional-name" })),
        el("div", { class: "grid3" }, inp("last", "Last name", { autocomplete: "family-name" }), inp("suffix", "Suffix (Jr., III)")),
        inp("otherNames", "Other names you've used (maiden name etc.)"),
        inp("dob", "Date of birth", { type: "date", autocomplete: "bday" }),
        inp("ssn", "Social Security number", { inputmode: "numeric", autocomplete: "off", placeholder: p.ssn ? "Saved — type a new one to change it" : "123-45-6789" }),
        inp("street", "Mailing address", { autocomplete: "street-address" }),
        el("div", { class: "grid3" }, inp("city", "City", { autocomplete: "address-level2" }), inp("state", "State", { maxlength: 2, autocomplete: "address-level1" })),
        inp("zip", "ZIP", { inputmode: "numeric", autocomplete: "postal-code" }),
        el("div", { class: "grid3" }, inp("phone", "Phone", { type: "tel", autocomplete: "tel" }), inp("email", "Email", { type: "email", autocomplete: "email" })),
        sel("correspondence", "The state should contact me by", [["email", "Email"], ["mail", "Mail"]]),
        el("h3", {}, "Training before this"),
        sel("enrollType", "This is my", [["initial", "First barber enrollment"], ["reenroll", "Re-enrollment (I trained before)"], ["transfer", "Transfer from a school"]]),
        inp("prevHours", "Hours earned before (re-enrollment)", { type: "number", min: 0 }), inp("transferFrom", "School transferring from"),
        ...[0, 1, 2, 3].map((i) => el("div", { class: "grid3" }, el("label", {}, i ? "" : "School or shop where you trained", el("input", { name: `prior${i}name`, value: p.prior?.[i]?.name || "" })), el("label", {}, i ? "" : "Hours", el("input", { name: `prior${i}hours`, type: "number", min: 0, value: p.prior?.[i]?.hours || "" })))),
        el("h3", {}, "I-9: work eligibility"),
        sel("i9Status", "I am", [["citizen", "A citizen of the United States"], ["national", "A noncitizen national of the United States"], ["lpr", "A lawful permanent resident"], ["alien", "A noncitizen authorized to work"]]),
        inp("aNumber", "USCIS / A-Number (if not a citizen)"), inp("workAuthExp", "Work authorization expires (if any)", { type: "date" }),
        inp("i94", "Form I-94 admission number (if any)"), inp("passport", "Foreign passport number and country (if any)"),
        el("p", { class: "small muted" }, "Bring your ID to the shop in your first 3 days (passport, or driver's license + Social Security card or birth certificate)."),
        el("h3", {}, "W-4: tax withholding"),
        sel("w4Filing", "Filing status", [["single", "Single or married filing separately"], ["married", "Married filing jointly"], ["hoh", "Head of household"]]),
        box("w4TwoJobs", "I have more than one job, or my spouse works (and the two pay about the same)"),
        el("div", { class: "grid3" }, inp("w4Children", "Children under 17", { type: "number", min: 0 }), inp("w4Other", "Other dependents", { type: "number", min: 0 })),
        inp("w4OtherIncome", "Other income for the year, not from jobs ($, optional)", { inputmode: "decimal" }),
        inp("w4Deductions", "Deductions beyond the standard deduction ($, optional)", { inputmode: "decimal" }),
        inp("w4Extra", "Extra tax to hold back each paycheck ($, optional)", { inputmode: "decimal" }),
        el("h3", {}, "DOL apprentice agreement"),
        sel("education", "Education", [["nohs", "Not a high school graduate"], ["hs", "High school graduate or GED"], ["some", "Some college or associate's"], ["bach", "Bachelor's"], ["mast", "Master's"], ["doc", "Doctorate or professional"]]),
        sel("veteran", "Veteran status", [["non", "Not a veteran"], ["vet", "Veteran"], ["nonElig", "Not a veteran, other eligible person"], ["vetElig", "Veteran, eligible person"], ["none", "Prefer not to say"]]),
        sel("employment", "At this shop I'm a", [["new", "New employee"], ["current", "Current employee"]]),
        sel("preAppr", "Did you finish a pre-apprenticeship program?", [["no", "No"], ["yes", "Yes"]]), inp("preApprName", "If yes, its name and address"),
        el("p", { class: "small muted" }, "The next three are voluntary. The Department of Labor asks for them for its reports; they're never used for hiring."),
        sel("sex", "Sex", [["male", "Male"], ["female", "Female"], ["none", "Prefer not to say"]]),
        sel("ethnicity", "Ethnicity", [["hispanic", "Hispanic or Latino"], ["not", "Not Hispanic or Latino"], ["none", "Prefer not to say"]]),
        el("div", { class: "small" }, "Race (any that apply)", ...[["aian", "American Indian or Alaska Native"], ["asian", "Asian"], ["black", "Black or African American"], ["nhpi", "Native Hawaiian or Other Pacific Islander"], ["white", "White"], ["none", "Prefer not to say"]]
          .map(([v2, l]) => el("label", { class: "chk", style: "border:0" }, el("input", { type: "checkbox", name: "race", value: v2, checked: (p.race || []).includes(v2) }), el("span", {}, l)))),
        el("h3", {}, "Emergency contact"),
        inp("emergencyName", "Name"), el("div", { class: "grid3" }, inp("emergencyPhone", "Phone", { type: "tel" }), inp("emergencyRel", "Relationship")),
        el("button", { class: "btn", type: "submit" }, "Save my details"));
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(f), o = {};
        for (const [k, v2] of fd.entries()) if (k !== "race" && !/^prior\d/.test(k)) o[k] = v2;
        o.race = fd.getAll("race"); o.w4TwoJobs = fd.get("w4TwoJobs") === "on";
        o.prior = [0, 1, 2, 3].map((i) => ({ name: fd.get(`prior${i}name`), hours: fd.get(`prior${i}hours`) })).filter((x) => x.name);
        if (!o.ssn) delete o.ssn;
        try { const r = await call({ action: "apprProfile", profile: o }); ctx.toast(r.profile.missing.length ? `Saved. Still needed: ${r.profile.missing.length}` : "Saved. All set."); sec.dataset.loaded = ""; sec.open = false; drawOne(); }
        catch (x) { ctx.toast(x.message); }
      });
      sec.append(f);
    });
    return sec;
  }

  async function review(hid, approve) { try { R = { ...R, ...(await call({ action: "apprReview", slug: R.slug, id: hid, approve })) }; drawOne(); } catch (e) { ctx.toast(e.message); } }
  let armed = null;
  function confirmTwice(what) { if (armed === what) { armed = null; return true; } armed = what; ctx.toast(`Tap again to ${what}`); setTimeout(() => { armed = null; }, 4000); return false; }

  window.BBAppr = { show };
})();
