// ============================================
// Diff-Sync helper: Firestore write/read quota saver
// - doc တစ်ခုချင်းစီရဲ့ hash ကို system_meta/hash_<key> doc တစ်ခုထဲမှာ သိမ်းထားပြီး
//   data မပြောင်းတဲ့ doc တွေကို ပြန်မရေးတော့ပါ (writes သက်သာ)
// - Stale/sold doc ရှာဖို့ collection တစ်ခုလုံး ပြန်မဖတ်တော့ဘဲ hash doc (read 1 ခု) နဲ့ရှာပါတယ်
// - FORCE_FULL=1 ထည့်ရင် hash ကို မသုံးဘဲ အကုန်ပြန်ရေးပါမယ်
// ============================================
const crypto = require("crypto");

function stable(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
}
const hashOf = (v) => crypto.createHash("md5").update(stable(v)).digest("hex").slice(0, 12);

class DiffWriter {
  constructor(db, key) {
    this.db = db;
    this.ref = db.collection("system_meta").doc("hash_" + key);
    this.old = {};
    this.next = {};
    this.seen = new Set();
    this.stats = { written: 0, skipped: 0, pruned: 0 };
    this.isEmpty = true;
  }
  async load() {
    if (process.env.FORCE_FULL === "1") return this;
    const s = await this.ref.get();
    this.old = (s.exists && s.data().h) || {};
    this.next = { ...this.old };
    this.isEmpty = Object.keys(this.old).length === 0;
    return this;
  }
  // true = data အသစ်/ပြောင်းသွား၊ ရေးရမယ်
  changed(id, data) {
    id = String(id);
    this.seen.add(id);
    const h = hashOf(data);
    if (this.old[id] === h) { this.stats.skipped++; return false; }
    this.next[id] = h;
    this.stats.written++;
    return true;
  }
  staleIds() { return Object.keys(this.old).filter((id) => !this.seen.has(id)); }
  async save({ prune = false } = {}) {
    if (prune) for (const id of this.staleIds()) { delete this.next[id]; this.stats.pruned++; }
    if (this.stats.written === 0 && this.stats.pruned === 0 && !this.isEmpty) {
      console.log(`[diff:${this.ref.id}] no changes (skipped ${this.stats.skipped})`);
      return;
    }
    await this.ref.set({ h: this.next, updatedAtMs: Date.now() });
    console.log(`[diff:${this.ref.id}] written ${this.stats.written}, skipped ${this.stats.skipped}, pruned ${this.stats.pruned}`);
  }
}
module.exports = { DiffWriter, hashOf };
