// ============================================
// TW Fantasy Official League
// Player Scout Sync Engine + Scout Highlights Document
// Season: 2026-2027 Official Premier League Sync
// Features:
//   - Official FPL Photo Engine (el.photo -> el.opta_code ONLY, no el.code/id)
//   - Pure Premier League CDN URLs (No query parameters)
//   - True Team & Fixture Alignment for João Pedro & Morgan Rogers (Chelsea FC)
//   - Full Metrics Sync (PPG, VAL, L5, XGI, ICT) for all 6 Highlight Categories
// Path: scripts/player-scout-sync.js
// ============================================

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// === Firebase Admin Initialization ===
const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!rawServiceAccount) {
  console.error("❌ Error: FIREBASE_SERVICE_ACCOUNT Environment Variable မတွေ့ရှိပါဗျာ။ GitHub Secrets ထဲတွင် ထည့်သွင်းပေးပါ။");
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = typeof rawServiceAccount === "string"
    ? JSON.parse(rawServiceAccount)
    : rawServiceAccount;
} catch (parseErr) {
  console.error("❌ Error: FIREBASE_SERVICE_ACCOUNT JSON Parsing ပျက်စီးနေပါသည်:", parseErr.message);
  process.exit(1);
}

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
        headers: { "User-Agent": "Mozilla/5.0 TW-Fantasy-Sync/10.0 (Official-FPL-Engine)" },
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
    nextGw: nextEvent ? {
      id: nextEvent.id,
      name: nextEvent.name,
      deadlineTime: nextEvent.deadline_time,
      deadlineEpoch: new Date(nextEvent.deadline_time).getTime(),
    } : null,
  };
}

// === Team Code & Name Mappings ===
function buildTeamMaps(bootstrap) {
  const teamCodeMap = {};
  const teamNameMap = {};
  let chelseaTeamId = 6;
  
  (bootstrap.teams || []).forEach((t) => {
    const rawShort = (t.short_name || "").toUpperCase().trim();
    teamCodeMap[t.id] = rawShort;
    teamNameMap[t.id] = t.name;

    if (rawShort === "CHE" || (t.name && t.name.toLowerCase().includes("chelsea"))) {
      chelseaTeamId = t.id;
    }
  });
  
  return { teamCodeMap, teamNameMap, chelseaTeamId };
}

// === Next 3 Fixtures Buffer Map ===
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
        oppCode: (teamCodeMap[opponentId] || "UNK").toUpperCase(),
        isHome: isHome,
        fdr: fdr || 3,
      };
    });
  }
  return teamFixturesMap;
}

// 🌟 Format Helper: Card Summary Object for Dashboard Cards
function createCardSummary(player) {
  if (!player) return null;
  return {
    playerId: player.playerId,
    name: player.name,
    fullName: player.fullName,
    position: player.position,
    teamId: player.teamId,
    team: player.team,
    teamCode: player.teamCode,
    price: player.price,
    photoCode: player.photoCode, // 📸 Clean Numeric ID
    photoUrl: player.photoUrl,   // 📸 Pure Premier League CDN URL
    totalPoints: player.totalPoints,
    gwPoints: player.gwPoints,
    ownership: player.ownership,
    form: player.form,
    ppg: player.ppg,
    val: player.val,
    l5: player.l5,
    xgi: player.xgi,
    ict: player.ict,
    transfersInEvent: player.transfersInEvent,
    transfersOutEvent: player.transfersOutEvent,
    status: player.status,
    chanceOfPlaying: player.chanceOfPlaying
  };
}

// === Main Execution Function ===
async function main() {
  console.log("🚀 TW Fantasy — Master Sync Starting (Pure el.photo Engine)...");
  console.log("Time:", new Date().toISOString());

  try {
    const [bootstrap, fixtures] = await Promise.all([
      fplFetch(BOOTSTRAP_URL),
      fplFetch(FIXTURES_URL),
    ]);

    const currentGwDetails = autoDetectGameweek(bootstrap.events || []);
    console.log(`📅 Current Gameweek: ${currentGwDetails.name} (Live: ${currentGwDetails.isCurrent})`);

    const isSeasonStarted = bootstrap.events.some((e) => e.is_current || e.finished);
    const { teamCodeMap, teamNameMap, chelseaTeamId } = buildTeamMaps(bootstrap);
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
      if (status === "u") continue;

      const totalPoints = Number(el.total_points ?? 0);
      const gwPoints = Number(el.event_points ?? 0);
      const ownership = parseFloat(el.selected_by_percent) || 0.0;
      const price = parseFloat(((el.now_cost || 0) / 10).toFixed(1));
      const form = parseFloat(el.form) || 0.0;

      const ppg = parseFloat(parseFloat(el.points_per_game || (totalPoints > 0 ? (totalPoints / Math.max(1, Math.ceil((el.minutes || 0) / 90))) : 0)).toFixed(1));
      const val = parseFloat(parseFloat(el.value_season || (price > 0 ? (totalPoints / price) : 0)).toFixed(1));
      const l5 = parseFloat((form * 5).toFixed(1));
      
      const xg = parseFloat(el.expected_goals) || 0.0;
      const xa = parseFloat(el.expected_assists) || 0.0;
      const xgiRaw = parseFloat(el.expected_goal_involvements);
      const xgi = parseFloat((!isNaN(xgiRaw) && xgiRaw > 0 ? xgiRaw : (xg + xa)).toFixed(2));
      const ict = parseFloat(parseFloat(el.ict_index || 0.0).toFixed(1));

      // ============================================
      // 📸 OFFICIAL FPL PLAYER PHOTO ENGINE (2026/27)
      // Source priority:
      // 1. el.photo
      // 2. el.opta_code
      // NEVER use: el.id, el.code for player photo URL!
      // ============================================
      let cleanPhotoCode = "";

      // 1️⃣ Official FPL photo field
      if (el.photo) {
        cleanPhotoCode = String(el.photo)
          .replace(/\.(jpg|jpeg|png)$/i, "")
          .replace(/^p/i, "")
          .trim();
      }

      // 2️⃣ Fallback to Opta code
      if (!cleanPhotoCode && el.opta_code) {
        cleanPhotoCode = String(el.opta_code)
          .replace(/^p/i, "")
          .trim();
      }

      // 3️⃣ Build official Premier League CDN URL (Pure, No ?v= query)
      const photoUrl = cleanPhotoCode
        ? `https://resources.premierleague.com/premierleague/photos/players/250x250/p${cleanPhotoCode}.png`
        : "";

      // 🌟 ၂၀၂၆-၂၇ အပြောင်းအရွှေ့ စစ်မှန်ရေး (Pedro & Rogers -> Chelsea FC)
      let resolvedTeamId = el.team;
      let resolvedTeamName = teamNameMap[el.team] || "Unknown";
      let resolvedTeamCode = (teamCodeMap[el.team] || "UNK").toUpperCase();

      const pNameLower = `${el.first_name} ${el.second_name} ${el.web_name}`.toLowerCase();
      
      if (pNameLower.includes("joão pedro") || pNameLower.includes("joao pedro") || pNameLower.includes("pedro")) {
        resolvedTeamId = chelseaTeamId;
        resolvedTeamCode = "CHE";
        resolvedTeamName = "Chelsea";
      } else if (pNameLower.includes("morgan rogers") || pNameLower.includes("rogers")) {
        resolvedTeamId = chelseaTeamId;
        resolvedTeamCode = "CHE";
        resolvedTeamName = "Chelsea";
      }

      const nextChanceRaw = el.chance_of_playing_next_round;
      let chanceOfPlaying = 100;
      if (nextChanceRaw !== null && nextChanceRaw !== undefined) {
        chanceOfPlaying = Number(nextChanceRaw);
      } else if (status === "i" || status === "s") {
        chanceOfPlaying = 0;
      } else if (status === "d") {
        chanceOfPlaying = 75;
      }

      allValidPlayers.push({
        playerId: el.id,
        id: el.id,
        name: el.web_name,
        fullName: `${el.first_name} ${el.second_name}`,
        position: posMap[el.element_type] || "mid",
        elementType: el.element_type,
        teamId: resolvedTeamId,
        team: resolvedTeamName,
        teamCode: resolvedTeamCode,
        price: price,
        photoCode: cleanPhotoCode,
        photoUrl: photoUrl, // 💡 Pure Premier League CDN URL
        
        ppg: ppg,
        val: val,
        l5: l5,
        xgi: xgi,
        ict: ict,

        totalPoints: totalPoints,
        total_points: totalPoints,
        gwPoints: gwPoints,
        event_points: gwPoints,
        points: totalPoints,
        form: form,
        ownership: ownership,
        selected_by_percent: ownership,
        xG: xg,
        xA: xa,
        xGC: parseFloat(el.expected_goals_conceded) || 0.0,

        minutes: el.minutes || 0,
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

        influence: parseFloat(el.influence) || 0.0,
        creativity: parseFloat(el.creativity) || 0.0,
        threat: parseFloat(el.threat) || 0.0,
        transfersInEvent: el.transfers_in_event || 0,
        transfersOutEvent: el.transfers_out_event || 0,

        // 💡 Chelsea Fixture နှင့် ၁၀၀% ကိုက်ညီစေခြင်း
        nextMatches: next3FixturesMap[resolvedTeamId] || [],

        status: status,
        chanceOfPlaying: chanceOfPlaying,
        chanceOfPlayingThisRound: el.chance_of_playing_this_round !== null && el.chance_of_playing_this_round !== undefined 
          ? Number(el.chance_of_playing_this_round) 
          : null,
        isAvailable: status === "a" && chanceOfPlaying === 100,
        isDoubtful: status === "d" || (chanceOfPlaying > 0 && chanceOfPlaying < 100),
        isSuspended: status === "s",
        isInjured: status === "i",
        news: el.news || "",
        newsAdded: el.news_added || null,
      });
    }

    // 💡 1-DOCUMENT MASTER PAYLOAD (scoutPlayers/allPlayers)
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
    // 👑 TRUE CURRENT GAMEWEEK TOP 5 MOST CAPTAINED RESOLUTION
    // =========================================================================
    const topCaptainsList = [];
    const chosenIds = new Set();

    const officialMostCap = allValidPlayers.find(p => p.playerId === currentGwDetails.mostCaptained);
    if (officialMostCap) {
      topCaptainsList.push(createCardSummary(officialMostCap));
      chosenIds.add(officialMostCap.playerId);
    }

    const officialMostVice = allValidPlayers.find(p => p.playerId === currentGwDetails.mostViceCaptained);
    if (officialMostVice && !chosenIds.has(officialMostVice.playerId)) {
      topCaptainsList.push(createCardSummary(officialMostVice));
      chosenIds.add(officialMostVice.playerId);
    }

    const currentGwCaptainContenders = allValidPlayers
      .filter(p => 
        !chosenIds.has(p.playerId) && 
        (p.position === "fwd" || p.position === "mid") && 
        p.chanceOfPlaying >= 75 &&
        p.price >= 6.5
      )
      .map(p => ({
        ...p,
        captaincyWeight: (p.ownership * 2.0) + 
                         (Math.min(p.transfersInEvent, 2000000) / 100000) * 1.5 + 
                         (p.form * 1.5)
      }))
      .sort((a, b) => b.captaincyWeight - a.captaincyWeight);

    for (const cand of currentGwCaptainContenders) {
      if (topCaptainsList.length >= 5) break;
      topCaptainsList.push(createCardSummary(cand));
      chosenIds.add(cand.playerId);
    }

    if (topCaptainsList.length < 5) {
      const topAttackers = allValidPlayers
        .filter(p => !chosenIds.has(p.playerId) && (p.position === "fwd" || p.position === "mid"))
        .sort((a, b) => b.ownership - a.ownership);

      for (const atk of topAttackers) {
        if (topCaptainsList.length >= 5) break;
        topCaptainsList.push(createCardSummary(atk));
        chosenIds.add(atk.playerId);
      }
    }

    // 💡 ကဏ္ဍ ၆ ခုစလုံးအတွက် Top 5 စာရင်းများ
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

    // 💡 DOCUMENT (၂): scoutPlayers/scoutHighlights (Dashboard သီးသန့် အသေးစား Document)
    const highlightsPayload = {
      gameweek: currentGwDetails.id,
      gameweekName: currentGwDetails.name,
      updatedAt: FieldValue.serverTimestamp(),

      // ၁။ Most Captained (၅ ယောက်)
      mostCaptained: {
        leader: topCaptainsList[0] || null,
        viceLeader: topCaptainsList[1] || null,
        topList: topCaptainsList
      },

      // ၂။ Total Points (၅ ယောက်)
      mostTotalPoints: { leader: topTotalPoints[0] || null, topList: topTotalPoints },

      // ၃။ Week Points (၅ ယောက်)
      mostGwPoints: { leader: topGwPoints[0] || null, topList: topGwPoints },

      // ၄။ Ownership (၅ ယောက်)
      mostOwned: { leader: topOwnership[0] || null, topList: topOwnership },

      // ၅။ Transfers In (၅ ယောက်)
      mostTransferredIn: { leader: topTransfersIn[0] || null, topList: topTransfersIn },

      // ၆။ Transfers Out (၅ ယောက်)
      mostTransferredOut: { leader: topTransfersOut[0] || null, topList: topTransfersOut }
    };

    const highlightsDocRef = db.collection("scoutPlayers").doc("scoutHighlights");
    await highlightsDocRef.set(highlightsPayload);
    const highlightSizeKb = Math.round(Buffer.byteLength(JSON.stringify(highlightsPayload)) / 1024);

    console.log(`🌟 [HIGHLIGHTS DOC] scoutPlayers/scoutHighlights Synced (~${highlightSizeKb} KB)`);
    console.log(`   👑 Top 5 Captains: ${topCaptainsList.map((c, i) => `#${i + 1} ${c.name} (${c.photoUrl})`).join(", ")}`);
    console.log("============================================");

    process.exit(0);
  } catch (err) {
    console.error("🔥 Fatal Error in Scout Sync:", err.message);
    process.exit(1);
  }
}

main();
