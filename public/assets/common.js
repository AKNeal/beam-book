// Shared browser helpers.
window.BW = Object.assign(window.BW || {}, {
  async api(path, opts = {}) {
    const r = await fetch(path, {
      method: opts.method || (opts.body ? "POST" : "GET"),
      headers: opts.body ? { "Content-Type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
    let data = {};
    try { data = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(data.error || `Something went wrong (${r.status}).`); e.status = r.status; e.data = data; throw e; }
    return data;
  },

  el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "html") n.innerHTML = v; // only ever used with static strings
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : String(kid));
    return n;
  },

  initials(name) { return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase(); },

  // Shrink a photo in the browser to a JPEG (longest side maxPx) so uploads stay small.
  shrink(file, maxPx = 1600, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        let q = quality, out = c.toDataURL("image/jpeg", q);
        while (out.length > 900000 && q > 0.45) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't an image we can read.")); };
      img.src = url;
    });
  },

  date(iso) { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); },
  datetime(iso) { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); },
});
