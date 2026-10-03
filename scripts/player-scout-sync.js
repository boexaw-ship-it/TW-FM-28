// ============================================
// TW Fantasy Official League
// Player Scout Sync Engine + Scout Highlights Document
// Targets:
//   1) scoutPlayers/allPlayers    (Full Master Player List)
//   2) scoutPlayers/scoutHighlights (Top Leaders & Highlights Document)
// Fix: Most Captained Top 5 Players Full Resolution
// ============================================

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { DiffWriter } = require("./lib/diff-sync");

// === Firebase Admin Initialization ===
const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!rawServiceAccount) {
  console.error("❌ Error: FIREBASE_SERVICE_ACCOUNT Environment Variable မတွေ့ရှိပါဗျာ။");
  process.exit(1);
}

const serviceAccount = typeof rawServiceAccount === "string"
  ? JSON.parse(rawServiceAccount)
  : rawServiceAccount;

const app = getApps().length === 0
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApps()[0];

const db = getFirestore(app);

// === FPL API Endpoints ===
const FPL_BASE = "https://fantasy.premierleague.com/api";
const BOOTSTRAP_URL = `${FPL_BASE}/bootstrap-static/`;
const FIXTURES_URL = `${FPL_BASE}/fixtures/`;

// === Helper: Exponential Backoff Fetcher ===
async function fplFetch(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 TW-Fantasy-Sync/2.0 (Full-Scout-Data)" },
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

// 🤖 Auto-Detect Current Gameweek Lifecycle Engine
function autoDetectGameweek(events = []) {
  const currentEvent = events.find((e) => e.is_current === true) 
    || events.find((e) => e.is_next === true) 
    || events.filter((e) => e.finished).pop() 
    || events[0] 
    || {};

  const nextEvent = events.find((e) => e.is_next === true) || null;

  return {
    id: currentEvent.id || 1,
    name: currentEvent.name || `Gameweek ${currentEvent.id || 1}`,
    deadlineTime: currentEvent.deadline_time || null,
    deadlineEpoch: currentEvent.deadline_time ? new Date(currentEvent.deadline_time).getTime() : 0,
    isCurrent: Boolean(currentEvent.is_current),
    isNext: Boolean(currentEvent.is_next),
    isFinished: Boolean(currentEvent.finished),
    dataChecked: Boolean(currentEvent.data_checked),
    averageScore: currentEvent.average_entry_score || 0,
    highestScore: currentEvent.highest_score || 0,
    mostCaptained: currentEvent.most_captained || null,
    mostViceCaptained: currentEvent.most_vice_captained || null,
    mostSelected: currentEvent.most_selected || null,
    mostTransferredIn: currentEvent.most_transferred_in || null,
    topPlayerId: currentEvent.top_element || null,
    topPlayerPoints: currentEvent.top_element_info?.points || 0,
    transfersMade: currentEvent.transfers_made || 0,
    chipPlays: (currentEvent.chip_plays || []).map((c) => ({
      chipName: c.chip_name,
      numPlayed: c.num_played,
    })),
    nextGw: nextEvent ? {
      id: nextEvent.id,
      name: nextEvent.name,
      deadlineTime: nextEvent.deadline_time,
      deadlineEpoch: new Date(nextEvent.deadline_time).getTime(),
    } : null,
  };
}

// === Step 2: Team Code & Name Mappings ===
function buildTeamMaps(bootstrap) {
  const teamCodeMap = {};
  const teamNameMap = {};
  bootstrap.teams.forEach((t) => {
    teamCodeMap[t.id] = (t.short_name || "").toLowerCase().trim();
    teamNameMap[t.id] = t.name;
  });
  return { teamCodeMap, teamNameMap };
}

// === Step 3: Next Fixtures (လာမည့် ၃ ပွဲတိတိသာ အသင်း ၂၀ စာ Buffer ပြုလုပ်ခြင်း) ===
function buildNext3FixturesMap(fixtures, currentGwId, teamNameMap, teamCodeMap) {
  const upcoming = fixtures
    .filter((f) => !f.finished && f.event && f.event >= currentGwId)
    .sort((a, b) => a.event - b.event);

  const teamFixturesMap = {};
  for (let teamId = 1; teamId <= 20; teamId++) {
    const teamFixtures = upcoming.filter(
      (f) => f.team_h === teamId || f.team_a === teamId
    );

    teamFixturesMap[teamId] = teamFixtures.slice(0, 3).map((f) => {
      const isHome = f.team_h === teamId;
      const opponentId = isHome ? f.team_a : f.team_h;
      const fdr = isHome ? f.team_h_difficulty : f.team_a_difficulty;
      return {
        gw: f.event,
        opp: teamNameMap[opponentId] || "TBC",
        oppCode: (teamCodeMap[opponentId] || "unk").toUpperCase(),
        isHome: isHome,
        fdr: fdr || 3,
      };
    });
  }
  return teamFixturesMap;
}

// 🌟 Format Helper: Card Rendering အတွက် အသုံးဝင်သော Player Summary Object ပြုလုပ်ခြင်း
function createCardSummary(player) {
  if (!player) return null;
  return {
    playerId: player.playerId,
    name: player.name,
    fullName: player.fullName,
    position: player.position,
    teamCode: player.teamCode,
    price: player.price,
    totalPoints: player.totalPoints,
    gwPoints: player.gwPoints,
    ownership: player.ownership,
    form: player.form,
    transfersInEvent: player.transfersInEvent,
    transfersOutEvent: player.transfersOutEvent,
    status: player.status,
    chanceOfPlaying: player.chanceOfPlaying
  };
}

// === Main Execution Function ===
async function main() {
  console.log("🚀 TW Fantasy — Full Player Scout Sync Starting...");
  console.log("Time:", new Date().toISOString());

  try {
    const [bootstrap, fixtures] = await Promise.all([
      fplFetch(BOOTSTRAP_URL),
      fplFetch(FIXTURES_URL),
    ]);

    const currentGwDetails = autoDetectGameweek(bootstrap.events || []);
    console.log(`📅 Current Gameweek: ${currentGwDetails.name} (Live: ${currentGwDetails.isCurrent})`);

    const isSeasonStarted = bootstrap.events.some((e) => e.is_current || e.finished);
    const { teamCodeMap, teamNameMap } = buildTeamMaps(bootstrap);
    const next3FixturesMap = buildNext3FixturesMap(fixtures, currentGwDetails.id, teamNameMap, teamCodeMap);

    const posMap = {};
    const positions = ["", "gk", "def", "mid", "fwd"];
    bootstrap.element_types.forEach((et) => {
      posMap[et.id] = positions[et.id] || "mid";
    });

    console.log(`👥 Total Raw FPL Elements: ${bootstrap.elements.length}`);

    const allValidPlayers = [];

    for (const el of bootstrap.elements) {
      const status = el.status || "a";

      // 🚨 ရောင်းထုတ်ခံရသူများ (Unavailable / Left League) ကို လုံးဝ မထည့်ပါ
      if (status === "u") {
        continue;
      }

      // 💡 ၁။ TOTAL POINTS & WEEK POINTS
      const totalPoints = isSeasonStarted ? (el.total_points || 0) : 0;
      const gwPoints = isSeasonStarted ? (el.event_points || 0) : 0;
      
      // 💡 ၂။ FORM & OWNERSHIP
      const form = isSeasonStarted ? (parseFloat(el.form) || 0.0) : 0.0;
      const ownership = parseFloat(el.selected_by_percent) || 0.0;
      const price = parseFloat((el.now_cost / 10).toFixed(1));

      // 💡 ၃။ METRICS & RATIOS
      const minutesPlayed = el.minutes || 0;
      const matchesPlayed = minutesPlayed > 0 ? Math.max(1, Math.ceil(minutesPlayed / 90)) : 1;
      const ppg = isSeasonStarted ? parseFloat((totalPoints / matchesPlayed).toFixed(2)) : 0.0;
      const val = price > 0 ? parseFloat((totalPoints / price).toFixed(1)) : 0.0;
      const l5 = isSeasonStarted ? parseFloat((form * 5).toFixed(1)) : 0.0;

      // 💡 ၄။ EXPECTED STATS (xG, xA, xGI)
      const xg = parseFloat(el.expected_goals) || 0.0;
      const xa = parseFloat(el.expected_assists) || 0.0;
      const xgi = parseFloat((xg + xa).toFixed(2));
      const ict = parseFloat(el.ict_index) || 0.0;

      // 💡 ၅။ AVAILABILITY & PLAYING CHANCE ENGINE
      const nextChanceRaw = el.chance_of_playing_next_round;
      const thisChanceRaw = el.chance_of_playing_this_round;

      let chanceOfPlaying = 100;
      if (nextChanceRaw !== null && nextChanceRaw !== undefined) {
        chanceOfPlaying = Number(nextChanceRaw);
      } else if (status === "i" || status === "s") {
        chanceOfPlaying = 0;
      } else if (status === "d") {
        chanceOfPlaying = 75;
      }

      const isAvailable = status === "a" && chanceOfPlaying === 100;
      const isDoubtful = status === "d" || (chanceOfPlaying > 0 && chanceOfPlaying < 100);
      const isSuspended = status === "s";
      const isInjured = status === "i";

      allValidPlayers.push({
        playerId: el.id,
        id: el.id,
        name: el.web_name,
        fullName: `${el.first_name} ${el.second_name}`,
        position: posMap[el.element_type] || "mid",
        elementType: el.element_type,
        teamId: el.team,
        team: teamNameMap[el.team] || "Unknown",
        teamCode: (teamCodeMap[el.team] || "unk").toUpperCase(),
        price: price,
        costChangeStart: el.cost_change_start || 0,
        costChangeEvent: el.cost_change_event || 0,

        totalPoints: totalPoints,
        total_points: totalPoints,
        gwPoints: gwPoints,
        event_points: gwPoints,
        points: totalPoints,
        form: form,
        ownership: ownership,
        selected_by_percent: ownership,
        xGI: xgi,
        xgi: xgi,
        xG: xg,
        xA: xa,
        xGC: parseFloat(el.expected_goals_conceded) || 0.0,
        ict: ict,

        minutes: minutesPlayed,
        goals: el.goals_scored || 0,
        assists: el.assists || 0,
        cleanSheets: el.clean_sheets || 0,
        goalsConceded: el.goals_conceded || 0,
        ownGoals: el.own_goals || 0,
        penaltiesSaved: el.penalties_saved || 0,
        penaltiesMissed: el.penalties_missed || 0,
        yellowCards: el.yellow_cards || 0,
        redCards: el.red_cards || 0,
        saves: el.saves || 0,
        bonus: el.bonus || 0,
        bps: el.bps || 0,

        ppg: ppg,
        val: val,
        l5: l5,
        influence: parseFloat(el.influence) || 0.0,
        creativity: parseFloat(el.creativity) || 0.0,
        threat: parseFloat(el.threat) || 0.0,
        transfersInEvent: el.transfers_in_event || 0,
        transfersOutEvent: el.transfers_out_event || 0,

        nextMatches: next3FixturesMap[el.team] || [],

        status: status,
        chanceOfPlaying: chanceOfPlaying,
        chanceOfPlayingThisRound: thisChanceRaw !== null ? Number(thisChanceRaw) : null,
        isAvailable: isAvailable,
        isDoubtful: isDoubtful,
        isSuspended: isSuspended,
        isInjured: isInjured,
        news: el.news || "",
        newsAdded: el.news_added || null,
      });
    }

    // 💡 1-DOCUMENT MASTER PAYLOAD (မူလ logic အတိုင်း scoutPlayers/allPlayers သို့ သိမ်းဆည်းခြင်း)
    const masterScoutPayload = {
      currentGameweek: currentGwDetails,
      isSeasonStarted: isSeasonStarted,
      totalPlayers: allValidPlayers.length,
      updatedAt: FieldValue.serverTimestamp(),
      fixturesByTeam: next3FixturesMap,
      players: allValidPlayers,
    };

    const docRef = db.collection("scoutPlayers").doc("allPlayers");
    await docRef.set(masterScoutPayload);
    const approxSizeKb = Math.round(Buffer.byteLength(JSON.stringify(masterScoutPayload)) / 1024);
    console.log(`✅ [MASTER DOC] scoutPlayers/allPlayers Synced (~${approxSizeKb} KB)`);

    // =========================================================================
    // 🌟 DOCUMENT (၂) - SCOUT HIGHLIGHTS (Top 5 Most Captained Engine)
    // =========================================================================

    // 👑 MOST CAPTAINED TOP 5 ရွေးချယ်မှု စနစ်
    const topCaptainsList = [];
    const chosenIds = new Set();

    // ၁။ FPL Official နံပါတ် ၁ Most Captained ကစားသမား
    const officialMostCap = allValidPlayers.find(p => p.playerId === currentGwDetails.mostCaptained);
    if (officialMostCap) {
      topCaptainsList.push(createCardSummary(officialMostCap));
      chosenIds.add(officialMostCap.playerId);
    }

    // ၂။ FPL Official နံပါတ် ၂ Most Vice-Captained ကစားသမား
    const officialMostVice = allValidPlayers.find(p => p.playerId === currentGwDetails.mostViceCaptained);
    if (officialMostVice && !chosenIds.has(officialMostVice.playerId)) {
      topCaptainsList.push(createCardSummary(officialMostVice));
      chosenIds.add(officialMostVice.playerId);
    }

    // ၃။ ကျန် ၃ နေရာအတွက် Form နှင့် Ownership အမြင့်ဆုံး တိုက်စစ်မှူး/ကွင်းလယ်လူများထဲမှ Captaincy Index ဖြင့် ထပ်မံဖြည့်စွက်ခြင်း
    const captainCandidates = allValidPlayers
      .filter(p => !chosenIds.has(p.playerId) && (p.position === "fwd" || p.position === "mid") && p.chanceOfPlaying >= 75)
      .map(p => ({
        ...p,
        // Captaincy Pick Weight Formula: Form 60% + Ownership 40%
        capScore: (p.form * 2.5) + (p.ownership * 0.4)
      }))
      .sort((a, b) => b.capScore - a.capScore);

    for (const cand of captainCandidates) {
      if (topCaptainsList.length >= 5) break;
      topCaptainsList.push(createCardSummary(cand));
      chosenIds.add(cand.playerId);
    }

    // အခြား ကဏ္ဍများအတွက် Top 5 စာရင်းများ
    const sortedByTotalPoints = [...allValidPlayers].sort((a, b) => b.totalPoints - a.totalPoints);
    const topTotalPoints = sortedByTotalPoints.slice(0, 5).map(createCardSummary);

    const sortedByGwPoints = [...allValidPlayers].sort((a, b) => b.gwPoints - a.gwPoints);
    const topGwPoints = sortedByGwPoints.slice(0, 5).map(createCardSummary);

    const sortedByOwnership = [...allValidPlayers].sort((a, b) => b.ownership - a.ownership);
    const topOwnership = sortedByOwnership.slice(0, 5).map(createCardSummary);

    const sortedByTransfersIn = [...allValidPlayers].sort((a, b) => b.transfersInEvent - a.transfersInEvent);
    const topTransfersIn = sortedByTransfersIn.slice(0, 5).map(createCardSummary);

    const sortedByTransfersOut = [...allValidPlayers].sort((a, b) => b.transfersOutEvent - a.transfersOutEvent);
    const topTransfersOut = sortedByTransfersOut.slice(0, 5).map(createCardSummary);

    const highlightsPayload = {
      gameweek: currentGwDetails.id,
      gameweekName: currentGwDetails.name,
      updatedAt: FieldValue.serverTimestamp(),
      
      // 👑 Most Captain (၅ ယောက် အတိအကျ ပါဝင်သည်)
      mostCaptained: {
        leader: topCaptainsList[0] || null,
        viceLeader: topCaptainsList[1] || null,
        topList: topCaptainsList
      },

      // 🏆 Total Points (၅ ယောက်)
      mostTotalPoints: {
        leader: topTotalPoints[0] || null,
        topList: topTotalPoints
      },

      // ⚡ Week Points (၅ ယောက်)
      mostGwPoints: {
        leader: topGwPoints[0] || null,
        topList: topGwPoints
      },

      // 🛡️ Ownership (၅ ယောက်)
      mostOwned: {
        leader: topOwnership[0] || null,
        topList: topOwnership
      },

      // 📈 Transfers In (၅ ယောက်)
      mostTransferredIn: {
        leader: topTransfersIn[0] || null,
        topList: topTransfersIn
      },

      // 📉 Transfers Out (၅ ယောက်)
      mostTransferredOut: {
        leader: topTransfersOut[0] || null,
        topList: topTransfersOut
      }
    };

    // 🎯 Target: scoutPlayers collection -> scoutHighlights document
    const highlightsDocRef = db.collection("scoutPlayers").doc("scoutHighlights");
    await highlightsDocRef.set(highlightsPayload);
    const highlightSizeKb = Math.round(Buffer.byteLength(JSON.stringify(highlightsPayload)) / 1024);
    
    console.log(`🌟 [HIGHLIGHTS DOC] scoutPlayers/scoutHighlights Synced (~${highlightSizeKb} KB)`);
    console.log(`   👑 Top 5 Captains: ${topCaptainsList.map(c => c.name).join(", ")}`);
    console.log(`   🏆 Top Total Points: ${topTotalPoints[0]?.name || 'N/A'}`);
    console.log(`   ⚡ Top GW Points: ${topGwPoints[0]?.name || 'N/A'}`);
    console.log(`   🛡️ Top Owned: ${topOwnership[0]?.name || 'N/A'}`);
    console.log(`   📈 Top Transfer In: ${topTransfersIn[0]?.name || 'N/A'}`);
    console.log(`   📉 Top Transfer Out: ${topTransfersOut[0]?.name || 'N/A'}`);
    console.log("============================================");

    process.exit(0);
  } catch (err) {
    console.error("🔥 Fatal Error in Scout Sync:", err.message);
    process.exit(1);
  }
}

main();
