import { auth, db } from "../js/firebase-config.js";
import { loadFixturesMaster, getScoutSnap } from "./core/data.js";
import { onAuthStateChanged } from "./core/auth.js";
import { 
  collection, doc, getDoc, getDocs, 
  getDocsFromServer, getDocFromServer 
} from "./core/fs.js";

// Global Storage
let currentLiveSquadState = [];
let allPlayersCache = [];
let firebaseFixturesCache = [];
let currentFplTeamId = null;
let currentGw = parseInt(localStorage.getItem("twf_current_gw") || "5", 10);
let activeTeamFilter = "all";

const FIXTURES_CACHE_KEY = "twf_fixtures_cache_v3"; // schema အသစ် (1-doc) → key အသစ်၊ TTL 10 မိနစ်
const FIXTURES_TTL = 10 * 60 * 1000;
let fixturesLoadError = "";
let fixturesGw = 0;
const SCOUT_CACHE_KEY = "twf_scout_players_cache_v4"; // TTL 30 မိနစ်
const SCOUT_TTL = 30 * 60 * 1000;
const SQUAD_TIME_KEY = "twf_shared_players_quota_time_v2";

const TEAM_SHORT_CODES = {
  "arsenal": "ARS", "aston villa": "AVL", "bournemouth": "BOU", "brentford": "BRE",
  "brighton": "BHA", "brighton & hove albion": "BHA", "chelsea": "CHE", 
  "coventry": "COV", "coventry city": "COV", "crystal palace": "CRY", 
  "everton": "EVE", "fulham": "FUL", "hull": "HUL", "hull city": "HUL",
  "ipswich": "IPS", "ipswich town": "IPS", "leeds": "LEE", "leeds united": "LEE",
  "liverpool": "LIV", "man city": "MCI", "manchester city": "MCI", 
  "man utd": "MUN", "manchester united": "MUN", "newcastle": "NEW", 
  "newcastle united": "NEW", "nottingham forest": "NFO", "nott'm forest": "NFO", 
  "tottenham": "TOT", "spurs": "TOT", "sunderland": "SUN"
};

const TEAM_ID_MAP = {
  1: "ARS", 2: "AVL", 3: "BOU", 4: "BRE", 5: "BHA",
  6: "CHE", 7: "COV", 8: "CRY", 9: "EVE", 10: "FUL",
  11: "HUL", 12: "IPS", 13: "LEE", 14: "LIV", 15: "MCI",
  16: "MUN", 17: "NEW", 18: "NFO", 19: "TOT", 20: "SUN"
};

// fixtures ထဲက team_h_code / team_a_code ကနေ id <-> code map ကို dynamic တည်ဆောက် (season ပြောင်းလည်း မှန်)
let dynTeamCodeById = {};
function rebuildTeamMaps() {
  const m = {};
  (firebaseFixturesCache || []).forEach((f) => {
    if (f.team_h && f.team_h_code) m[f.team_h] = String(f.team_h_code).toUpperCase();
    if (f.team_a && f.team_a_code) m[f.team_a] = String(f.team_a_code).toUpperCase();
  });
  dynTeamCodeById = m;
}
const codeOfTeamId = (id) => dynTeamCodeById[id] || TEAM_ID_MAP[id] || "TBD";
function idOfTeamCode(code) {
  const c = String(code).trim().toUpperCase();
  return Object.keys(dynTeamCodeById).find((k) => dynTeamCodeById[k] === c)
    ?? Object.keys(TEAM_ID_MAP).find((k) => TEAM_ID_MAP[k] === c);
}
function allTeamCodes() {
  const ids = Object.keys(dynTeamCodeById).map(Number).sort((a, b) => a - b);
  return ids.length >= 18 ? ids.map((id) => dynTeamCodeById[id]) : Object.values(TEAM_ID_MAP);
}

const TEAM_NAMES_FULL = {
  "ARS": "Arsenal", "AVL": "Aston Villa", "BOU": "Bournemouth", "BRE": "Brentford",
  "BHA": "Brighton", "CHE": "Chelsea", "COV": "Coventry City", "CRY": "Crystal Palace",
  "EVE": "Everton", "FUL": "Fulham", "HUL": "Hull City", "IPS": "Ipswich Town",
  "LEE": "Leeds United", "LIV": "Liverpool", "MCI": "Man City", "MUN": "Man Utd",
  "NEW": "Newcastle", "NFO": "Nottingham Forest", "TOT": "Tottenham", "SUN": "Sunderland"
};

const TEAM_DIFFICULTY_TIER = {
  "MCI": 5, "ARS": 5, "LIV": 5,
  "CHE": 4, "NEW": 4, "TOT": 4, "MUN": 4, "AVL": 4,
  "BHA": 3, "FUL": 3, "BOU": 3, "BRE": 3, "CRY": 3, "EVE": 3, "NFO": 3,
  "IPS": 2, "LEE": 2, "SUN": 2, "HUL": 2, "COV": 2
};

// =========================================================================
// 🌟 CURRENT GAMEWEEK ENGINE (ချက်ချင်း ဖတ်ယူပြသမှု စနစ်)
// =========================================================================

function updateDraftGwBadge() {
  const gwLabel = document.getElementById("gw-header-label");
  currentGw = parseInt(localStorage.getItem("twf_current_gw") || localStorage.getItem("twf_transfers_gw") || "5", 10);
  if (gwLabel) {
    gwLabel.textContent = `GW ${currentGw}`;
  }
}

if (document.readyState === "loading") {
  queueMicrotask( () => updateDraftGwBadge());
} else {
  updateDraftGwBadge();
}

// =========================================================================
// ⏰ IN-FILE SCHEDULE QUOTA CONTROLLER (0 Read Guard)
// =========================================================================

function getMyanmarDate(dateObj = new Date()) {
  const utc = dateObj.getTime() + (dateObj.getTimezoneOffset() * 60000);
  return new Date(utc + (6.5 * 3600000));
}

function checkDraftSlotStatus() {
  const mmNow = getMyanmarDate(new Date());
  const day = mmNow.getDay();
  const currentH = mmNow.getHours();
  let savedTimeMs = localStorage.getItem(SQUAD_TIME_KEY);

  if (!savedTimeMs) {
    localStorage.setItem(SQUAD_TIME_KEY, String(Date.now()));
    savedTimeMs = String(Date.now());
  }

  const isMatchDayPeriod = (day === 0 || day === 6 || day === 1);

  // ၁။ Sat, Sun, Mon (၄ နာရီခြားစနစ် - 00, 04, 08, 12, 16, 20)
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
      alertText: `⏳ TWFM DRAFT UPDATE ကို (${dateFormatted} ရက် ${timeFormatted}) တွင် ရရှိပါမည်ခင်ဗျာ!`
    };
  }

  // ၂။ Tue, Wed, Thu, Fri (၁၂ နာရီခြားစနစ် - 00:00, 12:00)
  const baseH = currentH >= 12 ? 12 : 0;
  const currentWindowStartDate = new Date(mmNow);
  currentWindowStartDate.setHours(baseH, 0, 0, 0);

  let nextSlotName = currentH < 12 ? "AFTERNOON (နေ့လယ် ၁၂:၀၀ နာရီ)" : "MIDNIGHT (ည ၁၂:၀၀ နာရီ)";

  const lastSavedMm = getMyanmarDate(new Date(Number(savedTimeMs)));
  const isExpired = lastSavedMm.getTime() < currentWindowStartDate.getTime();

  return {
    isExpired,
    alertText: `⏳ TWFM DRAFT UPDATE ကို ${nextSlotName} တွင် ရရှိပါမည်ခင်ဗျာ!`
  };
}

function showDraftToast(message, isError = false) {
  let toast = document.getElementById("tw-draft-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "tw-draft-toast";
    toast.className = "fixed top-4 left-1/2 -translate-x-1/2 z-[99999] px-4 py-2 rounded-xl text-xs font-bold text-center transition-all duration-300 opacity-0 pointer-events-none shadow-2xl border max-w-[90%]";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.background = isError ? "linear-gradient(135deg, #7f1d1d, #450a0a)" : "linear-gradient(135deg, #1b1f3a, #14172b)";
  toast.style.color = isError ? "#fecaca" : "#b3a1ff";
  toast.style.borderColor = isError ? "#ef4444" : "#b3a1ff";
  toast.style.boxShadow = isError ? "0 8px 24px rgba(239, 68, 68, 0.7)" : "0 8px 20px rgba(179,161,255, 0.3)";

  toast.classList.remove("opacity-0");
  toast.classList.add("opacity-100");

  clearTimeout(window.draftToastTimeout);
  window.draftToastTimeout = setTimeout(() => {
    toast.classList.remove("opacity-100");
    toast.classList.add("opacity-0");
  }, 3200);
}

function triggerInitialFakeRefreshUI() {
  const btn = document.querySelector("button[onclick*='resetDraftToFPLRealtime']") || document.getElementById("btn-reset-matrix");
  if (btn) {
    btn.style.setProperty("background-color", "#8c6dff", "important");
    btn.style.setProperty("color", "#14172b", "important");
    btn.style.setProperty("border-color", "#b3a1ff", "important");
  }

  showDraftToast("🔄 TW FM UPDATE...", false);

  setTimeout(() => {
    if (btn) {
      btn.style.removeProperty("background-color");
      btn.style.removeProperty("color");
      btn.style.removeProperty("border-color");
    }
  }, 2500);
}

// =========================================================================
// 🔄 RESET / REFRESH BUTTON (Early-Return & 0 Read Guard)
// =========================================================================

window.resetDraftToFPLRealtime = async function() {
  const btn = document.querySelector("button[onclick*='resetDraftToFPLRealtime']") || document.getElementById("btn-reset-matrix");

  const slotStatus = checkDraftSlotStatus();

  // 🛡️ Early Return: အချိန်မစေ့သေးပါက Firebase ဆီ လုံးဝမသွားပါ (Read = 0)
  if (!slotStatus.isExpired) {
    showDraftToast(slotStatus.alertText, false);
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.style.setProperty("background-color", "#8c6dff", "important");
    btn.style.setProperty("color", "#14172b", "important");
    btn.style.setProperty("border-color", "#b3a1ff", "important");
    btn.style.setProperty("box-shadow", "0 0 12px rgba(140,109,255, 0.8)", "important");
    btn.innerHTML = `<span class="inline-block animate-spin mr-1">🔄</span> Loading...`;
  }

  showDraftToast("🔄 TW FM UPDATE...", false);

  try {
    const base = await Promise.all([loadFixturesCache(true), loadScoutCache(true)]);
    const isSuccess = [...base, await loadUserSquad(true)];

    if (isSuccess.every(Boolean)) {
      localStorage.setItem(SQUAD_TIME_KEY, String(Date.now()));
      build20TeamsMatrixHeader();
      render20TeamsMatrix();
      if (typeof window.renderMySquadMatrix === "function") {
        window.renderMySquadMatrix();
      }
      showDraftToast("✅ Draft Update ရရှိပါပြီ!");
    } else {
      throw new Error("DRAFT_FETCH_FAILED");
    }

  } catch (err) {
    console.error("Draft Refresh Blocked:", err);
    showDraftToast("⚠️ SERVER Maintain လုပ်နေပါသည်ခင်ဗျာ!", true);
  } finally {
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.style.removeProperty("background-color");
        btn.style.removeProperty("color");
        btn.style.removeProperty("border-color");
        btn.style.removeProperty("box-shadow");
        btn.innerHTML = `🔄 RESET`;
      }
    }, 400);
  }
};

// =========================================================================
// ⚽ DATA LOGIC & RENDERING
// =========================================================================

function formatTeamShortName(rawName) {
  if (!rawName) return "—";
  const clean = String(rawName).trim().toLowerCase();
  return TEAM_SHORT_CODES[clean] || (rawName.length > 4 ? rawName.slice(0, 3).toUpperCase() : rawName.toUpperCase());
}

function getTeamBadgeUrl(teamCode) {
  const clean = String(teamCode).trim().toUpperCase();
  const teamId = idOfTeamCode(clean) || "1";
  return `./assets/badges/${teamId}.${clean.toLowerCase()}.png`;
}

function calculateDynamicFdr(opponentCode, isHome) {
  const baseTier = TEAM_DIFFICULTY_TIER[opponentCode] || 3;
  return isHome ? Math.max(2, baseTier - 1) : Math.min(5, baseTier);
}

function fdrColor(fdr) {
  const colors = { 1: "#22c55e", 2: "#84cc16", 3: "#eab308", 4: "#f97316", 5: "#ef4444" };
  return colors[fdr] || "#8c6dff";
}

function getPlayerStatusBadge(p) {
  const status = String(p.status || "a").toLowerCase();
  const chance = p.chanceOfPlaying !== undefined && p.chanceOfPlaying !== null ? Number(p.chanceOfPlaying) : 100;
  const isSuspended = p.isSuspended || status === "s";
  const isInjured = p.isInjured || status === "i";

  if (isSuspended) {
    return `<span class="text-[7.5px] font-black px-1 py-0.2 rounded bg-red-600 text-white shrink-0">SUSP</span>`;
  }
  if (isInjured || chance === 0) {
    return `<span class="text-[7.5px] font-black px-1 py-0.2 rounded bg-red-600 text-white shrink-0">INJ</span>`;
  }
  if (chance > 0 && chance < 100) {
    return `<span class="text-[7.5px] font-black px-1 py-0.2 rounded bg-yellow-400 text-black shrink-0">${chance}%</span>`;
  }
  return "";
}

function getFirebaseMatchesForTeam(teamCode, targetGw) {
  if (!firebaseFixturesCache || !teamCode) return [];
  const cleanCode = String(teamCode).trim().toUpperCase();
  const tIdNum = Number(idOfTeamCode(cleanCode));
  const up = (v) => String(v || "").toUpperCase();

  const out = [];
  firebaseFixturesCache.forEach((f) => {
    if (Number(f.event) !== Number(targetGw)) return;
    // team_*_code ရှိရင် code နဲ့၊ မရှိမှ id နဲ့ ကိုက်
    const isH = f.team_h_code ? up(f.team_h_code) === cleanCode : (tIdNum && Number(f.team_h) === tIdNum);
    const isA = f.team_a_code ? up(f.team_a_code) === cleanCode : (tIdNum && Number(f.team_a) === tIdNum);
    if (!isH && !isA) return;

    const oppCode = isH ? (up(f.team_a_code) || codeOfTeamId(f.team_a)) : (up(f.team_h_code) || codeOfTeamId(f.team_h));
    const fdr = isH
      ? (f.team_h_difficulty || calculateDynamicFdr(oppCode, true))
      : (f.team_a_difficulty || calculateDynamicFdr(oppCode, false));
    out.push({ gw: targetGw, opponent: oppCode, isHome: !!isH, fdr: Number(fdr) || 3 });
  });
  return out;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.go("login"); return; }

  updateDraftGwBadge();
  triggerInitialFakeRefreshUI();

  try {
    build20TeamsMatrixHeader();
    initTeamFilterModalOptions();

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

    if (uData && uData.fplTeamId) {
      currentFplTeamId = String(uData.fplTeamId);
    }

    await Promise.allSettled([loadFixturesCache(false), loadScoutCache(false)]);
    await loadUserSquad(false).catch((e) => console.warn("squad load:", e));

    build20TeamsMatrixHeader();
    render20TeamsMatrix();
    if (typeof window.renderMySquadMatrix === "function") {
      window.renderMySquadMatrix();
    }

  } catch (err) {
    console.warn("Draft silent start bypassed:", err);
  }
});

function applyFixturesGw(gw) {
  const n = Number(gw);
  if (n > 0) {
    fixturesGw = n;
    currentGw = n;
    localStorage.setItem("twf_current_gw", String(n));
    updateDraftGwBadge();
  }
}

async function loadFixturesCache(forceFresh = false) {
  try { localStorage.removeItem("twf_fixtures_cache"); } catch (_) {} // schema အဟောင်း cache ရှင်း

  if (!forceFresh) {
    try {
      const c = JSON.parse(localStorage.getItem(FIXTURES_CACHE_KEY) || "null");
      if (c && Array.isArray(c.list) && c.list.length && Date.now() - c.t < FIXTURES_TTL) {
        firebaseFixturesCache = c.list;
        rebuildTeamMaps();
        applyFixturesGw(c.gw);
        return true;
      }
    } catch (_) {}
  }

  try {
    const m = await loadFixturesMaster(forceFresh); // fixturesMeta/allFixtures (doc 1 ခု)
    // match stats က ကြီးတာမို့ draft မှာ မလိုလို့ ဖယ်ပြီးသိမ်း
    const list = (m.fixtures || []).map(({ stats, ...f }) => f);
    const gw = m.currentGameweek && m.currentGameweek.id;
    if (list.length > 0) {
      firebaseFixturesCache = list;
      rebuildTeamMaps();
      applyFixturesGw(gw);
      fixturesLoadError = "";
      try { localStorage.setItem(FIXTURES_CACHE_KEY, JSON.stringify({ t: Date.now(), gw, list })); } catch (_) {}
      return true;
    }
    fixturesLoadError = "fixturesMeta/allFixtures ထဲမှာ fixtures မရှိသေးပါ (fixtures-sync ကို run ပါ)";
    return false;
  } catch (e) {
    console.error("Draft fixtures load failed:", e);
    fixturesLoadError = e && e.code === "permission-denied"
      ? "Firestore Rules က ဖတ်ခွင့် မပေးသေးပါ (permission-denied)"
      : (e && e.message) || "Firestore ချိတ်မရပါ";
    if (forceFresh) throw e;
    return Boolean(firebaseFixturesCache && firebaseFixturesCache.length > 0);
  }
}

async function loadScoutCache(forceFresh = false) {
  try { localStorage.removeItem("twf_scout_players_cache_v3"); } catch (_) {}

  if (!forceFresh) {
    try {
      const c = JSON.parse(localStorage.getItem(SCOUT_CACHE_KEY) || "null");
      if (c && Array.isArray(c.list) && c.list.length && Date.now() - c.t < SCOUT_TTL) {
        allPlayersCache = c.list;
        return true;
      }
    } catch (e) {
      console.warn("Corrupt scout cache:", e);
    }
  }

  try {
    const snap = forceFresh
      ? await getScoutSnap(true)
      : await getScoutSnap();

    const freshScout = [];
    snap.forEach(d => {
      const data = d.data();
      freshScout.push({
        id: String(d.id),
        playerId: String(data.playerId !== undefined ? data.playerId : d.id),
        ...data,
        price: parseFloat(data.price || 0),
        ownership: parseFloat(String(data.ownership).replace(/[^\d.-]/g, '')) || 0,
        totalPoints: parseInt(data.totalPoints) || 0,
        gwPoints: parseInt(data.gwPoints) || 0,
        form: parseFloat(data.form || 0),
        ppg: parseFloat(data.ppg || 0),
        val: parseFloat(data.val || 0),
        l5: parseFloat(data.l5 || 0),
        xgi: parseFloat(data.xgi || 0),
        ict: parseFloat(data.ict || 0),
        position: String(data.position || "DEF").toUpperCase().trim(),
        team: data.team || "—"
      });
    });

    if (freshScout.length > 0) {
      allPlayersCache = freshScout;
      try { localStorage.setItem(SCOUT_CACHE_KEY, JSON.stringify({ t: Date.now(), list: allPlayersCache })); } catch (_) {}
    }
    return true;
  } catch (err) {
    if (forceFresh) throw err;
    console.warn("Scout load error in draft:", err);
    return Boolean(allPlayersCache && allPlayersCache.length > 0);
  }
}

async function loadUserSquad(forceFresh = false) {
  if (!currentFplTeamId) return false;

  const sharedSquadKey = `twf_shared_squad_v2_${currentFplTeamId}`;
  const teamCacheKey = `twf_team_data_${currentFplTeamId}`;
  const savedCache = localStorage.getItem(sharedSquadKey) || localStorage.getItem(teamCacheKey);

  if (!forceFresh && savedCache) {
    try {
      const teamData = JSON.parse(savedCache);
      parseSquadData(teamData);
      return true;
    } catch (_) {}
  }

  try {
    const squadSnap = forceFresh
      ? await getDocFromServer(doc(db, "liveTeams", currentFplTeamId))
      : await getDoc(doc(db, "liveTeams", currentFplTeamId));

    if (squadSnap.exists()) {
      const teamData = squadSnap.data();
      localStorage.setItem(sharedSquadKey, JSON.stringify(teamData));
      parseSquadData(teamData);
      return true;
    }
    return false;
  } catch (err) {
    if (forceFresh) throw err;
    console.warn("Error loading squad data in draft:", err);
    return Boolean(currentLiveSquadState && currentLiveSquadState.length > 0);
  }
}

function parseSquadData(teamData) {
  currentGw = fixturesGw || Number(teamData.gameweek || localStorage.getItem("twf_current_gw") || 5);
  localStorage.setItem("twf_current_gw", String(currentGw));
  updateDraftGwBadge();

  const rawSquadArray = teamData.picks || teamData.players || [];
  currentLiveSquadState = rawSquadArray.map(p => {
    const pIdStr = String(p.playerId || p.element || p.id || "");
    const m = allPlayersCache.find(x => String(x.playerId) === pIdStr);
    return {
      ...p,
      playerId: pIdStr,
      name: p.name || m?.name || "Player",
      position: String(p.position || m?.position || "DEF").toUpperCase().trim(),
      team: p.team || m?.team || "—",
      ownership: m ? (m.ownership || 0) : (p.ownership || 0),
      form: m ? (m.form || 0) : (p.form || 0),
      totalPoints: m ? (m.totalPoints || 0) : (p.totalPoints || 0),
      gwPoints: m ? (m.gwPoints || 0) : (p.gwPoints || 0),
      ppg: m ? (m.ppg || 0) : (p.ppg || 0),
      val: m ? (m.val || 0) : (p.val || 0),
      l5: m ? (m.l5 || 0) : (p.l5 || 0),
      xgi: m ? (m.xgi || 0) : (p.xgi || 0),
      ict: m ? (m.ict || 0) : (p.ict || 0),
      status: p.status || m?.status || "a",
      chanceOfPlaying: p.chanceOfPlaying ?? m?.chanceOfPlaying ?? 100,
      isSuspended: p.isSuspended || m?.isSuspended || false,
      isInjured: p.isInjured || m?.isInjured || false
    };
  });

  const gk = []; const def = []; const mid = []; const fwd = [];
  currentLiveSquadState.forEach(p => {
    if (p.position === "GK") gk.push(p);
    else if (p.position === "DEF") def.push(p);
    else if (p.position === "MID") mid.push(p);
    else fwd.push(p);
  });
  currentLiveSquadState = [...gk, ...def, ...mid, ...fwd];
}

// 🌟 20 TEAMS MATRIX ENGINE
function build20TeamsMatrixHeader() {
  const headerRow = document.getElementById("fixture-header-row");
  if (!headerRow) return;

  const nextGw = currentGw + 1;

  let ths = `<th class="sticky-col-header bg-[#0b0d1a] border-r border-b border-[#3a3f7a] px-2 py-2 text-left font-black text-[#b3a1ff] shadow-[2px_0_5px_rgba(0,0,0,0.5)]" style="width: 88px; min-width: 88px; max-width: 88px;">TEAM</th>`;
  for (let gw = 1; gw <= 38; gw++) {
    const isCurrent = gw === currentGw;
    const isNext = gw === nextGw;
    const activeColor = isCurrent ? "text-amber-400 bg-amber-950/40" : isNext ? "text-emerald-400 bg-emerald-950/40" : "text-[#8c6dff]";
    ths += `
      <th class="sticky top-0 z-30 bg-[#0b0d1a] border-r border-b border-[#3a3f7a] py-2 text-center font-black ${activeColor}" style="width: 58px; min-width: 58px; max-width: 58px;">
        GW${gw}
      </th>
    `;
  }
  headerRow.innerHTML = ths;
}

function render20TeamsMatrix() {
  const tbody = document.getElementById("fixture-table-body");
  if (!tbody) return;

  if (!firebaseFixturesCache || firebaseFixturesCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="39" class="p-6 text-center text-[11px] font-bold text-amber-300">
      Fixtures မပေါ်သေးပါ<br><span class="text-[10px] font-medium text-slate-400">${fixturesLoadError || "Firestore fixturesMeta/allFixtures ကို ဖတ်မရပါ"}</span><br>
      <button onclick="window.resetDraftToFPLRealtime && window.resetDraftToFPLRealtime()" class="mt-3 px-4 py-1.5 rounded-lg bg-[#8c6dff] text-white text-[10px] font-black">ပြန်ကြိုးစားမယ်</button>
    </td></tr>`;
    return;
  }

  const teamCodes = allTeamCodes();
  let rowsHtml = "";

  teamCodes.forEach(code => {
    if (activeTeamFilter !== "all" && activeTeamFilter !== code) return;

    let cellsHtml = "";
    for (let gw = 1; gw <= 38; gw++) {
      const matches = getFirebaseMatchesForTeam(code, gw);

      if (matches.length === 0) {
        cellsHtml += `
          <td class="p-1 border-r border-b border-[#3a3f7a]/30 text-center align-middle" style="width: 58px; height: 34px;">
            <div class="inline-flex items-center justify-center rounded w-[52px] h-[22px] bg-slate-800 text-slate-400 font-black text-[7.5px] border border-slate-700/50">
              BLANK
            </div>
          </td>
        `;
      } else if (matches.length > 1) {
        cellsHtml += `
          <td class="p-0.5 border-r border-b border-[#3a3f7a]/30 text-center align-middle" style="width: 58px; height: 34px;">
            <div class="flex flex-col gap-0.5 items-center justify-center w-full">
              ${matches.map(m => {
                const bg = fdrColor(m.fdr);
                const textColor = m.fdr === 3 ? "#0b0d1a" : "#ffffff";
                const venue = m.isHome ? "(H)" : "(A)";
                return `
                  <div class="inline-flex items-center justify-center rounded w-[52px] h-[13px] shadow-xs text-[7px] font-black" 
                       style="background:${bg}; color:${textColor};">
                    ${m.opponent}${venue}
                  </div>
                `;
              }).join("")}
            </div>
          </td>
        `;
      } else {
        const m = matches[0];
        const bg = fdrColor(m.fdr);
        const textColor = m.fdr === 3 ? "#0b0d1a" : "#ffffff";
        const venue = m.isHome ? "(H)" : "(A)";
        cellsHtml += `
          <td class="p-1 border-r border-b border-[#3a3f7a]/30 text-center align-middle" style="width: 58px; height: 34px;">
            <div class="inline-flex items-center justify-center rounded w-[52px] h-[22px] shadow-xs font-black text-[8.5px]" 
                 style="background:${bg}; color:${textColor}; white-space:nowrap;">
              ${m.opponent} ${venue}
            </div>
          </td>
        `;
      }
    }

    const badgeUrl = getTeamBadgeUrl(code);

    rowsHtml += `
      <tr class="hover:bg-emerald-950/20 transition-colors">
        <td class="sticky-col border-r border-b border-[#3a3f7a]/60 font-black text-white text-left px-2 py-1 shadow-[2px_0_4px_rgba(0,0,0,0.3)]" style="width:88px; min-width:88px; max-width:88px; height:34px;">
          <div class="flex items-center gap-1.5">
            <img src="${badgeUrl}" onerror="this.style.display='none'" class="w-4 h-4 object-contain shrink-0" alt="${code}" />
            <span class="truncate text-[10.5px]">${code}</span>
          </div>
        </td>
        ${cellsHtml}
      </tr>
    `;
  });

  tbody.innerHTML = rowsHtml;
}

// 🌟 MY SQUAD MATRIX ENGINE
window.renderMySquadMatrix = function() {
  const tbody = document.getElementById("squad-matrix-body");
  if (!tbody || currentLiveSquadState.length === 0) return;

  const nextGw = currentGw + 1;
  const gw1El = document.getElementById("sm-gw1");
  const gw2El = document.getElementById("sm-gw2");
  const gw3El = document.getElementById("sm-gw3");

  if (gw1El) gw1El.textContent = `GW${nextGw}`;
  if (gw2El) gw2El.textContent = `GW${nextGw + 1}`;
  if (gw3El) gw3El.textContent = `GW${nextGw + 2}`;

  let rowsHtml = "";
  currentLiveSquadState.forEach(p => {
    const pTeamCode = formatTeamShortName(p.team);
    let fixtureCells = "";

    for (let targetGw = nextGw; targetGw <= nextGw + 2; targetGw++) {
      const matches = getFirebaseMatchesForTeam(pTeamCode, targetGw);

      if (matches.length === 0) {
        fixtureCells += `
          <td class="p-1 border-r border-b border-[#3a3f7a]/30 text-center align-middle" style="width: 72px; height: 42px;">
            <div class="inline-flex items-center justify-center rounded px-1 w-[66px] h-[26px] bg-slate-800 text-slate-400 font-black text-[8px] border border-slate-700/60">
              BLANK
            </div>
          </td>
        `;
      } else if (matches.length > 1) {
        fixtureCells += `
          <td class="p-0.5 border-r border-b border-[#3a3f7a]/30 text-center align-middle" style="width: 72px; height: 42px;">
            <div class="flex flex-col gap-0.5 items-center justify-center w-full">
              ${matches.map(m => {
                const bg = fdrColor(m.fdr);
                const textColor = m.fdr === 3 ? "#0b0d1a" : "#ffffff";
                const venue = m.isHome ? "(H)" : "(A)";
                return `
                  <div class="inline-flex items-center justify-center rounded px-1 w-[66px] h-[14px] shadow-xs text-[7.5px] font-black" 
                       style="background:${bg}; color:${textColor};">
                    ${m.opponent}${venue}
                  </div>
                `;
              }).join("")}
            </div>
          </td>
        `;
      } else {
        const m = matches[0];
        const bg = fdrColor(m.fdr);
        const textColor = m.fdr === 3 ? "#0b0d1a" : "#ffffff";
        const venue = m.isHome ? "(H)" : "(A)";
        fixtureCells += `
          <td class="p-1 border-r border-b border-[#3a3f7a]/30 text-center align-middle" style="width: 72px; height: 42px;">
            <div class="inline-flex items-center justify-center rounded px-1 w-[66px] h-[26px] shadow-xs text-[9px] font-black" 
                 style="background:${bg}; color:${textColor}; white-space:nowrap;">
              ${m.opponent} ${venue}
            </div>
          </td>
        `;
      }
    }

    const pos = p.position;
    const posBg = pos === 'GK' ? 'bg-blue-700' : pos === 'DEF' ? 'bg-red-700' : pos === 'MID' ? 'bg-yellow-600 text-black' : 'bg-green-700';
    const statusBadge = getPlayerStatusBadge(p);

    rowsHtml += `
      <tr class="hover:bg-emerald-950/20 transition-colors">
        <td class="p-1.5 text-left sticky left-0 z-30 border-r border-b border-[#3a3f7a] bg-[#2d3366] text-white font-black align-middle shadow-[2px_0_5px_rgba(0,0,0,0.4)]" style="height: 42px; width: 135px; min-width: 135px; max-width: 135px;">
          <div class="flex items-center gap-1.5 w-full">
            <span class="text-[7.5px] px-1 py-0.5 rounded font-black text-white shrink-0 ${posBg}">${pos}</span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1">
                <span class="truncate text-[10.5px] font-black text-white leading-tight">${p.name}</span>
                ${statusBadge}
              </div>
              <span class="text-[8.5px] font-bold text-[#d9d0ff] block leading-tight mt-0.5">${pTeamCode}</span>
            </div>
          </div>
        </td>
        ${fixtureCells}
        <td class="p-1 border-r border-b border-[#3a3f7a]/30 text-center align-middle text-[#38BDF8] font-black text-[11px]">${p.form ?? 0}</td>
        <td class="p-1 border-r border-b border-[#3a3f7a]/30 text-center align-middle text-[#FBBF24] font-black text-[11px]">${p.totalPoints ?? 0}</td>
        <td class="p-1 border-r border-b border-[#3a3f7a]/30 text-center align-middle text-[#FDE047] font-black text-[11px]">${p.gwPoints ?? 0}</td>
        <td class="p-1 border-r border-b border-[#3a3f7a]/30 text-center align-middle text-[#34D399] font-black text-[11px]">${p.ppg ?? 0}</td>
        <td class="p-1 border-r border-b border-[#3a3f7a]/30 text-center align-middle text-[#F472B6] font-black text-[11px]">${p.val ?? 0}</td>
        <td class="p-1 border-r border-b border-[#3a3f7a]/30 text-center align-middle text-[#FACC15] font-black text-[11px]">${p.l5 ?? 0}</td>
        <td class="p-1 border-r border-b border-[#3a3f7a]/30 text-center align-middle text-[#C084FC] font-black text-[11px]">${p.xgi ?? 0}</td>
        <td class="p-1 border-r border-b border-[#3a3f7a]/30 text-center align-middle text-[#F43F5E] font-black text-[11px]">${p.ict ?? 0}</td>
        <td class="p-1 border-b border-[#3a3f7a]/30 text-center align-middle text-white font-black text-[10px]">${p.ownership ?? 0}%</td>
      </tr>
    `;
  });

  tbody.innerHTML = rowsHtml;
};

// 🌟 TEAM FILTER MODAL
function initTeamFilterModalOptions() {
  const container = document.getElementById("team-options-list");
  if (!container) return;

  let html = `
    <div onclick="window.selectTeamFilter('all')" class="p-2.5 rounded-xl bg-black/40 border border-white/10 flex items-center justify-between cursor-pointer active:scale-98">
      <span class="text-xs font-bold text-white">Show All Teams (20 Clubs)</span>
      <span class="text-xs text-[#8c6dff]">✓</span>
    </div>
  `;

  Object.keys(TEAM_NAMES_FULL).forEach(code => {
    const badgeUrl = getTeamBadgeUrl(code);
    html += `
      <div onclick="window.selectTeamFilter('${code}')" class="p-2 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between cursor-pointer active:scale-98">
        <div class="flex items-center gap-2">
          <img src="${badgeUrl}" onerror="this.style.display='none'" class="w-4 h-4 object-contain" alt="${code}" />
          <span class="text-xs font-bold text-gray-200">${TEAM_NAMES_FULL[code]} (${code})</span>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

window.openTeamModal = function() {
  const modal = document.getElementById("team-modal");
  if (modal) {
    modal.style.display = "flex";
    modal.classList.remove("hidden");
  }
};

window.closeTeamModal = function() {
  const modal = document.getElementById("team-modal");
  if (modal) {
    modal.style.display = "none";
    modal.classList.add("hidden");
  }
};

window.selectTeamFilter = function(code) {
  activeTeamFilter = code;
  const label = document.getElementById("selected-team-label");
  if (label) {
    label.textContent = code === "all" ? "Show All Teams" : (TEAM_NAMES_FULL[code] || code);
  }
  window.closeTeamModal();
  render20TeamsMatrix();
};
