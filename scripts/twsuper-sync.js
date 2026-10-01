/**
 * 🏆 TW FPL Super & Weekly Tournament Sync Engine
 * Dual Collection Sync: twf_weekly & twf_supercup
 * + Weekly Winners (Week 1 - 38) Award Manager
 * File Name: scripts/twsuper-sync.js
 */

const admin = require("firebase-admin");

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ ERROR: FIREBASE_SERVICE_ACCOUNT secret is missing in GitHub repository.");
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (e) {
  console.error("❌ ERROR: Failed to parse FIREBASE_SERVICE_ACCOUNT JSON.", e.message);
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// GitHub Actions Inputs
const slipTarget = String(process.env.SLIP_DIGITS || "").trim();
const targetVal = String(process.env.TARGET_VAL || "").trim();
const tourChoice = process.env.TOUR_CHOICE || "all"; // all, weekly, supercup, set_winner
const actionType = process.env.ACTION_TYPE || "approve";

// 🎁 Weekly Winners Input Variables (Week 1 to 38)
const targetGw = String(process.env.TARGET_GW || "").trim(); // ဥပမာ - 5 (Week 5)
const winnerInput = String(process.env.WINNERS || "").trim(); // ဥပမာ - "MDY Paragon (71 pts)" သို့ "Team A, Team B"
const runnerInput = String(process.env.RUNNERS || "").trim(); // ဥပမာ - "CityLoft United" သို့ "Team C, Team D"
const prizeNote = String(process.env.PRIZE_NOTE || "").trim(); // ဥပမာ - "15,000 Ks / 5,000 Ks"

const isApprove = actionType === "approve";
const newStatus = isApprove ? "approved" : "rejected";
const newApprovalFlag = isApprove;

// =========================================================================
// 🌟 ၁။ WEEKLY WINNERS & RUNNERS-UP SYNC ENGINE (Week 1 to 38)
// =========================================================================
async function syncWeeklyWinners() {
  const gwNum = parseInt(targetGw, 10);
  if (isNaN(gwNum) || gwNum < 1 || gwNum > 38) {
    console.error(`❌ ERROR: Invalid Gameweek number: "${targetGw}". Week 1 မှ 38 အတွင်းသာ ဖြစ်ရပါမည်။`);
    return false;
  }

  console.log(`\n=============================================================`);
  console.log(`🎁 SETTING WEEKLY WINNERS: Gameweek ${gwNum}`);
  console.log(`🥇 Winner(s)    : ${winnerInput || "NONE"}`);
  console.log(`🥈 Runner-up(s) : ${runnerInput || "NONE"}`);
  console.log(`💰 Prize / Note : ${prizeNote || "Standard Weekly Prize"}`);
  console.log(`=============================================================\n`);

  // စာသားများကို comma (,) သို့မဟုတ် slash (/) ဖြင့် ခွဲခြမ်း၍ Array ဖွဲ့ပေးခြင်း (Winner ၁ ယောက် သို့မဟုတ် ၂ ယောက် ခွဲထုတ်နိုင်ရန်)
  const parseList = (str) => {
    if (!str) return [];
    return str.split(/[,/]+/).map(item => item.trim()).filter(Boolean);
  };

  const winnersArr = parseList(winnerInput);
  const runnersArr = parseList(runnerInput);

  const gwKey = `gw_${gwNum}`;
  const winnersDocRef = db.collection("twf_tournaments_meta").doc("weekly_winners");

  const updatePayload = {
    [gwKey]: {
      gameweek: gwNum,
      winners: winnersArr,
      runners: runnersArr,
      rawWinnerStr: winnerInput,
      rawRunnerStr: runnerInput,
      prizeNote: prizeNote || "Weekly Winner Prize",
      updatedAt: Date.now(),
      status: "published"
    },
    lastUpdatedGw: gwNum,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await winnersDocRef.set(updatePayload, { merge: true });

  console.log(`✅ SUCCESS: Week ${gwNum} ဆုရရှိသူစာရင်းအား Firestore သို့ သိမ်းဆည်းပြီးပါပြီ!`);
  console.log(`👉 Winners Count   : ${winnersArr.length}`);
  console.log(`👉 Runners Count   : ${runnersArr.length}`);
  console.log(`📱 Web UI တွင် Week ${gwNum} ရဲ့ ဆုရစာရင်းကို တိုက်ရိုက်ဆွဲထုတ်ပြသနိုင်ပါပြီ။\n`);
  return true;
}

// =========================================================================
// 🌟 ၂။ TOURNAMENT REGISTRATION APPROVAL SYNC ENGINE
// =========================================================================
async function syncTargetCollection(collectionName) {
  console.log(`\n📂 Scanning Collection: [${collectionName}]...`);
  const colRef = db.collection(collectionName);
  let querySnapshot;

  if (slipTarget) {
    console.log(`   🔎 Checking KPay Slip: "${slipTarget}"...`);
    querySnapshot = await colRef.where("slipDigits", "==", slipTarget).get();
  } else if (targetVal) {
    console.log(`   🔎 Checking Team ID / Value: "${targetVal}"...`);
    querySnapshot = await colRef.where("fplTeamId", "==", targetVal).get();
    if (querySnapshot.empty && !isNaN(targetVal)) {
      querySnapshot = await colRef.where("fplTeamId", "==", Number(targetVal)).get();
    }
    if (querySnapshot.empty) {
      querySnapshot = await colRef.where("uid", "==", targetVal).get();
    }
  } else {
    console.log(`   🔎 Mode: Fetching ALL PENDING records...`);
    querySnapshot = await colRef.where("status", "==", "pending").get();
    if (querySnapshot.empty) {
      querySnapshot = await colRef.where("isApproved", "==", false).get();
    }
  }

  if (!querySnapshot || querySnapshot.empty) {
    console.log(`   ℹ️ [${collectionName}] တွင် ကိုက်ညီသော စာရင်း မရှိပါ။`);
    return 0;
  }

  console.log(`   ✅ တွေ့ရှိချက်: (${querySnapshot.size}) သင်း တွေ့ရှိပါသည်။ Processing...`);

  const batch = db.batch();

  querySnapshot.docs.forEach((docSnap) => {
    const data = docSnap.data();
    console.log(`   👉 Updated: ${data.teamName || "—"} | FPL ID: #${data.fplTeamId || "—"} | Slip: [${data.slipDigits}] -> ${newStatus.toUpperCase()}`);

    batch.update(docSnap.ref, {
      status: newStatus,
      isApproved: newApprovalFlag,
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      syncMethod: slipTarget ? "kpay-slip-verified" : "manual-sync"
    });

    if (data.uid) {
      const userDocRef = db.collection("users").doc(data.uid);
      batch.set(userDocRef, {
        lastTournamentReg: {
          collection: collectionName,
          regDocId: docSnap.id,
          status: newStatus,
          isApproved: newApprovalFlag,
          updatedAt: Date.now()
        }
      }, { merge: true });
    }
  });

  await batch.commit();
  return querySnapshot.size;
}

// Collection အဟောင်း (tournamentRegistrations) တွင် ဒေတာကျန်နေပါက Sync လုပ်ပေးခြင်း
async function syncLegacyTournamentRegistrations() {
  const colRef = db.collection("tournamentRegistrations");
  let querySnapshot;

  if (slipTarget) {
    querySnapshot = await colRef.where("slipDigits", "==", slipTarget).get();
  } else if (targetVal) {
    querySnapshot = await colRef.where("fplTeamId", "==", targetVal).get();
    if (querySnapshot.empty && !isNaN(targetVal)) {
      querySnapshot = await colRef.where("fplTeamId", "==", Number(targetVal)).get();
    }
  } else {
    querySnapshot = await colRef.where("status", "==", "pending").get();
    if (querySnapshot.empty) {
      querySnapshot = await colRef.where("isApproved", "==", false).get();
    }
  }

  if (!querySnapshot || querySnapshot.empty) return 0;

  console.log(`\n📂 Scanning Legacy: [tournamentRegistrations]... Found ${querySnapshot.size} records.`);
  const batch = db.batch();

  querySnapshot.docs.forEach((docSnap) => {
    const data = docSnap.data();
    batch.update(docSnap.ref, {
      status: newStatus,
      isApproved: newApprovalFlag,
      approvedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    if (data.uid) {
      batch.set(db.collection("users").doc(data.uid), {
        lastTournamentReg: {
          regDocId: docSnap.id,
          status: newStatus,
          isApproved: newApprovalFlag,
          updatedAt: Date.now()
        }
      }, { merge: true });
    }
  });

  await batch.commit();
  return querySnapshot.size;
}

// =========================================================================
// 🚀 MAIN EXECUTION ROUTER
// =========================================================================
async function runTwSuperSync() {
  // 🌟 အကယ်၍ TARGET_GW သို့မဟုတ် TOUR_CHOICE က 'set_winner' ဖြစ်နေပါက Winner စာရင်း သွင်းမည်
  if (targetGw || tourChoice === "set_winner") {
    await syncWeeklyWinners();
    return;
  }

  console.log(`\n=============================================================`);
  console.log(`🚀 TW TOURNAMENT SYNC ENGINE (Weekly & Super Cup)`);
  console.log(`💳 KPay Slip Filter : ${slipTarget ? `"${slipTarget}"` : "NONE"}`);
  console.log(`🎯 Target Value     : ${targetVal ? `"${targetVal}"` : "NONE"}`);
  console.log(`🏆 Tournament Scope : ${tourChoice.toUpperCase()}`);
  console.log(`⚙️ Execution Action : ${actionType.toUpperCase()}`);
  console.log(`=============================================================\n`);

  try {
    let totalUpdated = 0;

    if (tourChoice === "all" || tourChoice === "weekly") {
      totalUpdated += await syncTargetCollection("twf_weekly");
    }

    if (tourChoice === "all" || tourChoice === "supercup") {
      totalUpdated += await syncTargetCollection("twf_supercup");
    }

    totalUpdated += await syncLegacyTournamentRegistrations();

    console.log(`\n🎉 SYNC COMPLETED SUCCESSFULLY!`);
    console.log(`✨ စုစုပေါင်း အတည်ပြုပေးလိုက်သော အသင်း: (${totalUpdated}) သင်း`);
    console.log(`📱 Web UI ပေါ်တွင် Approved အသင်းစာရင်းများ တန်းပေါ်လာပါမည်။\n`);

  } catch (error) {
    console.error("❌ CRITICAL ERROR during execution:", error);
    process.exit(1);
  }
}

runTwSuperSync();
