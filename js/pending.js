import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "./core/auth.js";
import { doc, onSnapshot, getDocFromServer } from "./core/fs.js";

const USER_CACHE_KEY_PREFIX = "twf_user_profile_";
const USER_CACHE_TIME_KEY_PREFIX = "twf_user_profile_time_";

let currentAuthUser = null;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.go("login", true);
    return;
  }
  currentAuthUidSetup(user);
});

function currentAuthUidSetup(user) {
  currentAuthUser = user;

  // 🔄 Firestore Document ကို Realtime Snapshot နားထောင်ခြင်း
  onSnapshot(doc(db, "users", user.uid), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    processUserStatus(data);
  }, (err) => {
    console.warn("Pending snapshot error:", err);
  });
}

// အတည်ပြုချက် အခြေအနေအား ခွဲခြားစစ်ဆေးသည့် လုပ်ဆောင်ချက်
function processUserStatus(data) {
  if (!data || !currentAuthUser) return;

  const statusTitleEl = document.getElementById("status-title");
  const userBadgeEl = document.getElementById("user-badge");
  const statusAreaEl = document.getElementById("status-area");
  const iconContainerEl = document.getElementById("icon-container");
  const refreshActionContainer = document.getElementById("pending-refresh-container");

  // 🛡️ Admin ဘက်မှ status သို့မဟုတ် isApproved ပေးလိုက်သည်နှင့် တိကျစွာဖမ်းယူခြင်း
  const rawStatus = String(data.status || "").toLowerCase().trim();
  const hasApproved = Boolean(
    data.isApproved === true || 
    rawStatus === "approved" || 
    rawStatus === "active" || 
    rawStatus === "member" || 
    data.approved === true
  );

  const rawRole = String(data.role || "").toLowerCase().trim();
  const hasTwApproved = Boolean(
    data.isTwMember === true || 
    rawRole === "tw_member" || 
    rawRole === "admin" || 
    rawStatus === "tw_member"
  );

  // =========================================================================
  // 🎉 ၁။ Member သို့မဟုတ် TW Member အတည်ပြုပြီး (Approved State)
  // =========================================================================
  if (hasApproved) {
    if (refreshActionContainer) {
      refreshActionContainer.style.display = "none";
      refreshActionContainer.classList.add("hidden");
    }

    if (iconContainerEl) {
      iconContainerEl.innerHTML = `
        <div class="w-16 h-16 rounded-full flex items-center justify-center text-3xl shadow-lg border border-emerald-500/40 bg-gradient-to-br from-emerald-500 to-green-700 animate-bounce">
          ✅
        </div>`;
    }

    if (userBadgeEl) {
      if (hasTwApproved) {
        userBadgeEl.textContent = "🌟 TW MEMBER ACCESS GRANTED";
        userBadgeEl.style.color = "#b3a1ff";
      } else {
        userBadgeEl.textContent = "🔵 VERIFIED MEMBER (APPROVED)";
        userBadgeEl.style.color = "#93C5FD";
      }
    }

    if (statusTitleEl) {
      statusTitleEl.textContent = hasTwApproved 
        ? "TW MEMBER အတည်ပြုခြင်း အောင်မြင်သည်!" 
        : "MEMBER အတည်ပြုခြင်း အောင်မြင်သည်!";
    }

    if (statusAreaEl) {
      statusAreaEl.innerHTML = `
        <div class="p-4 rounded-2xl mb-4 text-center" style="background:rgba(11,13,26, 0.9); border:1px solid #3a3f7a;">
          <p class="text-[11px] uppercase tracking-wider text-emerald-400 font-semibold mb-1">Team Name</p>
          <h3 class="text-xl font-bold text-white mb-2" style="font-family:'Inter', sans-serif;">
            ${data.teamName || data.username || "FPL Team"}
          </h3>
          <div class="w-full h-[1px] bg-emerald-800/40 my-2"></div>
          <p class="text-[11px] uppercase tracking-wider text-yellow-400 font-semibold mb-1">Team ID</p>
          <h4 class="text-xl font-black text-[#8c6dff]" style="font-family:'Bebas Neue'; letter-spacing:0.05em;">
            # ${data.fplTeamId}
          </h4>
        </div>
        <p class="text-xs text-gray-300 animate-pulse mb-3 font-medium">Dashboard သို့ တိုက်ရိုက် ခေါ်ဆောင်သွားနေပါသည်...</p>`;
    }

    // 💡 Dashboard သို့ မသွားမီ Cache ထဲသို့ isApproved: true နှင့် အသစ်ဆုံး Status ကို သေချာ ထည့်သွင်းပေးခြင်း
    const updatedData = {
      ...data,
      isApproved: true,
      status: "approved",
      isTwMember: hasTwApproved
    };

    const cacheKey = `${USER_CACHE_KEY_PREFIX}${currentAuthUser.uid}`;
    const cacheTimeKey = `${USER_CACHE_TIME_KEY_PREFIX}${currentAuthUser.uid}`;
    localStorage.setItem(cacheKey, JSON.stringify(updatedData));
    localStorage.setItem(cacheTimeKey, String(Date.now()));

    setTimeout(() => {
      window.go("dashboard", true);
    }, 1200);
    return;
  }

  // =========================================================================
  // ⏳ ၂။ စောင့်ဆိုင်းနေဆဲ (Pending State)
  // =========================================================================
  if (!hasApproved) {
    if (refreshActionContainer) {
      refreshActionContainer.style.display = "flex";
      refreshActionContainer.classList.remove("hidden");
    }

    if (userBadgeEl) {
      userBadgeEl.textContent = "👀 VIEW ONLY MODE";
      userBadgeEl.style.color = "#85E3A1";
    }

    if (statusTitleEl) {
      statusTitleEl.textContent = "Approval စောင့်ဆိုင်းနေသည်";
    }

    if (statusAreaEl) {
      statusAreaEl.innerHTML = `
        <div class="p-3.5 rounded-2xl mb-4 text-center" style="background:rgba(11,13,26, 0.7); border:1px solid rgba(58,63,122, 0.4);">
          <p class="text-xs leading-relaxed text-[#D8EBDD]">
            Team ID (#${data.fplTeamId || "—"}) ကို Admin မှ စစ်ဆေးအတည်ပြုရန် စောင့်ဆိုင်းနေပါသည်။
          </p>
        </div>
        <div class="rounded-xl p-3 mb-4 bg-emerald-950/40 border border-emerald-800/40 text-center">
          <p class="text-[11px] text-emerald-400 font-medium">
            ⚡ Admin ဘက်မှ အတည်ပြုပြီးသည်နှင့် အလိုအလျောက် Dashboard သို့ ရောက်ရှိသွားပါမည်။
          </p>
        </div>`;
    }
  }
}

// 🔄 PWA Manual Status Refresh Handler (Pending စာမျက်နှာရှိ Refresh ခလုတ် နှိပ်ပါက Server မှ တိုက်ရိုက်ဆွဲယူခြင်း)
window.handleManualRefreshStatus = async () => {
  if (!currentAuthUser) return;
  const refreshBtn = document.getElementById("btn-manual-refresh");
  const refreshIcon = document.getElementById("refresh-spinner-icon");

  if (refreshIcon) refreshIcon.classList.add("animate-spin");
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    const snap = await getDocFromServer(doc(db, "users", currentAuthUser.uid));
    if (snap.exists()) {
      processUserStatus(snap.data());
    }
  } catch (err) {
    console.warn("Manual check error:", err);
  } finally {
    setTimeout(() => {
      if (refreshIcon) refreshIcon.classList.remove("animate-spin");
      if (refreshBtn) refreshBtn.disabled = false;
    }, 600);
  }
};

window.handleLogout = async () => {
  if (auth.currentUser) {
    localStorage.removeItem(`${USER_CACHE_KEY_PREFIX}${auth.currentUser.uid}`);
    localStorage.removeItem(`${USER_CACHE_TIME_KEY_PREFIX}${auth.currentUser.uid}`);
  }
  await signOut(auth);
  window.go("login", true);
};
