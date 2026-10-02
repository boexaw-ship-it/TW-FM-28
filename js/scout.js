import { auth, db } from "../js/firebase-config.js";
import { getFixturesSnap, getScoutSnap, getLeagueStandingsSnap, onLeagueTeam } from "./core/data.js";
import { onAuthStateChanged } from "./core/auth.js";
import { 
  doc, getDoc, collection, getDocs, 
  getDocsFromServer 
} from "./core/fs.js";

let allPlayers = [];
let firebaseFixturesCache = null;
let currentFilter = "all";
let currentTeamFilter = "all";
let currentSort = null;

const SCOUT_CACHE_KEY = "twf_scout_players_cache_v3";
const SCOUT_CACHE_TIME_KEY = "twf_scout_players_cache_time_v3";
const FIXTURES_CACHE_KEY = "twf_fixtures_cache";
const FIXTURES_CACHE_TIME_KEY = "twf_fixtures_cache_time";

const SCOUT_TIME_KEY = "twf_shared_players_quota_time_v2";
const CACHE_DURATION = 24 * 60 * 60 * 1000;

const TEAM_SHORT_CODES = {
  "arsenal": "ARS", "aston villa": "AVL", "bournemouth": "BOU", "brentford": "BRE",
  "brighton": "BHA", "brighton & hove albion": "BHA", "chelsea": "CHE", "coventry": "COV", 
  "coventry city": "COV", "crystal palace": "CRY", "everton": "EVE", "fulham": "FUL", 
  "hull": "HUL", "hull city": "HUL", "ipswich": "IPS", "ipswich town": "IPS", 
  "leeds": "LEE", "leeds united": "LEE", "liverpool": "LIV", "man city": "MCI", 
  "manchester city": "MCI", "man utd": "MUN", "manchester united": "MUN", "newcastle": "NEW", 
  "newcastle united": "NEW", "nottingham forest": "NFO", "nott'm forest": "NFO", 
  "tottenham": "TOT", "spurs": "TOT", "sunderland": "SUN"
};

const TEAM_ID_MAP = {
  1: "ARS", 2: "AVL", 3: "BOU", 4: "BRE", 5: "BHA",
  6: "CHE", 7: "COV", 8: "CRY", 9: "EVE", 10: "FUL",
  11: "HUL", 12: "IPS", 13: "LEE", 14: "LIV", 15: "MCI",
  16: "MUN", 17: "NEW", 18: "NFO", 19: "TOT", 20: "SUN"
};

const TEAM_DIFFICULTY_TIER = {
  "MCI": 5, "ARS": 5, "LIV": 5,
  "CHE": 4, "NEW": 4, "TOT": 4, "MUN": 4, "AVL": 4,
  "BHA": 3, "FUL": 3, "BOU": 3, "BRE": 3, "CRY": 3, "EVE": 3, "NFO": 3,
  "IPS": 2, "LEE": 2, "SUN": 2, "HUL": 2, "COV": 2
};

// =========================================================================
// 🌟 OFFLINE FIRST ENGINE: Auth မစောင့်ဘဲ Local Cache ဖြင့် ချက်ချင်း Render ပြုလုပ်ခြင်း
// =========================================================================

function mountOfflineCacheImmediately() {
  try {
    const cachedFix = localStorage.getItem(FIXTURES_CACHE_KEY);
    if (cachedFix) {
      firebaseFixturesCache = JSON.parse(cachedFix);
    }
    const cachedPlayers = localStorage.getItem(SCOUT_CACHE_KEY);
    if (cachedPlayers) {
      allPlayers = JSON.parse(cachedPlayers);
      allPlayers.sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
      renderPlayers();
    }
  } catch (err) {
    console.warn("Immediate offline mount failed:", err);
  }
}

if (document.readyState === "loading") {
  queueMicrotask( () => {
    updateScoutGwBadge();
    mountOfflineCacheImmediately();
  });
} else {
  updateScoutGwBadge();
  mountOfflineCacheImmediately();
}

function updateScoutGwBadge() {
  const badge = document.getElementById("scout-gw-badge");
  if (!badge) return;

  const gw = localStorage.getItem("twf_current_gw") || 
             localStorage.getItem("twf_transfers_gw") || 
             "5";

  badge.textContent = "GW " + gw;
}

// =========================================================================
// ⏰ IN-FILE SCHEDULE QUOTA CONTROLLER
// =========================================================================

function getMyanmarDate(dateObj = new Date()) {
  const utc = dateObj.getTime() + (dateObj.getTimezoneOffset() * 60000);
  return new Date(utc + (6.5 * 3600000));
}

function checkScoutSlotStatus() {
  const mmNow = getMyanmarDate(new Date());
  const day = mmNow.getDay();
  const currentH = mmNow.getHours();
  let savedTimeMs = localStorage.getItem(SCOUT_TIME_KEY);

  if (!savedTimeMs) {
    localStorage.setItem(SCOUT_TIME_KEY, String(Date.now()));
    savedTimeMs = String(Date.now());
  }

  const isMatchDayPeriod = (day === 0 || day === 6 || day === 1);

  if (isMatchDayPeriod) {
    const matchDaySlots = [0, 4, 8, 12, 16, 20];
    let baseH = 0;
    let nextH = 0;

    for (let i = matchDaySlots.length - 1; i >= 0; i--) {
      if (currentH >= matchDaySlots[i]) {
        baseH = matchDaySlots[i];
        nextH = (i === matchDaySlots.length - 1) ? 24 : matchDaySlots[i + 1];
        break;
      }
    }

    const currentWindowStartDate = new Date(mmNow);
    currentWindowStartDate.setHours(baseH, 0, 0, 0);

    const nextSlotDate = new Date(mmNow);
    if (nextH === 24) {
      nextSlotDate.setDate(nextSlotDate.getDate() + 1);
      nextSlotDate.setHours(0, 0, 0, 0);
    } else {
      nextSlotDate.setHours(nextH, 0, 0, 0);
    }

    const hours = nextSlotDate.getHours();
    const ampm = hours >= 12 ? "PM" : "AM";
    const displayH = hours % 12 || 12;
    const timeFormatted = `${String(displayH).padStart(2, '0')}:00 ${ampm}`;
    const dateFormatted = `${nextSlotDate.getDate()}/${nextSlotDate.getMonth() + 1}`;

    const lastSavedMm = getMyanmarDate(new Date(Number(savedTimeMs)));
    const isExpired = lastSavedMm.getTime() < currentWindowStartDate.getTime();

    return {
      isExpired,
      alertText: `⏳ TWFM PLAYER UPDATE ကို (${dateFormatted} ရက် ${timeFormatted}) တွင် ရရှိပါမည်ခင်ဗျာ!`
    };
  }

  const baseH = currentH >= 12 ? 12 : 0;
  const currentWindowStartDate = new Date(mmNow);
  currentWindowStartDate.setHours(baseH, 0, 0, 0);

  let nextSlotName = currentH < 12 ? "AFTERNOON (နေ့လယ် ၁၂:၀၀ နာရီ)" : "MIDNIGHT (ည ၁၂:၀၀ နာရီ)";

  const lastSavedMm = getMyanmarDate(new Date(Number(savedTimeMs)));
  const isExpired = lastSavedMm.getTime() < currentWindowStartDate.getTime();

  return {
    isExpired,
    alertText: `⏳ TWFM PLAYER UPDATE ကို ${nextSlotName} တွင် ရရှိပါမည်ခင်ဗျာ!`
  };
}

// 🔔 Custom Toast Alert
window.showScoutToast = function(msg, isError = false) {
  let toast = document.getElementById("scout-toast") || document.getElementById("tw-quota-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "scout-toast";
    toast.className = "fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-4 py-2.5 rounded-xl text-xs font-bold text-center transition-all duration-300 opacity-0 pointer-events-none shadow-2xl border max-w-[90%]";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.background = isError ? "linear-gradient(135deg, #7f1d1d, #450a0a)" : "linear-gradient(135deg, #1b1f3a, #14172b)";
  toast.style.color = isError ? "#fecaca" : "#b3a1ff";
  toast.style.borderColor = isError ? "#ef4444" : "#b3a1ff";
  toast.style.boxShadow = isError ? "0 8px 24px rgba(239, 68, 68, 0.7)" : "0 8px 20px rgba(179,161,255, 0.3)";
  
  toast.classList.remove("opacity-0");
  toast.classList.add("opacity-100");
  
  clearTimeout(window.scoutToastTimeout);
  window.scoutToastTimeout = setTimeout(() => {
    toast.classList.remove("opacity-100");
    toast.classList.add("opacity-0");
  }, 3200);
};

function triggerInitialFakeRefreshUI() {
  const btn = document.getElementById("btn-refresh-scout") || document.querySelector("button[onclick*='forceRefreshScout']");
  const icon = document.getElementById("refresh-scout-icon") || (btn ? btn.querySelector("span") : null);

  if (icon) icon.classList.add("inline-block", "animate-spin");
  if (btn) {
    btn.style.setProperty("background-color", "#8c6dff", "important");
    btn.style.setProperty("color", "#14172b", "important");
    btn.style.setProperty("border-color", "#b3a1ff", "important");
  }

  setTimeout(() => {
    if (icon) icon.classList.remove("inline-block", "animate-spin");
    if (btn) {
      btn.style.removeProperty("background-color");
      btn.style.removeProperty("color");
      btn.style.removeProperty("border-color");
    }
  }, 1200);
}

// =========================================================================
// 🔄 REFRESH BUTTON (Early-Return & 0 Read Guard)
// =========================================================================

window.forceRefreshScout = async function() {
  if (!navigator.onLine) {
    mountOfflineCacheImmediately();
    window.showScoutToast("⚠️ အော့ဖ်လိုင်းမုဒ်: အင်တာနက်မရှိသေးပါခင်ဗျာ!", true);
    return;
  }

  const btn = document.getElementById("btn-refresh-scout") || document.querySelector("button[onclick*='forceRefreshScout']");
  const icon = document.getElementById("refresh-scout-icon") || (btn ? btn.querySelector("span") : null);

  const slotStatus = checkScoutSlotStatus();

  if (!slotStatus.isExpired) {
    window.showScoutToast(slotStatus.alertText, false);
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.style.setProperty("background-color", "#8c6dff", "important");
    btn.style.setProperty("color", "#14172b", "important");
    btn.style.setProperty("border-color", "#b3a1ff", "important");
    btn.style.setProperty("box-shadow", "0 0 12px rgba(140,109,255, 0.8)", "important");
  }
  if (icon) icon.classList.add("inline-block", "animate-spin");

  window.showScoutToast("🔄 TW FM UPDATE...", false);

  try {
    const isSuccess = await loadPlayersAndFixtures(true);

    if (isSuccess) {
      localStorage.setItem(SCOUT_TIME_KEY, String(Date.now()));
      window.showScoutToast("✅ Scout Update ရရှိပါပြီ!");
    } else {
      throw new Error("SCOUT_FETCH_FAILED");
    }

  } catch (err) {
    console.error("Scout Refresh Error:", err);
    mountOfflineCacheImmediately();
    window.showScoutToast("⚠️ ဒေတာဟောင်းများကို ပြသပေးထားပါသည်ခင်ဗျာ!", false);
  } finally {
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.style.removeProperty("background-color");
        btn.style.removeProperty("color");
        btn.style.removeProperty("border-color");
        btn.style.removeProperty("box-shadow");
      }
      if (icon) icon.classList.remove("inline-block", "animate-spin");
    }, 400);
  }
};

// =========================================================================
// ⚽ DATA LOGIC & UI
// =========================================================================

function calculateDynamicFdr(opponentCode, isHome) {
  const baseTier = TEAM_DIFFICULTY_TIER[opponentCode] || 3;
  return isHome ? Math.max(2, baseTier - 1) : Math.min(5, baseTier);
}

function formatTeamShort(raw) {
  if (!raw) return "";
  const clean = String(raw).trim().toLowerCase();
  return TEAM_SHORT_CODES[clean] || (raw.length > 4 ? raw.slice(0, 3).toUpperCase() : raw.toUpperCase());
}

function fdrColor(fdr) {
  const colors = { 1: "#22c55e", 2: "#22c55e", 3: "#eab308", 4: "#f97316", 5: "#ef4444" };
  return colors[fdr] || "#22c55e";
}

function getScoutStatusBadge(p) {
  const status = String(p.status || "a").toLowerCase();
  const chance = p.chanceOfPlaying !== undefined && p.chanceOfPlaying !== null ? Number(p.chanceOfPlaying) : 100;
  const isSuspended = p.isSuspended || status === "s";
  const isInjured = p.isInjured || status === "i";

  if (isSuspended) {
    return `<span class="text-[8px] font-black px-1.5 py-0.5 rounded bg-red-600 text-white shadow-xs border border-red-400 shrink-0">SUSP</span>`;
  }
  if (isInjured || chance === 0) {
    return `<span class="text-[8px] font-black px-1.5 py-0.5 rounded bg-red-600 text-white shadow-xs border border-red-400 shrink-0">INJ</span>`;
  }
  if (chance > 0 && chance < 100) {
    return `<span class="text-[8px] font-black px-1.5 py-0.5 rounded bg-yellow-400 text-black shadow-xs border border-yellow-600 shrink-0">${chance}%</span>`;
  }
  return "";
}

function getSeasonPriceChangeMarking(player) {
  const changeRaw = Number(player.costChangeStart ?? player.cost_change_start ?? 0);
  if (changeRaw > 0) {
    return `<span style="color: #16a34a !important; font-size: 13px; font-weight: 900; margin-left: 4px; display: inline-block;">▲</span>`;
  } else if (changeRaw < 0) {
    return `<span style="color: #dc2626 !important; font-size: 13px; font-weight: 900; margin-left: 4px; display: inline-block;">▼</span>`;
  }
  return "";
}

// 🛡️ OFFLINE-BYPASS AUTH CONTROLLER
onAuthStateChanged(auth, async (user) => {
  triggerInitialFakeRefreshUI();

  if (!user) {
    // အော့ဖ်လိုင်းဖြစ်နေပါက index သို့ redirect မလုပ်ဘဲ cache ဖြင့် ဆက်လက်ပြသမည်
    if (!navigator.onLine || localStorage.getItem(SCOUT_CACHE_KEY)) {
      mountOfflineCacheImmediately();
      return;
    }
    window.go("login");
    return;
  }

  // အွန်လိုင်းရှိမှသာ Firebase စစ်ဆေးမည်
  if (navigator.onLine) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) {
        window.go("login");
        return;
      }
      loadPlayersAndFixtures(false);
    } catch (e) {
      console.warn("Auth check network error, using offline view:", e);
      mountOfflineCacheImmediately();
    }
  } else {
    mountOfflineCacheImmediately();
  }
});

async function loadPlayersAndFixtures(forceFresh = false) {
  const now = Date.now();

  // ၁။ FIXTURES CACHE
  const cachedFix = localStorage.getItem(FIXTURES_CACHE_KEY);
  if (cachedFix) {
    try { firebaseFixturesCache = JSON.parse(cachedFix); } catch (_) {}
  }

  if (navigator.onLine && (!firebaseFixturesCache || forceFresh)) {
    try {
      const fSnap = forceFresh
        ? await getFixturesSnap(true)
        : await getFixturesSnap();

      firebaseFixturesCache = [];
      fSnap.forEach(d => firebaseFixturesCache.push({ id: d.id, ...d.data() }));
      localStorage.setItem(FIXTURES_CACHE_KEY, JSON.stringify(firebaseFixturesCache));
      localStorage.setItem(FIXTURES_CACHE_TIME_KEY, String(now));
    } catch (e) {
      console.warn("Fixtures fetch error:", e);
    }
  }

  // ၂။ SCOUT PLAYERS CACHE
  const cachedData = localStorage.getItem(SCOUT_CACHE_KEY);
  const cachedTime = localStorage.getItem(SCOUT_CACHE_TIME_KEY);

  if (!forceFresh && cachedData && cachedTime && (now - Number(cachedTime) < CACHE_DURATION)) {
    try {
      allPlayers = JSON.parse(cachedData);
      allPlayers.sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
      renderPlayers();
      return true;
    } catch (_) {}
  }

  // အော့ဖ်လိုင်းဖြစ်နေပါက Cache ရှိသမျှဖြင့် ရပ်တန့်မည်
  if (!navigator.onLine) {
    mountOfflineCacheImmediately();
    return true;
  }

  // ၃။ FIREBASE NETWORK LOAD
  try {
    const snap = forceFresh
      ? await getScoutSnap(true)
      : await getScoutSnap();

    allPlayers = [];
    snap.forEach(d => {
      const data = d.data();
      allPlayers.push({
        ...data,
        playerId: String(data.playerId !== undefined ? data.playerId : d.id),
        price: parseFloat(data.price) || 0,
        costChangeStart: Number(data.costChangeStart ?? data.cost_change_start ?? 0),
        ownership: parseFloat(String(data.ownership).replace(/[^\d.-]/g, '')) || 0,
        totalPoints: parseInt(data.totalPoints) || 0,
        form: parseFloat(data.form) || 0,
        gwPoints: parseInt(data.gwPoints) || 0,
        ppg: parseFloat(data.ppg || 0),
        val: parseFloat(data.val || 0),
        l5: parseFloat(data.l5 || 0),
        xgi: parseFloat(data.xgi || 0),
        ict: parseFloat(data.ict || 0),
        status: data.status || "a",
        chanceOfPlaying: data.chanceOfPlaying !== undefined ? data.chanceOfPlaying : 100,
        chanceOfPlayingThisRound: data.chanceOfPlayingThisRound !== undefined ? data.chanceOfPlayingThisRound : null,
        isAvailable: data.isAvailable !== undefined ? data.isAvailable : true,
        isDoubtful: data.isDoubtful || false,
        isSuspended: data.isSuspended || data.status === "s",
        isInjured: data.isInjured || data.status === "i",
        news: data.news || ""
      });
    });

    allPlayers.sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));

    localStorage.setItem(SCOUT_CACHE_KEY, JSON.stringify(allPlayers));
    localStorage.setItem(SCOUT_CACHE_TIME_KEY, String(now));

    renderPlayers();
    return true;
  } catch (err) {
    console.warn("Network fetch failed, mounting offline cache:", err);
    mountOfflineCacheImmediately();
    return false;
  }
}

function getFirebaseMatchesForTeam(teamCode, targetGw) {
  if (!firebaseFixturesCache || !teamCode) return [];
  const cleanCode = String(teamCode).trim().toUpperCase();
  const teamId = Object.keys(TEAM_ID_MAP).find(k => TEAM_ID_MAP[k] === cleanCode);
  if (!teamId) return [];

  const tIdNum = Number(teamId);
  const matches = firebaseFixturesCache.filter(f => 
    Number(f.event) === Number(targetGw) && (Number(f.team_h) === tIdNum || Number(f.team_a) === tIdNum)
  );

  return matches.map(match => {
    const isHome = Number(match.team_h) === tIdNum;
    const oppId = isHome ? match.team_a : match.team_h;
    const oppCode = TEAM_ID_MAP[oppId] || "TBD";
    const fdr = isHome 
      ? (match.team_h_difficulty || calculateDynamicFdr(oppCode, true)) 
      : (match.team_a_difficulty || calculateDynamicFdr(oppCode, false));

    return {
      gw: targetGw,
      opponent: oppCode,
      isHome: isHome,
      fdr: Number(fdr) || 3
    };
  });
}

function getPositionBadgeColor(position) {
  const pos = String(position).toUpperCase();
  if (pos === 'GK') return '#1d4ed8'; 
  if (pos === 'DEF') return '#dc2626'; 
  if (pos === 'MID') return '#eab308'; 
  if (pos === 'FWD') return '#16a34a'; 
  return '#37003c';
}

function getCardLeftBorder(position) {
  const pos = String(position).toUpperCase();
  if (pos === 'GK') return '6px solid #1d4ed8';
  if (pos === 'DEF') return '6px solid #dc2626';
  if (pos === 'MID') return '6px solid #eab308';
  if (pos === 'FWD') return '6px solid #16a34a';
  return '1px solid #E2E8F0';
}

function getFiltered() {
  let players = currentFilter === "all" 
    ? allPlayers 
    : allPlayers.filter(p => String(p.position).toLowerCase() === currentFilter);

  if (currentTeamFilter !== "all") {
    players = players.filter(p => formatTeamShort(p.team) === currentTeamFilter);
  }

  if (currentSort) {
    players = [...players].sort((a, b) => {
      if (currentSort === "price") return b.price - a.price;
      if (currentSort === "ownership") return b.ownership - a.ownership;
      if (currentSort === "points") return b.totalPoints - a.totalPoints;
      if (currentSort === "form") return b.form - a.form;
      if (currentSort === "gwPoints") return b.gwPoints - a.gwPoints;
      return 0;
    });
  }
  return players;
}

function renderPlayers() {
  const players = getFiltered();
  const el = document.getElementById("player-list");

  if (!el) return;

  if (players.length === 0) {
    el.innerHTML = `<p class="text-center text-xs py-8" style="color:#d9d0ff;">ကိုက်ညီသည့် Player data မရှိသေးပါ</p>`;
    return;
  }

  el.innerHTML = players.map((p, i) => {
    const posUpper = String(p.position || "?").toUpperCase();
    const badgeColor = getPositionBadgeColor(posUpper);
    const cardBorder = getCardLeftBorder(posUpper);
    const textColor = posUpper === 'MID' ? '#14172b' : '#ffffff';
    const priceChangeMarking = getSeasonPriceChangeMarking(p);
    const statusBadge = getScoutStatusBadge(p);

    return `
      <div onclick="window.openPlayerModal(${i})" class="premium-scout-card active:scale-[0.98] transition cursor-pointer" style="border-left: ${cardBorder} !important;">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-[9px] px-2 py-0.5 rounded-full font-black shrink-0" style="background:${badgeColor}; color:${textColor};">${posUpper}</span>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <p class="text-[#0F172A] text-sm font-bold tracking-wide truncate">${p.name || "—"}</p>
                ${statusBadge}
              </div>
              <p class="text-xs text-slate-500 font-medium truncate">${p.team || ""}</p>
            </div>
          </div>
          <div class="text-right shrink-0">
            <div class="flex items-center justify-end">
              <span class="font-black text-[#0F172A]" style="font-family:'Bebas Neue'; font-size:1.2rem; line-height:1.1;">
                £${parseFloat(p.price || 0).toFixed(1)}M
              </span>
              ${priceChangeMarking}
            </div>
            <p class="text-[10px] text-slate-600 font-bold" style="color: #2d3366 !important;">${p.ownership || 0}% owned</p>
          </div>
        </div>
        
        <div class="scout-stats-row">
          <span class="text-[11px] text-slate-500 font-bold">Form: <span style="color:#1D4ED8 !important; font-size:12.5px; font-weight:900;">${p.form ?? 0}</span></span>
          <span class="text-[11px] text-slate-500 font-bold">Week Pts: <span style="color:#16A34A !important; font-size:12.5px; font-weight:900;">${p.gwPoints ?? 0}</span></span>
          <span class="text-[11px] text-slate-500 font-bold">Total Pts: <span style="color:#EA580C !important; font-size:13.5px; font-weight:900;">${p.totalPoints || 0}</span></span>
        </div>
      </div>
    `;
  }).join("");
}

window.openPlayerModal = (index) => {
  const players = getFiltered();
  const p = players[index];
  if (!p) return;

  const posUpper = String(p.position || "—").toUpperCase();
  const badgeColor = getPositionBadgeColor(posUpper);
  const textColor = posUpper === 'MID' ? '#14172b' : '#ffffff';
  const priceChangeMarking = getSeasonPriceChangeMarking(p);

  document.getElementById("modal-name").textContent = p.fullName || p.name || "—";
  document.getElementById("modal-team").textContent = p.team || "Unknown Team";

  const posEl = document.getElementById("modal-position");
  posEl.textContent = posUpper;
  posEl.style.backgroundColor = badgeColor;
  posEl.style.color = textColor;

  const status = String(p.status || "a").toLowerCase();
  const chance = p.chanceOfPlaying !== undefined && p.chanceOfPlaying !== null ? Number(p.chanceOfPlaying) : 100;
  const isSuspended = p.isSuspended || status === "s";
  const isInjured = p.isInjured || status === "i";
  const news = p.news || "";

  let statusBadgeEl = document.getElementById("modal-status-badge");
  let newsEl = document.getElementById("modal-news-text");

  if (!statusBadgeEl && posEl) {
    statusBadgeEl = document.createElement("span");
    statusBadgeEl.id = "modal-status-badge";
    posEl.parentNode.appendChild(statusBadgeEl);
  }
  if (!newsEl && posEl && posEl.parentNode) {
    newsEl = document.createElement("p");
    newsEl.id = "modal-news-text";
    newsEl.className = "text-[9.5px] text-amber-300 font-semibold mt-1 px-2 text-center";
    posEl.parentNode.after(newsEl);
  }

  if (statusBadgeEl) {
    if (isSuspended) {
      statusBadgeEl.textContent = "SUSPENDED";
      statusBadgeEl.className = "text-[9px] font-black px-2 py-0.5 rounded-full bg-red-600 text-white border border-red-400 inline-block ml-1.5";
      statusBadgeEl.style.display = "inline-block";
    } else if (isInjured || chance === 0) {
      statusBadgeEl.textContent = "INJURED";
      statusBadgeEl.className = "text-[9px] font-black px-2 py-0.5 rounded-full bg-red-600 text-white border border-red-400 inline-block ml-1.5";
      statusBadgeEl.style.display = "inline-block";
    } else if (chance > 0 && chance < 100) {
      statusBadgeEl.textContent = `${chance}% CHANCE`;
      statusBadgeEl.className = "text-[9px] font-black px-2 py-0.5 rounded-full bg-yellow-400 text-black border border-yellow-600 inline-block ml-1.5";
      statusBadgeEl.style.display = "inline-block";
    } else {
      statusBadgeEl.style.display = "none";
    }
  }

  if (newsEl) {
    if (news) {
      newsEl.textContent = news;
      newsEl.style.display = "block";
    } else {
      newsEl.style.display = "none";
    }
  }

  document.getElementById("modal-price").innerHTML = `£${parseFloat(p.price || 0).toFixed(1)}M ${priceChangeMarking}`;
  document.getElementById("modal-ownership").textContent = (p.ownership || 0) + "%";
  document.getElementById("modal-points").textContent = p.totalPoints || 0;

  const modalFormEl = document.getElementById("modal-form");
  if (modalFormEl) {
    modalFormEl.textContent = `${p.form ?? 0} (GW:${p.gwPoints ?? 0})`;
  }

  const ppgValEl = document.getElementById("modal-ppg-val");
  if (ppgValEl) {
    ppgValEl.textContent = `${p.ppg ?? 0} / ${p.val ?? 0}`;
  }

  const l5El = document.getElementById("modal-l5");
  if (l5El) {
    l5El.textContent = p.l5 ?? 0;
  }

  const xgiEl = document.getElementById("modal-xgi");
  if (xgiEl) {
    xgiEl.textContent = p.xgi ?? 0;
  }

  const ictEl = document.getElementById("modal-ict");
  if (ictEl) {
    ictEl.textContent = p.ict ?? 0;
  }

  const fixturesEl = document.getElementById("modal-fixtures");
  const currentGwNum = parseInt(localStorage.getItem("twf_current_gw") || "5", 10);
  const nextTargetGw = currentGwNum + 1;
  const pTeamCode = formatTeamShort(p.team);

  let upcomingMatches = [];

  for (let g = nextTargetGw; g < nextTargetGw + 8; g++) {
    const matches = getFirebaseMatchesForTeam(pTeamCode, g);
    if (matches.length > 0) {
      matches.forEach(m => upcomingMatches.push(m));
    } else {
      upcomingMatches.push({
        gw: g,
        opponent: "BLANK",
        isBlank: true,
        isHome: false,
        fdr: 0
      });
    }
    if (upcomingMatches.length >= 3) break;
  }

  upcomingMatches = upcomingMatches.slice(0, 3);

  if (upcomingMatches.length === 0) {
    fixturesEl.innerHTML = `<p class="text-center text-xs py-2 text-white/50">Fixture ဇယားများ မရှိသေးပါ</p>`;
  } else {
    fixturesEl.innerHTML = upcomingMatches.map(m => {
      if (m.isBlank) {
        return `
          <div class="flex items-center justify-between py-1 px-2.5 rounded-lg bg-slate-900 border border-slate-700/60 mb-1">
            <div class="flex items-center gap-2">
              <span class="text-[9px] font-black px-1.5 py-0.5 rounded bg-black/40 text-[#b3a1ff]">GW ${m.gw}</span>
              <span class="text-[11px] text-slate-400 font-semibold">BLANK GAMEWEEK</span>
            </div>
            <span class="text-[9px] font-black px-1.5 py-0.5 rounded text-slate-300 bg-slate-800">NO MATCH</span>
          </div>
        `;
      }

      const isHome = m.isHome === true || m.is_home === true;
      const venueBadge = isHome ? 
        `<span class="text-[9px] font-black text-emerald-400 ml-1">(H)</span>` : 
        `<span class="text-[9px] font-black text-amber-300 ml-1">(A)</span>`;
      const formattedOpponent = formatTeamShort(m.opponent);

      return `
        <div class="flex items-center justify-between py-1 px-2.5 rounded-lg bg-black/30 border border-[#3a3f7a]/50 mb-1">
          <div class="flex items-center gap-2">
            <span class="text-[9px] font-black px-1.5 py-0.5 rounded bg-black/40 text-[#b3a1ff]">GW ${m.gw}</span>
            <span class="text-[11px] text-white font-semibold flex items-center">
              ${formattedOpponent} ${venueBadge}
            </span>
          </div>
          <span class="text-[9px] font-black px-1.5 py-0.5 rounded text-white" style="background:${fdrColor(m.fdr)};">FDR ${m.fdr}</span>
        </div>
      `;
    }).join("");
  }

  const modalEl = document.getElementById("player-modal");
  if (modalEl) {
    modalEl.classList.remove("hidden");
    modalEl.style.display = "flex";
  }
};

window.closeModal = () => {
  const modalEl = document.getElementById("player-modal");
  if (modalEl) {
    modalEl.classList.add("hidden");
    modalEl.style.display = "none";
  }
};

window.filterPos = (pos) => {
  currentFilter = pos.toLowerCase();
  document.querySelectorAll(".filter-btn").forEach(b => {
    b.style.removeProperty("background");
    b.style.removeProperty("color");
    b.style.removeProperty("border-color");
    b.style.removeProperty("box-shadow");
    b.style.removeProperty("font-weight");
    b.style.background = "rgba(0,0,0,0.3)";
    b.style.color = "#94a3b8";
    b.style.borderColor = "rgba(58,63,122,0.35)";
  });

  const btn = document.getElementById("filter-" + pos.toLowerCase());
  if (btn) {
    btn.style.setProperty("background", "linear-gradient(135deg, #8c6dff, #b3a1ff)", "important");
    btn.style.setProperty("color", "#14172b", "important");
    btn.style.setProperty("border-color", "#b3a1ff", "important");
    btn.style.setProperty("font-weight", "900", "important");
    btn.style.setProperty("box-shadow", "0 0 10px rgba(179,161,255, 0.5)", "important");
  }

  renderPlayers();
};

window.filterTeam = (teamCode) => {
  currentTeamFilter = teamCode.toUpperCase().trim();
  renderPlayers();
};

window.toggleSort = (sortKey) => {
  currentSort = currentSort === sortKey ? null : sortKey;

  document.querySelectorAll(".sort-btn").forEach(b => {
    b.style.removeProperty("background");
    b.style.removeProperty("color");
    b.style.removeProperty("border-color");
    b.style.removeProperty("box-shadow");
    b.style.removeProperty("font-weight");
    b.style.background = "rgba(0,0,0,0.3)";
    b.style.color = "#94a3b8";
    b.style.borderColor = "rgba(255,255,255,0.1)";
  });

  if (currentSort) {
    const btn = document.getElementById("sort-" + sortKey);
    if (btn) {
      btn.style.setProperty("background", "linear-gradient(135deg, #8c6dff, #b3a1ff)", "important");
      btn.style.setProperty("color", "#14172b", "important");
      btn.style.setProperty("border-color", "#b3a1ff", "important");
      btn.style.setProperty("font-weight", "900", "important");
      btn.style.setProperty("box-shadow", "0 0 10px rgba(179,161,255, 0.5)", "important");
    }
  }

  renderPlayers();
};
