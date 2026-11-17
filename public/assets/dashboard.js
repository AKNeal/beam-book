/* Beam inbox: the Dashboard screen (lib/analytics.js).
   Owner sees the whole shop: gross, earned, booked ahead, net, every barber, challenges, settings and the TV scoreboard link.
   A barber sees only their own numbers and pay, plus the challenges. */
(function () {
  const { el, api } = window.BW;
  const call = (body) => api("/api/admin/books", { body });
  const $$ = (n) => "$" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const pct = (n) => (n == null ? "–" : n + "%");
  const PERIODS = [["today", "Today"], ["week", "This week"], ["month", "This month"], ["next30", "Next 30 days"], ["last30", "Last 30 days"]];
  let ctx = null, period = "week", barber = "", R = null;

  const css = `
  .dash h1{font-size:44px;margin:28px 0 6px}.dash .kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin:16px 0}
  .dash .kpi{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px}.dash .kpi b{display:block;font-size:28px;line-height:1.15}
  .dash .kpi span{font-size:13px;color:var(--graphite)}.dash .kpi.hot{border:2px solid var(--ink)}
  .dash table{width:100%;border-collapse:collapse;font-size:15px}.dash th,.dash td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}.dash th{font-size:13px;color:var(--graphite);font-weight:600}
  .dash td.n,.dash th.n{text-align:right}.dash .bars{display:flex;align-items:flex-end;gap:3px;height:120px;margin:12px 0 4px}
  .dash .bars i{flex:1;background:var(--ink);border-radius:3px 3px 0 0;min-height:2px;position:relative}.dash .bars i.fut{background:repeating-linear-gradient(45deg,#999 0 3px,#ccc 3px 6px)}
  .dash .prog{height:10px;background:var(--line);border-radius:99px;overflow:hidden}.dash .prog i{display:block;height:100%;background:#d32f2f;border-radius:99px}.dash .prog i.ok{background:#15803d}
  .dash .ch{border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px;margin:10px 0;background:#fff}.dash .ch h3{margin:0 0 4px}
  .dash .ch .r{display:grid;grid-template-columns:160px 1fr 70px;gap:10px;align-items:center;font-size:14px;margin:6px 0}
  .dash section.panel{margin:18px 0}.dash .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:640px){.dash .two{grid-template-columns:1fr}}
  .dash label{display:block;font-size:14px;margin:8px 0}.dash label input,.dash label select,.dash label textarea{display:block;width:100%;margin-top:4px}
  .dash .lowrb{color:#b91c1c;font-weight:700}.dash .goodrb{color:#15803d;font-weight:700}`;

  function style() { if (!document.getElementById("dashCss")) document.head.append(el("style", { id: "dashCss" }, css)); }

  async function show(c) {
    ctx = c; style(); ctx.only("dashView");
    const v = document.getElementById("dashView"); v.className = "dash"; v.textContent = "";
    v.append(el("p", { class: "muted" }, "Loading the numbers…"));
    try { R = await call({ action: "dash", period, barber }); } catch (e) { v.textContent = ""; v.append(el("p", { class: "notice" }, e.message)); return; }
    draw();
  }

  function draw() {
    const v = document.getElementById("dashView"); v.textContent = "";
    const d = R.dash, m = d.money || {}, owner = R.owner, mineOnly = !R.barbers.length;
    v.append(el("h1", {}, mineOnly ? "My numbers" : "Dashboard"));
    const sel = R.barbers.length > 1 ? el("select", { "aria-label": "Barber", onchange: (e) => { barber = e.target.value; show(ctx); } },
      el("option", { value: "" }, "Whole shop"), R.barbers.map((b) => el("option", { value: b.slug }, b.name))) : null;
    if (sel) sel.value = barber;
    v.append(el("div", { class: "filters" }, el("div", { class: "tabs", role: "group", style: "margin:0" }, PERIODS.map(([k, label]) =>
      el("button", { class: "tab", type: "button", "aria-pressed": String(k === period), onclick: () => { period = k; show(ctx); } }, label))), sel));

    // Headline tiles
    const kp = (val, label, hot) => el("div", { class: "kpi" + (hot ? " hot" : "") }, el("b", {}, val), el("span", {}, label));
    const tiles = [kp($$(m.gross), "Gross (booked + done)", true), kp($$(m.earned), "Earned so far"), kp($$(m.projected), "Still on the books (projected)")];
    if (owner && !barber) tiles.push(kp($$(m.net), "Net to the shop", true));
    else tiles.push(kp($$(m.pay), mineOnly ? "My pay (estimate)" : "Barber pay (estimate)", true));
    tiles.push(kp(d.cuts, `Appointments (${d.done} done, ${d.upcoming} ahead)`), kp(pct(d.rebookRate), `Rebook rate (${d.rebooks} of ${d.rebookable})`, true), kp(d.newClients, "New clients"));
    v.append(el("div", { class: "kpis" }, tiles));

    // Net breakdown (owner, whole shop)
    if (owner && !barber) {
      const S = d.settings;
      const goal = period === "month" && S.monthlyGoal ? el("p", {}, el("strong", {}, `Monthly goal ${$$(S.monthlyGoal)}: `), `${Math.round(100 * m.gross / S.monthlyGoal)}% booked`) : null;
      v.append(el("section", { class: "panel" }, el("h2", {}, "Gross to net"), goal,
        el("table", {}, el("tbody", {},
          row("Gross", $$(m.gross)), row(`Cash discounts ($${S.cashDiscount} × ${S.cashShare}% paying cash)`, "− " + $$(m.disc)),
          row(S.feesPassedToClient ? "Card fees (passed to client, not taken out)" : `Card fees (${S.cardPct}% + $${S.cardFixed})`, S.feesPassedToClient ? "$0" : "− " + $$(m.card)),
          row("Barber pay (commission / booth)", "− " + $$(m.pay)), m.booth ? row("Booth rent coming in", "+ " + $$(m.booth)) : null,
          row("Shop expenses (this period's share)", "− " + $$(m.expenses)), row(el("strong", {}, "Net"), el("strong", {}, $$(m.net))))),
        el("p", { class: "small muted" }, "Projected numbers use booked appointments at menu price. Tips aren't counted.")));
    }

    // Day by day
    if (d.daily.length > 1) {
      const max = Math.max(1, ...d.daily.map((x) => x.gross));
      v.append(el("section", { class: "panel" }, el("h2", {}, "Day by day"),
        el("div", { class: "bars" }, d.daily.map((x) => el("i", { class: x.past ? "" : "fut", style: `height:${Math.round(100 * x.gross / max)}%`, title: `${x.date}: ${x.cuts} appts, ${$$(x.gross)}` }))),
        el("p", { class: "small muted" }, "Solid = done, striped = booked ahead. Hover a bar for the day.")));
    }

    // Barbers
    if (d.barbers.length > 1 || (owner && barber)) {
      v.append(el("section", { class: "panel" }, el("h2", {}, "Barbers"), el("p", { class: "small muted" }, `Rebook = the client's next cut was booked in the chair or within ${d.settings ? d.settings.rebookWindowHours : 24} hours.`),
        el("div", { style: "overflow:auto" }, el("table", {}, el("thead", {}, el("tr", {}, ["Barber", "Appts", "Rebook rate", "Rebooks", "New", "Hours", "Gross", "Pay"].map((h, i) => el("th", { class: i ? "n" : "" }, h)))),
          el("tbody", {}, [...d.barbers].sort((a, b) => (b.money?.gross || 0) - (a.money?.gross || 0)).map((b) => el("tr", {},
            el("td", {}, b.name), el("td", { class: "n" }, b.cuts),
            el("td", { class: "n " + (b.rebookRate == null ? "" : b.rebookRate < 50 ? "lowrb" : b.rebookRate >= 70 ? "goodrb" : "") }, pct(b.rebookRate)),
            el("td", { class: "n" }, `${b.rebooks}/${b.rebookable}`), el("td", { class: "n" }, b.newClients), el("td", { class: "n" }, Math.round(b.mins / 6) / 10),
            el("td", { class: "n" }, $$(b.money?.gross)), el("td", { class: "n" }, $$(b.money?.pay)))))))));
    }

    if (d.services.length) v.append(el("section", { class: "panel" }, el("h2", {}, "Top services"),
      el("table", {}, el("tbody", {}, d.services.map((s) => row(`${s.name} × ${s.count}`, $$(s.gross)))))));

    v.append(challengesPanel(owner));
    if (owner) v.append(boardPanel(), settingsPanel());
  }

  function row(a, b) { return el("tr", {}, el("td", {}, a), el("td", { class: "n" }, b)); }

  // ---------- challenges ----------
  function challengesPanel(owner) {
    const box = el("section", { class: "panel" }, el("h2", {}, "Challenges"));
    const list = R.challenges || [];
    if (!list.length) box.append(el("p", { class: "muted" }, owner ? "No challenges yet. Start a rebooking challenge below; it shows live on the shop TV." : "No challenges running right now."));
    const f = (c, v) => (c.metric === "rebookRate" ? pct(v) : v);
    for (const c of list) {
      const ch = el("div", { class: "ch" }, el("h3", {}, c.title, c.prize ? ` · 🏆 ${c.prize}` : ""),
        el("div", { class: "small muted" }, `${c.label} · goal ${f(c, c.goal)} · ${c.startDate} to ${c.endDate} · ${c.status === "live" ? `${c.daysLeft} days left` : c.status}${c.scope === "shop" ? " · whole shop" : ""}`));
      if (c.team) ch.append(el("div", { class: "r" }, el("strong", {}, "Whole shop"), el("div", { class: "prog" }, el("i", { class: c.team.pct >= 100 ? "ok" : "", style: `width:${c.team.pct}%` })), el("strong", {}, f(c, c.team.value))));
      for (const r of c.rows) ch.append(el("div", { class: "r" }, el("span", {}, r.name), el("div", { class: "prog" }, el("i", { class: r.pct >= 100 ? "ok" : "", style: `width:${r.pct}%` })),
        el("span", {}, f(c, r.value), c.metric === "rebookRate" ? el("span", { class: "small muted" }, ` (${r.rebooks}/${r.visits})`) : null)));
      if (owner) ch.append(el("div", { class: "actions", style: "margin:8px 0 0" },
        el("button", { class: "btn sm line", type: "button", onclick: () => challengeForm(box, c) }, "Edit"),
        el("button", { class: "btn sm line", type: "button", onclick: async () => { if (!confirmDelete(c.title)) return; try { R.challenges = (await call({ action: "challengeDelete", id: c.id })).challenges; draw(); ctx.toast("Challenge removed"); } catch (e) { ctx.toast(e.message); } } }, "Remove")));
      box.append(ch);
    }
    if (owner) box.append(el("button", { class: "btn", type: "button", onclick: () => challengeForm(box) }, "New challenge"));
    return box;
  }
  // A plain inline "are you sure" without a browser dialog.
  let armed = null;
  function confirmDelete(title) { if (armed === title) { armed = null; return true; } armed = title; ctx.toast(`Tap Remove again to delete "${title}"`); setTimeout(() => { armed = null; }, 4000); return false; }

  function challengeForm(box, c = {}) {
    const today = new Date().toISOString().slice(0, 10), in2w = new Date(Date.now() + 13 * 864e5).toISOString().slice(0, 10);
    const all = R.barbers;
    const form = el("form", { class: "act-form" },
      el("label", {}, "Name", el("input", { name: "title", value: c.title || "Rebook Rumble", required: true })),
      el("div", { class: "two" },
        el("label", {}, "Measures", el("select", { name: "metric" }, [["rebookRate", "Rebook rate (%)"], ["rebooks", "Rebooks (count)"], ["cuts", "Cuts"], ["newClients", "New clients"]].map(([k, l]) => el("option", { value: k, selected: (c.metric || "rebookRate") === k }, l)))),
        el("label", {}, "Goal", el("input", { name: "goal", type: "number", min: 1, step: "any", value: c.goal || 70, required: true }))),
      el("div", { class: "two" },
        el("label", {}, "Starts", el("input", { name: "startDate", type: "date", value: c.startDate || today, required: true })),
        el("label", {}, "Ends", el("input", { name: "endDate", type: "date", value: c.endDate || in2w, required: true }))),
      el("label", {}, "Who's in it", el("select", { name: "scope" }, el("option", { value: "barbers", selected: c.scope !== "shop" }, "Barber vs barber"), el("option", { value: "shop", selected: c.scope === "shop" }, "The whole shop as a team (and each barber shown)"))),
      el("fieldset", { style: "border:0;padding:0;margin:8px 0" }, el("legend", { class: "small" }, "Barbers (none ticked = everyone)"),
        all.map((b) => el("label", { style: "display:inline-flex;gap:6px;margin-right:14px" }, el("input", { type: "checkbox", name: "barbers", value: b.slug, checked: (c.barbers || []).includes(b.slug) }), b.name))),
      el("label", {}, "Prize (optional)", el("input", { name: "prize", value: c.prize || "", placeholder: "e.g. $100 cash, a day off, free product" })),
      el("div", { class: "actions" }, el("button", { class: "btn", type: "submit" }, c.id ? "Save challenge" : "Start challenge"), el("button", { class: "btn line", type: "button", onclick: () => form.remove() }, "Cancel")));
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); const fd = new FormData(form);
      try {
        R.challenges = (await call({ action: "challengeSave", id: c.id, title: fd.get("title"), metric: fd.get("metric"), goal: Number(fd.get("goal")), startDate: fd.get("startDate"), endDate: fd.get("endDate"), scope: fd.get("scope"), prize: fd.get("prize"), barbers: fd.getAll("barbers") })).challenges;
        draw(); ctx.toast("Challenge saved. It's on the scoreboard now.");
      } catch (x) { ctx.toast(x.message); }
    });
    box.append(form); form.querySelector("input").focus();
  }

  // ---------- TV scoreboard ----------
  function boardPanel() {
    const out = el("div");
    const get = async (reset) => { try { const r = await call({ action: "boardLink", reset }); const url = location.origin + r.url;
      out.replaceChildren(el("div", { class: "linkbox" }, el("strong", {}, "Scoreboard link"), el("input", { readonly: true, value: url, onclick: (e) => e.target.select() }),
        el("div", { class: "actions" }, el("a", { class: "btn sm", href: url, target: "_blank" }, "Open"), el("button", { class: "btn sm line", type: "button", onclick: () => navigator.clipboard?.writeText(url).then(() => ctx.toast("Copied")) }, "Copy"),
          el("button", { class: "btn sm line", type: "button", onclick: () => get(true) }, "New link (old one stops)")))); } catch (e) { ctx.toast(e.message); } };
    return el("section", { class: "panel" }, el("h2", {}, "Shop TV scoreboard"),
      el("p", { class: "muted" }, "A full-screen page for the TV in the shop: live challenges, this week's rebook and cut leaders, and who's open now. It never shows money."),
      el("button", { class: "btn line", type: "button", onclick: () => get(false) }, "Show the link"), out);
  }

  // ---------- settings ----------
  function settingsPanel() {
    const box = el("details", { class: "panel" }, el("summary", {}, el("h2", { style: "display:inline" }, "Dashboard settings and barber pay")));
    box.addEventListener("toggle", async () => {
      if (!box.open || box.dataset.ok) return; box.dataset.ok = "1";
      let C; try { C = await call({ action: "dashConfig" }); } catch (e) { return ctx.toast(e.message); }
      const S = C.settings, num = (name, label, val, step = "any") => el("label", {}, label, el("input", { name, type: "number", step, min: 0, value: val }));
      const form = el("form", {},
        el("div", { class: "two" }, num("cashShare", "Clients paying cash (%)", S.cashShare), num("cashDiscount", "Cash discount ($ per visit)", S.cashDiscount)),
        el("div", { class: "two" }, num("cardPct", "Card fee (%)", S.cardPct), num("cardFixed", "Card fee ($ per charge)", S.cardFixed)),
        el("label", { style: "display:flex;gap:8px;align-items:center" }, el("input", { type: "checkbox", name: "feesPassedToClient", checked: S.feesPassedToClient, style: "width:auto" }), "Card service fees are passed to the client"),
        el("div", { class: "two" }, num("rebookWindowHours", "Counts as a rebook if booked within (hours after the cut)", S.rebookWindowHours, 1), num("weeklyGoalCuts", "Weekly goal: cuts (shop TV)", S.weeklyGoalCuts, 1)),
        num("monthlyGoal", "Monthly goal: gross ($)", S.monthlyGoal, 1),
        el("label", {}, "Monthly shop expenses (one per line: name, amount)", el("textarea", { name: "expenses", rows: 4, placeholder: "Rent, 2400\nProducts, 300" }, S.expenses.map((x) => `${x.name}, ${x.monthly}`).join("\n"))),
        el("button", { class: "btn", type: "submit" }, "Save settings"));
      form.addEventListener("submit", async (e) => {
        e.preventDefault(); const fd = new FormData(form), o = Object.fromEntries(fd);
        o.feesPassedToClient = fd.has("feesPassedToClient");
        o.expenses = String(o.expenses || "").split("\n").map((l) => { const i = l.lastIndexOf(","); return i > 0 ? { name: l.slice(0, i).trim(), monthly: Number(l.slice(i + 1).replace(/[$\s]/g, "")) } : null; }).filter(Boolean);
        try { await call({ action: "dashSettings", settings: o }); ctx.toast("Settings saved"); show(ctx); } catch (x) { ctx.toast(x.message); }
      });
      const pays = el("div", {}, el("h3", {}, "Barber pay"), C.barbers.map((b) => {
        const p = C.pay[b.slug] || { model: "commission", rate: 50 };
        const model = el("select", {}, [["commission", "Commission"], ["booth", "Booth rent"], ["owner", "Owner (no pay counted)"]].map(([k, l]) => el("option", { value: k, selected: p.model === k }, l)));
        const amt = el("input", { type: "number", min: 0, step: "any", value: p.model === "booth" ? p.weeklyRent : p.rate ?? 50, style: "width:110px" });
        const unit = el("span", { class: "small muted" }, p.model === "booth" ? "$/week rent" : "% to barber");
        model.addEventListener("change", () => { unit.textContent = model.value === "booth" ? "$/week rent" : model.value === "owner" ? "" : "% to barber"; amt.hidden = model.value === "owner"; });
        amt.hidden = p.model === "owner";
        return el("div", { class: "team-row" }, el("strong", {}, b.name), el("div", { class: "acts" }, model, amt, unit,
          el("button", { class: "btn sm", type: "button", onclick: async () => { try { await call({ action: "dashPay", slug: b.slug, pay: { model: model.value, rate: amt.value, weeklyRent: amt.value } }); ctx.toast(`${b.name}'s pay saved`); } catch (x) { ctx.toast(x.message); } } }, "Save")));
      }), el("p", { class: "small muted" }, "Barbers without a setting are counted at 50% commission."));
      box.append(form, pays);
    });
    return box;
  }

  window.BBDash = { show };
})();
