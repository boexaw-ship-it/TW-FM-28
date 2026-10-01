// ============================================
// TW Fantasy Official League
// Unified League Sync Engine (1 Doc per League = 1 Quota Pattern)
// Features: Live BPS, Live Auto-Subs, Vice-Captain Promotion, Net GW Points
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

  // Gameweek Live Stats Map (Minutes played, Live BPS, Goals, Assists)
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
      
      // Live Performance Intelligence
      livePoints: liveInfo.livePoints,
      minutesPlayed: liveInfo.minutes,
      bps: liveInfo.bps,
      provisionalBonus: liveInfo.bonus,
      goalsScored: liveInfo.goals,
      assists: liveInfo.assists,

      // Availability Metadata
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
        fullName: master.fullName,
        position: master.position,
        elementType: master.elementType,
        teamCode: master.teamCode,
        price: master.price,
        livePoints: master.livePoints,
        minutesPlayed: master.minutesPlayed,
        bps: master.bps,
        provisionalBonus: master.provisionalBonus,
        isCaptain: p.is_captain === true,
        isVice: p.is_vice_captain === true,
        originalMultiplier: p.multiplier,
        multiplier: p.multiplier,
        isStarter: index < 11,
        benchIndex: index >= 11 ? (index - 10) : 0, // 1, 2, 3, 4
        status: master.status,
        isInjured: master.isInjured,
        isSuspended: master.isSuspended,
        news: master.news,
        autoSubbedIn: false,
        autoSubbedOut: false
      };
    });

    // 💡 1. Captain / Vice-Captain Live Logic
    const cap = rawPicks.find(p => p.isCaptain);
    const vice = rawPicks.find(p => p.isVice);

    // Captain မကစားခဲ့ပါက (Minutes == 0 ဖြစ်ပြီး ပွဲပြီးသွားပါက) Vice-Captain သို့ Multiplier လွှဲခြင်း
    if (cap && cap.minutesPlayed === 0 && cap.status !== "a" && vice) {
      if (cap.multiplier > 1) {
        vice.multiplier = isTripleCaptain ? 3 : 2;
        cap.multiplier = 0;
        cap.autoCaptainFailed = true;
        vice.promotedToCaptain = true;
      }
    }

    // 💡 2. Live Auto-Substitution Calculation (Bench Boost မဟုတ်မှသာ တွက်သည်)
    if (!isBenchBoost) {
      const starters = rawPicks.filter(p => p.isStarter);
      const bench = rawPicks.filter(p => !p.isStarter);

      starters.forEach(starter => {
        // Starter မကစားခဲ့ပါက
        if (starter.minutesPlayed === 0 && (starter.status === "i" || starter.status === "s" || starter.status === "u")) {
          // Goalkeeper ဆိုပါက ခုံတန်း GK ဖြင့်သာ အစားထိုးမည်
          if (starter.elementType === 1) {
            const subGK = bench.find(b => b.elementType === 1 && b.minutesPlayed > 0 && !b.autoSubbedIn);
            if (subGK) {
              starter.autoSubbedOut = true;
              starter.multiplier = 0;
              subGK.autoSubbedIn = true;
              subGK.multiplier = 1;
            }
          } else {
            // Outfield player (Formation Rules: အနည်းဆုံး Def ၃ ယောက် ရှိရမည်)
            const activeDefs = starters.filter(s => s.elementType === 2 && !s.autoSubbedOut).length;
            
            for (const sub of bench) {
              if (sub.elementType === 1 || sub.autoSubbedIn || sub.minutesPlayed === 0) continue;

              // Defender နေရာတွင် အစားထိုးပါက Def ၃ ယောက် ပြည့်မပြည့် စစ်ဆေးခြင်း
              if (starter.elementType === 2 && activeDefs < 3 && sub.elementType !== 2) {
                continue; 
              }

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

    // 💡 3. Total Live GW Points တွက်ချက်ခြင်း
    let calculatedLiveGwPoints = 0;
    rawPicks.forEach(p => {
      const mult = isBenchBoost ? (p.originalMultiplier || 1) : p.multiplier;
      if (mult > 0) {
        calculatedLiveGwPoints += (p.livePoints * mult);
      }
    });

    const hitCost = data.entry_history?.event_transfers_cost || 0;
    const netLiveGwPoints = calculatedLiveGwPoints - hitCost;

    return {
      chip: activeChip,
      hitCost: hitCost,
      grossGwPoints: calculatedLiveGwPoints,
      gwPoints: netLiveGwPoints, // ဒဏ်ကြေးနုတ်ပြီး အသားတင် ရမှတ်
      picks: rawPicks
    };
  } catch (err) {
    return { chip: null, hitCost: 0, grossGwPoints: 0, gwPoints: 0, picks: [] };
  }
}

// === Synchronize Specific League into a SINGLE DOCUMENT ===
async function syncLeague(leagueConfig, gw, playersMasterMap) {
  const { firebaseId, fplLeagueId, name } = leagueConfig;
  console.log(`📥 Syncing League: "${name}" | ID: ${fplLeagueId} (Unified 1-Doc Mode)...`);

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
        gwPoints: detail.gwPoints, // Net Points (After transfer cost)
        hitCost: detail.hitCost,
        chip: detail.chip,
        picks: detail.picks
      });

      // API Rate Limit မထိစေရန် 30ms sleep
      await new Promise(r => setTimeout(r, 30));
    }

    // 💡 Firestore Document ၁ ခုတည်းအတွင်းသို့ အကုန်ထည့်သွင်းခြင်း (1 Write Quota Only)
    const leagueDocRef = db.collection("leagues").doc(firebaseId);
    const finalDocPayload = {
      leagueName: name,
      fplLeagueId: fplLeagueId,
      gameweek: gw,
      totalTeams: teamsPayload.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      teams: teamsPayload // <--- Array of all managers and their squad picks
    };

    if (diff.changed("unified_league_payload", finalDocPayload)) {
      await leagueDocRef.set(finalDocPayload, { merge: true });
      console.log(`💾 [SAVED 1-DOC] League "${name}" (${firebaseId}) successfully written to Firestore.`);
    } else {
      console.log(`⚡ [NO CHANGE] League "${name}" data is identical to previous sync. Skipped write.`);
    }

    await diff.save({ prune: true });
    console.log(`✅ League "${name}" Sync Complete! Used only 1 Firestore Write Quota.`);
  } catch (err) {
    console.error(`❌ League sync error (${name}): ${err.message}`);
  }
}

// === Main Engine ===
async function main() {
  console.log("🚀 Starting Optimized 5-League Sync Engine (1-Doc Quota Architecture)...");

  try {
    // ပထမဆုံး Events ဆွဲယူပြီး Gameweek ကို သတ်မှတ်သည်
    const bootstrapFirst = await fplFetch(`${FPL_BASE}/bootstrap-static/`);
    const targetWeek = autoDetectCurrentGameweek(bootstrapFirst.events || []);
    console.log(`🤖 Target Gameweek: GW ${targetWeek}`);

    // အဆိုပါ Gameweek အတွက် Live Points + Master Map ကို တစ်ကြိမ်တည်း ဆွဲယူသည်
    const { playersMap: playersMasterMap } = await getPlayerMasterMap(targetWeek);

    // League ၅ ခုကို တန်းစီ Run သည်
    for (const league of LEAGUES) {
      await syncLeague(league, targetWeek, playersMasterMap);
    }

    console.log(`🎉 [COMPLETED] 5 Leagues Synced successfully using minimal Firestore Write operations!`);
    process.exit(0);
  } catch (err) {
    console.error("Fatal Error: " + err.message);
    process.exit(1);
  }
}

main();
