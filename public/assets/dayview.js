/* Beam Book inbox: the Day screen. One column per barber, one row per 15 minutes, each booking drawn as a block.
   Uses the calendar data the inbox already loaded (shop-local times), so it needs no extra requests. */
(function () {
  var BW = window.BW;
  var ROW = 26, STEP = 15; // pixels per 15 minutes
  var ctx, day = null;

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

  function show(c) { ctx = c; ctx.only("dayView"); day = day || ctx.D.today; render(); }

  function render() {
    var D = ctx.D, v = document.getElementById("dayView"); v.textContent = "";
    var barbers = D.artists;
    var wd = weekday(day);

    // Gather each barber's day.
    var cols = barbers.map(function (a) {
      var C = D.calendar[a.slug] || { appts: [], blocks: [], busy: [], settings: { hours: {} } };
      var hours = C.settings && C.settings.hours ? C.settings.hours[wd] : null;
      var items = [];
      C.appts.forEach(function (x) { var r = onDay(x, day); if (r) items.push({ kind: "appt", from: r.from, to: r.to, x: x }); });
      (C.blocks || []).forEach(function (x) { var r = onDay(x, day); if (r) items.push({ kind: "off", from: r.from, to: r.to, x: x }); });
      (C.busy || []).forEach(function (x) { var r = onDay(x, day); if (r) items.push({ kind: "busy", from: r.from, to: r.to, x: x }); });
      return { a: a, hours: hours, open: hours ? mins("0000-00-00T" + hours.open) : null, close: hours ? mins("0000-00-00T" + hours.close) : null, items: items };
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
    var picker = el("input", { type: "date", value: day, "aria-label": "Pick a day", style: "width:auto" });
    picker.addEventListener("change", function () { if (picker.value) { day = picker.value; render(); } });
    var count = cols.reduce(function (n, c) { return n + c.items.filter(function (i) { return i.kind === "appt"; }).length; }, 0);
    v.append(el("h1", { style: "font-size:44px;margin:28px 0 6px" }, longDay(day)),
      el("p", { class: "muted", style: "margin-top:0" }, count ? count + " appointment" + (count === 1 ? "" : "s") + ". Shop time (" + D.timeZone + ")." : "No appointments. Shop time (" + D.timeZone + ")."),
      el("div", { class: "actions", style: "margin:12px 0 18px;align-items:center" },
        el("button", { class: "btn sm line", type: "button", onclick: function () { day = keyAdd(day, -1); render(); } }, "‹ Previous"),
        el("button", { class: "btn sm line", type: "button", onclick: function () { day = D.today; render(); }, disabled: day === D.today }, "Today"),
        el("button", { class: "btn sm line", type: "button", onclick: function () { day = keyAdd(day, 1); render(); } }, "Next ›"),
        picker,
        el("button", { class: "btn sm line", type: "button", onclick: async function () { await ctx.reload(); render(); ctx.toast("Updated"); } }, "Refresh")));

    // Grid
    var wrap = el("div", { class: "dv-wrap" });
    var grid = el("div", { class: "dv-grid", style: "grid-template-columns:64px repeat(" + cols.length + ", minmax(150px, 1fr))" });
    grid.append(el("div", { class: "dv-corner" }));
    cols.forEach(function (c) {
      grid.append(el("div", { class: "dv-head" }, el("strong", {}, c.a.name),
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
      if (day === D.today && D.nowLocal) {
        var nm = mins(D.nowLocal) + Math.round((Date.now() - ctx.loadedAt) / 60000);
        if (nm >= lo && nm <= hi) col.append(el("div", { class: "dv-now", style: "top:" + y(nm) + "px" }));
      }
      grid.append(col);
    });
    wrap.append(grid);
    v.append(wrap, el("p", { class: "small muted", style: "margin:12px 0 48px" }, "Tap a booking to open it. Shaded times are outside working hours. Change hours and time off on the Calendar page."));
  }

  window.BBDay = { show: show };
})();
