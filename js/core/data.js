// ============================================
// TW FM Data Layer — Firestore "1-document" schema adapter
//   fixturesMeta/allFixtures   (fixtures[] + currentGameweek + gameweekSummary)
//   scoutPlayers/allPlayers    (players[] + fixturesByTeam + currentGameweek)
//   leagues/{leagueId}         (teams[] + picks)
// Page code က အရင် per-document snapshot (forEach / d.id / d.data()) ကိုပဲ မျှော်လင့်ထားလို့
// ဒီမှာ array ကို snapshot-ပုံစံ ပြန်ပြောင်းပေး → page code ကို အကြီးအကျယ် မပြင်ရ။
// Read cost: collection တစ်ခုလုံး (ရာချီ doc) အစား doc 1 ခုပဲ (fs.js TTL cache နဲ့ ထပ်သက်သာ)
// ============================================
import { db } from "../firebase-config.js";
import { doc, getDoc, getDocFromServer, onSnapshot } from "./fs.js";

const EMPTY_FIX = { fixtures: [], currentGameweek: null, gameweekSummary: {} };
const EMPTY_SCOUT = { players: [], fixturesByTeam: {}, currentGameweek: null, isSeasonStarted: false };

function makeSnap(items, idOf) {
  const docs = items.map((x) => ({ id: String(idOf(x)), data: () => x, exists: () => true }));
  return { docs, size: docs.length, empty: docs.length === 0, forEach: (cb) => docs.forEach(cb) };
}

async function readDoc(ref, force) {
  const snap = force ? await getDocFromServer(ref) : await getDoc(ref);
  return snap && snap.exists() ? snap.data() : null;
}

// ---------- Fixtures ----------
function normalizeFixtures(master) {
  const list = Array.isArray(master?.fixtures) ? master.fixtures : [];
  const count = {};
  list.forEach((f) => {
    if (!f.event) return;
    [f.team_h, f.team_a].forEach((t) => { const k = f.event + ":" + t; count[k] = (count[k] || 0) + 1; });
  });
  return list.map((f) => {
    // stats: { goals_scored:{h,a}, ... } -> [{identifier,h,a}] (page code အဟောင်းပုံစံ)
    let stats = f.stats;
    if (stats && !Array.isArray(stats)) {
      const fix = (arr) => (arr || []).map((p) => ({ ...p, element_name: p.element_name || p.name || "Player" }));
      stats = Object.entries(stats).map(([identifier, v]) => ({ identifier, h: fix(v?.h), a: fix(v?.a) }));
    }
    return {
      ...f,
      stats: stats || [],
      is_home_dgw: Boolean(f.event && count[f.event + ":" + f.team_h] > 1),
      is_away_dgw: Boolean(f.event && count[f.event + ":" + f.team_a] > 1),
    };
  });
}

export async function loadFixturesMaster(force = false) {
  const m = await readDoc(doc(db, "fixturesMeta", "allFixtures"), force);
  return m ? { ...m, fixtures: normalizeFixtures(m) } : EMPTY_FIX;
}
export async function getFixturesSnap(force = false) {
  const m = await loadFixturesMaster(force);
  return makeSnap(m.fixtures, (f) => f.id);
}

// ---------- Scout players ----------
export async function loadScoutMaster(force = false) {
  const m = await readDoc(doc(db, "scoutPlayers", "allPlayers"), force);
  return m ? { ...m, players: Array.isArray(m.players) ? m.players : [] } : EMPTY_SCOUT;
}
export async function getScoutSnap(force = false) {
  const m = await loadScoutMaster(force);
  return makeSnap(m.players, (p) => p.playerId ?? p.id);
}

// ---------- Leagues ----------
export async function loadLeague(leagueId, force = false) {
  return readDoc(doc(db, "leagues", leagueId), force);
}
export async function getLeagueStandingsSnap(leagueId, force = false) {
  const m = await loadLeague(leagueId, force);
  return makeSnap(Array.isArray(m?.teams) ? m.teams : [], (t) => t.fplTeamId);
}
// league doc ကို listen (sync တစ်ခါပြောင်းမှ 1 read) — popup အတွက်၊ page ထွက်ရင် scope က auto-unsubscribe
export function onLeagueTeam(leagueId, fplTeamId, cb) {
  return onSnapshot(doc(db, "leagues", leagueId), (snap) => {
    const teams = snap.exists() && Array.isArray(snap.data().teams) ? snap.data().teams : [];
    const t = teams.find((x) => String(x.fplTeamId) === String(fplTeamId));
    cb({ exists: () => !!t, data: () => t, id: String(fplTeamId) });
  }, (err) => console.warn("league listener:", err));
}
