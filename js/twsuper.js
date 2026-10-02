import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "./core/auth.js";
import { 
  doc, 
  getDoc,
  setDoc, 
  collection, 
  addDoc, 
  getDocs,
  serverTimestamp 
} from "./core/fs.js";

let currentUserData = null;
let currentAuthUid = null;
let selectedTourType = "weekly"; // "weekly" or "super"
let calculatedFee = 5000;

let allConfirmedTeams = [];
let weeklyWinnersData = {};
let currentFilter = "weekly"; // "weekly", "supercup", "winners"

const USER_CACHE_KEY_PREFIX = "twf_user_profile_";
const CONFIRMED_TEAMS_CACHE_KEY = "twf_confirmed_dual_tour_teams_v1";
const CONFIRMED_TEAMS_CACHE_TIME = "twf_confirmed_dual_tour_teams_time_v1";
const WINNERS_CACHE_KEY = "twf_weekly_winners_data_v1";
const CACHE_DURATION = 24 * 60 * 60 * 1000;

// Telegram Alert ပို့ဆောင်ခြင်း
async function sendTournamentTelegramAlert(data, targetCol, regDocId) {
  const TELEGRAM_BOT_TOKEN = "8868220856:AAEiOdZFc7_iziO26zo3xchaRPDN0T9huU8";
  const TELEGRAM_CHAT_ID = "7935056299";

  if (!TELEGRAM_BOT_TOKEN) return;

  const durationText = data.tourType === "weekly" ? `\n📅 *Duration:* Week ${data.weekFrom} To Week ${data.weekTo} (${data.weeksCount} ပတ်စာ)` : "";

  const message = `🚨 *TW FPL — ပြိုင်ပွဲ စာရင်းသွင်းမှုအသစ် ရောက်ရှိပါသည်!*
━━━━━━━━━━━━━━━━━━
🏆 *ပြိုင်ပွဲ:* ${data.tourTitle}${durationText}
📂 *Firebase Col:* \`${targetCol}\`
💰 *ဝင်ကြေး:* ${data.entryFee.toLocaleString()} Ks
👤 *အသင်းနာမည်:* ${data.teamName}
🆔 *FPL Team ID:* \`#${data.fplTeamId}\`
📱 *FB / Telegram:* ${data.socialName}
💳 *KPay Slip ၆ လုံး:* \`${data.slipDigits}\`
🔑 *Doc ID:* \`${regDocId}\`
⚙️ *Status:* ⏳ Pending Admin Approval
⏰ *အချိန်:* ${new Date().toLocaleString("en-US", { timeZone: "Asia/Yangon" })} (MMT)
━━━━━━━━━━━━━━━━━━
💡 *Admin အတည်ပြုရန်:*
KPay တွင် စလစ်စစ်ဆေးပြီး GitHub Action တွင် Slip \`${data.slipDigits}\` ထည့်၍ Run ပေးနိုင်သလို၊ အကွက်လွတ်အတိုင်း Run လျှင်လည်း Auto Approved ဖြစ်သွားပါမည်။`;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown"
      })
    });
  } catch (error) {
    console.error("Tournament Telegram Alert Failed:", error);
  }
}

// In-App Toast
function showTwSuperToast(title, message, isSuccess = false) {
  const existing = document.getElementById("tw-super-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "tw-super-toast";
  toast.className = `fixed top-5 left-1/2 -translate-x-1/2 z-[9999] px-4 py-2.5 rounded-xl text-xs font-bold text-center border shadow-xl transition-all duration-300 pointer-events-none max-w-[90%] ${
    isSuccess ? "bg-emerald-950 text-emerald-300 border-emerald-500" : "bg-red-950 text-red-300 border-red-500"
  }`;
  toast.innerHTML = `<span class="mr-1">${isSuccess ? "✅" : "⚠️"}</span> <strong>${title}:</strong> ${message}`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3200);
}

// Auth & Access Control
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.go("login", true);
    return;
  }
  currentAuthUid = user.uid;

  try {
    let uData = null;
    const cachedDataStr = localStorage.getItem(`${USER_CACHE_KEY_PREFIX}${user.uid}`);
    if (cachedDataStr) {
      try { uData = JSON.parse(cachedDataStr); } catch (_) {}
    }

    if (!uData) {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) uData = snap.data();
    }

    const hasApproved = Boolean(uData?.isApproved === true || uData?.status === "approved" || uData?.status === "active");
    const hasTwApproved = Boolean(uData?.isTwMember === true || uData?.role === "tw_member" || uData?.role === "admin");

    if (!hasApproved || !hasTwApproved) {
      showTwSuperToast("ဝင်ရောက်ခွင့်မရှိပါ", "TW Member များသာ ဤပြိုင်ပွဲစာရင်းသွင်းခြင်းကို အသုံးပြုခွင့်ရှိပါသည်ခင်ဗျာ။", false);
      setTimeout(() => {
        window.go("dashboard", true);
      }, 1600);
      return;
    }

    currentUserData = uData;
    fillInitialData(currentUserData);
    if (typeof window.calculateFee === "function") window.calculateFee();

    loadDataWithCache();

  } catch (err) {
    console.warn("TW Super Access error:", err);
    window.go("dashboard", true);
  }
});

function loadDataWithCache() {
  const cachedStr = localStorage.getItem(CONFIRMED_TEAMS_CACHE_KEY);
  const cachedTime = localStorage.getItem(CONFIRMED_TEAMS_CACHE_TIME);
  const cachedWinners = localStorage.getItem(WINNERS_CACHE_KEY);
  const now = Date.now();

  let hasCache = false;
  if (cachedStr && cachedTime && (now - Number(cachedTime) < CACHE_DURATION)) {
    try {
      allConfirmedTeams = JSON.parse(cachedStr);
      hasCache = true;
    } catch (_) {}
  }

  if (cachedWinners) {
    try {
      weeklyWinnersData = JSON.parse(cachedWinners);
    } catch (_) {}
  }

  if (hasCache) {
    renderUI();
    return;
  }

  window.handleManualRefreshConfirmedTeams(false);
}

// 🔄 Refresh Handler
window.handleManualRefreshConfirmedTeams = async function(showToast = true) {
  const icon = document.getElementById("refresh-icon") || document.getElementById("tour-refresh-icon");
  const btn = document.getElementById("btn-refresh-tour");

  if (icon) icon.classList.add("animate-spin");
  if (btn) btn.disabled = true;

  try {
    const [weeklySnap, superSnap, legacySnap, winnersSnap] = await Promise.all([
      getDocs(collection(db, "twf_weekly")),
      getDocs(collection(db, "twf_supercup")),
      getDocs(collection(db, "tournamentRegistrations")),
      getDoc(doc(db, "twf_tournaments_meta", "weekly_winners"))
    ]);

    const freshList = [];

    weeklySnap.forEach((d) => {
      const data = d.data();
      if (data.isApproved === true || data.status === "approved") {
        freshList.push({ id: d.id, tourType: "weekly", ...data });
      }
    });

    superSnap.forEach((d) => {
      const data = d.data();
      if (data.isApproved === true || data.status === "approved") {
        freshList.push({ id: d.id, tourType: "super", ...data });
      }
    });

    legacySnap.forEach((d) => {
      const data = d.data();
      if (data.isApproved === true || data.status === "approved") {
        freshList.push({ id: d.id, tourType: data.tourType || "weekly", ...data });
      }
    });

    allConfirmedTeams = freshList;
    localStorage.setItem(CONFIRMED_TEAMS_CACHE_KEY, JSON.stringify(freshList));
    localStorage.setItem(CONFIRMED_TEAMS_CACHE_TIME, String(Date.now()));

    if (winnersSnap.exists()) {
      weeklyWinnersData = winnersSnap.data();
      localStorage.setItem(WINNERS_CACHE_KEY, JSON.stringify(weeklyWinnersData));
    } else {
      weeklyWinnersData = {};
    }

    renderUI();

    if (showToast) {
      showTwSuperToast("အသစ်ရရှိပါပြီ", "ဒေတာများ အသစ်ရယူပြီးပါပြီခင်ဗျာ!", true);
    }
  } catch (err) {
    console.warn("Manual load confirmed teams failed (Offline Mode):", err);
    
    const offlineTeams = localStorage.getItem(CONFIRMED_TEAMS_CACHE_KEY);
    const offlineWinners = localStorage.getItem(WINNERS_CACHE_KEY);

    if (offlineTeams) allConfirmedTeams = JSON.parse(offlineTeams);
    if (offlineWinners) weeklyWinnersData = JSON.parse(offlineWinners);

    renderUI();
  } finally {
    if (icon) icon.classList.remove("animate-spin");
    if (btn) btn.disabled = false;
  }
};

function renderUI() {
  if (currentFilter === "winners") {
    renderWeeklyWinnersUI();
  } else {
    renderConfirmedTeamsUI();
  }
}

// 🌟 စာရင်းသွင်းပြီးသား အသင်းများ View Render ပြုလုပ်ခြင်း
function renderConfirmedTeamsUI() {
  const listEl = document.getElementById("squad-list-container");
  const countNum = document.getElementById("confirmed-count");

  const targetType = currentFilter === "weekly" ? "weekly" : "super";
  let filtered = allConfirmedTeams.filter(t => t.tourType === targetType);

  // ⚡ Week ကြီးသူကို ထိပ်ဆုံးမှ စီတန်းခြင်း
  if (targetType === "weekly") {
    filtered.sort((a, b) => {
      const toA = Number(a.weekTo || (a.weeksCount ? (Number(a.weekFrom || 1) + Number(a.weeksCount) - 1) : 38));
      const toB = Number(b.weekTo || (b.weeksCount ? (Number(b.weekFrom || 1) + Number(b.weeksCount) - 1) : 38));

      if (toB !== toA) {
        return toB - toA;
      }

      const fromA = Number(a.weekFrom || 1);
      const fromB = Number(b.weekFrom || 1);
      return fromA - fromB;
    });
  }

  if (countNum) {
    countNum.textContent = filtered.length;
  }

  if (!listEl) return;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="rounded-2xl p-6 bg-black/40 text-center border border-white/5 shadow-xs my-2">
        <span class="text-3xl block mb-1">📋</span>
        <p class="text-xs font-bold text-slate-200">အတည်ပြုပြီး အသင်းစာရင်း မရှိသေးပါ</p>
        <p class="text-[10px] text-emerald-400/70 mt-0.5">အောက်ပါ Register ခလုတ်ကို နှိပ်၍ အသင်းစာရင်း စတင်သွင်းနိုင်ပါပြီ။</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map((t, idx) => {
    const isWeekly = t.tourType === "weekly";

    const displayTeamName = (t.teamName && t.teamName.trim() !== "") 
      ? t.teamName.trim() 
      : ((t.username && t.username.trim() !== "") 
          ? t.username.trim() 
          : "FPL Team");

    const displaySocial = (t.socialName && t.socialName.trim() !== "")
      ? t.socialName.trim()
      : ((t.managerName && t.managerName.trim() !== "") 
          ? t.managerName.trim() 
          : "—");

    let durationBadge = "";
    if (isWeekly) {
      durationBadge = (t.weekFrom && t.weekTo) ? `WEEK ${t.weekFrom}-${t.weekTo}` : "WEEK 1-38";
    } else {
      durationBadge = "SUPER CUP";
    }

    // ✅ နံပါတ် ၁ အပါအဝင် အားလုံး တူညီသော Clean Emerald-Green Badge ပုံစံဖြင့် တစ်ပြေးညီ ထားရှိခြင်း
    return `
      <div class="p-3 rounded-2xl bg-white/95 border border-emerald-800/20 text-slate-800 flex items-center justify-between shadow-md mb-2 active:scale-[0.99] transition-transform">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-7 h-7 rounded-lg bg-[#2d3366] text-white font-black text-xs flex items-center justify-center shrink-0 shadow-xs font-mono">
            ${idx + 1}
          </div>
          <div class="min-w-0">
            <h3 class="text-[13.5px] font-black text-slate-900 leading-tight truncate">
              ${displayTeamName}
            </h3>
            <p class="text-[10.5px] text-slate-600 font-semibold mt-0.5 truncate">
              FB/TG: <span class="text-[#2d3366] font-bold">${displaySocial}</span>
            </p>
          </div>
        </div>

        <div class="px-2.5 py-1 rounded-lg bg-emerald-100/90 border border-emerald-300 text-emerald-900 text-[10px] font-black uppercase tracking-wider shrink-0 font-mono shadow-2xs">
          ${durationBadge}
        </div>
      </div>
    `;
  }).join("");
}

// 🌟 WEEKLY WINNERS UI RENDER
function renderWeeklyWinnersUI() {
  const container = document.getElementById("winners-list-container");
  const countNum = document.getElementById("confirmed-count");

  if (!container) return;

  const populatedWeeks = [];
  for (let gw = 38; gw >= 1; gw--) {
    const gwData = weeklyWinnersData[`gw_${gw}`];
    if (gwData && (gwData.winners?.length > 0 || gwData.rawWinnerStr)) {
      populatedWeeks.push(gwData);
    }
  }

  if (countNum) {
    countNum.textContent = populatedWeeks.length;
  }

  if (populatedWeeks.length === 0) {
    container.innerHTML = `
      <div class="rounded-2xl p-6 bg-black/40 text-center border border-white/5 shadow-xs my-2">
        <span class="text-3xl block mb-1">🎁</span>
        <p class="text-xs font-bold text-slate-200">အပတ်စဉ်ဆုရရှိသူစာရင်း မရှိသေးပါ</p>
        <p class="text-[10px] text-emerald-400/70 mt-0.5">Admin မှ Gameweek အလိုက် ဆုရရှိသူများ ထည့်သွင်းပေးပါက ဤနေရာတွင် ပေါ်လာပါမည်။</p>
      </div>
    `;
    return;
  }

  container.innerHTML = populatedWeeks.map((data) => {
    const gw = data.gameweek;
    
    let winnersList = [];
    if (Array.isArray(data.winners) && data.winners.length > 0) {
      winnersList = data.winners;
    } else if (data.rawWinnerStr) {
      winnersList = data.rawWinnerStr.split(/[,/]+/).map(s => s.trim()).filter(Boolean);
    }

    let runnersList = [];
    if (Array.isArray(data.runners) && data.runners.length > 0) {
      runnersList = data.runners;
    } else if (data.rawRunnerStr) {
      runnersList = data.rawRunnerStr.split(/[,/]+/).map(s => s.trim()).filter(Boolean);
    }

    const isMultiWinner = winnersList.length > 1;
    const isMultiRunner = runnersList.length > 1;

    const winnerTitleBadge = isMultiWinner ? "WINNERS (၂ ယောက်)" : "WINNER";
    const runnerTitleBadge = isMultiRunner ? "RUNNERS (၂ ယောက်)" : "RUNNER";

    const renderNamesMultiLine = (namesArray, textColorClass) => {
      if (namesArray.length === 0) return `<p class="text-[13px] font-bold text-slate-400">—</p>`;
      return namesArray.map((name, i) => `
        <div class="flex items-center gap-1.5 py-0.5">
          ${namesArray.length > 1 ? `<span class="text-[9px] text-[#8c6dff] font-black font-mono">#${i + 1}</span>` : ''}
          <span class="text-[13px] ${textColorClass} font-black tracking-wide break-words leading-tight">
            ${name}
          </span>
        </div>
      `).join("");
    };

    return `
      <div class="p-3.5 rounded-2xl bg-[#14172b] border border-[#8c6dff]/50 text-white flex flex-col gap-2.5 shadow-lg mb-2.5">
        
        <div class="flex items-center justify-between border-b border-white/10 pb-2">
          <span class="text-[11px] font-black px-2.5 py-0.5 rounded-md bg-[#8c6dff] text-[#0b0d1a] uppercase font-mono tracking-wider shadow-xs">
            GAMEWEEK ${gw}
          </span>
          <span class="text-[10px] text-emerald-300 font-bold font-mono">
            TW WEEKLY
          </span>
        </div>

        <div class="flex items-start justify-between bg-black/45 p-2.5 rounded-xl border border-yellow-500/30 gap-2.5">
          <div class="flex items-start gap-2.5 min-w-0 flex-1">
            <span class="text-xl shrink-0 mt-0.5">🥇</span>
            <div class="flex flex-col min-w-0 flex-1">
              ${renderNamesMultiLine(winnersList, "text-yellow-300")}
            </div>
          </div>
          <span class="text-[9px] bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 px-2 py-0.5 rounded font-black tracking-wider shrink-0 mt-0.5">
            ${winnerTitleBadge}
          </span>
        </div>

        ${runnersList.length > 0 ? `
          <div class="flex items-start justify-between bg-black/30 p-2.5 rounded-xl border border-white/10 gap-2.5">
            <div class="flex items-start gap-2.5 min-w-0 flex-1">
              <span class="text-xl shrink-0 mt-0.5">🥈</span>
              <div class="flex flex-col min-w-0 flex-1">
                ${renderNamesMultiLine(runnersList, "text-slate-200")}
              </div>
            </div>
            <span class="text-[9px] bg-white/10 text-slate-300 border border-white/20 px-2 py-0.5 rounded font-bold tracking-wider shrink-0 mt-0.5">
              ${runnerTitleBadge}
            </span>
          </div>
        ` : ''}

      </div>
    `;
  }).join("");
}

// 🌟 Switch Tab Router
window.switchTab = function(tab) {
  currentFilter = tab;
  const btnWeekly = document.getElementById("tab-btn-weekly");
  const btnSuper = document.getElementById("tab-btn-supercup");
  const btnWinners = document.getElementById("tab-btn-winners");

  const squadContainer = document.getElementById("squad-list-container");
  const winnersContainer = document.getElementById("winners-list-container");

  [btnWeekly, btnSuper, btnWinners].forEach(btn => {
    if (btn) btn.className = "py-2 rounded-xl text-[11px] font-bold transition-all tracking-wider uppercase text-slate-300 hover:text-white cursor-pointer";
  });

  if (tab === "weekly") {
    btnWeekly.className = "py-2 rounded-xl text-[11px] font-black transition-all tracking-wider uppercase bg-[#8c6dff] text-[#0b0d1a] shadow-md cursor-pointer";
    squadContainer.classList.remove("hidden");
    winnersContainer.classList.add("hidden");
    renderConfirmedTeamsUI();
  } else if (tab === "supercup") {
    btnSuper.className = "py-2 rounded-xl text-[11px] font-black transition-all tracking-wider uppercase bg-white text-[#0b0d1a] shadow-md cursor-pointer";
    squadContainer.classList.remove("hidden");
    winnersContainer.classList.add("hidden");
    renderConfirmedTeamsUI();
  } else if (tab === "winners") {
    btnWinners.className = "py-2 rounded-xl text-[10.5px] font-black transition-all tracking-tight uppercase bg-emerald-500 text-white shadow-md shadow-emerald-500/30 flex items-center justify-center gap-1 cursor-pointer";
    squadContainer.classList.add("hidden");
    winnersContainer.classList.remove("hidden");
    renderWeeklyWinnersUI();
  }
};

window.handleRefreshData = function() {
  window.handleManualRefreshConfirmedTeams(true);
};

// =========================================================================
// 🌟 FORM DRAWER CONTROLS
// =========================================================================
window.openRegisterDrawer = function() {
  const drawer = document.getElementById("register-drawer");
  if (drawer) drawer.classList.remove("hidden");
  fillInitialData(currentUserData);
};

window.closeRegisterDrawer = function() {
  const drawer = document.getElementById("register-drawer");
  if (drawer) drawer.classList.add("hidden");
};

function fillInitialData(data) {
  if (!data) return;
  const teamNameInput = document.getElementById("tour-team-name");
  const teamIdInput = document.getElementById("tour-team-id");

  if (teamNameInput && !teamNameInput.value.trim()) {
    teamNameInput.value = data.teamName || data.username || data.name || "";
  }
  if (teamIdInput && !teamIdInput.value.trim()) {
    teamIdInput.value = data.fplTeamId ? String(data.fplTeamId).replace("#", "") : "";
  }
}

window.calculateFee = function() {
  const feeEl = document.getElementById("tour-calc-fee");
  if (!feeEl) return;

  if (selectedTourType === "super") {
    calculatedFee = 5000;
    feeEl.textContent = "၅,၀၀၀ Ks (Fixed)";
    return;
  }

  const wFrom = parseInt(document.getElementById("tour-week-from")?.value, 10) || 6;
  const wTo = parseInt(document.getElementById("tour-week-to")?.value, 10) || 10;

  let weeksCount = (wTo - wFrom) + 1;
  if (weeksCount < 1) weeksCount = 1;

  calculatedFee = weeksCount * 1000;
  feeEl.textContent = `${weeksCount} ပတ် = ${calculatedFee.toLocaleString()} Ks`;
};

window.selectTournament = function(type) {
  selectedTourType = type;
  const btnWeekly = document.getElementById("tour-opt-weekly");
  const btnSuper = document.getElementById("tour-opt-super");
  const weekRangeBox = document.getElementById("tour-week-range-box");

  if (type === "weekly") {
    if (btnWeekly) btnWeekly.className = "py-2.5 rounded-xl font-black bg-[#8c6dff] text-[#0b0d1a]";
    if (btnSuper) btnSuper.className = "py-2.5 rounded-xl font-bold bg-white/10 text-white";
    if (weekRangeBox) weekRangeBox.classList.remove("hidden");
  } else {
    if (btnSuper) btnSuper.className = "py-2.5 rounded-xl font-black bg-[#8c6dff] text-[#0b0d1a]";
    if (btnWeekly) btnWeekly.className = "py-2.5 rounded-xl font-bold bg-white/10 text-white";
    if (weekRangeBox) weekRangeBox.classList.add("hidden");
  }
  window.calculateFee();
};

window.copyKpayNumber = function() {
  navigator.clipboard.writeText("09798683021").then(() => {
    showTwSuperToast("ကူးယူပြီးပါပြီ", "KPay နံပါတ် 09798683021 ကို ကူးယူပြီးပါပြီခင်ဗျာ!", true);
  }).catch(() => {
    showTwSuperToast("သတိပေးချက်", "KPay နံပါတ်: 09798683021 ဖြစ်ပါသည်ခင်ဗျာ။", false);
  });
};

window.submitTournamentRegister = async function() {
  const rawTeamName = document.getElementById("tour-team-name")?.value.trim();
  const rawTeamId = document.getElementById("tour-team-id")?.value.trim().replace("#", "");
  const socialName = document.getElementById("tour-social-name")?.value.trim();
  const slipDigits = document.getElementById("tour-slip-six")?.value.trim();
  const errEl = document.getElementById("tour-error-msg");
  const submitBtn = document.getElementById("btn-submit-tournament");

  if (errEl) errEl.classList.add("hidden");

  if (!rawTeamName) {
    if (errEl) { errEl.textContent = "အသင်းနာမည် (Team Name) ထည့်သွင်းပေးပါခင်ဗျာ။"; errEl.classList.remove("hidden"); }
    return;
  }

  if (!rawTeamId || !/^\d+$/.test(rawTeamId)) {
    if (errEl) { errEl.textContent = "FPL Team ID ဂဏန်း တိကျစွာ ထည့်သွင်းပေးပါခင်ဗျာ။"; errEl.classList.remove("hidden"); }
    return;
  }

  const wFrom = parseInt(document.getElementById("tour-week-from")?.value, 10) || 6;
  const wTo = parseInt(document.getElementById("tour-week-to")?.value, 10) || 10;

  if (selectedTourType === "weekly" && wFrom > wTo) {
    if (errEl) { errEl.textContent = "စတင်မည့် Week သည် ပြီးဆုံးမည့် Week ထက် မကြီးရပါခင်ဗျာ။"; errEl.classList.remove("hidden"); }
    return;
  }

  if (!socialName) {
    if (errEl) { errEl.textContent = "Facebook Name သို့မဟုတ် Telegram Username ထည့်ပေးပါခင်ဗျာ။"; errEl.classList.remove("hidden"); }
    return;
  }

  if (!slipDigits || slipDigits.length !== 6 || !/^\d+$/.test(slipDigits)) {
    if (errEl) { errEl.textContent = "KPay Slip နောက်ဆုံးဂဏန်း ၆ လုံး တိကျစွာ ထည့်ပေးပါခင်ဗျာ။"; errEl.classList.remove("hidden"); }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "SUBMITTING...";
  }

  try {
    const isWeekly = selectedTourType === "weekly";
    const targetCollection = isWeekly ? "twf_weekly" : "twf_supercup";
    const weeksCount = isWeekly ? (wTo - wFrom + 1) : 1;
    const tourTitle = isWeekly ? `TW FPL WEEKLY (Week ${wFrom} to Week ${wTo})` : "TW FPL SUPER CUP";

    const regData = {
      uid: currentAuthUid,
      fplTeamId: rawTeamId,
      teamName: rawTeamName,
      managerName: socialName,
      tourType: selectedTourType,
      tourTitle: tourTitle,
      weekFrom: isWeekly ? wFrom : null,
      weekTo: isWeekly ? wTo : null,
      weeksCount: weeksCount,
      entryFee: calculatedFee,
      socialName: socialName,
      slipDigits: slipDigits,
      status: "pending",
      isApproved: false,
      submittedAt: serverTimestamp()
    };

    const docRef = await addDoc(collection(db, targetCollection), regData);

    await setDoc(doc(db, "users", currentAuthUid), {
      lastTournamentReg: {
        collection: targetCollection,
        regDocId: docRef.id,
        teamName: rawTeamName,
        fplTeamId: rawTeamId,
        tourType: selectedTourType,
        tourTitle: tourTitle,
        weekFrom: isWeekly ? wFrom : null,
        weekTo: isWeekly ? wTo : null,
        weeksCount: weeksCount,
        entryFee: calculatedFee,
        socialName: socialName,
        slipDigits: slipDigits,
        status: "pending",
        isApproved: false,
        submittedAt: Date.now()
      }
    }, { merge: true });

    await sendTournamentTelegramAlert(regData, targetCollection, docRef.id);

    window.closeRegisterDrawer();
    showTwSuperToast("စာရင်းသွင်းပြီးပါပြီ", "Admin ဘက်မှ KPay Slip စစ်ဆေးပြီး အတည်ပြုပေးပါမည်ခင်ဗျာ!", true);

    if (document.getElementById("tour-social-name")) document.getElementById("tour-social-name").value = "";
    if (document.getElementById("tour-slip-six")) document.getElementById("tour-slip-six").value = "";

  } catch (error) {
    console.error("Tournament Submit Error:", error);
    if (errEl) {
      errEl.textContent = "စာရင်းသွင်းမှု မအောင်မြင်ပါ။ ပြန်လည်ကြိုးစားပေးပါ။";
      errEl.classList.remove("hidden");
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "REGISTER SUBMIT ပြုလုပ်မည်";
    }
  }
};
