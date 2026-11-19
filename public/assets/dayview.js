/* Beam Book inbox: the Day screen. One column per barber, one row per 15 minutes, each booking drawn as a block.
   Uses the calendar data the inbox already loaded (shop-local times), so it needs no extra requests. */
(function () {
  var BW = window.BW;
  var ROW = 26, STEP = 15; // pixels per 15 minutes
  var ctx, day = null, mode = "day", weekOf = null;

  var el = function () { return BW.el.apply(null, arguments); };
  var mins = function (local) { var t = local.slice(11, 16).split(":"); return Number(t[0]) * 60 + Number(t[1]); };
  var hm = function (m) { var h = Math.floor(m / 60), mi = m % 60, ap = h >= 12 ? "PM" : "AM"; return ((h + 11) % 12 + 1) + (mi ? ":" + String(mi).padStart(2, "0") : "") + " " + ap; };
  function keyAdd(key, n) { var p = key.split("-").map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)); return d.toISOString().slice(0, 10); }
  function weekday(key) { var p = key.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }
  function longDay(key) { var p = key.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }); }

  // The part of [localStart, localEnd) that falls on `key`, in minutes from midnight. null if none.
  function onDay(item, key) {
    var s = item.localStart, e = item.localEnd || item.localStart;
    var sd = s.slice(0, 10), ed = e.slice(0, 10);
    if (sd > key || ed < key) return null;
    var from = sd === key ? mins(s) : 0, to = ed === key ? mins(e) : 24 * 60;
    if (ed > key) to = 24 * 60;
    return to > from ? { from: from, to: to } : null;
  }

  function shortDay(key) { var p = key.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }

  // ---------- book someone in (front desk / barbers) ----------
  // Free start times for one barber on a day (15-minute steps inside their hours, clear of bookings, time off and busy).
  function freeTimes(slug, key, dur) {
    var C = ctx.D.calendar[slug]; if (!C) return [];
    var h = C.settings && C.settings.hours && C.settings.hours[weekday(key)]; if (!h) return [];
    var open = mins("0000-00-00T" + h.open), close = mins("0000-00-00T" + h.close), taken = [];
    [].concat(C.appts || [], C.blocks || [], C.busy || []).forEach(function (x) { var r = onDay(x, key); if (r) taken.push(r); });
    var nowM = key === ctx.D.today && ctx.D.nowLocal ? mins(ctx.D.nowLocal) + Math.round((Date.now() - ctx.loadedAt) / 60000) : -1, out = [];
    for (var m = open; m + dur <= close; m += 15) { if (m < nowM) continue; if (!taken.some(function (t) { return t.from < m + dur && t.to > m; })) out.push(m); }
    return out;
  }

  function openBook(o) {
    var D = ctx.D, old = document.getElementById("dvBook"); if (old) old.remove();
    var barbers = D.artists, svcs = D.services || [];
    var pad = function (n) { return String(n).padStart(2, "0"); }, money = function (p) { return p == null ? "" : "$" + Number(p).toFixed(2); };
    var S = { barber: o.barber, any: false, service: null, dur: 30, day: o.day, time: o.min != null ? o.min : null, repeat: 0, times: 4, notify: true };
    var root = el("div", { class: "dvb panel", role: "dialog", "aria-label": "Book an appointment" });
    var box = el("div", { id: "dvBook", class: "dvb-scrim", onclick: function (e) { if (e.target === box) box.remove(); } }, root);
    var name = el("input", { name: "name", autocomplete: "off" }), phone = el("input", { type: "tel", inputmode: "tel", autocomplete: "off" }), email = el("input", { type: "email", autocomplete: "off" });
    var textOk = el("input", { type: "checkbox" }), note = el("textarea", { rows: 2, maxlength: 300, placeholder: "Anything the barber should know" });
    var find = el("input", { type: "search", placeholder: "Search by name, phone or email", autocomplete: "off" }), sugg = el("div", { class: "dvb-sugg" });
    var err = el("p", { class: "form-error", role: "alert", hidden: true }), timer = null;
    find.addEventListener("input", function () {
      clearTimeout(timer); var q = find.value.trim(); if (q.length < 2) { sugg.textContent = ""; return; }
      timer = setTimeout(function () {
        BW.api("/api/admin/books", { body: { action: "clients", q: q } }).then(function (r) {
          var list = (r.clients || []).slice(0, 6);
          sugg.replaceChildren.apply(sugg, list.length ? list.map(function (c) {
            return el("button", { type: "button", class: "dvb-pick", onclick: function () { name.value = c.name || ""; phone.value = c.phone || ""; email.value = c.email || ""; textOk.checked = Boolean(c.textOk); sugg.textContent = ""; find.value = ""; } },
              el("strong", {}, c.name || "Client"), el("span", { class: "small muted" }, [c.phone, c.email].filter(Boolean).join(" · ")));
          }) : [el("p", { class: "small muted", style: "margin:4px 0" }, "No match. Fill in a new client below.")]);
        }).catch(function () {});
      }, 250);
    });
    var left = el("div"), right = el("div", {},
      el("div", { class: "dvb-k" }, "Client"), find, sugg,
      el("label", {}, "Name", name), el("label", {}, "Phone", phone), el("label", {}, "Email (optional)", email),
      el("label", { class: "dvb-chk" }, textOk, el("span", {}, "They said yes to text confirmations and reminders")),
      el("label", {}, "Appointment note (optional)", note));

    function svcList() { return svcs.filter(function (x) { return S.any || !(x.barbers && x.barbers.length) || x.barbers.indexOf(S.barber) >= 0; }); }
    function pool() { var sv = svcs.find(function (x) { return x.id === S.service; }); return barbers.filter(function (a) { return !sv || !(sv.barbers && sv.barbers.length) || sv.barbers.indexOf(a.slug) >= 0; }); }
    function drawLeft() {
      if (S.service && !svcList().some(function (x) { return x.id === S.service; })) S.service = null;
      var bSel = el("select", { disabled: S.any, onchange: function (e) { S.barber = e.target.value; drawLeft(); } }, barbers.map(function (a) { return el("option", { value: a.slug, selected: a.slug === S.barber }, a.name); }));
      var anyT = el("label", { class: "dvb-chk dvb-any" }, el("input", { type: "checkbox", checked: S.any, onchange: function (e) { S.any = e.target.checked; drawLeft(); } }), el("span", {}, "Any barber"));
      var tiles = el("div", { class: "dvb-tiles" }, svcList().map(function (x) {
        return el("button", { type: "button", class: "dvb-tile", "aria-pressed": String(S.service === x.id), onclick: function () { S.service = x.id; S.dur = x.durationMin; drawLeft(); } },
          el("span", {}, x.name), el("b", {}, money(x.price) + " / " + x.durationMin + "m"));
      }));
      var durSel = el("select", { onchange: function (e) { S.dur = +e.target.value; drawLeft(); } });
      for (var dm = 5; dm <= 240; dm += 5) durSel.append(el("option", { value: dm, selected: dm === S.dur }, dm < 60 ? dm + " min" : Math.floor(dm / 60) + " hr" + (dm % 60 ? " " + (dm % 60) + " min" : "")));
      var rep = el("select", { onchange: function (e) { S.repeat = +e.target.value; drawLeft(); } }, [[0, "Doesn't repeat"], [1, "Every week"], [2, "Every 2 weeks"], [3, "Every 3 weeks"], [4, "Every 4 weeks"]].map(function (r) { return el("option", { value: r[0], selected: r[0] === S.repeat }, r[1]); }));
      var reps = S.repeat ? el("select", { onchange: function (e) { S.times = +e.target.value; } }, [2, 3, 4, 6, 8, 10, 12].map(function (n) { return el("option", { value: n, selected: n === S.times }, n + " visits"); })) : null;
      var dateIn = el("input", { type: "date", value: S.day, onchange: function (e) { if (e.target.value) { S.day = e.target.value; drawLeft(); } } });
      // Open times for the chosen barber (or anyone who does the service)
      var free = {}; (S.any ? pool() : barbers.filter(function (a) { return a.slug === S.barber; })).forEach(function (a) { freeTimes(a.slug, S.day, S.dur).forEach(function (m) { free[m] = true; }); });
      var fl = Object.keys(free).map(Number).sort(function (p, q) { return p - q; });
      var chips = !S.service ? el("p", { class: "small muted" }, "Pick a service to see open times.") : fl.length ? el("div", { class: "dvb-times" }, fl.map(function (m) {
        return el("button", { type: "button", class: "dvb-time", "aria-pressed": String(S.time === m), onclick: function () { S.time = m; drawLeft(); } }, hm(m)); })) : el("p", { class: "small muted" }, "No open times that day. Pick another day, or choose any time below.");
      var other = el("select", { "aria-label": "Any time", onchange: function (e) { if (e.target.value !== "") { S.time = +e.target.value; drawLeft(); } } }, el("option", { value: "" }, "Any time…"));
      for (var tm = 6 * 60; tm <= 21 * 60; tm += 5) other.append(el("option", { value: tm, selected: S.time === tm && !free[tm] }, hm(tm)));
      left.replaceChildren(
        el("div", { class: "dvb-k" }, "Barber"), el("div", { class: "dvb-row" }, bSel, anyT),
        el("div", { class: "dvb-k" }, "Service"), tiles,
        el("div", { class: "dvb-two" }, el("label", {}, "Length", durSel), el("label", {}, "Repeat", el("div", { class: "dvb-row" }, rep, reps))),
        el("div", { class: "dvb-k" }, "Time"), el("div", { class: "dvb-row" }, dateIn, other), chips,
        el("p", { class: "dvb-when" }, S.time != null ? longDay(S.day) + ", " + hm(S.time) + " to " + hm(S.time + S.dur) : "No time picked yet"),
        el("label", { class: "dvb-chk" }, el("input", { type: "checkbox", checked: S.notify, onchange: function (e) { S.notify = e.target.checked; } }), el("span", {}, "Send the client a confirmation (email, and a text if they said yes)")));
    }
    function send(force) {
      err.hidden = true;
      if (!S.service) { err.textContent = "Pick a service."; err.hidden = false; return; }
      if (S.time == null) { err.textContent = "Pick a time."; err.hidden = false; return; }
      var body = { action: "staffBook", barber: S.any ? "any" : S.barber, service: S.service, durationMin: S.dur, date: S.day, time: pad(Math.floor(S.time / 60)) + ":" + pad(S.time % 60),
        name: name.value, phone: phone.value, email: email.value, textOk: textOk.checked, note: note.value, notify: S.notify, repeatWeeks: S.repeat, repeatTimes: S.repeat ? S.times : 1, force: Boolean(force) };
      saveBtn.disabled = true;
      BW.api("/api/admin/books", { body: body }).then(async function (r) {
        box.remove(); ctx.toast("Booked " + r.service + " with " + r.barber.split(" ")[0] + ", " + r.when + (r.count > 1 ? " (+" + (r.count - 1) + " more)" : ""));
        await ctx.reload(); day = S.day; render();
      }).catch(function (e) {
        saveBtn.disabled = false; err.textContent = e.message; err.hidden = false;
        if (e.data && e.data.clash) err.append(" ", el("button", { class: "linkbtn", type: "button", onclick: function () { send(true); } }, "Book anyway (double-book)"));
      });
    }
    var saveBtn = el("button", { class: "btn", type: "button", onclick: function () { send(false); } }, "Book it");
    root.append(
      el("div", { class: "dvb-head" }, el("h2", { style: "margin:0" }, "Book an appointment"), el("button", { class: "dvb-x", type: "button", "aria-label": "Close", onclick: function () { box.remove(); } }, "×")),
      el("div", { class: "dvb-cols" }, left, right), err,
      el("div", { class: "dvb-foot" }, el("button", { class: "btn line", type: "button", onclick: function () { box.remove(); } }, "Close"), saveBtn));
    if (!document.getElementById("dvbCss")) document.head.append(el("style", { id: "dvbCss" },
      ".dvb-scrim{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.6);display:grid;place-items:start center;overflow:auto;padding:4vh 12px}" +
      ".dvb{width:min(1040px,100%);margin:0;padding:22px 24px}.dvb-head{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:14px}" +
      ".dvb-x{width:40px;height:40px;border-radius:50%;border:1.5px solid var(--line);background:none;color:var(--ink);font-size:24px;cursor:pointer;line-height:1}" +
      ".dvb-cols{display:grid;grid-template-columns:1.25fr 1fr;gap:28px}.dvb-k{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--sign-dark);margin:14px 0 6px}" +
      ".dvb label{display:block;font-size:14px;margin:8px 0}.dvb label input,.dvb label select,.dvb label textarea{display:block;width:100%;margin-top:4px}.dvb input[type=search]{width:100%}" +
      ".dvb-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.dvb-row select,.dvb-row input{flex:1;min-width:140px;width:auto}.dvb .dvb-chk{display:flex;gap:8px;align-items:center}.dvb .dvb-chk input{width:auto;margin:0}.dvb .dvb-any{margin:0;white-space:nowrap}" +
      ".dvb-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}.dvb-tile{display:flex;justify-content:space-between;gap:8px;align-items:center;text-align:left;padding:11px 12px;border:1.5px solid var(--line);border-radius:var(--radius);background:var(--white);color:var(--ink);font:inherit;font-size:14px;cursor:pointer}" +
      ".dvb-tile span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvb-tile b{white-space:nowrap;font-size:13px}.dvb-tile[aria-pressed=true],.dvb-time[aria-pressed=true]{background:var(--sign);border-color:var(--sign);color:var(--on-sign,#14110c);box-shadow:0 0 0 2px var(--ink)}" +
      ".dvb-times{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0;max-height:150px;overflow:auto;padding:3px}.dvb-time{padding:7px 11px;border-radius:999px;border:1.5px solid var(--line);background:var(--white);color:var(--ink);font:inherit;font-size:14px;cursor:pointer}" +
      ".dvb-when{font-weight:700;margin:8px 0}.dvb-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.dvb-sugg{display:grid;gap:4px;margin:6px 0}" +
      ".dvb-pick{display:flex;justify-content:space-between;gap:10px;text-align:left;padding:8px 10px;border:1px solid var(--line);border-radius:var(--radius);background:var(--white);color:var(--ink);cursor:pointer;font:inherit}" +
      ".dvb-foot{display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:14px;margin-top:14px}.dv-head.today strong{color:var(--sign-dark)}" +
      "@media(max-width:820px){.dvb-cols{grid-template-columns:1fr}.dvb-two{grid-template-columns:1fr}}"));
    drawLeft(); document.body.append(box); find.focus();
  }

  // Projected earnings for the day: a barber sees their own; the Owner sees every barber.
  var money = function (n) { return "$" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }); };
  function earningsPanel(key) {
    var sec = el("section", { class: "panel dv-earn", style: "margin-top:18px" }, el("h2", { style: "margin-top:0" }, key === ctx.D.today ? "Today's earnings" : "Earnings for the day"), el("p", { class: "muted" }, "Adding it up…"));
    BW.api("/api/admin/books", { body: { action: "dashDay", date: key } }).then(function (r) {
      sec.lastChild.remove();
      if (!r.rows.length) { sec.append(el("p", { class: "muted" }, r.owner ? "Nothing booked this day." : "Nothing on your books this day.")); return; }
      r.rows.forEach(function (x) {
        sec.append(el("div", { class: "dv-earnrow" },
          el("div", {}, el("strong", {}, r.owner ? x.name : "Your projected take"), el("div", { class: "small muted" }, x.cuts + " appointment" + (x.cuts === 1 ? "" : "s") + " · " + x.done + " done · " +
            (x.model === "booth" ? "booth rent" : x.model === "owner" ? "owner" : (x.rate + "% commission")))),
          el("div", { class: "dv-earnnums" },
            el("div", {}, el("b", {}, money(x.take)), el("span", {}, "projected take")),
            el("div", {}, el("b", {}, money(x.earned)), el("span", {}, "services done")),
            el("div", {}, el("b", {}, money(x.projected)), el("span", {}, "still booked")),
            x.tips ? el("div", {}, el("b", {}, money(x.tips)), el("span", {}, "tips")) : null)));
      });
      sec.append(el("p", { class: "small muted", style: "margin-bottom:0" }, "At menu prices, before tips, after the cash discount. Your take uses your pay setup (commission or booth rent)."));
    }).catch(function (e) { sec.lastChild.textContent = e.message; });
    return sec;
  }

  function show(c) { ctx = c; ctx.only("dayView"); day = day || ctx.D.today; render(); }

  function render() {
    var D = ctx.D, v = document.getElementById("dayView"); v.textContent = "";
    var barbers = D.artists;
    if (!weekOf || !barbers.some(function (a) { return a.slug === weekOf; })) weekOf = (D.me && D.me.artist) || (barbers[0] && barbers[0].slug);
    // Day: one column per barber. Week: one barber, Monday to Sunday.
    var mon = keyAdd(day, -((weekday(day) + 6) % 7));
    var specs = mode === "week" ? [0, 1, 2, 3, 4, 5, 6].map(function (i) { return { a: barbers.find(function (b) { return b.slug === weekOf; }), day: keyAdd(mon, i) }; })
      : barbers.map(function (a) { return { a: a, day: day }; });

    var cols = specs.filter(function (sp) { return sp.a; }).map(function (sp) {
      var a = sp.a, k = sp.day, wd = weekday(k);
      var C = D.calendar[a.slug] || { appts: [], blocks: [], busy: [], settings: { hours: {} } };
      var hours = C.settings && C.settings.hours ? C.settings.hours[wd] : null;
      var items = [];
      C.appts.forEach(function (x) { var r = onDay(x, k); if (r) items.push({ kind: "appt", from: r.from, to: r.to, x: x }); });
      (C.blocks || []).forEach(function (x) { var r = onDay(x, k); if (r) items.push({ kind: "off", from: r.from, to: r.to, x: x }); });
      (C.busy || []).forEach(function (x) { var r = onDay(x, k); if (r) items.push({ kind: "busy", from: r.from, to: r.to, x: x }); });
      return { a: a, day: k, hours: hours, open: hours ? mins("0000-00-00T" + hours.open) : null, close: hours ? mins("0000-00-00T" + hours.close) : null, items: items };
    });

    // Rows: earliest open to latest close (or 9 to 6), widened to fit any booking outside hours.
    var lo = Infinity, hi = -Infinity;
    cols.forEach(function (c) {
      if (c.open != null) { lo = Math.min(lo, c.open); hi = Math.max(hi, c.close); }
      c.items.forEach(function (i) { if (i.kind !== "off" || i.to - i.from < 24 * 60) { lo = Math.min(lo, i.from); hi = Math.max(hi, i.to); } });
    });
    if (lo === Infinity) { lo = 9 * 60; hi = 18 * 60; }
    lo = Math.max(0, Math.floor(lo / 60) * 60); hi = Math.min(24 * 60, Math.ceil(hi / 60) * 60);
    var rows = (hi - lo) / STEP, H = rows * ROW;
    var y = function (m) { return ((Math.max(lo, Math.min(hi, m)) - lo) / STEP) * ROW; };

    // Header: date and navigation
    if (!document.getElementById("dvEarnCss")) document.head.append(el("style", { id: "dvEarnCss" }, ".dv-earnrow{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)}.dv-earnnums{display:flex;gap:18px;flex-wrap:wrap}.dv-earnnums div{min-width:90px}.dv-earnnums b{display:block;font-size:24px;line-height:1.1}.dv-earnnums span{font-size:12px;color:var(--graphite)}.dv-earnnums div:first-child b{color:var(--sign-dark)}"));
    var picker = el("input", { type: "date", value: day, "aria-label": "Pick a day", style: "width:auto" });
    picker.addEventListener("change", function () { if (picker.value) { day = picker.value; render(); } });
    var count = cols.reduce(function (n, c) { return n + c.items.filter(function (i) { return i.kind === "appt"; }).length; }, 0);
    var step = mode === "week" ? 7 : 1;
    var modeBtns = el("div", { class: "tabs", role: "group", style: "margin:0" }, [["day", "Day"], ["week", "Week"]].map(function (m) {
      return el("button", { class: "tab", type: "button", "aria-pressed": String(mode === m[0]), onclick: function () { mode = m[0]; render(); } }, m[1]); }));
    var who = mode === "week" ? el("select", { "aria-label": "Barber", style: "width:auto", onchange: function (e) { weekOf = e.target.value; render(); } },
      barbers.map(function (a) { return el("option", { value: a.slug, selected: a.slug === weekOf }, a.name); })) : null;
    var bookBtn = el("button", { class: "btn sm", type: "button", onclick: function () { openBook({ barber: mode === "week" ? weekOf : ((D.me && D.me.artist) || (barbers[0] && barbers[0].slug)), day: day }); } }, "+ Book appointment");
    v.append(el("h1", { style: "font-size:44px;margin:28px 0 6px" }, mode === "week" ? "Week of " + longDay(mon).replace(/^\w+, /, "") : longDay(day)),
      el("p", { class: "muted", style: "margin-top:0" }, count ? count + " appointment" + (count === 1 ? "" : "s") + ". Shop time (" + D.timeZone + ")." : "No appointments. Shop time (" + D.timeZone + ")."),
      el("div", { class: "actions", style: "margin:12px 0 18px;align-items:center" },
        el("button", { class: "btn sm line", type: "button", onclick: function () { day = keyAdd(day, -step); render(); } }, "‹ Previous"),
        el("button", { class: "btn sm line", type: "button", onclick: function () { day = D.today; render(); }, disabled: day === D.today }, "Today"),
        el("button", { class: "btn sm line", type: "button", onclick: function () { day = keyAdd(day, step); render(); } }, "Next ›"),
        picker,
        el("button", { class: "btn sm line", type: "button", onclick: async function () { await ctx.reload(); render(); ctx.toast("Updated"); } }, "Refresh"),
        modeBtns, who, bookBtn));

    // Grid
    var wrap = el("div", { class: "dv-wrap" });
    var grid = el("div", { class: "dv-grid", style: "grid-template-columns:64px repeat(" + cols.length + ", minmax(150px, 1fr))" });
    grid.append(el("div", { class: "dv-corner" }));
    cols.forEach(function (c) {
      grid.append(el("div", { class: "dv-head" + (mode === "week" && c.day === D.today ? " today" : "") }, el("strong", {}, mode === "week" ? shortDay(c.day) : c.a.name),
        el("div", { class: "small muted" }, c.hours ? hm(c.open) + " to " + hm(c.close) : "Off today")));
    });
    var times = el("div", { class: "dv-times", style: "height:" + H + "px" });
    for (var m = lo; m < hi; m += 60) times.append(el("div", { class: "dv-time", style: "top:" + y(m) + "px" }, hm(m)));
    grid.append(times);

    cols.forEach(function (c) {
      var col = el("div", { class: "dv-col", style: "height:" + H + "px" });
      // closed time shaded
      if (c.open == null) col.append(el("div", { class: "dv-closed", style: "top:0;height:" + H + "px" }));
      else {
        if (c.open > lo) col.append(el("div", { class: "dv-closed", style: "top:0;height:" + y(c.open) + "px" }));
        if (c.close < hi) col.append(el("div", { class: "dv-closed", style: "top:" + y(c.close) + "px;height:" + (H - y(c.close)) + "px" }));
      }
      // lay out overlapping items side by side
      var items = c.items.slice().sort(function (p, q) { return p.from - q.from || q.to - p.to; });
      var lanes = [];
      items.forEach(function (it) {
        var lane = lanes.findIndex(function (end) { return end <= it.from; });
        if (lane < 0) { lane = lanes.length; lanes.push(it.to); } else lanes[lane] = it.to;
        it.lane = lane;
      });
      items.forEach(function (it) {
        var overl = items.filter(function (o) { return o.from < it.to && it.from < o.to; });
        var n = Math.max.apply(null, overl.map(function (o) { return o.lane; })) + 1;
        var style = "top:" + y(it.from) + "px;height:" + Math.max(ROW - 2, y(it.to) - y(it.from) - 2) + "px;left:calc(" + (100 / n * it.lane) + "% + 2px);width:calc(" + (100 / n) + "% - 4px)";
        var time = hm(it.from) + " to " + hm(it.to);
        if (it.kind === "off") { col.append(el("div", { class: "dv-item off", style: style, title: (it.x.note || "Time off") + ", " + time }, el("span", {}, it.x.note || "Time off"))); return; }
        if (it.kind === "busy") { col.append(el("div", { class: "dv-item busy", style: style, title: "Busy (from " + (it.x.source || "another calendar") + "), " + time }, el("span", {}, "Busy"))); return; }
        var a = it.x, req = D.requests.find(function (r) { return r.id === a.requestId; });
        var service = (req && req.service && req.service.name) || a.title || "";
        var phone = req && req.client && req.client.phone;
        var short = y(it.to) - y(it.from) <= ROW * 1.5;
        var box = el("button", { type: "button", class: "dv-item appt" + (a.pending ? " pending" : "") + (short ? " short" : ""), style: style,
          title: [a.clientName, service, time, phone, a.pending ? "Needs confirming" : ""].filter(Boolean).join("\n") },
          el("strong", {}, a.clientName || "Client"),
          el("span", {}, short ? hm(it.from) : hm(it.from) + (service ? " · " + service : "")),
          a.pending ? el("span", { class: "dv-pend" }, "Confirm") : null);
        box.addEventListener("click", function () { if (req) ctx.openRequest(req); else ctx.toast(a.clientName + ", " + time + (service ? " · " + service : "")); });
        col.append(box);
      });
      // now line
      // Tap an empty spot to book someone in at that time.
      col.addEventListener("click", function (e) {
        if (e.target !== col && !e.target.classList.contains("dv-closed")) return;
        var r = col.getBoundingClientRect(), m = lo + Math.floor((e.clientY - r.top) / ROW) * STEP;
        openBook({ barber: c.a.slug, day: c.day, min: m });
      });
      col.title = "Tap an empty time to book " + c.a.name.split(" ")[0];
      if (c.day === D.today && D.nowLocal) {
        var nm = mins(D.nowLocal) + Math.round((Date.now() - ctx.loadedAt) / 60000);
        if (nm >= lo && nm <= hi) col.append(el("div", { class: "dv-now", style: "top:" + y(nm) + "px" }));
      }
      grid.append(col);
    });
    wrap.append(grid);
    v.append(wrap, mode === "day" ? earningsPanel(day) : null, el("p", { class: "small muted", style: "margin:12px 0 48px" }, "Tap a booking to open it. Tap an empty time to book someone in. Shaded times are outside working hours. Change hours and time off on the Calendar page."));
  }

  window.BBDay = { show: show };
})();
