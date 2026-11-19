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
  .dash .kpi{background:var(--white);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px}.dash .kpi b{display:block;font-size:28px;line-height:1.15}
  .dash .kpi span{font-size:13px;color:var(--graphite)}.dash .kpi.hot{border:2px solid var(--ink)}
  .dash table{width:100%;border-collapse:collapse;font-size:15px}.dash th,.dash td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}.dash th{font-size:13px;color:var(--graphite);font-weight:600}
  .dash td.n,.dash th.n{text-align:right}.dash .bars{display:flex;align-items:flex-end;gap:3px;height:120px;margin:12px 0 4px}
  .dash .bars i{flex:1;background:var(--ink);border-radius:3px 3px 0 0;min-height:2px;position:relative}.dash .bars i.fut{background:repeating-linear-gradient(45deg,#999 0 3px,#ccc 3px 6px)}
  .dash .prog{height:10px;background:var(--line);border-radius:99px;overflow:hidden}.dash .prog i{display:block;height:100%;background:#d32f2f;border-radius:99px}.dash .prog i.ok{background:#15803d}
  .dash .ch{border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px;margin:10px 0;background:var(--white)}.dash .ch h3{margin:0 0 4px}
  .dash .ch .r{display:grid;grid-template-columns:160px 1fr 70px;gap:10px;align-items:center;font-size:14px;margin:6px 0}
  .dash section.panel{margin:18px 0}.dash .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:640px){.dash .two{grid-template-columns:1fr}}
  .dash label{display:block;font-size:14px;margin:8px 0}.dash label input,.dash label select,.dash label textarea{display:block;width:100%;margin-top:4px}
  .dash .lowrb{color:#b91c1c;font-weight:700}.dash .goodrb{color:#15803d;font-weight:700}
  .dash .heat{display:grid;grid-template-columns:44px repeat(13,minmax(0,1fr));gap:3px;font-size:12px;align-items:center}.dash .heat i{display:block;height:22px;border-radius:4px;background:var(--line)}
  .dash .heat span{color:var(--graphite);text-align:center}.dash .mix{display:flex;height:16px;border-radius:99px;overflow:hidden;margin:8px 0}.dash .mix i{display:block;height:100%}
  .dash .charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}.dash .chartbox{background:var(--white);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px}
  .dash .chartbox h3{margin:0 0 8px;font-size:16px}.dash svg.chart{width:100%;height:auto;display:block}.dash svg .grid{stroke:var(--line);stroke-width:1}.dash svg .ax{fill:var(--graphite);font-size:11px}
  .dash svg .ln{fill:none;stroke:var(--sign);stroke-width:3;stroke-linejoin:round;stroke-linecap:round}.dash svg .pt{fill:var(--sign);stroke:var(--white);stroke-width:2}.dash svg .pt.now{stroke:var(--ink)}
  .dash .vbars{display:grid;grid-template-columns:repeat(8,1fr);gap:6px;align-items:end;height:170px}.dash .vb{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:4px}
  .dash .vb i{display:block;width:100%;background:color-mix(in srgb,var(--sign) 55%,var(--white));border-radius:6px 6px 0 0;min-height:2px}.dash .vb.now i{background:var(--sign);box-shadow:0 0 0 2px var(--ink)}
  .dash .vb .v{font-size:12px;font-weight:700}.dash .vb .l{font-size:11px;color:var(--graphite);white-space:nowrap}
  .dash .hb{display:grid;grid-template-columns:110px 1fr 52px;gap:8px;align-items:center;font-size:14px;margin:6px 0}.dash .hb .track{height:12px;background:var(--line);border-radius:99px;overflow:hidden}
  .dash .hb i{display:block;height:100%;background:var(--sign);border-radius:99px}.dash .hb i.ok{background:#15803d}.dash .hb i.low{background:#b91c1c}.dash .hb b{text-align:right}
  .dash .nr{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:15px}`;

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
    const d = R.dash, m = d.money || {}, owner = R.owner, mineOnly = Boolean(R.mine);
    v.append(el("h1", {}, mineOnly ? "My numbers" : "Dashboard"));
    const sel = R.barbers.length > 1 ? el("select", { "aria-label": "Barber", onchange: (e) => { barber = e.target.value; show(ctx); } },
      el("option", { value: "" }, "Whole shop"), R.barbers.map((b) => el("option", { value: b.slug }, b.name))) : null;
    if (sel) sel.value = barber;
    v.append(el("div", { class: "filters" }, el("div", { class: "tabs", role: "group", style: "margin:0" }, PERIODS.map(([k, label]) =>
      el("button", { class: "tab", type: "button", "aria-pressed": String(k === period), onclick: () => { period = k; show(ctx); } }, label))), sel));

    // Headline tiles
    const kp = (val, label, hot) => el("div", { class: "kpi" + (hot ? " hot" : "") }, el("b", {}, val), el("span", {}, label));
    const hide = R.hideMoney, tiles = [];
    if (!hide) {
      tiles.push(kp($$(m.gross), "Gross (booked + done)", true), kp($$(m.earned), "Earned so far"), kp($$(m.projected), "Still on the books (projected)"));
      if (R.isOwner && !barber) tiles.push(kp($$(m.net), "Net to the shop", true));
      else tiles.push(kp($$(mineOnly ? m.take ?? m.pay : m.pay), mineOnly ? "My take (estimate, before tips)" : "Barber pay (estimate)", true));
    }
    tiles.push(kp(d.cuts, `Appointments (${d.done} done, ${d.upcoming} ahead)`), kp(pct(d.rebookRate), `Rebook rate (${d.rebooks} of ${d.rebookable})`, true), kp(d.newClients, "New clients"));
    if (!hide) tiles.push(kp(d.avgTicket == null ? "–" : "$" + d.avgTicket.toFixed(2), "Average ticket"));
    tiles.push(kp(pct(d.utilization), "Chair utilization (booked vs open hours)"));
    if (d.noShowRate != null) tiles.push(kp(pct(d.noShowRate), `No-show rate (${d.noShows} no-shows, ${d.cancelled} cancelled; Squire history)`));
    if (m.tips && !hide) tiles.push(kp($$(m.tips), mineOnly ? "My tips (through checkout)" : "Tips to barbers (through checkout)"));
    v.append(el("div", { class: "kpis" }, tiles));
    v.append(chartsPanel(d));

    // Net breakdown (owner, whole shop)
    if (R.isOwner && !barber && !hide) {
      const S = d.settings;
      const gp = S.monthlyGoal ? Math.round(100 * m.gross / S.monthlyGoal) : 0;
      const goal = period === "month" && S.monthlyGoal ? el("div", { style: "margin:6px 0 14px" },
        el("p", { style: "margin:0 0 6px" }, el("strong", {}, `Monthly goal ${$$(S.monthlyGoal)}: `), `${gp}% (earned + booked)`),
        el("div", { class: "prog" }, el("i", { class: gp >= 100 ? "ok" : "", style: `width:${Math.min(100, gp)}%` }))) : null;
      v.append(el("section", { class: "panel" }, el("h2", {}, "Gross to net"), goal,
        el("table", {}, el("tbody", {},
          row("Gross", $$(m.gross)), row(`Cash discounts ($${S.cashDiscount} × ${S.cashShare}% paying cash)`, "− " + $$(m.disc)),
          row(`Card fees (${S.cardPct}% + $${S.cardFixed}, less what credit-card clients pay toward them)`, "− " + $$(m.card)),
          m.tips ? row("Tips through checkout (go to barbers, not counted in gross)", $$(m.tips)) : null,
          row("Barber pay (commission / booth)", "− " + $$(m.pay)), m.booth ? row("Booth rent coming in", "+ " + $$(m.booth)) : null,
          row("Shop expenses (this period's share)", "− " + $$(m.expenses)), row(el("strong", {}, "Net"), el("strong", {}, $$(m.net))))),
        el("p", { class: "small muted" }, "Projected numbers use booked appointments at menu price. Tips aren't counted.")));
    }

    // Day by day
    if (d.daily.length > 1) {
      const val = (x) => (hide ? x.cuts : x.gross), max = Math.max(1, ...d.daily.map(val));
      v.append(el("section", { class: "panel" }, el("h2", {}, "Day by day"),
        el("div", { class: "bars" }, d.daily.map((x) => el("i", { class: x.past ? "" : "fut", style: `height:${Math.round(100 * val(x) / max)}%`, title: `${x.date}: ${x.cuts} appts${hide ? "" : ", " + $$(x.gross)}` }))),
        el("p", { class: "small muted" }, "Solid = done, striped = booked ahead. Hover a bar for the day.")));
    }

    // Barbers
    if (d.barbers.length > 1 || (owner && barber)) {
      v.append(el("section", { class: "panel" }, el("h2", {}, "Barbers"), el("p", { class: "small muted" }, `Rebook = the client's next cut was booked in the chair or within ${d.settings ? d.settings.rebookWindowHours : 24} hours.`),
        el("div", { style: "overflow:auto" }, el("table", {}, el("thead", {}, el("tr", {}, ["Barber", "Appts", "Rebook rate", "Rebooks", "New", "Hours", ...(hide ? [] : ["Gross", "Pay"])].map((h, i) => el("th", { class: i ? "n" : "" }, h)))),
          el("tbody", {}, [...d.barbers].sort((a, b) => hide ? (b.cuts - a.cuts) : (b.money?.gross || 0) - (a.money?.gross || 0)).map((b) => el("tr", {},
            el("td", {}, b.name), el("td", { class: "n" }, b.cuts),
            el("td", { class: "n " + (b.rebookRate == null ? "" : b.rebookRate < 50 ? "lowrb" : b.rebookRate >= 70 ? "goodrb" : "") }, pct(b.rebookRate)),
            el("td", { class: "n" }, `${b.rebooks}/${b.rebookable}`), el("td", { class: "n" }, b.newClients), el("td", { class: "n" }, Math.round(b.mins / 6) / 10),
            hide ? null : el("td", { class: "n" }, $$(b.money?.gross)), hide ? null : el("td", { class: "n" }, $$(b.money?.pay)))))))));
    }

    if (d.services.length) v.append(el("section", { class: "panel" }, el("h2", {}, "Top services"),
      el("table", {}, el("tbody", {}, d.services.map((s) => row(hide ? s.name : `${s.name} × ${s.count}`, hide ? String(s.count) : $$(s.gross)))))));

    // Payment mix (from checkout)
    const nCash = m.paidCash || 0, nCard = m.paidCard || 0;
    if (nCash + nCard) v.append(el("section", { class: "panel" }, el("h2", {}, "Payment mix"),
      el("div", { class: "mix", role: "img", "aria-label": `${nCash} cash, ${nCard} card` }, el("i", { style: `width:${100 * nCash / (nCash + nCard)}%;background:var(--ink)` }), el("i", { style: `width:${100 * nCard / (nCash + nCard)}%;background:var(--sign)` })),
      el("p", { class: "small" }, `Cash ${nCash} (${Math.round(100 * nCash / (nCash + nCard))}%) · Card ${nCard} (${Math.round(100 * nCard / (nCash + nCard))}%). Checkouts through Beam only.`)));

    // Busiest hours (last 8 weeks of finished visits)
    const H = d.heat || {}, hv = Object.values(H);
    if (hv.length) {
      const max = Math.max(1, ...hv), hours = Array.from({ length: 13 }, (_, i) => i + 8), days = [[2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"], [1, "Mon"]];
      const lab = (h) => (h % 12 || 12) + (h < 12 ? "a" : "p");
      v.append(el("section", { class: "panel" }, el("h2", {}, "Busiest hours"), el("p", { class: "small muted" }, "Finished appointments over the last 8 weeks. Darker = busier."),
        el("div", { class: "heat" }, [el("span", {}), ...hours.map((h) => el("span", {}, lab(h))),
          ...days.filter(([wd]) => hours.some((h) => H[`${wd}-${h}`])).flatMap(([wd, name]) => [el("span", { style: "text-align:left" }, name),
            ...hours.map((h) => { const n = H[`${wd}-${h}`] || 0; return el("i", { title: `${name} ${lab(h)}: ${n}`, style: n ? `background:color-mix(in srgb, var(--sign) ${Math.round(15 + 85 * n / max)}%, transparent)` : "" }); })])])));
    }

    // Needs a rebook
    if (d.needsRebook && d.needsRebook.length) {
      const nm = d.names || {};
      v.append(el("section", { class: "panel" }, el("h2", {}, "Needs a rebook"),
        el("p", { class: "small muted" }, "Seen in the last 3 weeks with nothing on the books. Oldest first: reach out before they book somewhere else."),
        d.needsRebook.map((c) => el("div", { class: "nr" }, el("span", {}, el("strong", {}, c.name), mineOnly ? "" : ` · ${nm[c.barber] || ""}`),
          el("span", { class: "muted" }, `${c.service ? c.service + " · " : ""}${c.daysAgo === 0 ? "today" : c.daysAgo === 1 ? "yesterday" : c.daysAgo + " days ago"}`)))));
    }

    v.append(challengesPanel(owner), ...rebookPanels());
    if (owner) v.append(boardPanel(), historyPanel(), ...(R.isOwner ? [settingsPanel()] : []));
  }

  // ---------- graphs: week by week ----------
  function chartsPanel(d) {
    const W = d.weekly; if (!W || !W.weeks.length) return null;
    const wk = (k) => new Date(k + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const sec = el("section", { class: "panel" }, el("h2", {}, "Last 8 weeks"));
    const grid = el("div", { class: "charts" });
    // 1) rebook rate by week (line)
    const pts = W.weeks.map((w, i) => ({ i, v: w.rebookRate, w }));
    const Wd = 520, Hd = 180, P = 28, x = (i) => P + i * ((Wd - 2 * P) / Math.max(1, pts.length - 1)), y = (v) => Hd - P - (v / 100) * (Hd - 2 * P);
    const valid = pts.filter((p) => p.v != null);
    const NS = "http://www.w3.org/2000/svg", svg = (tag, a = {}, kids = []) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); kids.forEach((c) => c && n.append(c)); return n; };
    const line = svg("svg", { viewBox: `0 0 ${Wd} ${Hd}`, class: "chart", role: "img", "aria-label": "Rebook rate by week" }, [
      ...[0, 50, 100].map((g) => svg("g", {}, [svg("line", { x1: P, x2: Wd - P, y1: y(g), y2: y(g), class: "grid" }), Object.assign(svg("text", { x: 2, y: y(g) + 4, class: "ax" }), { textContent: g + "%" })])),
      valid.length > 1 ? svg("polyline", { points: valid.map((p) => `${x(p.i)},${y(p.v)}`).join(" "), class: "ln" }) : null,
      ...valid.map((p) => { const c = svg("circle", { cx: x(p.i), cy: y(p.v), r: p.w.current ? 6 : 4.5, class: p.w.current ? "pt now" : "pt" }); c.append(Object.assign(svg("title"), { textContent: `Week of ${wk(p.w.week)}: ${p.v}% (${p.w.rebooks} of ${p.w.rebookable})` })); return c; }),
      ...pts.map((p) => Object.assign(svg("text", { x: x(p.i), y: Hd - 6, class: "ax", "text-anchor": "middle" }), { textContent: wk(p.w.week) })),
    ]);
    grid.append(el("div", { class: "chartbox" }, el("h3", {}, "Rebook rate by week"), line));
    // 2) appointments by week (bars)
    const maxC = Math.max(1, ...W.weeks.map((w) => w.cuts));
    grid.append(el("div", { class: "chartbox" }, el("h3", {}, "Appointments by week"),
      el("div", { class: "vbars" }, W.weeks.map((w) => el("div", { class: "vb" + (w.current ? " now" : ""), title: `Week of ${wk(w.week)}: ${w.cuts} appointments` },
        el("span", { class: "v" }, String(w.cuts)), el("i", { style: `height:${Math.round(100 * w.cuts / maxC)}%` }), el("span", { class: "l" }, wk(w.week)))))));
    // 3) rebook rate by barber, this period (horizontal bars)
    const bb = (d.barbers || []).filter((b) => b.rebookable).sort((a, b) => b.rebookRate - a.rebookRate);
    if (bb.length > 1) grid.append(el("div", { class: "chartbox" }, el("h3", {}, "Rebook rate by barber (this period)"),
      bb.map((b) => el("div", { class: "hb" }, el("span", {}, b.name), el("div", { class: "track" }, el("i", { class: b.rebookRate >= 70 ? "ok" : b.rebookRate < 50 ? "low" : "", style: `width:${b.rebookRate}%` })), el("b", {}, pct(b.rebookRate))))));
    sec.append(grid);
    return sec;
  }

  // Past weeks' rebook winners, and this week's rebooks (from the data: bookings + Squire history)
  function rebookPanels() {
    const W = R.dash.weekly; if (!W) return [];
    const wk = (k) => new Date(k + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const out = [];
    const rb = el("section", { class: "panel" }, el("h2", {}, `Rebooks this week (${W.rebooks.length})`),
      el("p", { class: "small muted" }, "Clients who booked their next visit in the chair (or within the rebook window) this week."));
    if (!W.rebooks.length) rb.append(el("p", { class: "muted" }, "None yet this week."));
    for (const r of W.rebooks) rb.append(el("div", { class: "nr" }, el("span", {}, el("strong", {}, r.client), ` · ${r.barber}`), el("span", { class: "muted" }, `${wk(r.on)}${r.next ? ` → back ${wk(r.next)}` : ""}`)));
    out.push(rb);
    const past = W.weeks.filter((w) => !w.current).reverse();
    if (past.some((w) => w.winner)) {
      const wn = el("section", { class: "panel" }, el("h2", {}, "Weekly rebook winners"),
        el("p", { class: "small muted" }, `Highest rebook rate each week (at least ${W.minVisits} finished visits that week to qualify).`));
      for (const w of past) wn.append(el("div", { class: "nr" }, el("span", {}, el("strong", {}, `Week of ${wk(w.week)}`)),
        w.winner ? el("span", {}, "🏆 ", el("strong", {}, w.winner.name), el("span", { class: "muted" }, ` · ${w.winner.rebookRate}% (${w.winner.rebooks} of ${w.winner.visits})`)) : el("span", { class: "muted" }, "No qualifying barber")));
      out.push(wn);
    }
    return out;
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

  // ---------- Squire history (Appointments CSV export) ----------
  // Read in the browser; only the columns below are sent. Emails and phones never leave this computer.
  function parseCsv(text) {
    const rows = []; let row = [], f = "", q = false; text = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) { const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
      else f += c; }
    row.push(f); if (row.some((x) => x !== "")) rows.push(row);
    const head = (rows.shift() || []).map((h) => h.trim());
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
  }
  function historyPanel() {
    const out = el("p", { class: "small" });
    const input = el("input", { type: "file", accept: ".csv,text/csv", multiple: true });
    input.addEventListener("change", async () => {
      const files = [...input.files]; if (!files.length) return;
      let rows = [];
      for (const f of files) {
        const r = parseCsv(await f.text());
        if (r.length && !("Staff First Name" in r[0] && "Date" in r[0])) { out.textContent = `${f.name} doesn't look like a Squire Appointments export.`; return; }
        rows = rows.concat(r.map((x) => ({ staff: `${x["Staff First Name"] || ""} ${x["Staff Last Name"] || ""}`.trim(), date: x["Date"], time: x["Time"],
          cdate: x["Created At"], ctime: x["Created Time"], pay: x["Payment"], tip: x["Tip"], cost: x["Service Cost"], status: x["Status"],
          client: `${x["Client First Name"] || ""} ${x["Client Last Name"] || ""}`.trim(), service: x["Service Name"], dur: x["Duration"] })));
      }
      out.textContent = `Sending ${rows.length} appointments…`;
      try {
        let last = null; for (let i = 0; i < rows.length; i += 1500) last = await call({ action: "squireHistory", rows: rows.slice(i, i + 1500) });
        out.textContent = `Done: ${rows.length} appointments read. History now covers ${last.from} to ${last.to}.` + (last.unknownBarbers.length ? ` Not matched to a barber on Beam: ${last.unknownBarbers.join(", ")}.` : "");
        show(ctx);
      } catch (e) { out.textContent = e.message; }
    });
    return el("details", { class: "panel" }, el("summary", {}, el("h2", { style: "display:inline" }, "Squire history")),
      el("p", {}, "Bring in past appointments so the dashboard has your history from day one: rebook rates, cash vs card, tips and no-shows."),
      el("p", { class: "small muted" }, "In Squire: Reports → More → Appointments → pick dates (30 days max per file) → Export CSV. Pick one or more files here. Only the appointment details are sent; client emails and phone numbers stay on this computer. Uploading the same dates again just updates them."),
      el("label", {}, "Squire Appointments CSV files", input), out,
      el("button", { class: "btn sm line", type: "button", onclick: async () => { if (!confirmDelete("Squire history")) return; try { const r = await call({ action: "squireHistoryClear" }); ctx.toast(`Removed ${r.months} months of Squire history`); show(ctx); } catch (e) { ctx.toast(e.message); } } }, "Remove Squire history"));
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
