// ============================================
import { getFixturesSnap, getScoutSnap, getLeagueStandingsSnap, onLeagueTeam } from "./core/data.js";
// TW Fantasy — Transfer Pricing & Cache Engine
// ============================================

export let priceDisplayMode = 'current'; // 'current' | 'selling'
let firebaseFixturesCache = null;
let allScoutPlayers = [];

// 💡 FPL Official Selling Price Rule:
// ကစားသမားတစ်ဦးသည် ဝယ်ဈေးထက် တက်ပါက အမြတ်၏ 50% သာ ရောင်းဈေးရမည် (0.2 တက်မှ 0.1 ရ)
export function calculateSellingPrice(purchasePrice, currentPrice) {
  const pPrice = parseFloat(purchasePrice || currentPrice || 0.0);
  const cPrice = parseFloat(currentPrice || pPrice || 0.0);
  if (cPrice <= pPrice) return cPrice;
  const profit = cPrice - pPrice;
  const sellGain = Math.floor((profit * 10) / 2) / 10;
  return parseFloat((pPrice + sellGain).toFixed(1));
}

// 🛡️ Firestore Cache Engine (၁ နာရီ TTL)
export async function getCachedFixturesAndScout(db, collection, getDocs, formatTeamShort) {
  const CACHE_TTL = 60 * 60 * 1000;
  const now = Date.now();

  const cachedFix = localStorage.getItem("tw_fixtures_cache");
  const fixTime = localStorage.getItem("tw_fixtures_time");
  if (cachedFix && fixTime && (now - Number(fixTime) < CACHE_TTL)) {
    try { firebaseFixturesCache = JSON.parse(cachedFix); } catch (_) { firebaseFixturesCache = null; }
  }
  if (!firebaseFixturesCache) {
    try {
      const snap = await getFixturesSnap();
      firebaseFixturesCache = [];
      snap.forEach(d => firebaseFixturesCache.push({ id: d.id, ...d.data() }));
      localStorage.setItem("tw_fixtures_cache", JSON.stringify(firebaseFixturesCache));
      localStorage.setItem("tw_fixtures_time", String(now));
    } catch (e) { console.warn("Fixtures bypass:", e); }
  }

  const cachedScout = localStorage.getItem("tw_scout_cache");
  const scoutTime = localStorage.getItem("tw_scout_time");
  if (cachedScout && scoutTime && (now - Number(scoutTime) < CACHE_TTL)) {
    try { allScoutPlayers = JSON.parse(cachedScout); } catch (_) { allScoutPlayers = []; }
  }
  if (!allScoutPlayers || allScoutPlayers.length === 0) {
    try {
      const snap = await getScoutSnap();
      allScoutPlayers = [];
      snap.forEach(d => {
        const data = d.data();
        const rawPos = String(data.position || "DEF").toUpperCase().trim();
        const parsedCurrentPrice = parseFloat(data.now_cost ? data.now_cost / 10 : (data.currentPrice || data.price || 0.0));
        allScoutPlayers.push({
          id: String(d.id),
          playerId: String(data.playerId || d.id),
          ...data,
          currentPrice: parsedCurrentPrice,
          price: parsedCurrentPrice,
          position: rawPos,
          team: data.team || "—",
          clubCode: formatTeamShort ? formatTeamShort(data.team || data.teamCode) : (data.team || "—")
        });
      });
      localStorage.setItem("tw_scout_cache", JSON.stringify(allScoutPlayers));
      localStorage.setItem("tw_scout_time", String(now));
    } catch (e) { console.warn("Scout bypass:", e); }
  }

  return { fixtures: firebaseFixturesCache || [], scoutPlayers: allScoutPlayers };
}

export function togglePriceMode(onModeChangedCallback) {
  priceDisplayMode = priceDisplayMode === 'current' ? 'selling' : 'current';
  
  const toggleBtn = document.getElementById("btn-toggle-price-mode");
  if (toggleBtn) {
    if (priceDisplayMode === 'current') {
      toggleBtn.className = "text-[9px] font-black px-2.5 py-0.5 rounded-lg border border-sky-400 bg-sky-950 text-sky-300 active:scale-95 transition-all shadow-md flex items-center gap-1 cursor-pointer";
      toggleBtn.innerHTML = `💱 CP (Current)`;
    } else {
      toggleBtn.className = "text-[9px] font-black px-2.5 py-0.5 rounded-lg border border-amber-400 bg-amber-950 text-amber-300 active:scale-95 transition-all shadow-md flex items-center gap-1 cursor-pointer";
      toggleBtn.innerHTML = `💰 SP (Selling)`;
    }
  }

  if (typeof onModeChangedCallback === "function") {
    onModeChangedCallback(priceDisplayMode);
  }
}
