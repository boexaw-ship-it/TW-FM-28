// ============================================
// TW Fantasy Official League
// Player Scout Sync Script (Unavailable/Sold Players Auto-Purge & Real-Time Sync)
// ============================================

const admin = require("firebase-admin");
const { DiffWriter } = require("./lib/diff-sync");

// === Firebase Admin Init ===
const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!rawServiceAccount) {
  console.error("🔥 Error: FIREBASE_SERVICE_ACCOUNT environment variable is missing.");
  process.exit(1);
}

const serviceAccount = typeof rawServiceAccount === "string" ?
  JSON.parse(rawServiceAccount) :
  rawServiceAccount;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// === FPL API ===
const FPL_BASE = "https://fantasy.premierleague.com/api";
const BOOTSTRAP_URL = `${FPL_BASE}/bootstrap-static/`;
const FIXTURES_URL = `${FPL_BASE}/fixtures/`;

// === Helper: FPL API fetch ===
async function fplFetch(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 TW-Fantasy-Sync/1.0" },
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

// === Step 1: Current Gameweek ရှာဖွေခြင်း ===
function getCurrentGameweek(bootstrap) {
  const current = bootstrap.events.find((e) => e.is_current);
  if (current) return current.id;
  const next = bootstrap.events.find((e) => e.is_next);
  return next ? next.id : 1;
}

// === Step 2: Team code map ===
function buildTeamMaps(bootstrap) {
  const teamCodeMap = {};
  const teamNameMap = {};
  bootstrap.teams.forEach((t) => {
    teamCodeMap[t.id] = t.short_name.toLowerCase();
    teamNameMap[t.id] = t.name;
  });
  return { teamCodeMap, teamNameMap };
}

// === Step 3: Fixtures Buffer (အနည်းဆုံး လာမည့် ၆ ပွဲအထိ သိမ်းဆည်းခြင်း) ===
function buildNextFixturesMap(fixtures, currentGw, teamNameMap, teamCodeMap) {
  const upcoming = fixtures
    .filter((f) => !f.finished && f.event && f.event >= currentGw)
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
        opponent: teamNameMap[opponentId] || "TBC",
        opponentCode: teamCodeMap[opponentId] || "unknown",
        isHome: isHome,
        fdr: fdr || 3,
      };
    });
  }
  return teamFixturesMap;
}

// === Main Function ===
async function main() {
  console.log("🚀 TW Fantasy — Player Scout Sync Starting (Excluding Sold Players)...");
  console.log("Time:", new Date().toISOString());
  
  try {
    console.log("📥 Fetching bootstrap data...");
    const bootstrap = await fplFetch(BOOTSTRAP_URL);
    
    const currentGw = getCurrentGameweek(bootstrap);
    console.log(`📅 Current Gameweek: ${currentGw}`);
    
    const isSeasonStarted = bootstrap.events.some((e) => e.is_current || e.finished);
    console.log(`⚽ Dynamic Season Active Status: ${isSeasonStarted}`);
    
    const { teamCodeMap, teamNameMap } = buildTeamMaps(bootstrap);
    
    console.log("📥 Fetching fixtures...");
    const fixtures = await fplFetch(FIXTURES_URL);
    const nextFixturesMap = buildNextFixturesMap(fixtures, currentGw, teamNameMap, teamCodeMap);
    
    const posMap = {};
    const positions = ["", "gk", "def", "mid", "fwd"];
    bootstrap.element_types.forEach((et) => {
      posMap[et.id] = positions[et.id] || "mid";
    });
    
    console.log(`👥 Total Raw FPL Elements: ${bootstrap.elements.length}`);
    
    const diff = await new DiffWriter(db, "scoutPlayers").load();
    let batch = db.batch();
    let count = 0;
    let batchCount = 0;
    const activeValidPlayerIds = new Set(); // တရားဝင်ကစားသမား ID များကို မှတ်သားထားမည်
    
    for (const el of bootstrap.elements) {
      const status = el.status || "a";

      // 🚨 CRITICAL FIX: ရောင်းထုတ်ခံရသူများ (Unavailable / Left League) ကို လုံးဝ မထည့်ဘဲ ကျော်မည်
      if (status === "u") {
        continue;
      }

      activeValidPlayerIds.add(String(el.id));
      const docRef = db.collection("scoutPlayers").doc(String(el.id));
      
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
      
      const payload = {
        playerId: el.id,
        name: el.web_name,
        fullName: `${el.first_name} ${el.second_name}`,
        position: posMap[el.element_type] || "mid",
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
        nextMatches: nextFixturesMap[el.team] || [],

        // 🩺 Availability & Suspension Fields:
        status: status,
        chanceOfPlaying: chanceOfPlaying,
        chanceOfPlayingThisRound: thisChanceRaw !== null ? Number(thisChanceRaw) : null,
        isAvailable: isAvailable,
        isDoubtful: isDoubtful,
        isSuspended: isSuspended,
        isInjured: isInjured,
        news: el.news || "",
        newsAdded: el.news_added || null,

      };
      count++;
      if (!diff.changed(el.id, payload)) continue; // မပြောင်းရင် skip
      batch.set(docRef, { ...payload, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      batchCount++;
      
      if (batchCount >= 100) {
        await batch.commit();
        console.log(`   ...[Interval Info] ${count} active players recorded.`);
        
        batch = db.batch();
        batchCount = 0;
        
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    
    if (batchCount > 0) {
      await batch.commit();
      console.log(`   ...[Interval Info] Final chunk written. Total: ${count} active players.`);
    }

    // =========================================================================
    // 🧹 STEP 4: FIRESTORE မှ ရောင်းပြီးသား (OUTDATED/SOLD) PLAYERS များကို ရှင်းလင်းခြင်း
    // =========================================================================
    console.log("🧹 Scanning Firestore to remove sold/transferred players...");
    // hash doc ကနေ stale ID ရှာ (collection တစ်ခုလုံး မဖတ်တော့ဘူး)။ ပထမဆုံးအကြိမ်ပဲ full scan
    const staleIds = diff.isEmpty
      ? (await db.collection("scoutPlayers").get()).docs.map((d) => d.id).filter((id) => !activeValidPlayerIds.has(id))
      : diff.staleIds();
    let deleteBatch = db.batch();
    let deleteCount = 0;

    staleIds.forEach((id) => {
      deleteBatch.delete(db.collection("scoutPlayers").doc(id));
      deleteCount++;
    });

    if (deleteCount > 0) {
      await deleteBatch.commit();
      console.log(`🗑️ Successfully deleted ${deleteCount} sold/inactive players from Firestore.`);
    } else {
      console.log("✨ Firestore is completely clean! No sold players found.");
    }
    
    await diff.save({ prune: true });
    console.log("============================================");
    console.log(`✅ Player Scout Sync Complete — ${count} active players maintained.`);
    console.log("============================================");
    
    await db.collection("syncLogs").add({
      type: "player-scout-sync-injury-status",
      gameweek: currentGw,
      isSeasonStarted: isSeasonStarted,
      totalPlayers: count,
      deletedSoldPlayers: deleteCount,
      runAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    
    process.exit(0);
  } catch (err) {
    console.error("🔥 Fatal Error:", err.message);
    process.exit(1);
  }
}

main();
