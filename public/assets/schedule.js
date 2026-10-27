// Client "pick your time" page: choose a day, then a start time, then confirm.
(async () => {
  const { api, el } = BW;
  const q = new URLSearchParams(location.search);
  const id = q.get("id") || "", t = q.get("t") || "";
  const app = document.getElementById("app"), intro = document.getElementById("intro");
  const hrs = (m) => (m % 60 ? `${(m / 60).toFixed(1)}-hour` : `${m / 60}-hour`);
  const icsUrl = `/api/schedule?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}&ics=1`;
  const statusUrl = `/request?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}`;

  let artistName = "", prep = "";
  async function load() {
    let d;
    try { d = await api(`/api/schedule?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}`); artistName = d.artist || ""; prep = d.prep || ""; }
    catch (e) { intro.textContent = e.message; app.textContent = ""; return; }
    app.textContent = "";

    if (d.booked) return showBooked(d.when);
    if (d.pending) return showRequested(d.when);
    if (!d.open) {
      intro.textContent = d.status === "declined" ? "This request was closed." : "This booking link isn't open yet. You'll get an email when it is.";
      app.append(el("p", {}, el("a", { href: statusUrl }, "Check your request status"), d.phone ? ` or call ${d.phone}.` : "."));
      return;
    }

    intro.textContent = `Your ${hrs(d.durationMin)} ${d.session || "session"} with ${d.artist}. Times are shop time (${d.timeZone}).`;
    if (d.message || d.deposit) {
      app.append(el("div", { class: "callout", style: "margin-bottom:28px" },
        d.message ? el("p", {}, d.message) : null,
        d.deposit ? el("p", { style: "margin:0" }, el("strong", {}, "Deposit: "), d.deposit, ". It holds your date and comes off the final price.") : null));
    }
    if (!d.days.length) {
      app.append(el("div", { class: "panel" }, el("h3", {}, "No open times right now"),
        el("p", { style: "margin:0" }, `The calendar is full for the next few weeks. Call ${d.phone} and the shop will find you a spot.`)));
      return;
    }

    let day = d.days[0], chosen = null;
    const dayRow = el("div", { class: "day-row", role: "group", "aria-label": "Choose a day" });
    const slotsBox = el("div", { class: "slots", role: "group", "aria-label": "Choose a start time" });
    const confirm = el("div", { class: "confirm", hidden: true });
    const err = el("p", { class: "form-error", role: "alert", hidden: true });

    function renderDays() {
      dayRow.textContent = "";
      for (const x of d.days) {
        const [wd, rest] = x.label.split(", ");
        dayRow.append(el("button", { type: "button", class: "day", "aria-pressed": String(x === day),
          onclick: () => { day = x; chosen = null; renderDays(); renderSlots(); renderConfirm(); } },
          el("span", { class: "wd" }, wd), el("span", { class: "dt" }, rest), el("span", { class: "n" }, `${x.slots.length} open`)));
      }
    }
    function renderSlots() {
      slotsBox.textContent = "";
      slotsBox.append(el("h2", {}, day.label));
      const grid = el("div", { class: "slot-grid" });
      for (const s of day.slots) {
        grid.append(el("button", { type: "button", class: "slot", "aria-pressed": String(chosen === s),
          onclick: () => { chosen = s; renderSlots(); renderConfirm(); confirm.scrollIntoView({ behavior: "smooth", block: "nearest" }); } }, s.label));
      }
      slotsBox.append(grid);
    }
    function renderConfirm() {
      confirm.hidden = !chosen; confirm.textContent = ""; err.hidden = true;
      if (!chosen) return;
      const btn = el("button", { class: "btn sign", type: "button" }, "Request this time");
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "Sending…"; err.hidden = true;
        try {
          const r = await api("/api/schedule", { body: { id, t, start: chosen.start } });
          r.pending ? showRequested(r.when) : showBooked(r.when);
        } catch (e) {
          err.textContent = e.message; err.hidden = false; btn.disabled = false; btn.textContent = "Request this time";
          if (e.data?.taken || e.data?.retry) setTimeout(load, e.data?.retry ? 2500 : 1200);
          if (e.data?.booked || e.data?.pending) load();
        }
      });
      confirm.append(el("p", { style: "margin:0 0 14px" }, el("strong", {}, `${day.label} at ${chosen.label}`), ` · ${hrs(d.durationMin)} session`), btn, err);
    }

    app.append(dayRow, slotsBox, confirm);
    renderDays(); renderSlots(); renderConfirm();
  }

  function showRequested(when) {
    intro.textContent = "Time requested.";
    app.textContent = "";
    app.append(el("div", { class: "panel", tabindex: "-1", id: "bookedBox" },
      el("h2", {}, when),
      el("p", {}, `This time is held for you. ${artistName ? artistName.split(" ")[0] : "They"} will confirm it soon, and you'll hear back as soon as it's set.`),
      el("div", { class: "actions", style: "margin-top:18px" }, el("a", { class: "btn", href: statusUrl }, "View your request"))));
    document.getElementById("bookedBox").focus({ preventScroll: true });
  }

  function showBooked(when) {
    intro.textContent = "You're booked.";
    app.textContent = "";
    app.append(el("div", { class: "panel", tabindex: "-1", id: "bookedBox" },
      el("h2", {}, when),
      el("p", {}, `A confirmation is on its way to your email.${prep ? ` ${prep}` : ""}`),
      el("div", { class: "actions", style: "margin-top:18px" },
        el("a", { class: "btn", href: icsUrl }, "Add to my calendar"),
        BW.shop && BW.shop.address ? el("a", { class: "btn line", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(BW.shop.address)}`, rel: "noopener" }, "Directions") : null,
        el("a", { class: "btn line", href: statusUrl }, "View your request"))));
    document.getElementById("bookedBox").focus({ preventScroll: true });
  }

  load();
})();
