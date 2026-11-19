/* Beam inbox: the Setup checklist (lib/setup.js). Each login sees what it still needs to do;
   the Owner / Administrator also see everyone's list and can add, edit or remove items. */
(function () {
  const { el, api } = window.BW;
  const call = (body) => api("/api/admin/books", { body });
  let ctx = null, R = null, who = "me";
  const css = `.su h1{font-size:44px;margin:28px 0 6px}.su .prog{height:12px;background:var(--line);border-radius:99px;overflow:hidden;margin:8px 0 4px}.su .prog i{display:block;height:100%;background:var(--sign);border-radius:99px}
  .su .it{display:grid;grid-template-columns:30px 1fr auto;gap:12px;align-items:start;padding:14px 0;border-bottom:1px solid var(--line)}.su .it input[type=checkbox]{width:22px;height:22px;margin-top:2px;accent-color:var(--sign)}
  .su .it.done .t{text-decoration:line-through;opacity:.6}.su .t{font-weight:700}.su .d{white-space:pre-line;color:var(--graphite);font-size:15px;margin-top:4px}.su .who{font-size:12px;color:var(--graphite)}
  .su .pill{font-size:12px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);margin-left:6px}.su .people{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
  .su label{display:block;font-size:14px;margin:8px 0}.su label input,.su label textarea,.su label select{display:block;width:100%;margin-top:4px}`;

  async function show(c) {
    ctx = c; ctx.only("setupView");
    if (!document.getElementById("suCss")) document.head.append(el("style", { id: "suCss" }, css));
    const v = document.getElementById("setupView"); v.className = "su"; v.replaceChildren(el("p", { class: "muted" }, "Loading…"));
    try { R = await call({ action: "setupList" }); } catch (e) { v.replaceChildren(el("p", { class: "notice" }, e.message)); return; }
    draw();
  }

  function draw() {
    const v = document.getElementById("setupView"); v.textContent = "";
    v.append(el("h1", {}, "Setup checklist"));
    const me = R.items.filter((i) => i.mine);
    if (R.full) {
      const ppl = (R.people || []).filter((p) => R.items.some((i) => i.user === p.id));
      // Tabs show first names only ("Isacc"), unless two people share a first name.
      const first = (p) => String(p.name || "").trim().split(/\s+/)[0] || p.name;
      const tab = (p) => ppl.filter((q) => first(q).toLowerCase() === first(p).toLowerCase()).length > 1 ? p.name : first(p);
      v.append(el("div", { class: "people" }, [["me", "Mine"], ["all", "Everyone"], ...ppl.map((p) => [p.id, tab(p)])].map(([k, l]) =>
        el("button", { class: "btn sm" + (who === k ? "" : " line"), type: "button", onclick: () => { who = k; draw(); } }, l))));
    }
    const list = who === "me" ? me : who === "all" ? R.items : R.items.filter((i) => i.user === who);
    const done = list.filter((i) => i.done).length;
    v.append(el("section", { class: "panel" },
      el("p", { style: "margin:0" }, el("strong", {}, `${done} of ${list.length} done`), who === "all" ? " across everyone" : ""),
      el("div", { class: "prog" }, el("i", { style: `width:${list.length ? Math.round(100 * done / list.length) : 0}%` })),
      !list.length ? el("p", { class: "muted" }, "Nothing on this list.") : null,
      ...[...list].sort((a, b) => a.done - b.done || a.order - b.order).map(item)));
    if (R.full) v.append(editor());
  }

  function item(i) {
    const box = el("input", { type: "checkbox", checked: i.done, disabled: i.autoDone || (!i.mine && !R.full), "aria-label": i.title,
      onchange: async (e) => { try { R = await call({ action: "setupDone", id: i.id, done: e.target.checked }); draw(); ctx.toast(e.target.checked ? "Done" : "Not done yet"); refreshBadge(); } catch (x) { ctx.toast(x.message); } } });
    return el("div", { class: "it" + (i.done ? " done" : "") }, box,
      el("div", {}, el("div", { class: "t" }, i.title, i.auto ? el("span", { class: "pill" }, i.autoDone ? "done automatically" : "ticks itself off") : null),
        !i.mine || who === "all" ? el("div", { class: "who" }, i.userName) : null,
        i.details ? el("div", { class: "d" }, i.details) : null,
        i.doneAt && !i.autoDone ? el("div", { class: "who" }, `Done ${new Date(i.doneAt).toLocaleDateString()}${i.doneBy ? " by " + i.doneBy : ""}`) : null),
      el("div", { class: "actions", style: "margin:0;flex-direction:column;align-items:flex-end" },
        i.link ? el("a", { class: "btn sm line", href: i.link.url, target: i.link.url.startsWith("/") ? "_self" : "_blank", rel: "noopener" }, i.link.label) : null,
        R.full ? el("button", { class: "linkbtn small", type: "button", onclick: () => edit(i) }, "Edit") : null));
  }

  let editing = null;
  function edit(i) { editing = i; draw(); document.getElementById("suForm")?.scrollIntoView({ behavior: "smooth" }); }
  function editor() {
    const i = editing || {};
    const f = el("form", { id: "suForm" },
      el("label", {}, "Whose list", el("select", { name: "user", required: true }, (R.people || []).map((p) => el("option", { value: p.id, selected: (i.user || (who !== "me" && who !== "all" ? who : "")) === p.id }, p.name)))),
      el("label", {}, "What needs doing", el("input", { name: "title", value: i.title || "", required: true, maxlength: 120 })),
      el("label", {}, "How (optional)", el("textarea", { name: "details", rows: 4 }, i.details || "")),
      el("div", { class: "two" }, el("label", {}, "Button label (optional)", el("input", { name: "linkLabel", value: i.link?.label || "" })), el("label", {}, "Button link (https://… or /page)", el("input", { name: "linkUrl", value: i.link?.url || "" }))),
      el("div", { class: "actions" }, el("button", { class: "btn", type: "submit" }, i.id ? "Save item" : "Add item"),
        i.id ? el("button", { class: "btn line", type: "button", onclick: async () => { try { R = await call({ action: "setupRemove", id: i.id }); editing = null; draw(); refreshBadge(); } catch (e) { ctx.toast(e.message); } } }, "Remove") : null,
        i.id ? el("button", { class: "btn line", type: "button", onclick: () => { editing = null; draw(); } }, "Cancel") : null));
    f.addEventListener("submit", async (e) => { e.preventDefault(); try { R = await call({ action: "setupSave", id: i.id, ...Object.fromEntries(new FormData(f)) }); editing = null; draw(); ctx.toast("Saved"); refreshBadge(); } catch (x) { ctx.toast(x.message); } });
    return el("section", { class: "panel" }, el("h2", {}, i.id ? "Edit item" : "Add an item"), f);
  }

  // A banner under the menu shows how many of your own items are left. Once you're done it goes away;
  // the Owner / Administrator then get a plain "Setup" link in the menu to manage everyone's lists.
  async function refreshBadge() {
    const a = document.getElementById("viewSetup"), bn = document.getElementById("setupBanner"); if (!a) return;
    try {
      const r = await call({ action: "setupList", all: false }), mine = r.items.filter((i) => i.mine !== false);
      const left = mine.filter((i) => !i.done).length, total = mine.length;
      a.hidden = Boolean(left) || !r.full; a.textContent = "Setup";
      if (bn) {
        bn.hidden = !left;
        document.getElementById("setupBannerLeft").textContent = left ? `· ${left} of ${total} thing${total === 1 ? "" : "s"} left to finish` : "";
        document.getElementById("setupBannerBar").style.width = `${total ? Math.round(100 * (total - left) / total) : 0}%`;
      }
    } catch { a.hidden = true; if (bn) bn.hidden = true; }
  }

  window.BBSetup = { show, refreshBadge };
})();
