// ============================================
// TW Fantasy Official League
// Fixtures Sync Engine (Full Match Stats: Red Cards, Own Goals, Clean Sheets & Cards)
// Architecture: Unified 1-Document Quota Saver (~215KB < 1MB Limit)
// Fix: Safe Firebase Admin Initializer (Fixes admin.apps undefined error on Node.js v22)
// ============================================

const admin = require("firebase-admin");
const axios = require("axios");
const { DiffWriter } = require("./lib/diff-sync");

// === Firebase Admin Initialization (Crash-Proof Safe Pattern) ===
const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!rawServiceAccount) {
  console.error("❌ Error: FIREBASE_SERVICE_ACCOUNT Environment Variable မတွေ့ရှိပါဗျာ။");
  process.exit(1);
}

const serviceAccount = typeof rawServiceAccount === "string"
  ? JSON.parse(rawServiceAccount)
  : rawServiceAccount;

// Safe init without checking admin.apps.length (avoids undefined error)
let app;
try {
  app = admin.app();
} catch (e) {
  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// === FPL API Endpoints ===
const FPL_BASE = "https://fantasy.premierleague.com/api";
const FIXTURES_URL = `${FPL_BASE}/fixtures/`;
const BOOTSTRAP_URL = `${FPL_BASE}/bootstrap-static/`;

// === Helper: FPL API Fetch Tool ===
async function fplFetch(url) {
  try {
    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 TW-Fantasy-Sync/2.0 (Full-Stats-Engine)" }
    });
    return res.data;
  } catch (err) {
    console.error(`⚠️ Fetch Failed: ${url} - ${err.message}`);
    throw err;
  }
}

// 💡 1 နာရီ တိုးပေးမည့် Helper Function (ISO Date Time Safe Add)
function addOneHourToISO(isoString) {
  if (!isoString) return null;
  const dateObj = new Date(isoString);
  dateObj.setTime(dateObj.getTime() + (1 * 60 * 60 * 1000));
  return dateObj.toISOString();
}

// 💡 Official Team ID Mapping (19: TOT, 20: SUN)
const officialTeamTranslateMap = {
  "ars": 1,  "avl": 2,  "bou": 3,  "bre": 4,  "bha": 5,
  "che": 6,  "cov": 7,  "cry": 8,  "eve": 9,  "ful": 10,
  "hul": 11, "ips": 12, "lee": 13, "liv": 14, "mci": 15,
  "mun": 16, "new": 17, "nfo": 18, "tot": 19, "sun": 20
};

// 💡 FPL Match Stats Identifiers အားလုံး
const STAT_IDENTIFIERS = [
  "goals_scored",
  "assists",
  "own_goals",
  "penalties_saved",
  "penalties_missed",
  "yellow_cards",
  "red_cards",
  "saves",
  "bonus",
  "bps"
];

// 🤖 Current Gameweek အား အလိုအလျောက် တိကျစွာ ခွဲခြားထုတ်ယူပေးမည့် Engine
function autoDetectGameweek(events = []) {
  if (!Array.isArray(events) || events.length === 0) {
    return {
      id: 1,
      name: "Gameweek 1",
      status: "unknown",
      isLive: false,
      isFinished: false,
      deadlineTime: null,
      deadlineTimeEpoch: 0,
      nextGw: null
    };
  }

  const nowEpoch = Date.now();
  const officialCurrent = events.find((e) => e.is_current === true);
  const officialNext = events.find((e) => e.is_next === true);
  const finishedEvents = events.filter((e) => e.finished === true);
  const lastFinished = finishedEvents.length > 0 ? finishedEvents[finishedEvents.length - 1] : null;

  let targetEvent = null;
  let status = "upcoming";

  if (officialCurrent) {
    targetEvent = officialCurrent;
    status = officialCurrent.finished ? "finished" : "live";
  } else if (officialNext) {
    targetEvent = officialNext;
    status = "upcoming";
  } else if (lastFinished) {
    targetEvent = lastFinished;
    status = "season_ended";
  } else {
    targetEvent = events[0];
    status = "pre_season";
  }

  const deadlineTime = targetEvent.deadline_time || null;
  const deadlineTimeEpoch = deadlineTime ? new Date(deadlineTime).getTime() : 0;
  const isPastDeadline = deadlineTimeEpoch > 0 && nowEpoch >= deadlineTimeEpoch;
  const isLive = Boolean(targetEvent.is_current && !targetEvent.finished);

  return {
    id: targetEvent.id || 1,
    name: targetEvent.name || `Gameweek ${targetEvent.id || 1}`,
    status: status,
    isCurrent: Boolean(targetEvent.is_current),
    isNext: Boolean(targetEvent.is_next),
    isLive: isLive,
    isFinished: Boolean(targetEvent.finished),
    isPastDeadline: isPastDeadline,
    dataChecked: Boolean(targetEvent.data_checked),
    deadlineTime: deadlineTime,
    deadlineTimeEpoch: deadlineTimeEpoch,
    averageScore: targetEvent.average_entry_score || 0,
    highestScore: targetEvent.highest_score || 0,
    mostCaptained: targetEvent.most_captained || null,
    mostViceCaptained: targetEvent.most_vice_captained || null,
    mostSelected: targetEvent.most_selected || null,
    mostTransferredIn: targetEvent.most_transferred_in || null,
    topPlayerId: targetEvent.top_element || null,
    topPlayerPoints: targetEvent.top_element_info?.points || 0,
    transfersMade: targetEvent.transfers_made || 0,
    chipPlays: (targetEvent.chip_plays || []).map((c) => ({
      chipName: c.chip_name,
      numPlayed: c.num_played
    })),
    nextGw: officialNext ? {
      id: officialNext.id,
      name: officialNext.name,
      deadlineTime: officialNext.deadline_time,
      deadlineTimeEpoch: new Date(officialNext.deadline_time).getTime()
    } : null
  };
}

async function syncOfficialFplApiToFirebase() {
  try {
    console.log("🚀 TW Fantasy — Full Match Stats Fixtures Sync Starting...");
    console.log("Time:", new Date().toISOString());

    const [bootstrap, apiFixtures] = await Promise.all([
      fplFetch(BOOTSTRAP_URL),
      fplFetch(FIXTURES_URL)
    ]);

    const currentGwDetails = autoDetectGameweek(bootstrap.events || []);
    console.log(`📅 Current Gameweek Detected: ${currentGwDetails.name} (Status: ${currentGwDetails.status.toUpperCase()}, Live: ${currentGwDetails.isLive})`);

    // Player ID -> Metadata Map
    const playerMasterMap = {};
    const positions = ["", "GK", "DEF", "MID", "FWD"];
    bootstrap.elements.forEach(el => {
      playerMasterMap[el.id] = {
        name: el.web_name,
        fullName: `${el.first_name} ${el.second_name}`,
        pos: positions[el.element_type] || "MID",
        team: el.team
      };
    });

    const teamShortNameMap = {};
    bootstrap.teams.forEach(t => {
      teamShortNameMap[t.id] = (t.short_name || "").toLowerCase().trim();
    });

    const gwTeamMatchCount = {};
    apiFixtures.forEach(m => {
      const gw = m.event;
      if (gw) {
        if (!gwTeamMatchCount[gw]) gwTeamMatchCount[gw] = {};
        gwTeamMatchCount[gw][m.team_h] = (gwTeamMatchCount[gw][m.team_h] || 0) + 1;
        gwTeamMatchCount[gw][m.team_a] = (gwTeamMatchCount[gw][m.team_a] || 0) + 1;
      }
    });

    const formattedMatches = [];

    for (const apiMatch of apiFixtures) {
      const homeTeamShort = teamShortNameMap[apiMatch.team_h] || "";
      const awayTeamShort = teamShortNameMap[apiMatch.team_a] || "";
      const adjustedKickoffTime = addOneHourToISO(apiMatch.kickoff_time);

      // Match Stats အားလုံး ဆွဲယူခြင်း
      const detailedStats = {};
      STAT_IDENTIFIERS.forEach(id => {
        detailedStats[id] = { h: [], a: [] };
      });

      (apiMatch.stats || []).forEach(statType => {
        const id = statType.identifier;
        if (detailedStats[id]) {
          detailedStats[id].h = (statType.h || []).map(p => ({
            element: p.element,
            value: p.value,
            name: playerMasterMap[p.element]?.name || "Player",
            pos: playerMasterMap[p.element]?.pos || "MID"
          }));
          detailedStats[id].a = (statType.a || []).map(p => ({
            element: p.element,
            value: p.value,
            name: playerMasterMap[p.element]?.name || "Player",
            pos: playerMasterMap[p.element]?.pos || "MID"
          }));
        }
      });

      // Clean Sheet စစ်ဆေးခြင်း
      const isHomeScoreDefined = apiMatch.team_h_score !== null && apiMatch.team_h_score !== undefined;
      const isAwayScoreDefined = apiMatch.team_a_score !== null && apiMatch.team_a_score !== undefined;

      const homeCleanSheet = Boolean(apiMatch.started && isAwayScoreDefined && apiMatch.team_a_score === 0);
      const awayCleanSheet = Boolean(apiMatch.started && isHomeScoreDefined && apiMatch.team_h_score === 0);

      const gw = apiMatch.event;
      const isHomeDgw = gw && gwTeamMatchCount[gw] && gwTeamMatchCount[gw][apiMatch.team_h] > 1;
      const isAwayDgw = gw && gwTeamMatchCount[gw] && gwTeamMatchCount[gw][apiMatch.team_a] > 1;

      formattedMatches.push({
        id: apiMatch.id,
        event: apiMatch.event !== null ? Number(apiMatch.event) : null,
        kickoff_time: adjustedKickoffTime,
        kickoff_epoch: adjustedKickoffTime ? new Date(adjustedKickoffTime).getTime() : 0,
        team_h: apiMatch.team_h,
        team_a: apiMatch.team_a,
        team_h_code: homeTeamShort.toUpperCase(),
        team_a_code: awayTeamShort.toUpperCase(),
        team_h_jersey_id: officialTeamTranslateMap[homeTeamShort] || apiMatch.team_h,
        team_a_jersey_id: officialTeamTranslateMap[awayTeamShort] || apiMatch.team_a,
        team_h_difficulty: apiMatch.team_h_difficulty || 3,
        team_a_difficulty: apiMatch.team_a_difficulty || 3,
        is_dgw: Boolean(isHomeDgw || isAwayDgw),
        is_postponed: apiMatch.event === null || apiMatch.kickoff_time === null,
        started: Boolean(apiMatch.started),
        finished: Boolean(apiMatch.finished),
        finished_provisional: Boolean(apiMatch.finished_provisional),
        minutes: Number(apiMatch.minutes) || 0,
        team_h_score: isHomeScoreDefined ? apiMatch.team_h_score : null,
        team_a_score: isAwayScoreDefined ? apiMatch.team_a_score : null,

        clean_sheets: {
          home: homeCleanSheet,
          away: awayCleanSheet
        },

        highlights: {
          goals: [
            ...detailedStats.goals_scored.h.map(p => ({ ...p, isHome: true, teamCode: homeTeamShort.toUpperCase() })),
            ...detailedStats.goals_scored.a.map(p => ({ ...p, isHome: false, teamCode: awayTeamShort.toUpperCase() }))
          ],
          assists: [
            ...detailedStats.assists.h.map(p => ({ ...p, isHome: true, teamCode: homeTeamShort.toUpperCase() })),
            ...detailedStats.assists.a.map(p => ({ ...p, isHome: false, teamCode: awayTeamShort.toUpperCase() }))
          ],
          ownGoals: [
            ...detailedStats.own_goals.h.map(p => ({ ...p, isHome: true, teamCode: homeTeamShort.toUpperCase() })),
            ...detailedStats.own_goals.a.map(p => ({ ...p, isHome: false, teamCode: awayTeamShort.toUpperCase() }))
          ],
          redCards: [
            ...detailedStats.red_cards.h.map(p => ({ ...p, isHome: true, teamCode: homeTeamShort.toUpperCase() })),
            ...detailedStats.red_cards.a.map(p => ({ ...p, isHome: false, teamCode: awayTeamShort.toUpperCase() }))
          ],
          yellowCards: [
            ...detailedStats.yellow_cards.h.map(p => ({ ...p, isHome: true, teamCode: homeTeamShort.toUpperCase() })),
            ...detailedStats.yellow_cards.a.map(p => ({ ...p, isHome: false, teamCode: awayTeamShort.toUpperCase() }))
          ],
          bonus: [
            ...detailedStats.bonus.h.map(p => ({ ...p, isHome: true, teamCode: homeTeamShort.toUpperCase() })),
            ...detailedStats.bonus.a.map(p => ({ ...p, isHome: false, teamCode: awayTeamShort.toUpperCase() }))
          ]
        },

        stats: detailedStats
      });
    }

    // GW Summary Metadata
    const totalTeams = Object.keys(officialTeamTranslateMap).map(k => officialTeamTranslateMap[k]);
    const summaryData = {};
    for (let g = 1; g <= 38; g++) {
      const activeTeamsInGw = gwTeamMatchCount[g] ? Object.keys(gwTeamMatchCount[g]).map(Number) : [];
      summaryData[`gw_${g}`] = {
        gameweek: g,
        has_blank: totalTeams.some(id => !activeTeamsInGw.includes(id)),
        has_double: activeTeamsInGw.some(id => gwTeamMatchCount[g][id] > 1),
        blank_team_ids: totalTeams.filter(id => !activeTeamsInGw.includes(id)),
        double_team_ids: activeTeamsInGw.filter(id => gwTeamMatchCount[g][id] > 1)
      };
    }

    // 💡 1-Document Quota Saver Master Payload
    const masterFixturesDoc = {
      currentGameweek: currentGwDetails,
      totalMatches: formattedMatches.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      gameweekSummary: summaryData,
      fixtures: formattedMatches
    };

    const diff = await new DiffWriter(db, "fixturesMeta").load();
    const docRef = db.collection("fixturesMeta").doc("allFixtures");

    if (diff.changed("unified_fixtures_all_stats_v4", masterFixturesDoc)) {
      await docRef.set(masterFixturesDoc);
      console.log("💾 [SAVED 1-DOC] fixturesMeta/allFixtures successfully written to Firestore.");
    } else {
      console.log("⚡ [NO CHANGE] No fixture data updates. Skipped write.");
    }

    await diff.save({ prune: true });

    const approxSizeKb = Math.round(Buffer.byteLength(JSON.stringify(masterFixturesDoc)) / 1024);
    console.log("============================================");
    console.log(`✅ [1-DOC QUOTA] Fixtures & Auto GW Sync Complete!`);
    console.log(`🤖 Current Gameweek: ${currentGwDetails.name} (Deadline: ${currentGwDetails.deadlineTime})`);
    console.log(`⚽ Total Matches Packed: ${formattedMatches.length} fixtures`);
    console.log(`📦 Document Size: ~${approxSizeKb} KB (Firestore Limit: 1048 KB)`);
    console.log(`💰 Firestore Write Quota Used: 1 WRITE ONLY`);
    console.log("============================================");

    process.exit(0);

  } catch (error) {
    console.error("❌ Sync ကျရှုံးပါသည်:", error.message);
    process.exit(1);
  }
}

syncOfficialFplApiToFirebase();
