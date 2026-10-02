import { auth, db } from "../js/firebase-config.js";
import { getFixturesSnap, getScoutSnap, getLeagueStandingsSnap, onLeagueTeam } from "./core/data.js";
import { onAuthStateChanged } from "./core/auth.js";
import { 
  doc, getDoc, getDocFromServer, onSnapshot, collection, getDocs 
} from "./core/fs.js";
import { jerseyPath, splitSquadByPosition } from "./pitch-renderer.js";

// =========================================================================
//  Live squad loader (quota-safe) — liveteamquota.js ကို ဒီထဲ ပေါင်းထည့်ထား
//  getLiveSquadWithQuota(fplId, force) -> { squad, points, fromCache }
//   squad  = liveTeams/{fplId}  (picks, bank, freeTransfers, gameweek ...)
//   points = livePoints/{fplId} (gwPoints, totalPoints, overallRank ...)
//  normal load  : 3 မိနစ်အတွင်း cache ရှိရင် Firestore 0 read
//  force refresh: 20 စက္ကန့်အတွင်း ထပ်နှိပ်ရင် cache ပြန်ပေး (spam ကာကွယ်)
//  Cache key (team / live / draft / home မျှဝေ): twf_shared_squad_v2_<id> · twf_shared_points_v2_<id>
// =========================================================================
const LIVE_FRESH_MS = 3 * 60 * 1000;
const LIVE_COOLDOWN_MS = 20 * 1000;
const lsRead = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
const lsWrite = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

async function getLiveSquadWithQuota(fplId, force = false) {
  if (!fplId) return null;
  const id = String(fplId);
  const kSquad = `twf_shared_squad_v2_${id}`;
  const kPts = `twf_shared_points_v2_${id}`;
  const kTime = `twf_live_quota_t_${id}`;

  const cachedSquad = lsRead(kSquad);
  const cachedPts = lsRead(kPts);
  const haveCache = !!(cachedSquad || cachedPts);
  const age = Date.now() - Number(localStorage.getItem(kTime) || 0);

  if (haveCache && ((!force && age < LIVE_FRESH_MS) || (force && age < LIVE_COOLDOWN_MS))) {
    return { squad: cachedSquad, points: cachedPts, fromCache: true };
  }
  if (!navigator.onLine) return haveCache ? { squad: cachedSquad, points: cachedPts, fromCache: true } : null;

  try {
    const read = force ? getDocFromServer : getDoc;
    const [sSnap, pSnap] = await Promise.all([
      read(doc(db, "liveTeams", id)),
      read(doc(db, "livePoints", id)),
    ]);
    const squad = sSnap.exists() ? sSnap.data() : cachedSquad;
    const points = pSnap.exists() ? pSnap.data() : cachedPts;
    if (squad) lsWrite(kSquad, squad);
    if (points) lsWrite(kPts, points);
    try { localStorage.setItem(kTime, String(Date.now())); } catch (_) {}
    return { squad, points, fromCache: false };
  } catch (e) {
    console.warn("getLiveSquadWithQuota failed:", e);
    return haveCache ? { squad: cachedSquad, points: cachedPts, fromCache: true } : null;
  }
}

// Global Storage for Modal & Master Data Cache
let allScoutPlayers = [];
let currentSquadPicks = [];
let rawTeamData = null;
let firebaseFixturesCache = null;
let currentFplId = null;

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

function getPlayerStatusBadge(p, master) {
  const status = String(p.status || master?.status || "a").toLowerCase();
  const chance = p.chanceOfPlaying !== undefined ? p.chanceOfPlaying : (master?.chanceOfPlaying !== undefined ? master.chanceOfPlaying : 100);
  const isSuspended = p.isSuspended || master?.isSuspended || status === "s";
  const isInjured = p.isInjured || master?.isInjured || status === "i";

  if (isSuspended) {
    return `<span class="status-tag bg-red-600 text-white border border-red-300">SUSP</span>`;
  }
  if (isInjured || chance === 0) {
    return `<span class="status-tag bg-red-600 text-white border border-red-300">INJ</span>`;
  }
  if (chance > 0 && chance < 100) {
    return `<span class="status-tag bg-yellow-400 text-black border border-yellow-600">${chance}%</span>`;
  }
  return "";
}

async function initGlobalFixturesAndScout(forceFresh = false) {
  const FIX_CACHE_KEY = "twf_fixtures_cache";
  const FIX_TIME_KEY = "twf_fixtures_cache_time";
  const SCOUT_CACHE_KEY = "twf_scout_players_cache";
  const SCOUT_TIME_KEY = "twf_scout_players_cache_time";
  const now = Date.now();

  const cachedFix = localStorage.getItem(FIX_CACHE_KEY);
  const cachedFixTime = localStorage.getItem(FIX_TIME_KEY);

  if (!forceFresh && cachedFix && cachedFixTime && (now - Number(cachedFixTime) < CACHE_DURATION)) {
    try {
      firebaseFixturesCache = JSON.parse(cachedFix);
    } catch (e) {
      console.warn("Corrupt fixtures cache:", e);
    }
  }

  if (!firebaseFixturesCache || firebaseFixturesCache.length === 0) {
    try {
      const snap = await getFixturesSnap();
      firebaseFixturesCache = [];
      snap.forEach(d => firebaseFixturesCache.push({ id: d.id, ...d.data() }));
      localStorage.setItem(FIX_CACHE_KEY, JSON.stringify(firebaseFixturesCache));
      localStorage.setItem(FIX_TIME_KEY, String(now));
    } catch (e) {
      console.warn("Error fetching Firestore fixtures:", e);
    }
  }

  const cachedScout = localStorage.getItem(SCOUT_CACHE_KEY);
  const cachedScoutTime = localStorage.getItem(SCOUT_TIME_KEY);

  if (!forceFresh && cachedScout && cachedScoutTime && (now - Number(cachedScoutTime) < CACHE_DURATION)) {
    try {
      allScoutPlayers = JSON.parse(cachedScout);
      return;
    } catch (e) {
      console.warn("Error parsing scout cache:", e);
    }
  }

  try {
    const snap = await getScoutSnap();
    allScoutPlayers = [];
    snap.forEach(d => allScoutPlayers.push({ id: d.id, ...d.data() }));
    localStorage.setItem(SCOUT_CACHE_KEY, JSON.stringify(allScoutPlayers));
    localStorage.setItem(SCOUT_TIME_KEY, String(now));
  } catch (err) {
    console.warn("Scout market load bypassed:", err);
  }
}

function getFirebaseTeamMatches(teamCode, targetGw) {
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
    const fdr = isHome ? (match.team_h_difficulty || calculateDynamicFdr(oppCode, true)) : (match.team_a_difficulty || calculateDynamicFdr(oppCode, false));

    return {
      gw: targetGw,
      opponent: oppCode,
      isHome: isHome,
      fdr: Number(fdr) || 3
    };
  });
}

function getCurrentGwMatches(p, currentGw) {
  const master = allScoutPlayers.find(sp => String(sp.playerId || sp.id) === String(p.playerId || p.id));
  const rawMatches = (master && master.nextMatches) ? master.nextMatches : (p.nextMatches || []);
  
  const playerTeam = p.team || master?.team || "";
  const pTeamCode = formatTeamShort(playerTeam);

  const fbMatches = getFirebaseTeamMatches(pTeamCode, currentGw);
  if (fbMatches.length > 0) {
    return fbMatches;
  }

  const matched = rawMatches.filter(m => Number(m.gw) === Number(currentGw));
  if (matched.length > 0) {
    return matched.map(m => {
      const opp = formatTeamShort(m.opponent);
      const isHome = m.isHome === true || m.is_home === true;
      const fdr = m.fdr || calculateDynamicFdr(opp, isHome);
      return { ...m, opponent: opp, isHome, fdr: Number(fdr) };
    });
  }

  return [];
}

function getPlayerUpcomingMatches(p, count = 3) {
  const master = allScoutPlayers.find(sp => String(sp.playerId || sp.id) === String(p.playerId || p.id));
  const currentGwNum = parseInt(localStorage.getItem("twf_current_gw") || "5", 10);
  const nextTargetGw = currentGwNum + 1;
  const playerTeam = p.team || master?.team || "";
  const pTeamCode = formatTeamShort(playerTeam);

  let upcomingMatches = [];

  for (let g = nextTargetGw; g < nextTargetGw + 8; g++) {
    const matches = getFirebaseTeamMatches(pTeamCode, g);
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
    if (upcomingMatches.length >= count) break;
  }

  return upcomingMatches.slice(0, count);
}

// 🔄 Refresh Button Handler (liveteamquota.js ဖြင့် ပြင်ဆင်ချိတ်ဆက်ခြင်း)
window.forceRefreshTeam = async function() {
  if (!currentFplId) return;

  const btn = document.getElementById("btn-refresh-team") || document.querySelector("button[onclick*='forceRefreshTeam']");
  const icon = document.getElementById("refresh-team-icon");

  if (btn) {
    btn.disabled = true;
    btn.style.setProperty("background-color", "#8c6dff", "important");
    btn.style.setProperty("color", "#14172b", "important");
    btn.style.setProperty("border-color", "#b3a1ff", "important");
    btn.style.setProperty("box-shadow", "0 0 12px rgba(140,109,255, 0.8)", "important");
  }
  if (icon) {
    icon.classList.add("animate-spin");
  }

  try {
    const res = await getLiveSquadWithQuota(currentFplId, true);
    if (res) {
      const squad = res.squad || (res.picks ? res : null);
      const points = res.points || res;

      if (squad) {
        rawTeamData = squad;
        if (rawTeamData.gameweek) {
          localStorage.setItem("twf_current_gw", String(rawTeamData.gameweek));
        }
        renderTeam(rawTeamData);
      }
      if (points) {
        updateHeaderPointsUI(points);
      }
    }
  } catch (err) {
    console.error("Refresh error:", err);
  } finally {
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.style.removeProperty("background-color");
        btn.style.removeProperty("color");
        btn.style.removeProperty("border-color");
        btn.style.removeProperty("box-shadow");
      }
      if (icon) {
        icon.classList.remove("animate-spin");
      }
    }, 400);
  }
};

function updateHeaderPointsUI(data) {
  if (!data) return;

  const currentGw = data.gameweek ?? "—";
  const gwLabel = document.getElementById("gw-label");
  if (gwLabel) gwLabel.textContent = "GW " + currentGw;

  // [object Object] မပြစေရန် primitive value စစ်ထုတ်ခြင်း
  const rawGwPts = (data.gwPoints && typeof data.gwPoints === "object") ? data.gwPoints?.gwPoints : (data.points ?? data.gwPoints ?? data.livePoints);
  const gwPtsEl = document.getElementById("gw-pts");
  if (gwPtsEl) gwPtsEl.textContent = rawGwPts ?? "—";
  
  const overallPtsEl = document.getElementById("overall-pts");
  if (overallPtsEl) overallPtsEl.textContent = data.totalPoints ?? data.overallPoints ?? "—";
  
  const overallRank = data.overallRank;
  const rankBoxEl = document.getElementById("overall-rank-box");
  if (rankBoxEl) {
    rankBoxEl.textContent = overallRank ? Number(overallRank).toLocaleString() : "——";
  }
  
  const hit = data.eventTransfersCost || data.transferCost || 0;
  const hitLabelEl = document.getElementById("hit-label");
  if (hitLabelEl) hitLabelEl.textContent = "Hit: -" + hit;
  
  const chip = data.activeChip;
  const chipBadgeEl = document.getElementById("chip-badge");
  if (chipBadgeEl) {
    chipBadgeEl.textContent = chip ? chip.toUpperCase() : "NO CHIP";
  }

  const avgPtsEl = document.getElementById("avg-pts");
  if (avgPtsEl) {
    avgPtsEl.textContent = data.averagePoints ?? data.gwAverage ?? "—";
  }
}

// 📡 Firebase User Authentication & Real-time Live Watchers
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.go("login"); return; }

  try {
    initPlayerDetailModalHtml();

    const userCacheKey = `twf_user_profile_${user.uid}`;
    let uData = null;
    const cachedUser = localStorage.getItem(userCacheKey);
    if (cachedUser) {
      try { uData = JSON.parse(cachedUser); } catch (_) {}
    }

    if (!uData) {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        uData = snap.data();
        localStorage.setItem(userCacheKey, JSON.stringify(uData));
      }
    }

    if (!uData) { window.go("login"); return; }

    currentFplId = String(uData.fplTeamId).trim();
    const teamNameEl = document.getElementById("team-name");
    if (teamNameEl) teamNameEl.textContent = uData.teamName || "My Team";

    const transferBtn = document.getElementById("btn-transfer-action") || document.querySelector("button[onclick*='transfers']");
    if (transferBtn) {
      transferBtn.innerHTML = `🔄 TRANSFER STRATEGY`;
    }

    await initGlobalFixturesAndScout(false);

    // liveteamquota.js မှ { squad, points } ခွဲယူဆွဲတင်ခြင်း
    const initialRes = await getLiveSquadWithQuota(currentFplId, false);
    if (initialRes) {
      const squad = initialRes.squad || (initialRes.picks ? initialRes : null);
      const points = initialRes.points || initialRes;

      if (squad) {
        rawTeamData = squad;
        if (rawTeamData.gameweek) {
          localStorage.setItem("twf_current_gw", String(rawTeamData.gameweek));
        }
        renderTeam(rawTeamData);
      }
      if (points) {
        updateHeaderPointsUI(points);
      }
    }

    // Realtime listener အစား cache-first polling:
    //   3 မိနစ်အတွင်း cache ရှိရင် Firestore 0 read၊ tab ဖျောက်ထားရင် မဖတ်ဘူး
    //   (onSnapshot 2 ခုက ဖွင့်တိုင်း liveTeams + livePoints ကို အပြည့်ဖတ်ပြီး update တိုင်း ထပ်ဖတ်လို့ quota ကုန်တာ)
    setInterval(async () => {
      if (document.hidden || !currentFplId) return;
      const r = await getLiveSquadWithQuota(currentFplId, false);
      if (!r || r.fromCache) return; // cache ကပဲ ပြန်ပေးရင် UI ထပ်မဆွဲ
      if (r.squad) {
        rawTeamData = r.squad;
        if (rawTeamData.gameweek) localStorage.setItem("twf_current_gw", String(rawTeamData.gameweek));
        renderTeam(rawTeamData);
      }
      if (r.points) updateHeaderPointsUI(r.points);
    }, 60 * 1000);

  } catch (err) {
    console.warn("Silent Auth/Team startup error:", err);
  }
});

// 🏆 Player Card Rendering
function playerCard(p, isCaptain = false, isVice = false, isFiveRow = false) {
  const master = allScoutPlayers.find(sp => String(sp.playerId || sp.id) === String(p.playerId || p.id));
  const mult = p.multiplier || 1;
  const displayPoints = (p.livePoints ?? p.points ?? 0) * (mult > 1 ? mult : 1);
  
  let cornerBadge = "";
  if (mult === 3) {
    cornerBadge = `<span class="captain-badge">3x</span>`;
  } else if (p.isCaptain || isCaptain) {
    cornerBadge = `<span class="captain-badge">C</span>`;
  } else if (p.isVice || isVice) {
    cornerBadge = `<span class="vice-badge">V</span>`;
  }

  const statusBadge = getPlayerStatusBadge(p, master);
  const borderHighlight = (isCaptain || p.isCaptain) ? 'border-b-2 border-b-[#b3a1ff]' : (isVice || p.isVice) ? 'border-b-2 border-b-[#C0C0C0]' : '';

  const currentGwNum = parseInt(localStorage.getItem("twf_current_gw") || "5", 10);
  const activeMatches = getCurrentGwMatches(p, currentGwNum);
  let fixtureBadgeHtml = "";

  if (!activeMatches || activeMatches.length === 0) {
    fixtureBadgeHtml = `
      <div class="player-fixture-box" style="background:#334155 !important;">
        <span style="color:#94a3b8 !important;">BLANK</span>
      </div>
    `;
  } else if (activeMatches.length === 1) {
    const m = activeMatches[0];
    const opp = formatTeamShort(m.opponent);
    const venue = (m.isHome || m.is_home) ? "(H)" : "(A)";
    const fdrVal = Number(m.fdr) || calculateDynamicFdr(opp, m.isHome);
    const bg = fdrColor(fdrVal);
    const textColor = fdrVal === 3 ? "#0b0d1a" : "#ffffff";

    fixtureBadgeHtml = `
      <div class="player-fixture-box" style="background:${bg} !important;">
        <span style="color:${textColor} !important;">${opp} ${venue}</span>
      </div>
    `;
  } else {
    fixtureBadgeHtml = `
      <div class="player-fixture-box flex items-center justify-center p-0">
        ${activeMatches.slice(0, 2).map((m, idx) => {
          const opp = formatTeamShort(m.opponent);
          const venue = (m.isHome || m.is_home) ? "H" : "A";
          const fdrVal = Number(m.fdr) || calculateDynamicFdr(opp, m.isHome);
          const bg = fdrColor(fdrVal);
          const textColor = fdrVal === 3 ? "#0b0d1a" : "#ffffff";
          const borderRight = idx === 0 ? 'border-r border-black/30' : '';
          return `
            <span class="flex-1 text-center truncate ${borderRight} text-[6.5px]" 
                  style="background:${bg}; color:${textColor}; line-height:12px; height:100%;">
              ${opp}(${venue})
            </span>
          `;
        }).join("")}
      </div>
    `;
  }

  const pIdSafe = String(p.playerId || p.id || "");
  const cardScaleClass = isFiveRow ? 'scale-90 sm:scale-100' : '';

  const pName = p.name || "?";
  const nameFontSize = pName.length > 9 ? "8.5px" : pName.length > 7 ? "9.5px" : "10px";

  return `
    <div onclick="window.openPlayerDetailModal('${pIdSafe}')" class="player-card ${cardScaleClass}">
      
      <div class="jersey-wrap ${borderHighlight}" style="width:48px; height:48px;">
        <img src="${jerseyPath(p)}"
             class="w-full h-full object-contain"
             onerror="this.outerHTML='<div class=\\'w-full h-full flex items-center justify-center text-lg\\'>👕</div>'"
             alt="${p.name}" />
        ${cornerBadge}
        ${statusBadge}
      </div>

      <div class="w-full flex flex-col rounded overflow-hidden shadow-md mt-0.5">
        <div class="player-name-box" style="background:#ffffff; padding:2px 2px;">
          <p style="font-size:${nameFontSize} !important; font-weight:600 !important; color:#0f172a !important; line-height:1.2 !important; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; letter-spacing:0;">
            ${pName}
          </p>
        </div>
        ${fixtureBadgeHtml}
        <div class="player-point-circle" style="background:#000000 !important; color:#ffffff !important; font-weight:800 !important; font-size:10px !important; line-height:14px !important;">
          ${displayPoints}
        </div>
      </div>

    </div>
  `;
}

function renderTeam(data) {
  if (!data) return;
  currentSquadPicks = data.picks || (Array.isArray(data) ? data : []);
  if (currentSquadPicks.length === 0) return;

  const { subs, gk, def, mid, fwd } = splitSquadByPosition(currentSquadPicks);

  const renderRow = (players) => {
    const isFive = players.length >= 5;
    return `
      <div class="pitch-row">
        ${players.map(p => playerCard(p, p.isCaptain, p.isVice, isFive)).join("")}
      </div>
    `;
  };

  const pitchRowsEl = document.getElementById("pitch-rows");
  if (pitchRowsEl) {
    pitchRowsEl.innerHTML = `
      <div class="pitch-container">
        ${renderRow(gk)}
        ${renderRow(def)}
        ${renderRow(mid)}
        ${renderRow(fwd)}
      </div>`;
  }

  const benchRowEl = document.getElementById("bench-row");
  if (benchRowEl) {
    benchRowEl.innerHTML = subs.map(p => {
      const posLabel = String(p.position || "").toUpperCase();
      return `
        <div class="flex flex-col items-center gap-1">
          <span class="text-[8px] font-black text-[#d9d0ff] uppercase opacity-75">${posLabel}</span>
          ${playerCard(p, p.isCaptain, p.isVice, false)}
        </div>
      `;
    }).join("");
  }
}

// 📊 PLAYER DETAIL MODAL
function initPlayerDetailModalHtml() {
  if (document.getElementById("myteam-player-modal")) return;

  const modalHtml = `
    <div id="myteam-player-modal" class="hidden fixed inset-0 bg-black/80 backdrop-blur-xs z-[99999] flex items-center justify-center p-4" onclick="if(event.target===this)window.closePlayerDetailModal()">
      <div class="w-full max-w-xs rounded-2xl p-4 flex flex-col max-h-[92vh] bg-[#14172b] border border-[#3a3f7a] shadow-2xl text-white relative">
        <button onclick="window.closePlayerDetailModal()" class="absolute top-3 right-3 text-gray-400 hover:text-white font-bold text-lg cursor-pointer">✕</button>
        
        <div class="text-center pb-2.5 border-b border-[#3a3f7a]/60">
          <h2 id="mt-name" class="text-base font-black tracking-wide text-white uppercase"></h2>
          <p id="mt-team" class="text-xs text-slate-300 font-semibold mt-0.5"></p>
          <div class="flex items-center justify-center gap-1.5 mt-1.5">
            <span id="mt-position" class="text-[10px] font-black px-2.5 py-0.5 rounded-full text-white"></span>
            <span id="mt-status-badge" class="hidden text-[9px] font-black px-2 py-0.5 rounded-full"></span>
          </div>
          <p id="mt-news-text" class="text-[9.5px] text-amber-300 font-semibold mt-1 px-2 hidden"></p>
        </div>

        <div class="grid grid-cols-4 gap-1.5 my-2.5 text-center">
          <div class="bg-black/30 rounded-lg p-1.5 border border-[#3a3f7a]/40">
            <span class="text-[8px] text-gray-400 block font-bold">Price</span>
            <span id="mt-price" class="text-xs font-black text-[#b3a1ff]">£0.0M</span>
          </div>
          <div class="bg-black/30 rounded-lg p-1.5 border border-[#3a3f7a]/40">
            <span class="text-[8px] text-gray-400 block font-bold">Owned</span>
            <span id="mt-ownership" class="text-xs font-black text-white">0%</span>
          </div>
          <div class="bg-black/30 rounded-lg p-1.5 border border-[#3a3f7a]/40">
            <span class="text-[8px] text-gray-400 block font-bold">TPts</span>
            <span id="mt-points" class="text-xs font-black text-amber-400">0</span>
          </div>
          <div class="bg-black/30 rounded-lg p-1.5 border border-[#3a3f7a]/40 flex flex-col items-center justify-center">
            <span class="text-[8px] text-gray-400 block font-bold">Form</span>
            <span id="mt-form" class="w-full"></span>
          </div>
        </div>

        <div class="text-center text-[10.5px] font-black text-[#b3a1ff] uppercase tracking-wider mb-1.5">Next 3 Matches</div>
        <div id="mt-fixtures" class="space-y-1 overflow-y-auto max-h-[140px] pr-1"></div>

        <button onclick="window.closePlayerDetailModal()" class="w-full mt-3 py-2 rounded-xl font-bold bg-[#2d3366] hover:bg-[#3a3f7a] text-white text-xs border border-[#3a3f7a] transition active:scale-95 cursor-pointer">Close</button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", modalHtml);
}

window.openPlayerDetailModal = (playerId) => {
  const p = currentSquadPicks.find(item => String(item.playerId || item.id) === String(playerId));
  if (!p) return;

  const master = allScoutPlayers.find(sp => String(sp.playerId || sp.id) === String(playerId));
  const pos = String(p.position || (master ? master.position : "")).toUpperCase().trim();
  const posBg = pos === "GK" ? "#1d4ed8" : pos === "DEF" ? "#dc2626" : pos === "MID" ? "#eab308" : "#16a34a";
  const posColor = pos === "MID" ? "#0b0d1a" : "#ffffff";

  document.getElementById("mt-name").textContent = p.fullName || p.name || master?.name || "—";
  document.getElementById("mt-team").textContent = p.team || master?.team || "—";

  const posEl = document.getElementById("mt-position");
  posEl.textContent = pos;
  posEl.style.backgroundColor = posBg;
  posEl.style.color = posColor;

  const status = String(p.status || master?.status || "a").toLowerCase();
  const chance = p.chanceOfPlaying !== undefined ? p.chanceOfPlaying : (master?.chanceOfPlaying !== undefined ? master.chanceOfPlaying : 100);
  const news = p.news || master?.news || "";
  const isSuspended = p.isSuspended || master?.isSuspended || status === "s";
  const isInjured = p.isInjured || master?.isInjured || status === "i";

  const statusBadgeEl = document.getElementById("mt-status-badge");
  const newsEl = document.getElementById("mt-news-text");

  if (isSuspended) {
    statusBadgeEl.textContent = "SUSPENDED";
    statusBadgeEl.className = "text-[9px] font-black px-2 py-0.5 rounded-full bg-red-600 text-white border border-red-400";
    statusBadgeEl.classList.remove("hidden");
  } else if (isInjured || chance === 0) {
    statusBadgeEl.textContent = "INJURED";
    statusBadgeEl.className = "text-[9px] font-black px-2 py-0.5 rounded-full bg-red-600 text-white border border-red-400";
    statusBadgeEl.classList.remove("hidden");
  } else if (chance > 0 && chance < 100) {
    statusBadgeEl.textContent = `${chance}% CHANCE`;
    statusBadgeEl.className = "text-[9px] font-black px-2 py-0.5 rounded-full bg-yellow-400 text-black border border-yellow-600";
    statusBadgeEl.classList.remove("hidden");
  } else {
    statusBadgeEl.classList.add("hidden");
  }

  if (news) {
    newsEl.textContent = news;
    newsEl.classList.remove("hidden");
  } else {
    newsEl.classList.add("hidden");
  }

  document.getElementById("mt-price").textContent = `£${parseFloat(p.price || master?.price || master?.currentPrice || 0).toFixed(1)}M`;
  document.getElementById("mt-ownership").textContent = `${p.ownership || master?.ownership || 0}%`;
  document.getElementById("mt-points").textContent = p.totalPoints || master?.totalPoints || 0;

  const formEl = document.getElementById("mt-form");
  if (formEl) {
    formEl.innerHTML = `
      <div class="flex flex-col items-center justify-center leading-tight">
        <span class="text-xs font-black text-sky-400">${p.form ?? master?.form ?? "0.0"}</span>
        <span class="text-[8px] font-black text-[#0b0d1a] bg-yellow-300 px-1 py-0.5 rounded mt-0.5">
          GW: ${p.livePoints ?? p.gwPoints ?? master?.gwPoints ?? 0}
        </span>
      </div>
    `;
  }

  const fixturesEl = document.getElementById("mt-fixtures");
  const matches = getPlayerUpcomingMatches(p, 3);

  if (matches.length === 0) {
    fixturesEl.innerHTML = `<p class="text-center text-xs py-3 text-white/50">Fixture ဇယားများ မရှိသေးပါ</p>`;
  } else {
    fixturesEl.innerHTML = matches.map(m => {
      if (m.isBlank) {
        return `
          <div class="flex items-center justify-between py-1.5 px-3 rounded-lg bg-black/30 border border-slate-700/50">
            <div class="flex items-center gap-2">
              <span class="text-[10px] font-black px-1.5 py-0.5 rounded bg-black/40 text-[#b3a1ff]">GW ${m.gw}</span>
              <span class="text-xs text-slate-400 font-semibold">BLANK GAMEWEEK</span>
            </div>
            <span class="text-[10px] font-black px-2 py-0.5 rounded text-slate-400 bg-slate-800">NO MATCH</span>
          </div>
        `;
      }

      const isHome = m.isHome === true || m.is_home === true;
      const venueBadge = isHome ? `<span class="text-[10px] font-black text-emerald-400 ml-1">(H)</span>` : `<span class="text-[10px] font-black text-amber-300 ml-1">(A)</span>`;
      return `
        <div class="flex items-center justify-between py-1.5 px-3 rounded-lg bg-black/30 border border-[#3a3f7a]/50">
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-black px-1.5 py-0.5 rounded bg-black/40 text-[#b3a1ff]">GW ${m.gw}</span>
            <span class="text-xs text-white font-semibold flex items-center">
              ${formatTeamShort(m.opponent)} ${venueBadge}
            </span>
          </div>
          <span class="text-[10px] font-black px-2 py-0.5 rounded text-white" style="background:${fdrColor(m.fdr)};">FDR ${m.fdr}</span>
        </div>
      `;
    }).join("");
  }

  const modal = document.getElementById("myteam-player-modal");
  if (modal) modal.classList.remove("hidden");
};

window.closePlayerDetailModal = () => {
  const modal = document.getElementById("myteam-player-modal");
  if (modal) modal.classList.add("hidden");
};
