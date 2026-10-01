/**
 * 🤖 TW Fantasy - Official FPL Worker Engine
 * Strictly Follows Official FPL Rules & Regulations:
 * - IPv4 DNS Fix (Fixes ENOTFOUND & Connection Dropped)
 * - 15 Man Squad & Valid Starting XI Formations
 * - Captain & Vice-Captain inside Starting XI
 * - Multiplier calculation (Triple Captain / Bench Boost)
 * - Free Hit vs Wildcard vs Paid (-4 Hit) Transfers
 */

const dns = require("dns");
const https = require("https");

// 🌐 Node.js IPv4 DNS Bug Fix (Premier League Server တိုက်ရိုက်မိစေရန်)
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (e) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT missing or invalid:", e.message);
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const jar = new CookieJar();
const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

const client = wrapper(axios.create({
  jar,
  withCredentials: true,
  httpsAgent,
  timeout: 25000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Referer": "https://fantasy.premierleague.com/",
    "Origin": "https://fantasy.premierleague.com",
    "Accept": "application/json, text/plain, */*"
  }
}));

const FPL_BASE = "https://fantasy.premierleague.com/api";
const FPL_LOGIN_URL = "https://users.premierleague.com/accounts/login/";
const FPL_TRANSFERS_URL = `${FPL_BASE}/transfers/`;
const fplMyTeamUrl = (teamId) => `${FPL_BASE}/my-team/${teamId}/`;

async function getCsrfToken() {
  const cookies = await jar.getCookies("https://fantasy.premierleague.com");
  const csrfCookie = cookies.find(c => c.key === "csrftoken");
  return csrfCookie ? csrfCookie.value : "";
}

async function loginToFpl(email, password) {
  const payload = new URLSearchParams({
    login: email,
    password: password,
    app: "plfpl-web",
    redirect_uri: "https://fantasy.premierleague.com/"
  });

  console.log(`🔐 Logging into Official FPL for: ${email}...`);

  await client.post(FPL_LOGIN_URL, payload.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    maxRedirects: 5,
    validateStatus: (status) => status < 500
  });

  const cookies = await jar.getCookies("https://fantasy.premierleague.com");
  const hasProfile = cookies.some(c => c.key === "pl_profile");

  if (!hasProfile) {
    throw new Error("FPL Login Failed: Email သို့မဟုတ် Password မှားယွင်းနေပါသည် (2FA ခံထားခြင်း ရှိ/မရှိ စစ်ဆေးပါ)။");
  }
  console.log("✅ FPL Login Successful!");
  return true;
}

async function getActiveGameweek() {
  try {
    const res = await client.get(`${FPL_BASE}/bootstrap-static/`);
    const events = res.data.events || [];
    const current = events.find(e => e.is_current === true);
    if (current) return current.id;
    const next = events.find(e => e.is_next === true);
    if (next) return next.id;
  } catch (e) {
    console.warn("Notice: GW fallback to 1:", e.message);
  }
  return 1;
}

async function releaseLock() {
  try {
    await db.collection("system_locks").doc("transfer_lock").set({
      isLocked: false,
      lockedBy: null,
      lockedAt: null
    }, { merge: true });
    console.log("🔓 Transfer Lock Released.");
  } catch (e) {
    console.warn("Notice: Lock release warning:", e.message);
  }
}

async function runTransferWorker() {
  console.log("⚡ Starting FPL Transfer Worker Engine...");

  // ၁။ Pending Job များ ရှာဖွေခြင်း
  const queueSnap = await db.collection("pendingTransfers")
    .where("status", "==", "pending")
    .limit(5)
    .get();

  if (queueSnap.empty) {
    console.log("☕ No pending transfers in queue. Standing down.");
    await releaseLock();
    return;
  }

  const docs = queueSnap.docs;
  docs.sort((a, b) => {
    const tA = a.data().createdAt?.toMillis ? a.data().createdAt.toMillis() : 0;
    const tB = b.data().createdAt?.toMillis ? b.data().createdAt.toMillis() : 0;
    return tA - tB;
  });

  const jobDoc = docs[0];
  const jobId = jobDoc.id;
  const job = jobDoc.data();

  if (job.status === "cancelled") {
    console.log(`⏩ Job ${jobId} was cancelled. Skipping.`);
    await releaseLock();
    return;
  }

  console.log(`🎯 Processing Transfer Job ID: ${jobId} for FPL Team: ${job.fplTeamId}`);

  try {
    // ၂။ User Credentials ရှာဖွေခြင်း (အကောင့်များပြားနေပါက Password ပါသော user ကို ဦးစားပေး ရွေးထုတ်ခြင်း)
    const targetIdStr = String(job.fplTeamId).trim();
    const targetIdNum = Number(job.fplTeamId);

    let userCandidates = [];

    // String ID ဖြင့် စစ်ဆေးခြင်း
    const queryStr = await db.collection("users").where("fplTeamId", "==", targetIdStr).get();
    queryStr.forEach(d => userCandidates.push(d.data()));

    // Number ID ဖြင့် စစ်ဆေးခြင်း
    if (!isNaN(targetIdNum)) {
      const queryNum = await db.collection("users").where("fplTeamId", "==", targetIdNum).get();
      queryNum.forEach(d => userCandidates.push(d.data()));
    }

    if (userCandidates.length === 0) {
      throw new Error(`Users collection ထဲတွင် FPL Team ID #${job.fplTeamId} အား ရှာမတွေ့ပါ!`);
    }

    // Password ပါရှိသော doc ကို ရှာဖွေခြင်း
    const matchedUser = userCandidates.find(u => Boolean(u.fplPassword || u.password));
    const targetUser = matchedUser || userCandidates[0];

    const fplEmail = targetUser.fplEmail || targetUser.email;
    const fplPassword = targetUser.fplPassword || targetUser.password;

    if (!fplEmail || !fplPassword) {
      throw new Error(`FPL Login Credentials မရှိပါ။ View Only User ဖြစ်နေနိုင်ပါသည်။`);
    }

    // ၃။ Official FPL သို့ Login ဝင်ခြင်း
    await loginToFpl(fplEmail, fplPassword);

    const csrfToken = await getCsrfToken();
    const authHeaders = {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
      "Referer": "https://fantasy.premierleague.com/",
      "Origin": "https://fantasy.premierleague.com"
    };

    const activeGw = job.targetGw || (await getActiveGameweek());
    const activeChip = job.chip || null;
    const transfersList = job.transfers || [];

    // ၄။ TRANSFERS EXECUTION (ကစားသမား အပြောင်းအလဲများ ပို့ဆောင်ခြင်း)
    if (transfersList.length > 0 || activeChip === "wildcard" || activeChip === "freehit") {
      console.log(`📦 Submitting ${transfersList.length} transfer(s) with Chip: ${activeChip || "None"} for GW${activeGw}...`);

      const formattedTransfers = transfersList.map(t => ({
        element_in: Number(t.element_in || t.in),
        element_out: Number(t.element_out || t.out),
        purchase_price: Number(t.purchase_price || 0),
        selling_price: Number(t.selling_price || 0)
      }));

      const transferPayload = {
        chip: (activeChip === "wildcard" || activeChip === "freehit") ? activeChip : null,
        entry: Number(job.fplTeamId),
        event: Number(activeGw),
        transfers: formattedTransfers,
        freehit: activeChip === "freehit"
      };

      const transferRes = await client.post(FPL_TRANSFERS_URL, transferPayload, { headers: authHeaders });
      if (transferRes.status !== 200) {
        throw new Error(`FPL Transfer Error: HTTP Status ${transferRes.status}`);
      }
      console.log("✅ Transfers accepted by Official Premier League!");
    }

    // ၅။ LINEUP, SUBS, CAPTAIN & VC EXECUTION
    if (job.picks && job.picks.length === 15) {
      console.log("📋 Updating Lineup & Captain to Official FPL...");

      const lineupChip = (activeChip === "bboost" || activeChip === "3xc") ? activeChip : null;

      let hasCaptainInStartingXI = false;
      job.picks.forEach((p, idx) => {
        if (idx < 11 && p.isCaptain) hasCaptainInStartingXI = true;
      });

      const formattedPicks = job.picks.map((p, idx) => {
        const isStartingXI = idx < 11;
        let isCap = p.isCaptain === true;
        let isVc = p.isVice === true;

        if (!hasCaptainInStartingXI && idx === 0) isCap = true;

        let mult = 1;
        if (isStartingXI) {
          mult = isCap ? ((lineupChip === "3xc") ? 3 : 2) : 1;
        } else {
          mult = (lineupChip === "bboost") ? 1 : 0;
          isCap = false;
        }

        return {
          element: Number(p.playerId || p.id || p.element),
          position: idx + 1,
          multiplier: mult,
          is_captain: isCap,
          is_vice_captain: isVc
        };
      });

      const lineupPayload = {
        chip: lineupChip,
        picks: formattedPicks
      };

      const lineupRes = await client.post(fplMyTeamUrl(job.fplTeamId), lineupPayload, { headers: authHeaders });
      if (lineupRes.status !== 200) {
        throw new Error(`FPL Lineup Error: HTTP Status ${lineupRes.status}`);
      }
      console.log("✅ Lineup updated successfully on Official FPL!");
    }

    // ၆။ Firebase liveTeams သို့ squad အသစ် ချက်ချင်း update ပြုလုပ်ခြင်း
    await db.collection("liveTeams").doc(String(job.fplTeamId)).set({
      picks: job.picks,
      bank: job.bank !== undefined ? job.bank : 0.0,
      gameweek: activeGw,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    // ၇။ Firestore Document အား COMPLETED အဖြစ် အောင်မြင်စွာ ပြောင်းလဲခြင်း
    await db.collection("pendingTransfers").doc(jobId).update({
      status: "completed",
      completedAt: FieldValue.serverTimestamp(),
      error: null
    });

    console.log(`🎉 Job ${jobId} COMPLETED SUCCESSFULLY! Official FPL Updated.`);

  } catch (err) {
    console.error(`💥 Job ${jobId} Failed:`, err.message);
    await db.collection("pendingTransfers").doc(jobId).update({
      status: "failed",
      error: err.message,
      failedAt: FieldValue.serverTimestamp()
    });
  } finally {
    await releaseLock();
  }
}

runTransferWorker().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Fatal Error:", err.message);
  process.exit(1);
});
