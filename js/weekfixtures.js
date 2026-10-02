import { auth, db } from "../js/firebase-config.js";
import { getFixturesSnap, getScoutSnap, getLeagueStandingsSnap, onLeagueTeam } from "./core/data.js";
import { onAuthStateChanged } from "./core/auth.js";
import { 
  doc, getDoc, collection, getDocs, 
  getDocsFromServer 
} from "./core/fs.js";

const teamDetailsMap = {
  1: { name: "Arsenal", short: "ARS", code: "ars" },
  2: { name: "Aston Villa", short: "AVL", code: "avl" },
  3: { name: "AFC Bournemouth", short: "BOU", code: "bou" },
  4: { name: "Brentford", short: "BRE", code: "bre" },
  5: { name: "Brighton & Hove Albion", short: "BHA", code: "bha" },
  6: { name: "Chelsea", short: "CHE", code: "che" },
  7: { name: "Coventry City", swift: "COV", short: "COV", code: "cov" },
  8: { name: "Crystal Palace", short: "CRY", code: "cry" },
  9: { name: "Everton", short: "EVE", code: "eve" },
  10: { name: "Fulham", short: "FUL", code: "ful" },
  11: { name: "Hull City", short: "HUL", code: "hul" },
  12: { name: "Ipswich Town", short: "IPS", code: "ips" },
  13: { name: "Leeds United", short: "LEE", code: "lee" },
  14: { name: "Liverpool", short: "LIV", code: "liv" },
  15: { name: "Manchester City", short: "MCI", code: "mci" },
  16: { name: "Manchester United", short: "MUN", code: "mun" },
  17: { name: "Newcastle United", short: "NEW", code: "new" },
  18: { name: "Nottingham Forest", short: "NFO", code: "nfo" },
  19: { name: "Tottenham Hotspur", short: "TOT", code: "tot" },
  20: { name: "Sunderland", short: "SUN", code: "sun" }
};

let firebaseFixturesList = [];
let selectedGameweek = 6;
let currentFilterMode = "all";

const FIXTURES_CACHE_KEY = "twf_fixtures_cache_v2";
const FIXTURES_LIVE_TIME_KEY = "twf_fixtures_live_time_v2";
const FINISHED_GWS_CACHE_KEY = "twf_finished_gws_v2";

const ONE_HOUR_MS = 60 * 60 * 1000;

// Helper: ပွဲပြီး/မပြီး စစ်ဆေးခြင်း
const checkIsFinished = (f) => f.finished === true || f.finished_provisional === true || Number(f.minutes || 0) >= 90;

// =========================================================================
// 🌟 OFFLINE FIRST ENGINE: Auth မစောင့်ဘဲ Local Cache ဖြင့် ချက်ချင်း Render လုပ်ခြင်း
// =========================================================================

function mountOfflineCacheImmediately() {
  try {
    initModalElement();
    const cachedData = localStorage.getItem(FIXTURES_CACHE_KEY);
    if (cachedData) {
      firebaseFixturesList = JSON.parse(cachedData);
      
      const unFinishedMatches = firebaseFixturesList
        .filter(f => !checkIsFinished(f) && f.event)
        .sort((a, b) => Number(a.event) - Number(b.event));

      if (unFinishedMatches.length > 0) {
        selectedGameweek = Number(unFinishedMatches[0].event);
      } else {
        const savedCurrentGw = localStorage.getItem("twf_current_gw");
        selectedGameweek = savedCurrentGw ? (Number(savedCurrentGw) + 1) : 6;
      }

      setupCustomDropdown();
      renderFixturesTimeline();
    }
  } catch (err) {
    console.warn("Immediate fixtures offline mount failed:", err);
  }
}

if (document.readyState === "loading") {
  queueMicrotask( () => mountOfflineCacheImmediately());
} else {
  mountOfflineCacheImmediately();
}

// 💡 Gameweek တစ်ခုလုံး ပွဲပြီးသွားခြင်း ရှိ/မရှိ စစ်ဆေးခြင်း
function isSelectedGwFullyFinished(gwNum) {
  const finishedGwsCache = localStorage.getItem(FINISHED_GWS_CACHE_KEY);
  if (finishedGwsCache) {
    try {
      const parsed = JSON.parse(finishedGwsCache);
      if (parsed[gwNum] && parsed[gwNum].length > 0) return true;
    } catch (_) {}
  }

  const gwMatches = firebaseFixturesList.filter(f => Number(f.event) === Number(gwNum));
  return (gwMatches.length > 0 && gwMatches.every(checkIsFinished));
}

// 💡 Gameweek တွင် Live ကစားနေသော ပွဲစဉ်များ ရှိ/မရှိ စစ်ဆေးခြင်း
function hasLiveMatchesCurrently(gwNum) {
  const targetMatches = firebaseFixturesList.filter(f => Number(f.event) === Number(gwNum));
  if (targetMatches.length === 0) return false;

  return targetMatches.some(f => {
    const isFin = checkIsFinished(f);
    return (Boolean(f.started) && !isFin);
  });
}

function showFixturesToast(msg, isError = false) {
  let toast = document.getElementById("tw-fixtures-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "tw-fixtures-toast";
    toast.className = "fixed top-4 left-1/2 -translate-x-1/2 z-[99999] px-4 py-2.5 rounded-xl text-xs font-bold text-center transition-all duration-300 opacity-0 pointer-events-none shadow-2xl border max-w-[90%]";
    document.body.appendChild(toast);
  }

  toast.textContent = msg;
  toast.style.background = isError ? "linear-gradient(135deg, #7f1d1d, #450a0a)" : "linear-gradient(135deg, #1b1f3a, #14172b)";
  toast.style.color = isError ? "#fecaca" : "#b3a1ff";
  toast.style.borderColor = isError ? "#ef4444" : "#b3a1ff";
  toast.style.boxShadow = isError ? "0 8px 24px rgba(239, 68, 68, 0.7)" : "0 8px 20px rgba(179,161,255, 0.3)";

  toast.classList.remove("opacity-0");
  toast.classList.add("opacity-100");

  clearTimeout(window.fixturesToastTimeout);
  window.fixturesToastTimeout = setTimeout(() => {
    toast.classList.remove("opacity-100");
    toast.classList.add("opacity-0");
  }, 3200);
}

// 🔄 ဝင်ဝင်ချင်း Fake Refresh Animation
function triggerInitialFakeRefreshUI() {
  const btn = document.getElementById("btn-refresh-fixtures") || 
              document.querySelector("button[onclick*='forceRefreshFixtures']") ||
              document.querySelector("button[onclick*='Refresh']");
  
  const icon = document.getElementById("refresh-fixtures-icon") || 
               (btn ? btn.querySelector("svg, span, i") : null);

  if (icon) icon.classList.add("animate-spin");
  if (btn) {
    btn.style.setProperty("background-color", "#8c6dff", "important");
    btn.style.setProperty("color", "#14172b", "important");
    btn.style.setProperty("border-color", "#b3a1ff", "important");
  }

  setTimeout(() => {
    if (icon) icon.classList.remove("animate-spin");
    if (btn) {
      btn.style.removeProperty("background-color");
      btn.style.removeProperty("color");
      btn.style.removeProperty("border-color");
    }
  }, 1200);
}

// =========================================================================
// 🔄 REFRESH BUTTON (ပြီးပြီးသား Week ဆိုလျှင် Quota သေ - Live ကျမှ ဆွဲမည်)
// =========================================================================
window.forceRefreshFixtures = async function() {
  if (!navigator.onLine) {
    mountOfflineCacheImmediately();
    showFixturesToast("⚠️ အော့ဖ်လိုင်းမုဒ်: အင်တာနက်မရှိသေးပါခင်ဗျာ!", true);
    return;
  }

  const btn = document.getElementById("btn-refresh-fixtures") || 
              document.querySelector("button[onclick*='forceRefreshFixtures']") ||
              document.querySelector("button[onclick*='Refresh']");
  
  const icon = document.getElementById("refresh-fixtures-icon") || 
               (btn ? btn.querySelector("svg, span, i") : null);

  if (isSelectedGwFullyFinished(selectedGameweek)) {
    showFixturesToast(`🔒 Gameweek ${selectedGameweek} ပွဲစဉ်များ အားလုံးပြီးဆုံးထားပြီး ဖြစ်ပါသည်!`, false);
    return;
  }

  const isLive = hasLiveMatchesCurrently(selectedGameweek);
  if (!isLive) {
    showFixturesToast(`ℹ️ Gameweek ${selectedGameweek} တွင် Live ကစားနေသောပွဲ မရှိသေးပါခင်ဗျာ!`, false);
    return;
  }

  const lastTime = localStorage.getItem(FIXTURES_LIVE_TIME_KEY);
  if (lastTime) {
    const elapsed = Date.now() - Number(lastTime);
    if (elapsed < ONE_HOUR_MS) {
      const remain = Math.ceil((ONE_HOUR_MS - elapsed) / 60000);
      showFixturesToast(`⏳ Live ပွဲရလဒ် အသစ်များကို နောက်ထပ် (${remain}) မိနစ်အကြာမှ ရရှိပါမည်!`, false);
      return;
    }
  }

  if (btn) {
    btn.disabled = true;
    btn.style.setProperty("background-color", "#8c6dff", "important");
    btn.style.setProperty("color", "#14172b", "important");
    btn.style.setProperty("border-color", "#b3a1ff", "important");
  }
  if (icon) icon.classList.add("animate-spin");

  showFixturesToast("🔄 Live ပွဲစဉ်ရလဒ် အသစ်များ ဆွဲယူနေပါသည်...");

  try {
    const projectId = db.app.options.projectId;
    if (projectId) {
      const pingUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/fixtures?pageSize=1`;
      const pingRes = await fetch(pingUrl);
      if (!pingRes.ok) {
        throw new Error(`FIREBASE_MAINTAIN_OR_QUOTA_${pingRes.status}`);
      }
    }

    const isSuccess = await buildMatchCenterSystem(true);

    if (isSuccess) {
      localStorage.setItem(FIXTURES_LIVE_TIME_KEY, String(Date.now()));
      showFixturesToast("✅ Live ပွဲစဉ်ရလဒ်များ အသစ်ရရှိပါပြီ!");
    } else {
      throw new Error("FETCH_FAILED");
    }
  } catch (err) {
    console.error("Live Fixtures Refresh Error:", err);
    mountOfflineCacheImmediately();
    showFixturesToast("⚠️ ဒေတာဟောင်းများကို ပြသပေးထားပါသည်ခင်ဗျာ!", false);
  } finally {
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.style.removeProperty("background-color");
        btn.style.removeProperty("color");
        btn.style.removeProperty("border-color");
      }
      if (icon) icon.classList.remove("animate-spin");
    }, 400);
  }
};

// =========================================================================
// ⚽ MATCH CENTER DATA ENGINE (OFFLINE-SAFE)
// =========================================================================

onAuthStateChanged(auth, async (user) => {
  triggerInitialFakeRefreshUI();

  if (!user) {
    if (!navigator.onLine || localStorage.getItem(FIXTURES_CACHE_KEY)) {
      mountOfflineCacheImmediately();
      return;
    }
    window.go("login");
    return;
  }

  if (navigator.onLine) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) { 
        window.go("login"); 
        return; 
      }
      await buildMatchCenterSystem(false);
    } catch (err) {
      console.warn("Silent auth bypassed (Offline Mode):", err);
      mountOfflineCacheImmediately();
    }
  } else {
    mountOfflineCacheImmediately();
  }
});

async function buildMatchCenterSystem(forceFresh = false) {
  try {
    initModalElement();

    const cachedData = localStorage.getItem(FIXTURES_CACHE_KEY);

    if (!forceFresh && cachedData) {
      try {
        firebaseFixturesList = JSON.parse(cachedData);
      } catch (e) {
        firebaseFixturesList = [];
      }
    }

    if (!navigator.onLine) {
      mountOfflineCacheImmediately();
      return true;
    }

    if (firebaseFixturesList.length === 0 || forceFresh) {
      const querySnapshot = forceFresh
        ? await getFixturesSnap(true)
        : await getFixturesSnap();
      
      firebaseFixturesList = [];
      querySnapshot.forEach((d) => {
        firebaseFixturesList.push({ id: d.id, ...d.data() });
      });

      cacheFinishedGameweeks(firebaseFixturesList);
      localStorage.setItem(FIXTURES_CACHE_KEY, JSON.stringify(firebaseFixturesList));
    }

    const unFinishedMatches = firebaseFixturesList
      .filter(f => !checkIsFinished(f) && f.event)
      .sort((a, b) => Number(a.event) - Number(b.event));

    if (unFinishedMatches.length > 0) {
      selectedGameweek = Number(unFinishedMatches[0].event);
    } else {
      const savedCurrentGw = localStorage.getItem("twf_current_gw");
      selectedGameweek = savedCurrentGw ? (Number(savedCurrentGw) + 1) : 6;
    }

    setupCustomDropdown();
    renderFixturesTimeline();
    return true;
  } catch (err) {
    if (forceFresh) throw err;
    console.error("Match center data error (Falling back to offline cache):", err);
    mountOfflineCacheImmediately();
    return false;
  }
}

function cacheFinishedGameweeks(allFixtures) {
  try {
    let finishedGws = {};
    const existing = localStorage.getItem(FINISHED_GWS_CACHE_KEY);
    if (existing) {
      try { finishedGws = JSON.parse(existing); } catch (_) {}
    }

    for (let gw = 1; gw <= 38; gw++) {
      const gwMatches = allFixtures.filter(f => Number(f.event) === gw);
      if (gwMatches.length > 0 && gwMatches.every(checkIsFinished)) {
        finishedGws[gw] = gwMatches;
      }
    }
    localStorage.setItem(FINISHED_GWS_CACHE_KEY, JSON.stringify(finishedGws));
  } catch (e) {
    console.warn("Finished GWs Cache note:", e);
  }
}

// 🌟 FIXTURE DROPDOWN FRAME
function setupCustomDropdown() {
  const container = document.getElementById("gw-selector-container");
  if (!container) return;

  container.innerHTML = `
    <div class="relative inline-block text-left w-full max-w-[170px]">
      <button id="gw-dropdown-btn" onclick="toggleGwDropdown()" class="w-full flex items-center justify-between px-3.5 py-1.5 rounded-lg text-xs font-black text-white bg-[#2d3366] border border-[#3a3f7a] focus:outline-none transition-all shadow-md cursor-pointer">
        <span class="truncate">Gameweek ${selectedGameweek}</span>
        <svg class="w-3.5 h-3.5 ml-1.5 text-[#b3a1ff] transition-transform duration-200 shrink-0" id="gw-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M19 9l-7 7-7-7"></path></svg>
      </button>
      
      <div id="gw-dropdown-menu" class="hidden absolute right-0 mt-1 w-full max-w-[170px] max-h-[260px] overflow-y-auto rounded-xl shadow-2xl bg-[#2d3366] border border-[#3a3f7a] z-50 transition-all">
        <div class="py-1">
          ${Array.from({ length: 38 }, (_, i) => i + 1).map(w => {
            const isFin = isSelectedGwFullyFinished(w);
            const isSelected = (w === selectedGameweek);
            const activeClass = isSelected ? 'text-[#b3a1ff] bg-[#2d3366]' : 'text-white/80 hover:bg-[#2d3366] hover:text-white';
            return `
              <button onclick="selectCustomGw(${w})" class="w-full text-left px-3.5 py-2 text-xs font-bold transition-all flex items-center justify-between cursor-pointer ${activeClass}">
                <span class="flex items-center gap-2">
                  Gameweek ${w}${isFin ? '<span class="w-1.5 h-1.5 rounded-full bg-red-500 inline-block shadow-xs"></span>' : ''}
                </span>
                ${isSelected ? `<span class="w-1.5 h-1.5 rounded-full bg-[#b3a1ff] shrink-0"></span>` : ''}
              </button>
            `;
          }).join("")}
        </div>
      </div>
    </div>
  `;
}

window.toggleGwDropdown = () => {
  const menu = document.getElementById("gw-dropdown-menu");
  const arrow = document.getElementById("gw-arrow");
  if (!menu) return;

  if (menu.classList.contains("hidden")) {
    menu.classList.remove("hidden");
    if (arrow) arrow.style.transform = "rotate(180deg)";
  } else {
    menu.classList.add("hidden");
    if (arrow) arrow.style.transform = "rotate(0deg)";
  }
};

window.selectCustomGw = (gwNumber) => {
  selectedGameweek = Number(gwNumber);
  
  const btn = document.getElementById("gw-dropdown-btn");
  if (btn) {
    const labelSpan = btn.querySelector("span");
    if (labelSpan) labelSpan.innerText = `Gameweek ${gwNumber}`;
  }

  window.toggleGwDropdown();
  setupCustomDropdown();
  renderFixturesTimeline();
};

document.addEventListener("click", (e) => {
  const menu = document.getElementById("gw-dropdown-menu");
  const btn = document.getElementById("gw-dropdown-btn");
  if (menu && btn && !btn.contains(e.target) && !menu.contains(e.target)) {
    menu.classList.add("hidden");
    const arrow = document.getElementById("gw-arrow");
    if (arrow) arrow.style.transform = "rotate(0deg)";
  }
});

// ⚡ LOGO SIZE ကို w-8 h-8 (32px) အဖြစ် ပိုမိုထင်ရှားစွာ ချဲ့ထွင်ထားသည်
function teamBadgeHtml(teamId, isHome = true) {
  const t = teamDetailsMap[teamId];
  if (!t) return `<span class="text-slate-800 text-sm font-bold">—</span>`;
  
  if (isHome) {
    return `
      <div class="flex items-center gap-2">
        <img src="./assets/badges/${teamId}.${t.code}.png" class="w-8 h-8 object-contain shrink-0 drop-shadow-sm transition-transform hover:scale-110" onerror="this.style.display='none'; this.onerror=null;" alt="${t.short}" />
        <span class="text-slate-900 text-[13px] font-black tracking-wide">${t.short}</span>
      </div>
    `;
  } else {
    return `
      <div class="flex items-center justify-end gap-2">
        <span class="text-slate-900 text-[13px] font-black tracking-wide">${t.short}</span>
        <img src="./assets/badges/${teamId}.${t.code}.png" class="w-8 h-8 object-contain shrink-0 drop-shadow-sm transition-transform hover:scale-110" onerror="this.style.display='none'; this.onerror=null;" alt="${t.short}" />
      </div>
    `;
  }
}

// ⏰ မြန်မာစံတော်ချိန် (MMT: UTC+6:30)
function translateToMyanmarTime(kickoffUtcString) {
  if (!kickoffUtcString) return { date: "TBC", time: "ညှိနှိုင်းဆဲ" };
  
  const utcDate = new Date(kickoffUtcString);
  utcDate.setHours(utcDate.getHours() - 1);

  const dateOptions = { timeZone: "Asia/Yangon", weekday: "short", day: "numeric", month: "short" };
  const timeOptions = { timeZone: "Asia/Yangon", hour: "2-digit", minute: "2-digit", hour12: false };
  
  let dateStr = utcDate.toLocaleDateString("en-GB", dateOptions);
  let timeStr = utcDate.toLocaleTimeString("en-GB", timeOptions);
  
  return { date: dateStr, time: timeStr + " MMT" };
}

function renderFixturesTimeline() {
  const listEl = document.getElementById("fixtures-list");
  if (!listEl) return;
  
  let targetedFixtures = [];

  const finishedCache = localStorage.getItem(FINISHED_GWS_CACHE_KEY);
  if (finishedCache) {
    try {
      const parsed = JSON.parse(finishedCache);
      if (parsed[selectedGameweek] && parsed[selectedGameweek].length > 0) {
        targetedFixtures = parsed[selectedGameweek];
      }
    } catch (_) {}
  }

  if (targetedFixtures.length === 0) {
    targetedFixtures = firebaseFixturesList.filter(f => Number(f.event) === Number(selectedGameweek));
  }

  if (currentFilterMode === "upcoming") targetedFixtures = targetedFixtures.filter(f => !checkIsFinished(f) && !f.started);
  if (currentFilterMode === "finished") targetedFixtures = targetedFixtures.filter(f => checkIsFinished(f));

  if (targetedFixtures.length === 0) {
    listEl.innerHTML = `<p class="text-center text-xs py-16 text-slate-400 font-bold">ယခု အပတ်အတွက် ပွဲစဉ်မရှိပါဗျာ</p>`;
    return;
  }

  targetedFixtures.sort((a, b) => new Date(a.kickoff_time) - new Date(b.kickoff_time));

  listEl.innerHTML = `
    <div class="space-y-2.5">
      ${targetedFixtures.map(f => {
        const { date, time } = translateToMyanmarTime(f.kickoff_time);
        const isFinished = checkIsFinished(f);
        const isLive = Boolean(f.started) && !isFinished;
        const hasStats = Boolean(f.stats && f.stats.length > 0 && (isLive || isFinished));

        return `
        <div onclick="openMatchStatsModal('${f.id}')" class="rounded-2xl p-3 flex flex-col transition bg-white border border-slate-100 shadow-sm cursor-pointer active:scale-[0.99] hover:border-emerald-300">
          
          <div class="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-100">
            <span class="text-[11px] font-black text-slate-800">${date}</span>
            <div class="flex items-center gap-1.5">
              ${isLive 
                ? `<span class="text-[9px] px-2 py-0.5 rounded-md font-black animate-pulse bg-red-600 text-white">LIVE NOW</span>` 
                : isFinished 
                ? `<span class="text-[9px] px-2 py-0.5 rounded-md font-bold bg-slate-100 text-slate-500">FULL TIME</span>`
                : `<span class="text-[11px] font-black text-slate-700">${time}</span>`
              }
              ${hasStats ? `<span class="text-[10px]">📊</span>` : ''}
            </div>
          </div>
          
          <div class="flex items-center justify-between px-1">
            <div class="w-[38%] flex justify-start">${teamBadgeHtml(f.team_h, true)}</div>
            
            <div class="w-[24%] text-center">
              <span class="inline-block font-black px-2.5 py-1 rounded-xl bg-slate-100 text-slate-700" style="font-family:'Bebas Neue'; font-size:1.25rem; letter-spacing:0.05em;">
                ${isFinished || isLive ? `${f.team_h_score ?? 0} - ${f.team_a_score ?? 0}` : 'VS'}
              </span>
            </div>
            
            <div class="w-[38%] flex justify-end">${teamBadgeHtml(f.team_a, false)}</div>
          </div>

        </div>`;
      }).join("")}
    </div>
  `;
}

window.filterFixtures = (filter) => {
  currentFilterMode = filter;
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.style.borderColor = "transparent";
    b.style.color = "#8c6dff";
  });
  const activeBtn = document.getElementById("tab-" + filter);
  if (activeBtn) { 
    activeBtn.style.borderColor = "#8c6dff"; 
    activeBtn.style.color = "#8c6dff"; 
  }
  renderFixturesTimeline();
};

function initModalElement() {
  if (document.getElementById("match-stats-modal")) return;
  const modalDiv = document.createElement("div");
  modalDiv.id = "match-stats-modal";
  modalDiv.className = "hidden fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-[99999]";
  modalDiv.innerHTML = `
    <div class="w-full max-w-sm rounded-2xl p-4 flex flex-col max-h-[85vh] bg-[#2d3366] border border-[#3a3f7a] shadow-2xl text-white">
      <div id="modal-match-header" class="border-b border-[#3a3f7a]/60 pb-3"></div>
      <div id="modal-match-body" class="overflow-y-auto py-3 space-y-3 flex-1 text-xs"></div>
      <button onclick="closeMatchStatsModal()" class="w-full mt-2 py-2 rounded-xl font-bold bg-[#2d3366] hover:bg-[#3a3f7a] text-white transition text-xs border border-[#3a3f7a] cursor-pointer">Close</button>
    </div>
  `;
  document.body.appendChild(modalDiv);
}

window.openMatchStatsModal = (matchId) => {
  const match = firebaseFixturesList.find(m => String(m.id) === String(matchId));
  if (!match) return;

  const homeTeam = teamDetailsMap[match.team_h]?.name || "Home";
  const awayTeam = teamDetailsMap[match.team_a]?.name || "Away";
  const isFinished = checkIsFinished(match);

  const headerEl = document.getElementById("modal-match-header");
  headerEl.innerHTML = `
    <div class="flex items-center justify-between mb-1">
      <span class="text-[10px] uppercase tracking-wider text-white/60">${isFinished ? 'Full Time' : match.started ? 'Live Match' : 'Upcoming'}</span>
      <span class="text-[10px] text-[#b3a1ff] font-black">${match.minutes ? match.minutes + "'" : ''}</span>
    </div>
    <div class="flex items-center justify-between">
      <span class="font-bold text-sm text-left flex-1">${homeTeam}</span>
      <span class="px-3 py-1 rounded bg-black/30 font-black text-lg text-[#b3a1ff] font-['Bebas_Neue'] tracking-widest mx-2">
        ${match.started || isFinished ? `${match.team_h_score ?? 0} - ${match.team_a_score ?? 0}` : 'VS'}
      </span>
      <span class="font-bold text-sm text-right flex-1">${awayTeam}</span>
    </div>
  `;

  const bodyEl = document.getElementById("modal-match-body");
  const stats = match.stats || [];

  if (!match.started && !isFinished) {
    bodyEl.innerHTML = `<p class="text-center text-white/50 py-6">ပွဲမစတင်သေးပါဗျာ</p>`;
  } else if (stats.length === 0) {
    bodyEl.innerHTML = `<p class="text-center text-white/50 py-6">အသေးစိတ် စာရင်းများ မရရှိသေးပါ</p>`;
  } else {
    const statLabels = {
      goals_scored: "⚽ Goals",
      assists: "🎯 Assists",
      own_goals: "🥅 Own Goals (OG)",
      bonus: "🌟 Bonus Points (BPS)",
      yellow_cards: "🟨 Yellow Cards",
      red_cards: "🟥 Red Cards",
      saves: "🧤 Saves"
    };

    let statRows = "";
    Object.keys(statLabels).forEach(key => {
      const row = stats.find(s => s.identifier === key);
      if (row && ((row.h && row.h.length > 0) || (row.a && row.a.length > 0))) {
        const renderList = (arr) => (arr || []).map(p => `<div class="leading-tight">${p.element_name || 'Player'} <span class="text-[#b3a1ff] font-bold">(${p.value})</span></div>`).join("");

        statRows += `
          <div class="bg-[#2d3366]/60 rounded-xl p-2.5 border border-[#3a3f7a]/40">
            <p class="text-center font-black text-[10px] text-[#b3a1ff] uppercase tracking-wider mb-2 border-b border-[#3a3f7a]/40 pb-1">${statLabels[key]}</p>
            <div class="grid grid-cols-2 gap-2 text-[11px]">
              <div class="text-left space-y-1">${renderList(row.h)}</div>
              <div class="text-right space-y-1">${renderList(row.a)}</div>
            </div>
          </div>
        `;
      }
    });

    bodyEl.innerHTML = statRows || `<p class="text-center text-white/50 py-6">မှတ်တမ်းများ မရှိသေးပါ</p>`;
  }

  document.getElementById("match-stats-modal").classList.remove("hidden");
};

window.closeMatchStatsModal = () => {
  const modal = document.getElementById("match-stats-modal");
  if (modal) modal.classList.add("hidden");
};
