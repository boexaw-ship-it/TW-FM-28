// ============================================
// TW Fantasy Official League
// Player Scout Sync Engine + Scout Highlights Document
// Standalone Node.js Runner for GitHub Actions
// Targets:
//   1) scoutPlayers/allPlayers      (Full Master Player List)
//   2) scoutPlayers/scoutHighlights (Top Leaders & Highlights Document)
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
        headers: { "User-Agent": "Mozilla/5.0 TW-Fantasy-Sync/4.0 (Full-Scout-Data)" },
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
  bootstrap.teams.forEach((t) => {
    teamCodeMap[t.id] = (t.short_name || "").toLowerCase().trim();
    teamNameMap[t.id] = t.name;
  });
  return { teamCodeMap, teamNameMap };
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
        oppCode: (teamCodeMap[opponentId] || "unk").toUpperCase(),
        isHome: isHome,
        fdr: fdr || 3,
      };
    });
  }
  return teamFixturesMap;
}

// 🌟 Format Helper: Card Rendering Summary Object
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
    photoCode: player.photoCode,
    photoUrl: player.photoUrl,
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
      if (status === "u") continue;

      const totalPoints = isSeasonStarted ? (el.total_points || 0) : 0;
      const gwPoints = isSeasonStarted ? (el.event_points || 0) : 0;
      const form = isSeasonStarted ? (parseFloat(el.form) || 0.0) : 0.0;
      const ownership = parseFloat(el.selected_by_percent) || 0.0;
      const price = parseFloat((el.now_cost / 10).toFixed(1));

      let cleanPhotoCode = "";
      if (el.photo) {
        cleanPhotoCode = String(el.photo).replace(/\.(jpg|png)$/i, "").replace(/^p/i, "");
      } else if (el.code) {
        cleanPhotoCode = String(el.code);
      } else {
        cleanPhotoCode = String(el.id);
      }

      const photoUrl = `https://resources.premierleague.com/premierleague/photos/players/250x250/p${cleanPhotoCode}.png`;

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
        teamId: el.team,
        team: teamNameMap[el.team] || "Unknown",
        teamCode: (teamCodeMap[el.team] || "unk").toUpperCase(),
        price: price,
        photoCode: cleanPhotoCode,
        photoUrl: photoUrl,
        totalPoints: totalPoints,
        gwPoints: gwPoints,
        form: form,
        ownership: ownership,
        transfersInEvent: el.transfers_in_event || 0,
        transfersOutEvent: el.transfers_out_event || 0,
        nextMatches: next3FixturesMap[el.team] || [],
        status: status,
        chanceOfPlaying: chanceOfPlaying
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
    // 👑 TRUE TOP 5 MOST CAPTAINED RESOLUTION
    // =========================================================================
    const topCaptainsList = [];
    const chosenIds = new Set();

    const officialMostCap = allValidPlayers.find(p => p.playerId === currentGwDetails.mostCaptained);
    if (officialMostCap) {
      topCaptainsList.push({
        ...createCardSummary(officialMostCap),
        roleBadge: "C",
        roleTitle: "Captain"
      });
      chosenIds.add(officialMostCap.playerId);
    }

    const officialMostVice = allValidPlayers.find(p => p.playerId === currentGwDetails.mostViceCaptained);
    if (officialMostVice && !chosenIds.has(officialMostVice.playerId)) {
      topCaptainsList.push({
        ...createCardSummary(officialMostVice),
        roleBadge: "V",
        roleTitle: "Vice-Captain"
      });
      chosenIds.add(officialMostVice.playerId);
    }

    const realCaptainCandidates = allValidPlayers
      .filter(p => 
        !chosenIds.has(p.playerId) && 
        (p.position === "fwd" || p.position === "mid") && 
        p.chanceOfPlaying >= 75 &&
        p.price >= 7.0
      )
      .map(p => ({
        ...p,
        realCapScore: (p.ownership * 1.5) + (p.form * 2.0) + (p.price * 1.2)
      }))
      .sort((a, b) => b.realCapScore - a.realCapScore);

    for (const cand of realCaptainCandidates) {
      if (topCaptainsList.length >= 5) break;
      topCaptainsList.push(createCardSummary(cand));
      chosenIds.add(cand.playerId);
    }

    if (topCaptainsList.length < 5) {
      const backupAttackers = allValidPlayers
        .filter(p => !chosenIds.has(p.playerId) && (p.position === "fwd" || p.position === "mid"))
        .sort((a, b) => b.ownership - a.ownership);

      for (const b of backupAttackers) {
        if (topCaptainsList.length >= 5) break;
        topCaptainsList.push(createCardSummary(b));
        chosenIds.add(b.playerId);
      }
    }

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

    // 💡 DOCUMENT (၂): scoutPlayers/scoutHighlights
    const highlightsPayload = {
      gameweek: currentGwDetails.id,
      gameweekName: currentGwDetails.name,
      updatedAt: FieldValue.serverTimestamp(),

      mostCaptained: {
        leader: topCaptainsList[0] || null,
        viceLeader: topCaptainsList[1] || null,
        topList: topCaptainsList
      },

      mostTotalPoints: { leader: topTotalPoints[0] || null, topList: topTotalPoints },
      mostGwPoints: { leader: topGwPoints[0] || null, topList: topGwPoints },
      mostOwned: { leader: topOwnership[0] || null, topList: topOwnership },
      mostTransferredIn: { leader: topTransfersIn[0] || null, topList: topTransfersIn },
      mostTransferredOut: { leader: topTransfersOut[0] || null, topList: topTransfersOut }
    };

    const highlightsDocRef = db.collection("scoutPlayers").doc("scoutHighlights");
    await highlightsDocRef.set(highlightsPayload);
    const highlightSizeKb = Math.round(Buffer.byteLength(JSON.stringify(highlightsPayload)) / 1024);

    console.log(`🌟 [HIGHLIGHTS DOC] scoutPlayers/scoutHighlights Synced (~${highlightSizeKb} KB)`);
    console.log(`   👑 Top 5 Captains: ${topCaptainsList.map(c => `${c.name} (${c.photoCode})`).join(", ")}`);
    console.log("============================================");

    process.exit(0);
  } catch (err) {
    console.error("🔥 Fatal Error in Scout Sync:", err.message);
    process.exit(1);
  }
}

main();
