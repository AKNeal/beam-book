// Artists page: swap the built-in list for the live one (includes artists added from the inbox).
(async () => {
  const { api, el } = BW;
  const box = document.getElementById("artists");
  let data;
  try { data = await api("/api/artists"); } catch { return; } // keep the built-in list
  if (!data.artists.length) return;
  const initials = (n) => n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  box.replaceChildren(...data.artists.map((a) => {
    const first = a.name.split(" ")[0];
    const ig = a.instagram ? a.instagram.replace(/^@/, "") : "";
    return el("article", { class: "artist-card" },
      el("h2", { class: "artist-name" }, a.name),
      el("div", { class: "artist-photo" }, a.photo ? el("img", { src: a.photo, alt: a.photo.startsWith("/api/") ? a.name : `Work by ${a.name}`, loading: "lazy" }) : el("span", {}, initials(a.name))),
      el("div", { class: "artist-body" },
        a.styles.length ? el("p", { class: "artist-styles" }, a.styles.join(" · ")) : null,
        a.bio ? el("p", {}, a.bio) : null,
        a.booksOpen ? null : el("p", { class: "artist-closed" }, "Not taking new bookings right now. Join the waitlist to hear when that changes."),
        el("div", { class: "actions" },
          el("a", { class: "btn sign", href: `/booking?artist=${encodeURIComponent(a.slug)}` }, a.booksOpen ? `Book ${first}` : "Join the waitlist"),
          ig ? el("a", { class: "btn line", href: `https://instagram.com/${encodeURIComponent(ig)}`, rel: "noopener" }, `@${ig}`) : null)));
  }));
})();
