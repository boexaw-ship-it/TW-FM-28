// ============================================
// TW Fantasy Official League — Dashboard Controller
// Path: js/dashboard.js
// Responsibilities:
//   - Auth Lifecycle Management & Silent Route Guarding
//   - Manager Profile Data Binding (0 Read Offline Cache First)
//   - TW Member Approval Status Verification
//   - Home UI Engine Initialization
// Standards: UI Design Knowledge Pack (Predictable State & Quota Safety)
// ============================================

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "./core/auth.js";
import { doc, getDoc } from "./core/fs.js";
import { initHomeTab } from "./home.js";

const $ = (id) => document.getElementById(id);

let currentAuthUser = null;
let currentProfile = null;

/**
 * 🔒 Escape HTML Helper (XSS ကာကွယ်ရန်)
 */
function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

/**
 * 👤 Manager Profile Binding Engine
 * Firestore Read Quota ကာကွယ်ရန် LocalStorage cache ကို ဦးစွာဖတ်ပြီး UI ပြသသည်
 */
async function loadManagerProfile(user) {
  if (!user) return;
  const cacheKey = `twf_user_profile_${user.uid}`;

  // ၁။ Cache ရှိလျှင် ချက်ချင်း ရေးဆွဲပေးခြင်း (Instant Render)
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      currentProfile = JSON.parse(cached);
      renderProfileUI(currentProfile);
    }
  } catch (_) {}

  // ၂။ အွန်လိုင်းရှိပါက နောက်ဆုံးရ အချက်အလက်ကို Firestore မှ sync ပြုလုပ်ခြင်း
  if (navigator.onLine) {
    try {
      const userDocSnap = await getDoc(doc(db, "users", user.uid));
      if (userDocSnap.exists()) {
        currentProfile = userDocSnap.data();
        localStorage.setItem(cacheKey, JSON.stringify(currentProfile));
        renderProfileUI(currentProfile);
      }
    } catch (err) {
      console.warn("Manager profile load note:", err);
    }
  }
}

/**
 * 🎨 Profile UI Components သို့ Data Binding ပြုလုပ်ခြင်း
 */
function renderProfileUI(profile) {
  if (!profile) return;

  const welcomeNameEl = $("welcome-name");
  const welcomeManagerEl = $("welcome-manager");
  const pillEl = $("account-type-pill");
  const refreshBtn = $("pending-refresh-btn");

  // Manager & Team Title
  if (welcomeNameEl) {
    const teamTitle = profile.teamName || "SEAROKER Tw";
    welcomeNameEl.innerHTML = `${escapeHtml(teamTitle)} <span class="crown-ico">👑</span>`;
  }

  if (welcomeManagerEl) {
    welcomeManagerEl.textContent = profile.managerName || profile.displayName || "Manager";
  }

  // TW Member Status Verification Capsule
  if (pillEl) {
    const isApproved = profile.status === "approved" || profile.role === "member" || profile.isApproved === true;
    pillEl.textContent = isApproved ? "TW MEMBER" : "PENDING";
    pillEl.style.color = isApproved ? "#c9bcff" : "#fbbf24";
    pillEl.style.borderColor = isApproved ? "rgba(140, 109, 255, 0.45)" : "rgba(245, 158, 11, 0.4)";
    pillEl.style.background = isApproved ? "rgba(140, 109, 255, 0.16)" : "rgba(245, 158, 11, 0.14)";
  }

  // Pending ဖြစ်နေပါက Refresh ခလုတ် ဖော်ပြခြင်း
  if (refreshBtn) {
    const isPending = profile.status === "pending";
    if (isPending) {
      refreshBtn.classList.remove("hidden");
    } else {
      refreshBtn.classList.add("hidden");
    }
  }
}

/**
 * 🔄 Manual Approval Status Refresh Action
 */
window.handleCheckApprovalStatus = async function () {
  if (!currentAuthUser) return;
  const btn = $("pending-refresh-btn");
  const icon = $("check-icon");

  if (btn) btn.disabled = true;
  if (icon) icon.classList.add("animate-spin");

  try {
    const freshSnap = await getDoc(doc(db, "users", currentAuthUser.uid));
    if (freshSnap.exists()) {
      currentProfile = freshSnap.data();
      localStorage.setItem(`twf_user_profile_${currentAuthUser.uid}`, JSON.stringify(currentProfile));
      renderProfileUI(currentProfile);
    }
  } catch (err) {
    console.warn("Status refresh error:", err);
  } finally {
    setTimeout(() => {
      if (btn) btn.disabled = false;
      if (icon) icon.classList.remove("animate-spin");
    }, 600);
  }
};

/**
 * 🚀 App Entry Point & Auth State Listener
 */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // အသုံးပြုသူ login မဝင်ထားပါက Login စာမျက်နှာသို့ လမ်းကြောင်းလွှဲပေးခြင်း
    if (typeof window.go === "function") {
      window.go("login");
    } else {
      window.location.hash = "#/login";
    }
    return;
  }

  currentAuthUser = user;
  await loadManagerProfile(user);

  // 💡 Dashboard UI အတွင်းရှိ Data Engine (Countdown, Cards, Fixture) အား စတင်စေခြင်း
  initHomeTab(user, currentProfile);
});
