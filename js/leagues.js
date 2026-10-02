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

const CHIP_LABELS = { "3xc": "TC", "bboost": "BB", "wildcard": "WC", "freehit": "FH", "manager": "AM" };

// =========================================================================
// 🌟 OFFLINE FIRST ENGINE: Auth မစောင့်ဘဲ Local Cache ဖြင့် ချက်ချင်း Render လုပ်ခြင်း
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
  queueMicrotask( () => {
    updateGwBadge();
    mountOfflineCacheImmediately();
  });
} else {
  updateGwBadge();
  mountOfflineCacheImmediately();
}

// =========================================================================
// 🌟 CURRENT GAMEWEEK ENGINE (ချက်ချင်း ဖတ်ယူပြသမှု စနစ်)
// =========================================================================

function updateGwBadge(dataArray = []) {
  const badge = document.getElementById("gw-badge");
  if (!badge) return;

  let gw = null;

  // ၁။ Standings ဒေတာထဲမှ စစ်ဆေးခြင်း
  if (Array.isArray(dataArray) && dataArray.length > 0) {
    const found = dataArray.find(d => d.gameweek || d.currentGw);
    if (found) gw = found.gameweek || found.currentGw;
  }

  // ၂။ မရှိပါက App တစ်ခုလုံး၏ LocalStorage Cache များထဲမှ အဆင့်ဆင့် Fallback ဆွဲယူခြင်း
  if (!gw) {
    gw = localStorage.getItem("twf_current_gw") || 
         localStorage.getItem("twf_transfers_gw") || 
         "5";
  }

  badge.textContent = "GW " + gw;
}

// =========================================================================
// ⏰ IN-FILE SCHEDULE QUOTA CONTROLLER (Sat-Mon: 6h / Others: 24h)
// =========================================================================

function getMyanmarDate(dateObj = new Date()) {
  const utc = dateObj.getTime() + (dateObj.getTimezoneOffset() * 60000);
  return new Date(utc + (6.5 * 3600000));
}

function checkLeagueSlotStatus() {
  const mmNow = getMyanmarDate(new Date());
  const day = mmNow.getDay(); // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
  const currentH = mmNow.getHours();
  let savedTimeMs = localStorage.getItem(LEAGUE_TIME_KEY);

  // 💡 အချိန်မှတ်တမ်း မရှိသေးပါက လက်ရှိအချိန်ကို မှတ်သားပြီး Schedule စတင်မည်
  if (!savedTimeMs) {
    localStorage.setItem(LEAGUE_TIME_KEY, String(Date.now()));
    savedTimeMs = String(Date.now());
  }

  const isMatchDayPeriod = (day === 0 || day === 6 || day === 1); // Sat, Sun, Mon

  // ၁။ Sat, Sun, Mon (၆ နာရီခြား တစ်နေ့ ၄ ကြိမ် - 00, 06, 12, 18)
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

  // ၂။ Tue, Wed, Thu, Fri (၂၄ နာရီ ၁ ကြိမ် - ည ၁၂:၀၀ သန်းခေါင် 00:00 Window)
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

// =========================================================================
// 🔄 REFRESH BUTTON (Early-Return & 0 Read Guard အတိအကျ)
// =========================================================================

window.forceRefreshLeague = async function() {
  if (!navigator.onLine) {
    mountOfflineCacheImmediately();
    showLeagueNotice("⚠️ အော့ဖ်လိုင်းမုဒ်: အင်တာနက်မရှိသေးပါခင်ဗျာ!", true);
    return;
  }

  const refreshBtn = document.getElementById("refresh-league-btn");

  const slotStatus = checkLeagueSlotStatus();

  // 🛡️ Quota ချိန်မစေ့မချင်း ချက်ချင်း Early Return ပြန်မည် (Read = 0)
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

// 🛡️ OFFLINE-BYPASS AUTH CONTROLLER
onAuthStateChanged(auth, async (user) => {
  triggerInitialFakeRefreshUI();

  if (!user) {
    // အော့ဖ်လိုင်းဖြစ်နေပါက index သို့ redirect မလုပ်ဘဲ cache ဖြင့် ဆက်လက်ပြသမည်
    if (!navigator.onLine || localStorage.getItem(LEAGUE_CACHE_KEY)) {
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

  // အော့ဖ်လိုင်းဖြစ်နေပါက Cache ရှိသလောက်ဖြင့်သာ ရပ်တန့်မည်
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

    
  unsubscribePopup = onLeagueTeam(leagueId, fplTeamId, (snap) => {
    if (!snap.exists()) {
      document.getElementById("popup-pitch-rows").innerHTML = `<p class="text-center text-xs py-24 text-white/50">ဒေတာ မရှိသေးပါဗျာ</p>`;
      return;
    }
    const d = snap.data();
    const activeChipCode = d.chip && CHIP_LABELS[d.chip] ? CHIP_LABELS[d.chip] : (d.chip || "NO CHIP");
    const isBenchBoost = activeChipCode === "BB";

    let calculatedGwPoints = Number(d.gwPoints ?? 0);
    const picks = d.picks || [];

    if (picks.length > 0) {
      let starterPts = 0;
      let benchPts = 0;

      picks.forEach(p => {
        const mult = Number(p.multiplier ?? 0);
        const pts = (Number(p.livePoints) || 0) * (mult > 1 ? mult : 1);
        if (mult > 0) {
          starterPts += pts;
        } else {
          benchPts += Number(p.livePoints) || 0;
        }
      });

      calculatedGwPoints = isBenchBoost ? (starterPts + benchPts) : starterPts;
    }
    
    document.getElementById("modal-gw-pts").textContent = calculatedGwPoints;
    document.getElementById("modal-total-pts").textContent = d.points ?? "0";
    document.getElementById("modal-hit-cost").textContent = "-" + (d.hitCost || 0);
    document.getElementById("modal-chip-badge").textContent = activeChipCode;

    if (picks.length > 0) {
      renderPopupPitch(picks);
    } else {
      document.getElementById("popup-pitch-rows").innerHTML = `<p class="text-center text-xs py-24 text-white/50">လူစာရင်း ဒေတာ မတွေ့ရှိပါဗျာ</p>`;
    }
  }, (err) => {
    console.warn("Popup snapshot note (Offline fallback):", err);
    // အော့ဖ်လိုင်းတွင် Snapshot fail ဖြစ်ပါက စာသားဖော်ပြခြင်း
    document.getElementById("popup-pitch-rows").innerHTML = `<p class="text-center text-xs py-24 text-white/60">အော့ဖ်လိုင်းမုဒ်တွင် လူစာရင်း Live Preview ကို မရရှိနိုင်သေးပါခင်ဗျာ</p>`;
  });
};

window.closeTeamPopup = () => {
  if (unsubscribePopup) { unsubscribePopup(); unsubscribePopup = null; }
  document.getElementById("team-popup-modal").style.display = "none";
};

function jerseyPath(p) {
  const folder = (p.position || "").toLowerCase() === "gk" ? "gk" : "outfield"; 
  const code = (p.teamCode || "unknown").toLowerCase(); 
  return `./public/jerseys/${folder}/${code}.png`; 
}

function buildPlayerCard(p) {
  const mult = Number(p.multiplier) || 0; 
  const displayPoints = (p.livePoints ?? 0) * (mult > 1 ? mult : 1); 

  let cornerBadge = ""; 
  if (p.multiplier === 3) 
    cornerBadge = `<span style="position:absolute;top:-5px;right:-3px;background:#b3a1ff;color:#14172b;font-size:8px;font-weight:900;width:16px;height:16px;border-radius:9999px;display:flex;align-items:center;justify-content:center;z-index:20;box-shadow:0 1px 3px rgba(0,0,0,0.4);">3x</span>`; 
  else if (p.isCaptain || mult > 1) 
    cornerBadge = `<span style="position:absolute;top:-5px;right:-3px;background:#b3a1ff;color:#14172b;font-size:8px;font-weight:900;width:16px;height:16px;border-radius:9999px;display:flex;align-items:center;justify-content:center;z-index:20;box-shadow:0 1px 3px rgba(0,0,0,0.4);">C</span>`; 
  else if (p.isVice) 
    cornerBadge = `<span style="position:absolute;top:-5px;right:-3px;background:#C0C0C0;color:#14172b;font-size:8px;font-weight:900;width:16px;height:16px;border-radius:9999px;display:flex;align-items:center;justify-content:center;z-index:20;box-shadow:0 1px 3px rgba(0,0,0,0.4);">V</span>`; 

  const statusBadge = getPlayerStatusBadge(p);
  const borderHighlight = (p.isCaptain || mult > 1) ? 'border-b-2 border-b-[#b3a1ff]' : p.isVice ? 'border-b-2 border-b-[#C0C0C0]' : ''; 

  return `
    <div style="width:64px; flex-shrink:0; display:flex; flex-direction:column; align-items:center; position:relative;">
      ${cornerBadge}
      <div class="${borderHighlight}" style="width:44px; height:44px; display:flex; align-items:center; justify-content:center; margin-bottom:2px; position:relative;">
        <img src="${jerseyPath(p)}"
             onerror="this.outerHTML='<div style=\\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.1rem;\\'>👕</div>'"
             style="width:100%; height:100%; object-fit:contain; filter: drop-shadow(0px 2px 3px rgba(0,0,0,0.3));" alt="${p.name}" />
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

function renderPopupPitch(picks) {
  const starters = picks.filter(p => Number(p.multiplier ?? 0) > 0); 
  const subs = picks.filter(p => Number(p.multiplier ?? 0) === 0); 

  const gk  = starters.filter(p => (p.position || "").toLowerCase() === "gk"); 
  const def = starters.filter(p => (p.position || "").toLowerCase() === "def"); 
  const mid = starters.filter(p => (p.position || "").toLowerCase() === "mid"); 
  const fwd = starters.filter(p => (p.position || "").toLowerCase() === "fwd"); 

  const renderRow = (players) => {
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
