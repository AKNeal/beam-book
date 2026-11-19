/* Beam inbox: the Apprenticeship screen (lib/apprentice.js).
   An apprentice sees their own hours (toward the shop's required hours), the checkoffs and the course materials, and logs hours.
   The Owner / Site manager picks who is an apprentice, signs off hours and checkoffs, and edits the checklist and materials. */
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
  .appr h3{margin:16px 0 4px;font-size:18px}`;

  async function show(c, slug) {
    ctx = c; ctx.only("apprView"); if (!document.getElementById("apprCss")) document.head.append(el("style", { id: "apprCss" }, css));
    const v = document.getElementById("apprView"); v.className = "appr"; v.replaceChildren(el("p", { class: "muted" }, "Loading…"));
    who = slug || null;
    try { R = await call({ action: "apprView", slug: who || undefined }); } catch (e) { v.replaceChildren(el("p", { class: "notice" }, e.message)); return; }
    R.owner && !who ? drawOwner() : drawOne();
  }

  // ---------- owner: everyone ----------
  function drawOwner() {
    const v = document.getElementById("apprView"); v.textContent = "";
    v.append(el("h1", {}, "Apprenticeship"));
    const sec = el("section", { class: "panel" }, el("h2", {}, "Apprentices"));
    if (!R.apprentices.length) sec.append(el("p", { class: "muted" }, "Nobody yet. Pick a team member below to start their apprenticeship. They log in with their own Beam login and see their hours, checkoffs and course materials."));
    for (const a of R.apprentices) sec.append(el("div", { class: "row" },
      el("div", {}, el("strong", {}, a.name), el("div", { class: "meta" }, `${fmtH(a.approvedHours)} of ${fmtH(R.settings.goalHours)} hours signed off (${a.pct}%)${a.pendingHours ? ` · ${fmtH(a.pendingHours)} waiting for you` : ""} · ${a.checksDone}/${a.checksTotal} checkoffs`)),
      el("div", { class: "actions", style: "margin:0" }, el("button", { class: "btn sm", type: "button", onclick: () => show(ctx, a.slug) }, "Open"),
        el("button", { class: "btn sm line", type: "button", onclick: async () => { if (!confirmTwice(`end ${a.name}'s apprenticeship`)) return; try { await call({ action: "apprSet", slug: a.slug, on: false }); show(ctx); } catch (e) { ctx.toast(e.message); } } }, "Remove"))));
    const others = R.team.filter((t) => !R.apprentices.some((a) => a.slug === t.slug));
    if (others.length) {
      const sel = el("select", {}, others.map((t) => el("option", { value: t.slug }, t.name)));
      sec.append(el("div", { class: "actions", style: "margin-top:14px" }, sel, el("button", { class: "btn", type: "button", onclick: async () => { try { await call({ action: "apprSet", slug: sel.value, on: true }); ctx.toast("Apprenticeship started"); show(ctx); } catch (e) { ctx.toast(e.message); } } }, "Make apprentice")));
    }
    sec.append(el("p", { class: "small muted" }, "An apprentice needs their own login: Team → add them with their email and link the login to their name. They get an email to set a password."));
    v.append(appsPanel(), sec, setupPanel());
  }

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
        el("div", {}, el("strong", {}, `${a.first} ${a.last}`),
          el("div", { class: "meta" }, el("a", { href: `mailto:${a.email}` }, a.email), " · ", el("a", { href: `tel:${a.phone}` }, a.phone), " · ", new Date(a.at).toLocaleDateString()),
          a.about ? el("p", { class: "small", style: "white-space:pre-line;margin:6px 0 0" }, a.about) : null),
        el("div", { class: "actions", style: "margin:0" }, st,
          el("button", { class: "btn sm line", type: "button", onclick: async () => { if (!confirm(`Delete ${a.first}'s application?`)) return; try { R.applications = (await call({ action: "apprApp", id: a.id, status: "delete" })).applications; drawOwner(); } catch (e) { ctx.toast(e.message); } } }, "Delete"))));
    }
    return sec;
  }

  function setupPanel() {
    const box = el("details", { class: "panel" }, el("summary", {}, el("h2", { style: "display:inline" }, "Hours, checkoffs and materials")));
    const goal = el("input", { type: "number", min: 1, step: 1, value: R.settings.goalHours, style: "max-width:140px" });
    const chk = el("textarea", { rows: 10 }, R.checklist.map((c) => `${c.group} | ${c.title}`).join("\n"));
    const mat = el("textarea", { rows: 6, placeholder: "Volume 1: Professional Foundations | https://…" }, R.materials.map((m) => `${m.title} | ${m.url}`).join("\n"));
    const save = async () => {
      try {
        await call({ action: "apprSettings", goalHours: goal.value });
        const old = new Map(R.checklist.map((c) => [`${c.group}|${c.title}`, c.id]));
        await call({ action: "apprChecklist", items: chk.value.split("\n").map((l) => { const [g, ...t] = l.split("|"); const title = t.length ? t.join("|").trim() : g.trim(), group = t.length ? g.trim() : "Checkoffs"; return { id: old.get(`${group}|${title}`), group, title }; }).filter((x) => x.title) });
        await call({ action: "apprMaterials", items: mat.value.split("\n").map((l) => { const i = l.lastIndexOf("|"); return i > 0 ? { title: l.slice(0, i).trim(), url: l.slice(i + 1).trim() } : null; }).filter(Boolean) });
        ctx.toast("Saved"); show(ctx);
      } catch (e) { ctx.toast(e.message); }
    };
    box.append(el("label", {}, "Required hours", goal), el("p", { class: "small muted" }, "Alaska's barber apprenticeship is 1,650 hours. Check the current requirement with the state board."),
      el("label", {}, "Checkoffs (one per line: group | item)", chk),
      el("label", {}, "Course materials (one per line: title | https link)", mat),
      el("p", { class: "small muted" }, "Links to the Level Up Barbering Series or anything else the apprentice should study. Keep shared files view-only."),
      el("button", { class: "btn", type: "button", onclick: save }, "Save"));
    return box;
  }

  // ---------- one apprentice (their own view, or the owner's view of them) ----------
  function drawOne() {
    const v = document.getElementById("apprView"); v.textContent = "";
    const owner = R.owner;
    if (owner) v.append(el("p", { style: "margin:24px 0 0" }, el("button", { class: "linkbtn", type: "button", onclick: () => show(ctx) }, "← All apprentices")));
    v.append(el("h1", {}, owner ? R.name : "My apprenticeship"));
    v.append(el("section", { class: "panel" },
      el("div", { class: "big" }, `${fmtH(R.approvedHours)} / ${fmtH(R.goalHours)} hours`),
      el("div", { class: "prog" }, el("i", { style: `width:${R.pct}%` })),
      el("p", { class: "muted", style: "margin:0" }, `${R.pct}% signed off${R.pendingHours ? ` · ${fmtH(R.pendingHours)} hours waiting for sign-off` : ""} · ${R.checksDone} of ${R.checksTotal} checkoffs${R.startDate ? ` · started ${R.startDate}` : ""}`),
      owner ? startEditor() : null));

    // Log hours
    const date = el("input", { type: "date", value: today(), max: today() }), hrs = el("input", { type: "number", min: 0.25, max: 16, step: 0.25, value: 8 }), note = el("input", { placeholder: "What you worked on (optional)" });
    v.append(el("section", { class: "panel" }, el("h2", {}, "Log hours"),
      el("div", { class: "grid3" }, el("label", {}, "Day", date), el("label", {}, "Hours", hrs)), el("label", {}, "Note", note),
      el("button", { class: "btn", type: "button", onclick: async () => { try { R = { ...R, ...(await call({ action: "apprLog", slug: owner ? R.slug : undefined, date: date.value, hours: hrs.value, note: note.value })) }; ctx.toast(owner ? "Hours added and signed off" : "Hours sent for sign-off"); drawOne(); } catch (e) { ctx.toast(e.message); } } }, owner ? "Add (signed off)" : "Log hours")));

    // Hours list
    const hl = el("section", { class: "panel" }, el("h2", {}, "Hours"));
    if (!R.hours.length) hl.append(el("p", { class: "muted" }, "No hours logged yet."));
    for (const h of R.hours.slice(0, 120)) {
      const acts = owner
        ? [h.status === "pending" ? el("button", { class: "btn sm", type: "button", onclick: () => review(h.id, true) }, "Sign off") : el("button", { class: "btn sm line", type: "button", onclick: () => review(h.id, false) }, "Undo"),
          el("button", { class: "btn sm line", type: "button", onclick: () => { if (confirmTwice("delete these hours")) review(h.id, "delete"); } }, "Delete")]
        : h.status === "pending" ? [el("button", { class: "btn sm line", type: "button", onclick: async () => { try { R = { ...R, ...(await call({ action: "apprDelete", id: h.id })) }; drawOne(); } catch (e) { ctx.toast(e.message); } } }, "Remove")] : [];
      hl.append(el("div", { class: "row" }, el("div", {}, el("strong", {}, `${h.date} · ${fmtH(h.hours)} h`), h.note ? el("div", { class: "meta" }, h.note) : null),
        el("div", { class: "actions", style: "margin:0;align-items:center" }, el("span", { class: "pill" + (h.status === "approved" ? " ok" : "") }, h.status === "approved" ? `Signed off${h.by ? " by " + h.by : ""}` : "Waiting for sign-off"), ...acts)));
    }
    v.append(hl);

    // Checkoffs
    const ck = el("section", { class: "panel" }, el("h2", {}, "Checkoffs"), el("p", { class: "small muted" }, owner ? "Tick each one when they've shown you they can do it." : "Your barber signs these off as you show each skill."));
    let group = null;
    for (const c of R.checklist) {
      if (c.group !== group) { group = c.group; ck.append(el("h3", {}, group)); }
      const box = el("input", { type: "checkbox", checked: c.done, disabled: !owner, "aria-label": c.title, onchange: async (e) => { try { R = { ...R, ...(await call({ action: "apprCheck", slug: R.slug, id: c.id, on: e.target.checked })) }; drawOne(); } catch (x) { ctx.toast(x.message); } } });
      ck.append(el("label", { class: "chk" }, box, el("span", {}, c.title, c.done ? el("span", { class: "meta small" }, ` · ${c.at ? new Date(c.at).toLocaleDateString() : ""}${c.by ? " · " + c.by : ""}`) : null)));
    }
    v.append(ck);

    // Materials
    const ml = el("section", { class: "panel" }, el("h2", {}, "Course materials"));
    if (!R.materials.length) ml.append(el("p", { class: "muted" }, owner ? "None yet. Add links under Apprenticeship → Hours, checkoffs and materials." : "Your barber hasn't added any materials yet."));
    for (const m of R.materials) ml.append(el("div", { class: "row" }, el("strong", {}, m.title), el("a", { class: "btn sm line", href: m.url, target: "_blank", rel: "noopener" }, "Open")));
    v.append(ml);
  }

  function startEditor() {
    const d = el("input", { type: "date", value: R.startDate || today(), style: "max-width:200px" });
    return el("div", { class: "actions", style: "margin-top:12px;align-items:end" }, el("label", { style: "margin:0" }, "Start date", d),
      el("button", { class: "btn sm line", type: "button", onclick: async () => { try { R = { ...R, ...(await call({ action: "apprStart", slug: R.slug, date: d.value })) }; ctx.toast("Saved"); drawOne(); } catch (e) { ctx.toast(e.message); } } }, "Save"));
  }
  async function review(hid, approve) { try { R = { ...R, ...(await call({ action: "apprReview", slug: R.slug, id: hid, approve })) }; drawOne(); } catch (e) { ctx.toast(e.message); } }
  let armed = null;
  function confirmTwice(what) { if (armed === what) { armed = null; return true; } armed = what; ctx.toast(`Tap again to ${what}`); setTimeout(() => { armed = null; }, 4000); return false; }

  window.BBAppr = { show };
})();
