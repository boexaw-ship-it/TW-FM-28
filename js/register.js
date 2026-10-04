// ============================================
// TW Fantasy Official League — Register Controller
// Path: js/register.js
// Standards: UI Design Knowledge Pack (Zero Mock, Strict Schema)
// ============================================

import { auth, db } from "./firebase-config.js";
import { 
  createUserWithEmailAndPassword, 
  updateProfile 
} from "./core/auth.js";
import { 
  doc, 
  setDoc, 
  serverTimestamp 
} from "./core/fs.js";

// ============================================
// 👁️ Password Visibility Toggle Helper
// ============================================
window.togglePassword = function() {
  const pwdInput = document.getElementById("password");
  const eyeOpen = document.getElementById("eye-open-icon");
  const eyeClose = document.getElementById("eye-close-icon");

  if (!pwdInput) return;

  if (pwdInput.type === "password") {
    pwdInput.type = "text";
    if (eyeOpen && eyeClose) {
      eyeOpen.classList.add("hidden");
      eyeClose.classList.remove("hidden");
    }
  } else {
    pwdInput.type = "password";
    if (eyeOpen && eyeClose) {
      eyeOpen.classList.remove("hidden");
      eyeClose.classList.add("hidden");
    }
  }
};

// ============================================
// 🔔 Telegram Notification Alert Helper
// ============================================
async function sendTelegramAlert(data) {
  const TELEGRAM_BOT_TOKEN = "8868220856:AAEiOdZFc7_iziO26zo3xchaRPDN0T9huU8";
  const TELEGRAM_CHAT_ID = "7935056299";

  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === "YOUR_BOT_TOKEN_HERE") {
    return;
  }

  const message = `🚨 <b>TW Fantasy — အသင်းဝင်အသစ် Register ပြုလုပ်ပါသည်!</b>
━━━━━━━━━━━━━━━━━━
👤 <b>Team Name:</b> ${data.teamName}
🆔 <b>FPL Team ID:</b> <code>#${data.fplId}</code>
📧 <b>Email:</b> <code>${data.email}</code>
⚙️ <b>Status:</b> ⏳ Pending Approval / Sync
⏰ <b>အချိန်:</b> ${new Date().toLocaleString("en-US", { timeZone: "Asia/Yangon" })} (MMT)
━━━━━━━━━━━━━━━━━━
🚀 <i>Admin Approval စစ်ဆေးပြီးမှ Dashboard ဝင်ရောက်ခွင့်ရပါမည်။</i>`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML",
        disable_notification: false
      }),
      keepalive: true
    });

    const resData = await res.json();
    if (!resData.ok) {
      console.warn("Telegram API Error Response:", resData);
    }
  } catch (error) {
    console.error("⚠️️ Telegram Alert မအောင်မြင်ပါ (VPN လိုအပ်နိုင်ပါသည်):", error);
  }
}

// ============================================
// 🎯 Register Handler (Full Schema Matching Image 1000064991.jpg)
// ============================================
window.handleRegister = async () => {
  const teamName = document.getElementById("teamName").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const rawFplId = document.getElementById("fplId").value.trim();

  const errorEl = document.getElementById("error-msg");
  const btnEl = document.getElementById("register-btn");

  errorEl.classList.add("hidden");

  if (!teamName) {
    errorEl.textContent = "Team Name ထည့်သွင်းပေးပါ။";
    errorEl.classList.remove("hidden");
    return;
  }

  if (!rawFplId) {
    errorEl.textContent = "FPL Team ID ထည့်သွင်းပေးပါ။";
    errorEl.classList.remove("hidden");
    return;
  }

  if (!/^\d+$/.test(rawFplId)) {
    errorEl.textContent = "FPL Team ID သည် ဂဏန်းများသာ ဖြစ်ရပါမည်။";
    errorEl.classList.remove("hidden");
    return;
  }

  if (!email || !password) {
    errorEl.textContent = "Email နှင့် Password ကို ဖြည့်စွက်ပေးပါ။";
    errorEl.classList.remove("hidden");
    return;
  }

  if (password.length < 6) {
    errorEl.textContent = "Password သည် အနည်းဆုံး ၆ လုံး ရှိရပါမည်။";
    errorEl.classList.remove("hidden");
    return;
  }

  const fplTeamId = String(rawFplId);

  btnEl.disabled = true;
  btnEl.innerHTML = `
    <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg> Registering...`;

  try {
    // ၁။ Firebase Authentication တွင် အကောင့်ဆောက်ခြင်း
    const uc = await createUserWithEmailAndPassword(auth, email, password);

    await updateProfile(uc.user, {
      displayName: teamName
    });

    // ၂။ Firestore သို့ စံသတ်မှတ်ချက် Schema အပြည့်အစုံဖြင့် သိမ်းဆည်းခြင်း (Matching Image 1000064991.jpg)
    const userDocData = {
      uid: uc.user.uid,
      username: teamName,
      email: email,
      fplTeamId: fplTeamId,
      teamName: teamName,
      managerName: null,
      isApproved: false,       // 💡 Admin Approved စစ်ဆေးရန် (Default False)
      isTwMember: false,       // 💡 TW Official Member စစ်ဆေးရန် (Default False)
      role: "member",          // 💡 Default Role: member
      status: "pending",       // 💡 Pending စစ်ဆေးရန်
      syncError: null,
      syncedAt: null,
      createdAt: serverTimestamp()
    };

    await setDoc(doc(db, "users", uc.user.uid), userDocData);

    // Profile Cache သတ်မှတ်ခြင်း
    localStorage.setItem(`twf_user_profile_live_${uc.user.uid}`, JSON.stringify({
      ...userDocData,
      createdAt: Date.now()
    }));
    localStorage.setItem("twf_fpl_team_id", fplTeamId);

    // ၃။ Telegram သို့ အကြောင်းကြားခြင်း
    await sendTelegramAlert({
      teamName,
      email,
      fplId: fplTeamId
    });

    // ၄။ Pending ဖြစ်နေသဖြင့် Pending Page သို့ တိုက်ရိုက် ပို့ဆောင်ခြင်း
    setTimeout(() => {
      if (typeof window.go === "function") {
        window.go("pending");
      } else {
        window.location.hash = "#/pending";
      }
    }, 400);

  } catch (err) {
    console.error("Register Error:", err);
    let msg = "Register မအောင်မြင်ပါ။";
    if (err.code === "auth/email-already-in-use") msg = "ဒီ Email ဖြင့် အကောင့်ရှိနှင့်ပြီးသား ဖြစ်ပါသည်။";
    if (err.code === "auth/invalid-email") msg = "Email ပုံစံ မှားယွင်းနေပါသည်။";
    if (err.code === "auth/weak-password") msg = "Password အားနည်းလွန်းပါသည်။";

    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
    btnEl.disabled = false;
    btnEl.innerHTML = "REGISTER";
  }
};
