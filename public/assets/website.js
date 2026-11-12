/* Beam inbox: the Website screen.
   - Checklist: facts and photos for the shop's own website. Saving one puts it on the site right away.
   - Change requests: anything else the owner wants changed. The Site manager reviews these before anything changes.
   - Google reviews: shows whether they're linked (the Site manager links them on the Beam control page). */
(function () {
  var BW = window.BW, el = BW.el;
  var S = null, ctx = null;

  function call(body) { return BW.api("/api/admin/books", { body: body }); }
  function when(t) { return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }

  // The small "finish your website" strip at the top of the inbox.
  async function nudge(where, open) {
    try { S = await call({ action: "site" }); } catch (e) { return; }
    var box = document.getElementById(where);
    if (!box) return;
    var left = S.items.length - S.done, open_ = S.changes.filter(function (c) { return c.status === "open"; }).length;
    var parts = [];
    if (left > 0) parts.push(el("span", {}, el("b", {}, "Finish your website: "), S.done + " of " + S.items.length + " done. "));
    if (S.canReview && open_) parts.push(el("span", {}, el("b", {}, open_ + " website change request" + (open_ === 1 ? "" : "s")), " waiting for review. "));
    if (!parts.length) { box.hidden = true; return; }
    box.replaceChildren(el("div", { class: "notice", style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap" },
      el("span", {}, parts), el("button", { class: "btn sm", type: "button", onclick: open }, left > 0 ? "Open checklist" : "Review")));
    box.hidden = false;
  }

  async function show(c) {
    ctx = c; ctx.only("siteView");
    var v = document.getElementById("siteView");
    v.replaceChildren(el("p", { class: "muted", style: "margin-top:28px" }, "Loading…"));
    try { S = await call({ action: "site" }); } catch (e) { return ctx.toast(e.message); }
    render();
  }

  function render() {
    var v = document.getElementById("siteView");
    v.replaceChildren(
      el("h1", { style: "font-size:44px;margin:28px 0 6px" }, "Website"),
      el("p", { class: "muted", style: "margin-top:0" }, "Fill these in and they show up on your website right away. Want to change anything else? Send a change request at the bottom and we'll take care of it."),
      checklist(), google(), changes());
  }

  // ---------- checklist ----------
  function checklist() {
    var sec = el("section", { class: "panel", style: "margin-top:20px" },
      el("h2", { style: "margin-top:0;font-size:30px" }, "Checklist ", el("span", { class: "small muted", style: "font-weight:400" }, S.done + " of " + S.items.length + " done")));
    if (!S.items.length) sec.append(el("p", { class: "muted" }, "Nothing to fill in right now."));
    S.items.forEach(function (it) { sec.append(item(it)); });
    return sec;
  }

  function item(it) {
    var done = Boolean(it.value), row = el("div", { style: "border-top:1px solid var(--line);padding:18px 0" });
    var mark = el("span", { "aria-hidden": "true", style: "display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;margin-right:8px;font-size:13px;" +
      (done ? "background:var(--accent);color:#fff" : it.skipped ? "background:var(--line);color:var(--muted)" : "border:2px solid var(--line)") }, done ? "✓" : it.skipped ? "–" : "");
    var head = el("div", { style: "display:flex;align-items:center;font-weight:600" }, mark, it.label,
      it.skipped && !done ? el("span", { class: "small muted", style: "font-weight:400;margin-left:8px" }, "(skipped)") : null);
    row.append(head);
    if (it.hint) row.append(el("p", { class: "small muted", style: "margin:4px 0 10px 30px" }, it.hint));
    var body = el("div", { style: "margin-left:30px" });
    var err = el("p", { class: "form-error", role: "alert", hidden: true });

    async function save(payload, msg) {
      err.hidden = true;
      try { S = await call(Object.assign({ action: "siteSave", key: it.key }, payload)); ctx.toast(msg); render(); }
      catch (e) { err.textContent = e.message; err.hidden = false; }
    }
    var skip = el("button", { class: "linkbtn small", type: "button", onclick: function () { save({ skip: !it.skipped }, it.skipped ? "Back on the list" : "Skipped"); } },
      it.skipped ? "Put back on the list" : "Skip this");

    if (it.type === "photo") {
      if (it.value) body.append(el("div", { class: "pics" }, el("a", { href: it.value, target: "_blank", rel: "noopener" }, el("img", { src: it.value, alt: it.label }))));
      var file = el("input", { type: "file", accept: "image/*", hidden: true, onchange: async function () {
        var f = file.files[0]; if (!f) return;
        try { var data = await BW.shrink(f, 1800); await save({ photo: data }, "On your website now"); } catch (e) { err.textContent = e.message; err.hidden = false; }
      } });
      body.append(file, el("div", { class: "actions" },
        el("button", { class: "btn sm", type: "button", onclick: function () { file.click(); } }, it.value ? "Replace photo" : "Upload photo"),
        it.value ? el("button", { class: "btn sm line", type: "button", onclick: function () { save({ remove: true }, "Photo taken off the site"); } }, "Remove") : null,
        it.value ? null : skip));
    } else {
      var input = it.type === "long" ? el("textarea", { rows: 4, style: "width:100%" }) : el("input", { type: "text", style: "width:100%" });
      input.value = it.value || "";
      body.append(input, el("div", { class: "actions", style: "margin-top:8px" },
        el("button", { class: "btn sm", type: "button", onclick: function () { save({ value: input.value }, input.value.trim() ? "On your website now" : "Taken off the site"); } }, "Save"),
        it.value ? null : skip));
    }
    if (it.updatedAt && it.value) body.append(el("p", { class: "small muted", style: "margin:6px 0 0" }, "Updated " + when(it.updatedAt)));
    body.append(err);
    row.append(body);
    return row;
  }

  // ---------- Google reviews ----------
  function google() {
    var g = S.google;
    return el("section", { class: "panel", style: "margin-top:20px" },
      el("h2", { style: "margin-top:0;font-size:30px" }, "Google reviews"),
      g.linked
        ? el("p", {}, "Linked. Your newest Google reviews show on your website automatically" + (g.rating ? " (" + g.rating.toFixed(1) + " stars from " + g.count + " reviews)." : "."))
        : el("p", { class: "muted" }, "Not linked yet. Your Site manager connects your Google Business listing, then new reviews show on your website on their own."));
  }

  // ---------- change requests ----------
  function changes() {
    var sec = el("section", { class: "panel", style: "margin-top:20px" },
      el("h2", { style: "margin-top:0;font-size:30px" }, "Request a change"),
      el("p", { class: "muted", style: "margin-top:0" }, "New wording, a different photo, a new service, anything at all. We review every request before it goes on your site."));
    var text = el("textarea", { rows: 4, style: "width:100%", placeholder: "e.g. Add 'heat cable install' to the services page" });
    var pics = [], picRow = el("div", { class: "pics" });
    var file = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: async function () {
      for (var i = 0; i < file.files.length && pics.length < 4; i++) { try { pics.push(await BW.shrink(file.files[i], 1800)); } catch (e) { ctx.toast(e.message); } }
      picRow.replaceChildren.apply(picRow, pics.map(function (d) { return el("img", { src: d, alt: "" }); }));
      file.value = "";
    } });
    var err = el("p", { class: "form-error", role: "alert", hidden: true });
    sec.append(el("div", { class: "field" }, text), picRow, file, el("div", { class: "actions" },
      el("button", { class: "btn sm line", type: "button", onclick: function () { file.click(); } }, "Add photos"),
      el("button", { class: "btn sm", type: "button", onclick: async function () {
        err.hidden = true;
        try { S = await call({ action: "siteChange", text: text.value, photos: pics }); ctx.toast("Sent. We'll review it."); render(); }
        catch (e) { err.textContent = e.message; err.hidden = false; }
      } }, "Send request")), err);

    if (S.changes.length) {
      sec.append(el("h3", { style: "margin:26px 0 6px" }, "Your requests"));
      S.changes.forEach(function (c) { sec.append(change(c)); });
    }
    return sec;
  }

  var STATUS = { open: "Waiting for review", done: "Done", declined: "Not changed" };
  function change(c) {
    var row = el("div", { style: "border-top:1px solid var(--line);padding:14px 0" },
      el("div", { class: "small muted" }, when(c.at) + " · " + c.by + " · ", el("b", {}, STATUS[c.status] || c.status)),
      el("p", { style: "margin:6px 0;white-space:pre-wrap" }, c.text));
    if (c.photos.length) row.append(el("div", { class: "pics" }, c.photos.map(function (u) { return el("a", { href: u, target: "_blank", rel: "noopener" }, el("img", { src: u, alt: "" })); })));
    if (c.note) row.append(el("p", { class: "small", style: "margin:6px 0" }, el("b", {}, "Reply: "), c.note));
    if (S.canReview) {
      var note = el("input", { type: "text", placeholder: "Reply (optional)", value: c.note || "", style: "flex:1;min-width:180px" });
      var act = function (status) { return async function () {
        try { S = await call({ action: "siteReview", id: c.id, status: status, note: note.value }); ctx.toast("Saved"); render(); } catch (e) { ctx.toast(e.message); }
      }; };
      row.append(el("div", { class: "actions", style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" }, note,
        c.status !== "done" ? el("button", { class: "btn sm", type: "button", onclick: act("done") }, "Mark done") : null,
        c.status === "open" ? el("button", { class: "btn sm line", type: "button", onclick: act("declined") }, "Won't change") : null,
        c.status !== "open" ? el("button", { class: "btn sm line", type: "button", onclick: act("open") }, "Reopen") : null));
    }
    return row;
  }

  window.BBSite = { show: show, nudge: nudge };
})();
