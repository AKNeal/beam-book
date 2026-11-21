// New-client onboarding: the application, starting a shop from it, the welcome email, the phased checklist
// (locked until the agreement is signed), booking-only shops, and a team member added later getting their own items.
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert/strict");
const PORT = 4900 + Math.floor(Math.random() * 300), BASE = `http://localhost:${PORT}`, DATA = fs.mkdtempSync(path.join(os.tmpdir(), "bw-onb-"));
(async () => {
  const srv = spawn(process.execPath, ["dev-server.js"], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, PLATFORM_PASSWORD: "control-pass", SESSION_SECRET: "s3cret", BEAMBOOK_DOMAIN: "localhost", TZ: "UTC", STORE_NAMESPACE: "sandbox",
      RESEND_API_KEY: "", EMAIL_FROM: "", KV_REST_API_URL: "", KV_REST_API_TOKEN: "", UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "" } });
  let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 50 && !log.includes("running"); i++) await new Promise((r) => setTimeout(r, 100));
  const json = async (r) => ({ status: r.status, data: await r.json().catch(() => ({})), cookie: (r.headers.get("set-cookie") || "").split(";")[0] });
  const pub = (b) => fetch(BASE + "/api/callback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(json);
  let control = "";
  const plat = async (b) => { const r = await json(await fetch(BASE + "/api/platform", { method: b ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(control ? { Cookie: control } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) })); if (r.cookie) control = r.cookie; return r; };
  const shop = (host, cookie) => async (url, b) => json(await fetch(BASE + url, { method: b ? "POST" : "GET", headers: { "Content-Type": "application/json", "X-Forwarded-Host": host, ...(cookie() ? { Cookie: cookie() } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) }));
  const ok = (m) => console.log(`  ✓ ${m}`);
  try {
    // ---- Phase 2: the application
    const app = { kind: "application", business: "Moose Ink", name: "Jo Smith", phone: "907-555-0142", email: "Jo@Example.com", type: "tattoo",
      site: "mooseink.com", social: "instagram.com/mooseink", address: "1 Main St, North Pole", hours: "Tue–Sat 11 to 7", offering: "custom tattoos" };
    let r = await pub({ ...app, hours: "" });
    assert.equal(r.status, 400); assert.match(r.data.error, /hours/);
    r = await pub({ ...app, site: "", noSite: false });
    assert.equal(r.status, 400); assert.match(r.data.error, /website/);
    r = await pub({ ...app, site: "", noSite: true, social: "" });
    assert.equal(r.status, 400); assert.match(r.data.error, /Instagram or Facebook/);
    r = await pub({ ...app, website: "bot-filled" });
    assert.equal(r.status, 200); // honeypot: accepted, nothing saved
    r = await pub(app);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.match(log, /\[apply:dev\][^\n]*Beam application: Moose Ink/);
    ok("application: required basics checked, honeypot ignored, saved and emailed (logged in previews)");

    assert.equal((await plat({ action: "login", password: "control-pass" })).status, 200);
    let list = (await plat()).data;
    assert.equal(list.apps.length, 1, "only the real application is waiting");
    const a = list.apps[0];
    assert.equal(a.business, "Moose Ink"); assert.equal(a.email, "jo@example.com"); assert.equal(a.site, "https://mooseink.com"); assert.equal(list.appTypes[a.type].kind, "tattoo");
    ok("control page lists the application with its business type");

    // ---- Phase 3: start building from it, welcome email included
    r = await plat({ action: "create", kind: "tattoo", slug: "mooseink", ownerName: "Jo Smith", ownerEmail: a.email,
      studio: { name: a.business, address: a.address, timeZone: "America/Anchorage" }, theme: { mode: "dark", accent: "#d08a3c" },
      neal: { status: "building", shellUrl: "mooseink.nealmedia.app", appId: a.id }, sendWelcome: true });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.ok(r.data.welcomed && r.data.welcomed.ok, "welcome email went out");
    assert.match(log, /\[welcome:dev\] to=jo@example.com subject="Your new website is ready to try, Jo"/);
    assert.match(log, /Your example site: https:\/\/mooseink\.nealmedia\.app/);
    assert.match(log, /reset=/, "password link in the email"); assert.match(log, /onboarding\?shop=mooseink/, "setup page in the email");
    list = (await plat()).data;
    assert.equal(list.apps.length, 0, "the application is no longer waiting");
    const row = list.shops.find((s) => s.slug === "mooseink");
    assert.equal(row.neal.status, "building"); assert.equal(row.neal.day, 1);
    const full = (await plat()).data && (await plat({ action: "update", slug: "mooseink" })).data.shop;
    assert.equal(full.siteChecklist.length, 17, "tattoo starter: Phase 5 website checklist");
    assert.ok(full.siteChecklist.some((x) => x.key === "aftercare"), "tattoo extras from Black Wolf");
    assert.equal(full.calendarDefaults.stepMin, 60); assert.equal(full.calendarDefaults.leadHours, 48);
    assert.ok(full.neal.welcomeSentAt, "when the welcome went out is recorded");
    ok("start building: tattoo starter, Phase 5 checklist, Day 1 of 90, welcome email with example site + password + setup links");

    // ---- Phase 4–6: the owner's phased checklist
    const tok = new URL(r.data.ownerLink).searchParams.get("reset");
    let oc = "";
    const owner = shop("mooseink.localhost", () => oc);
    r = await owner("/api/admin/login", { action: "reset", token: tok, password: "Moose-ink-2026!" });
    assert.equal(r.status, 200, JSON.stringify(r.data)); oc = r.cookie;
    r = await owner("/api/admin/books", { action: "setupList" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const items = r.data.items.filter((i) => i.mine);
    assert.deepEqual([...new Set(items.map((i) => i.phase))], [4, 5, 6], "Try it out, Fill in your website, Happy and signed");
    const locked = items.filter((i) => i.locked);
    assert.ok(locked.length >= 3 && locked.every((i) => i.phase === 6), "the after-the-agreement steps are locked");
    assert.ok(!items.find((i) => i.title.startsWith("Tell Neal Media you're happy")).locked, "saying you're happy isn't locked");
    assert.equal(r.data.neal.status, "building"); assert.equal(r.data.neal.day, 1);
    assert.ok(items.find((i) => i.auto === "password").done, "password step ticked itself off");
    r = await owner("/api/admin/books", { action: "setupDone", id: locked[0].id, done: true });
    assert.equal(r.status, 400); assert.match(r.data.error, /once the agreement is signed/);
    r = await owner("/api/admin/books", { action: "setupDone", id: items.find((i) => i.phase === 4 && !i.auto).id, done: true });
    assert.equal(r.status, 200);
    ok("owner's checklist comes in phases; after-the-agreement steps are locked and can't be ticked");

    // The inbox gets the status (add-on tags), and a Neal Media login added later gets its own Phase 3 list.
    r = await owner("/api/admin/inbox");
    assert.equal(r.data.neal.status, "building");
    r = await owner("/api/admin/login", { action: "add", name: "Neal Media", email: "nealmedia@yahoo.com", role: "admin" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    r = await owner("/api/admin/books", { action: "setupList" });
    const nealItems = r.data.items.filter((i) => i.userName === "Neal Media");
    assert.ok(nealItems.some((i) => i.phase === 3 && i.auto === "welcome" && i.done), "Phase 3 list; the welcome step ticked itself off");
    assert.ok(nealItems.some((i) => i.title === "Clone their current site to the example address" && /mooseink\.nealmedia\.app/.test(i.details)));
    const again = (await owner("/api/admin/books", { action: "setupList" })).data.items.filter((i) => i.userName === "Neal Media").length;
    assert.equal(again, nealItems.length, "added once, not every time the list loads");
    ok("someone added later gets their own starting items once; Neal Media's welcome step ticks itself off");

    // Signing unlocks phase 6.
    r = await plat({ action: "update", slug: "mooseink", neal: { status: "signed", addons: ["seo", "website", "nope"] } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.shop.neal.addons, ["seo", "website"]); assert.ok(r.data.shop.neal.signedAt);
    r = await owner("/api/admin/books", { action: "setupList" });
    assert.equal(r.data.items.filter((i) => i.locked).length, 0, "everything opens once signed");
    assert.ok(r.data.items.find((i) => i.auto === "signed").done, "the signing step ticked itself off");
    ok("agreement signed: add-ons saved (unknown ones dropped), phase 6 opens");

    // ---- Booking only: Beam steps, no website checklist
    r = await plat({ action: "create", kind: "catering", slug: "snowcafe", ownerName: "Al Baker", ownerEmail: "al@example.com",
      studio: { name: "Snow Cafe", timeZone: "America/Anchorage" }, neal: { status: "booking" } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.shop.siteChecklist, undefined, "booking-only: no website checklist");
    assert.equal(r.data.shop.calendarDefaults.leadHours, 72, "catering starter from Crave");
    assert.equal(r.data.shop.form.find((q) => q.key === "service").options[0], "Pickup");
    let cc = ""; const cafe = shop("snowcafe.localhost", () => cc);
    r = await cafe("/api/admin/login", { action: "reset", token: new URL(r.data.ownerLink).searchParams.get("reset"), password: "Snow-cafe-2026!" }); cc = r.cookie;
    r = await cafe("/api/admin/books", { action: "setupList" });
    assert.ok(r.data.items.every((i) => i.phase === 4), "booking-only shops get the Try it out steps only");
    ok("booking-only shop: catering starter, Beam steps only");

    // ---- Shops from before (no Neal Media status) count as current clients and are left alone.
    r = await plat({ action: "update", slug: "snowcafe", neal: { status: "current" } });
    assert.equal(r.data.shop.neal.status, "current");
    list = (await plat()).data;
    assert.equal(list.shops.find((s) => s.slug === "snowcafe").neal.status, "current");
    r = await plat({ action: "welcome", slug: "snowcafe" });
    assert.equal(r.status, 200); assert.match(log, /\[welcome:dev\] to=al@example.com subject="Your Beam booking page is ready, Al"/);
    ok("current clients: status shown as current; welcome email can be resent from the shop page");
    console.log("\nOnboarding checks passed.");
  } catch (e) {
    console.error(e); console.error("---- server log ----\n" + log.slice(-4000)); process.exitCode = 1;
  } finally { srv.kill(); }
})();
