/* Beam inbox: the floating rebooking-challenge button for barbers. Shows your rebook count in Roman numerals;
   tap it, then tap ADD REBOOKING (big, middle of the screen) to add one to your challenge. */
(function () {
  const { el, api } = window.BW;
  const call = (b) => api("/api/admin/books", { body: { action: "challengeRebook", ...b } });
  function roman(n) {
    if (!n) return "0";
    const v = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let out = ""; for (const [k, s] of v) while (n >= k) { out += s; n -= k; } return out;
  }
  const css = `.rbf{position:fixed;right:18px;bottom:18px;z-index:65;min-width:74px;height:74px;padding:0 14px;border-radius:999px;border:0;cursor:pointer;
    background:var(--sign);color:var(--on-sign,#14110c);box-shadow:0 0 0 3px var(--ink),0 10px 30px rgba(0,0,0,.35);display:flex;flex-direction:column;align-items:center;justify-content:center;font:inherit}
  .rbf b{font-family:Georgia,"Times New Roman",serif;font-size:26px;line-height:1;letter-spacing:.04em}.rbf small{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-top:3px}
  .rbz{position:relative;display:inline-block}.rbz::after{content:"";position:absolute;left:-12%;right:-12%;top:50%;border-top:.09em solid currentColor;transform:rotate(-55deg)}
  .rbf.pop{animation:rbpop .5s ease}@keyframes rbpop{0%{transform:scale(1)}40%{transform:scale(1.25)}100%{transform:scale(1)}}
  .rbo{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.72);display:grid;place-items:center;padding:20px}
  .rbo .in{display:grid;justify-items:center;gap:18px;text-align:center;color:#fff}
  .rbo .add{width:min(78vw,340px);aspect-ratio:1;border-radius:50%;border:0;cursor:pointer;background:var(--sign);color:var(--on-sign,#14110c);
    font:inherit;font-size:clamp(26px,7vw,40px);font-weight:900;letter-spacing:.04em;line-height:1.05;box-shadow:0 0 0 6px #fff,0 0 60px rgba(255,255,255,.35);transition:transform .08s}
  .rbo .add:active{transform:scale(.96)}.rbo .num{font-family:Georgia,"Times New Roman",serif;font-size:44px;line-height:1}.rbo .meta{opacity:.85;font-size:15px}
  .rbo .row{display:flex;gap:10px}.rbo .row button{background:none;border:1.5px solid rgba(255,255,255,.6);color:#fff;border-radius:999px;padding:9px 18px;font:inherit;cursor:pointer}
  @media (prefers-reduced-motion:reduce){.rbf.pop{animation:none}}`;
  // Zero shows as a 0 with a diagonal line through it.
  const numEl = (n) => (n ? document.createTextNode(roman(n)) : el("span", { class: "rbz", "aria-label": "zero" }, "0"));
  let S = null, fab = null;

  // Preview: an Owner / Administrator login with no barber sees the same button, counting only on this device
  // (nothing goes into the real challenge).
  let preview = false;
  const PKEY = "beam.rebookPreview";
  const pv = { get: () => { try { return +localStorage.getItem(PKEY) || 0; } catch { return 0; } }, set: (n) => { try { localStorage.setItem(PKEY, String(n)); } catch {} } };
  async function start(D) {
    if (!D || !D.me || !D.instant) return;
    preview = !D.me.artist && Boolean(D.me.full || D.me.seesAll);
    if (!D.me.artist && !preview) return; // barbers (and the preview for the shop's managers)
    if (D.me.artist && (D.apprentices || []).includes(D.me.artist)) return;
    try { S = await call(preview ? { preview: true } : {}); } catch { return; }
    if (preview && S.live) S.count = pv.get();
    if (!S.live) { if (fab) fab.remove(); fab = null; return; }
    if (!document.getElementById("rbCss")) document.head.append(el("style", { id: "rbCss" }, css));
    if (!fab) { fab = el("button", { class: "rbf", type: "button", onclick: open }); document.body.append(fab); }
    paint();
  }
  function paint() {
    fab.replaceChildren(el("b", {}, numEl(S.count)), el("small", {}, "Rebooks"));
    fab.setAttribute("aria-label", `${S.title}: ${S.count} rebook${S.count === 1 ? "" : "s"}. Tap to add one.`);
  }
  function open() {
    const num = el("div", { class: "num", "aria-live": "polite" }, numEl(S.count));
    const meta = el("div", { class: "meta" });
    const setMeta = () => { meta.textContent = `${preview ? "Preview (not counted) · " : ""}${S.title} · ${S.count} rebook${S.count === 1 ? "" : "s"}${S.metric === "rebooks" ? ` of ${S.goal}` : ""} · ${ordinal(S.place)} of ${S.of} · ${S.daysLeft} day${S.daysLeft === 1 ? "" : "s"} left`; };
    setMeta();
    const add = el("button", { class: "add", type: "button", onclick: async () => {
      add.disabled = true;
      try { S = preview ? { ...S, count: S.count + 1 } : await call({ add: true }); if (preview) pv.set(S.count); num.replaceChildren(numEl(S.count)); setMeta(); paint(); fab.classList.remove("pop"); void fab.offsetWidth; fab.classList.add("pop"); if (navigator.vibrate) navigator.vibrate(30); setTimeout(close, 700); }
      catch (e) { meta.textContent = e.message; add.disabled = false; }
    } }, "ADD", el("br"), "REBOOKING");
    const ov = el("div", { class: "rbo", role: "dialog", "aria-label": "Add a rebooking", onclick: (e) => { if (e.target === ov) close(); } },
      el("div", { class: "in" }, num, add, meta,
        el("div", { class: "row" },
          el("button", { type: "button", onclick: async () => { try { if (preview) { if (!S.count) throw new Error("Nothing to undo."); S = { ...S, count: S.count - 1 }; pv.set(S.count); } else S = await call({ undo: true }); num.replaceChildren(numEl(S.count)); setMeta(); paint(); } catch (e) { meta.textContent = e.message; } } }, "Undo last"),
          el("button", { type: "button", onclick: close }, "Close"))));
    function close() { ov.remove(); document.removeEventListener("keydown", esc); }
    function esc(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", esc);
    document.body.append(ov); add.focus();
  }
  const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
  window.BBRebook = { start };
})();
