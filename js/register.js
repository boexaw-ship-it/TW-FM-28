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
// Markdown Syntax မလွတ်သော စာလုံးများကို Escape လုပ်ပေးသည့် Helper
function escapeMarkdown(text) {
  if (!text) return "";
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

async function sendTelegramAlert(data) {
  const TELEGRAM_BOT_TOKEN = "8868220856:AAEiOdZFc7_iziO26zo3xchaRPDN0T9huU8";
  const TELEGRAM_CHAT_ID = "7935056299";

  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === "YOUR_BOT_TOKEN_HERE") {
    return;
  }

  // HTML format ကို ပြောင်းသုံးခြင်းဖြင့် Markdown parsing error လုံးဝ ကင်းဝေးစေပါသည်
  const message = `🚨 <b>TW Fantasy — အသင်းဝင်အသစ် Register ပြုလုပ်ပါသည်!</b>
━━━━━━━━━━━━━━━━━━
👤 <b>Team Name:</b> ${data.teamName}
🆔 <b>FPL Team ID:</b> <code>#${data.fplId}</code>
📧 <b>Email:</b> <code>${data.email}</code>
⚙️ <b>Status:</b> ⏳ Pending Approval / Sync
⏰ <b>အချိန်:</b> ${new Date().toLocaleString("en-US", { timeZone: "Asia/Yangon" })} (MMT)
━━━━━━━━━━━━━━━━━━
🚀 <i>GitHub Workflow (register-sync) ဖြင့် Run နိုင်ပါပြီ။</i>`;

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
      keepalive: true // စာမျက်နှာ ကူးပြောင်းသွားသော်လည်း Network Request မပြတ်စေရန်
    });

    const resData = await res.json();
    if (!resData.ok) {
      console.warn("Telegram API Error Response:", resData);
    }
  } catch (error) {
    console.error("⚠️ Telegram Alert မအောင်မြင်ပါ (VPN လိုအပ်နိုင်ပါသည်):", error);
  }
}

// ============================================
// 🎯 Register Handler (Send to pending.html)
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

    // ၂။ Firestore ထဲသို့ User Data သိမ်းဆည်းခြင်း (Admin Approve စစ်ဆေးရန် isApproved: false)
    const userDocData = {
      uid: uc.user.uid,
      username: teamName,
      email: email,
      fplTeamId: fplTeamId,
      teamName: teamName,
      managerName: null,
      status: "pending",
      isApproved: false,
      createdAt: serverTimestamp()
    };

    await setDoc(doc(db, "users", uc.user.uid), userDocData);

    // Profile Cache သိမ်းဆည်းခြင်း
    localStorage.setItem(`twf_user_profile_${uc.user.uid}`, JSON.stringify({
      ...userDocData,
      createdAt: Date.now()
    }));
    localStorage.setItem("twf_current_fpl_id", fplTeamId);

    // ၃။ Telegram သို့ အကြောင်းကြားခြင်း
    await sendTelegramAlert({
      teamName,
      email,
      fplId: fplTeamId
    });

    // Request တကယ် ထွက်သွားစေရန် ၄၀၀ မီလီစက္ကန့် စောင့်ပြီးမှ Redirect လုပ်မည်
    setTimeout(() => {
      window.go("pending");
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
