// ============================================
// Live squad loader (quota-safe)
//   getLiveSquadWithQuota(fplId, force) -> { squad, points }
//   squad  = liveTeams/{fplId}   (picks, bank, freeTransfers, gameweek ...)
//   points = livePoints/{fplId}  (gwPoints, totalPoints, overallRank ...)
// Cache: localStorage (twf_shared_*_v2_<id>) — team / live / transfers / home page တွေ မျှဝေသုံး
//   normal load : 3 မိနစ်အတွင်း cache ရှိရင် Firestore 0 read
//   force refresh: 20 စက္ကန့်အတွင်း ထပ်နှိပ်ရင် cache ပြန်ပေး (spam ကာကွယ်)
// ============================================
import { db } from "./firebase-config.js";
import { doc, getDoc, getDocFromServer } from "./core/fs.js";

const FRESH_MS = 3 * 60 * 1000;
const COOLDOWN_MS = 20 * 1000;

const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

export async function getLiveSquadWithQuota(fplId, force = false) {
  if (!fplId) return null;
  const id = String(fplId);
  const kSquad = `twf_shared_squad_v2_${id}`;
  const kPts = `twf_shared_points_v2_${id}`;
  const kTime = `twf_live_quota_t_${id}`;

  const cachedSquad = read(kSquad), cachedPts = read(kPts);
  const age = Date.now() - Number(localStorage.getItem(kTime) || 0);
  const haveCache = !!(cachedSquad || cachedPts);

  if (haveCache && ((!force && age < FRESH_MS) || (force && age < COOLDOWN_MS))) {
    return { squad: cachedSquad, points: cachedPts, fromCache: true };
  }
  if (!navigator.onLine) return haveCache ? { squad: cachedSquad, points: cachedPts, fromCache: true } : null;

  try {
    const getter = force ? getDocFromServer : getDoc;
    const [sSnap, pSnap] = await Promise.all([
      getter(doc(db, "liveTeams", id)),
      getter(doc(db, "livePoints", id)),
    ]);
    const squad = sSnap.exists() ? sSnap.data() : cachedSquad;
    const points = pSnap.exists() ? pSnap.data() : cachedPts;
    if (squad) write(kSquad, squad);
    if (points) write(kPts, points);
    try { localStorage.setItem(kTime, String(Date.now())); } catch (_) {}
    return { squad, points, fromCache: false };
  } catch (e) {
    console.warn("liveteamquota fetch failed:", e);
    return haveCache ? { squad: cachedSquad, points: cachedPts, fromCache: true } : null;
  }
}
