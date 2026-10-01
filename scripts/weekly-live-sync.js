// ============================================
// TW Fantasy Official League
// Weekly Live Sync Script (Accurate Selling Price & Quota Optimized)
// ============================================

const admin = require("firebase-admin");
const axios = require("axios");
const { DiffWriter } = require("./lib/diff-sync");

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ Error: FIREBASE_SERVICE_ACCOUNT Environment Variable မတွေ့ရှိပါဗျာ။");
  process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();
let diffTeams, diffPoints; // main() ထဲမှာ load လုပ်မယ်

const FPL_BASE = "https://fantasy.premierleague.com/api";
const BOOTSTRAP_URL = `${FPL_BASE}/bootstrap-static/`;

async function fplFetch(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TW-Fantasy-Sync/1.0" },
        timeout: 9000
      });
      return res.data;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

function getGameweekInfo(bootstrap) {
  const currentEvent = bootstrap.events.find((e) => e.is_current);
  if (currentEvent) {
    return {
      gw: currentEvent.id,
      averagePoints: currentEvent.average_entry_score || 0
    };
  }
  const nextEvent = bootstrap.events.find((e) => e.is_next);
  if (nextEvent) {
    const prevFinished = bootstrap.events.filter(e => e.finished).pop();
    return {
      gw: nextEvent.id,
      averagePoints: prevFinished?.average_entry_score || 0
    };
  }
  return { gw: 1, averagePoints: 0 };
}

function buildPlayerInfoMap(bootstrap) {
  const posMap = {};
  bootstrap.element_types.forEach((et) => {
    posMap[et.id] = et.singular_name_short;
  });

  const officialTeamTranslateMap = {
    "ars": "ars", "avl": "avl", "bou": "bou", "bre": "bre", "bha": "bha",
    "che": "che", "cov": "cov", "cry": "cry", "eve": "eve", "ful": "ful",
    "hul": "hul", "ips": "ips", "lee": "lee", "liv": "liv", "mci": "mci",
    "mun": "mun", "new": "new", "nfo": "nfo", "sun": "sun", "tot": "tot"
  };

  const teamCodeMap = {};
  bootstrap.teams.forEach((t) => {
    const rawShortName = t.short_name.toLowerCase();
    teamCodeMap[t.id] = officialTeamTranslateMap[rawShortName] || rawShortName;
  });

  const playerInfoMap = {};
  bootstrap.elements.forEach((el) => {
    const status = el.status || "a";
    const nextChanceRaw = el.chance_of_playing_next_round;

    let chanceOfPlaying = 100;
    if (nextChanceRaw !== null && nextChanceRaw !== undefined) {
      chanceOfPlaying = Number(nextChanceRaw);
    } else if (status === "i" || status === "s" || status === "u") {
      chanceOfPlaying = 0;
    } else if (status === "d") {
      chanceOfPlaying = 75;
    }

    const currentPrice = parseFloat((el.now_cost / 10).toFixed(1));
    
    // 💡 FPL စတင်ချိန် မူလဈေးရင်းကို အတိအကျ တွက်ချက်ခြင်း
    // cost_change_start သည် Season စတင်ချိန်မှစ၍ တက်/ကျ ပမာဏ ဖြစ်သည် (ဥပမာ +2 ဆိုလျှင် 0.2m တက်ထားခြင်း)
    const costChangeFromStart = el.cost_change_start !== undefined ? el.cost_change_start : 0;
    const initialPrice = parseFloat(((el.now_cost - costChangeFromStart) / 10).toFixed(1));

    playerInfoMap[el.id] = {
      id: el.id,
      name: el.web_name,
      fullName: `${el.first_name} ${el.second_name}`,
      position: posMap[el.element_type] === "GKP" ? "GK" : posMap[el.element_type],
      teamId: el.team,
      teamCode: teamCodeMap[el.team] || "unknown",
      currentPrice: currentPrice,
      initialPrice: initialPrice,
      status: status,
      chanceOfPlaying: chanceOfPlaying,
      isSuspended: status === "s",
      isInjured: status === "i",
    };
  });

  return playerInfoMap;
}

async function getLivePoints(gw) {
  try {
    const data = await fplFetch(`${FPL_BASE}/event/${gw}/live/`);
    const pointsMap = {};
    if (data && data.elements) {
      data.elements.forEach((el) => {
        pointsMap[el.id] = el.stats.total_points;
      });
    }
    return pointsMap;
  } catch (e) {
    console.warn("Live points fetch note:", e.message);
    return {};
  }
}

// 💡 FPL Official Selling Price Rule (0.2 တက်လျှင် 0.1 အမြတ်ရမည်၊ ဈေးကျလျှင် လက်ရှိဈေးအတိုင်း ရောင်းရမည်)
function calculateSellingPrice(purchasePrice, currentPrice) {
  const pPrice = parseFloat(purchasePrice || currentPrice || 0.0);
  const cPrice = parseFloat(currentPrice || pPrice || 0.0);
  
  if (cPrice <= pPrice) return cPrice;
  
  // 0.2 တက်မှ 0.1 ရမည့် သင်္ချာဖော်မြူလာ
  const profit = Math.round((cPrice - pPrice) * 10);
  const profitGain = Math.floor(profit / 2) / 10;
  return parseFloat((pPrice + profitGain).toFixed(1));
}

async function syncUserTeam(fplId, gw, gwAverage, livePointsMap, playerInfoMap) {
  try {
    const picksData = await fplFetch(`${FPL_BASE}/entry/${fplId}/event/${gw}/picks/`);
    const entryData = await fplFetch(`${FPL_BASE}/entry/${fplId}/`);
    
    // 💡 Transfers History အား အသစ်ဆုံးအချိန်မှ စတင်၍ စစ်ဆေးရန် ခေါ်ယူခြင်း
    let transferHistory = [];
    try {
      const tData = await fplFetch(`${FPL_BASE}/entry/${fplId}/transfers/`);
      if (Array.isArray(tData)) {
        // အသစ်ဆုံး transfer ကို ထိပ်ဆုံးရောက်အောင် sort ပြုလုပ်ခြင်း
        transferHistory = tData.sort((a, b) => new Date(b.time) - new Date(a.time));
      }
    } catch (_) {
      transferHistory = [];
    }

    let usedChips = [];
    let calculatedFreeTransfers = 1;

    try {
      const historyData = await fplFetch(`${FPL_BASE}/entry/${fplId}/history/`);
      if (historyData && Array.isArray(historyData.chips)) {
        usedChips = historyData.chips.map(c => c.name);
      }
      const currentEventHistory = historyData.current?.find(h => Number(h.event) === Number(gw));
      if (currentEventHistory) {
        const transfersMade = currentEventHistory.event_transfers || 0;
        const hitCost = currentEventHistory.event_transfers_cost || 0;
        calculatedFreeTransfers = transfersMade === 0 ? Math.min(5, 1 + (historyData.current.length > 1 ? 1 : 0)) : 1;
        if (hitCost > 0) calculatedFreeTransfers = 1;
      }
    } catch (hErr) {
      // ignore
    }

    const transferCost = picksData.entry_history?.event_transfers_cost || 0;
    const activeChip = picksData.active_chip || null;
    const isBenchBoost = activeChip === "bboost";

    const rawBank = picksData.entry_history?.bank ?? 0;
    const teamBank = parseFloat((Number(rawBank) / 10).toFixed(1));

    const picks = picksData.picks.map((p, index) => {
      const pInfo = playerInfoMap[p.element] || {
        name: "Unknown",
        fullName: "Unknown Player",
        position: "?",
        teamCode: "unknown",
        currentPrice: 0,
        initialPrice: 0,
        status: "a",
        chanceOfPlaying: 100,
        isSuspended: false,
        isInjured: false,
      };

      const rawPoints = livePointsMap[p.element] || 0;
      let effectiveMultiplier = p.multiplier;
      if (isBenchBoost && index >= 11 && effectiveMultiplier === 0) {
        effectiveMultiplier = 1;
      }

      const currentPrice = pInfo.currentPrice;

      // 💡 ဝယ်ယူခဲ့သည့် ဈေးနှုန်း (Purchase Price) ကို အသစ်ဆုံး Transfer History မှ တိကျစွာ ရှာယူခြင်း
      let purchasePrice = currentPrice;
      const latestBuy = transferHistory.find(t => t.element_in === p.element);

      if (latestBuy && latestBuy.element_in_cost) {
        purchasePrice = parseFloat((latestBuy.element_in_cost / 10).toFixed(1));
      } else {
        // Transfer မလုပ်ဘဲ Season စကတည်းက ပါလာသော ကစားသမားဖြစ်ပါက မူလစတင်ဈေး (Initial Cost) ကို ဝယ်ဈေးအဖြစ် သတ်မှတ်မည်
        purchasePrice = pInfo.initialPrice > 0 ? pInfo.initialPrice : currentPrice;
      }

      // 💡 FPL 50% Profit Rule ဖြင့် Selling Price ကို မှန်ကန်စွာ တွက်ထုတ်ခြင်း
      const sellingPrice = calculateSellingPrice(purchasePrice, currentPrice);

      return {
        playerId: p.element,
        name: pInfo.name,
        fullName: pInfo.fullName,
        position: pInfo.position,
        teamCode: pInfo.teamCode,
        currentPrice: currentPrice,       // 👈 လက်ရှိပေါက်ဈေး
        purchasePrice: purchasePrice,     // 👈 ဝယ်ယူခဲ့သောဈေး
        sellingPrice: sellingPrice,       // 👈 ရောင်းရမည့်ဈေး (50% profit margin)
        price: currentPrice,              // Default price
        multiplier: effectiveMultiplier,
        isCaptain: p.is_captain,
        isVice: p.is_vice_captain,
        livePoints: rawPoints,
        status: pInfo.status,
        chanceOfPlaying: pInfo.chanceOfPlaying,
        isSuspended: pInfo.isSuspended,
        isInjured: pInfo.isInjured,
      };
    });

    let calculatedLiveGwPoints = 0;
    const targetScoringPicks = isBenchBoost ? picks : picks.slice(0, 11);
    targetScoringPicks.forEach((p) => {
      calculatedLiveGwPoints += (Number(p.livePoints || 0) * Number(p.multiplier || 1));
    });

    const captainPick = picks.find((p) => p.isCaptain);
    const captainPoints = captainPick ? (captainPick.livePoints * (captainPick.multiplier || 2)) : 0;

    // 💡 Firestore ထဲသို့ သွားရောက် သိမ်းဆည်းခြင်း
    const teamPayload = {
      fplTeamId: fplId,
      gameweek: gw,
      bank: teamBank,
      freeTransfers: calculatedFreeTransfers,
      usedChips: usedChips,
      activeChip: activeChip,
      picks: picks,
    };
    if (diffTeams.changed(fplId, teamPayload)) await db.collection("liveTeams").doc(String(fplId)).set({ ...teamPayload, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    const pointsPayload = {
      fplTeamId: fplId,
      gameweek: gw,
      gwPoints: calculatedLiveGwPoints,
      totalPoints: entryData.summary_overall_points || 0,
      averagePoints: gwAverage,
      gwRank: entryData.summary_event_rank || null,
      overallRank: entryData.summary_overall_rank || null,
      transferCost: transferCost,
      activeChip: activeChip,
      captainPoints: captainPoints,
    };
    if (diffPoints.changed(fplId, pointsPayload)) await db.collection("livePoints").doc(String(fplId)).set({ ...pointsPayload, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    console.log(`✅ Synced Team: ${fplId} (Picks: ${picks.length})`);
    return true;
  } catch (err) {
    console.error(`❌ Failed: FPL ID ${fplId} — ${err.message}`);
    return false;
  }
}

async function main() {
  console.log("🚀 TW Fantasy — Weekly Live Sync Starting...");
  try {
    const bootstrap = await fplFetch(BOOTSTRAP_URL);
    const { gw: targetWeek, averagePoints: gwAverage } = getGameweekInfo(bootstrap);
    const playerInfoMap = buildPlayerInfoMap(bootstrap);
    const livePointsMap = await getLivePoints(targetWeek);

    const usersSnapshot = await db.collection("users").select("fplTeamId").get();
    const fplIds = [];
    usersSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.fplTeamId) fplIds.push(data.fplTeamId);
    });

    console.log(`👥 Total Teams to Sync: ${fplIds.length}`);
    diffTeams = await new DiffWriter(db, "liveTeams").load();
    diffPoints = await new DiffWriter(db, "livePoints").load();

    let successCount = 0;
    let failCount = 0;

    for (const fplId of fplIds) {
      const result = await syncUserTeam(fplId, targetWeek, gwAverage, livePointsMap, playerInfoMap);
      if (result) successCount++;
      else failCount++;
      await new Promise((r) => setTimeout(r, 400));
    }

    console.log(`🎉 Sync Complete — Success: ${successCount}, Failed: ${failCount}`);
    process.exit(0);
  } catch (err) {
    console.error("🔥 Fatal Error:", err.message);
    process.exit(1);
  }
}

    await diffTeams.save();
    await diffPoints.save();
main();
