// ============================================
// TW Fantasy Official League
// Player Scout & Comprehensive Gameweek Sync Engine
// Architecture: Unified 1-Document Quota Saver (Write = 1 Quota, Read = 1 Quota)
// Payload Size: ~280KB (<1MB Firestore Document Threshold)
// ============================================

const admin = require("firebase-admin");
const { DiffWriter } = require("./lib/diff-sync");

// === Firebase Admin Initialization ===
const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!rawServiceAccount) {
  console.error("🔥 Error: FIREBASE_SERVICE_ACCOUNT environment variable is missing.");
  process.exit(1);
}

const serviceAccount = typeof rawServiceAccount === "string"
  ? JSON.parse(rawServiceAccount)
  : rawServiceAccount;

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

// === FPL API Endpoints ===
const FPL_BASE = "https://fantasy.premierleague.com/api";
const BOOTSTRAP_URL = `${FPL_BASE}/bootstrap-static/`;
const FIXTURES_URL = `${FPL_BASE}/fixtures/`;

// === Helper: Exponential Backoff API Fetcher ===
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
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

// === Step 1: Detailed Gameweek Lifecycle & Meta Intelligence ===
function extractGameweekDetails(events = []) {
  const currentEvent = events.find((e) => e.is_current) 
    || events.find((e) => e.is_next) 
    || events.filter((e) => e.finished).pop() 
    || events[0] 
    || {};

  const nextEvent = events.find((e) => e.is_next) || null;

  return {
    id: currentEvent.id || 1,
    name: currentEvent.name || `Gameweek ${currentEvent.id || 1}`,
    deadlineTime: currentEvent.deadline_time || null,
    deadlineTimeEpoch: currentEvent.deadline_time ? new Date(currentEvent.deadline_time).getTime() : 0,
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
      deadlineTimeEpoch: new Date(nextEvent.deadline_time).getTime(),
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

// === Step 3: Global Fixtures Schedule (အသင်း ၂၀ စာ Root Level တွင် ၁ ကြိမ်သာ ထည့်သွင်းခြင်း) ===
function buildGlobalFixturesMap(fixtures, currentGwId, teamNameMap, teamCodeMap) {
  const upcoming = fixtures
    .filter((f) => !f.finished && f.event && f.event >= currentGwId)
    .sort((a, b) => a.event - b.event);

  const teamFixturesMap = {};
  for (let teamId = 1; teamId <= 20; teamId++) {
    const teamFixtures = upcoming.filter(
      (f) => f.team_h === teamId || f.team_a === teamId
    );

    teamFixturesMap[teamId] = teamFixtures.slice(0, 6).map((f) => {
      const isHome = f.team_h === teamId;
      const opponentId = isHome ? f.team_a : f.team_h;
      const fdr = isHome ? f.team_h_difficulty : f.team_a_difficulty;
      return {
        gw: f.event,
        opp: teamNameMap[opponentId] || "TBC",
        oppCode: teamCodeMap[opponentId] || "unk",
        isH: isHome,
        fdr: fdr || 3,
      };
    });
  }
  return teamFixturesMap;
}

// === Main Execution Function ===
async function main() {
  console.log("🚀 TW Fantasy — Unified 1-Document Player Scout Sync Engine Starting...");
  console.log("Time:", new Date().toISOString());

  try {
    console.log("📥 Fetching Bootstrap-Static & Fixtures data...");
    const [bootstrap, fixtures] = await Promise.all([
      fplFetch(BOOTSTRAP_URL),
      fplFetch(FIXTURES_URL),
    ]);

    // 🗓️ Current Gameweek အပြည့်အစုံ သတ်မှတ်ခြင်း
    const currentGwDetails = extractGameweekDetails(bootstrap.events || []);
    console.log(`📅 Current Gameweek Detected: ${currentGwDetails.name} (Live: ${currentGwDetails.isCurrent}, Finished: ${currentGwDetails.isFinished})`);

    const isSeasonStarted = bootstrap.events.some((e) => e.is_current || e.finished);
    console.log(`⚽ Dynamic Season Active Status: ${isSeasonStarted}`);

    const { teamCodeMap, teamNameMap } = buildTeamMaps(bootstrap);
    const globalFixturesMap = buildGlobalFixturesMap(fixtures, currentGwDetails.id, teamNameMap, teamCodeMap);

    const posMap = {};
    const positions = ["", "gk", "def", "mid", "fwd"];
    bootstrap.element_types.forEach((et) => {
      posMap[et.id] = positions[et.id] || "mid";
    });

    console.log(`👥 Total Raw FPL Elements: ${bootstrap.elements.length}`);

    const allValidPlayers = [];

    for (const el of bootstrap.elements) {
      const status = el.status || "a";

      // 🚨 CRITICAL: ရောင်းထုတ်ခံရသူများ / အသင်းပြောင်းသွားသူများ (Unavailable) အား လုံးဝ စာရင်းမသွင်းဘဲ ပယ်ဖျက်ခြင်း
      if (status === "u") {
        continue;
      }

      const totalPoints = isSeasonStarted ? (el.total_points || 0) : 0;
      const form = isSeasonStarted ? (parseFloat(el.form) || 0) : 0;
      const gwPoints = isSeasonStarted ? (el.event_points || 0) : 0;
      const price = parseFloat((el.now_cost / 10).toFixed(1));

      // 💡 1. METRICS CALCULATIONS:
      const minutesPlayed = el.minutes || 0;
      const matchesPlayed = minutesPlayed > 0 ? Math.max(1, Math.ceil(minutesPlayed / 90)) : 1;
      const ppg = isSeasonStarted ? parseFloat((totalPoints / matchesPlayed).toFixed(2)) : 0.0;
      const val = price > 0 ? parseFloat((totalPoints / price).toFixed(1)) : 0.0;
      const l5 = isSeasonStarted ? parseFloat((form * 5).toFixed(1)) : 0.0;

      const xg = parseFloat(el.expected_goals) || 0;
      const xa = parseFloat(el.expected_assists) || 0;
      const xgi = parseFloat((xg + xa).toFixed(2));
      const ict = parseFloat(el.ict_index) || 0;

      // 💡 2. INJURY, SUSPENSION & PLAYING CHANCE ENGINE:
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

      // 💡 3. OPTIMIZED SCHEMA (1-Doc Size ထိန်းသိမ်းရန် Memory-Friendly Payload)
      allValidPlayers.push({
        playerId: el.id,
        name: el.web_name,
        fullName: `${el.first_name} ${el.second_name}`,
        position: posMap[el.element_type] || "mid",
        elementType: el.element_type, // 1: GK, 2: DEF, 3: MID, 4: FWD
        teamId: el.team,              // 3-Players Max Per Team Rule စစ်ဆေးရန်
        team: teamNameMap[el.team] || "Unknown",
        teamCode: teamCodeMap[el.team] || "unknown",
        price: price,
        costChangeStart: el.cost_change_start || 0,
        costChangeEvent: el.cost_change_event || 0,
        ownership: parseFloat(el.selected_by_percent) || 0,
        totalPoints: totalPoints,
        form: form,
        gwPoints: gwPoints,
        ppg: ppg,
        val: val,
        l5: l5,
        xgi: xgi,
        ict: ict,

        // 🩺 Availability & Status Metadata:
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

    // 💡 4. ROOT-LEVEL MASTER PAYLOAD (1 Document = 1 Write Quota)
    const masterScoutPayload = {
      currentGameweek: currentGwDetails,
      isSeasonStarted: isSeasonStarted,
      totalPlayers: allValidPlayers.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      fixturesByTeam: globalFixturesMap, // အသင်း ၂၀ ၏ လာမည့် ၆ ပွဲစာ Schedule
      players: allValidPlayers,           // တရားဝင် ကစားသမား အားလုံး (~၇၀၀ ကျော်)
    };

    // DiffWriter ဖြင့် ပေါ်ပေါက်သော ပြောင်းလဲမှု စစ်ဆေးခြင်း
    const diff = await new DiffWriter(db, "scoutMeta").load();
    const docRef = db.collection("scoutMeta").doc("allPlayers");

    if (diff.changed("all_players_master", masterScoutPayload)) {
      await docRef.set(masterScoutPayload);
      console.log(`💾 [SAVED 1-DOC] scoutMeta/allPlayers successfully written to Firestore.`);
    } else {
      console.log(`⚡ [NO CHANGE] Scout & GW data is identical to previous sync. Skipped write.`);
    }

    await diff.save({ prune: true });

    // Payload Size တွက်ချက်ခြင်း
    const approxPayloadBytes = Buffer.byteLength(JSON.stringify(masterScoutPayload));
    const approxSizeKb = Math.round(approxPayloadBytes / 1024);

    console.log("============================================");
    console.log(`✅ Player Scout & Gameweek Sync Complete!`);
    console.log(`📊 Active Valid Players: ${allValidPlayers.length}`);
    console.log(`📅 Current Gameweek: ${currentGwDetails.name} (Deadline: ${currentGwDetails.deadlineTime})`);
    console.log(`📦 Payload Size: ~${approxSizeKb} KB (Allowed Limit: 1048 KB)`);
    console.log(`💰 Firestore Write Quota Used: 1 WRITE ONLY`);
    console.log("============================================");

    // Sync Log Document မှတ်တမ်းတင်ခြင်း
    await db.collection("syncLogs").add({
      type: "scout-1doc-unified-sync",
      gameweek: currentGwDetails.id,
      isSeasonStarted: isSeasonStarted,
      totalPlayers: allValidPlayers.length,
      payloadSizeKb: approxSizeKb,
      runAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    process.exit(0);
  } catch (err) {
    console.error("🔥 Fatal Error in Scout Sync:", err.message);
    process.exit(1);
  }
}

main();
