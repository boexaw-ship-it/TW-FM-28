// ============================================
// TW Fantasy Official League — Dashboard Entry Controller
// Path: js/dashboard.js
// Responsibilities: Auth Lifecycle, Profile Binding, Stable UI Boot
// Standards: UI Design Knowledge Pack (Predictable State & Quota Safety)
// ============================================

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "./core/auth.js";
import { doc, getDoc } from "./core/fs.js";
import { initHomeTab } from "./home.js";

const $ = (id) => document.getElementById(id);

let currentAuthUser = null;
let currentProfile = null;

// 💡 User Manager Profile ကို LocalStorage Cache မှ ဦးစွာယူပြီး ချက်ချင်း အလုပ်လုပ်စေခြင်း
async function loadManagerProfile(user) {
  if (!user) return null;
  const cacheKey = `twf_user_profile_${user.uid}`;
  
  // 1️⃣ LocalStorage cache မှ ဦးစွာဖတ်သည်
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      currentProfile = JSON.parse(cached);
      renderProfileUI(currentProfile);
    }
  } catch (_) {}

  // 2️⃣ Firestore မှ fresh profile ရယူသည်
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

  return currentProfile;
}

function renderProfileUI(profile) {
  if (!profile) return;
  
  const welcomeNameEl = $("welcome-name");
  const welcomeManagerEl = $("welcome-manager");
  const pillEl = $("account-type-pill");
  const refreshBtn = $("pending-refresh-btn");

  if (welcomeNameEl) {
    const teamTitle = profile.teamName || "SEAROKER Tw";
    welcomeNameEl.innerHTML = `${escapeHtml(teamTitle)} <span class="crown-ico">👑</span>`;
  }

  if (welcomeManagerEl) {
    let cleanManager = profile.managerName || profile.displayName || "zaw moe";
    cleanManager = String(cleanManager).replace(/^manager:\s*/i, "").trim();
    welcomeManagerEl.textContent = cleanManager;
  }

  // Verification Status Pill
  if (pillEl) {
    const isApproved = profile.status === "approved";
    pillEl.textContent = isApproved ? "TW MEMBER" : "PENDING";
    pillEl.style.color = isApproved ? "#c9bcff" : "#fbbf24";
    pillEl.style.borderColor = isApproved ? "rgba(140,109,255,0.4)" : "rgba(245,158,11,0.4)";
    pillEl.style.background = isApproved ? "rgba(140,109,255,0.16)" : "rgba(245,158,11,0.14)";
  }

  if (refreshBtn) {
    if (profile.status === "pending") {
      refreshBtn.classList.remove("hidden");
    } else {
      refreshBtn.classList.add("hidden");
    }
  }
}

// 🔄 Approval Status Refresh Action
window.handleCheckApprovalStatus = async function() {
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

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// 🚀 Boot Controller (Guaranteed Profile & Stats Initialization)
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (typeof window.go === "function") {
      window.go("login");
    }
    return;
  }

  currentAuthUser = user;

  // 🌟 အရေးကြီးဆုံး: Profile ကို ဦးစွာ load လုပ်ပြီးမှ initHomeTab သို့ ပေးပို့သည်
  const loadedProfile = await loadManagerProfile(user);
  
  // Home Tab Engine (Stats, Countdown, Top 5 Cards) ကို အပြည့်အဝ စတင်လည်ပတ်စေသည်
  initHomeTab(user, loadedProfile || currentProfile);
});
