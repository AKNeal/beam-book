/* Beam inbox: the Checkout screen (lib/payments.js).
   Today's appointments → pick one → tip → Cash (with the cash discount) or Card on the front-desk reader.
   Card: the reader reads the card; if it's a credit card the shop's credit-card fee is added and shown here before
   charging. The Owner also sets up Stripe, the reader and the fee rate here. */
(function () {
  const { el, api } = window.BW;
  const call = (body) => api("/api/admin/books", { body });
  const $$ = (n) => "$" + Number(n || 0).toFixed(2);
  let ctx = null, date = null, list = [], sel = null, Q = null, tip = 0, poll = null, isOwner = false;

  const css = `
  .ck h1{font-size:44px;margin:28px 0 6px}.ck .appt{display:grid;grid-template-columns:80px 1fr auto;gap:10px;align-items:center;padding:12px 10px;border-bottom:1px solid var(--line);cursor:pointer;background:transparent;border-left:0;border-right:0;border-top:0;width:100%;text-align:left;font:inherit;color:inherit}
  .ck .appt[aria-current="true"]{background:var(--soft)}.ck .paid{color:#15803d;font-weight:700;font-size:13px}.ck .due{color:var(--graphite);font-size:13px}
  .ck .grid2{display:grid;grid-template-columns:minmax(260px,1fr) minmax(300px,1.2fr);gap:24px;align-items:start}@media(max-width:860px){.ck .grid2{grid-template-columns:1fr}}
  .ck .tips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.ck .tips button[aria-pressed="true"]{background:var(--ink);color:#fff}
  .ck .opts{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}.ck .opt{border:2px solid var(--line);border-radius:var(--radius);padding:14px}
  .ck .opt b{display:block;font-size:30px}.ck .opt small{color:var(--graphite)}.ck .big{width:100%;padding:14px;font-size:17px;margin-top:10px}
  .ck .state{border:2px dashed var(--ink);border-radius:var(--radius);padding:16px;margin:12px 0;font-size:16px}
  .ck .test{background:#fff7e0;border:1px solid #e0b000;border-radius:var(--radius);padding:10px 12px;margin:10px 0;font-size:14px}`;

  async function show(c) {
    ctx = c; isOwner = Boolean(c.D?.me?.full);
    if (!document.getElementById("ckCss")) document.head.append(el("style", { id: "ckCss" }, css));
    c.only("checkoutView"); const v = document.getElementById("checkoutView"); v.className = "ck";
    await load(); draw();
  }
  async function load() { try { const r = await call({ action: "payDay", date }); list = r.appts; ctx.status = r.status; } catch (e) { ctx.toast(e.message); list = []; } }

  function draw() {
    const v = document.getElementById("checkoutView"); v.textContent = "";
    v.append(el("h1", {}, "Checkout"));
    const d = el("input", { type: "date", value: date || new Date().toISOString().slice(0, 10), onchange: async (e) => { date = e.target.value; sel = null; await load(); draw(); } });
    v.append(el("div", { class: "filters" }, d, ctx.status?.testMode ? el("span", { class: "pill wait" }, "Stripe test mode: no real money moves") : null));
    const left = el("div", { class: "list" }), right = el("div", { id: "ckPay" });
    if (!list.length) left.append(el("p", { class: "empty" }, "No appointments that day."));
    for (const a of list) left.append(el("button", { class: "appt", type: "button", "aria-current": String(a.id === sel), onclick: () => pick(a.id) },
      el("strong", {}, a.time), el("div", {}, el("div", {}, a.client || "Walk-in"), el("div", { class: "due" }, `${a.service} · ${a.barberName}`)),
      a.paid ? el("span", { class: "paid" }, `Paid ${a.paid.method} ${$$(a.paid.total)}`) : el("span", { class: "due" }, "Not paid")));
    v.append(el("div", { class: "grid2" }, left, right));
    if (isOwner) v.append(setupPanel());
    if (sel) drawPay();
  }

  async function pick(id) { sel = id; tip = 0; stopPoll(); await requote(); draw(); }
  async function requote() { try { Q = await call({ action: "payQuote", appt: sel, tip }); } catch (e) { ctx.toast(e.message); } }

  function drawPay(state) {
    const box = document.getElementById("ckPay"); if (!box || !Q) return; box.textContent = "";
    box.append(el("section", { class: "panel" }, el("h2", { style: "margin-top:0" }, Q.client || "Walk-in"), el("p", { class: "muted" }, `${Q.service} · ${$$(Q.subtotal)}`)));
    const p = box.firstChild;
    if (Q.paid) { p.append(el("p", { class: "paid", style: "font-size:18px" }, `Paid ${Q.paid.method}: ${$$(Q.paid.total)}`),
      el("p", { class: "small muted" }, `Service ${$$(Q.paid.subtotal)}${Q.paid.discount ? ` − cash discount ${$$(Q.paid.discount)}` : ""}${Q.paid.surcharge ? ` + credit card fee ${$$(Q.paid.surcharge)}` : ""}${Q.paid.tip ? ` + tip ${$$(Q.paid.tip)}` : ""}`)); return; }
    const pct = (x) => Math.round(Q.subtotal * x * 100) / 100;
    p.append(el("div", {}, el("strong", {}, "Tip"), el("div", { class: "tips" },
      [["None", 0], ["15%", pct(0.15)], ["20%", pct(0.2)], ["25%", pct(0.25)]].map(([l, t]) => el("button", { class: "btn sm line", type: "button", "aria-pressed": String(tip === t), onclick: async () => { tip = t; await requote(); drawPay(); } }, l + (t ? ` (${$$(t)})` : ""))),
      el("input", { type: "number", min: 0, step: "0.01", placeholder: "Other $", style: "width:100px", onchange: async (e) => { tip = Math.max(0, Number(e.target.value) || 0); await requote(); drawPay(); } }))));
    p.append(el("div", { class: "opts" },
      el("div", { class: "opt" }, el("small", {}, "Cash"), el("b", {}, $$(Q.cash.total)), el("small", {}, Q.cash.discount ? el("strong", {}, `Pay cash, save ${$$(Q.cash.discount)}`) : ""),
        el("button", { class: "btn big", type: "button", disabled: Boolean(state), onclick: cash }, "Paid cash")),
      el("div", { class: "opt" }, el("small", {}, "Card"), el("b", {}, $$(Q.card.total)), el("small", {}, Q.surchargePct > 0 ? `credit cards +${Q.surchargePct}% (${$$(Q.card.creditFee)}); debit no fee` : "no card fee"),
        el("button", { class: "btn big", type: "button", disabled: !Q.cardReady || Boolean(state), onclick: card }, Q.cardReady ? "Card on reader" : "Reader not set up"))));
    if (state) p.append(state);
  }

  async function cash() { try { await call({ action: "payCash", appt: sel, tip }); ctx.toast("Paid cash"); await load(); await requote(); draw(); } catch (e) { ctx.toast(e.message); } }

  async function card() {
    try { await call({ action: "payCard", appt: sel, tip }); } catch (e) { return ctx.toast(e.message); }
    cardState({ state: "waiting" }); startPoll();
  }
  function cardState(s) {
    const cancel = el("button", { class: "btn sm line", type: "button", onclick: async () => { stopPoll(); await call({ action: "payCardCancel", appt: sel }).catch(() => {}); drawPay(); } }, "Cancel");
    let box;
    if (s.state === "waiting") box = el("div", { class: "state" }, el("strong", {}, "Waiting for the card on the reader…"), el("div", {}, cancel),
      Q.testMode ? el("div", { class: "test" }, "Test mode: pretend the client tapped ",
        el("button", { class: "linkbtn", type: "button", onclick: () => call({ action: "payTestTap", kind: "credit" }).catch((e) => ctx.toast(e.message)) }, "a credit card"), " or ",
        el("button", { class: "linkbtn", type: "button", onclick: () => call({ action: "payTestTap", kind: "debit" }).catch((e) => ctx.toast(e.message)) }, "a debit card"), ".") : null);
    else if (s.state === "confirm") box = el("div", { class: "state" },
      el("div", { style: "font-size:18px" }, s.funding === "credit" ? `Credit card: ${$$(s.surcharge)} credit card fee added.` : `${s.funding === "debit" ? "Debit" : "Card"}: no card fee.`),
      el("div", { style: "font-size:26px;font-weight:700;margin:6px 0" }, `Total ${$$(s.total)}`),
      el("p", { class: "small muted" }, "Tell the client the total. They can cancel or pay another way."),
      el("div", { class: "actions" }, el("button", { class: "btn", type: "button", onclick: async () => { try { await call({ action: "payCardConfirm", appt: sel }); cardState({ state: "processing" }); startPoll(); } catch (e) { ctx.toast(e.message); } } }, `Charge ${$$(s.total)}`), cancel));
    else if (s.state === "processing") box = el("div", { class: "state" }, "Charging the card…");
    else if (s.state === "failed") box = el("div", { class: "state" }, el("strong", {}, s.message), el("div", {}, cancel));
    drawPay(box);
  }
  function startPoll() { stopPoll(); poll = setInterval(async () => {
    let s; try { s = await call({ action: "payCardStatus", appt: sel }); } catch (e) { return; }
    if (s.state === "paid") { stopPoll(); ctx.toast(`Paid ${$$(s.paid.total)}`); await load(); await requote(); draw(); }
    else if (s.state === "canceled" || s.state === "none") { stopPoll(); drawPay(); }
    else if (s.state === "confirm") { stopPoll(); cardState(s); }
    else cardState(s);
  }, 1500); }
  function stopPoll() { if (poll) clearInterval(poll); poll = null; }

  // ---------- Owner: Stripe, reader, fee rate ----------
  function setupPanel() {
    const box = el("details", { class: "panel", style: "margin-top:24px", id: "payments" }, el("summary", {}, el("h2", { style: "display:inline" }, "Payments setup")));
    box.addEventListener("toggle", async () => {
      if (!box.open || box.dataset.ok) return; box.dataset.ok = "1";
      let S; try { S = await call({ action: "paySetup" }); } catch (e) { return ctx.toast(e.message); }
      const body = el("div");
      if (!S.enabled) body.append(el("p", { class: "notice" }, "Card payments aren't switched on for Beam yet. Cash checkout works now."));
      else {
        body.append(el("p", {}, el("strong", {}, "Stripe: "), S.account ? (S.account.ready ? "connected and ready" : "started, needs finishing") : "not connected", S.testMode ? " (test mode)" : ""),
          el("button", { class: "btn line", type: "button", onclick: async () => { try { location.href = (await call({ action: "payConnect" })).url; } catch (e) { ctx.toast(e.message); } } }, S.account ? "Finish or update Stripe" : "Connect Stripe"));
        if (S.account) {
          const code = el("input", { placeholder: S.testMode ? "Leave blank for a test reader" : "Code shown on the reader", style: "max-width:260px" });
          body.append(el("p", { style: "margin-top:16px" }, el("strong", {}, "Reader: "), S.reader ? `${S.reader.label || "Front desk"}${S.reader.simulated ? " (simulated)" : ""}${S.reader.online === false ? " · offline" : ""}` : "none yet"),
            el("div", { class: "actions" }, code, el("button", { class: "btn sm", type: "button", onclick: async () => { try { await call({ action: "payReader", code: code.value }); ctx.toast("Reader added"); box.dataset.ok = ""; box.open = false; box.open = true; } catch (e) { ctx.toast(e.message); } } }, "Add reader")));
        }
      }
      const rate = el("input", { type: "number", min: 0, max: 3, step: "0.1", value: S.surchargePct, style: "width:90px" });
      body.append(el("p", { style: "margin-top:16px" }, el("strong", {}, "Credit card fee passed to the client: "), rate, "% ",
        el("button", { class: "btn sm line", type: "button", onclick: async () => { try { await call({ action: "payRates", surchargePct: rate.value }); ctx.toast("Saved"); } catch (e) { ctx.toast(e.message); } } }, "Save")),
        el("p", { class: "small muted" }, "Leave at 0 if your menu prices are card prices and cash gets a discount (the usual setup). If you add a fee: credit cards only (never debit), at most 3% and no more than what cards cost the shop, and it must be posted at the counter and on your site. The cash discount is set in Dashboard settings."));
      box.append(body);
    });
    if (/[?&]payments=1/.test(location.search)) setTimeout(() => (box.open = true), 0);
    return box;
  }

  window.BBCheckout = { show };
  // Back from Stripe's setup pages: open Checkout with the setup panel.
  if (/[?&]payments=1/.test(location.search)) { let n = 0; const t = setInterval(() => { const nav = document.getElementById("nav"); if (nav && !nav.hidden) { clearInterval(t); document.getElementById("viewCheckout")?.click(); } else if (++n > 40) clearInterval(t); }, 250); }
})();
