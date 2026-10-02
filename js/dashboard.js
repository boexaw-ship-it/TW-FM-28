import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "./core/auth.js";
import { doc, getDoc, getDocFromServer } from "./core/fs.js";

let currentUserData = null;
let currentAuthUid = null;

const USER_CACHE_KEY_PREFIX = "twf_user_profile_";
const USER_CACHE_TIME_KEY_PREFIX = "twf_user_profile_time_";
const SYNC_VERSION_KEY = "twf_member_sync_version";
const CACHE_24H_DURATION = 24 * 60 * 60 * 1000; // ၂၄ နာရီ ကာကွယ်မှု

// =========================================================================
// 🌟 LUXURY CUSTOM TOAST NOTIFICATION ENGINE (No Browser Alert)
// =========================================================================
function showDashboardToast(title, message, icon = "⏳", isSuccess = false) {
  const existing = document.getElementById("tw-dashboard-toast-overlay");
  if (existing) existing.remove();

  const toastOverlay = document.createElement("div");
  toastOverlay.id = "tw-dashboard-toast-overlay";
  
  const borderColor = isSuccess ? "rgba(74, 222, 128, 0.6)" : "rgba(245, 158, 11, 0.6)";
  const glowColor = isSuccess ? "rgba(74, 222, 128, 0.25)" : "rgba(245, 158, 11, 0.25)";
  const headerColor = isSuccess ? "#4ADE80" : "#FBBF24";

  toastOverlay.style.cssText = `
    position: fixed;
    top: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(-20px);
    z-index: 999999;
    width: 90%;
    max-width: 360px;
    padding: 13px 16px;
    background: linear-gradient(135deg, rgba(20,23,43, 0.98), rgba(11,13,26, 0.98));
    border: 1.5px solid ${borderColor};
    border-radius: 18px;
    box-shadow: 0 16px 35px rgba(0, 0, 0, 0.8), 0 0 25px ${glowColor};
    display: flex;
    align-items: center;
    gap: 12px;
    backdrop-filter: blur(14px);
    opacity: 0;
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    pointer-events: none;
    user-select: none;
  `;

  toastOverlay.innerHTML = `
    <div style="width: 36px; height: 36px; border-radius: 12px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15); display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; box-shadow: 0 4px 10px rgba(0,0,0,0.3);">
      ${icon}
    </div>
    <div style="flex: 1; text-align: left;">
      <h4 style="margin: 0; font-size: 11px; font-weight: 900; color: ${headerColor}; text-transform: uppercase; letter-spacing: 0.06em; font-family: sans-serif;">${title}</h4>
      <p style="margin: 2px 0 0; font-size: 11.5px; font-weight: 600; color: #E2E8F0; line-height: 1.35; font-family: sans-serif;">${message}</p>
    </div>
  `;

  document.body.appendChild(toastOverlay);

  requestAnimationFrame(() => {
    toastOverlay.style.opacity = "1";
    toastOverlay.style.transform = "translateX(-50%) translateY(0)";
  });

  setTimeout(() => {
    toastOverlay.style.opacity = "0";
    toastOverlay.style.transform = "translateX(-50%) translateY(-15px)";
    setTimeout(() => {
      toastOverlay.remove();
    }, 350);
  }, 2800);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.go("login", true);
    return;
  }
  currentAuthUid = user.uid;

  const cacheKey = `${USER_CACHE_KEY_PREFIX}${user.uid}`;
  const cacheTimeKey = `${USER_CACHE_TIME_KEY_PREFIX}${user.uid}`;

  const cachedDataStr = localStorage.getItem(cacheKey);
  const cachedTime = localStorage.getItem(cacheTimeKey);
  const now = Date.now();

  // 🛡️ ၁။ LocalStorage Cache ရှိပြီး ၂၄ နာရီ မပြည့်သေးပါက Firebase ဆီ မသွားပါ (Read = 0)
  if (cachedDataStr && cachedTime && (now - Number(cachedTime) < CACHE_24H_DURATION)) {
    try {
      currentUserData = JSON.parse(cachedDataStr);
      renderDashboardUI(currentUserData);
      return;
    } catch (_) {
      console.warn("Corrupt local storage data.");
    }
  }

  // 🛡️ ၂။ Version ပြောင်းမှသာ profile ဆွဲယူမည် (Quota Zero Guard)
  try {
    let shouldFetchProfile = !cachedDataStr;

    if (!shouldFetchProfile) {
      const metaSnap = await getDoc(doc(db, "system", "meta"));
      if (metaSnap.exists()) {
        const remoteVersion = metaSnap.data().memberVersion || 1;
        const localVersion = localStorage.getItem(SYNC_VERSION_KEY);
        if (String(remoteVersion) !== String(localVersion)) {
          shouldFetchProfile = true;
          localStorage.setItem(SYNC_VERSION_KEY, String(remoteVersion));
        }
      }
    }

    if (!shouldFetchProfile && cachedDataStr) {
      localStorage.setItem(cacheTimeKey, String(now));
      currentUserData = JSON.parse(cachedDataStr);
      renderDashboardUI(currentUserData);
      return;
    }

    const docSnap = await getDoc(doc(db, "users", user.uid));
    if (!docSnap.exists()) {
      window.go("login", true);
      return;
    }

    const data = docSnap.data();
    currentUserData = data;

    localStorage.setItem(cacheKey, JSON.stringify(data));
    localStorage.setItem(cacheTimeKey, String(now));

    renderDashboardUI(data);
  } catch (error) {
    console.error("Dashboard profile load bypass:", error);
    if (cachedDataStr) {
      currentUserData = JSON.parse(cachedDataStr);
      renderDashboardUI(currentUserData);
    }
  }
});

// =========================================================================
// 🌟 UI RENDER ENGINE (စာသားထင်ရှားပြတ်သားမှုနှင့် အရွယ်အစား ညှိထားသည်)
// =========================================================================
function renderDashboardUI(data) {
  if (!data) return;

  const fplIdTopEl = document.getElementById("fpl-id");
  if (fplIdTopEl) {
    fplIdTopEl.textContent = "";
    fplIdTopEl.style.display = "none";
  }

  const statusBadgeEl = document.getElementById("status-badge");
  if (statusBadgeEl) {
    statusBadgeEl.textContent = "";
    statusBadgeEl.style.display = "none";
  }

  const welcomeNameEl = document.getElementById("welcome-name");
  const welcomeSubEl = document.getElementById("welcome-sub");
  const welcomeBadgeEl = document.getElementById("welcome-badge");
  const accountTypePill = document.getElementById("account-type-pill");
  const transDesc = document.getElementById("transfer-card-desc");
  const pendingRefreshBtn = document.getElementById("pending-refresh-btn");

  // 🏷️ ၁။ အသင်းအမည် (Team Name) - အလွန်ထင်ရှားကြီးမားစွာ ဖော်ပြခြင်း
  if (welcomeNameEl) {
    welcomeNameEl.textContent = data.teamName || data.username || "FPL Team";
    }

  // 👤 ၂။ Manager Name - အစိမ်းနု/ရွှေဖောက်ပြီး အမည်ကို အဖြူစစ်စစ်ဖြင့် အလွန်ရှင်းလင်းစွာ မြင်ရစေခြင်း
  const managerDisplayName = data.managerName || data.manager || data.username || data.teamName || "zaw moe";
  if (welcomeSubEl) {
    welcomeSubEl.innerHTML = `Manager: <span style="color: #FFFFFF !important; font-weight: 800; font-size: 13px; text-shadow: 0 1px 4px rgba(0,0,0,0.8);">${managerDisplayName}</span>`;
    welcomeSubEl.style.color = "#8b90b3"; // Tailwind emerald-300
    welcomeSubEl.style.fontWeight = "600";
        welcomeSubEl.style.opacity = "1";
  }

  // 👕 ၃။ Live Pitch & Transfers စာသား - မှိန်မသွားစေရန် အဖြူရောင်စစ်စစ် class ပေးခြင်း
  if (transDesc) {
    transDesc.textContent = "Live Pitch & Transfers";
    transDesc.style.color = "rgba(255, 255, 255, 0.95)";
    transDesc.style.fontWeight = "600";
    transDesc.style.fontSize = "11px";
    transDesc.style.textShadow = "0 1px 3px rgba(0,0,0,0.7)";
  }

  // အတည်ပြုချက် အခြေအနေများ စစ်ဆေးခြင်း
  const hasApproved = Boolean(data.isApproved === true || data.status === "approved" || data.status === "active");
  const hasTwApproved = Boolean(data.isTwMember === true || data.role === "tw_member" || data.role === "admin");

  // =========================================================================
  // 🌟 TW MEMBERS (Approved + TW Member)
  // =========================================================================
  if (hasApproved && hasTwApproved) {
    if (pendingRefreshBtn) {
      pendingRefreshBtn.style.display = "none";
      pendingRefreshBtn.classList.add("hidden");
    }

    if (welcomeBadgeEl) {
      welcomeBadgeEl.textContent = "TW MEMBER";
      welcomeBadgeEl.className = "text-[9.5px] font-black uppercase tracking-wider text-emerald-300 mt-0.5";
    }

    if (accountTypePill) {
      accountTypePill.textContent = "TW MEMBER";
      accountTypePill.className = "text-[9px] font-black px-2.5 py-0.5 rounded-md uppercase tracking-wider bg-emerald-950/90 text-emerald-300 border border-emerald-500/50 shadow-xs";
    }
  } 
  // =========================================================================
  // 🔵 MEMBERS (ရိုးရိုး Approved Members)
  // =========================================================================
  else if (hasApproved) {
    if (pendingRefreshBtn) {
      pendingRefreshBtn.style.display = "none";
      pendingRefreshBtn.classList.add("hidden");
    }

    if (welcomeBadgeEl) {
      welcomeBadgeEl.textContent = "VERIFIED MEMBER";
      welcomeBadgeEl.className = "text-[9.5px] font-black uppercase tracking-wider text-blue-300 mt-0.5";
    }

    if (accountTypePill) {
      accountTypePill.textContent = "MEMBER";
      accountTypePill.className = "text-[9px] font-black px-2.5 py-0.5 rounded-md uppercase tracking-wider bg-blue-950/90 text-blue-300 border border-blue-400/50 shadow-xs";
    }
  } 
  // =========================================================================
  // 🟡 VIEW ONLY MEMBERS (စောင့်ဆိုင်းနေဆဲ)
  // =========================================================================
  else {
    if (pendingRefreshBtn) {
      pendingRefreshBtn.style.display = "flex";
      pendingRefreshBtn.classList.remove("hidden");
    }

    if (welcomeBadgeEl) {
      welcomeBadgeEl.textContent = "VIEW ONLY MEMBER";
      welcomeBadgeEl.className = "text-[9.5px] font-black uppercase tracking-wider text-amber-300 mt-0.5";
    }

    if (accountTypePill) {
      accountTypePill.textContent = "VIEW ONLY";
      accountTypePill.className = "text-[9px] font-black px-2.5 py-0.5 rounded-md uppercase tracking-wider bg-amber-950/90 text-amber-300 border border-amber-400/50 shadow-xs";
    }
  }
}

// 🔄 VIEW ONLY အောက်ရှိ PENDING REFRESH ခလုတ်နှိပ်ပါက Server မှ တိုက်ရိုက် စစ်ဆေးမည့် Handler
window.handleCheckApprovalStatus = async function() {
  if (!currentAuthUid) return;

  const btn = document.getElementById("pending-refresh-btn");
  const icon = document.getElementById("check-icon");

  if (icon) icon.classList.add("animate-spin");
  if (btn) btn.disabled = true;

  try {
    const docSnap = await getDocFromServer(doc(db, "users", currentAuthUid));
    if (docSnap.exists()) {
      const freshData = docSnap.data();
      currentUserData = freshData;

      // Local Cache update လုပ်ခြင်း
      localStorage.setItem(`${USER_CACHE_KEY_PREFIX}${currentAuthUid}`, JSON.stringify(freshData));
      localStorage.setItem(`${USER_CACHE_TIME_KEY_PREFIX}${currentAuthUid}`, String(Date.now()));

      renderDashboardUI(freshData);

      const hasApproved = Boolean(freshData.isApproved === true || freshData.status === "approved" || freshData.status === "active");
      const hasTwApproved = Boolean(freshData.isTwMember === true || freshData.role === "tw_member" || freshData.role === "admin");

      if (hasTwApproved) {
        showDashboardToast("အတည်ပြုပြီးပါပြီ", "သင်သည် TW MEMBER အဖြစ် အတည်ပြုချက် ရရှိပါပြီခင်ဗျာ!", "🌟", true);
      } else if (hasApproved) {
        showDashboardToast("အတည်ပြုပြီးပါပြီ", "သင်၏ အကောင့်သည် MEMBER အဖြစ် အတည်ပြုချက် ရရှိပါပြီခင်ဗျာ!", "✅", true);
      } else {
        showDashboardToast("စောင့်ဆိုင်းဆဲဖြစ်သည်", "Members အတည်ပြုချက်ခနစောင့်ပေးပါခင်ဗျာ", "⏳", false);
      }
    }
  } catch (err) {
    console.warn("Manual approval check failed:", err);
    showDashboardToast("ချိတ်ဆက်မှု မအောင်မြင်ပါ", "ဆာဗာနှင့် ချိတ်ဆက်ရာတွင် အခက်အခဲရှိနေပါသည်။", "⚠️", false);
  } finally {
    if (icon) icon.classList.remove("animate-spin");
    if (btn) btn.disabled = false;
  }
};

// 🛡️ Navigation Router
window.navigate = function(page) {
  if (page === "team" || page === "transfers" || page === "transfer") {
    window.go("team");
    return;
  }

  if (page === "draft") {
    window.go("draft");
    return;
  }

  window.go(page);
};

window.handleLogout = async function() {
  if (auth.currentUser) {
    localStorage.removeItem(`${USER_CACHE_KEY_PREFIX}${auth.currentUser.uid}`);
    localStorage.removeItem(`${USER_CACHE_TIME_KEY_PREFIX}${auth.currentUser.uid}`);
  }
  await signOut(auth);
  window.go("login", true);
};

