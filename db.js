// Tiny key-value store on IndexedDB. Keys: "settings", "plan", "d-YYYY-MM-DD".
const DB_NAME = "fitlog";
const STORE = "kv";

let dbPromise = null;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const store = {
  async get(key) {
    const v = await tx("readonly", (s) => s.get(key));
    return v ?? null;
  },
  set(key, value) {
    return tx("readwrite", (s) => { s.put(value, key); });
  },
  del(key) {
    return tx("readwrite", (s) => { s.delete(key); });
  },
  async all() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const out = {};
      const req = db.transaction(STORE).objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) { out[c.key] = c.value; c.continue(); } else resolve(out);
      };
      req.onerror = () => reject(req.error);
    });
  },
  async days() {
    const all = await this.all();
    return Object.keys(all).filter((k) => k.startsWith("d-")).map((k) => all[k]);
  },
  async replaceAll(entries) {
    return tx("readwrite", (s) => {
      s.clear();
      for (const [k, v] of Object.entries(entries)) s.put(v, k);
    });
  },
};

// Ask the browser not to evict our data under storage pressure.
export async function persist() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; }
  catch { return false; }
}
