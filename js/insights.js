import { auth, db } from "../js/firebase-config.js";
import { getFixturesSnap, getScoutSnap, getLeagueStandingsSnap, onLeagueTeam } from "./core/data.js";
import { onAuthStateChanged } from "./core/auth.js";
import { collection, doc, getDoc, getDocs } from "./core/fs.js";

// Global Storage
let currentLiveSquadState = [];
let allPlayersCache = [];
let firebaseFixturesCache = [];
let currentFplTeamId = null;
let currentGw = 5;
let activeTeamFilter = "all";

const FIXTURES_CACHE_KEY = "twf_fixtures_cache";
const FIXTURES_CACHE_TIME_KEY = "twf_fixtures_cache_time";
const SCOUT_CACHE_KEY = "twf_scout_players_cache_v3";
const SCOUT_CACHE_TIME_KEY = "twf_scout_players_cache_time_v3";
const CACHE_DURATION = 2 * 60 * 60 * 1000;

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

function formatTeamShortName(rawName) {
  if (!rawName) return "—";
  const clean = String(rawName).trim().toLowerCase();
  return TEAM_SHORT_CODES[clean] || (rawName.length > 4 ? rawName.slice(0, 3).toUpperCase() : rawName.toUpperCase());
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

// 🗓️ Firebase မှ Team တစ်ခု၏ Match များကို ဆွဲထုတ်ခြင်း (BGW နှင့် DGW ကို စစ်ဆေးနိုင်ရန် Array ပြန်ပေးသည်)
function getFirebaseMatchesForTeam(teamCode, targetGw) {
  if (!firebaseFixturesCache || !teamCode) return [];
  const clean = String(teamCode).trim().toUpperCase();
  const teamId = Object.keys(TEAM_ID_MAP).find(k => TEAM_ID_MAP[k] === clean);
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

// 🛡️ Data Initialization
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.go("login"); return; }

  const uSnap = await getDoc(doc(db, "users", user.uid));
  if (!uSnap.exists()) { window.go("login"); return; }

  currentFplTeamId = String(uSnap.data().fplTeamId);

  await loadFixturesCache();
  await loadScoutCache();
  await loadUserSquad();

  build20TeamsMatrixHeader();
  render20TeamsMatrix();
  initTeamFilterModalOptions();
});

async function loadFixturesCache() {
  const now = Date.now();
  const cachedFix = localStorage.getItem(FIXTURES_CACHE_KEY);
  const cachedFixTime = localStorage.getItem(FIXTURES_CACHE_TIME_KEY);

  if (cachedFix && cachedFixTime && (now - Number(cachedFixTime) < CACHE_DURATION)) {
    try {
      firebaseFixturesCache = JSON.parse(cachedFix);
      return;
    } catch (e) {
      console.warn("Corrupt fixtures cache:", e);
    }
  }

  try {
    const fSnap = await getFixturesSnap();
    firebaseFixturesCache = [];
    fSnap.forEach(d => firebaseFixturesCache.push({ id: d.id, ...d.data() }));
    localStorage.setItem(FIXTURES_CACHE_KEY, JSON.stringify(firebaseFixturesCache));
    localStorage.setItem(FIXTURES_CACHE_TIME_KEY, String(now));
  } catch (e) {
    console.warn("Error fetching fixtures:", e);
  }
}

async function loadScoutCache() {
  const now = Date.now();
  const cachedScout = localStorage.getItem(SCOUT_CACHE_KEY);
  const cachedScoutTime = localStorage.getItem(SCOUT_CACHE_TIME_KEY);

  if (cachedScout && cachedScoutTime && (now - Number(cachedScoutTime) < CACHE_DURATION)) {
    try {
      allPlayersCache = JSON.parse(cachedScout);
      return;
    } catch (e) {
      console.warn("Corrupt scout cache:", e);
    }
  }

  try {
    const snap = await getScoutSnap();
    allPlayersCache = [];
    snap.forEach(d => {
      const data = d.data();
      allPlayersCache.push({
        id: String(d.id),
        playerId: String(data.playerId !== undefined ? data.playerId : d.id),
        ...data,
        price: parseFloat(data.price || 0),
        ownership: parseFloat(String(data.ownership).replace(/[^\d.-]/g, '')) || 0,
        totalPoints: parseInt(data.totalPoints) || 0,
        gwPoints: parseInt(data.gwPoints) || 0,
        form: parseFloat(data.form) || 0,
        ppg: parseFloat(data.ppg || 0),
        val: parseFloat(data.val || 0),
        l5: parseFloat(data.l5 || 0),
        xgi: parseFloat(data.xgi || 0),
        ict: parseFloat(data.ict || 0),
        position: String(data.position || "DEF").toUpperCase().trim(),
        team: data.team || "—"
      });
    });
    localStorage.setItem(SCOUT_CACHE_KEY, JSON.stringify(allPlayersCache));
    localStorage.setItem(SCOUT_CACHE_TIME_KEY, String(now));
  } catch (err) {
    console.warn("Scout load error:", err);
  }
}

async function loadUserSquad() {
  try {
    const squadSnap = await getDoc(doc(db, "liveTeams", currentFplTeamId));
    if (squadSnap.exists()) {
      const teamData = squadSnap.data();
      currentGw = Number(teamData.gameweek || 5);
      const gwLabel = document.getElementById("gw-header-label");
      if (gwLabel) gwLabel.textContent = `GW ${currentGw}`;

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

      // Position အလိုက် စီတန်းခြင်း (GK -> DEF -> MID -> FWD)
      const gk = []; const def = []; const mid = []; const fwd = [];
      currentLiveSquadState.forEach(p => {
        if (p.position === "GK") gk.push(p);
        else if (p.position === "DEF") def.push(p);
        else if (p.position === "MID") mid.push(p);
        else fwd.push(p);
      });
      currentLiveSquadState = [...gk, ...def, ...mid, ...fwd];
    }
  } catch (err) {
    console.error("Error loading squad data:", err);
  }
}

// 🌟 ၁။ 20 TEAMS MATRIX ENGINE (38 GWs Full Table)
function build20TeamsMatrixHeader() {
  const headerRow = document.getElementById("fixture-header-row");
  if (!headerRow) return;

  let ths = `<th class="sticky left-0 top-0 z-40 bg-[#0b0d1a] border-r border-b border-[#3a3f7a] px-2.5 py-2 text-left font-black text-[#b3a1ff] shadow-[2px_0_5px_rgba(0,0,0,0.5)]" style="width: 78px; min-width: 78px; max-width: 78px;">TEAM</th>`;
  for (let gw = 1; gw <= 38; gw++) {
    const isCurrent = gw === currentGw;
    const isNext = gw === currentGw + 1;
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

  const teamCodes = Object.values(TEAM_ID_MAP);
  let rowsHtml = "";

  teamCodes.forEach(code => {
    if (activeTeamFilter !== "all" && activeTeamFilter !== code) return;

    let cellsHtml = "";
    for (let gw = 1; gw <= 38; gw++) {
      const matches = getFirebaseMatchesForTeam(code, gw);

      // 🔴 BGW: Blank Gameweek (ပွဲမရှိပါ)
      if (matches.length === 0) {
        cellsHtml += `
          <td class="p-1 border-r border-b border-[#3a3f7a]/30 text-center align-middle" style="width: 58px; height: 34px;">
            <div class="inline-flex items-center justify-center rounded w-[52px] h-[22px] bg-slate-800 text-slate-400 font-black text-[7.5px] border border-slate-700/50">
              BLANK
            </div>
          </td>
        `;
      } 
      // 🟢 DGW: Double Gameweek (တစ်ပတ် ၂ ပွဲ)
      else if (matches.length > 1) {
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
      } 
      // ⚪ Single Gameweek (၁ ပွဲ)
      else {
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

    rowsHtml += `
      <tr class="hover:bg-emerald-950/20 transition-colors">
        <td class="sticky left-0 z-20 bg-[#2d3366] border-r border-b border-[#3a3f7a]/60 font-black text-white text-left px-2 py-1 shadow-[2px_0_4px_rgba(0,0,0,0.3)]" style="width:78px; min-width:78px; max-width:78px; height:34px;">
          ${code}
        </td>
        ${cellsHtml}
      </tr>
    `;
  });

  tbody.innerHTML = rowsHtml;
}

// 🌟 ၂။ MY SQUAD MATRIX ENGINE (Next 3 GWs: BGW, DGW + Stats)
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

    // နောင်လာမည့် GW (၃) ခုအတွက် စစ်ဆေးတွက်ချက်ခြင်း
    for (let targetGw = nextGw; targetGw <= nextGw + 2; targetGw++) {
      const matches = getFirebaseMatchesForTeam(pTeamCode, targetGw);

      // 🔴 BGW: Blank Gameweek
      if (matches.length === 0) {
        fixtureCells += `
          <td class="p-1 border-r border-b border-[#3a3f7a]/30 text-center align-middle" style="width: 72px; height: 38px;">
            <div class="inline-flex items-center justify-center rounded px-1 w-[66px] h-[24px] bg-slate-800 text-slate-400 font-black text-[8px] border border-slate-700/60">
              BLANK
            </div>
          </td>
        `;
      }
      // 🟢 DGW: Double Gameweek
      else if (matches.length > 1) {
        fixtureCells += `
          <td class="p-0.5 border-r border-b border-[#3a3f7a]/30 text-center align-middle" style="width: 72px; height: 38px;">
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
      }
      // ⚪ Single Match
      else {
        const m = matches[0];
        const bg = fdrColor(m.fdr);
        const textColor = m.fdr === 3 ? "#0b0d1a" : "#ffffff";
        const venue = m.isHome ? "(H)" : "(A)";
        fixtureCells += `
          <td class="p-1 border-r border-b border-[#3a3f7a]/30 text-center align-middle" style="width: 72px; height: 38px;">
            <div class="inline-flex items-center justify-center rounded px-1 w-[66px] h-[24px] shadow-xs text-[9px] font-black" 
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
        <td class="p-1.5 text-left sticky left-0 z-30 border-r border-b border-[#3a3f7a] bg-[#2d3366] text-white font-black truncate max-w-[105px] align-middle shadow-[2px_0_5px_rgba(0,0,0,0.4)]" style="height: 38px; width:105px; min-width:105px;">
          <div class="flex items-center gap-1.5 truncate">
            <span class="text-[7.5px] px-1 py-0.5 rounded font-black text-white shrink-0 ${posBg}">${pos}</span>
            <span class="truncate text-[10.5px]">${p.name}</span>
            ${statusBadge}
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
    <div onclick="selectTeamFilter('all')" class="p-2.5 rounded-xl bg-black/40 border border-white/10 flex items-center justify-between cursor-pointer active:scale-98">
      <span class="text-xs font-bold text-white">Show All Teams (20 Clubs)</span>
      <span class="text-xs text-[#8c6dff]">✓</span>
    </div>
  `;

  Object.keys(TEAM_NAMES_FULL).forEach(code => {
    html += `
      <div onclick="selectTeamFilter('${code}')" class="p-2 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between cursor-pointer active:scale-98">
        <span class="text-xs font-bold text-gray-200">${TEAM_NAMES_FULL[code]} (${code})</span>
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
  closeTeamModal();
  render20TeamsMatrix();
};

window.resetDraftToFPLRealtime = function() {
  localStorage.removeItem(FIXTURES_CACHE_KEY);
  localStorage.removeItem(FIXTURES_CACHE_TIME_KEY);
  localStorage.removeItem(SCOUT_CACHE_KEY);
  localStorage.removeItem(SCOUT_CACHE_TIME_KEY);
  location.reload();
};
