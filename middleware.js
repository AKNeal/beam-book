// Routing Middleware: the bare Beam Book domain (beam-book.com, www.beam-book.com) shows the product splash page
// (public/home.html) at "/". Shop addresses (levelup.beam-book.com, book.jmhealing.com, ...) are untouched and keep
// their booking form at "/". Only "/" runs through here, so nothing else pays for it.
// Extra splash hosts can be listed in SPLASH_HOSTS (comma-separated).

export const config = { matcher: "/" };

const HOSTS = new Set(["beam-book.com", "www.beam-book.com"]);

export default function middleware(request) {
  const url = new URL(request.url);
  const host = String(request.headers.get("x-forwarded-host") || request.headers.get("host") || url.hostname)
    .toLowerCase().replace(/:\d+$/, "");
  const extra = String((typeof process !== "undefined" && process.env.SPLASH_HOSTS) || "")
    .split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!HOSTS.has(host) && !extra.includes(host)) return; // carry on as normal
  return new Response(null, { headers: { "x-middleware-rewrite": new URL("/home", request.url).toString() } });
}
