// ============================================
// TW Fantasy Official League
// Fixtures Sync Engine (All Match Events: Goals, Assists, Cards, Clean Sheets, Bonus)
// Architecture: Unified 1-Document Quota Saver (~215KB < 1MB Limit)
// Quota Impact: 1 Write Operation Only
// ============================================

const admin = require("firebase-admin");
const axios = require("axios");
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

if (admin.apps.length === 0) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// === FPL API Endpoints ===
const FPL_BASE = "https://fantasy.premierleague.com/api";
const FIXTURES_URL = `${FPL_BASE}/fixtures/`;
const BOOTSTRAP_URL = `${FPL_BASE}/bootstrap-static/`;

async function fplFetch(url) {
  try {
    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 TW-Fantasy-Sync/2.0 (Full-Stats-Master)" }
    });
    return res.data;
  } catch (err) {
    console.error(`⚠️ Fetch Failed: ${url} - ${err.message}`);
    throw err;
  }
}

// 💡 +1 နာရီ တိုးပေးမည့် Time Offset Helper
function addOneHourToISO(isoString) {
  if (!isoString) return null;
  const dateObj = new Date(isoString);
  dateObj.setTime(dateObj.getTime() + (1 * 60 * 60 * 1000));
  return dateObj.toISOString();
}

const officialTeamTranslateMap = {
  "ars": 1,  "avl": 2,  "bou": 3,  "bre": 4,  "bha": 5,
  "che": 6,  "cov": 7,  "cry": 8,  "eve": 9,  "ful": 10,
  "hul": 11, "ips": 12, "lee": 13, "liv": 14, "mci": 15,
  "mun": 16, "new": 17, "nfo": 18, "tot": 19, "sun": 20
};

// 💡 FPL Official Match Stats Identifiers အားလုံး
const STAT_IDENTIFIERS = [
  "goals_scored",     // Goals
  "assists",          // Assists
  "own_goals",        // Own Goals
  "penalties_saved",  // Pen Saved
  "penalties_missed", // Pen Missed
  "yellow_cards",     // Yellow Cards
  "red_cards",        // Red Cards
  "saves",            // Goalkeeper Saves
  "bonus",            // Bonus Points (3, 2, 1)
  "bps"               // Bonus Points System Total
];

// 🤖 Auto-Detect Gameweek Lifecycle Engine
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
    isCurrent: Boolean(currentEvent.is_current),
    isFinished: Boolean(currentEvent.finished),
    deadlineTime: currentEvent.deadline_time || null,
    deadlineEpoch: currentEvent.deadline_time ? new Date(currentEvent.deadline_time).getTime() : 0,
    averageScore: currentEvent.average_entry_score || 0,
    highestScore: currentEvent.highest_score || 0,
    nextGw: nextEvent ? {
      id: nextEvent.id,
      name: nextEvent.name,
      deadlineTime: nextEvent.deadline_time
    } : null
  };
}

async function syncOfficialFplApiToFirebase() {
  try {
    console.log("🚀 TW Fantasy — Full Events Fixtures Sync Starting...");
    const [bootstrap, apiFixtures] = await Promise.all([
      fplFetch(BOOTSTRAP_URL),
      fplFetch(FIXTURES_URL)
    ]);

    const currentGwDetails = autoDetectGameweek(bootstrap.events || []);
    console.log(`📅 Current Gameweek: ${currentGwDetails.name} (Live: ${currentGwDetails.isCurrent})`);

    // Player ID -> Metadata Map (Name, Position, Team)
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

    // Gameweek အလိုက် အသင်းများ ပွဲကစားရမှု အရေအတွက် (DGW/BGW Detector)
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

      // 💡 Match Events အားလုံးကို Structured Array အဖြစ် ခွဲခြမ်းစိပ်ဖြာခြင်း
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

      // 🧤 Clean Sheet တွက်ချက်မှု (အဝေးကွင်း သို့မဟုတ် အိမ်ကွင်း ဂိုးမပေးရလျှင် Clean Sheet ရရှိသည်)
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

        // Match States
        started: Boolean(apiMatch.started),
        finished: Boolean(apiMatch.finished),
        finished_provisional: Boolean(apiMatch.finished_provisional),
        minutes: Number(apiMatch.minutes) || 0,
        team_h_score: isHomeScoreDefined ? apiMatch.team_h_score : null,
        team_a_score: isAwayScoreDefined ? apiMatch.team_a_score : null,
        is_dgw: Boolean(isHomeDgw || isAwayDgw),
        is_postponed: apiMatch.event === null || apiMatch.kickoff_time === null,

        // 🧤 Clean Sheet Metadata (Home & Away)
        clean_sheets: {
          home: homeCleanSheet,
          away: awayCleanSheet
        },

        // 🌟 Key Highlights (Quick Event Feed for UI)
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

        // Full Raw Categorized Stats
        stats: detailedStats
      });
    }

    // GW Summary Metadata (Blank & Double Teams)
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

    // 💡 1-Document Quota Saver Master Payload (~215KB)
    const masterFixturesDoc = {
      currentGameweek: currentGwDetails,
      totalMatches: formattedMatches.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      gameweekSummary: summaryData,
      fixtures: formattedMatches
    };

    const diff = await new DiffWriter(db, "fixturesMeta").load();
    const docRef = db.collection("fixturesMeta").doc("allFixtures");

    if (diff.changed("unified_fixtures_all_stats", masterFixturesDoc)) {
      await docRef.set(masterFixturesDoc);
      console.log("💾 [SAVED 1-DOC] fixturesMeta/allFixtures successfully updated with All Match Events.");
    } else {
      console.log("⚡ [NO CHANGE] No data updates found. Skipped Firestore write.");
    }

    await diff.save({ prune: true });

    const approxSizeKb = Math.round(Buffer.byteLength(JSON.stringify(masterFixturesDoc)) / 1024);
    console.log("============================================");
    console.log(`✅ Fixtures Sync Complete — All Match Events Ready!`);
    console.log(`⚽ Goals, Assists, Cards, Own Goals, Clean Sheets & Bonus Points Active`);
    console.log(`📦 Document Size: ~${approxSizeKb} KB (<1048 KB Limit)`);
    console.log(`💰 Firestore Write Quota Used: 1 WRITE ONLY`);
    console.log("============================================");

    process.exit(0);
  } catch (error) {
    console.error("❌ Sync Error:", error.message);
    process.exit(1);
  }
}

syncOfficialFplApiToFirebase();
