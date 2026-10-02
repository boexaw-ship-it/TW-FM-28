// ============================================
// TW Fantasy Official League
// Unified League Sync Engine (1 Doc per League = 1 Quota Pattern)
// Features: Live BPS, Live Auto-Subs, Vice-Captain Promotion, Net GW Points
// Fix: 1MB Document Limit Exceeded Resolution via Payload Optimization
// ============================================

const admin = require("firebase-admin");
const { DiffWriter } = require("./lib/diff-sync");

// === Firebase Admin Init ===
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

// === FPL API Endpoint ===
const FPL_BASE = "https://fantasy.premierleague.com/api";

// === 5 Leagues Config ===
const LEAGUES = [
  { firebaseId: "league1", fplLeagueId: 36009, name: "TW FPL WEEKLY" },
  { firebaseId: "league2", fplLeagueId: 2004515, name: "TWFPL SUPER" },
  { firebaseId: "league3", fplLeagueId: 8074, name: "FPL Poseidon Pro League" },
  { firebaseId: "league4", fplLeagueId: 9520, name: "FPL Poseidon Semi-pro League" },
  { firebaseId: "league5", fplLeagueId: 10399, name: "FPL Poseidon Amateur League" }
];

// === Helper: Exponential Backoff Fetch ===
async function fplFetch(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 TW-Fantasy-Sync/2.0 (High-Performance)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.log(`⚠️ Fetch failed (${i + 1}/${retries}): ${url}`);
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
}

// 📊 ကစားသမား Master Data နှင့် Live Gameweek Element Match Stats ရယူခြင်း
async function getPlayerMasterMap(targetGw) {
  console.log("📊 Fetching FPL Bootstrap-Static & Live Match Data...");
  const [bootstrap, liveData] = await Promise.all([
    fplFetch(`${FPL_BASE}/bootstrap-static/`),
    fplFetch(`${FPL_BASE}/event/${targetGw}/live/`).catch(() => ({ elements: [] }))
  ]);

  const teamsMap = {};
  bootstrap.teams.forEach(t => {
    teamsMap[t.id] = (t.short_name || "").toUpperCase().trim();
  });

  const liveStatsMap = {};
  (liveData.elements || []).forEach(item => {
    liveStatsMap[item.id] = {
      minutes: item.stats?.minutes ?? 0,
      goals: item.stats?.goals_scored ?? 0,
      assists: item.stats?.assists ?? 0,
      cleanSheets: item.stats?.clean_sheets ?? 0,
      bps: item.stats?.bps ?? 0,
      bonus: item.stats?.bonus ?? 0,
      livePoints: item.stats?.total_points ?? 0,
      inProgress: item.explain && item.explain.length > 0
    };
  });

  const playersMap = {};
  const positions = ["", "gk", "def", "mid", "fwd"];

  bootstrap.elements.forEach(p => {
    const status = p.status || "a";
    const nextChanceRaw = p.chance_of_playing_next_round;
    const thisChanceRaw = p.chance_of_playing_this_round;

    let chanceOfPlaying = 100;
    if (nextChanceRaw !== null && nextChanceRaw !== undefined) {
      chanceOfPlaying = Number(nextChanceRaw);
    } else if (status === "i" || status === "s" || status === "u") {
      chanceOfPlaying = 0;
    } else if (status === "d") {
      chanceOfPlaying = 75;
    }

    const liveInfo = liveStatsMap[p.id] || {
      minutes: 0,
      goals: 0,
      assists: 0,
      cleanSheets: 0,
      bps: 0,
      bonus: 0,
      livePoints: p.event_points ?? 0,
      inProgress: false
    };

    playersMap[p.id] = {
      name: p.web_name,
      fullName: `${p.first_name} ${p.second_name}`,
      position: positions[p.element_type] || "mid",
      elementType: p.element_type,
      teamCode: teamsMap[p.team] || "UNKNOWN",
      price: parseFloat((p.now_cost / 10).toFixed(1)),
      
      livePoints: liveInfo.livePoints,
      minutesPlayed: liveInfo.minutes,
      bps: liveInfo.bps,
      provisionalBonus: liveInfo.bonus,
      goalsScored: liveInfo.goals,
      assists: liveInfo.assists,

      status: status,
      chanceOfPlaying: chanceOfPlaying,
      chanceOfPlayingThisRound: thisChanceRaw !== null ? Number(thisChanceRaw) : null,
      isAvailable: status === "a" && chanceOfPlaying === 100,
      isDoubtful: status === "d" || (chanceOfPlaying > 0 && chanceOfPlaying < 100),
      isSuspended: status === "s",
      isInjured: status === "i",
      news: p.news || ""
    };
  });

  return { playersMap, events: bootstrap.events || [] };
}

// 🗓️ Gameweek အား Auto Detect ပြုလုပ်ခြင်း
function autoDetectCurrentGameweek(events) {
  const current = events.find(e => e.is_current === true);
  if (current) return current.id;
  const next = events.find(e => e.is_next === true);
  if (next) return next.id;
  const finishedEvents = events.filter(e => e.finished === true);
  if (finishedEvents.length > 0) return finishedEvents[finishedEvents.length - 1].id;
  return 1;
}

// === Standings Pagination Fetcher ===
async function fetchAllStandings(leagueId) {
  let allResults = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    const data = await fplFetch(
      `${FPL_BASE}/leagues-classic/${leagueId}/standings/?page_standings=${page}`
    );
    const results = data.standings?.results || [];
    allResults = allResults.concat(results);
    hasNext = data.standings?.has_next || false;
    page++;
    if (hasNext) await new Promise((r) => setTimeout(r, 200));
  }

  return allResults;
}

// === Team Picks Extraction with Auto-sub & Vice-Captain Intelligence ===
async function getTeamGwDetail(fplTeamId, gw, playersMasterMap) {
  try {
    const data = await fplFetch(`${FPL_BASE}/entry/${fplTeamId}/event/${gw}/picks/`);
    const activeChip = data.active_chip || null;
    const isBenchBoost = (activeChip === "bboost");
    const isTripleCaptain = (activeChip === "3xc");

    let rawPicks = (data.picks || []).map((p, index) => {
      const master = playersMasterMap[p.element] || {
        name: "?", fullName: "?", position: "mid", elementType: 3, teamCode: "UNKNOWN",
        price: 0, livePoints: 0, minutesPlayed: 0, bps: 0, provisionalBonus: 0,
        status: "a", chanceOfPlaying: 100, isAvailable: true, isDoubtful: false,
        isSuspended: false, isInjured: false, news: ""
      };

      return {
        playerId: p.element,
        name: master.name,
        position: master.position,
        elementType: master.elementType,
        teamCode: master.teamCode,
        livePoints: master.livePoints,
        minutesPlayed: master.minutesPlayed,
        bps: master.bps,
        isCaptain: p.is_captain === true,
        isVice: p.is_vice_captain === true,
        originalMultiplier: p.multiplier,
        multiplier: p.multiplier,
        isStarter: index < 11,
        benchIndex: index >= 11 ? (index - 10) : 0,
        status: master.status,
        autoSubbedIn: false,
        autoSubbedOut: false
      };
    });

    // 1. Captain / Vice-Captain Live Logic
    const cap = rawPicks.find(p => p.isCaptain);
    const vice = rawPicks.find(p => p.isVice);

    if (cap && cap.minutesPlayed === 0 && cap.status !== "a" && vice) {
      if (cap.multiplier > 1) {
        vice.multiplier = isTripleCaptain ? 3 : 2;
        cap.multiplier = 0;
        cap.autoCaptainFailed = true;
        vice.promotedToCaptain = true;
      }
    }

    // 2. Live Auto-Substitution Calculation
    if (!isBenchBoost) {
      const starters = rawPicks.filter(p => p.isStarter);
      const bench = rawPicks.filter(p => !p.isStarter);

      starters.forEach(starter => {
        if (starter.minutesPlayed === 0 && (starter.status === "i" || starter.status === "s" || starter.status === "u")) {
          if (starter.elementType === 1) {
            const subGK = bench.find(b => b.elementType === 1 && b.minutesPlayed > 0 && !b.autoSubbedIn);
            if (subGK) {
              starter.autoSubbedOut = true;
              starter.multiplier = 0;
              subGK.autoSubbedIn = true;
              subGK.multiplier = 1;
            }
          } else {
            const activeDefs = starters.filter(s => s.elementType === 2 && !s.autoSubbedOut).length;
            for (const sub of bench) {
              if (sub.elementType === 1 || sub.autoSubbedIn || sub.minutesPlayed === 0) continue;
              if (starter.elementType === 2 && activeDefs < 3 && sub.elementType !== 2) continue;

              starter.autoSubbedOut = true;
              starter.multiplier = 0;
              sub.autoSubbedIn = true;
              sub.multiplier = 1;
              break;
            }
          }
        }
      });
    }

    // 3. Total Live GW Points တွက်ချက်ခြင်း
    let calculatedLiveGwPoints = 0;
    rawPicks.forEach(p => {
      const mult = isBenchBoost ? (p.originalMultiplier || 1) : p.multiplier;
      if (mult > 0) {
        calculatedLiveGwPoints += (p.livePoints * mult);
      }
    });

    const hitCost = data.entry_history?.event_transfers_cost || 0;
    const netLiveGwPoints = calculatedLiveGwPoints - hitCost;

    // 💡 1MB Limit မကျော်စေရန် ပိုမိုကျစ်လျစ်သော Lightweight Picks Structure အဖြစ် ပြောင်းလဲခြင်း
    const compactPicks = rawPicks.map(p => ({
      id: p.playerId,
      name: p.name,
      pos: p.position,
      pts: p.livePoints,
      mult: p.multiplier,
      c: p.isCaptain,
      v: p.isVice,
      subIn: p.autoSubbedIn,
      subOut: p.autoSubbedOut
    }));

    return {
      chip: activeChip,
      hitCost: hitCost,
      grossGwPoints: calculatedLiveGwPoints,
      gwPoints: netLiveGwPoints,
      picks: compactPicks
    };
  } catch (err) {
    return { chip: null, hitCost: 0, grossGwPoints: 0, gwPoints: 0, picks: [] };
  }
}

// 📦 Helper: Document အရွယ်အစား 1MB မကျော်စေရန် အနီးစပ်ဆုံး တွက်ချက်ခြင်း
function calculateByteSize(obj) {
  return Buffer.byteLength(JSON.stringify(obj), "utf8");
}

// === Synchronize Specific League with Auto-Splitting Protection ===
async function syncLeague(leagueConfig, gw, playersMasterMap) {
  const { firebaseId, fplLeagueId, name } = leagueConfig;
  console.log(`📥 Syncing League: "${name}" | ID: ${fplLeagueId}...`);

  try {
    const standings = await fetchAllStandings(fplLeagueId);
    const diff = await new DiffWriter(db, "league_" + firebaseId).load();
    console.log(`   Found ${standings.length} managers in "${name}" — processing squads...`);

    const teamsPayload = [];

    for (const team of standings) {
      const detail = await getTeamGwDetail(team.entry, gw, playersMasterMap);

      teamsPayload.push({
        fplTeamId: team.entry,
        teamName: team.entry_name,
        managerName: team.player_name,
        rank: team.rank,
        lastRank: team.last_rank,
        rankDelta: (team.last_rank ? team.last_rank - team.rank : 0),
        totalPoints: team.total,
        grossGwPoints: detail.grossGwPoints,
        gwPoints: detail.gwPoints,
        hitCost: detail.hitCost,
        chip: detail.chip,
        picks: detail.picks
      });

      await new Promise(r => setTimeout(r, 25));
    }

    // 💡 1MB Overflow Guard: အကယ်၍ Document အရွယ်အစားသည် 950KB ကျော်နေပါက အလိုအလျောက် Split လုပ်မည်
    const basePayload = {
      leagueName: name,
      fplLeagueId: fplLeagueId,
      gameweek: gw,
      totalTeams: teamsPayload.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const fullDocPayload = { ...basePayload, teams: teamsPayload };
    const payloadBytes = calculateByteSize(fullDocPayload);
    console.log(`   Estimated Document Size: ${(payloadBytes / 1024).toFixed(1)} KB (Max: 1024 KB)`);

    const leagueDocRef = db.collection("leagues").doc(firebaseId);

    if (payloadBytes < 950 * 1024) {
      // 950KB အောက်ဖြစ်ပါက Single Document အဖြစ် သိမ်းဆည်းမည် (1 Write Quota)
      if (diff.changed("unified_league_payload", fullDocPayload)) {
        await leagueDocRef.set(fullDocPayload, { merge: true });
        console.log(`💾 [SAVED 1-DOC] League "${name}" (${firebaseId}) successfully written to Firestore.`);
      } else {
        console.log(`⚡ [NO CHANGE] League "${name}" is identical to previous sync.`);
      }
    } else {
      // 950KB ထက်ကျော်ပါက (ဥပမာ Amateur League တွင် ၂၄၈ ယောက်ရှိပါက) Chunked Multi-Doc အဖြစ် ခွဲထုတ်မည်
      console.log(`⚠️ Document exceeds safe limit! Auto-partitioning into chunks...`);
      const CHUNK_SIZE = 75; // တစ်ဖိုင်လျှင် Manager ၇၅ ယောက်ခန့်သာ ထည့်မည်
      const totalChunks = Math.ceil(teamsPayload.length / CHUNK_SIZE);

      // မူလ document တွင် Standings Summary ကိုသာ သိမ်းမည် (picks မပါဘဲ အပေါ့ဆုံး)
      const summaryTeams = teamsPayload.map(({ picks, ...rest }) => rest);
      await leagueDocRef.set({
        ...basePayload,
        isChunked: true,
        totalChunks: totalChunks,
        teams: summaryTeams // Standings Table တင်ရန် အပေါ့ဆုံး payload
      }, { merge: true });

      // picks အသေးစိတ်များကို sub-documents ထဲသို့ ခွဲထုတ်သိမ်းဆည်းမည်
      for (let i = 0; i < totalChunks; i++) {
        const chunkTeams = teamsPayload.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkRef = leagueDocRef.collection("chunks").doc(`chunk_${i + 1}`);
        await chunkRef.set({
          chunkIndex: i + 1,
          teams: chunkTeams,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      console.log(`💾 [SAVED CHUNKS] League "${name}" successfully saved across ${totalChunks} chunks safely!`);
    }

    await diff.save({ prune: true });
    console.log(`✅ League "${name}" Sync Complete!`);
  } catch (err) {
    console.error(`❌ League sync error (${name}): ${err.message}`);
  }
}

// === Main Engine ===
async function main() {
  console.log("🚀 Starting Optimized 5-League Sync Engine (Safe Quota Architecture)...");

  try {
    const bootstrapFirst = await fplFetch(`${FPL_BASE}/bootstrap-static/`);
    const targetWeek = autoDetectCurrentGameweek(bootstrapFirst.events || []);
    console.log(`🤖 Target Gameweek: GW ${targetWeek}`);

    const { playersMap: playersMasterMap } = await getPlayerMasterMap(targetWeek);

    for (const league of LEAGUES) {
      await syncLeague(league, targetWeek, playersMasterMap);
    }

    console.log(`🎉 [COMPLETED] All Leagues Synced successfully without Firestore size limit violations!`);
    process.exit(0);
  } catch (err) {
    console.error("Fatal Error: " + err.message);
    process.exit(1);
  }
}

main();
