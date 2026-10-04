// ============================================
// TW Fantasy Official League — Home UI Controller
// Path: js/home.js
// Standards: UI Design Knowledge Pack (Zero Mock, 100% Dynamic Firestore)
// ============================================

import { db } from "./firebase-config.js";
import { doc, getDoc } from "./core/fs.js";
import { loadFixturesMaster } from "./core/data.js";

const $ = (id) => document.getElementById(id);
const MIN = 60 * 1000;

const SCOUT_CACHE_KEY_LIVE = "twfm_scout_highlights_live";
const DEADLINE_CACHE_KEY_LIVE = "twfm_dynamic_deadline_live";

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
let currentFplId = null;
let scoutHighlightsData = null;
let mode = "cap";
let timerInterval = null;

// Official FPL Position Colors
const POS = { 
  gk: "#2563EB",   
  gkp: "#2563EB",  
  def: "#EF4444",  
  mid: "#F59E0B",  
  fwd: "#22C55E"   
};

// 6 Modes Dynamic Synchronization
const MODES = {
  cap: { color: "#FFFFFF", key: "mostCaptained", show: (p) => `${p.totalPoints || p.gwPoints || 0} pts` },
  own: { color: "#FBBF24", key: "mostOwned", show: (p) => `${Number(p.ownership || 0).toFixed(1)}%` },
  tin: { color: "#22C55E", key: "mostTransferredIn", show: (p) => `+${fmt(p.transfersInEvent || 0)}` },
  tout: { color: "#EF4444", key: "mostTransferredOut", show: (p) => `-${fmt(p.transfersOutEvent || 0)}` },
  total: { color: "#38BDF8", key: "mostTotalPoints", show: (p) => `${p.totalPoints || 0} pts` },
  gw: { color: "#34D399", key: "mostGwPoints", show: (p) => `${p.gwPoints || 0} pts` }
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
    return { id: 6, name: "Chelsea", short: "CHE", code: "che", color: "#034694", badgePath: "./assets/badges/che.png" };
  }
  const clean = String(teamIdentifier).trim().toLowerCase();
  const matched = TEAM_LOOKUP[clean];
  if (matched) {
    return { ...matched, badgePath: `./assets/badges/${matched.code}.png` };
  }
  return { id: 6, name: "Chelsea", short: "CHE", code: "che", color: "#034694", badgePath: `./assets/badges/che.png` };
}

function resolvePlayerPhotoUrl(p) {
  if (!p) return "";
  if (p.photoUrl && typeof p.photoUrl === "string" && p.photoUrl.startsWith("http")) {
    return p.photoUrl;
  }
  const rawCode = p.photoCode || p.photo || p.opta_code;
  if (!rawCode) return "";
  const clean = String(rawCode).replace(/\.(jpg|jpeg|png)$/i, "").replace(/^p/i, "").trim();
  return clean ? `https://resources.premierleague.com/premierleague/photos/players/250x250/p${clean}.png` : "";
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
  }).catch(err => console.warn("Live deadline resolver error:", err));
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

  t("st-total", fmt(liveStats.totalPoints));
  t("st-total-d", g > 0 ? `▲ +${fmt(gw)} (GW${g})` : `▲ +${fmt(gw)}`, "stat-change up");
  t("st-rank", fmt(liveStats.overallRank));
  t("st-rank-d", liveStats.gwRank ? `▲ +${fmt(liveStats.gwRank)}` : `–`, "stat-change up");
  t("st-gw-l", `GW SCORE`);
  t("st-gw", fmt(gw));

  if (Number.isFinite(avg) && avg > 0) {
    const up = gw >= avg;
    t("st-gw-d", `${up ? "▲" : "▼"} avg ${fmt(avg)}`, up ? "stat-change up" : "stat-change dn");
  } else {
    t("st-gw-d", `–`, "stat-change up");
  }
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
    if (cachedLive) {
      liveStats = JSON.parse(cachedLive);
      paintStats();
    }
  } catch (_) {}

  try {
    const s = await getDoc(doc(db, "livePoints", String(currentFplId)));
    if (s.exists()) {
      const d = s.data();
      liveStats = { 
        totalPoints: d.totalPoints ?? d.overall_points ?? 0, 
        gwPoints: d.gwPoints ?? d.event_points ?? 0, 
        overallRank: d.overallRank ?? d.overall_rank ?? 0, 
        gwRank: d.gwRank ?? d.event_rank ?? 0, 
        averagePoints: d.averagePoints ?? 0, 
        gameweek: d.gameweek ?? lastDoneGw ?? 0 
      };
      localStorage.setItem(`twf_shared_points_live_${currentFplId}`, JSON.stringify(liveStats));
      paintStats();
    } else {
      const ltSnap = await getDoc(doc(db, "liveTeams", String(currentFplId)));
      if (ltSnap.exists()) {
        const ltd = ltSnap.data() || {};
        liveStats = {
          totalPoints: ltd.totalPoints || ltd.points || 0,
          gwPoints: ltd.gwPoints || 0,
          overallRank: ltd.overallRank || 0,
          gwRank: ltd.gwRank || 0,
          averagePoints: 0,
          gameweek: ltd.gameweek || lastDoneGw || 0
        };
        localStorage.setItem(`twf_shared_points_live_${currentFplId}`, JSON.stringify(liveStats));
        paintStats();
      }
    }
  } catch (e) { 
    console.warn("Firestore livePoints query note:", e); 
  }
}

async function loadScoutHighlights() {
  scoutHighlightsData = LS.get(SCOUT_CACHE_KEY_LIVE, 10 * MIN);

  if (scoutHighlightsData) {
    renderPlayerCards();
  }

  try {
    const snap = await getDoc(doc(db, "scoutPlayers", "scoutHighlights"));
    if (snap.exists()) {
      scoutHighlightsData = snap.data();
      LS.set(SCOUT_CACHE_KEY_LIVE, scoutHighlightsData);
      renderPlayerCards();
    }
  } catch (err) {
    console.warn("Firestore scoutHighlights query note:", err);
  }
}

function renderPlayerCards() {
  const container = $("leader-cards-container");
  if (!container || !scoutHighlightsData) return;

  const M = MODES[mode] || MODES.cap;
  const currentTabColor = M.color;

  document.querySelectorAll("#leader-tabs button, .home-tabs button").forEach((b) => {
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

  if (list.length === 0) return;

  container.innerHTML = list.slice(0, 5).map((p, i) => {
    const rawPos = String(p.position || "mid").toLowerCase().trim();
    const isGk = rawPos === "gk" || rawPos === "gkp";
    const posColor = POS[rawPos] || "#F59E0B";

    const teamMeta = getTeamMeta(p.teamCode || p.team);
    const teamColor = teamMeta.color;
    const teamShort = teamMeta.short;
    const localBadgeUrl = teamMeta.badgePath;

    const photoUrl = resolvePlayerPhotoUrl(p);

    const fallbackSvg = `
      <div class="home-animated-badge-wrap" style="--tc:${teamColor}; width:44px; height:44px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
        <svg style="width:24px; height:24px;" viewBox="0 0 24 24" fill="none" stroke="${teamColor}">
          <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="12" cy="12" r="3.5" fill="${teamColor}"/>
        </svg>
        <span style="color:${teamColor}; font-size:8px; font-weight:900;">${esc(teamShort)}</span>
      </div>
    `;

    return `
      <div class="top-player-card" style="border-top: 3.2px solid ${posColor};">
        <span class="player-card-rank">${i + 1}</span>

        <div class="player-card-photo-wrap">
          <img src="${photoUrl || localBadgeUrl}" 
               alt="${esc(p.name)}" 
               loading="lazy" 
               class="player-card-photo"
               onerror="
                 if (!this.dataset.triedLocalBadge) {
                   this.dataset.triedLocalBadge = '1';
                   this.src = '${localBadgeUrl}';
                   this.style.maxHeight = '65%';
                 } else {
                   this.parentElement.innerHTML = \`${fallbackSvg.replace(/\n/g, '').replace(/"/g, "'")}\`;
                 }
               ">
          <img src="${localBadgeUrl}" alt="${esc(teamShort)}" class="player-card-club-badge" onerror="this.style.display='none';">
        </div>

        <div class="player-nameplate-frame">
          <div class="player-card-name">${esc(p.name)}</div>
          <div class="player-card-pos" style="color: ${posColor};">
            ${isGk ? "GK" : rawPos.toUpperCase()}
          </div>
          <div class="player-card-pts" style="color: ${currentTabColor} !important; text-shadow: 0 0 8px color-mix(in srgb, ${currentTabColor} 45%, transparent);">
            ${M.show(p)}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

async function loadNextFixture() {
  try {
    const meta = await loadFixturesMaster();
    if (!meta || !Array.isArray(meta.fixtures) || meta.fixtures.length === 0) return;

    const targetGw = currentGwNumber || meta.currentGameweek?.id || 1;
    let targetMatch = meta.fixtures.find(f => Number(f.event) === Number(targetGw) && !f.finished)
                   || meta.fixtures.find(f => Number(f.event) === Number(targetGw))
                   || meta.fixtures[0];

    if (!targetMatch) return;

    const homeTeam = getTeamMeta(targetMatch.team_h);
    const awayTeam = getTeamMeta(targetMatch.team_a);

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
    console.warn("Live fixture load note:", err);
  }
}

export async function initHomeTab(user, profile) {
  initDeadlineTimer();
  loadStats(user, profile);
  loadScoutHighlights();
  loadNextFixture();

  const tabsContainer = $("leader-tabs") || document.querySelector(".home-tabs");
  if (tabsContainer) {
    tabsContainer.onclick = (e) => {
      const b = e.target.closest("button[data-k]");
      if (!b) return;
      const newMode = b.dataset.k;
      if (mode !== newMode) {
        mode = newMode;
        renderPlayerCards();
      }
    };
  }
}
