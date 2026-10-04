// ============================================
// TW Fantasy Official League — Dashboard Entry Controller
// Path: js/dashboard.js
// Standards: UI Design Knowledge Pack (Zero Redundancy, Clean Separation)
// Responsibility: Approved User Profile Binding & Tier Badge (MEMBER / TW MEMBER)
// ============================================

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "./core/auth.js";
import { doc, getDoc } from "./core/fs.js";
import { initHomeTab } from "./home.js";

const $ = (id) => document.getElementById(id);
const USER_CACHE_KEY_PREFIX = "twf_user_profile_live_";

let currentAuthUser = null;
let currentProfile = null;

/**
 * 🔍 APPROVED PROFILE LOADER
 * liveTeams မှ အသင်း/မန်နေဂျာ ဒေတာနှင့် Role ကို ဆွဲယူသည်
 */
async function loadManagerProfile(user) {
  if (!user) return null;
  const cacheKey = `${USER_CACHE_KEY_PREFIX}${user.uid}`;
  
  // ၁။ Cache ရှိပါက စစ်ဆေးသည်
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      currentProfile = JSON.parse(cached);
      // အကယ်၍ Pending ဖြစ်နေပါက Pending သို့ ချက်ချင်း လမ်းကြောင်းပြောင်းသည်
      if (isPendingUser(currentProfile)) {
        redirectToPending();
        return null;
      }
      renderProfileUI(currentProfile);
    }
  } catch (_) {}

  try {
    // ၂။ Firestore: users/{uid} ဖတ်ယူခြင်း
    const userDocSnap = await getDoc(doc(db, "users", user.uid));
    const baseData = userDocSnap.exists() ? (userDocSnap.data() || {}) : {};

    // Gatekeeper စစ်ဆေးခြင်း
    if (isPendingUser(baseData)) {
      redirectToPending();
      return null;
    }

    const resolvedFplId = String(
      baseData.fplTeamId || 
      baseData.fplId || 
      baseData.entry || 
      baseData.teamId || 
      localStorage.getItem("twf_fpl_team_id") || 
      ""
    ).trim();

    let teamName = baseData.teamName || baseData.entry_name || "";
    let managerName = baseData.managerName || baseData.player_name || baseData.displayName || user.displayName || "";

    // ၃။ liveTeams/{resolvedFplId} မှ အချက်အလက်များ တိုက်ရိုက်ဆွဲယူခြင်း
    if (resolvedFplId) {
      try {
        const liveTeamSnap = await getDoc(doc(db, "liveTeams", resolvedFplId));
        if (liveTeamSnap.exists()) {
          const ltData = liveTeamSnap.data() || {};
          teamName = ltData.teamName || ltData.entry_name || ltData.name || teamName;
          managerName = ltData.managerName || ltData.player_name || ltData.manager || managerName;
        }
      } catch (err) {
        console.warn("liveTeams query note:", err);
      }
    }

    // Dynamic Profile Object တည်ဆောက်ခြင်း
    currentProfile = {
      ...baseData,
      uid: user.uid,
      email: user.email,
      fplTeamId: resolvedFplId,
      teamName: teamName || (resolvedFplId ? `Team #${resolvedFplId}` : "Fantasy Team"),
      managerName: managerName || user.email?.split("@")[0] || "Manager",
      isApproved: true,
      isTwMember: Boolean(baseData.isTwMember === true || baseData.role === "tw_member"),
      role: baseData.role || "member",
      status: "approved"
    };

    if (resolvedFplId) {
      localStorage.setItem("twf_fpl_team_id", resolvedFplId);
    }

    localStorage.setItem(cacheKey, JSON.stringify(currentProfile));
    renderProfileUI(currentProfile);

  } catch (err) {
    console.error("Dashboard profile load error:", err);
  }

  return currentProfile;
}

function isPendingUser(data) {
  if (!data) return false;
  const rawStatus = String(data.status || "").toLowerCase().trim();
  const isApproved = Boolean(
    data.isApproved === true || 
    rawStatus === "approved" || 
    rawStatus === "active" || 
    rawStatus === "member" || 
    data.approved === true
  );
  return !isApproved || rawStatus === "pending";
}

function redirectToPending() {
  if (typeof window.go === "function") {
    window.go("pending", true);
  } else {
    window.location.hash = "#/pending";
  }
}

/**
 * 🏷️ DYNAMIC BADGE BINDING (MEMBER vs TW MEMBER)
 */
function renderProfileUI(profile) {
  if (!profile) return;
  
  const welcomeNameEl = $("welcome-name");
  const welcomeManagerEl = $("welcome-manager");
  const pillEl = $("account-type-pill");
  const pillTextEl = $("account-type-text");
  const refreshBtn = $("pending-refresh-btn");

  if (welcomeNameEl) {
    let cleanTeam = String(profile.teamName || "")
      .replace(/^[\u{1F300}-\u{1F9FF}\s]+/u, "")
      .replace(/^⛵\s*/, "")
      .trim();
    welcomeNameEl.textContent = cleanTeam || "Fantasy Team";
  }

  if (welcomeManagerEl) {
    let cleanManager = String(profile.managerName || "")
      .replace(/^manager:\s*/i, "")
      .replace(/^manager\s*/i, "")
      .trim();
    welcomeManagerEl.textContent = cleanManager || "Manager";
  }

  // 🌟 Auto Tier Badge: MEMBER vs TW MEMBER
  if (pillEl) {
    const isTw = profile.isTwMember === true || profile.role === "tw_member";

    if (isTw) {
      // 👑 Official TW Member (Gold / Purple Neon Glow)
      if (pillTextEl) pillTextEl.textContent = "TW MEMBER";
      pillEl.style.color = "#c9bcff";
      pillEl.style.borderColor = "rgba(140, 109, 255, 0.45)";
      pillEl.style.background = "rgba(140, 109, 255, 0.16)";
      pillEl.style.boxShadow = "0 0 10px rgba(140, 109, 255, 0.25)";
    } else {
      // 🛡️ Standard Member (Cyan / Blue Clean Badge)
      if (pillTextEl) pillTextEl.textContent = "MEMBER";
      pillEl.style.color = "#38bdf8";
      pillEl.style.borderColor = "rgba(56, 189, 248, 0.35)";
      pillEl.style.background = "rgba(56, 189, 248, 0.12)";
      pillEl.style.boxShadow = "0 0 10px rgba(56, 189, 248, 0.2)";
    }
  }

  if (refreshBtn) {
    refreshBtn.classList.add("hidden");
  }
}

// 🚀 Entry Auth Listener
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (typeof window.go === "function") {
      window.go("login", true);
    } else {
      window.location.hash = "#/login";
    }
    return;
  }

  currentAuthUser = user;
  const loadedProfile = await loadManagerProfile(user);

  // အကယ်၍ Pending ဖြစ်နေပါက Dashboard Engine မစတင်ပါ
  if (!loadedProfile) return;

  // Approved User ဖြစ်မှသာ Dashboard Home UI ကို Run စေသည်
  initHomeTab(user, loadedProfile);
});
