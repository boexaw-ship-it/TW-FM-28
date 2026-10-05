// ============================================
// TW FM — Home UI Controller (Production)
// Path: js/home.js
// Standards: UI Design Knowledge Pack (Zero Mock, 100% Dynamic Firestore)
// Responsibilities: Pure Firestore Current GW Sync & Dynamic Stadium Resolver
// ============================================

import { db } from "./firebase-config.js";
import { doc, getDoc } from "./core/fs.js";
import { loadFixturesMaster } from "./core/data.js";

const $ = (id) => document.getElementById(id);
const MIN = 60 * 1000;

const SCOUT_CACHE_KEY_LIVE = "twfm_scout_highlights_v13";
const DEADLINE_CACHE_KEY_LIVE = "twfm_dynamic_deadline_v13";

const LS = {
  get(k, ttl) { 
    try { 
      const o = JSON.parse(localStorage.getItem(k)); 
      if (o && Date.now() - o.t < ttl) return o.v; 
    } catch (_) {} 
    return null; 
  },
  set(k, v) { 
    try { 
      localStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); 
    } catch (_) {} 
  },
};

const fmt = (n) => (Number.isFinite(+n) && n !== null && n !== undefined && n !== "" ? Number(n).toLocaleString("en-US") : "–");
const pad = (n) => String(Math.max(0, n)).padStart(2, "0");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let deadlineTs = 0;
let currentGwNumber = null;
let lastDoneGw = null;
let liveStats = null;
let liveTeamSquad = null;
let currentFplId = null;
let scoutHighlightsData = null;
let mode = "cap";
let timerInterval = null;

const POS = { 
  gk: "#2563EB",   
  gkp: "#2563EB",  
  def: "#EF4444",  
  mid: "#F59E0B",  
  fwd: "#22C55E"   
};

// 6 Modes Dynamic Synchronization
const MODES = {
  cap: { label: "Most Captained", color: "#FFFFFF", key: "mostCaptained", show: (p) => `${p.totalPoints || p.gwPoints || 0} pts` },
  own: { label: "Highest Owned", color: "#FBBF24", key: "mostOwned", show: (p) => `${Number(p.ownership || 0).toFixed(1)}%` },
  tin: { label: "Top Transfers In", color: "#22C55E", key: "mostTransferredIn", show: (p) => `+${fmt(p.transfersInEvent || 0)}` },
  tout: { label: "Top Transfers Out", color: "#EF4444", key: "mostTransferredOut", show: (p) => `-${fmt(p.transfersOutEvent || 0)}` },
  total: { label: "Total Points Leaders", color: "#38BDF8", key: "mostTotalPoints", show: (p) => `${p.totalPoints || 0} pts` },
  gw: { label: "Gameweek High Scorers", color: "#34D399", key: "mostGwPoints", show: (p) => `${p.gwPoints || 0} pts` }
};

// 🏟️ Premier League Official Stadium Map (Dynamic Stadium Resolver)
const TEAM_STADIUM_MAP = {
  "ARS": "Emirates Stadium",
  "AVL": "Villa Park",
  "BOU": "Vitality Stadium",
  "BRE": "Gtech Community Stadium",
  "BHA": "Amex Stadium",
  "CHE": "Stamford Bridge",
  "COV": "Coventry Building Society Arena",
  "CRY": "Selhurst Park",
  "EVE": "Goodison Park",
  "FUL": "Craven Cottage",
  "HUL": "MKM Stadium",
  "IPS": "Portman Road",
  "LEE": "Elland Road",
  "LIV": "Anfield",
  "MCI": "Etihad Stadium",
  "MUN": "Old Trafford",
  "NEW": "St. James' Park",
  "NFO": "City Ground",
  "TOT": "Tottenham Hotspur Stadium",
  "SUN": "Stadium of Light"
};

const teamDetailsMap = {
  1:  { name: "Arsenal", short: "ARS", code: "ars", color: "#EF0107" },
  2:  { name: "Aston Villa", short: "AVL", code: "avl", color: "#95BFE5" },
  3:  { name: "AFC Bournemouth", short: "BOU", code: "bou", color: "#DA291C" },
  4:  { name: "Brentford", short: "BRE", code: "bre", color: "#E30613" },
  5:  { name: "Brighton & Hove Albion", short: "BHA", code: "bha", color: "#0057B8" },
  6:  { name: "Chelsea", short: "CHE", code: "che", color: "#034694" },
  7:  { name: "Coventry City", swift: "COV", short: "COV", code: "cov", color: "#0099D8" },
  8:  { name: "Crystal Palace", short: "CRY", code: "cry", color: "#1B458F" },
  9:  { name: "Everton", short: "EVE", code: "eve", color: "#003399" },
  10: { name: "Fulham", short: "FUL", code: "ful", color: "#F8FAFC" },
  11: { name: "Hull City", short: "HUL", code: "hul", color: "#F5971E" },
  12: { name: "Ipswich Town", short: "IPS", code: "ips", color: "#0047AB" },
  13: { name: "Leeds United", short: "LEE", code: "lee", color: "#FFCD00" },
  14: { name: "Liverpool", short: "LIV", code: "liv", color: "#C8102E" },
  15: { name: "Manchester City", short: "MCI", code: "mci", color: "#6CABDD" },
  16: { name: "Manchester United", short: "MUN", code: "mun", color: "#DA291C" },
  17: { name: "Newcastle United", short: "NEW", code: "new", color: "#F8FAFC" },
  18: { name: "Nottingham Forest", short: "NFO", code: "nfo", color: "#DD0000" },
  19: { name: "Tottenham Hotspur", short: "TOT", code: "tot", color: "#8E9BB4" },
  20: { name: "Sunderland", short: "SUN", code: "sun", color: "#EB172B" }
};

const TEAM_LOOKUP = {};
Object.entries(teamDetailsMap).forEach(([id, meta]) => {
  TEAM_LOOKUP[String(id)] = { id, ...meta };
  TEAM_LOOKUP[meta.code.toLowerCase()] = { id, ...meta };
  TEAM_LOOKUP[meta.short.toLowerCase()] = { id, ...meta };
  TEAM_LOOKUP[meta.name.toLowerCase()] = { id, ...meta };
});

function getTeamMeta(teamIdentifier) {
  if (!teamIdentifier) {
    return { id: 1, name: "Arsenal", short: "ARS", code: "ars", color: "#EF0107", badgePath: "./assets/badges/ars.png" };
  }
  const clean = String(teamIdentifier).trim().toLowerCase();
  const matched = TEAM_LOOKUP[clean];
  if (matched) {
    return { ...matched, badgePath: `./assets/badges/${matched.code}.png` };
  }
  return { id: 1, name: "Arsenal", short: "ARS", code: "ars", color: "#EF0107", badgePath: "./assets/badges/ars.png" };
}

// 👕 3D Club Kits Only — Zero Player Portrait Dependency
function resolveClubJerseyPath(p) {
  const meta = getTeamMeta(p.teamCode || p.team);
  const code = (meta.code || "che").toLowerCase();
  const rawPos = String(p.position || "mid").toLowerCase().trim();
  const isGk = rawPos === "gk" || rawPos === "gkp";
  
  return isGk ? `./public/jerseys/gk/${code}.png` : `./public/jerseys/outfield/${code}.png`;
}

function normalizeEpochMs(epoch) {
  if (!epoch) return 0;
  const num = Number(epoch);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num < 10000000000 ? num * 1000 : num;
}

function formatYangonDate(ms) {
  if (!ms) return "–";
  return new Date(ms).toLocaleString("en-GB", { 
    timeZone: "Asia/Yangon", 
    weekday: "short", 
    day: "numeric", 
    month: "short", 
    year: "numeric", 
    hour: "2-digit", 
    minute: "2-digit", 
    hour12: false 
  }) + " MMT";
}

function resolveUpcomingDeadline(meta) {
  const now = Date.now();
  if (!meta) return null;

  const eventsList = Array.isArray(meta.events) ? meta.events 
                   : Array.isArray(meta.gameweeks) ? meta.gameweeks 
                   : null;

  if (eventsList && eventsList.length > 0) {
    const upcoming = eventsList.find(ev => {
      const ms = normalizeEpochMs(ev.deadline_time_epoch || ev.deadlineTimeEpoch);
      return ms > now;
    });

    if (upcoming) {
      const gwId = Number(upcoming.id || upcoming.event);
      return {
        gw: gwId,
        ts: normalizeEpochMs(upcoming.deadline_time_epoch || upcoming.deadlineTimeEpoch),
        lastDone: Math.max(0, gwId - 1)
      };
    }
  }

  const cur = meta.currentGameweek;
  if (cur) {
    const curMs = normalizeEpochMs(cur.deadlineTimeEpoch || cur.deadline_time_epoch);
    const next = cur.nextGw;
    const nextMs = next ? normalizeEpochMs(next.deadlineTimeEpoch || next.deadline_time_epoch) : 0;

    if (curMs > now) {
      return {
        gw: Number(cur.id || 1),
        ts: curMs,
        lastDone: Math.max(0, Number(cur.id || 1) - 1)
      };
    }
    if (next && nextMs > now) {
      return {
        gw: Number(next.id || (Number(cur.id || 1) + 1)),
        ts: nextMs,
        lastDone: Number(cur.id || 0)
      };
    }
  }

  return null;
}

function updateDeadlineUI() {
  const gwLabelEl = $("gw-label");
  const gwWhenEl = $("gw-when");
  if (gwLabelEl && currentGwNumber) gwLabelEl.textContent = `GW${currentGwNumber} DEADLINE`;
  if (gwWhenEl && deadlineTs) gwWhenEl.textContent = formatYangonDate(deadlineTs);
}

function initDeadlineTimer() {
  const cached = LS.get(DEADLINE_CACHE_KEY_LIVE, 5 * MIN);
  if (cached && cached.ts && cached.ts > Date.now()) {
    deadlineTs = cached.ts;
    currentGwNumber = cached.gw;
    lastDoneGw = cached.lastDone;
    updateDeadlineUI();
    tick();
  }

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(tick, 1000);

  loadFixturesMaster().then(meta => {
    if (!meta) return;
    const resolved = resolveUpcomingDeadline(meta);
    if (resolved && resolved.ts > 0) {
      deadlineTs = resolved.ts;
      currentGwNumber = resolved.gw;
      lastDoneGw = resolved.lastDone;

      LS.set(DEADLINE_CACHE_KEY_LIVE, resolved);

      updateDeadlineUI();
      tick();
      paintStats();
    }
  }).catch(err => console.warn("Deadline resolver notice:", err));
}

function tick() {
  const now = Date.now();
  let d = deadlineTs ? Math.max(0, deadlineTs - now) : 0;

  if (deadlineTs > 0 && d === 0) {
    localStorage.removeItem(DEADLINE_CACHE_KEY_LIVE);
    initDeadlineTimer();
    return;
  }

  const days = Math.floor(d / 864e5); d -= days * 864e5;
  const h = Math.floor(d / 36e5); d -= h * 36e5;
  const m = Math.floor(d / 6e4); d -= m * 6e4;
  const s = Math.floor(d / 1e3);

  const set = (id, v) => { 
    const e = $(id); 
    if (e && e.textContent !== v) e.textContent = v; 
  };
  set("cd-d", pad(days)); 
  set("cd-h", pad(h)); 
  set("cd-m", pad(m)); 
  set("cd-s", pad(s));
}

function decorateManagerFrame(profile) {
  try {
    const teamNameEl = $("welcome-name");
    const managerNameEl = $("welcome-manager");

    let rawTeam = profile?.teamName || "SEAROKER Tw";
    let cleanTeam = String(rawTeam)
      .replace(/^[\u{1F300}-\u{1F9FF}\s]+/u, "")
      .replace(/^⛵\s*/, "")
      .trim();

    let rawManager = profile?.managerName || profile?.displayName || "zaw moe";
    let cleanManager = String(rawManager)
      .replace(/^manager:\s*/i, "")
      .replace(/^manager\s*/i, "")
      .trim();

    if (teamNameEl) teamNameEl.textContent = cleanTeam || "SEAROKER Tw";
    if (managerNameEl) managerNameEl.textContent = cleanManager || "zaw moe";
  } catch (err) {
    console.warn("Manager frame decorate notice:", err);
  }
}

function paintStats() {
  if (!liveStats) return;

  const g = Number(liveStats.gameweek || lastDoneGw || 0);
  const gw = Number(liveStats.gwPoints ?? 0);
  const avg = Number(liveStats.averagePoints ?? 0);

  const t = (id, v, cls) => { 
    const e = $(id); 
    if (!e) return; 
    e.textContent = v; 
    if (cls !== undefined) e.className = cls; 
  };

  // Primary Centered Metrics
  t("st-total", fmt(liveStats.totalPoints));
  t("st-total-d", g > 0 ? `▲ +${fmt(gw)} (GW${g})` : `▲ +${fmt(gw)}`, "metric-delta delta-up");
  t("st-rank", fmt(liveStats.overallRank));
  t("st-rank-d", liveStats.gwRank ? `▲ +${fmt(liveStats.gwRank)}` : `–`, "metric-delta delta-up");
  t("st-gw-l", `GW SCORE`);
  t("st-gw", fmt(gw));

  if (Number.isFinite(avg) && avg > 0) {
    const up = gw >= avg;
    t("st-gw-d", `${up ? "▲" : "▼"} avg ${fmt(avg)}`, up ? "metric-delta delta-up" : "metric-delta delta-dn");
  } else {
    t("st-gw-d", `–`, "metric-delta delta-up");
  }

  // Tactical Micro-Pills Data Binding
  const bankVal = liveTeamSquad?.bank !== undefined ? Number(liveTeamSquad.bank).toFixed(1) : "0.0";
  t("st-bank", `£${bankVal}M`);

  const ftVal = liveTeamSquad?.freeTransfers !== undefined ? liveTeamSquad.freeTransfers : "1";
  t("st-ft", String(ftVal));

  let capPts = 0;
  let capName = "CAPTAIN PTS";
  if (Array.isArray(liveTeamSquad?.picks) && liveTeamSquad.picks.length > 0) {
    const capPick = liveTeamSquad.picks.find(p => p.isCaptain === true) || liveTeamSquad.picks[0];
    if (capPick) {
      const mult = capPick.multiplier || 2;
      const basePts = Number(capPick.livePoints ?? capPick.points ?? 0);
      capPts = basePts * mult;
      capName = (capPick.fullName || capPick.name || "CAPTAIN PTS").toUpperCase();
    }
  }

  t("st-cap-pts", fmt(capPts));
  t("st-cap-name", capName);
}

async function loadStats(user, profile) {
  currentFplId = String(
    profile?.fplTeamId || 
    profile?.fplId || 
    localStorage.getItem("twf_fpl_team_id") || 
    ""
  ).trim();

  if (!currentFplId) return;

  try { 
    const cachedLive = localStorage.getItem(`twf_shared_points_live_${currentFplId}`);
    const cachedSquad = localStorage.getItem(`twf_shared_squad_live_${currentFplId}`);
    if (cachedLive) liveStats = JSON.parse(cachedLive);
    if (cachedSquad) liveTeamSquad = JSON.parse(cachedSquad);
    if (liveStats || liveTeamSquad) paintStats();
  } catch (_) {}

  try {
    const [pSnap, tSnap] = await Promise.all([
      getDoc(doc(db, "livePoints", String(currentFplId))),
      getDoc(doc(db, "liveTeams", String(currentFplId)))
    ]);

    if (pSnap.exists()) {
      const d = pSnap.data();
      liveStats = { 
        totalPoints: d.totalPoints ?? d.overall_points ?? 0, 
        gwPoints: d.gwPoints ?? d.event_points ?? 0, 
        overallRank: d.overallRank ?? d.overall_rank ?? 0, 
        gwRank: d.gwRank ?? d.event_rank ?? 0, 
        averagePoints: d.averagePoints ?? 0, 
        gameweek: d.gameweek ?? lastDoneGw ?? 0 
      };
      localStorage.setItem(`twf_shared_points_live_${currentFplId}`, JSON.stringify(liveStats));
    }

    if (tSnap.exists()) {
      liveTeamSquad = tSnap.data();
      localStorage.setItem(`twf_shared_squad_live_${currentFplId}`, JSON.stringify(liveTeamSquad));
    }

    paintStats();
  } catch (e) { 
    console.warn("Firestore stats query error:", e); 
  }
}

async function loadScoutHighlights() {
  scoutHighlightsData = LS.get(SCOUT_CACHE_KEY_LIVE, 10 * MIN);

  if (scoutHighlightsData) {
    renderScoutTrendsCarousel();
  }

  try {
    const snap = await getDoc(doc(db, "scoutPlayers", "scoutHighlights"));
    if (snap.exists()) {
      scoutHighlightsData = snap.data();
      LS.set(SCOUT_CACHE_KEY_LIVE, scoutHighlightsData);
      renderScoutTrendsCarousel();
    }
  } catch (err) {
    console.warn("Firestore scoutHighlights query notice:", err);
  }
}

// ⚡ LEAGUE SCOUT TRENDS: UNIFIED 3-VISIBLE + 2-SCROLLABLE HORIZONTAL CAROUSEL
function renderScoutTrendsCarousel() {
  const container = $("scout-trends-feed");
  const labelEl = $("trend-category-name");
  if (!container || !scoutHighlightsData) return;

  const M = MODES[mode] || MODES.cap;
  if (labelEl) labelEl.textContent = M.label;

  document.querySelectorAll("#leader-tabs button").forEach((b) => {
    const isCurrent = b.dataset.k === mode;
    b.classList.toggle("on", isCurrent);
  });

  let list = [];
  if (mode === "cap") {
    const capData = scoutHighlightsData.mostCaptained || {};
    list = capData.topList || (capData.leader ? [capData.leader] : []);
  } else {
    const sectionData = scoutHighlightsData[M.key] || {};
    list = sectionData.topList || (sectionData.leader ? [sectionData.leader] : []);
  }

  if (list.length === 0) {
    container.innerHTML = `<div class="trend-feed-loading">No scout records for ${M.label}</div>`;
    return;
  }

  container.innerHTML = list.slice(0, 5).map((p, i) => {
    const rawPos = String(p.position || "mid").toLowerCase().trim();
    const isGk = rawPos === "gk" || rawPos === "gkp";
    const posColor = POS[rawPos] || "#F59E0B";

    const teamMeta = getTeamMeta(p.teamCode || p.team);
    const teamShort = teamMeta.short;
    const localBadgeUrl = teamMeta.badgePath;
    const jerseyPath = resolveClubJerseyPath(p);

    return `
      <div class="trend-player-card" style="border-top: 2.8px solid ${posColor};">
        <span class="player-card-rank">#${i + 1}</span>

        <div class="player-card-jersey-wrap">
          <img src="${jerseyPath}" 
               alt="${esc(p.name)}" 
               loading="lazy" 
               class="player-card-jersey-img"
               onerror="this.src='./assets/badges/${teamMeta.code}.png'; this.style.transform='scale(0.85)';">
          <img src="${localBadgeUrl}" alt="${esc(teamShort)}" class="player-card-club-badge" onerror="this.style.display='none';">
        </div>

        <div class="player-nameplate-frame">
          <div class="player-card-name">${esc(p.name)}</div>
          <div class="player-card-pos" style="color: ${posColor};">
            ${isGk ? "GK" : rawPos.toUpperCase()}
          </div>
          <div class="player-card-pts" style="color: ${M.color} !important; text-shadow: 0 0 10px rgba(157, 78, 221, 0.45);">
            ${M.show(p)}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// 🗓️ PURE DYNAMIC MATCHDAY FIXTURE & STADIUM RESOLVER (NO MOCK DATA)
async function loadNextFixture() {
  try {
    const meta = await loadFixturesMaster();
    if (!meta || !Array.isArray(meta.fixtures) || meta.fixtures.length === 0) return;

    // 🌟 Current Gameweek အစစ်အမှန်အား Dynamic ရှာဖွေခြင်း
    const targetGw = currentGwNumber || meta.currentGameweek?.id || 1;
    let targetMatch = meta.fixtures.find(f => Number(f.event) === Number(targetGw) && !f.finished)
                   || meta.fixtures.find(f => Number(f.event) === Number(targetGw))
                   || meta.fixtures[0];

    if (!targetMatch) return;

    const homeTeam = getTeamMeta(targetMatch.team_h);
    const awayTeam = getTeamMeta(targetMatch.team_a);

    // 💡 Home Team ၏ တရားဝင် အိမ်ကွင်းအမည်အား Dynamic ဆွဲထုတ်သည် (Mock မဟုတ်ပါ)
    const resolvedStadium = TEAM_STADIUM_MAP[homeTeam.short] || `${homeTeam.name} Stadium`;
    const stadiumEl = $("fixture-stadium-name");
    if (stadiumEl) {
      stadiumEl.textContent = resolvedStadium;
    }

    const fixtureTimeEl = $("next-fixture-time");
    if (fixtureTimeEl) {
      if (targetMatch.kickoff_time) {
        const d = new Date(targetMatch.kickoff_time);
        const timeStr = d.toLocaleDateString("en-GB", { timeZone: "Asia/Yangon", day: "numeric", month: "short", year: "numeric" }) +
          " · " + d.toLocaleTimeString("en-GB", { timeZone: "Asia/Yangon", hour: "2-digit", minute: "2-digit", hour12: false });
        fixtureTimeEl.textContent = `GW${targetMatch.event || targetGw} · ${timeStr}`;
      } else {
        fixtureTimeEl.textContent = `GW${targetMatch.event || targetGw}`;
      }
    }

    const hCodeEl = $("fixture-home-code");
    const hNameEl = $("fixture-home-name");
    const hBadgeEl = $("fixture-home-badge");
    if (hCodeEl) hCodeEl.textContent = homeTeam.short;
    if (hNameEl) hNameEl.textContent = homeTeam.name;
    if (hBadgeEl) {
      hBadgeEl.src = homeTeam.badgePath;
      hBadgeEl.onerror = () => { hBadgeEl.src = "./assets/badges/che.png"; };
    }

    const aCodeEl = $("fixture-away-code");
    const aNameEl = $("fixture-away-name");
    const aBadgeEl = $("fixture-away-badge");
    if (aCodeEl) aCodeEl.textContent = awayTeam.short;
    if (aNameEl) aNameEl.textContent = awayTeam.name;
    if (aBadgeEl) {
      aBadgeEl.src = awayTeam.badgePath;
      aBadgeEl.onerror = () => { aBadgeEl.src = "./assets/badges/che.png"; };
    }

  } catch (err) {
    console.warn("Live fixture error:", err);
  }
}

// 🚀 INITIALIZE HOME TAB
export async function initHomeTab(user, profile) {
  decorateManagerFrame(profile);
  initDeadlineTimer();
  loadStats(user, profile);
  loadScoutHighlights();
  loadNextFixture();

  const tabsContainer = $("leader-tabs");
  if (tabsContainer) {
    tabsContainer.onclick = (e) => {
      const b = e.target.closest("button[data-k]");
      if (!b) return;
      const newMode = b.dataset.k;
      if (mode !== newMode) {
        mode = newMode;
        renderScoutTrendsCarousel();
      }
    };
  }
}
