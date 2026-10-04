// ============================================
// TW Fantasy Official League — Home UI Controller
// Path: js/home.js
// Standards: UI Design Knowledge Pack (Sports UI & 8px Grid)
// Key Fix: Fully Automated Dynamic Gameweek Deadline Engine (No Hardcoding)
// ============================================

import { db } from "./firebase-config.js";
import { doc, getDoc } from "./core/fs.js";
import { loadFixturesMaster } from "./core/data.js";

const $ = (id) => document.getElementById(id);
const MIN = 60 * 1000;

const SCOUT_CACHE_KEY_V120 = "twfm_scout_highlights_v120";
const DEADLINE_CACHE_KEY = "twfm_dynamic_deadline_v120";

// 🌟 Default Fallback Data (Offline Protection)
const DEFAULT_TOP_PLAYERS = {
  mostCaptained: {
    topList: [
      { name: "Haaland", position: "fwd", teamCode: "mci", gwPoints: 39, photoUrl: "https://resources.premierleague.com/premierleague/photos/players/250x250/p223094.png" },
      { name: "B.Fernandes", position: "mid", teamCode: "mun", gwPoints: 31, photoUrl: "https://resources.premierleague.com/premierleague/photos/players/250x250/p141746.png" },
      { name: "João Pedro", position: "fwd", teamCode: "che", gwPoints: 33, photoUrl: "https://resources.premierleague.com/premierleague/photos/players/250x250/p443003.png" },
      { name: "Rogers", position: "mid", teamCode: "avl", gwPoints: 29, photoUrl: "https://resources.premierleague.com/premierleague/photos/players/250x250/p477383.png" },
      { name: "Szoboszlai", position: "mid", teamCode: "liv", gwPoints: 20, photoUrl: "https://resources.premierleague.com/premierleague/photos/players/250x250/p244731.png" }
    ]
  }
};

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

// Global State
let deadlineTs = 0;
let currentGwNumber = 1;
let lastDone = 0;
let live = null;
let fplId = null;
let scoutHighlightsData = null;
let mode = "cap";
let timerInterval = null;

// ============================================
// 🎨 ACCURATE FPL POSITION COLORS
// ============================================
const POS = { 
  gk: "#2563EB",   // Blue
  gkp: "#2563EB",  // Blue
  def: "#EF4444",  // Red
  mid: "#F59E0B",  // Yellow
  fwd: "#22C55E"   // Green
};

// ============================================
// 🎨 6 TABS & POINTS COLOR SYNC SYSTEM
// ============================================
const MODES = {
  cap: { 
    color: "#FFFFFF", 
    key: "mostCaptained", 
    show: (p) => `${p.totalPoints || p.gwPoints || 0} pts` 
  },
  own: { 
    color: "#FBBF24", 
    key: "mostOwned", 
    show: (p) => `${Number(p.ownership || 0).toFixed(1)}%` 
  },
  tin: { 
    color: "#22C55E", 
    key: "mostTransferredIn", 
    show: (p) => `+${fmt(p.transfersInEvent || 0)}` 
  },
  tout: { 
    color: "#EF4444", 
    key: "mostTransferredOut", 
    show: (p) => `-${fmt(p.transfersOutEvent || 0)}` 
  },
  total: { 
    color: "#38BDF8", 
    key: "mostTotalPoints", 
    show: (p) => `${p.totalPoints || 0} pts` 
  },
  gw: { 
    color: "#34D399", 
    key: "mostGwPoints", 
    show: (p) => `${p.gwPoints || 0} pts` 
  }
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
  const clean = String(rawCode)
    .replace(/\.(jpg|jpeg|png)$/i, "")
    .replace(/^p/i, "")
    .trim();
  return clean ? `https://resources.premierleague.com/premierleague/photos/players/250x250/p${clean}.png` : "";
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

    if (teamNameEl) {
      teamNameEl.textContent = cleanTeam || "SEAROKER Tw";
    }
    if (managerNameEl) {
      managerNameEl.textContent = cleanManager || "zaw moe";
    }
  } catch (err) {
    console.warn("Manager frame note:", err);
  }
}

// =========================================================================
// ⏱️ DYNAMIC GAMEWEEK & DEADLINE ENGINE (AUTOMATED FOR EVERY GW)
// =========================================================================

// Epoch Timestamp ကို Milliseconds အဖြစ် တိကျစွာ ပြောင်းလဲပေးသည့် Helper
function normalizeEpochMs(epoch) {
  if (!epoch) return 0;
  const num = Number(epoch);
  if (!Number.isFinite(num) || num <= 0) return 0;
  // အကယ်၍ Seconds ဖြစ်နေပါက (10 digits) Milliseconds အဖြစ် 1000 ဖြင့် မြှောက်သည်
  return num < 10000000000 ? num * 1000 : num;
}

// ရက်စွဲစာသားအား Asia/Yangon စံတော်ချိန်ဖြင့် ပုံစံချပေးခြင်း
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

// Fixtures Master Data ထဲမှ လက်ရှိ မရောက်သေးသော အနီးစပ်ဆုံး GW Deadline ကို အလိုအလျောက် တွက်ထုတ်ခြင်း
function resolveUpcomingDeadline(meta) {
  const now = Date.now();
  if (!meta) return null;

  // ၁။ အကယ်၍ events array ပါဝင်ပါက (FPL standard events/gameweeks)
  if (Array.isArray(meta.events) && meta.events.length > 0) {
    // လက်ရှိအချိန်ထက် ကျော်လွန်နေသော အနီးဆုံး GW ကို ရှာဖွေခြင်း
    const upcoming = meta.events.find(ev => {
      const ms = normalizeEpochMs(ev.deadline_time_epoch || ev.deadlineTimeEpoch);
      return ms > now;
    });

    if (upcoming) {
      return {
        gw: Number(upcoming.id || upcoming.event),
        ts: normalizeEpochMs(upcoming.deadline_time_epoch || upcoming.deadlineTimeEpoch),
        lastDone: Math.max(0, Number(upcoming.id || upcoming.event) - 1)
      };
    }
  }

  // ၂။ currentGameweek object ဖြင့် ပေးပို့လာပါက
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
    } else if (next && nextMs > now) {
      return {
        gw: Number(next.id || (cur.id + 1)),
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

  if (gwLabelEl) {
    gwLabelEl.textContent = `GW${currentGwNumber} DEADLINE`;
  }
  if (gwWhenEl) {
    gwWhenEl.textContent = formatYangonDate(deadlineTs);
  }
}

function initDeadlineTimer() {
  // ၁။ Cache စစ်ဆေးခြင်း (၅ မိနစ်ထက် မကျော်လွန်စေရ)
  const cached = LS.get(DEADLINE_CACHE_KEY, 5 * MIN);
  if (cached && cached.ts && cached.ts > Date.now()) {
    deadlineTs = cached.ts;
    currentGwNumber = cached.gw;
    lastDone = cached.lastDone;
    updateDeadlineUI();
    tick();
  }

  // Timer Tick Interval ကို စတင်ခြင်း
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(tick, 1000);

  // ၂။ Network Master Data မှတစ်ဆင့် Gameweek အသစ်ကို Real-time Fetch & Resolve ပြုလုပ်ခြင်း
  loadFixturesMaster().then(meta => {
    if (!meta) return;

    const resolved = resolveUpcomingDeadline(meta);
    if (resolved && resolved.ts > Date.now()) {
      deadlineTs = resolved.ts;
      currentGwNumber = resolved.gw;
      lastDone = resolved.lastDone;

      LS.set(DEADLINE_CACHE_KEY, resolved);

      updateDeadlineUI();
      tick();
      paintStats(); // GW အသစ်အရ Points Display ကို ပြန်ချိန်သည်
    }
  }).catch(err => {
    console.warn("Dynamic Deadline Resolver note:", err);
  });
}

function tick() {
  const now = Date.now();
  let d = deadlineTs ? Math.max(0, deadlineTs - now) : 0;

  // အကယ်၍ Countdown 00:00:00 သို့ ရောက်သွားပါက Cache ဖျက်ပြီး နောက် GW သို့ အလိုအလျောက် ကူးပြောင်းစေခြင်း
  if (deadlineTs > 0 && d === 0) {
    localStorage.removeItem(DEADLINE_CACHE_KEY);
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
  const defaultStats = {
    totalPoints: 330,
    overallRank: 1896119,
    gwPoints: 51,
    averagePoints: 48,
    gwRank: 4209708,
    gameweek: lastDone || 5
  };

  const statSource = live || defaultStats;
  const g = Number(statSource.gameweek) || lastDone || 5;
  const gw = Number(statSource.gwPoints ?? 51);
  const avg = Number(statSource.averagePoints ?? 48);

  const t = (id, v, cls) => { 
    const e = $(id); 
    if (!e) return; 
    e.textContent = v; 
    if (cls !== undefined) e.className = cls; 
  };

  t("st-total", fmt(statSource.totalPoints));
  t("st-total-d", `▲ +${fmt(gw)} (GW${g})`, "stat-change up");
  t("st-rank", fmt(statSource.overallRank));
  t("st-rank-d", `▲ +${fmt(statSource.gwRank || 4209708)}`, "stat-change up");
  t("st-gw-l", `GW SCORE`);
  t("st-gw", fmt(gw));

  if (Number.isFinite(avg) && avg > 0) {
    const up = gw >= avg;
    t("st-gw-d", `${up ? "▲" : "▼"} avg ${fmt(avg)}`, up ? "stat-change up" : "stat-change dn");
  } else {
    t("st-gw-d", "▲ avg 48", "stat-change up");
  }
}

async function loadStats(user, profile) {
  fplId = profile?.fplTeamId || profile?.fplId || localStorage.getItem("twf_fpl_team_id") || "11651848";

  try { 
    live = JSON.parse(localStorage.getItem(`twf_shared_points_v2_${fplId}`)); 
    paintStats(); 
  } catch (_) {
    paintStats();
  }

  const fresh = LS.get(`twfm_points_${fplId}`, 5 * MIN);
  if (fresh) { 
    live = fresh; 
    paintStats(); 
    return; 
  }

  try {
    const s = await getDoc(doc(db, "livePoints", String(fplId)));
    if (s.exists()) {
      const d = s.data();
      live = { 
        totalPoints: d.totalPoints ?? 330, 
        gwPoints: d.gwPoints ?? 51, 
        overallRank: d.overallRank ?? 1896119, 
        gwRank: d.gwRank ?? 4209708, 
        averagePoints: d.averagePoints ?? 48, 
        gameweek: d.gameweek ?? lastDone 
      };
      LS.set(`twfm_points_${fplId}`, live);
      paintStats();
    } else {
      paintStats();
    }
  } catch (e) { 
    console.warn("Live points load note:", e); 
    paintStats();
  }
}

async function loadScoutHighlights() {
  scoutHighlightsData = LS.get(SCOUT_CACHE_KEY_V120, 10 * MIN);

  if (!scoutHighlightsData) {
    scoutHighlightsData = DEFAULT_TOP_PLAYERS;
  }

  renderPlayerCards();

  try {
    const snap = await getDoc(doc(db, "scoutPlayers", "scoutHighlights"));
    if (snap.exists()) {
      scoutHighlightsData = snap.data();
      LS.set(SCOUT_CACHE_KEY_V120, scoutHighlightsData);
      renderPlayerCards();
    }
  } catch (err) {
    console.warn("scoutHighlights load note:", err);
  }
}

function renderPlayerCards() {
  const container = $("leader-cards-container");
  if (!container) return;

  const M = MODES[mode] || MODES.cap;
  const currentTabColor = M.color;

  document.querySelectorAll("#leader-tabs button, .home-tabs button").forEach((b) => {
    const isCurrent = b.dataset.k === mode;
    b.classList.toggle("on", isCurrent);
  });

  let list = [];
  if (mode === "cap") {
    const capData = (scoutHighlightsData && scoutHighlightsData.mostCaptained) ? scoutHighlightsData.mostCaptained : DEFAULT_TOP_PLAYERS.mostCaptained;
    list = capData.topList || [];
    if (list.length === 0 && capData.leader) {
      list = [capData.leader];
      if (capData.viceLeader) list.push(capData.viceLeader);
    }
  } else {
    const sectionData = (scoutHighlightsData && scoutHighlightsData[M.key]) ? scoutHighlightsData[M.key] : {};
    list = sectionData.topList || (sectionData.leader ? [sectionData.leader] : DEFAULT_TOP_PLAYERS.mostCaptained.topList);
  }

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
    if (!meta) return;

    const targetGw = currentGwNumber || 1;
    let targetMatch = null;

    if (Array.isArray(meta.fixtures) && meta.fixtures.length > 0) {
      targetMatch = meta.fixtures.find(f => Number(f.event) === Number(targetGw) && !f.finished)
                 || meta.fixtures.find(f => Number(f.event) === Number(targetGw))
                 || meta.fixtures[0];
    }

    if (!targetMatch) {
      targetMatch = {
        event: targetGw,
        team_h: 1,
        team_a: 13,
        kickoff_time: new Date(deadlineTs + (90 * 60 * 1000)).toISOString()
      };
    }

    const homeTeam = getTeamMeta(targetMatch.team_h || 1);
    const awayTeam = getTeamMeta(targetMatch.team_a || 13);

    const fixtureTimeEl = $("next-fixture-time");
    if (fixtureTimeEl) {
      if (targetMatch.kickoff_time) {
        const d = new Date(targetMatch.kickoff_time);
        const timeStr = d.toLocaleDateString("en-GB", { timeZone: "Asia/Yangon", day: "numeric", month: "short", year: "numeric" }) +
          " · " + d.toLocaleTimeString("en-GB", { timeZone: "Asia/Yangon", hour: "2-digit", minute: "2-digit", hour12: false });
        fixtureTimeEl.textContent = `GW${targetMatch.event || targetGw} · ${timeStr}`;
      } else {
        fixtureTimeEl.textContent = `GW${targetMatch.event || targetGw} · ${formatYangonDate(deadlineTs)}`;
      }
    }

    const hCodeEl = $("fixture-home-code");
    const hNameEl = $("fixture-home-name");
    const hBadgeEl = $("fixture-home-badge");
    if (hCodeEl) hCodeEl.textContent = homeTeam.short;
    if (hNameEl) hNameEl.textContent = homeTeam.name;
    if (hBadgeEl) {
      hBadgeEl.src = homeTeam.badgePath;
      hBadgeEl.onerror = () => { hBadgeEl.src = "./assets/badges/ars.png"; };
    }

    const aCodeEl = $("fixture-away-code");
    const aNameEl = $("fixture-away-name");
    const aBadgeEl = $("fixture-away-badge");
    if (aCodeEl) aCodeEl.textContent = awayTeam.short;
    if (aNameEl) aNameEl.textContent = awayTeam.name;
    if (aBadgeEl) {
      aBadgeEl.src = awayTeam.badgePath;
      aBadgeEl.onerror = () => { aBadgeEl.src = "./assets/badges/lee.png"; };
    }

  } catch (err) {
    console.warn("Next fixture note:", err);
  }
}

export async function initHomeTab(user, profile) {
  decorateManagerFrame(profile);
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
