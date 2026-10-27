// Tiny key-value store.
// Production: Upstash Redis over REST (env UPSTASH_REDIS_REST_URL / _TOKEN, or Vercel KV's KV_REST_API_URL / _TOKEN).
// Local dev: a JSON file in .data/ so the app runs with zero setup.

const fs = require("fs");
const path = require("path");

// Accept the usual names, plus any custom prefix the Vercel integration was given (e.g. STORAGE_REST_API_URL).
function findCreds() {
  const e = process.env;
  if (e.UPSTASH_REDIS_REST_URL && e.UPSTASH_REDIS_REST_TOKEN) return [e.UPSTASH_REDIS_REST_URL, e.UPSTASH_REDIS_REST_TOKEN];
  if (e.KV_REST_API_URL && e.KV_REST_API_TOKEN) return [e.KV_REST_API_URL, e.KV_REST_API_TOKEN];
  for (const name of Object.keys(e)) {
    const m = name.match(/^(.*)_REST_API_URL$/);
    if (m && e[`${m[1]}_REST_API_TOKEN`] && /^https:\/\//.test(e[name])) return [e[name], e[`${m[1]}_REST_API_TOKEN`]];
  }
  return [null, null];
}
const [URL_, TOKEN] = findCreds();
const useRedis = Boolean(URL_ && TOKEN);

// Every shop's keys start with its slug ("blackwolf:..."); Beam Book's own records start with "beambook:".
const shopPrefix = () => `${require("./tenant").current().tenant}:`;

// On Vercel the file fallback can't work (read-only disk), so say plainly what's missing.
if (process.env.VERCEL && !useRedis) {
  console.error("[store] Upstash Redis isn't connected. Connect it in Vercel → Storage so requests can be saved.");
}
function needRedis() {
  if (process.env.VERCEL && !useRedis) throw new Error("Storage isn't connected yet (Vercel → Storage → Upstash Redis).");
}

// ---------- Redis (REST) ----------
async function redis(cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const data = await r.json();
  if (data.error) throw new Error(`Redis: ${data.error}`);
  return data.result;
}

// ---------- File fallback ----------
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "db.json");
function readDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return { kv: {}, lists: {}, ttl: {} }; }
}
function writeDb(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function make(prefix) {
const k = (key) => `${prefix()}${key}`;
return {
  backend: useRedis ? "redis" : "file",

  async getJSON(key) {
    needRedis();
    if (useRedis) {
      const v = await redis(["GET", k(key)]);
      return v ? JSON.parse(v) : null;
    }
    const v = readDb().kv[k(key)];
    return v === undefined ? null : v;
  },

  async setJSON(key, value) {
    needRedis();
    if (useRedis) return redis(["SET", k(key), JSON.stringify(value)]);
    const db = readDb(); db.kv[k(key)] = value; writeDb(db);
  },

  // Newest-first index of ids (sorted by score = timestamp).
  async indexAdd(key, id, score) {
    needRedis();
    if (useRedis) return redis(["ZADD", k(key), score, id]);
    const db = readDb();
    const list = (db.lists[k(key)] || []).filter((x) => x.id !== id);
    list.push({ id, score });
    db.lists[k(key)] = list; writeDb(db);
  },

  async indexRange(key, limit = 500) {
    needRedis();
    if (useRedis) return redis(["ZREVRANGE", k(key), 0, limit - 1]);
    const list = readDb().lists[k(key)] || [];
    return list.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.id);
  },

  // Ids with score between min and max (inclusive), lowest score first.
  async indexRangeByScore(key, min, max) {
    needRedis();
    if (useRedis) return redis(["ZRANGEBYSCORE", k(key), min, max]);
    const list = readDb().lists[k(key)] || [];
    return list.filter((x) => x.score >= min && x.score <= max).sort((a, b) => a.score - b.score).map((x) => x.id);
  },

  async indexRemove(key, id) {
    needRedis();
    if (useRedis) return redis(["ZREM", k(key), id]);
    const db = readDb();
    db.lists[k(key)] = (db.lists[k(key)] || []).filter((x) => x.id !== id); writeDb(db);
  },

  async del(key) {
    needRedis();
    if (useRedis) return redis(["DEL", k(key)]);
    const db = readDb(); delete db.kv[k(key)]; writeDb(db);
  },

  // Short-lived lock so two clients can't grab the same slot at the same moment. Returns true if acquired.
  async lock(key, ms = 10000) {
    needRedis();
    if (useRedis) return (await redis(["SET", k(`lock:${key}`), "1", "NX", "PX", ms])) === "OK";
    const db = readDb(); const full = k(`lock:${key}`); const now = Date.now();
    if (db.ttl[full] && db.ttl[full] > now) return false;
    db.ttl[full] = now + ms; writeDb(db); return true;
  },
  async unlock(key) {
    needRedis();
    if (useRedis) return redis(["DEL", k(`lock:${key}`)]);
    const db = readDb(); delete db.ttl[k(`lock:${key}`)]; writeDb(db);
  },

  // Fixed-window counter for rate limiting. Returns the count after incrementing.
  async hit(key, windowSec) {
    needRedis();
    if (useRedis) {
      const n = await redis(["INCR", k(key)]);
      if (n === 1) await redis(["EXPIRE", k(key), windowSec]);
      return n;
    }
    const db = readDb();
    const now = Date.now();
    const full = k(key);
    if (!db.ttl[full] || db.ttl[full] < now) { db.kv[full] = 0; db.ttl[full] = now + windowSec * 1000; }
    db.kv[full] = (db.kv[full] || 0) + 1;
    writeDb(db);
    return db.kv[full];
  },
};
}

module.exports = make(shopPrefix);
module.exports.global = make(() => "beambook:");
