// ============================================
// TW Fantasy Official League
// League Sync Script (5 Leagues Unified Engine - Injuries & Cards Enhanced)
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

// === FPL API ===
const FPL_BASE = "https://fantasy.premierleague.com/api";

// === 5 Leagues Config (Original 2 Renamed + 3 New Added) ===
const LEAGUES = [
  // 1. နဂို Weekly League (ID: 36009) -> TW FPL WEEKLY သို့ ပြောင်းလဲခြင်း
  { firebaseId: "league1", fplLeagueId: 36009, name: "TW FPL WEEKLY" },

  // 2. နဂို All Friends (ID: 2004515) -> TWFPL SUPER သို့ ပြောင်းလဲခြင်း
  { firebaseId: "league2", fplLeagueId: 2004515, name: "TWFPL SUPER" },

  // 3. နောက်တိုး Poseidon Pro League (ID: 8074)
  { firebaseId: "league3", fplLeagueId: 8074, name: "FPL Poseidon Pro League" },

  // 4. နောက်တိုး Poseidon Semi-pro League (ID: 9520)
  { firebaseId: "league4", fplLeagueId: 9520, name: "FPL Poseidon Semi-pro League" },

  // 5. နောက်တိုး Poseidon Amateur League (ID: 10399)
  { firebaseId: "league5", fplLeagueId: 10399, name: "FPL Poseidon Amateur League" }
];

// === Helper: FPL API Fetch ===
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

// 📊 ကစားသမား Master Lookup ပုံဖော်ခြင်း (Injury / Suspension / Status ပါဝင်သည်)
async function getPlayerMasterMap() {
  console.log("📊 Fetching FPL Bootstrap-Static Master Data (Including Status & Injuries)...");
  const bootstrap = await fplFetch(`${FPL_BASE}/bootstrap-static/`);
  
  const teamsMap = {};
  bootstrap.teams.forEach(t => {
    teamsMap[t.id] = (t.short_name || "").toUpperCase().trim(); 
  });

  const playersMap = {};
  const positions = ["", "gk", "def", "mid", "fwd"];

  bootstrap.elements.forEach(p => {
    const status = p.status || "a";
    const nextChanceRaw = p.chance_of_playing_next_round;
    const thisChanceRaw = p.chance_of_playing_this_round;

    // 💡 Availability & Playing Chance Engine
    let chanceOfPlaying = 100;
    if (nextChanceRaw !== null && nextChanceRaw !== undefined) {
      chanceOfPlaying = Number(nextChanceRaw);
    } else if (status === "i" || status === "s" || status === "u") {
      chanceOfPlaying = 0;
    } else if (status === "d") {
      chanceOfPlaying = 75;
    }

    const isAvailable = status === "a" && chanceOfPlaying === 100;
    const isDoubtful = status === "d" || (chanceOfPlaying > 0 && chanceOfPlaying < 100);
    const isSuspended = status === "s";
    const isInjured = status === "i";

    playersMap[p.id] = {
      name: p.web_name,
      fullName: `${p.first_name} ${p.second_name}`,
      position: positions[p.element_type] || "mid", 
      teamCode: teamsMap[p.team] || "UNKNOWN",       
      livePoints: p.event_points ?? 0,
      price: parseFloat((p.now_cost / 10).toFixed(1)),

      // 🩺 Injury, Card & Suspension Mapping:
      status: status,
      chanceOfPlaying: chanceOfPlaying,
      chanceOfPlayingThisRound: thisChanceRaw !== null ? Number(thisChanceRaw) : null,
      isAvailable: isAvailable,
      isDoubtful: isDoubtful,
      isSuspended: isSuspended, // Red card သို့မဟုတ် ပွဲပယ်
      isInjured: isInjured,     // ဒဏ်ရာရရှိမှု
      news: p.news || "",
    };
  });

  return { playersMap, events: bootstrap.events || [] };
}

// 🗓️ FPL ရဲ့ Gameweek အား အပြည့်အဝ အလိုအလျောက် ရွေးချယ်ပေးမည့် Engine
function autoDetectCurrentGameweek(events) {
  const current = events.find(e => e.is_current === true);
  if (current) return current.id;

  const next = events.find(e => e.is_next === true);
  if (next) return next.id;

  const finishedEvents = events.filter(e => e.finished === true);
  if (finishedEvents.length > 0) {
    return finishedEvents[finishedEvents.length - 1].id;
  }

  return 1;
}

// === Pagination-supported Standing Fetcher ===
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
    if (hasNext) await new Promise((r) => setTimeout(r, 300));
  }

  return allResults;
}

// === Team Details + Players Array Extraction (with Availability Status) ===
async function getTeamGwDetail(fplTeamId, gw, playersMasterMap) {
  try {
    const data = await fplFetch(`${FPL_BASE}/entry/${fplTeamId}/event/${gw}/picks/`);
    
    let calculatedLiveGwPoints = 0;
    const activeChip = data.active_chip || null;
    const isBenchBoost = (activeChip === "bboost");

    const squadPicks = (data.picks || []).map((p, index) => {
      const masterInfo = playersMasterMap[p.element] || { 
        name: "?", 
        fullName: "?",
        position: "mid", 
        teamCode: "UNKNOWN", 
        livePoints: 0,
        price: 0,
        status: "a",
        chanceOfPlaying: 100,
        chanceOfPlayingThisRound: null,
        isAvailable: true,
        isDoubtful: false,
        isSuspended: false,
        isInjured: false,
        news: ""
      };
      
      let finalMultiplier = p.multiplier !== undefined && p.multiplier !== null ? Number(p.multiplier) : (index < 11 ? 1 : 0);
      if (isBenchBoost && finalMultiplier === 0) {
        finalMultiplier = 1;
      }

      const pts = Number(masterInfo.livePoints || 0);

      if (index < 11 || isBenchBoost) {
        calculatedLiveGwPoints += (pts * finalMultiplier);
      }

      return {
        playerId: p.element,
        name: masterInfo.name,
        fullName: masterInfo.fullName,
        position: masterInfo.position, 
        teamCode: masterInfo.teamCode, 
        livePoints: masterInfo.livePoints,
        price: masterInfo.price,
        multiplier: finalMultiplier, 
        isCaptain: p.is_captain === true || p.is_captain === "true" || finalMultiplier > 1,
        isVice: p.is_vice_captain === true || p.is_vice === true,

        // 🩺 Availability Metadata
        status: masterInfo.status,
        chanceOfPlaying: masterInfo.chanceOfPlaying,
        chanceOfPlayingThisRound: masterInfo.chanceOfPlayingThisRound,
        isAvailable: masterInfo.isAvailable,
        isDoubtful: masterInfo.isDoubtful,
        isSuspended: masterInfo.isSuspended,
        isInjured: masterInfo.isInjured,
        news: masterInfo.news
      };
    });

    return {
      chip: activeChip,
      hitCost: data.entry_history?.event_transfers_cost || 0,
      gwPoints: calculatedLiveGwPoints > 0 ? calculatedLiveGwPoints : (data.entry_history?.points || 0),
      picks: squadPicks 
    };
  } catch (err) {
    console.log(`   ⚠️ Could not fetch detail for team ${fplTeamId}: ${err.message}`);
    return { chip: null, hitCost: 0, gwPoints: 0, picks: [] };
  }
}

// === Synchronize Specific League ===
async function syncLeague(leagueConfig, gw, playersMasterMap) {
  const { firebaseId, fplLeagueId, name } = leagueConfig;
  console.log(`📥 Syncing League: "${name}" | ID: ${fplLeagueId} (${firebaseId}) — Gameweek ${gw} Mode...`);

  try {
    const standings = await fetchAllStandings(fplLeagueId);
    const diff = await new DiffWriter(db, "league_" + firebaseId).load();
    console.log(`   Found ${standings.length} teams in "${name}" — syncing standings & picks...`);

    // 💡 League Info Metadata Update
    if (diff.changed("__meta", { leagueName: name, fplLeagueId })) await db.collection("leagues").doc(firebaseId).set({
      leagueName: name,
      fplLeagueId: fplLeagueId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    let batch = db.batch();
    let count = 0;

    for (const team of standings) {
      const detail = await getTeamGwDetail(team.entry, gw, playersMasterMap);

      const docRef = db
        .collection("leagues")
        .doc(firebaseId)
        .collection("standings")
        .doc(String(team.entry));

      const payload = {
        fplTeamId: team.entry,
        teamName: team.entry_name,
        managerName: team.player_name,
        rank: team.rank,
        lastRank: team.last_rank,
        points: team.total,           
        gwPoints: detail.gwPoints,    
        gameweek: gw,
        chip: detail.chip,            
        hitCost: detail.hitCost, 
        picks: detail.picks,
      };
      if (diff.changed(team.entry, payload)) {
        batch.set(docRef, { ...payload, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        count++;
      }
      
      await new Promise((r) => setTimeout(r, 50));

      if (count % 400 === 0) {
        await batch.commit();
        batch = db.batch();
        console.log(`   ...${count} entries recorded`);
      }
    }

    await batch.commit();
    await diff.save({ prune: true });
    console.log(`✅ League "${name}" (${fplLeagueId}) — ${standings.length} records successfully synced.`);
  } catch (err) {
    console.error("❌ League update error for: " + name + " (" + firebaseId + ") - " + err.message);
  }
}

// === Execution Process ===
async function main() {
  console.log("🚀 Running Unified 5-League Sync Engine (With Injury & Card Intelligence)...");

  try {
    const { playersMap: playersMasterMap, events } = await getPlayerMasterMap();

    const targetWeek = autoDetectCurrentGameweek(events);
    console.log(`🤖 [AUTO DETECTED]: Gameweek ${targetWeek} အား အလိုအလျောက် သတ်မှတ်ပြီး Sync စတင်ပါမည်။`);

    for (const league of LEAGUES) {
      await syncLeague(league, targetWeek, playersMasterMap);
    }

    console.log(`🎉 [SUCCESS] Gameweek ${targetWeek} အတွက် League (၅) ခုစလုံး Leaderboard ရမှတ်များနှင့် လူစာရင်းများ Sync ပြီးစီးပါပြီဗျာ။`);
    process.exit(0);
  } catch (err) {
    console.error("Fatal exception: " + err.message);
    process.exit(1);
  }
}

main();
