// Instant booking: pick a service, then a barber (or anyone), then a time, then your details. Booked right away.
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
    try { const r = await api(`/api/schedule?instant=1&service=${encodeURIComponent(S.service.id)}&barber=${encodeURIComponent(S.barber)}`); S.days = r.days; S.day = r.days[0] || null; }
    catch (e) { S.days = []; S.err = e.message; }
    render();
  }

  function render() {
    intro.textContent = `Pick a service${D.barbers.length > 1 ? ", a barber" : ""} and a time. You're booked right away. Times are shop time (${D.timeZone}).`;
    app.textContent = "";

    // 1. Service
    if (!S.service) {
      const list = el("div", { class: "choices" });
      for (const s of D.services) {
        list.append(el("button", { type: "button", class: "choice", style: "text-align:left;font:inherit;color:inherit", onclick: () => { S.service = s; S.barber = S.barber && (!s.barbers || s.barbers.includes(S.barber)) ? S.barber : null; if (D.barbers.length === 1) S.barber = D.barbers[0].slug; S.barber ? loadTimes() : render(); } },
          el("strong", {}, s.name), el("span", {}, [s.priceLabel, mins(s.durationMin)].filter(Boolean).join(" · "))));
      }
      app.append(step(1, "Service", false, list));
      return;
    }
    app.append(step(1, "Service", true, el("p", { style: "margin:0" }, el("strong", {}, S.service.name), ` · ${[S.service.priceLabel, mins(S.service.durationMin)].filter(Boolean).join(" · ")}`),
      () => { S.service = null; S.days = null; render(); }));

    // 2. Barber
    const pool = D.barbers.filter((b) => !S.service.barbers || S.service.barbers.includes(b.slug));
    if (!S.barber) {
      const list = el("div", { class: "choices" });
      if (pool.length > 1) list.append(el("button", { type: "button", class: "choice", style: "text-align:left;font:inherit;color:inherit", onclick: () => { S.barber = "any"; loadTimes(); } },
        el("strong", {}, "First available"), el("span", {}, "See the most open times")));
      for (const b of pool) list.append(el("button", { type: "button", class: "choice", style: "text-align:left;font:inherit;color:inherit", onclick: () => { S.barber = b.slug; loadTimes(); } }, el("strong", {}, b.name)));
      app.append(step(2, "Barber", false, list));
      return;
    }
    app.append(step(2, "Barber", true, el("p", { style: "margin:0" }, el("strong", {}, S.barber === "any" ? "First available" : nameOf(S.barber))),
      pool.length > 1 ? () => { S.barber = null; S.days = null; render(); } : null));

    // 3. Time
    if (!S.days) { app.append(step(3, "Time", false, el("p", { class: "muted" }, "Finding open times…"))); return; }
    if (!S.days.length) {
      app.append(step(3, "Time", false, el("div", { class: "panel" }, el("h3", {}, "No open times"),
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
      app.append(step(3, "Time", false, el("div", {}, dayRow, el("div", { class: "slots" }, el("h2", {}, S.day.label), grid))));
      return;
    }
    const who = S.barber === "any" ? nameOf(S.slot.barber) : nameOf(S.barber);
    app.append(step(3, "Time", true, el("p", { style: "margin:0" }, el("strong", {}, `${S.day.label} at ${S.slot.label}`), who ? ` with ${who}` : ""),
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
        "Text me a confirmation and a reminder the day before. Reply STOP any time.")),
      el("div", { class: "field", "data-f": "note" }, el("label", { for: "f-note" }, "Anything we should know? (optional)"), el("textarea", { id: "f-note", name: "note", rows: 2, maxlength: 300 })));
    const err = el("p", { class: "form-error", role: "alert", hidden: true });
    const btn = el("button", { class: "btn sign", type: "submit" }, `Book ${S.service.name}`);
    f.append(err, btn);
    f.addEventListener("submit", async (e) => {
      e.preventDefault(); err.hidden = true;
      f.querySelectorAll(".field.invalid").forEach((x) => { x.classList.remove("invalid"); const m = x.querySelector(".err"); if (m) m.textContent = ""; });
      const d = new FormData(f);
      btn.disabled = true; btn.textContent = "Booking…";
      try {
        const r = await api("/api/schedule", { body: { instant: true, service: S.service.id, barber: S.barber === "any" ? S.slot.barber : S.barber, start: S.slot.start,
          name: d.get("name"), phone: d.get("phone"), email: d.get("email"), textOk: d.get("textOk") === "on", note: d.get("note"), website: d.get("website") } });
        done(r);
      } catch (x) {
        btn.disabled = false; btn.textContent = `Book ${S.service.name}`;
        for (const [k, msg] of Object.entries(x.data?.fields || {})) { const box = f.querySelector(`[data-f="${k}"]`); if (box) { box.classList.add("invalid"); box.querySelector(".err").textContent = msg; } }
        err.textContent = x.message; err.hidden = false;
        if (x.data?.taken) { S.slot = null; setTimeout(loadTimes, 1200); }
      }
    });
    app.append(step(4, "Your details", false, f));
  }

  function done(r) {
    intro.textContent = "You're booked.";
    app.textContent = "";
    app.append(el("div", { class: "panel", tabindex: "-1", id: "bookedBox" },
      el("h2", {}, r.when),
      el("p", {}, `${r.service} with ${r.barber}${r.price ? ` · ${r.price}` : ""}.`),
      D.prep ? el("p", {}, D.prep) : null,
      el("div", { class: "actions", style: "margin-top:18px" },
        el("a", { class: "btn", href: r.ics }, "Add to my calendar"),
        BW.shop && BW.shop.address ? el("a", { class: "btn line", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(BW.shop.address)}`, rel: "noopener" }, "Directions") : null,
        el("a", { class: "btn line", href: r.statusUrl }, "View your booking"))));
    document.getElementById("bookedBox").focus({ preventScroll: true });
  }

  if (S.service && S.barber) loadTimes(); else render();
})();
