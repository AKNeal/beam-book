// Booking request form → /api/requests
(async () => {
  const { api, el, shrink } = BW;
  const form = document.getElementById("form");
  const preset = new URLSearchParams(location.search).get("artist");
  let photos = [];
  let data;

  try { data = await api("/api/artists"); }
  catch {
    form.prepend(el("p", { class: "form-error" }, "The form couldn't load. Refresh, or call the shop instead."));
    return;
  }

  const W = data.words || {};
  const $ = (id) => document.getElementById(id);
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  $("artistHead").textContent = cap(W.provider || "who");
  $("artistLabel").textContent = `Who would you like?`;
  $("summaryLabel").textContent = W.summary || "What do you need?";
  $("summaryHint").textContent = W.summaryHint || "";
  if (!data.policyCheck && !data.ageCheck) $("beforeHead").hidden = true;
  if (data.policyCheck) { $("policyPart").hidden = false; $("policy").textContent = data.depositPolicy; }
  if (data.ageCheck) { $("agePart").hidden = false; $("ageText").textContent = `I'm ${data.studio.minAge} or older and will bring government photo ID`; }
  // ---- Artist dropdown ----
  const sel = document.getElementById("artist");
  const multi = data.artists.length > 1;
  const anyOpen = data.artists.some((a) => a.booksOpen);
  if (data.artists.length < 2) $("artistPart").hidden = true; // one person: nothing to choose
  if (anyOpen) sel.append(el("option", { value: "any" }, `No preference (first available ${W.provider || "person"})`));
  for (const a of data.artists) sel.append(el("option", { value: a.slug, "data-closed": a.booksOpen ? null : "1" }, a.booksOpen ? a.name : `${a.name} (books closed, join the waitlist)`));
  const firstOpen = data.artists.find((a) => a.booksOpen);
  sel.value = data.artists.some((a) => a.slug === preset) || (preset === "any" && anyOpen) ? preset : multi && anyOpen ? "any" : (firstOpen || data.artists[0]).slug;
  sel.addEventListener("change", syncArtist);
  syncArtist();

  function syncArtist() {
    const chosen = sel.selectedOptions[0];
    const closed = chosen && chosen.dataset.closed === "1";
    const info = data.artists.find((x) => x.slug === sel.value);
    document.getElementById("artistStyles").textContent = info ? (info.styles || []).join(", ") : "You'll be matched with the best fit.";
    document.getElementById("rest").hidden = closed;
    const wl = document.getElementById("waitlist");
    wl.hidden = !closed; wl.textContent = "";
    if (!closed) return;
    const a = data.artists.find((x) => x.slug === chosen.value);
    const msg = el("p", { role: "status", style: "margin-top:12px" });
    const nameI = el("input", { id: "wlName", type: "text", autocomplete: "name" });
    const mailI = el("input", { id: "wlEmail", type: "email", autocomplete: "email" });
    const btn = el("button", { class: "btn", type: "button", onclick: async () => {
      btn.disabled = true; msg.textContent = "";
      try { await api("/api/waitlist", { body: { artist: a.slug, name: nameI.value, email: mailI.value } }); msg.textContent = "You're on the waitlist. You'll get an email when books open."; }
      catch (e) { msg.textContent = e.message; btn.disabled = false; }
    } }, "Join the waitlist");
    wl.append(el("div", { class: "panel" },
      el("h3", {}, `${a.name} isn't taking new bookings right now`),
      el("p", { class: "muted" }, "Leave your name and email and you'll hear as soon as they are."),
      el("div", { class: "row" },
        el("div", { class: "field" }, el("label", { for: "wlName" }, "Name"), nameI),
        el("div", { class: "field" }, el("label", { for: "wlEmail" }, "Email"), mailI)),
      btn, msg));
  }

  // ---- This business's questions ----
  const custom = $("custom");
  let photoField = null, photoErr = null, drop = null, thumbs = null;
  for (const q of data.form || []) {
    const id = `q_${q.key}`, label = el("label", { for: id }, q.label, q.required ? null : el("span", { class: "opt" }, " (optional)"), q.hint ? el("span", { class: "hint" }, q.hint) : null);
    const err = el("div", { class: "err" });
    let input;
    switch (q.type) {
      case "long": input = el("textarea", { id, name: q.key, rows: 4, maxlength: 2000 }); break;
      case "number": input = el("input", { id, name: q.key, type: "number", inputmode: "numeric" }); break;
      case "date": input = el("input", { id, name: q.key, type: "date" }); break;
      case "time": input = el("input", { id, name: q.key, type: "time", step: 900 }); break;
      case "money": input = el("input", { id, name: q.key, type: "text", inputmode: "decimal", maxlength: 40, placeholder: "e.g. 400 or 300-500" }); break;
      case "address": input = el("input", { id, name: q.key, type: "text", autocomplete: "street-address", maxlength: 300 }); break;
      case "choice":
        input = el("select", { id, name: q.key }, el("option", { value: "" }, "Choose one"), q.options.map((o) => el("option", { value: o }, o))); break;
      case "multi":
        custom.append(el("div", { class: "field", "data-f": q.key }, el("span", { class: "label" }, q.label, q.hint ? el("span", { class: "hint" }, q.hint) : null),
          el("div", { class: "choices" }, q.options.map((o) => el("label", { class: "choice" }, el("input", { type: "checkbox", name: q.key, value: o }), el("strong", {}, o)))), err));
        continue;
      case "check":
        custom.append(el("label", { class: "check", "data-f": q.key }, el("input", { type: "checkbox", name: q.key }), " ", q.label));
        continue;
      case "photos": {
        drop = el("label", { class: "drop", for: "photos" }, "Add photos");
        thumbs = el("div", { class: "thumbs" });
        const fileIn = el("input", { id: "photos", type: "file", accept: "image/*", multiple: true, hidden: true });
        photoErr = el("div", { class: "err" });
        photoField = el("div", { class: "field", "data-f": "images" },
          el("span", { class: "label" }, q.label, el("span", { class: "opt" }, " (optional, up to 4)"), q.hint ? el("span", { class: "hint" }, q.hint) : null),
          drop, fileIn, thumbs, photoErr);
        custom.append(photoField);
        fileIn.addEventListener("change", () => { addFiles([...fileIn.files]); fileIn.value = ""; });
        ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
        ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
        drop.addEventListener("drop", (e) => addFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"))));
        continue;
      }
      default: input = el("input", { id, name: q.key, type: "text", maxlength: 300 });
    }
    if (q.required) input.required = true;
    custom.append(el("div", { class: "field", "data-f": q.key }, label, input, err));
  }

  // ---- The client's own offer (businesses that let clients name a price first) ----
  const N = data.negotiate || {};
  if (N.clientOffersFirst) {
    $("offerPart").hidden = false;
    $("offerPriceF").hidden = !N.price; $("offerWhen").hidden = !N.datetime; $("offerLenF").hidden = !N.datetime; $("offerScopeF").hidden = !N.scope;
    const hrs = (m) => (m % 60 ? `${(m / 60).toFixed(1)} hours` : `${m / 60} hour${m === 60 ? "" : "s"}`);
    for (const m of data.sessionLengths || []) $("offerLen").append(el("option", { value: m }, hrs(m)));
    $("offerDate").min = new Date().toISOString().slice(0, 10);
  }

  // ---- Photos ----
  const photoError = (m) => { if (!photoField) return; photoErr.textContent = m; photoField.classList.toggle("invalid", Boolean(m)); };
  async function addFiles(list) {
    photoError("");
    for (const f of list) {
      if (photos.length >= 4) { photoError("Up to 4 photos. You can send more once they reply."); break; }
      try { photos.push(await shrink(f)); } catch (e) { photoError(e.message); }
    }
    renderThumbs();
  }
  function renderThumbs() {
    thumbs.textContent = "";
    drop.textContent = photos.length ? "Add more photos" : "Add photos";
    photos.forEach((p, i) => thumbs.append(el("div", { class: "thumb" }, el("img", { src: p, alt: `Photo ${i + 1}` }),
      el("button", { type: "button", "aria-label": `Remove photo ${i + 1}`, onclick: () => { photos.splice(i, 1); renderThumbs(); } }, "×"))));
  }

  // Clear a field's error as soon as it changes.
  const clearField = (e) => { const f = e.target.closest(".field.invalid"); if (f && f !== photoField) f.classList.remove("invalid"); };
  form.addEventListener("input", clearField);
  form.addEventListener("change", clearField);

  // ---- Submit ----
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      artist: fd.get("artist") || "", name: fd.get("name"), email: fd.get("email"), phone: fd.get("phone"), smsOk: fd.has("smsOk"), instagram: fd.get("instagram"),
      idea: fd.get("idea"), age18: fd.has("age18"), agreePolicy: fd.has("agreePolicy"), website: fd.get("website"), images: photos,
    };
    for (const q of data.form || []) {
      if (q.type === "photos") continue;
      payload[q.key] = q.type === "check" ? fd.has(q.key) : q.type === "multi" ? fd.getAll(q.key) : fd.get(q.key);
    }
    if (N.clientOffersFirst) payload.offer = { price: $("offerPrice").value, date: $("offerDate").value, time: $("offerTime").value, durationMin: $("offerLen").value, scope: $("offerScope").value };
    form.querySelectorAll(".field.invalid").forEach((f) => f.classList.remove("invalid"));
    const fe = document.getElementById("formError"); fe.hidden = true;
    const btn = document.getElementById("submit"); btn.disabled = true; btn.textContent = "Sending…";
    try {
      const r = await api("/api/requests", { body: payload });
      form.hidden = true;
      const done = document.getElementById("done"); done.hidden = false;
      done.append(el("div", { class: "panel", tabindex: "-1", id: "doneBox" },
        el("h2", {}, "Request sent"),
        el("p", {}, `Thanks, ${payload.name.trim().split(" ")[0]}. A confirmation is on its way to ${payload.email}. You'll hear back there.`),
        el("p", { style: "margin:0" }, el("a", { href: `/request?id=${encodeURIComponent(r.id)}&t=${encodeURIComponent(r.token)}` }, "Check your request status"))));
      (BW.toTop || (() => window.scrollTo({ top: 0 })))();
      document.getElementById("doneBox").focus({ preventScroll: true });
    } catch (err) {
      for (const [k, msg] of Object.entries(err.data?.fields || {})) {
        const f = form.querySelector(`[data-f="${k}"]`);
        if (f) { f.classList.add("invalid"); const er = f.querySelector(".err"); if (er) er.textContent = msg; }
      }
      fe.textContent = err.message; fe.hidden = false;
      const firstBad = form.querySelector(".field.invalid");
      (firstBad || fe).scrollIntoView({ behavior: "smooth", block: "center" });
      if (err.data?.booksClosed) location.reload();
    } finally { btn.disabled = false; btn.textContent = "Send request"; }
  });
})();
