// ============================================
// TW FM — Transfers & Squad Planner Controller
// Production Ready: Dynamic Gameweek & Multi-User Support
// Formation Fix: Resolves 0-11-0 Bug to Accurate Pitch Layout
// Bug Fix: Solved xG & ICT "undefined" and "0" binding issue across all modals
// Standards: UI Design Knowledge Pack (Sports UI & 8px Grid)
// ============================================

import { auth, db } from "../js/firebase-config.js";
import { onAuthStateChanged } from "./core/auth.js";
import { doc, getDoc, getDocs, collection, getDocFromServer } from "./core/fs.js";
import { calculateSellingPrice, getCachedFixturesAndScout, togglePriceMode, priceDisplayMode } from "../js/transfer-pricing.js";

// Global Transfers State
let allPlayersCache = [];
let firebaseFixturesCache = [];
let currentSquad = [];
let originalFplSquad = [];
let officialTeamBank = 0.0;
let originalTeamBank = 0.0;
let currentFplTeamId = null;

let currentGw = null; 
let activeChip = "NONE";
let officialFreeTransfers = 1;

let currentPriceMode = 'current';
let isTwMemberUser = false;

const TRANSFERS_TIME_KEY = "twf_transfers_quota_time_v2";

// Modal & Interaction States
let selectedSlotIndex = null;
let subCandidateIndex = null;
let targetSwapIndex = null;
let activeMarketSort = "form";

const FDR_COLORS = { 1: "#22c55e", 2: "#84cc16", 3: "#eab308", 4: "#f97316", 5: "#ef4444" };

const TEAM_SHORT_CODES = {
  "arsenal": "ARS", "aston villa": "AVL", "bournemouth": "BOU", "brentford": "BRE",
  "brighton": "BHA", "brighton & hove albion": "BHA", "chelsea": "CHE", 
  "coventry": "COV", "coventry city": "COV", "crystal palace": "CRY", 
  "everton": "EVE", "fulham": "FUL", "hull": "HUL", "hull city": "HUL",
  "ipswich": "IPS", "ipswich town": "IPS", "leeds": "LEE", "leeds united": "LEE",
  "liverpool": "LIV", "man city": "MCI", "manchester city": "MCI", 
  "man utd": "MUN", "manchester united": "MUN", "newcastle": "NEW", "newcastle united": "NEW", 
  "nottingham forest": "NFO", "nott'm forest": "NFO", 
  "tottenham": "TOT", "spurs": "TOT", "sunderland": "SUN"
};

const TEAM_ID_MAP = {
  1: "ARS", 2: "AVL", 3: "BOU", 4: "BRE", 5: "BHA",
  6: "CHE", 7: "COV", 8: "CRY", 9: "EVE", 10: "FUL",
  11: "HUL", 12: "IPS", 13: "LEE", 14: "LIV", 15: "MCI",
  16: "MUN", 17: "NEW", 18: "NFO", 19: "TOT", 20: "SUN"
};

const TEAM_DIFFICULTY_TIER = {
  "MCI": 5, "ARS": 5, "LIV": 5, "CHE": 4, "NEW": 4, "TOT": 4, "MUN": 4, "AVL": 4,
  "BHA": 3, "FUL": 3, "BOU": 3, "BRE": 3, "CRY": 3, "EVE": 3, "NFO": 3,
  "IPS": 2, "LEE": 2, "SUN": 2, "HUL": 2, "COV": 2
};

// 🌟 xG & ICT Helper: Firestore နှင့် API Property Name ကွဲလွဲမှုအားလုံးကို Safe Resolve ပြုလုပ်ခြင်း
function extractPlayerXg(p) {
  if (!p) return 0;
  const raw = p.xG ?? p.xg ?? p.expected_goals ?? p.xgi ?? 0;
  const val = parseFloat(raw);
  return isNaN(val) ? 0 : parseFloat(val.toFixed(2));
}

function extractPlayerIct(p) {
  if (!p) return 0;
  const raw = p.ict ?? p.ict_index ?? p.ictIndex ?? 0;
  const val = parseFloat(raw);
  return isNaN(val) ? 0 : parseFloat(val.toFixed(1));
}

// =========================================================================
// 🌟 LUXURY CUSTOM TOAST NOTIFICATION ENGINE
// =========================================================================
function showLuxuryAccessDeniedToast(msg = "Only TW Members have access to this feature.") {
  const existing = document.getElementById("tw-access-toast-overlay");
  if (existing) existing.remove();

  const toastOverlay = document.createElement("div");
  toastOverlay.id = "tw-access-toast-overlay";
  toastOverlay.style.cssText = `
    position: fixed;
    top: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(-20px);
    z-index: 999999;
    width: 90%;
    max-width: 360px;
    padding: 14px 18px;
    background: linear-gradient(135deg, rgba(20,23,43, 0.98), rgba(11,13,26, 0.98));
    border: 1.5px solid #8c6dff;
    border-radius: 20px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.8), 0 0 25px rgba(140,109,255, 0.35);
    display: flex;
    align-items: center;
    gap: 12px;
    backdrop-filter: blur(12px);
    opacity: 0;
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    pointer-events: none;
    user-select: none;
  `;

  toastOverlay.innerHTML = `
    <div style="width: 38px; height: 38px; border-radius: 12px; background: rgba(140,109,255, 0.15); border: 1px solid rgba(140,109,255, 0.4); display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; box-shadow: 0 4px 10px rgba(0,0,0,0.3);">
      🔒
    </div>
    <div style="flex: 1; text-align: left;">
      <h4 style="margin: 0; font-size: 11.5px; font-weight: 800; color: #b3a1ff; text-transform: uppercase; letter-spacing: 0.08em; font-family: sans-serif;">ACCESS DENIED</h4>
      <p style="margin: 2px 0 0; font-size: 11px; font-weight: 600; color: #E2E8F0; line-height: 1.35; font-family: sans-serif;">${msg}</p>
    </div>
  `;

  document.body.appendChild(toastOverlay);

  requestAnimationFrame(() => {
    toastOverlay.style.opacity = "1";
    toastOverlay.style.transform = "translateX(-50%) translateY(0)";
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      toastOverlay.style.opacity = "0";
      toastOverlay.style.transform = "translateX(-50%) translateY(-15px)";
      setTimeout(() => {
        toastOverlay.remove();
        resolve();
      }, 350);
    }, 1800);
  });
}

async function enforceTwMemberAccessOnly() {
  await showLuxuryAccessDeniedToast("Only TW Members have access to this feature.");
  if (typeof window.go === "function") {
    window.go("dashboard", true);
  } else {
    window.location.hash = "/dashboard";
  }
}

function checkTwMemberPermission() {
  if (!isTwMemberUser) {
    showLuxuryAccessDeniedToast("Only TW Members have access to this feature.");
    return false;
  }
  return true;
}

// =========================================================================
// ⏰ SCHEDULE QUOTA CONTROLLER
// =========================================================================
function getMyanmarDate(dateObj = new Date()) {
  const utc = dateObj.getTime() + (dateObj.getTimezoneOffset() * 60000);
  return new Date(utc + (6.5 * 3600000));
}

function checkTransfersSlotStatus() {
  const mmNow = getMyanmarDate(new Date());
  const day = mmNow.getDay();
  const currentH = mmNow.getHours();
  const savedTimeMs = localStorage.getItem(TRANSFERS_TIME_KEY);

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

    let isExpired = true;
    if (savedTimeMs) {
      const lastSavedMm = getMyanmarDate(new Date(Number(savedTimeMs)));
      isExpired = lastSavedMm.getTime() < currentWindowStartDate.getTime();
    }

    return {
      isExpired,
      alertText: `⏳ TWFM PLAYER UPDATE ကို (${dateFormatted} ရက် ${timeFormatted}) တွင် ရရှိပါမည်ခင်ဗျာ!`
    };
  }

  const baseH = currentH >= 12 ? 12 : 0;
  const currentWindowStartDate = new Date(mmNow);
  currentWindowStartDate.setHours(baseH, 0, 0, 0);

  let nextSlotName = currentH < 12 ? "AFTERNOON (နေ့လယ် ၁၂:၀၀ နာရီ)" : "MIDNIGHT (ည ၁၂:၀၀ နာရီ)";

  let isExpired = true;
  if (savedTimeMs) {
    const lastSavedMm = getMyanmarDate(new Date(Number(savedTimeMs)));
    isExpired = lastSavedMm.getTime() < currentWindowStartDate.getTime();
  }

  return {
    isExpired,
    alertText: `⏳ TWFM PLAYER UPDATE ကို ${nextSlotName} တွင် ရရှိပါမည်ခင်ဗျာ!`
  };
}

function showInAppToast(msg, isError = false) {
  let toast = document.getElementById("tw-quota-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "tw-quota-toast";
    toast.className = "fixed top-4 left-1/2 -translate-x-1/2 z-[99999] px-4 py-2.5 rounded-xl text-xs font-bold text-center transition-all duration-300 opacity-0 pointer-events-none shadow-2xl border max-w-[90%]";
    document.body.appendChild(toast);
  }

  toast.classList.remove("opacity-100");
  toast.classList.add("opacity-0");

  setTimeout(() => {
    toast.textContent = msg;
    toast.style.background = isError ? "linear-gradient(135deg, #7f1d1d, #450a0a)" : "linear-gradient(135deg, #1b1f3a, #14172b)";
    toast.style.color = isError ? "#fecaca" : "#b3a1ff";
    toast.style.borderColor = isError ? "#ef4444" : "#b3a1ff";
    toast.style.boxShadow = isError ? "0 8px 24px rgba(239, 68, 68, 0.7)" : "0 8px 20px rgba(179,161,255, 0.3)";

    toast.classList.remove("opacity-0");
    toast.classList.add("opacity-100");
  }, 50);

  clearTimeout(window.transfersToastTimeout);
  window.transfersToastTimeout = setTimeout(() => {
    toast.classList.remove("opacity-100");
    toast.classList.add("opacity-0");
  }, 3200);
}

function triggerInitialFakeRefreshUI() {
  const btn = document.getElementById("btn-refresh-transfers");
  const icon = document.getElementById("refresh-transfers-icon");

  if (icon) icon.classList.add("animate-spin");
  if (btn) {
    btn.style.setProperty("background-color", "#8c6dff", "important");
    btn.style.setProperty("color", "#14172b", "important");
    btn.style.setProperty("border-color", "#b3a1ff", "important");
  }

  showInAppToast("🔄 TW FM UPDATE...", false);

  setTimeout(() => {
    if (icon) icon.classList.remove("animate-spin");
    if (btn) {
      btn.style.removeProperty("background-color");
      btn.style.removeProperty("color");
      btn.style.removeProperty("border-color");
    }
  }, 3000);
}

window.forceRefreshTransfersData = async function() {
  if (!checkTwMemberPermission()) return;

  const btn = document.getElementById("btn-refresh-transfers");
  const icon = document.getElementById("refresh-transfers-icon");

  const slotStatus = checkTransfersSlotStatus();

  if (!slotStatus.isExpired) {
    showInAppToast(slotStatus.alertText, false);
    return;
  }

  if (icon) icon.classList.add("animate-spin");
  if (btn) {
    btn.disabled = true;
    btn.style.setProperty("background-color", "#8c6dff", "important");
    btn.style.setProperty("color", "#14172b", "important");
    btn.style.setProperty("border-color", "#b3a1ff", "important");
  }

  try {
    showInAppToast("🔄 ဒေတာအသစ် ရယူနေပါသည်...", false);

    const freshCache = await getCachedFixturesAndScout(db, collection, getDocs, formatTeamShort);
    if (freshCache.scoutPlayers && freshCache.scoutPlayers.length > 0) {
      allPlayersCache = freshCache.scoutPlayers.map(p => ({
        ...p,
        xg: extractPlayerXg(p),
        xG: extractPlayerXg(p),
        ict: extractPlayerIct(p)
      }));
      firebaseFixturesCache = freshCache.fixtures || [];
    }

    const isSuccess = await loadUserLiveSquad(true);

    if (isSuccess) {
      localStorage.setItem(TRANSFERS_TIME_KEY, String(Date.now()));
      showInAppToast("✅ ဒေတာအသစ် ရရှိပြီးပါပြီ!", false);
    } else {
      throw new Error("TRANSFERS_FETCH_FAILED");
    }

  } catch (err) {
    console.error("Transfers Quota Load Error:", err);
    showInAppToast("⚠️️ SERVER Maintain လုပ်နေပါသည်ခင်ဗျာ!", true);
  } finally {
    if (icon) icon.classList.remove("animate-spin");
    if (btn) {
      btn.disabled = false;
      btn.style.removeProperty("background-color");
      btn.style.removeProperty("color");
      btn.style.removeProperty("border-color");
    }
  }
};

// =========================================================================
// ⚽ DATA LOGIC & RENDERING
// =========================================================================
export function formatTeamShort(raw) {
  if (!raw) return "ARS";
  const clean = String(raw).trim().toLowerCase();
  return TEAM_SHORT_CODES[clean] || (raw.length > 4 ? raw.slice(0, 3).toUpperCase() : raw.toUpperCase());
}

function calculateDynamicFdr(opponentCode, isHome) {
  const baseTier = TEAM_DIFFICULTY_TIER[opponentCode] || 3;
  return isHome ? Math.max(2, baseTier - 1) : Math.min(5, baseTier);
}

function fdrColor(fdr) {
  return FDR_COLORS[fdr] || "#22c55e";
}

function normalizePosition(rawPos) {
  if (!rawPos) return null;
  const s = String(rawPos).toUpperCase().trim();
  if (s === "1" || s === "GKP" || s === "GK" || s === "GOALKEEPER") return "GK";
  if (s === "2" || s === "DEF" || s === "DEFENDER") return "DEF";
  if (s === "3" || s === "MID" || s === "MIDFIELDER") return "MID";
  if (s === "4" || s === "FWD" || s === "FORWARD" || s === "ATT") return "FWD";
  return null;
}

function getPlayerStatusBadge(p, master) {
  const status = String(p.status || master?.status || "a").toLowerCase();
  const chance = p.chanceOfPlaying !== undefined ? p.chanceOfPlaying : (master?.chanceOfPlaying !== undefined ? master.chanceOfPlaying : 100);
  const isSuspended = p.isSuspended || master?.isSuspended || status === "s";
  const isInjured = p.isInjured || master?.isInjured || status === "i";

  if (isSuspended) return `<span class="status-tag bg-red-600 text-white border border-red-300">SUSP</span>`;
  if (isInjured || chance === 0) return `<span class="status-tag bg-red-600 text-white border border-red-300">INJ</span>`;
  if (chance > 0 && chance < 100) return `<span class="status-tag bg-yellow-400 text-black border border-yellow-600">${chance}%</span>`;
  return "";
}

function getExactJerseyUrl(player) {
  if (!player || player.isSold) return "./public/jerseys/outfield/ars.png";
  const tCode = formatTeamShort(player?.team || player?.clubCode || player?.teamCode).toLowerCase();
  const isGk = normalizePosition(player?.position) === "GK";
  const subFolder = isGk ? "gk" : "outfield";
  return `./public/jerseys/${subFolder}/${tCode}.png`;
}

function renderJerseyHtml(player, customSize = "jersey-box") {
  const finalSrc = getExactJerseyUrl(player);
  return `
    <div class="${customSize}">
      <img src="${finalSrc}" 
           onerror="this.onerror=null; this.outerHTML='<div class=\\'text-2xl flex items-center justify-center\\'>👕</div>';" 
           alt="${player?.name || 'Jersey'}"/>
    </div>
  `;
}

window.showTwToast = function(title, msg, icon = "⚠️️") {
  const modal = document.getElementById("tw-toast-modal");
  if (!modal) { alert(`${title}: ${msg}`); return; }
  document.getElementById("tw-toast-title").textContent = title;
  document.getElementById("tw-toast-msg").textContent = msg;
  document.getElementById("tw-toast-icon").textContent = icon;
  modal.classList.remove("hidden");
  modal.classList.add("flex");
};

window.closeTwToast = function() {
  const modal = document.getElementById("tw-toast-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
};

// =========================================================================
// 🚀 AUTH & ENTRY GATE
// =========================================================================
async function setupTransfersGate(user) {
  if (!user) {
    if (typeof window.go === "function") window.go("login", true);
    else window.location.hash = "/login";
    return;
  }

  try {
    const userCacheKey = `twf_user_profile_${user.uid}`;
    let uData = null;
    const cachedUser = localStorage.getItem(userCacheKey);
    if (cachedUser) {
      try { uData = JSON.parse(cachedUser); } catch (_) {}
    }

    if (!uData) {
      const uSnap = await getDoc(doc(db, "users", user.uid));
      if (uSnap.exists()) {
        uData = uSnap.data();
        localStorage.setItem(userCacheKey, JSON.stringify(uData));
      }
    }

    const hasApproved = Boolean(uData?.isApproved === true || uData?.status === "approved" || uData?.status === "active");
    const hasTwApproved = Boolean(uData?.isTwMember === true || uData?.role === "tw_member" || uData?.role === "admin");
    isTwMemberUser = Boolean(hasApproved && hasTwApproved);

    if (!isTwMemberUser) {
      await enforceTwMemberAccessOnly();
      return;
    }

    const hashParts = window.location.hash.split("?");
    const queryParams = new URLSearchParams(hashParts[1] || "");
    const paramFplId = queryParams.get("fplId");

    if (paramFplId) {
      currentFplTeamId = String(paramFplId).trim();
    } else if (uData && uData.fplTeamId) {
      currentFplTeamId = String(uData.fplTeamId).trim();
    }

    triggerInitialFakeRefreshUI();

    const cacheData = await getCachedFixturesAndScout(db, collection, getDocs, formatTeamShort);
    firebaseFixturesCache = cacheData.fixtures || [];
    
    // 💡 allPlayersCache ထဲသို့ xG နှင့် ICT များကို sanitize ပြုလုပ်ပြီး ထည့်သွင်းခြင်း
    allPlayersCache = (cacheData.scoutPlayers || []).map(p => ({
      ...p,
      xg: extractPlayerXg(p),
      xG: extractPlayerXg(p),
      ict: extractPlayerIct(p)
    }));

    await loadUserLiveSquad(false);
    setupToggleListener();
  } catch (err) {
    console.warn("Transfers Gate Error:", err);
    await enforceTwMemberAccessOnly();
  }
}

function setupToggleListener() {
  const btn = document.getElementById("btn-toggle-price-mode");
  if (btn) {
    btn.onclick = (e) => {
      e.preventDefault();
      window.togglePriceMode();
    };
  }
}

function getUpcomingMatchesForTeam(teamStr, startGw, count = 3) {
  const tCode = formatTeamShort(teamStr);
  const tId = Object.keys(TEAM_ID_MAP).find(k => TEAM_ID_MAP[k] === tCode);
  if (!tId) return [];

  const tNum = Number(tId);
  const results = [];

  for (let g = startGw; g < startGw + 8; g++) {
    const match = firebaseFixturesCache.find(f => 
      Number(f.event) === g && (Number(f.team_h) === tNum || Number(f.team_a) === tNum)
    );
    if (match) {
      const isHome = Number(match.team_h) === tNum;
      const oppId = isHome ? match.team_a : match.team_h;
      const oppCode = TEAM_ID_MAP[oppId] || "TBD";
      const fdr = isHome 
        ? (match.team_h_difficulty || calculateDynamicFdr(oppCode, true)) 
        : (match.team_a_difficulty || calculateDynamicFdr(oppCode, false));

      results.push({ gw: g, opp: oppCode, isHome, fdr: Number(fdr) || 3 });
    } else {
      results.push({ gw: g, opp: "BLANK", isBlank: true, isHome: false, fdr: 0 });
    }
    if (results.length >= count) break;
  }
  return results.slice(0, count);
}

async function loadUserLiveSquad(forceFresh = false) {
  if (!currentFplTeamId) return false;

  const cacheKey = `twf_transfers_squad_${currentFplTeamId}`;
  const bankKey = `twf_transfers_bank_${currentFplTeamId}`;
  const origKey = `twf_transfers_orig_${currentFplTeamId}`;
  const origBankKey = `twf_transfers_orig_bank_${currentFplTeamId}`;
  const chipKey = `twf_transfers_chip_${currentFplTeamId}`;
  const ftKey = `twf_transfers_ft_${currentFplTeamId}`;

  const savedSquad = localStorage.getItem(cacheKey);
  const savedBank = localStorage.getItem(bankKey);
  const savedOrig = localStorage.getItem(origKey);
  const savedOrigBank = localStorage.getItem(origBankKey);
  const savedChip = localStorage.getItem(chipKey);
  const savedFt = localStorage.getItem(ftKey);

  if (savedChip) activeChip = savedChip;
  if (savedFt) officialFreeTransfers = parseInt(savedFt, 10) || 1;

  if (!forceFresh && savedSquad && savedBank !== null) {
    try {
      const parsedSquad = JSON.parse(savedSquad);
      const starDefs = parsedSquad.filter(p => Number(p.multiplier) > 0 && normalizePosition(p.position) === "DEF");
      if (Array.isArray(parsedSquad) && parsedSquad.length === 15 && starDefs.length >= 3) {
        currentSquad = parsedSquad.map(p => {
          const master = allPlayersCache.find(x => String(x.playerId || x.id) === String(p.playerId || p.id));
          return {
            ...p,
            xg: extractPlayerXg(p) || extractPlayerXg(master),
            xG: extractPlayerXg(p) || extractPlayerXg(master),
            ict: extractPlayerIct(p) || extractPlayerIct(master)
          };
        });
        officialTeamBank = parseFloat(savedBank);
        if (savedOrig) originalFplSquad = JSON.parse(savedOrig);
        if (savedOrigBank) originalTeamBank = parseFloat(savedOrigBank);

        renderPitch();
        updateStrategyMetrics();
        return true;
      }
    } catch (_) {}
  }

  const sharedSquadCacheKey = `twf_shared_squad_v2_${currentFplTeamId}`;
  const sharedPointsCacheKey = `twf_shared_points_v2_${currentFplTeamId}`;

  const savedSharedSquad = localStorage.getItem(sharedSquadCacheKey) || localStorage.getItem(`twf_shared_squad_${currentFplTeamId}`) || localStorage.getItem(`twf_team_data_${currentFplTeamId}`);
  const savedSharedPoints = localStorage.getItem(sharedPointsCacheKey);

  if (!forceFresh && savedSharedSquad) {
    try {
      const tData = JSON.parse(savedSharedSquad);
      let ptData = {};
      if (savedSharedPoints) {
        try { ptData = JSON.parse(savedSharedPoints); } catch (_) {}
      }
      parseRawDataToSquad(tData, ptData);
      return true;
    } catch (_) {}
  }

  if (forceFresh || (!savedSquad && !savedSharedSquad)) {
    try {
      const [teamSnap, ptSnap] = await Promise.all([
        getDocFromServer(doc(db, "liveTeams", currentFplTeamId)),
        getDocFromServer(doc(db, "livePoints", currentFplTeamId))
      ]);

      if (teamSnap.exists()) {
        const tData = teamSnap.data();
        const ptData = ptSnap.exists() ? ptSnap.data() : {};
        localStorage.setItem(sharedSquadCacheKey, JSON.stringify(tData));
        localStorage.setItem(sharedPointsCacheKey, JSON.stringify(ptData));
        parseRawDataToSquad(tData, ptData);
        return true;
      }
    } catch (err) {
      console.warn("Live squad server load error:", err);
    }
  }

  return false;
}

// 🛡️ Data Normalizer: xG နှင့် ICT တန်ဖိုးများကို တိကျစွာ ထည့်သွင်းခြင်း
function parseRawDataToSquad(data, pointsData = {}) {
  const origKey = `twf_transfers_orig_${currentFplTeamId}`;
  const origBankKey = `twf_transfers_orig_bank_${currentFplTeamId}`;
  const ftKey = `twf_transfers_ft_${currentFplTeamId}`;

  const incomingGw = Number(data.gameweek || pointsData.gameweek || localStorage.getItem("twf_current_gw"));
  currentGw = (!isNaN(incomingGw) && incomingGw > 0) ? incomingGw : 1;
  localStorage.setItem("twf_current_gw", String(currentGw));
  
  const rawBank = data.bank !== undefined ? data.bank : (pointsData.bank !== undefined ? pointsData.bank : 0.0);
  officialTeamBank = parseFloat(rawBank) || 0.0;
  originalTeamBank = officialTeamBank;
  
  officialFreeTransfers = Number(data.freeTransfers ?? data.transfersAvailable ?? pointsData.freeTransfers ?? 1);

  const rawPicks = data.picks || [];

  currentSquad = rawPicks.map((p, idx) => {
    const pId = String(p.playerId || p.element || p.id || idx);
    const master = allPlayersCache.find(x => String(x.playerId || x.id) === pId);

    let pos = normalizePosition(p.position) || normalizePosition(master?.position);
    if (!pos && (p.element_type || master?.element_type)) {
      const et = String(p.element_type || master?.element_type);
      if (et === "1") pos = "GK";
      else if (et === "2") pos = "DEF";
      else if (et === "3") pos = "MID";
      else if (et === "4") pos = "FWD";
    }
    
    if (!pos) {
      if (idx === 0 || idx === 11) pos = "GK";
      else if (idx >= 1 && idx <= 4) pos = "DEF";
      else if (idx >= 5 && idx <= 8) pos = "MID";
      else if (idx >= 9 && idx <= 10) pos = "FWD";
      else if (idx === 12) pos = "DEF";
      else if (idx === 13) pos = "MID";
      else pos = "FWD";
    }

    const curPrice = parseFloat(p.currentPrice !== undefined ? p.currentPrice : (master?.currentPrice || p.price || 0.0));
    const purPrice = parseFloat(p.purchasePrice !== undefined ? p.purchasePrice : curPrice);
    const selPrice = parseFloat(p.sellingPrice !== undefined ? p.sellingPrice : calculateSellingPrice(purPrice, curPrice));

    let effectiveMultiplier = (idx < 11) ? 1 : 0;
    if (p.multiplier !== undefined && p.multiplier !== null && !isNaN(Number(p.multiplier))) {
      effectiveMultiplier = Number(p.multiplier);
    }

    // 🌟 xG နှင့် ICT ကို master player ထံမှ တိကျစွာ bind ပြုလုပ်သည်
    const resolvedXg = extractPlayerXg(p) || extractPlayerXg(master);
    const resolvedIct = extractPlayerIct(p) || extractPlayerIct(master);

    return {
      id: pId,
      playerId: pId,
      name: p.name || master?.name || p.web_name || (p.fullName ? p.fullName.split(" ").pop() : "Player"),
      fullName: p.fullName || master?.fullName || p.name || "Premier Player",
      position: pos,
      team: p.team || p.teamCode || master?.team || "ARS",
      teamCode: formatTeamShort(p.teamCode || p.team || master?.teamCode || "ARS"),
      currentPrice: curPrice,
      purchasePrice: purPrice,
      sellingPrice: selPrice,
      price: curPrice,
      ownership: master?.ownership || 0,
      form: master?.form || 0,
      totalPoints: master?.totalPoints || 0,
      gwPoints: master?.gwPoints || p.livePoints || 0,
      
      // 🌟 FIXED: xg & ict properties
      xg: resolvedXg,
      xG: resolvedXg,
      ict: resolvedIct,

      status: p.status || master?.status || "a",
      chanceOfPlaying: p.chanceOfPlaying ?? master?.chanceOfPlaying ?? 100,
      isSuspended: Boolean(p.isSuspended || master?.isSuspended),
      isInjured: Boolean(p.isInjured || master?.isInjured),
      multiplier: effectiveMultiplier,
      isCaptain: Boolean(p.isCaptain || p.is_captain),
      isVice: Boolean(p.isVice || p.is_vice_captain),
      isSold: false
    };
  });

  const startersCount = currentSquad.filter(p => Number(p.multiplier) > 0).length;
  if (startersCount !== 11 && currentSquad.length === 15) {
    currentSquad.forEach((p, i) => { p.multiplier = i < 11 ? 1 : 0; });
  }

  originalFplSquad = JSON.parse(JSON.stringify(currentSquad));
  saveLocalState();
  localStorage.setItem(origKey, JSON.stringify(originalFplSquad));
  localStorage.setItem(origBankKey, String(originalTeamBank));
  localStorage.setItem(ftKey, String(officialFreeTransfers));

  const gwBadge = document.getElementById("gw-badge");
  if (gwBadge) gwBadge.textContent = `GW ${currentGw + 1}`;

  injectChipsControlUI();
  renderPitch();
  updateStrategyMetrics();
}

function saveLocalState() {
  if (currentFplTeamId) {
    localStorage.setItem(`twf_transfers_squad_${currentFplTeamId}`, JSON.stringify(currentSquad));
    localStorage.setItem(`twf_transfers_bank_${currentFplTeamId}`, String(officialTeamBank));
    localStorage.setItem(`twf_transfers_chip_${currentFplTeamId}`, activeChip);
  }
}

window.saveCurrentStrategyState = function() {
  if (!checkTwMemberPermission()) return;
  saveLocalState();
  window.showTwToast("သိမ်းဆည်းပြီးပါပြီ", "လက်ရှိ ပြင်ဆင်ထားသော Transfers Strategy ကို သိမ်းဆည်းပြီးပါပြီ!", "💾");
};

window.resetTransfersToFpl = function() {
  if (!checkTwMemberPermission()) return;

  if (originalFplSquad && originalFplSquad.length > 0) {
    currentSquad = JSON.parse(JSON.stringify(originalFplSquad));
    officialTeamBank = originalTeamBank;
    activeChip = "NONE";
    
    saveLocalState();
    injectChipsControlUI();
    renderPitch();
    updateStrategyMetrics();

    window.showTwToast("Reset အောင်မြင်သည်", "စမ်းသပ်ထားသမျှကို ဖျက်၍ မူလအသင်းလူစာရင်းအတိုင်း ပြန်လည်ထားရှိပြီးပါပြီ!", "↩️");
    return;
  }

  const sharedSquadCacheKey = `twf_shared_squad_v2_${currentFplTeamId}`;
  const savedSharedSquad = localStorage.getItem(sharedSquadCacheKey) || localStorage.getItem(`twf_shared_squad_${currentFplTeamId}`) || localStorage.getItem(`twf_team_data_${currentFplTeamId}`);
  
  if (savedSharedSquad) {
    try {
      const tData = JSON.parse(savedSharedSquad);
      parseRawDataToSquad(tData);
      window.showTwToast("Reset အောင်မြင်သည်", "မူလလူစာရင်းအတိုင်း ပြန်လည်ထားရှိပြီးပါပြီ!", "↩️");
      return;
    } catch (_) {}
  }

  window.showTwToast("သတိပေးချက်", "မူလလူစာရင်း မရှိသေးပါသဖြင့် ညာဘက်ထောင့် Refresh ကို တစ်ကြိမ်နှိပ်ပေးပါခင်ဗျာ။", "ℹ️");
};

window.togglePriceMode = function() {
  togglePriceMode((newMode) => {
    currentPriceMode = newMode;
    renderPitch();
    updateStrategyMetrics();
  });
};

function injectChipsControlUI() {
  const chipContainer = document.getElementById("strategy-chips-bar");
  if (!chipContainer) return;

  const chips = [
    { id: "WC", label: "Wildcard" },
    { id: "FH", label: "Free Hit" },
    { id: "TC", label: "Triple (C)" },
    { id: "BB", label: "Bench Boost" }
  ];

  chipContainer.innerHTML = chips.map(c => {
    const isActive = activeChip === c.id;
    const bgClass = isActive ? "bg-[#8c6dff] text-[#14172b] font-black" : "bg-[#14172b] text-gray-300 border border-[#3a3f7a]/40";
    return `
      <button onclick="window.toggleStrategyChip('${c.id}')" class="py-1.5 rounded-lg text-[9.5px] uppercase tracking-wider transition-all active:scale-95 shadow-xs cursor-pointer ${bgClass}">
        ${isActive ? '✓ ' : ''}${c.label}
      </button>
    `;
  }).join("");
}

window.toggleStrategyChip = function(chipId) {
  if (!checkTwMemberPermission()) return;

  if (activeChip === chipId) {
    activeChip = "NONE";
    showTwToast("Chip ပယ်ဖျက်သည်", `${chipId} အား ပယ်ဖျက်ပြီးပါပြီ။`, "ℹ️");
  } else {
    activeChip = chipId;

    if (chipId === "WC" || chipId === "FH") {
      executeBlank442Squad();
      showTwToast(`${chipId} Active`, "Blank 4-4-2 အဖြစ် ကစားသမားများ ရွေးချယ်ရန် နေရာဖယ်ရှားပေးထားပါသည်!", "🪄");
    } else if (chipId === "TC") {
      showTwToast("Triple Captain", "လက်ရှိ Captain ရမှတ်ကို ၃ ဆ အဖြစ် Balance နှင့် တွက်ချက်ထားပါမည်!", "⚡");
    } else if (chipId === "BB") {
      showTwToast("Bench Boost", "Bench ကစားသမား ၄ ဦးလုံး အမှတ်ရမည့် Lineup Balance ချိတ်ဆက်ထားပါသည်!", "🚀");
    }
  }

  saveLocalState();
  injectChipsControlUI();
  renderPitch();
  updateStrategyMetrics();
};

function executeBlank442Squad() {
  let refundBank = officialTeamBank;
  currentSquad.forEach(p => {
    if (!p.isSold) refundBank += parseFloat(p.sellingPrice || p.price || 0);
  });
  officialTeamBank = parseFloat(refundBank.toFixed(1));

  const standard442Config = [
    { pos: "GK", count: 1, starter: true },
    { pos: "DEF", count: 4, starter: true },
    { pos: "MID", count: 4, starter: true },
    { pos: "FWD", count: 2, starter: true },
    { pos: "GK", count: 1, starter: false },
    { pos: "DEF", count: 1, starter: false },
    { pos: "MID", count: 1, starter: false },
    { pos: "FWD", count: 1, starter: false }
  ];

  let newSquad = [];
  let slotId = 1;
  standard442Config.forEach(cfg => {
    for (let i = 0; i < cfg.count; i++) {
      newSquad.push({
        id: `slot_${slotId}`,
        playerId: `slot_${slotId}`,
        name: `Blank ${cfg.pos}`,
        position: cfg.pos,
        team: "ARS",
        teamCode: "ARS",
        currentPrice: 0.0,
        purchasePrice: 0.0,
        sellingPrice: 0.0,
        price: 0.0,
        ownership: 0,
        form: 0,
        totalPoints: 0,
        gwPoints: 0,
        xg: 0,
        xG: 0,
        ict: 0,
        status: "a",
        multiplier: cfg.starter ? 1 : 0,
        isCaptain: slotId === 6,
        isVice: slotId === 10,
        isSold: true
      });
      slotId++;
    }
  });

  currentSquad = newSquad;
}

// 🌟 PITCH & BENCH RENDERING
function renderPitch() {
  const starters = currentSquad.filter(p => Number(p.multiplier) > 0);
  const subs = currentSquad.filter(p => Number(p.multiplier) === 0);

  const gk = starters.filter(p => normalizePosition(p.position) === "GK");
  const def = starters.filter(p => normalizePosition(p.position) === "DEF");
  const mid = starters.filter(p => normalizePosition(p.position) === "MID");
  const fwd = starters.filter(p => normalizePosition(p.position) === "FWD");

  const formationBadge = document.getElementById("active-formation-badge");
  if (formationBadge) {
    formationBadge.textContent = `${def.length}-${mid.length}-${fwd.length}`;
  }

  const renderRow = (arr, isMidRow = false) => {
    if (!arr || arr.length === 0) return "";
    return `
      <div class="flex justify-around items-center w-full px-1 ${isMidRow ? 'gap-0.5' : ''}" style="min-height: 68px;">
        ${arr.map(p => renderPlayerCard(p, false, isMidRow && arr.length >= 5)).join("")}
      </div>
    `;
  };

  const startersEl = document.getElementById("pitch-starters");
  if (startersEl) {
    startersEl.innerHTML = `
      <div class="flex flex-col justify-around h-full w-full py-1" style="min-height: 380px;">
        ${renderRow(gk)}
        ${renderRow(def)}
        ${renderRow(mid, true)}
        ${renderRow(fwd)}
      </div>
    `;
  }

  const benchHeaderLabel = document.querySelector("#pitch-bench-header, .bench-title, #bench-header");
  if (benchHeaderLabel) {
    benchHeaderLabel.textContent = "BENCH";
    benchHeaderLabel.className = "text-[10px] font-medium tracking-widest text-white/70 uppercase text-center block w-full py-1";
  }

  const benchEl = document.getElementById("pitch-bench");
  if (benchEl) {
    let benchGk = subs.find(p => normalizePosition(p.position) === "GK");
    let benchOutfield = subs.filter(p => normalizePosition(p.position) !== "GK");

    if (!benchGk && subs.length > 0) {
      benchGk = subs[0];
      benchOutfield = subs.slice(1);
    }

    let benchHtml = "";
    if (benchGk) {
      benchHtml += renderPlayerCard(benchGk, true, false, "GK");
    }
    benchOutfield.forEach((p, idx) => {
      benchHtml += renderPlayerCard(p, true, false, `B${idx + 1}`);
    });
    benchEl.innerHTML = benchHtml;
  }
}

function renderPlayerCard(p, isBench = false, isFiveRow = false, benchLabel = null) {
  const pIndex = currentSquad.findIndex(x => String(x.id) === String(p.id));

  if (p.isSold) {
    return `
      <div onclick="window.openMarketModal(${pIndex})" class="player-card cursor-pointer">
        <div class="w-13 h-16 rounded-xl border-2 border-dashed border-[#b3a1ff] bg-black/60 flex flex-col items-center justify-center shadow-lg active:scale-95 transition">
          <span class="text-base text-[#b3a1ff] animate-pulse">➕</span>
          <span class="text-[7.5px] font-black text-amber-300 uppercase mt-0.5">${p.position}</span>
          <span class="text-[6.5px] text-gray-400 font-bold">BUY</span>
        </div>
      </div>
    `;
  }

  let cornerBadge = "";
  if (p.isCaptain) {
    cornerBadge = activeChip === "TC" 
      ? `<span class="captain-badge bg-gradient-to-r from-amber-400 to-yellow-500 text-black border-white font-black">3C</span>`
      : `<span class="captain-badge">C</span>`;
  } else if (p.isVice) {
    cornerBadge = `<span class="vice-badge">V</span>`;
  }

  const isOriginal = originalFplSquad.some(orig => String(orig.playerId) === String(p.playerId));
  let transferMarkingHtml = "";
  if (!isOriginal) {
    transferMarkingHtml = `<span class="absolute -top-1 -right-1 z-30 bg-emerald-500 text-white text-[7.5px] font-black px-1 rounded-full shadow-xs border border-white">IN</span>`;
  }

  const master = allPlayersCache.find(x => String(x.playerId || x.id) === String(p.playerId || p.id));
  const statusBadge = getPlayerStatusBadge(p, master);

  const nextGw = (currentGw || 1) + 1;
  const upcoming = getUpcomingMatchesForTeam(p.team, nextGw, 1);
  const match = upcoming[0];
  let fixtureBadgeHtml = `<div class="p-fixture-bar" style="background:#334155; color:#94a3b8;">BLANK</div>`;

  if (match && !match.isBlank) {
    const fdrBg = fdrColor(match.fdr);
    const venue = match.isHome ? "(H)" : "(A)";
    const textColor = match.fdr === 3 ? "#0b0d1a" : "#ffffff";
    fixtureBadgeHtml = `
      <div class="p-fixture-bar" style="background:${fdrBg}; color:${textColor};">
        ${match.opp} ${venue}
      </div>
    `;
  }

  const isSubTarget = subCandidateIndex === pIndex;
  const subCandidateClass = isSubTarget ? 'sub-candidate border-2 border-amber-400 rounded-xl animate-pulse' : '';
  const scaleStyle = isFiveRow ? 'transform: scale(0.92);' : '';

  const isCurrentMode = (currentPriceMode === 'current');
  const displayedPrice = isCurrentMode
    ? parseFloat(p.currentPrice !== undefined ? p.currentPrice : (p.price || 0.0)).toFixed(1)
    : parseFloat(p.sellingPrice !== undefined ? p.sellingPrice : (p.price || 0.0)).toFixed(1);

  const priceTagColor = isCurrentMode ? 'text-white' : 'text-red-400';
  const benchBadgeHtml = benchLabel 
    ? `<span class="absolute -top-4 left-1/2 -translate-x-1/2 z-20 font-black text-[9px] tracking-wide text-[#b3a1ff] drop-shadow-sm select-none">${benchLabel}</span>` 
    : '';

  return `
    <div onclick="window.handleSlotInteraction(${pIndex})" class="player-card ${subCandidateClass} relative cursor-pointer" style="${scaleStyle}">
      ${transferMarkingHtml}
      ${benchBadgeHtml}
      <div class="jersey-box relative">
        <img src="${getExactJerseyUrl(p)}"
             onerror="this.onerror=null; this.outerHTML='<div class=\\'text-2xl\\'>👕</div>';" 
             alt="${p.name}" />
        ${cornerBadge}
        ${statusBadge}
      </div>

      <div class="info-wrap">
        <div class="p-name-bar">${p.name || "?"}</div>
        ${fixtureBadgeHtml}
        <div class="p-price-bar ${priceTagColor} text-xs font-black">£${displayedPrice}m</div>
      </div>
    </div>
  `;
}

function updateStrategyMetrics() {
  let totalSquadVal = 0;
  let startersOwnership = 0;
  let startersCount = 0;

  const isCurrentMode = (currentPriceMode === 'current');

  currentSquad.forEach(p => {
    if (!p.isSold) {
      const price = isCurrentMode
        ? parseFloat(p.currentPrice !== undefined ? p.currentPrice : (p.price || 0))
        : parseFloat(p.sellingPrice !== undefined ? p.sellingPrice : (p.price || 0));

      totalSquadVal += price;
      if (Number(p.multiplier) > 0 || activeChip === "BB") {
        startersOwnership += parseFloat(p.ownership || 0);
        startersCount++;
      }
    }
  });

  let transfersMade = 0;
  if (originalFplSquad && originalFplSquad.length > 0) {
    currentSquad.forEach(p => {
      if (!p.isSold && !originalFplSquad.some(orig => String(orig.playerId) === String(p.playerId))) {
        transfersMade++;
      }
    });
  }

  let hitCost = 0;
  let ftDisplay = officialFreeTransfers;

  if (activeChip === "WC" || activeChip === "FH") {
    hitCost = 0;
    ftDisplay = "Unlimited";
  } else {
    const extraTransfers = Math.max(0, transfersMade - officialFreeTransfers);
    hitCost = extraTransfers * 4;
    ftDisplay = Math.max(0, officialFreeTransfers - transfersMade);
  }

  const tfMadeEl = document.getElementById("transfers-made-count");
  const ftCountEl = document.getElementById("free-transfers-count");
  const costBadgeEl = document.getElementById("transfer-cost-badge");

  if (tfMadeEl) tfMadeEl.textContent = transfersMade;
  if (ftCountEl) ftCountEl.textContent = ftDisplay;

  if (costBadgeEl) {
    if (hitCost > 0) {
      costBadgeEl.textContent = `-${hitCost} pts`;
      costBadgeEl.classList.remove("hidden");
    } else {
      costBadgeEl.classList.add("hidden");
    }
  }

  const bankLabel = document.getElementById("budget-bank-label");
  if (bankLabel) bankLabel.textContent = `£${officialTeamBank.toFixed(1)}m`;

  const netPnL = parseFloat((totalSquadVal + officialTeamBank - 100.0).toFixed(1));
  const pnlTag = netPnL >= 0 ? `(+£${netPnL}m ▲)` : `(-£${Math.abs(netPnL)}m ▼)`;
  
  const costEl = document.getElementById("budget-total-cost");
  if (costEl) {
    costEl.innerHTML = `£${totalSquadVal.toFixed(1)}m / £100.0m <span class="text-emerald-400 font-bold ml-1">${pnlTag}</span>`;
  }

  const cap = currentSquad.find(p => p.isCaptain);
  const capLabel = document.getElementById("captain-risk-text");
  const capNameEl = document.getElementById("active-cap-name");
  if (cap && !cap.isSold) {
    if (capNameEl) capNameEl.textContent = `${cap.name} (${cap.ownership}%)`;
    const isUltraSafe = cap.ownership >= 40 || cap.name.toLowerCase().includes("haaland") || cap.name.toLowerCase().includes("salah");
    if (capLabel) {
      if (isUltraSafe) {
        capLabel.innerHTML = `🟢 <span class="text-emerald-400 font-black">Safe Template (C)</span>`;
      } else {
        capLabel.innerHTML = `⚠️ <span class="text-amber-400 font-black">Differential Move (C)</span>`;
      }
    }
  } else {
    if (capNameEl) capNameEl.textContent = "ရွေးချယ်မထားပါ";
    if (capLabel) capLabel.innerHTML = `🔴 <span class="text-red-400 font-black">No Active (C)</span>`;
  }

  const avgStartersOwn = startersCount > 0 ? Math.round(startersOwnership / startersCount) : 0;
  const shieldEl = document.getElementById("team-shield-badge");
  if (shieldEl) {
    if (avgStartersOwn >= 35) {
      shieldEl.textContent = `🛡️ SAFE (${avgStartersOwn}%)`;
      shieldEl.className = "px-1.5 py-0.5 rounded-lg text-[10.5px] font-black tracking-wider uppercase bg-[#2d3366] text-emerald-300 border border-emerald-500/50 truncate w-full text-center";
    } else if (avgStartersOwn >= 20) {
      shieldEl.textContent = `⚖ BALANCED (${avgStartersOwn}%)`;
      shieldEl.className = "px-1.5 py-0.5 rounded-lg text-[10.5px] font-black tracking-wider uppercase bg-[#713f12] text-yellow-300 border border-yellow-600/50 truncate w-full text-center";
    } else {
      shieldEl.textContent = `⚡ DIFF (${avgStartersOwn}%)`;
      shieldEl.className = "px-1.5 py-0.5 rounded-lg text-[10.5px] font-black tracking-wider uppercase bg-[#7f1d1d] text-red-300 border border-red-500/50 truncate w-full text-center";
    }
  }
}

window.handleSlotInteraction = function(index) {
  if (subCandidateIndex !== null) {
    executeSubstitution(subCandidateIndex, index);
    return;
  }
  window.openPlayerAction(index);
};

// 🌟 Player Action Modal (Fixed: Real xG & ICT Display)
window.openPlayerAction = function(index) {
  selectedSlotIndex = index;
  const p = currentSquad[index];
  const master = allPlayersCache.find(x => String(x.playerId || x.id) === String(p.playerId || p.id));

  // 💡 Safe xG & ICT Extraction
  const realXg = extractPlayerXg(p) || extractPlayerXg(master);
  const realIct = extractPlayerIct(p) || extractPlayerIct(master);

  document.getElementById("pa-jersey-wrap").innerHTML = renderJerseyHtml(p, "w-9 h-9");
  document.getElementById("pa-name").textContent = p.name;
  document.getElementById("pa-team-pos").textContent = `${formatTeamShort(p.team)} • ${p.position}`;
  
  document.getElementById("pa-price").innerHTML = `
    <span class="text-white font-bold">CP: £${parseFloat(p.currentPrice || p.price).toFixed(1)}m</span><br/>
    <span class="text-red-400 font-bold text-[9px]">SP: £${parseFloat(p.sellingPrice || p.price).toFixed(1)}m</span>
  `;
  
  document.getElementById("pa-total-pts").textContent = p.totalPoints || master?.totalPoints || 0;
  document.getElementById("pa-gw-pts").textContent = p.gwPoints || master?.gwPoints || 0;
  document.getElementById("pa-own").textContent = `${p.ownership || master?.ownership || 0}%`;
  document.getElementById("pa-form").textContent = p.form || master?.form || 0;

  // 🌟 FIXED: xG / ICT string
  document.getElementById("pa-xg-ict").textContent = `${realXg} / ${realIct}`;

  const nextGw = (currentGw || 1) + 1;
  const matches = getUpcomingMatchesForTeam(p.team, nextGw, 3);
  const fixListEl = document.getElementById("pa-fixtures-list");

  if (matches.length === 0) {
    fixListEl.innerHTML = `<p class="text-[9px] text-gray-400 py-1">Fixture ဒေတာ မရှိပါ</p>`;
  } else {
    fixListEl.innerHTML = matches.map(m => {
      if (m.isBlank) {
        return `
          <div class="flex items-center justify-between py-1 px-2 rounded bg-black/40 border border-white/5 text-[10px]">
            <span>GW ${m.gw}: <span class="font-bold text-slate-400">BLANK</span></span>
            <span class="font-black px-1.5 py-0.2 rounded text-[8.5px] bg-slate-800 text-slate-400">NO MATCH</span>
          </div>
        `;
      }
      const fdrBg = fdrColor(m.fdr);
      const venue = m.isHome ? "(H)" : "(A)";
      const textColor = m.fdr === 3 ? "#0b0d1a" : "#ffffff";
      return `
        <div class="flex items-center justify-between py-1 px-2 rounded bg-black/40 border border-white/5 text-[10px]">
          <span>GW ${m.gw}: <span class="font-bold text-white">${m.opp} ${venue}</span></span>
          <span class="font-black px-1.5 py-0.2 rounded text-[8.5px]" style="background:${fdrBg}; color:${textColor};">FDR ${m.fdr}</span>
        </div>
      `;
    }).join("");
  }

  document.getElementById("player-action-modal").classList.remove("hidden");
  document.getElementById("player-action-modal").classList.add("flex");
};

window.closePlayerActionModal = function() {
  document.getElementById("player-action-modal").classList.add("hidden");
  document.getElementById("player-action-modal").classList.remove("flex");
  selectedSlotIndex = null;
};

window.handleTriggerSub = function() {
  if (selectedSlotIndex === null) return;
  subCandidateIndex = selectedSlotIndex;
  closePlayerActionModal();
  document.getElementById("sub-mode-banner").classList.remove("hidden");
  renderPitch();
};

window.cancelSubMode = function() {
  subCandidateIndex = null;
  document.getElementById("sub-mode-banner").classList.add("hidden");
  renderPitch();
};

function executeSubstitution(idx1, idx2) {
  window.cancelSubMode();
  if (idx1 === idx2) return;

  const p1 = currentSquad[idx1];
  const p2 = currentSquad[idx2];
  if (!p1 || !p2) return;

  const isP1Starter = Number(p1.multiplier) > 0;
  const isP2Starter = Number(p2.multiplier) > 0;

  if (!isP1Starter && !isP2Starter) {
    if (normalizePosition(p1.position) === "GK" || normalizePosition(p2.position) === "GK") {
      showTwToast("လူလဲမရပါ", "အရန်ဂိုးသမား (Sub GK) သည် အရန်ခုံတွင် နေရာအသေဖြစ်သည်ခင်ဗျာ!", "⚠️");
      return;
    }
    const temp = currentSquad[idx1];
    currentSquad[idx1] = currentSquad[idx2];
    currentSquad[idx2] = temp;

    showTwToast("Bench Swap အောင်မြင်သည်", `အရန်ခုံ ဦးစားပေးနေရာကို (${p1.name} ⇄ ${p2.name}) သို့ ပြောင်းလဲလိုက်ပါပြီ!`, "🔄");
    saveLocalState();
    renderPitch();
    updateStrategyMetrics();
    return;
  }

  const isP1Gk = normalizePosition(p1.position) === "GK";
  const isP2Gk = normalizePosition(p2.position) === "GK";
  if ((isP1Gk && !isP2Gk) || (!isP1Gk && isP2Gk)) {
    showTwToast("လူလဲမရပါ", "ဂိုးသမား (GK) သည် အခြားဂိုးသမားနှင့်သာ လူလဲခွင့်ရှိပါသည်ခင်ဗျာ!", "⚠️");
    return;
  }

  const tempMult = p1.multiplier;
  p1.multiplier = p2.multiplier;
  p2.multiplier = tempMult;

  const starters = currentSquad.filter(p => Number(p.multiplier) > 0);
  const defCount = starters.filter(p => normalizePosition(p.position) === "DEF").length;
  const midCount = starters.filter(p => normalizePosition(p.position) === "MID").length;
  const fwdCount = starters.filter(p => normalizePosition(p.position) === "FWD").length;

  if (defCount < 3 || defCount > 5 || midCount < 2 || midCount > 5 || fwdCount < 1 || fwdCount > 3) {
    p2.multiplier = p1.multiplier;
    p1.multiplier = tempMult;
    showTwToast("Formation မမှန်ပါ", "FPL တရားဝင် Formation မဟုတ်ပါ (DEF: ၃-၅၊ MID: ၂-၅၊ FWD: ၁-၃ သာ ရှိရပါမည်)။", "⚠️");
    return;
  }

  const own1 = p1.ownership || 0;
  const own2 = p2.ownership || 0;
  const diff = Math.abs(own1 - own2).toFixed(1);

  document.getElementById("template-out-bar").style.width = `${Math.min(100, own1)}%`;
  document.getElementById("template-in-bar").style.width = `${Math.min(100, own2)}%`;
  
  document.getElementById("template-out-label").textContent = `Out: ${own1}%`;
  document.getElementById("template-in-label").textContent = `In: ${own2}%`;

  const badge = document.getElementById("swap-type-badge");
  const verdict = document.getElementById("swap-verdict-text");
  badge.textContent = "SUB SWAP";
  badge.className = "px-1 py-0.2 rounded bg-sky-950 text-sky-300 border border-sky-500/40";
  verdict.innerHTML = `🔄 <span class="text-sky-300 font-bold">${p1.name}</span> ⇄ <span class="text-emerald-400 font-bold">${p2.name}</span> (Δ ${diff}%)`;

  saveLocalState();
  renderPitch();
  updateStrategyMetrics();
}

window.handleMakeCaptain = function() {
  if (selectedSlotIndex === null) return;
  currentSquad.forEach(p => p.isCaptain = false);
  currentSquad[selectedSlotIndex].isCaptain = true;
  currentSquad[selectedSlotIndex].isVice = false;
  saveLocalState();
  closePlayerActionModal();
  renderPitch();
  updateStrategyMetrics();
};

window.handleMakeVice = function() {
  if (selectedSlotIndex === null) return;
  currentSquad.forEach(p => p.isVice = false);
  currentSquad[selectedSlotIndex].isVice = true;
  currentSquad[selectedSlotIndex].isCaptain = false;
  saveLocalState();
  closePlayerActionModal();
  renderPitch();
  updateStrategyMetrics();
};

window.handleSellFromSlot = function() {
  if (!checkTwMemberPermission()) return;
  if (selectedSlotIndex === null) return;

  const target = currentSquad[selectedSlotIndex];
  target.isSold = true;
  
  const refundAmount = parseFloat(target.sellingPrice !== undefined ? target.sellingPrice : (target.price || 0.0));
  officialTeamBank = parseFloat((officialTeamBank + refundAmount).toFixed(1));

  const soldIndex = selectedSlotIndex;
  closePlayerActionModal();
  saveLocalState();
  renderPitch();
  updateStrategyMetrics();

  window.openMarketModal(soldIndex);
};

window.openMarketModal = function(slotIndex) {
  targetSwapIndex = slotIndex;
  const slot = currentSquad[slotIndex];

  document.getElementById("market-filter-pos-hint").textContent = `Position: ${slot.position} Only (Avail: £${officialTeamBank.toFixed(1)}m)`;
  renderMarketList();

  const modal = document.getElementById("market-modal");
  modal.classList.remove("hidden");
};

window.closeMarketModal = function() {
  const modal = document.getElementById("market-modal");
  modal.classList.add("hidden");
  targetSwapIndex = null;
};

window.setMarketSort = function(sortKey) {
  activeMarketSort = sortKey;
  ["form", "ownership", "points", "gwPoints", "xg", "ict", "price"].forEach(k => {
    const btn = document.getElementById(`msort-${k}`);
    if (!btn) return;
    if (k === sortKey) {
      btn.className = "px-2.5 py-1 rounded bg-[#8c6dff] text-[#14172b]";
    } else {
      btn.className = "px-2.5 py-1 rounded bg-black/40 text-gray-300";
    }
  });
  renderMarketList();
};

// 🌟 Market List Rendering (Fixed: xG & ICT Undefined Bug)
function renderMarketList() {
  const slot = currentSquad[targetSwapIndex];
  if (!slot) return;

  const targetPos = normalizePosition(slot.position);
  const ownedIds = new Set(currentSquad.filter(p => !p.isSold).map(p => String(p.playerId)));

  const teamCounts = {};
  currentSquad.forEach(p => {
    if (!p.isSold && p.team && p.team !== "—") {
      const code = formatTeamShort(p.team);
      teamCounts[code] = (teamCounts[code] || 0) + 1;
    }
  });

  let filtered = allPlayersCache.filter(p => {
    const pPos = normalizePosition(p.position);
    return pPos === targetPos;
  });

  filtered.sort((a, b) => {
    const priceA = parseFloat(a.currentPrice || a.price || 0);
    const priceB = parseFloat(b.currentPrice || b.price || 0);
    if (activeMarketSort === "price") return priceB - priceA;
    if (activeMarketSort === "ownership") return (b.ownership || 0) - (a.ownership || 0);
    if (activeMarketSort === "points") return (b.totalPoints || 0) - (a.totalPoints || 0);
    if (activeMarketSort === "gwPoints") return (b.gwPoints || 0) - (a.gwPoints || 0);
    if (activeMarketSort === "xg") return extractPlayerXg(b) - extractPlayerXg(a);
    if (activeMarketSort === "ict") return extractPlayerIct(b) - extractPlayerIct(a);
    return (b.form || 0) - (a.form || 0);
  });

  const listEl = document.getElementById("market-player-list");
  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="text-center text-xs text-gray-400 py-10">ကစားသမားများ ရှာမတွေ့ပါဗျာ။</p>`;
    return;
  }

  const nextGw = (currentGw || 1) + 1;

  listEl.innerHTML = filtered.slice(0, 60).map(p => {
    const pTeamCode = formatTeamShort(p.team);
    const isOwned = ownedIds.has(String(p.playerId));
    const buyCost = parseFloat(p.currentPrice || p.price || 0);
    const canAfford = buyCost <= (officialTeamBank + 0.001);
    const isTeamMaxed = (teamCounts[pTeamCode] || 0) >= 3;

    // 🌟 SAFE RESOLVE: xG & ICT
    const pXg = extractPlayerXg(p);
    const pIct = extractPlayerIct(p);

    const nextMatches = getUpcomingMatchesForTeam(p.team, nextGw, 3);
    const next3MatchesHtml = `
      <div class="flex items-center gap-1 shrink-0">
        ${nextMatches.map(m => {
          if (m.isBlank) {
            return `<span class="px-1 py-0.5 rounded text-[7.5px] font-black bg-slate-800 text-slate-400 border border-slate-700">BLANK</span>`;
          }
          const fdrBg = fdrColor(m.fdr);
          const venue = m.isHome ? "(H)" : "(A)";
          const txtColor = m.fdr === 3 ? "#0b0d1a" : "#ffffff";
          return `<span class="px-1 py-0.5 rounded text-[7.5px] font-black" style="background:${fdrBg}; color:${txtColor};">${m.opp}${venue}</span>`;
        }).join("")}
      </div>
    `;

    let btnHtml = "";
    if (isOwned) {
      btnHtml = `<button disabled class="px-2.5 py-1 rounded text-[8px] font-bold bg-slate-800 text-slate-500">OWNED</button>`;
    } else if (isTeamMaxed) {
      btnHtml = `<button disabled class="px-2 py-1 rounded text-[8px] font-bold bg-red-950 text-red-400 border border-red-800">MAX 3</button>`;
    } else if (!canAfford) {
      btnHtml = `<button disabled class="px-2.5 py-1 rounded text-[8px] font-bold bg-red-950 text-red-400">OVER</button>`;
    } else {
      btnHtml = `<button onclick="event.stopPropagation(); window.confirmBuyPlayer('${p.playerId}')" class="px-3 py-1 rounded bg-[#8c6dff] text-[#14172b] font-black text-xs active:scale-95 shadow cursor-pointer">USE</button>`;
    }

    return `
      <div onclick="window.openMarketDetailModal('${p.playerId}')" class="p-2.5 rounded-xl bg-black/40 border border-white/5 cursor-pointer active:scale-[0.99] transition hover:border-emerald-500/30">
        <div class="flex items-center justify-between gap-1.5">
          <div class="flex items-center gap-2 min-w-0 flex-1">
            ${renderJerseyHtml(p, "w-8 h-8 shrink-0")}
            <div class="min-w-0">
              <p class="text-xs font-black text-white leading-tight truncate">${p.name}</p>
              <p class="text-[9px] text-gray-400 font-semibold truncate">${pTeamCode} • ${p.position} ${isTeamMaxed ? '<span class="text-red-400 font-bold">(3/3 Full)</span>' : ''}</p>
            </div>
          </div>

          ${next3MatchesHtml}

          <div class="flex items-center gap-1.5 shrink-0">
            <span class="text-xs font-mono font-black text-[#b3a1ff]">£${buyCost.toFixed(1)}m</span>
            ${btnHtml}
          </div>
        </div>

        <div class="grid grid-cols-6 gap-1 mt-1.5 pt-1.5 border-t border-white/10 text-center text-[9px]">
          <div><span class="text-gray-400 text-[7px] block">Form</span><span class="text-sky-400 font-bold">${p.form || 0}</span></div>
          <div><span class="text-gray-400 text-[7px] block">Tot Pts</span><span class="text-emerald-400 font-bold">${p.totalPoints || 0}</span></div>
          <div><span class="text-gray-400 text-[7px] block">GW Pts</span><span class="text-amber-300 font-bold">${p.gwPoints || 0}</span></div>
          <div><span class="text-gray-400 text-[7px] block">Owned</span><span class="text-white font-bold">${p.ownership || 0}%</span></div>
          <div><span class="text-gray-400 text-[7px] block">xG</span><span class="text-purple-300 font-bold">${pXg}</span></div>
          <div><span class="text-gray-400 text-[7px] block">ICT</span><span class="text-pink-300 font-bold">${pIct}</span></div>
        </div>
      </div>
    `;
  }).join("");
}

// 🌟 Market Detail Modal (Fixed: Real xG & ICT Display)
window.openMarketDetailModal = function(playerId) {
  const p = allPlayersCache.find(x => String(x.playerId) === String(playerId));
  if (!p) return;

  const buyPrice = parseFloat(p.currentPrice || p.price || 0.0);
  const realXg = extractPlayerXg(p);
  const realIct = extractPlayerIct(p);

  document.getElementById("md-jersey-wrap").innerHTML = renderJerseyHtml(p, "w-9 h-9");
  document.getElementById("md-name").textContent = p.name;
  document.getElementById("md-team-pos").textContent = `${formatTeamShort(p.team)} • ${p.position}`;
  document.getElementById("md-price").textContent = `£${buyPrice.toFixed(1)}m`;
  document.getElementById("md-total-pts").textContent = p.totalPoints || 0;
  document.getElementById("md-gw-pts").textContent = p.gwPoints || 0;
  document.getElementById("md-own").textContent = `${p.ownership || 0}%`;
  document.getElementById("md-form").textContent = p.form || 0;

  // 🌟 FIXED: xG / ICT string
  document.getElementById("md-xg-ict").textContent = `${realXg} / ${realIct}`;

  const nextGw = (currentGw || 1) + 1;
  const matches = getUpcomingMatchesForTeam(p.team, nextGw, 3);
  const fixListEl = document.getElementById("md-fixtures-list");

  fixListEl.innerHTML = matches.map(m => {
    if (m.isBlank) {
      return `
        <div class="flex items-center justify-between py-1 px-2 rounded bg-black/40 border border-white/5 text-[10px]">
          <span>GW ${m.gw}: <span class="font-bold text-slate-400">BLANK</span></span>
          <span class="font-black px-1.5 py-0.2 rounded text-[8.5px] bg-slate-800 text-slate-400">NO MATCH</span>
        </div>
      `;
    }
    const fdrBg = fdrColor(m.fdr);
    const venue = m.isHome ? "(H)" : "(A)";
    const textColor = m.fdr === 3 ? "#0b0d1a" : "#ffffff";
    return `
      <div class="flex items-center justify-between py-1 px-2 rounded bg-black/40 border border-white/5 text-[10px]">
        <span>GW ${m.gw}: <span class="font-bold text-white">${m.opp} ${venue}</span></span>
        <span class="font-black px-1.5 py-0.2 rounded text-[8.5px]" style="background:${fdrBg}; color:${textColor};">FDR ${m.fdr}</span>
      </div>
    `;
  }).join("");

  const useBtn = document.getElementById("md-btn-use");
  useBtn.onclick = () => {
    window.closeMarketDetailModal();
    window.confirmBuyPlayer(p.playerId);
  };

  document.getElementById("market-detail-modal").classList.remove("hidden");
  document.getElementById("market-detail-modal").classList.add("flex");
};

window.closeMarketDetailModal = function() {
  document.getElementById("market-detail-modal").classList.add("hidden");
  document.getElementById("market-detail-modal").classList.remove("flex");
};

window.confirmBuyPlayer = function(playerId) {
  if (!checkTwMemberPermission()) return;
  if (targetSwapIndex === null) return;

  const newP = allPlayersCache.find(x => String(x.playerId) === String(playerId));
  if (!newP) return;

  const oldSlot = currentSquad[targetSwapIndex];
  const newTeamCode = formatTeamShort(newP.team);

  const currentTeamCount = currentSquad.filter((p, idx) => 
    idx !== targetSwapIndex && !p.isSold && formatTeamShort(p.team) === newTeamCode
  ).length;

  if (currentTeamCount >= 3) {
    showTwToast("Team Limit ပြည့်နေပါသည်", `${newTeamCode} အသင်းမှ ကစားသမား ၃ ယောက် ရွေးချယ်ပြီးဖြစ်ပါသည်! အခြားကစားသမား ရွေးပေးပါ။`, "⚠️");
    return;
  }

  const oldOwn = oldSlot.ownership || 0;
  const newOwn = newP.ownership || 0;
  const diff = Math.abs(oldOwn - newOwn).toFixed(1);

  document.getElementById("template-out-bar").style.width = `${Math.min(100, oldOwn)}%`;
  document.getElementById("template-in-bar").style.width = `${Math.min(100, newOwn)}%`;
  
  document.getElementById("template-out-label").textContent = `Out: ${oldOwn}%`;
  document.getElementById("template-in-label").textContent = `In: ${newOwn}%`;

  const badge = document.getElementById("swap-type-badge");
  const verdict = document.getElementById("swap-verdict-text");
  if (newOwn < oldOwn) {
    badge.textContent = "DIFF";
    badge.className = "px-1 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-500/40";
    verdict.innerHTML = `⚡ <span class="text-amber-300 font-bold">${oldSlot.name}</span> ➜ <span class="text-emerald-400 font-bold">${newP.name}</span> (-${diff}%)`;
  } else {
    badge.textContent = "TEMPLATE";
    badge.className = "px-1 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40";
    verdict.innerHTML = `🛡️ <span class="text-amber-300 font-bold">${oldSlot.name}</span> ➜ <span class="text-emerald-400 font-bold">${newP.name}</span> (+${diff}%)`;
  }

  const buyCost = parseFloat(newP.currentPrice || newP.price || 0.0);
  officialTeamBank = parseFloat((officialTeamBank - buyCost).toFixed(1));

  currentSquad[targetSwapIndex] = {
    ...newP,
    id: String(newP.playerId),
    playerId: String(newP.playerId),
    position: normalizePosition(newP.position) || oldSlot.position,
    currentPrice: buyCost,
    purchasePrice: buyCost,
    sellingPrice: buyCost,
    price: buyCost,
    xg: extractPlayerXg(newP),
    xG: extractPlayerXg(newP),
    ict: extractPlayerIct(newP),
    multiplier: oldSlot.multiplier,
    isCaptain: oldSlot.isCaptain,
    isVice: oldSlot.isVice,
    isSold: false
  };

  closeMarketModal();
  saveLocalState();
  renderPitch();
  updateStrategyMetrics();
};

export async function init() {
  if (auth.currentUser) {
    await setupTransfersGate(auth.currentUser);
  } else {
    onAuthStateChanged(auth, setupTransfersGate);
  }
}

onAuthStateChanged(auth, setupTransfersGate);
