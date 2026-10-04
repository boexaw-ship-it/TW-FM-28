// ============================================
// TW FM — Fantasy Premier League Standings & Live Pitch Controller
// Production Ready: Resilient Compact/Full Picks Schema Normalizer
// Fixed: Player-to-Club ID Mapping (Haaland->MCI, Virgil->LIV, Fernandes->MUN etc.)
// Standards: UI Design Knowledge Pack (Sports UI & 8px Grid)
// ============================================

import { auth, db } from "../js/firebase-config.js";
import { getFixturesSnap, getScoutSnap, getLeagueStandingsSnap, onLeagueTeam } from "./core/data.js";
import { onAuthStateChanged } from "./core/auth.js";
import { 
  doc, getDoc, collection, onSnapshot, query, 
  getDocsFromServer, getDocs 
} from "./core/fs.js";

const leagueDataStore = {
  league1: [],
  league2: [],
  league3: [],
  league4: [],
  league5: []
};

let currentUserFplTeamId = null;
let currentActiveTab = "league1";
let sortMode = "total";
let unsubscribePopup = null;

const LEAGUE_CACHE_KEY = "twf_leagues_cache_v2";
const LEAGUE_TIME_KEY = "twf_leagues_quota_time_v2";
const SCOUT_CACHE_KEY = "twfm_all_players_map_v2";

const CHIP_LABELS = { "3xc": "TC", "bboost": "BB", "wildcard": "WC", "freehit": "FH", "manager": "AM" };

// =========================================================================
// 🛡️ 2026/27 PREMIER LEAGUE TEAM ID & SHORT CODE MAP
// =========================================================================
const FPL_TEAM_MAP = {
  1: "ars",  "arsenal": "ars",                 "ars": "ars",
  2: "avl",  "aston villa": "avl",             "avl": "avl",
  3: "bou",  "bournemouth": "bou",             "bou": "bou",
  4: "bre",  "brentford": "bre",               "bre": "bre",
  5: "bha",  "brighton": "bha",                "bha": "bha",
  6: "che",  "chelsea": "che",                 "che": "che",
  7: "cov",  "coventry": "cov",                "cov": "cov",
  8: "cry",  "crystal palace": "cry",          "cry": "cry",
  9: "eve",  "everton": "eve",                 "eve": "eve",
  10: "ful", "fulham": "ful",                  "ful": "ful",
  11: "hul", "hull": "hul", "hull city": "hul","hul": "hul",
  12: "ips", "ipswich": "ips",                 "ips": "ips",
  13: "lee", "leeds": "lee", "leeds united": "lee", "lee": "lee",
  14: "liv", "liverpool": "liv",               "liv": "liv",
  15: "mci", "man city": "mci", "manchester city": "mci", "mci": "mci",
  16: "mun", "man utd": "mun", "manchester united": "mun", "mun": "mun",
  17: "new", "newcastle": "new",               "new": "new",
  18: "nfo", "nottingham forest": "nfo", "forest": "nfo", "nfo": "nfo",
  19: "tot", "tottenham": "tot", "spurs": "tot", "tot": "tot",
  20: "sun", "sunderland": "sun",              "sun": "sun"
};

// 🌟 Local Memory Registry for Player ID -> Team Code & Position
const playerRegistry = {};

// Fallback Common Star Players Map (Instant Offline Zero-Fail Registry)
const KNOWN_PLAYERS = {
  "haaland": { team: "mci", pos: "FWD" },
  "salah": { team: "liv", pos: "MID" },
  "saka": { team: "ars", pos: "MID" },
  "palmer": { team: "che", pos: "MID" },
  "b.fernandes": { team: "mun", pos: "MID" },
  "raya": { team: "ars", pos: "GK" },
  "virgil": { team: "liv", pos: "DEF" },
  "gvardiol": { team: "mci", pos: "DEF" },
  "calafiori": { team: "ars", pos: "DEF" },
  "konsa": { team: "avl", pos: "DEF" },
  "tarkowski": { team: "eve", pos: "DEF" },
  "hall": { team: "new", pos: "DEF" },
  "szoboszlai": { team: "liv", pos: "MID" },
  "mbeumo": { team: "bre", pos: "MID" },
  "groß": { team: "bha", pos: "MID" },
  "calvert-lewin": { team: "eve", pos: "FWD" },
  "dubravka": { team: "new", pos: "GK" },
  "joão pedro": { team: "che", pos: "FWD" },
  "rogers": { team: "che", pos: "MID" },
  "belloumi": { team: "hul", pos: "MID" },
  "tzolis": { team: "ips", pos: "MID" },
  "dedić": { team: "sun", pos: "DEF" }
};

// 💡 Background Engine: scoutPlayers/allPlayers မှ ကစားသမားအားလုံး၏ အသင်း code များကို ဆွဲယူထားခြင်း
async function initPlayerRegistry() {
  try {
    const cachedMap = localStorage.getItem(SCOUT_CACHE_KEY);
    if (cachedMap) {
      Object.assign(playerRegistry, JSON.parse(cachedMap));
    }
    const snap = await getDoc(doc(db, "scoutPlayers", "allPlayers"));
    if (snap.exists()) {
      const data = snap.data();
      const players = data.players || [];
      players.forEach(p => {
        const id = String(p.playerId || p.id);
        const nameClean = String(p.name || "").toLowerCase().trim();
        const tCode = FPL_TEAM_MAP[p.teamId] || FPL_TEAM_MAP[String(p.teamCode).toLowerCase()] || "che";
        const pos = String(p.position || "").toUpperCase();
        playerRegistry[id] = { team: tCode, pos };
        if (nameClean) playerRegistry[nameClean] = { team: tCode, pos };
      });
      localStorage.setItem(SCOUT_CACHE_KEY, JSON.stringify(playerRegistry));
    }
  } catch (err) {
    console.warn("Player registry load note:", err);
  }
}

initPlayerRegistry();

function resolveTeamCode(rawTeam, playerName = "", playerId = "") {
  // 1. Check ID from registry
  const pIdStr = String(playerId || "");
  if (pIdStr && playerRegistry[pIdStr]?.team) {
    return playerRegistry[pIdStr].team;
  }

  // 2. Check Name from registry & known players
  const cleanName = String(playerName || "").toLowerCase().trim();
  if (cleanName && playerRegistry[cleanName]?.team) {
    return playerRegistry[cleanName].team;
  }
  if (cleanName && KNOWN_PLAYERS[cleanName]?.team) {
    return KNOWN_PLAYERS[cleanName].team;
  }
  for (const [k, v] of Object.entries(KNOWN_PLAYERS)) {
    if (cleanName.includes(k)) return v.team;
  }

  // 3. Check explicit team field
  if (rawTeam) {
    const clean = String(rawTeam).toLowerCase().trim();
    if (FPL_TEAM_MAP[clean]) return FPL_TEAM_MAP[clean];
    if (FPL_TEAM_MAP[Number(clean)]) return FPL_TEAM_MAP[Number(clean)];
  }

  return "che";
}

// 🌐 Dynamic Base Path Detector
function getAssetBasePath() {
  const path = window.location.pathname;
  if (path.includes("/TW-FM-28/")) {
    return "/TW-FM-28";
  }
  return "";
}

function jerseyPath(p) {
  const folder = (p.position || "").toUpperCase() === "GK" ? "gk" : "outfield"; 
  const code = resolveTeamCode(p.teamCode || p.team, p.name, p.playerId); 
  const base = getAssetBasePath();
  return `${base}/public/jerseys/${folder}/${code}.png`; 
}

// =========================================================================
// 🌟 OFFLINE FIRST ENGINE
// =========================================================================

function mountOfflineCacheImmediately() {
  try {
    const cachedData = localStorage.getItem(LEAGUE_CACHE_KEY);
    if (cachedData) {
      const parsed = JSON.parse(cachedData);
      Object.keys(parsed).forEach(k => {
        leagueDataStore[k] = parsed[k] || [];
        renderTable(k);
      });
      const activeLeagueWithData = Object.values(leagueDataStore).find(arr => arr.length > 0) || [];
      updateGwBadge(activeLeagueWithData);
    }
  } catch (err) {
    console.warn("Immediate league offline mount failed:", err);
  }
}

if (document.readyState === "loading") {
  queueMicrotask(() => {
    updateGwBadge();
    mountOfflineCacheImmediately();
  });
} else {
  updateGwBadge();
  mountOfflineCacheImmediately();
}

function updateGwBadge(dataArray = []) {
  const badge = document.getElementById("gw-badge");
  if (!badge) return;

  let gw = null;
  if (Array.isArray(dataArray) && dataArray.length > 0) {
    const found = dataArray.find(d => d.gameweek || d.currentGw);
    if (found) gw = found.gameweek || found.currentGw;
  }

  if (!gw) {
    gw = localStorage.getItem("twf_current_gw") || 
         localStorage.getItem("twf_transfers_gw") || 
         "1";
  }

  badge.textContent = "GW " + gw;
}

function getMyanmarDate(dateObj = new Date()) {
  const utc = dateObj.getTime() + (dateObj.getTimezoneOffset() * 60000);
  return new Date(utc + (6.5 * 3600000));
}

function checkLeagueSlotStatus() {
  const mmNow = getMyanmarDate(new Date());
  const day = mmNow.getDay();
  const currentH = mmNow.getHours();
  let savedTimeMs = localStorage.getItem(LEAGUE_TIME_KEY);

  if (!savedTimeMs) {
    localStorage.setItem(LEAGUE_TIME_KEY, String(Date.now()));
    savedTimeMs = String(Date.now());
  }

  const isMatchDayPeriod = (day === 0 || day === 6 || day === 1);

  if (isMatchDayPeriod) {
    const matchDaySlots = [0, 6, 12, 18];
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
      alertText: `⏳ TWFM LEAGUE UPDATE ကို (${dateFormatted} ရက် ${timeFormatted}) တွင် ရရှိပါမည်ခင်ဗျာ!`
    };
  }

  const currentWindowStartDate = new Date(mmNow);
  currentWindowStartDate.setHours(0, 0, 0, 0);

  const nextSlotDate = new Date(currentWindowStartDate);
  nextSlotDate.setDate(nextSlotDate.getDate() + 1);
  const dateFormatted = `${nextSlotDate.getDate()}/${nextSlotDate.getMonth() + 1}`;

  const lastSavedMm = getMyanmarDate(new Date(Number(savedTimeMs)));
  const isExpired = lastSavedMm.getTime() < currentWindowStartDate.getTime();

  return {
    isExpired,
    alertText: `⏳ TWFM LEAGUE UPDATE ကို (${dateFormatted} ရက် ည ၁၂:၀၀ နာရီ) တွင် ရရှိပါမည်ခင်ဗျာ!`
  };
}

function showLeagueNotice(message, isError = false) {
  let toast = document.getElementById("tw-league-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "tw-league-toast";
    toast.className = "fixed top-4 left-1/2 -translate-x-1/2 z-[99999] px-4 py-2.5 rounded-xl text-xs font-bold text-center transition-all duration-300 opacity-0 pointer-events-none shadow-2xl border max-w-[90%]";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.background = isError ? "linear-gradient(135deg, #7f1d1d, #450a0a)" : "linear-gradient(135deg, #1b1f3a, #14172b)";
  toast.style.color = isError ? "#fecaca" : "#b3a1ff";
  toast.style.borderColor = isError ? "#ef4444" : "#b3a1ff";
  toast.style.boxShadow = isError ? "0 8px 24px rgba(239, 68, 68, 0.7)" : "0 8px 20px rgba(179,161,255, 0.3)";

  toast.classList.remove("opacity-0");
  toast.classList.add("opacity-100");

  clearTimeout(window.leagueToastTimeout);
  window.leagueToastTimeout = setTimeout(() => {
    toast.classList.remove("opacity-100");
    toast.classList.add("opacity-0");
  }, 3200);
}

function triggerInitialFakeRefreshUI() {
  const refreshBtn = document.getElementById("refresh-league-btn");
  if (refreshBtn) {
    refreshBtn.style.setProperty("background-color", "#8c6dff", "important");
    refreshBtn.style.setProperty("color", "#14172b", "important");
    refreshBtn.style.setProperty("border-color", "#b3a1ff", "important");
  }

  setTimeout(() => {
    if (refreshBtn) {
      refreshBtn.style.removeProperty("background-color");
      refreshBtn.style.removeProperty("color");
      refreshBtn.style.removeProperty("border-color");
    }
  }, 1200);
}

window.forceRefreshLeague = async function() {
  if (!navigator.onLine) {
    mountOfflineCacheImmediately();
    showLeagueNotice("⚠️ အော့ဖ်လိုင်းမုဒ်: အင်တာနက်မရှိသေးပါခင်ဗျာ!", true);
    return;
  }

  const refreshBtn = document.getElementById("refresh-league-btn");
  const slotStatus = checkLeagueSlotStatus();

  if (!slotStatus.isExpired) {
    showLeagueNotice(slotStatus.alertText, false);
    return;
  }

  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.style.setProperty("background-color", "#8c6dff", "important");
    refreshBtn.style.setProperty("color", "#14172b", "important");
    refreshBtn.style.setProperty("border-color", "#b3a1ff", "important");
    refreshBtn.style.setProperty("box-shadow", "0 0 12px rgba(140,109,255, 0.8)", "important");
    refreshBtn.innerHTML = `<span class="inline-block animate-spin mr-1">🔄</span> Loading...`;
  }

  showLeagueNotice("🔄 TW FM UPDATE...", false);

  try {
    const isSuccess = await internalFetchLeagueData(true);
    if (isSuccess) {
      localStorage.setItem(LEAGUE_TIME_KEY, String(Date.now()));
      showLeagueNotice("✅ Standings Update ရရှိပါပြီ!");
    } else {
      throw new Error("LEAGUE_FETCH_FAILED");
    }
  } catch (err) {
    console.error("League Refresh Blocked:", err);
    mountOfflineCacheImmediately();
    showLeagueNotice("⚠️ ဒေတာဟောင်းများကို ပြသပေးထားပါသည်ခင်ဗျာ!", false);
  } finally {
    setTimeout(() => {
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.style.removeProperty("background-color");
        refreshBtn.style.removeProperty("color");
        refreshBtn.style.removeProperty("border-color");
        refreshBtn.style.removeProperty("box-shadow");
        refreshBtn.innerHTML = `🔄 Refresh`;
      }
    }, 400);
  }
};

window.loadLeagueData = function() {
  return window.forceRefreshLeague();
};

onAuthStateChanged(auth, async (user) => {
  triggerInitialFakeRefreshUI();

  if (!user) {
    if (!navigator.onLine || localStorage.getItem(LEAGUE_CACHE_KEY)) {
      mountOfflineCacheImmediately();
      return;
    }
    if (typeof window.go === "function") window.go("login");
    else window.location.hash = "/login";
    return;
  }

  if (navigator.onLine) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) { 
        if (typeof window.go === "function") window.go("login");
        else window.location.hash = "/login";
        return; 
      }

      const userData = snap.data();
      if (userData.fplTeamId) {
        currentUserFplTeamId = String(userData.fplTeamId).trim();
      }

      await internalFetchLeagueData(false);
    } catch (err) {
      console.warn("League auth network error, mounting offline view:", err);
      mountOfflineCacheImmediately();
    }
  } else {
    mountOfflineCacheImmediately();
  }
});

async function internalFetchLeagueData(forceFresh = false) {
  const cachedData = localStorage.getItem(LEAGUE_CACHE_KEY);

  if (!forceFresh && cachedData) {
    try {
      const parsed = JSON.parse(cachedData);
      Object.keys(parsed).forEach(k => {
        leagueDataStore[k] = parsed[k] || [];
        renderTable(k);
      });
      const activeLeagueWithData = Object.values(leagueDataStore).find(arr => arr.length > 0) || [];
      updateGwBadge(activeLeagueWithData);
      return true;
    } catch (e) {
      console.warn("Corrupt league cache, fallback to Firestore");
    }
  }

  if (!navigator.onLine) {
    mountOfflineCacheImmediately();
    return true;
  }

  try {
    const keys = ["league1", "league2", "league3", "league4", "league5"];
    const fetchFunc = forceFresh 
      ? (k) => getLeagueStandingsSnap(k, true)
      : (k) => getLeagueStandingsSnap(k);

    const results = await Promise.allSettled(keys.map(fetchFunc));
    let hasAnySuccess = false;

    results.forEach((res, index) => {
      const key = keys[index];
      if (res.status === "fulfilled") {
        leagueDataStore[key] = [];
        res.value.forEach(d => leagueDataStore[key].push({ id: d.id, ...d.data() }));
        renderTable(key);
        hasAnySuccess = true;
      } else {
        if (!cachedData) {
          leagueDataStore[key] = [];
          const el = document.getElementById(`${key}-table`);
          if (el) el.innerHTML = `<p class="text-center text-xs py-6" style="color:#64748b !important; font-weight:800;">Data မရှိသေးပါ</p>`;
        }
      }
    });

    if (hasAnySuccess) {
      localStorage.setItem(LEAGUE_CACHE_KEY, JSON.stringify(leagueDataStore));
      const activeLeagueWithData = Object.values(leagueDataStore).find(arr => arr.length > 0) || [];
      updateGwBadge(activeLeagueWithData);
      return true;
    } else {
      throw new Error("All leagues failed to fetch from server");
    }

  } catch (err) {
    if (forceFresh) throw err;
    console.error("League data load error (Falling back to offline cache):", err);
    mountOfflineCacheImmediately();
    return false;
  }
}

function chipBadge(chipCode) {
  if (!chipCode || !CHIP_LABELS[chipCode]) return "";
  const code = CHIP_LABELS[chipCode];
  
  let bg = "rgba(0,0,0,0.06)";
  let text = "#000000";
  
  if (code === "TC") { bg = "#FEF3C7"; text = "#B45309"; }
  if (code === "BB") { bg = "#DBEAFE"; text = "#1D4ED8"; }
  if (code === "WC") { bg = "#F3E8FF"; text = "#6D28D9"; }
  if (code === "FH") { bg = "#E0F2FE"; text = "#0369A1"; }

  return `<span class="rounded" style="font-size:9px; font-weight:900; padding:2px 6px; border-radius:4px; background:${bg} !important; color:${text} !important; margin-left:4px; border:1px solid rgba(0,0,0,0.05); display:inline-block;">${code}</span>`;
}

function hitBadge(hitCost) {
  if (!hitCost || hitCost === 0) return "";
  return `<span style="font-size:9px; font-weight:900; color:#DC2626 !important; margin-left:4px; display:inline-block;">(-${hitCost})</span>`;
}

function getPlayerStatusBadge(p) {
  const status = String(p.status || "a").toLowerCase();
  const chance = p.chanceOfPlaying !== undefined && p.chanceOfPlaying !== null ? Number(p.chanceOfPlaying) : 100;
  const isSuspended = p.isSuspended || status === "s";
  const isInjured = p.isInjured || status === "i";

  const badgePositionStyle = `position:absolute; top:14px; left:-2px; z-index:25; font-size:7px; font-weight:900; padding:1px 3px; border-radius:3px; line-height:1; box-shadow:0 1px 3px rgba(0,0,0,0.5);`;

  if (isSuspended) {
    return `<span style="${badgePositionStyle} background:#DC2626; color:#ffffff; border:1px solid #FCA5A5;">SUSP</span>`;
  }
  if (isInjured || chance === 0) {
    return `<span style="${badgePositionStyle} background:#DC2626; color:#ffffff; border:1px solid #FCA5A5;">INJ</span>`;
  }
  if (chance > 0 && chance < 100) {
    return `<span style="${badgePositionStyle} background:#FACC15; color:#000000; border:1px solid #CA8A04;">${chance}%</span>`;
  }
  return "";
}

// 🛡️ Compact vs Full Schema Normalizer Helper
function normalizePick(p, idx) {
  const pId = String(p.id || p.playerId || p.element || "");
  const pName = p.name || p.web_name || "?";

  // 1. Position Resolution
  let rawPos = String(p.pos || p.position || "").toUpperCase().trim();
  if (rawPos === "1" || rawPos === "GKP") rawPos = "GK";
  else if (rawPos === "2") rawPos = "DEF";
  else if (rawPos === "3") rawPos = "MID";
  else if (rawPos === "4") rawPos = "FWD";

  if (!rawPos && playerRegistry[pId]?.pos) {
    rawPos = playerRegistry[pId].pos;
  }

  if (!rawPos) {
    if (idx === 0 || idx === 11) rawPos = "GK";
    else if (idx >= 1 && idx <= 4) rawPos = "DEF";
    else if (idx >= 5 && idx <= 8) rawPos = "MID";
    else if (idx >= 9 && idx <= 10) rawPos = "FWD";
    else if (idx === 12) rawPos = "DEF";
    else if (idx === 13) rawPos = "MID";
    else rawPos = "FWD";
  }

  // 2. Multiplier Resolution
  let rawMult = 0;
  if (p.mult !== undefined && p.mult !== null) {
    rawMult = Number(p.mult);
  } else if (p.multiplier !== undefined && p.multiplier !== null) {
    rawMult = Number(p.multiplier);
  } else if (p.originalMultiplier !== undefined && p.originalMultiplier !== null) {
    rawMult = Number(p.originalMultiplier);
  } else {
    rawMult = idx < 11 ? 1 : 0;
  }

  // 3. Points, Captain & Vice
  const livePts = Number(p.pts !== undefined ? p.pts : (p.livePoints ?? 0));
  const isCap = Boolean(p.c !== undefined ? p.c : (p.isCaptain || p.is_captain));
  const isVc = Boolean(p.v !== undefined ? p.v : (p.isVice || p.is_vice_captain));

  // 4. Team Code Resolution (Player ID & Name aware)
  const resolvedTeam = resolveTeamCode(p.teamCode || p.team || p.team_code || p.teamId, pName, pId);

  return {
    playerId: pId,
    name: pName,
    position: rawPos,
    multiplier: rawMult,
    livePoints: livePts,
    isCaptain: isCap,
    isVice: isVc,
    teamCode: resolvedTeam,
    status: p.status || "a",
    isInjured: Boolean(p.isInjured),
    isSuspended: Boolean(p.isSuspended),
    chanceOfPlaying: p.chanceOfPlaying ?? 100
  };
}

// 🌟 TABLE RENDER
function renderTable(firebaseId) {
  const data = leagueDataStore[firebaseId] || [];
  const el = document.getElementById(`${firebaseId}-table`);

  if (!el) return;
  if (data.length === 0) {
    el.innerHTML = `<p class="text-center text-xs py-6" style="color:#64748b !important; font-weight:800;">Data မရှိသေးပါ</p>`;
    return;
  }

  const sorted = [...data].sort((a, b) => {
    if (sortMode === "gw") return (b.gwPoints ?? 0) - (a.gwPoints ?? 0);
    return (b.points ?? 0) - (a.points ?? 0);
  });

  const rows = sorted.map((r, i) => ({ ...r, rank: i + 1 }));

  const getRowBgColor = (rank) => {
    if (rank === 1) return "#FFD700";
    if (rank === 2) return "#E2E8F0";
    if (rank === 3) return "#FFEDD5";
    return "#FEF9C3";
  };

  el.innerHTML = `
    <table style="border-collapse: separate !important; border-spacing: 0 10px !important; width: 100% !important; background: transparent !important; border: none !important;">
      <thead>
        <tr style="background: transparent !important; box-shadow: none !important; border: none !important;">
          <th class="w-[14%] text-[#2d3366] font-black uppercase tracking-wider text-[10px] pb-1 pl-3" style="color: #2d3366 !important; background: transparent !important; border: none !important;">#</th>
          <th class="text-[#2d3366] font-black uppercase tracking-wider text-[10px] pb-1" style="color: #2d3366 !important; background: transparent !important; border: none !important;">Team Name</th>
          <th class="text-center w-[16%] text-[#2d3366] font-black uppercase tracking-wider text-[10px] pb-1" style="color: #2d3366 !important; background: transparent !important; border: none !important;">GW</th>
          <th class="text-right w-[18%] text-[#2d3366] font-black uppercase tracking-wider text-[10px] pb-1 pr-3" style="color: #2d3366 !important; background: transparent !important; border: none !important;">Total</th>
        </tr>
      </thead>
      <tbody style="background: transparent !important; border: none !important;">
        ${rows.map(r => {
          const isMyTeam = currentUserFplTeamId && String(r.fplTeamId).trim() === currentUserFplTeamId;
          const defaultBg = getRowBgColor(r.rank);
          const bgColor = isMyTeam ? "#D1FAE5" : defaultBg;
          const rowBorder = isMyTeam 
            ? "border: 1.5px solid #10B981 !important; box-shadow: 0 0 10px rgba(16, 185, 129, 0.35) !important;" 
            : "border: none !important;";

          return `
          <tr onclick="openTeamPopup('${firebaseId}', '${r.fplTeamId}', '${(r.teamName || '—').replace(/'/g, "\\'")}')"
              class="active:scale-[0.99] transition shadow-sm cursor-pointer"
              style="background: ${bgColor} !important; background-color: ${bgColor} !important; color: #000000 !important; font-weight: 800 !important; border-radius: 1rem !important; ${rowBorder}">
            
            <td class="py-3.5 pl-3.5 text-sm font-black whitespace-nowrap" style="background: ${bgColor} !important; background-color:${bgColor} !important; color: #000000 !important; border-top-left-radius: 1rem !important; border-bottom-left-radius: 1rem !important; border: none !important; width: 14% !important;">
              ${r.rank}.
            </td>
            
            <td class="py-3.5 pr-2" style="background: ${bgColor} !important; background-color:${bgColor} !important; color: #000000 !important; border: none !important;">
              <div style="background: transparent !important; background-color: transparent !important; display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
                <span class="team-text-node" style="font-size: 0.85rem; font-weight: 800; color: #000000 !important; background: transparent !important; background-color: transparent !important; word-break: break-word; line-height: 1.2;">
                  ${r.teamName || "—"}
                </span>
                ${isMyTeam ? '<span class="text-[7.5px] font-black px-1.5 py-0.5 rounded bg-emerald-600 text-white ml-0.5 shadow-xs shrink-0">YOU</span>' : ''}
                ${chipBadge(r.chip)}${hitBadge(r.hitCost)}
              </div>
            </td>
            
            <td class="py-3.5 text-center text-sm font-black whitespace-nowrap" style="background: ${bgColor} !important; background-color:${bgColor} !important; color: #000000 !important; border: none !important; width: 16% !important;">
              ${r.gwPoints ?? 0}
            </td>
            
            <td class="py-3.5 pr-4 text-right font-black text-base points-text-node whitespace-nowrap" style="background: ${bgColor} !important; background-color:${bgColor} !important; color: #000000 !important; border-top-right-radius: 1rem !important; border-bottom-right-radius: 1rem !important; border: none !important; width: 18% !important; font-family: 'Bebas Neue', sans-serif; font-size: 1.15rem;">
              ${r.points ?? 0}
            </td>
            
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

// 🌟 TEAM POPUP
window.openTeamPopup = (leagueId, fplTeamId, teamName) => {
  const modal = document.getElementById("team-popup-modal");
  modal.style.display = "flex";

  document.getElementById("modal-team-title").textContent = teamName;
  document.getElementById("popup-pitch-rows").innerHTML = `<p class="text-center text-xs py-24 text-white/50 font-medium">Team loading...</p>`;
  document.getElementById("popup-bench-row").innerHTML = "";

  if (unsubscribePopup) { unsubscribePopup(); unsubscribePopup = null; }

  const cachedLeague = leagueDataStore[leagueId] || [];
  const localFoundTeam = cachedLeague.find(t => String(t.fplTeamId) === String(fplTeamId));
  
  if (localFoundTeam && Array.isArray(localFoundTeam.picks) && localFoundTeam.picks.length > 0) {
    renderPopupData(localFoundTeam);
  }

  unsubscribePopup = onLeagueTeam(leagueId, fplTeamId, (snap) => {
    if (!snap.exists()) {
      if (!localFoundTeam) {
        document.getElementById("popup-pitch-rows").innerHTML = `<p class="text-center text-xs py-24 text-white/50">ဒေတာ မရှိသေးပါဗျာ</p>`;
      }
      return;
    }
    const d = snap.data();
    renderPopupData(d);
  }, (err) => {
    console.warn("Popup snapshot note (Offline fallback):", err);
    if (!localFoundTeam) {
      document.getElementById("popup-pitch-rows").innerHTML = `<p class="text-center text-xs py-24 text-white/60">အော့ဖ်လိုင်းမုဒ်တွင် လူစာရင်း Live Preview ကို မရရှိနိုင်သေးပါခင်ဗျာ</p>`;
    }
  });
};

function renderPopupData(d) {
  const activeChipCode = d.chip && CHIP_LABELS[d.chip] ? CHIP_LABELS[d.chip] : (d.chip || "NO CHIP");
  const isBenchBoost = activeChipCode === "BB";

  let calculatedGwPoints = Number(d.gwPoints ?? 0);
  const rawPicks = d.picks || [];

  if (rawPicks.length > 0) {
    const normalizedPicks = rawPicks.map(normalizePick);

    let starterPts = 0;
    let benchPts = 0;

    normalizedPicks.forEach(p => {
      const mult = Number(p.multiplier ?? 0);
      const pts = (Number(p.livePoints) || 0) * (mult > 1 ? mult : 1);
      if (mult > 0) {
        starterPts += pts;
      } else {
        benchPts += Number(p.livePoints) || 0;
      }
    });

    calculatedGwPoints = isBenchBoost ? (starterPts + benchPts) : starterPts;

    document.getElementById("modal-gw-pts").textContent = calculatedGwPoints;
    document.getElementById("modal-total-pts").textContent = d.points ?? d.totalPoints ?? "0";
    document.getElementById("modal-hit-cost").textContent = "-" + (d.hitCost || 0);
    document.getElementById("modal-chip-badge").textContent = activeChipCode;

    renderPopupPitch(normalizedPicks);
  } else {
    document.getElementById("popup-pitch-rows").innerHTML = `<p class="text-center text-xs py-24 text-white/50">လူစာရင်း ဒေတာ မတွေ့ရှိပါဗျာ</p>`;
  }
}

window.closeTeamPopup = () => {
  if (unsubscribePopup) { unsubscribePopup(); unsubscribePopup = null; }
  document.getElementById("team-popup-modal").style.display = "none";
};

// 🌟 Jersey Card Builder (Accurate Team Jerseys)
function buildPlayerCard(p) {
  const mult = Number(p.multiplier) || 0; 
  const displayPoints = (p.livePoints ?? 0) * (mult > 1 ? mult : 1); 

  let cornerBadge = ""; 
  if (mult === 3) 
    cornerBadge = `<span style="position:absolute;top:-5px;right:-3px;background:#b3a1ff;color:#14172b;font-size:8px;font-weight:900;width:16px;height:16px;border-radius:9999px;display:flex;align-items:center;justify-content:center;z-index:20;box-shadow:0 1px 3px rgba(0,0,0,0.4);">3x</span>`; 
  else if (p.isCaptain || mult > 1) 
    cornerBadge = `<span style="position:absolute;top:-5px;right:-3px;background:#b3a1ff;color:#14172b;font-size:8px;font-weight:900;width:16px;height:16px;border-radius:9999px;display:flex;align-items:center;justify-content:center;z-index:20;box-shadow:0 1px 3px rgba(0,0,0,0.4);">C</span>`; 
  else if (p.isVice) 
    cornerBadge = `<span style="position:absolute;top:-5px;right:-3px;background:#C0C0C0;color:#14172b;font-size:8px;font-weight:900;width:16px;height:16px;border-radius:9999px;display:flex;align-items:center;justify-content:center;z-index:20;box-shadow:0 1px 3px rgba(0,0,0,0.4);">V</span>`; 

  const statusBadge = getPlayerStatusBadge(p);
  const borderHighlight = (p.isCaptain || mult > 1) ? 'border-b-2 border-b-[#b3a1ff]' : p.isVice ? 'border-b-2 border-b-[#C0C0C0]' : ''; 

  const primarySrc = jerseyPath(p);
  const fallbackSrc1 = `./public/jerseys/${(p.position || "").toUpperCase() === "GK" ? "gk" : "outfield"}/${p.teamCode}.png`;
  const fallbackSrc2 = `./public/jerseys/outfield/${p.teamCode}.png`;

  return `
    <div style="width:64px; flex-shrink:0; display:flex; flex-direction:column; align-items:center; position:relative;">
      ${cornerBadge}
      <div class="${borderHighlight}" style="width:44px; height:44px; display:flex; align-items:center; justify-content:center; margin-bottom:2px; position:relative;">
        <img src="${primarySrc}"
             data-fb1="${fallbackSrc1}"
             data-fb2="${fallbackSrc2}"
             onerror="
               if (!this.dataset.tried1) {
                 this.dataset.tried1 = '1';
                 this.src = this.dataset.fb1;
               } else if (!this.dataset.tried2) {
                 this.dataset.tried2 = '1';
                 this.src = this.dataset.fb2;
               } else {
                 this.outerHTML='<div style=\\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.4rem;\\'>👕</div>';
               }
             "
             style="width:100%; height:100%; object-fit:contain; filter: drop-shadow(0px 2px 3px rgba(0,0,0,0.4));" 
             alt="${p.name}" />
        ${statusBadge}
      </div>
      <div style="width:100%; display:flex; flex-direction:column; border-radius:2px; overflow:hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">
        <div style="width:100%; background:white; padding:1px 2px; text-align:center; height:15px; display:flex; align-items:center; justify-content:center;">
          <p style="color:#14172b; font-weight:900; font-size:7.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; line-height:1.1; width:100%;">${p.name || "?"}</p>
        </div>
        <div style="width:100%; background:#000000; color:#ffffff; text-align:center; height:14px; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:9px;">
          ${displayPoints}
        </div>
      </div>
    </div>
  `;
}

function renderPopupPitch(normalizedPicks) {
  let starters = normalizedPicks.filter(p => Number(p.multiplier ?? 0) > 0); 
  let subs = normalizedPicks.filter(p => Number(p.multiplier ?? 0) === 0); 

  if (starters.length === 0 && normalizedPicks.length >= 11) {
    starters = normalizedPicks.slice(0, 11);
    subs = normalizedPicks.slice(11);
    starters.forEach(p => p.multiplier = 1);
    subs.forEach(p => p.multiplier = 0);
  }

  const gk  = starters.filter(p => (p.position || "").toUpperCase() === "GK"); 
  const def = starters.filter(p => (p.position || "").toUpperCase() === "DEF"); 
  const mid = starters.filter(p => (p.position || "").toUpperCase() === "MID"); 
  const fwd = starters.filter(p => (p.position || "").toUpperCase() === "FWD"); 

  const renderRow = (players) => {
    if (!players || players.length === 0) return "";
    const gapSize = players.length >= 5 ? "4px" : "6px";
    return `
      <div style="display:flex; justify-content:center; align-items:center; gap:${gapSize}; width:100%; overflow:visible;">
        ${players.map(buildPlayerCard).join("")}
      </div>
    `;
  };

  document.getElementById("popup-pitch-rows").innerHTML = `
    <div style="display:flex; flex-direction:column; justify-content:space-between; height:100%; padding:4px 0; gap:12px;">
      ${renderRow(gk)}
      ${renderRow(def)}
      ${renderRow(mid)}
      ${renderRow(fwd)}
    </div>`; 

  document.getElementById("popup-bench-row").innerHTML = subs.map(p => {
    const posLabel = String(p.position || "").toUpperCase();
    return `
      <div style="display:flex; flex-direction:column; align-items:center; gap:2px;">
        <span style="font-size:8px; font-weight:900; color:#d9d0ff; text-transform:uppercase; opacity:0.6;">${posLabel}</span>
        ${buildPlayerCard(p)}
      </div>
    `;
  }).join("");
}

window.switchTab = (tab) => {
  currentActiveTab = tab;
  const allTabs = ["league1", "league2", "league3", "league4", "league5"];

  allTabs.forEach(t => {
    const btn = document.getElementById("tab-" + t);
    const panel = document.getElementById("panel-" + t);
    
    if (btn) {
      btn.style.boxSizing = "border-box";
      btn.style.borderWidth = "1.5px";
      btn.style.borderStyle = "solid";
      
      if (t === tab) {
        btn.style.background = "linear-gradient(135deg, #8c6dff, #b3a1ff)";
        btn.style.color = "#14172b";
        btn.style.borderColor = "#b3a1ff";
      } else {
        btn.style.background = "#ffffff";
        btn.style.color = "#475569";
        btn.style.borderColor = "#cbd5e1";
      }
    }
    
    if (panel) {
      panel.style.display = t === tab ? "block" : "none";
    }
  });
};

window.switchSort = (mode) => {
  sortMode = mode;
  ["total", "gw"].forEach(m => {
    const btn = document.getElementById("sort-" + m);
    if (!btn) return;
    if (m === mode) {
      btn.style.background = "#14172b";
      btn.style.color = "#8c6dff";
      btn.style.borderColor = "#14172b";
    } else {
      btn.style.background = "transparent";
      btn.style.color = "#64748b";
      btn.style.borderColor = "#e2e8f0";
    }
  });
  
  ["league1", "league2", "league3", "league4", "league5"].forEach(renderTable);
};
