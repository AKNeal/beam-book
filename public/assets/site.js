// Mobile menu, gallery filters and the photo viewer.
(() => {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Close" : "Menu";
    });
  }

  // Gallery filters
  const chips = document.querySelectorAll("[data-filter]");
  const items = document.querySelectorAll(".work-item");
  chips.forEach((chip) => chip.addEventListener("click", () => {
    const f = chip.dataset.filter;
    chips.forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
    let shown = 0;
    items.forEach((it) => { const on = f === "all" || it.dataset.style === f; it.hidden = !on; if (on) shown++; });
    const empty = document.getElementById("empty");
    if (empty) empty.hidden = shown > 0;
  }));

  // Photo viewer
  const box = document.getElementById("lightbox");
  if (box && items.length) {
    const img = box.querySelector("img"), title = box.querySelector("strong"), sub = box.querySelector("figcaption span");
    const closeBtn = box.querySelector(".close");
    let last = null;
    const close = () => { box.classList.remove("open"); document.body.style.overflow = ""; if (last) last.focus(); };
    items.forEach((it) => it.addEventListener("click", () => {
      last = it;
      img.src = it.dataset.full; img.alt = it.querySelector("img").alt;
      title.textContent = it.dataset.title;
      sub.textContent = `${it.dataset.sub}. ${it.dataset.note}`;
      box.classList.add("open"); document.body.style.overflow = "hidden"; closeBtn.focus();
    }));
    closeBtn.addEventListener("click", close);
    box.addEventListener("click", (e) => { if (e.target === box) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && box.classList.contains("open")) close(); });
  }
})();
