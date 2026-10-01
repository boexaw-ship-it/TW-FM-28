// ============================================
// TW Fantasy Official League
// Ultra-Lightweight Register Profile Sync Engine
// (Dual Approval: isApproved & isTwMember Fields)
// ============================================

const admin = require("firebase-admin");
const axios = require("axios");
const https = require("https");
const dns = require("dns");

if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT Environment Variable မတွေ့ရှိပါဗျာ။");
  process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

const FPL_BASE = "https://fantasy.premierleague.com/api";

async function fplFetch(url, retries = 3) {
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(url, {
        httpsAgent,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TW-Fantasy/1.0" },
        timeout: 10000,
      });
      return res.data;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// ⚽ အခြေခံ Squad ပုံစံသာ တည်ဆောက်ခြင်း (ရမှတ်မတွက်ပါ - Weekly Script မှ တွက်မည်)
async function syncBasicTeamPicks(fplId, currentGw) {
  try {
    const picksData = await fplFetch(`${FPL_BASE}/entry/${fplId}/event/${currentGw}/picks/`);
    const rawBank = picksData.entry_history?.bank ?? 0;
    const teamBank = parseFloat((Number(rawBank) / 10).toFixed(1));

    const picks = (picksData.picks || []).map((p) => ({
      playerId: p.element,
      position: "?",
      multiplier: p.multiplier,
      isCaptain: p.is_captain,
      isVice: p.is_vice_captain,
      livePoints: 0
    }));

    await db.collection("liveTeams").doc(String(fplId)).set(
      {
        fplTeamId: String(fplId),
        gameweek: currentGw,
        bank: teamBank,
        freeTransfers: 1,
        picks: picks,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn(`⚠️ Team ID #${fplId} ၏ အပတ်စဉ် ${currentGw} picks ဆွဲယူမှု ကျော်သွားပါသည်:`, err.message);
  }
}

async function main() {
  console.log("🚀 TW Fantasy — Register Profile Sync Starting...");

  try {
    // pending/failed user တွေကိုပဲ query လုပ် (users collection တစ်ခုလုံး မဖတ်တော့ဘူး)။ FULL_SCAN=1 ဆိုရင် အရင်အတိုင်း
    const usersSnapshot = process.env.FULL_SCAN === "1"
      ? await db.collection("users").get()
      : await db.collection("users").where("status", "in", ["pending_sync", "pending", "sync_failed"]).get();
    const targetUsers = [];

    usersSnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const hasValidFplId = data.fplTeamId && String(data.fplTeamId).trim() !== "" && /^\d+$/.test(String(data.fplTeamId).trim());

      if (
        hasValidFplId &&
        (data.status === "pending_sync" ||
         data.status === "pending" ||
         data.status === "sync_failed" ||
         !data.managerName ||
         !data.teamName)
      ) {
        targetUsers.push({ uid: docSnap.id, ...data });
      }
    });

    if (targetUsers.length === 0) {
      console.log("✅ Sync ပြုလုပ်ရန် အကောင့်သစ် မရှိပါဗျာ။");
      process.exit(0);
    }

    let currentGw = 1;
    try {
      const bootstrap = await fplFetch(`${FPL_BASE}/bootstrap-static/`);
      const currentEvent = (bootstrap.events || []).find((e) => e.is_current === true) || (bootstrap.events || []).find((e) => e.is_next === true);
      if (currentEvent) currentGw = currentEvent.id;
    } catch (_) {
      currentGw = 5;
    }

    for (const user of targetUsers) {
      const teamId = String(user.fplTeamId).trim();

      try {
        console.log(`📡 Fetching FPL Official Profile for Team ID: #${teamId}...`);
        const entryData = await fplFetch(`${FPL_BASE}/entry/${teamId}/`);

        const teamName = entryData.name || user.teamName || "FPL Team";
        const managerName = `${entryData.player_first_name || ""} ${entryData.player_last_name || ""}`.trim();

        console.log(`🎉 အချက်အလက်ရရှိသည်: ${teamName} (Manager: ${managerName})`);

        await syncBasicTeamPicks(teamId, currentGw);

        // 🛡️ ၁။ ရိုးရိုး Member Approved စစ်ဆေးခြင်း
        const currentApprovedStatus = Boolean(user.isApproved === true || user.status === "approved");

        // 🛡️ ၂။ TW Member Approved စစ်ဆေးခြင်း (Field အသစ်)
        const currentTwMemberStatus = Boolean(user.isTwMember === true || user.role === "tw_member");

        // Role သတ်မှတ်ချက် ခွဲထုတ်ခြင်း
        let determinedRole = "viewer";
        if (currentTwMemberStatus) {
          determinedRole = "tw_member";
        } else if (currentApprovedStatus) {
          determinedRole = "member";
        }

        // Firestore ထဲသို့ isApproved နှင့် isTwMember နှစ်ခုစလုံး တည်ဆောက်/သိမ်းဆည်းခြင်း
        await db.collection("users").doc(user.uid).set(
          {
            fplTeamId: String(teamId),
            teamName: teamName,
            managerName: managerName,
            isApproved: currentApprovedStatus, // ရိုးရိုး Member Approved
            isTwMember: currentTwMemberStatus, // 🌟 TW Member Approved (Transfer ခွင့်)
            status: currentApprovedStatus ? "approved" : "pending",
            role: determinedRole,
            syncedAt: admin.firestore.FieldValue.serverTimestamp(),
            syncError: null,
          },
          { merge: true }
        );

        console.log(`✅ User UID ${user.uid} Synced! Approved: [${currentApprovedStatus}], TW Member: [${currentTwMemberStatus}]`);
      } catch (err) {
        console.error(`❌ User UID: ${user.uid} (Team ID: #${teamId}) Sync Failed: ${err.message}`);
        await db.collection("users").doc(user.uid).set(
          {
            status: "sync_failed",
            syncError: err.message,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    await db.collection("system").doc("meta").set(
      {
        memberVersion: Date.now(),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log("🏁 Register Sync လုပ်ငန်းစဉ် အောင်မြင်စွာ ပြီးဆုံးပါပြီ။");
    process.exit(0);
  } catch (err) {
    console.error(`Fatal Error: ${err.message}`);
    process.exit(1);
  }
}

main();
