// ============================================
// TW Fantasy Official League
// Fixtures Official FPL Sync Script (+1 Hour Adjusted & BGW/DGW Support)
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
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// === FPL API URLs ===
const FPL_BASE = "https://fantasy.premierleague.com/api";
const FIXTURES_URL = `${FPL_BASE}/fixtures/`;
const BOOTSTRAP_URL = `${FPL_BASE}/bootstrap-static/`;

// === Helper: FPL API Fetch Tool ===
async function fplFetch(url) {
  try {
    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 TW-Fantasy-Sync/1.0" }
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

// 💡 Official Team ID Mapping (19: TOT, 20: SUN အမှန်ပြင်ဆင်ထားသည်)
const officialTeamTranslateMap = {
  "ars": 1,  "avl": 2,  "bou": 3,  "bre": 4,  "bha": 5,
  "che": 6,  "cov": 7,  "cry": 8,  "eve": 9,  "ful": 10,
  "hul": 11, "ips": 12, "lee": 13, "liv": 14, "mci": 15,
  "mun": 16, "new": 17, "nfo": 18, "tot": 19, "sun": 20
};

async function syncOfficialFplApiToFirebase() {
  try {
    console.log("🚀 TW Fantasy — Official Fixtures Sync Starting...");
    const bootstrap = await fplFetch(BOOTSTRAP_URL);

    // Player ID -> Web Name mapping
    const playerWebNameMap = {};
    bootstrap.elements.forEach(el => {
      playerWebNameMap[el.id] = el.web_name;
    });

    // Team ID -> Short name mapping
    const teamShortNameMap = {};
    bootstrap.teams.forEach(t => {
      teamShortNameMap[t.id] = t.short_name.toLowerCase();
    });

    console.log("📡 Fetching fixtures from Premier League Official Server...");
    const apiFixtures = await fplFetch(FIXTURES_URL);

    // 💡 Gameweek အလိုက် အသင်းတစ်သင်းချင်းစီ၏ ပွဲအရေအတွက် တွက်ချက်ရန် Tracker (DGW/BGW Detector)
    // Structure: { [gw]: { [teamId]: matchCount } }
    const gwTeamMatchCount = {};

    apiFixtures.forEach(m => {
      const gw = m.event;
      if (gw) {
        if (!gwTeamMatchCount[gw]) gwTeamMatchCount[gw] = {};
        gwTeamMatchCount[gw][m.team_h] = (gwTeamMatchCount[gw][m.team_h] || 0) + 1;
        gwTeamMatchCount[gw][m.team_a] = (gwTeamMatchCount[gw][m.team_a] || 0) + 1;
      }
    });

    const diff = await new DiffWriter(db, "fixtures").load();
    let batch = db.batch();
    let count = 0;

    for (const apiMatch of apiFixtures) {
      const idStr = String(apiMatch.id);
      const fixtureDocRef = db.collection("fixtures").doc(idStr);

      const homeTeamShort = teamShortNameMap[apiMatch.team_h] || "";
      const awayTeamShort = teamShortNameMap[apiMatch.team_a] || "";

      // 💡 +1 နာရီ တိုးထားသော Kickoff Time
      const adjustedKickoffTime = addOneHourToISO(apiMatch.kickoff_time);

      // ဂိုးသွင်းသူများ၊ ဖန်တီးသူများ၏ Player Name Mapping
      const formattedStats = (apiMatch.stats || []).map(statType => {
        return {
          identifier: statType.identifier,
          h: (statType.h || []).map(p => ({ element: p.element, value: p.value, element_name: playerWebNameMap[p.element] || "Player" })),
          a: (statType.a || []).map(p => ({ element: p.element, value: p.value, element_name: playerWebNameMap[p.element] || "Player" }))
        };
      });

      const gw = apiMatch.event;
      // DGW စစ်ဆေးချက်: အဆိုပါ GW တွင် ယခုအသင်း ၂ ပွဲ ကစားရသလား
      const isHomeDgw = gw && gwTeamMatchCount[gw] && gwTeamMatchCount[gw][apiMatch.team_h] > 1;
      const isAwayDgw = gw && gwTeamMatchCount[gw] && gwTeamMatchCount[gw][apiMatch.team_a] > 1;
      const isDoubleGameweek = Boolean(isHomeDgw || isAwayDgw);

      // Postponed (ပွဲရွှေ့ဆိုင်းထားခြင်း / BGW ဖြစ်ပေါ်စေသည့် ပွဲများ)
      const isPostponed = apiMatch.event === null || apiMatch.kickoff_time === null;

      const matchData = {
        id: apiMatch.id,
        event: apiMatch.event !== null ? Number(apiMatch.event) : null,             // Gameweek (1-38 သို့မဟုတ် ရွှေ့ဆိုင်းထားလျှင် null)
        kickoff_time: adjustedKickoffTime,                                         // ⏰ +1 နာရီ တိုးထားသော Kickoff Time
        team_h: apiMatch.team_h,
        team_a: apiMatch.team_a,
        team_h_code: homeTeamShort.toUpperCase(),
        team_a_code: awayTeamShort.toUpperCase(),
        team_h_jersey_id: officialTeamTranslateMap[homeTeamShort] || apiMatch.team_h,
        team_a_jersey_id: officialTeamTranslateMap[awayTeamShort] || apiMatch.team_a,
        
        // 💡 FDR TIER MAPPING (Client UI အတွက် မရှိမဖြစ် လိုအပ်သည်)
        team_h_difficulty: apiMatch.team_h_difficulty || 3,
        team_a_difficulty: apiMatch.team_a_difficulty || 3,

        // 💡 BGW & DGW FLAGS:
        is_dgw: isDoubleGameweek,                                                  // Double Gameweek ဟုတ်မဟုတ်
        is_home_dgw: Boolean(isHomeDgw),
        is_away_dgw: Boolean(isAwayDgw),
        is_postponed: isPostponed,                                                 // ရွှေ့ဆိုင်းထားသော ပွဲစဉ်ဟုတ်မဟုတ်

        // 🔴 LIVE MATCH STATUS:
        started: Boolean(apiMatch.started),
        finished: Boolean(apiMatch.finished),
        finished_provisional: Boolean(apiMatch.finished_provisional),
        minutes: Number(apiMatch.minutes) || 0,
        team_h_score: apiMatch.team_h_score !== undefined ? apiMatch.team_h_score : null,
        team_a_score: apiMatch.team_a_score !== undefined ? apiMatch.team_a_score : null,
        stats: formattedStats,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      // data မပြောင်းရင် write မလုပ်ဘူး
      if (!diff.changed(idStr, (({ updatedAt, ...rest }) => rest)(matchData))) continue;
      batch.set(fixtureDocRef, matchData, { merge: true });
      count++;

      if (count % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }

    if (count % 400 !== 0) {
      await batch.commit();
    }

    // 💡 GW SUMMARY METADATA: Blank Gameweek (ပွဲမရှိသော အသင်းများ) ကို Client ဘက်မှ အလွယ်တကူ သိရှိစေရန် ရေးသွင်းပေးခြင်း
    console.log("📊 Writing Gameweek BGW/DGW Summary Metadata to Firestore...");
    const gwSummaryRef = db.collection("system_meta").doc("gameweeks_summary");
    const totalTeams = Object.keys(officialTeamTranslateMap).map(k => officialTeamTranslateMap[k]);

    const summaryData = {};
    for (let g = 1; g <= 38; g++) {
      const activeTeamsInGw = gwTeamMatchCount[g] ? Object.keys(gwTeamMatchCount[g]).map(Number) : [];
      // အဆိုပါ GW တွင် ပွဲမရှိသော အသင်းများ (Blank Teams)
      const blankTeams = totalTeams.filter(tId => !activeTeamsInGw.includes(tId));
      // အဆိုပါ GW တွင် ၂ ပွဲ ကစားရသော အသင်းများ (Double Teams)
      const doubleTeams = activeTeamsInGw.filter(tId => gwTeamMatchCount[g][tId] > 1);

      summaryData[`gw_${g}`] = {
        gameweek: g,
        has_blank: blankTeams.length > 0,
        has_double: doubleTeams.length > 0,
        blank_team_ids: blankTeams,
        double_team_ids: doubleTeams
      };
    }

    if (diff.changed("__gwsummary", summaryData)) {
      await gwSummaryRef.set({
        summary: summaryData,
        lastSync: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    await diff.save();

    console.log(`🚀 [SUCCESS] ပွဲစဉ်ပေါင်း (${count}) ခု၏ Data များ၊ FDR နှင့် BGW/DGW Metadata အားလုံး Firebase သို့ အောင်မြင်စွာ ရေးသွင်းပြီးပါပြီ။`);
    process.exit(0);

  } catch (error) {
    console.error("❌ Sync ကျရှုံးပါသည်:", error.message);
    process.exit(1);
  }
}

syncOfficialFplApiToFirebase();
