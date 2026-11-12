// Beam Book: builds public/*.html from src/pages/*.html.
// The pages are the same for every shop; /assets/shop.js fills in the shop's name, details, logo and colors
// when the page loads (from /api/artists), based on the web address it's opened at.
// Run: node build.js   (also runs automatically on Vercel via "npm run build")

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "src/pages");
const OUT = path.join(__dirname, "public");

const headHtml = () => `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0d1014">
<link rel="icon" href="/assets/brand/beam-icon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/brand/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css">
<script src="/assets/shop.js"></script>`;

const NAV = [["/artists", "Team", "artists"]];
const header = (page) => `<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="page header-inner">
    <a class="brand" href="/"><img data-shop="logo" src="" alt="" width="46" height="46" hidden><span class="brand-mono" hidden></span><span data-shop="name"></span></a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav">Menu</button>
    <nav class="nav" id="nav" aria-label="Main">
      ${NAV.map(([href, label, key]) => `<a href="${href}"${key === page ? ' aria-current="page"' : ""}>${label}</a>`).join("\n      ")}
      <a data-shop="website" data-shop-if="website" href="#" rel="noopener" hidden>Shop website</a>
      <a class="btn sign sm" href="/booking" data-word="cta"${page === "booking" ? ' aria-current="page"' : ""}>Request a booking</a>
    </nav>
  </div>
</header>`;

const footer = () => `<footer class="site-footer">
  <div class="page">
    <div class="footer-grid">
      <div>
        <a class="brand" href="/"><img data-shop="logo" src="" alt="" width="46" height="46" hidden><span class="brand-mono" hidden></span><span data-shop="name"></span></a>
        <p class="muted" style="margin-top:14px;max-width:30ch" data-shop="tagline"></p>
      </div>
      <div data-shop-if="address" hidden>
        <h4>Visit</h4>
        <ul><li><a data-shop="address" href="#" rel="noopener"></a></li></ul>
      </div>
      <div data-shop-if="phone|instagram|website" hidden>
        <h4>Contact</h4>
        <ul>
          <li data-shop-if="phone" hidden><a data-shop="phone" href="#"></a></li>
          <li data-shop-if="instagram" hidden><a data-shop="instagram" href="#" rel="noopener"></a></li>
          <li data-shop-if="website" hidden><a data-shop="website" href="#" rel="noopener"></a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© <span data-shop="year"></span> <span data-shop="name"></span></span>
    </div>
  </div>
</footer>
<script src="/assets/site.js" defer></script>`;

const instagramStrip = `<section class="section" data-ig-feed hidden aria-label="Latest on Instagram">
    <div class="page">
      <div class="ig-head">
        <h2>Latest on Instagram</h2>
        <div class="ig-controls"><a href="#" rel="noopener" data-ig-handle>Instagram</a>
          <button class="ig-prev" type="button" aria-label="Previous posts">&#8249;</button><button class="ig-next" type="button" aria-label="More posts">&#8250;</button></div>
      </div>
      <div class="ig-track"></div>
    </div>
  </section>
<script src="/assets/instagram.js" defer></script>`;

const poweredBy = `<p class="poweredby"><a href="https://beam.nealmedia.app" rel="noopener" target="_blank">Powered by: <img class="pb-on-dark" src="/assets/brand/beam-logo.svg" alt="Beam" width="76" height="22"><img class="pb-on-light" src="/assets/brand/beam-logo-dark-text.svg" alt="Beam" width="76" height="22"></a></p>`;

let n = 0;
for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(SRC, file), "utf8")
    .replace(/<!--#head-->/g, headHtml())
    .replace(/<!--#header (\w+)-->/g, (_, page) => header(page))
    .replace(/<!--#footer-->/g, footer())
    .replace(/<!--#instagram-->/g, instagramStrip)
    .replace(/<!--#poweredby-->/g, poweredBy);
  fs.writeFileSync(path.join(OUT, file), html);
  n++;
}
// The front page of a shop is its request form.
fs.copyFileSync(path.join(OUT, "booking.html"), path.join(OUT, "index.html"));
console.log(`built ${n} pages`);
