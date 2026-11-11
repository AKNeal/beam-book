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

// Several commands in one round trip (Upstash REST /pipeline). Returns each command's result.
async function pipeline(cmds) {
  if (!cmds.length) return [];
  const out = [];
  for (let i = 0; i < cmds.length; i += 500) { // keep each call a sensible size
    const r = await fetch(`${URL_.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmds.slice(i, i + 500)),
    });
    const data = await r.json();
    if (!Array.isArray(data)) throw new Error(`Redis: ${data.error || "pipeline failed"}`);
    for (const x of data) { if (x.error) throw new Error(`Redis: ${x.error}`); out.push(x.result); }
  }
  return out;
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

  // Many records at once (one round trip). Missing ones come back as null.
  async getMany(keys) {
    needRedis();
    if (!keys.length) return [];
    if (useRedis) {
      const out = [];
      for (let i = 0; i < keys.length; i += 500) {
        const vals = await redis(["MGET", ...keys.slice(i, i + 500).map(k)]);
        for (const v of vals) out.push(v ? JSON.parse(v) : null);
      }
      return out;
    }
    const kv = readDb().kv;
    return keys.map((x) => (kv[k(x)] === undefined ? null : kv[k(x)]));
  },

  // Several writes in one round trip: [{set:[key,value]}, {del:key}, {zadd:[key,id,score]}, {zrem:[key,id]}, {lexAdd:[key,member]}, {lexRem:[key,member]}]
  async batch(ops) {
    needRedis();
    if (!ops.length) return;
    if (useRedis) {
      return pipeline(ops.map((o) => o.set ? ["SET", k(o.set[0]), JSON.stringify(o.set[1])]
        : o.del ? ["DEL", k(o.del)]
        : o.zadd ? ["ZADD", k(o.zadd[0]), o.zadd[2], o.zadd[1]]
        : o.zrem ? ["ZREM", k(o.zrem[0]), o.zrem[1]]
        : o.lexAdd ? ["ZADD", k(o.lexAdd[0]), 0, o.lexAdd[1]]
        : ["ZREM", k(o.lexRem[0]), o.lexRem[1]]));
    }
    const db = readDb();
    for (const o of ops) {
      if (o.set) db.kv[k(o.set[0])] = o.set[1];
      else if (o.del) delete db.kv[k(o.del)];
      else {
        const [key, id, score] = o.zadd || o.zrem || o.lexAdd || o.lexRem;
        const list = (db.lists[k(key)] || []).filter((x) => x.id !== id);
        if (o.zadd) list.push({ id, score }); else if (o.lexAdd) list.push({ id, score: 0 });
        db.lists[k(key)] = list;
      }
    }
    writeDb(db);
  },

  // Members of a word index that start with `prefix` (alphabetical), up to `limit`.
  async lexPrefix(key, prefix, limit = 50) {
    needRedis();
    if (useRedis) return redis(["ZRANGEBYLEX", k(key), `[${prefix}`, `[${prefix}\xff`, "LIMIT", 0, limit]);
    return (readDb().lists[k(key)] || []).map((x) => x.id).filter((m) => m.startsWith(prefix)).sort().slice(0, limit);
  },

  // Newest-first ids with score below `before` (for "Load older").
  async indexBefore(key, before, limit = 100) {
    needRedis();
    if (useRedis) return redis(["ZREVRANGEBYSCORE", k(key), `(${before}`, "-inf", "LIMIT", 0, limit]);
    const list = readDb().lists[k(key)] || [];
    return list.filter((x) => x.score < before).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.id);
  },

  async indexCount(key) {
    needRedis();
    if (useRedis) return redis(["ZCARD", k(key)]);
    return (readDb().lists[k(key)] || []).length;
  },

  async indexScore(key, id) {
    needRedis();
    if (useRedis) { const v = await redis(["ZSCORE", k(key), id]); return v == null ? null : Number(v); }
    const x = (readDb().lists[k(key)] || []).find((y) => y.id === id); return x ? x.score : null;
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
