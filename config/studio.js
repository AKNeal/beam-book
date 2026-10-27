// The current shop's settings. Beam Book serves many shops, so this is not a fixed file any more:
// each request is tied to one shop (lib/tenant.js) and `config.studio`, `config.artists`, etc. read that shop's settings.
// Defaults for new shops live in lib/tenant.js (DEFAULTS).

module.exports = new Proxy({}, {
  get(_, key) {
    if (typeof key === "symbol") return undefined;
    return require("../lib/tenant").current()[key];
  },
  has(_, key) { return key in require("../lib/tenant").current(); },
});
