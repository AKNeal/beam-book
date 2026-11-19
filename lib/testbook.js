// Test bookings: anything the shop's own team books for themselves (their login email or phone), or with "test" in
// the name, doesn't alert the shop or the barber (no emails, no texts). The person booking still gets the client
// confirmation, so they can see what clients get.
const auth = require("./auth");
const digits = (s) => String(s || "").replace(/\D/g, "").slice(-10);

async function isTest(client = {}) {
  if (/\btest\b/i.test(String(client.name || ""))) return true;
  const email = String(client.email || "").trim().toLowerCase(), phone = digits(client.phone);
  const team = (await auth.users()).filter((u) => u.active !== false);
  return team.some((u) => (email && String(u.email || "").toLowerCase() === email) || (phone && phone.length === 10 && digits(u.phone) === phone));
}

module.exports = { isTest };
