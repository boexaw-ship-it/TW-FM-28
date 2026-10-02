// ============================================
// TW FM Core Database Service (Firestore Wrapper)
// Features:
//  1) Stable Key Generation (Document, Collection, Complex Queries)
//  2) In-memory TTL Caching with Auto Error Eviction
//  3) Auto Scope Tracking via scope.js
//  4) Smart Hierarchy Cache Invalidation on Mutations
//  5) Force Refresh (*FromServer) Support
// ============================================

import * as F from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { track } from "./scope.js";

// Official SDK exports အားလုံးကို drop-in အဖြစ် ပြန်ထုတ်ပေးခြင်း
export * from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const MIN = 60 * 1000;

// Path Patterns အလိုက် Cache TTL သတ်မှတ်ချက်များ
const RULES = [
  [/^fixtures(\/.*)?$/, 10 * MIN],
  [/^fixturesMeta(\/.*)?$/, 10 * MIN],
  [/^leagues\/[^/]+$/, 5 * MIN],
  [/^scoutPlayers(\/.*)?$/, 30 * MIN],
  [/^users$/, 10 * MIN],
  [/^users\/[^/]+$/, 5 * MIN],
  [/^livePoints(\/.*)?$/, 2 * MIN],
  [/^twf_weekly(\/.*)?$/, 5 * MIN],
  [/^twf_supercup(\/.*)?$/, 5 * MIN],
  [/^tournamentRegistrations(\/.*)?$/, 3 * MIN],
  [/^twf_tournaments_meta\/[^/]+$/, 5 * MIN],
  [/^leagues\/[^/]+\/standings$/, 10 * MIN]
];

function ttlFor(path) {
  if (!path) return 0;
  for (const [pattern, ms] of RULES) {
    if (pattern.test(path)) return ms;
  }
  return 0;
}

// In-Memory Storage: key -> { t: timestamp, p: Promise }
const mem = new Map();

/**
 * Public SDK APIs များကိုသာ အခြေခံ၍ Unique Cache Key ထုတ်ယူခြင်း (Fail-safe)
 */
function keyOf(target) {
  try {
    if (!target) return null;

    // DocumentReference သို့မဟုတ် CollectionReference ဖြစ်ပါက
    if (target.path) {
      return target.path;
    }

    // Query Instance ဖြစ်ပါက (Internal properties မသုံးဘဲ Safe String တည်ဆောက်ခြင်း)
    if (target.type === "query" || target._query) {
      const basePath = target._query?.path?.canonicalString?.() || target.path || "";
      return basePath ? `query:${basePath}` : null;
    }
  } catch (_) {
    // Fail-safe: Parser error တက်ပါက cache မလုပ်ဘဲ Network တိုက်ရိုက်သွားမည်
  }
  return null;
}

/**
 * Cache စစ်ဆေးပြီး Data ဆွဲယူပေးသော Core Function
 */
function cached(target, fetcher, force = false) {
  const cacheKey = keyOf(target);
  const ttl = ttlFor(cacheKey);

  // TTL မရှိလျှင်သော်လည်းကောင်း၊ Cache Key မထုတ်နိုင်လျှင်သော်လည်းကောင်း တိုက်ရိုက် fetch လုပ်မည်
  if (!ttl || !cacheKey) {
    return fetcher();
  }

  const hit = mem.get(cacheKey);
  const now = Date.now();

  // Force refresh မဟုတ်ဘဲ သက်တမ်း (TTL) မကုန်သေးပါက Cache Promise ကို ပြန်ပေးမည်
  if (!force && hit && (now - hit.t < ttl)) {
    return hit.p;
  }

  // Network မှ အသစ် Fetch လုပ်ခြင်း
  const promise = fetcher();
  const entry = { t: now, p: promise };
  mem.set(cacheKey, entry);

  // Network request ပျက်စီးသွားပါက Cache ထဲမှ ချက်ချင်း ရှင်းလင်းပေးခြင်း (Anti-poisoning)
  promise.catch(() => {
    if (mem.get(cacheKey) === entry) {
      mem.delete(cacheKey);
    }
  });

  return promise;
}

// ============================================
// Read Operations
// ============================================
export const getDoc = (ref) => cached(ref, () => F.getDoc(ref), false);
export const getDocs = (q) => cached(q, () => F.getDocs(q), false);
export const getDocFromServer = (ref) => cached(ref, () => F.getDocFromServer(ref), true);
export const getDocsFromServer = (q) => cached(q, () => F.getDocsFromServer(q), true);

/**
 * Realtime Listener အား Scope Manager ဖြင့် ချိတ်ဆက်ခြင်း
 * (Page ကူးပြောင်းချိန်တွင် Memory Leak မဖြစ်စေရန် အလိုအလျောက် Unsubscribe လုပ်ပေးသည်)
 */
export function onSnapshot(...args) {
  const unsubscribe = F.onSnapshot(...args);
  return typeof track === "function" ? track(unsubscribe) : unsubscribe;
}

/**
 * Data အသစ်သွင်းခြင်း/ပြင်ခြင်း/ဖျက်ခြင်း ပြုလုပ်ချိန်တွင် Cache ရှင်းထုတ်ခြင်း
 */
function invalidate(refOrCol) {
  try {
    if (!refOrCol) return;
    const path = refOrCol.path;
    if (path) {
      mem.delete(path);
      mem.delete(`query:${path}`);

      // Parent Collection Cache ပါ ဖျက်ပေးခြင်း
      const parent = refOrCol.parent?.path;
      if (parent) {
        mem.delete(parent);
        mem.delete(`query:${parent}`);
      }
    }
  } catch (_) {}
}

// ============================================
// Write Operations (Auto-Invalidation)
// ============================================
export const setDoc = (ref, ...args) => 
  F.setDoc(ref, ...args).then((val) => {
    invalidate(ref);
    return val;
  });

export const updateDoc = (ref, ...args) => 
  F.updateDoc(ref, ...args).then((val) => {
    invalidate(ref);
    return val;
  });

export const deleteDoc = (ref) => 
  F.deleteDoc(ref).then((val) => {
    invalidate(ref);
    return val;
  });

export const addDoc = (col, data) => 
  F.addDoc(col, data).then((docRef) => {
    invalidate(col);
    return docRef;
  });

/**
 * In-memory Cache တစ်ခုလုံးကို ရှင်းလင်းပေးသော Utility
 */
export function clearReadCache() {
  mem.clear();
}
