// Instant booking: pick a barber (or first available), then one of THEIR services (each barber prices their own), then a
// time, then your details. Booked right away. ?barber=<slug> ("Book with Snow") starts at that barber's menu.
(async () => {
  const { api, el } = BW;
  const app = document.getElementById("app"), intro = document.getElementById("intro");
  const preset = new URLSearchParams(location.search);
  let D;
  try { D = await api("/api/schedule?instant=1"); }
  catch (e) {
    if (e.status === 404) { location.replace("/booking" + location.search); return; }
    intro.textContent = "Booking couldn't load. Refresh, or call the shop."; return;
  }
  const S = { service: D.services.find((s) => s.id === preset.get("service")) || null, barber: preset.get("barber") || preset.get("artist") || null, day: null, slot: null, days: null };
  if (S.barber && S.barber !== "any" && !D.barbers.some((b) => b.slug === S.barber)) S.barber = null;
  const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);
  const nameOf = (slug) => D.barbers.find((b) => b.slug === slug)?.name || "";

  if (!D.services.length || !D.barbers.length) {
    intro.textContent = "Online booking isn't open yet.";
    app.append(el("p", {}, D.phone ? `Call or text ${D.phone} to book.` : "Please call the shop to book."));
    return;
  }

  function step(n, title, done, body, change) {
    return el("section", { class: "form-part", "aria-label": title },
      el("h2", { style: "display:flex;justify-content:space-between;align-items:baseline;gap:12px" }, `${n}. ${title}`,
        done && change ? el("button", { class: "linkbtn", type: "button", onclick: change, style: "font-size:1rem" }, "Change") : null),
      body);
  }

  async function loadTimes() {
    S.days = null; S.day = null; S.slot = null; render();
    try { const r = await api(`/api/schedule?instant=1&service=${encodeURIComponent(S.service.id)}&barber=${encodeURIComponent(S.barber)}`); S.days = r.days; S.day = r.days[0] || null; S.cashTerms = r.cashTerms || ""; S.cashPrice = r.cashPrice || ""; }
    catch (e) { S.days = []; S.err = e.message; }
    render();
  }

  if (!document.getElementById("payCss")) document.head.append(el("style", { id: "payCss" }, `
    .pay-opt{display:flex;gap:12px;align-items:flex-start;border:1.5px solid var(--field);border-radius:var(--radius);padding:12px 14px;margin:0 0 8px;cursor:pointer}
    .pay-opt input{width:20px;height:20px;margin:2px 0 0;accent-color:var(--sign);flex:none}.pay-opt .pay-sub{display:block;font-weight:400;color:var(--graphite);font-size:.9375rem}
    .pay-opt:has(input:checked){border-color:var(--sign-dark);background:var(--soft)}
    fieldset.field{border:0;padding:0;margin:0 0 18px}fieldset.field legend{font-weight:600;margin-bottom:8px}
    .cash-terms{border-left:3px solid var(--sign);padding:10px 0 2px 14px;margin:6px 0 0}.cash-terms .check{font-size:.95rem;line-height:1.5}
    .book-terms{color:var(--graphite);margin:4px 0 14px;line-height:1.55}`));
  function render() {
    const many = D.barbers.length > 1;
    intro.textContent = `${many ? "Pick your barber, then a service" : "Pick a service"} and a time. You're booked right away. Times are shop time (${D.timeZone}).`;
    app.textContent = "";
    if (!many && !S.barber) S.barber = D.barbers[0].slug;
    const offers = (s, slug) => !s.barbers || !s.barbers.length || s.barbers.includes(slug);
    const bookable = (s) => !s.barbers || !s.barbers.length || s.barbers.some((b) => D.barbers.some((x) => x.slug === b));
    const card = { type: "button", class: "choice", style: "text-align:left;font:inherit;color:inherit;display:flex;align-items:center;gap:14px" };
    const face = (b) => b.photo ? el("img", { src: b.photo, alt: "", width: 52, height: 52, style: "width:52px;height:52px;border-radius:50%;object-fit:cover;flex:none" })
      : el("span", { "aria-hidden": "true", style: "width:52px;height:52px;border-radius:50%;flex:none;display:grid;place-items:center;background:var(--soft);color:var(--ink);font:700 18px var(--head)" },
        b.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase());

    // 1. Barber (each barber has their own menu and prices)
    if (many) {
      if (!S.barber) {
        const list = el("div", { class: "choices" });
        list.append(el("button", { ...card, onclick: () => { S.barber = "any"; S.service = null; render(); } },
          el("span", { "aria-hidden": "true", style: "width:52px;height:52px;border-radius:50%;flex:none;display:grid;place-items:center;background:var(--sign);color:var(--on-sign, #fff);font:700 22px var(--head)" }, "⚡"),
          el("span", {}, el("strong", { style: "display:block" }, "First available"), el("span", {}, "Whoever has the soonest opening"))));
        for (const b of D.barbers) list.append(el("button", { ...card, onclick: () => { S.barber = b.slug; if (S.service && !offers(S.service, b.slug)) S.service = null; render(); } },
          face(b), el("span", {}, el("strong", { style: "display:block" }, b.name), el("span", {}, "See their services and prices"))));
        app.append(step(1, "Barber", false, list));
        return;
      }
      const who = S.barber === "any" ? null : D.barbers.find((b) => b.slug === S.barber);
      app.append(step(1, "Barber", true, el("p", { style: "margin:0;display:flex;align-items:center;gap:12px" }, who ? face(who) : null, el("strong", {}, who ? who.name : "First available")),
        () => { S.barber = null; S.service = null; S.days = null; render(); }));
    }

    // 2. Service: this barber's own menu; for First available, every bookable service (with the barber's name when two barbers price it differently)
    const n = many ? 2 : 1;
    if (!S.service) {
      const list = el("div", { class: "choices" });
      const menu = D.services.filter(bookable).filter((s) => S.barber === "any" || offers(s, S.barber));
      const dupe = (s) => menu.filter((x) => x.name.toLowerCase() === s.name.toLowerCase()).length > 1;
      for (const s of menu) {
        const by = S.barber === "any" && dupe(s) && s.barbers ? s.barbers.map(nameOf).filter(Boolean).join(", ") : "";
        list.append(el("button", { type: "button", class: "choice", style: "text-align:left;font:inherit;color:inherit",
          onclick: () => { S.service = s; if (S.barber === "any") { const pool = D.barbers.filter((b) => offers(s, b.slug)); if (pool.length === 1) S.barber = pool[0].slug; } loadTimes(); } },
          el("strong", {}, s.name), el("span", {}, [s.priceLabel, mins(s.durationMin), by].filter(Boolean).join(" · "))));
      }
      if (!menu.length) list.append(el("p", { class: "muted" }, "Nothing bookable online with this barber yet. Pick someone else or call the shop."));
      app.append(step(n, "Service", false, list));
      return;
    }
    app.append(step(n, "Service", true, el("p", { style: "margin:0" }, el("strong", {}, S.service.name), ` · ${[S.service.priceLabel, mins(S.service.durationMin)].filter(Boolean).join(" · ")}`),
      () => { S.service = null; S.days = null; render(); }));

    // 3. Time
    if (!S.days) { app.append(step(n + 1, "Time", false, el("p", { class: "muted" }, "Finding open times…"))); return; }
    if (!S.days.length) {
      app.append(step(n + 1, "Time", false, el("div", { class: "panel" }, el("h3", {}, "No open times"),
        el("p", { style: "margin:0" }, `Nothing open in the next few weeks${S.barber !== "any" ? ` with ${nameOf(S.barber).split(" ")[0]}. Try First available` : ""}${D.phone ? `, or call ${D.phone}` : ""}.`))));
      return;
    }
    if (!S.slot) {
      const dayRow = el("div", { class: "day-row", role: "group", "aria-label": "Choose a day" });
      for (const x of S.days) {
        const [wd, rest] = x.label.split(", ");
        dayRow.append(el("button", { type: "button", class: "day", "aria-pressed": String(x === S.day), onclick: () => { S.day = x; render(); } },
          el("span", { class: "wd" }, wd), el("span", { class: "dt" }, rest), el("span", { class: "n" }, `${x.slots.length} open`)));
      }
      const grid = el("div", { class: "slot-grid" });
      for (const s of S.day.slots) grid.append(el("button", { type: "button", class: "slot", onclick: () => { S.slot = s; render(); } }, s.label));
      app.append(step(n + 1, "Time", false, el("div", {}, dayRow, el("div", { class: "slots" }, el("h2", {}, S.day.label), grid))));
      return;
    }
    const who = S.barber === "any" ? "the first available barber" : nameOf(S.barber);
    app.append(step(n + 1, "Time", true, el("p", { style: "margin:0" }, el("strong", {}, `${S.day.label} at ${S.slot.label}`), who ? ` with ${who}` : ""),
      () => { S.slot = null; render(); }));

    // 4. You
    const f = el("form", { class: "form", novalidate: true });
    const field = (name, label, attrs, hint) => el("div", { class: "field", "data-f": name }, el("label", { for: `f-${name}` }, label),
      el("input", { id: `f-${name}`, name, ...attrs }), hint ? el("p", { class: "hint" }, hint) : null, el("div", { class: "err" }));
    f.append(el("div", { class: "hp", "aria-hidden": "true" }, el("label", {}, "Website ", el("input", { type: "text", name: "website", tabindex: "-1", autocomplete: "off" }))),
      field("name", "Your name", { type: "text", autocomplete: "name", required: true, maxlength: 80 }),
      field("phone", "Mobile phone", { type: "tel", autocomplete: "tel", inputmode: "tel", required: true }, "So the shop can reach you about your appointment."),
      field("email", "Email (optional)", { type: "email", autocomplete: "email", inputmode: "email" }, "For your confirmation and a reminder."),
      el("div", { class: "field" }, el("label", { class: "check" }, el("input", { type: "checkbox", name: "textOk" }),
        el("span", {}, `Text me appointment confirmations and reminders from ${D.shopName || "the shop"}. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. `,
          el("a", { href: "/terms#sms", target: "_blank", rel: "noopener" }, "Terms"), " & ", el("a", { href: "/privacy", target: "_blank", rel: "noopener" }, "Privacy")))),
      el("div", { class: "field", "data-f": "note" }, el("label", { for: "f-note" }, "Anything we should know? (optional)"), el("textarea", { id: "f-note", name: "note", rows: 2, maxlength: 300 })));

    // How they'll pay (both at the shop; nothing is charged online). Cash needs an explicit agreement.
    const P = D.pay || {};
    if (P.ask) {
      const opt = (v, label, sub) => el("label", { class: "pay-opt" }, el("input", { type: "radio", name: "pay", value: v, required: true }),
        el("span", {}, el("strong", {}, label), sub ? el("span", { class: "pay-sub" }, sub) : null));
      const cashBox = el("div", { class: "cash-terms", hidden: true },
        el("label", { class: "check" }, el("input", { type: "checkbox", name: "cashAgree" }), el("span", {}, S.cashTerms)),
        el("div", { class: "err" }));
      cashBox.dataset.f = "cashAgree";
      const payField = el("fieldset", { class: "field", "data-f": "pay" }, el("legend", {}, "How you'll pay at the shop"),
        opt("card", "Card", S.service.price != null ? `${S.service.priceLabel || ""} · pay when your service is done` : "Pay when your service is done"),
        opt("cash", "Cash", S.cashPrice ? `${S.cashPrice} · ${P.cashDiscount ? `$${P.cashDiscount} off for paying cash` : ""}` : "Pay in cash at your appointment"),
        el("div", { class: "err" }), cashBox);
      payField.addEventListener("change", () => { cashBox.hidden = f.querySelector("input[name=pay]:checked")?.value !== "cash"; });
      f.append(payField);
    }
    f.append(el("p", { class: "book-terms small" }, D.bookingTerms || "", " By booking, you agree to the ", el("a", { href: "/terms#booking", target: "_blank", rel: "noopener" }, "booking terms"), "."));
    const err = el("p", { class: "form-error", role: "alert", hidden: true });
    const btn = el("button", { class: "btn sign", type: "submit" }, `Book ${S.service.name}`);
    f.append(err, btn);
    f.addEventListener("submit", async (e) => {
      e.preventDefault(); err.hidden = true;
      f.querySelectorAll(".field.invalid").forEach((x) => { x.classList.remove("invalid"); const m = x.querySelector(".err"); if (m) m.textContent = ""; });
      const d = new FormData(f);
      btn.disabled = true; btn.textContent = "Booking…";
      try {
        const r = await api("/api/schedule", { body: { instant: true, service: S.service.id, barber: S.barber, start: S.slot.start,
          name: d.get("name"), phone: d.get("phone"), email: d.get("email"), textOk: d.get("textOk") === "on", note: d.get("note"), website: d.get("website"),
          pay: d.get("pay") || undefined, cashAgree: d.get("cashAgree") === "on", termsVersion: D.termsVersion } });
        done(r);
      } catch (x) {
        btn.disabled = false; btn.textContent = `Book ${S.service.name}`;
        for (const [k, msg] of Object.entries(x.data?.fields || {})) { const box = f.querySelector(`[data-f="${k}"]`); if (box) { box.classList.add("invalid"); box.querySelector(".err").textContent = msg; } }
        err.textContent = x.message; err.hidden = false;
        if (x.data?.taken) { S.slot = null; setTimeout(loadTimes, 1200); }
      }
    });
    app.append(step(n + 2, "Your details", false, f));
  }

  function done(r) {
    intro.textContent = "You're booked.";
    app.textContent = "";
    app.append(el("div", { class: "panel", tabindex: "-1", id: "bookedBox" },
      el("h2", {}, r.when),
      el("p", {}, `${r.service} with ${r.barber}${r.price ? ` · ${r.price}` : ""}.`),
      r.pay === "cash" ? el("p", { class: "notice" }, `You're paying cash${r.cashPrice ? ` (${r.cashPrice})` : ""} at your appointment. Please bring it with you${r.atm ? ": the shop's ATM isn't guaranteed to be working or to have cash" : ""}.`)
        : r.pay === "card" ? el("p", {}, "You'll pay by card at the shop.") : null,
      D.prep ? el("p", {}, D.prep) : null,
      el("div", { class: "actions", style: "margin-top:18px" },
        el("a", { class: "btn", href: r.ics }, "Add to my calendar"),
        BW.shop && BW.shop.address ? el("a", { class: "btn line", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(BW.shop.address)}`, rel: "noopener" }, "Directions") : null,
        el("a", { class: "btn line", href: r.statusUrl }, "View your booking"))));
    document.getElementById("bookedBox").focus({ preventScroll: true });
  }

  if (S.service && S.barber) loadTimes(); else render();
})();
