// ============================================
// TW Fantasy Official League — Home UI Controller
// Path: js/home.js
// Standards: UI Design Knowledge Pack (Sports UI & 8px Grid)
// Architecture: Bulletproof Defensive DOM Engine (Zero Script Crash)
// Targets:
//   - Safe Manager & Team Header Styling
//   - Safe Deadline Frame (No DOM Overwrite, No Route Jump)
//   - 3-Column Stats Sync (330, 1.8M, 51)
//   - Top 5 Leaders Grid (Reads Directly from scoutPlayers/scoutHighlights)
//   - 6 Quick Stats Tabs Working Smoothly
// ============================================

import { db } from "./firebase-config.js";
import { doc, getDoc } from "./core/fs.js";
import { loadFixturesMaster } from "./core/data.js";

const $ = (id) => document.getElementById(id);
const MIN = 60 * 1000;

// 💡 Version 17 Cache Key (Cache အဟောင်းများကို အလိုအလျောက် သန့်စင်စေခြင်း)
const SCOUT_CACHE_KEY_V17 = "twfm_scout_highlights_v17";

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
let currentGwNumber = 6;
let lastDone = null;
let live = null;
let fplId = null;
let scoutHighlightsData = null;
let mode = "cap"; // Default: Most Captained
let timerInterval = null;

// ============================================
// 🎨 POSITION COLORS (UI Design Knowledge Pack)
// ============================================
const POS = { 
  gk: "#2563EB", 
  gkp: "#2563EB", 
  def: "#EF4444", 
  mid: "#F59E0B", 
  fwd: "#22C55E" 
};

// ============================================
// 🛡️ TEAM DETAILS & CODE-ONLY LOCAL BADGE MAP (2026-27 Season)
// ============================================
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
    return {
      ...matched,
      badgePath: `./assets/badges/${matched.code}.png`
    };
  }
  return { id: 6, name: "Chelsea", short: "CHE", code: "che", color: "#034694", badgePath: `./assets/badges/che.png` };
}

// ============================================
// 📸 SELF-CONTAINED OFFICIAL FPL PHOTO RESOLVER
// ============================================
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

// ============================================
// 🔘 6 MODES CONFIG (Tab Color = Point Color 100% Sync)
// ============================================
const MODES = {
  cap: { color: "#8c6dff", key: "mostCaptained", show: (p) => `${p.totalPoints || p.gwPoints || 0} pts` },
  own: { color: "#38bdf8", key: "mostOwned", show: (p) => `${Number(p.ownership || 0).toFixed(1)}%` },
  tin: { color: "#22c55e", key: "mostTransferredIn", show: (p) => `+${fmt(p.transfersInEvent || 0)}` },
  tout: { color: "#ef4444", key: "mostTransferredOut", show: (p) => `-${fmt(p.transfersOutEvent || 0)}` },
  total: { color: "#fbbf24", key: "mostTotalPoints", show: (p) => `${p.totalPoints || 0} pts` },
  gw: { color: "#34d399", key: "mostGwPoints", show: (p) => `${p.gwPoints || 0} pts` }
};

// ============================================
// 👑 MANAGER & TEAM HEADER FRAME (SAFE DOM UPDATE)
// ============================================
function decorateManagerFrame(profile) {
  try {
    const teamNameEl = $("welcome-name") \vert{}\vert{} $("team-title-text");
    const managerNameEl = $("welcome-manager") \vert{}\vert{} $("manager-title-text");
    const managerCardEl = $("manager-profile-card") \vert{}\vert{} $("header-profile-box") || teamNameEl?.closest("div.rounded-2xl");

    const teamName = profile?.teamName || "SEAROKER Tw";
    const managerName = profile?.managerName || profile?.displayName || "zaw moe";

    if (teamNameEl) {
      teamNameEl.innerHTML = `<span style="font-weight:900; letter-spacing:0.02em;">${esc(teamName)}</span> <span style="filter: drop-shadow(0 0 8px rgba(251,191,36,0.6));">👑</span>`;
    }
    if (managerNameEl) {
      managerNameEl.innerHTML = `<span style="opacity:0.75; font-size:11px;">Manager:</span> <span style="color:#e2e8f0; font-weight:700;">${esc(managerName)}</span>`;
    }

    if (managerCardEl) {
      managerCardEl.style.background = "linear-gradient(135deg, rgba(20, 23, 43, 0.95), rgba(15, 17, 33, 0.98))";
      managerCardEl.style.border = "1px solid rgba(140, 109, 255, 0.35)";
      managerCardEl.style.borderRadius = "18px";
      managerCardEl.style.boxShadow = "0 10px 25px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.1)";
    }
  } catch (err) {
    console.warn("Manager frame decorate note:", err);
  }
}

// ============================================
// ⏳ DEADLINE COUNTDOWN FRAME ENGINE (SAFE TICK)
// ============================================
async function loadDeadline() {
  let info = LS.get("twfm_deadline_v17", 10 * MIN);
  if (!info || (info.ts && info.ts < Date.now())) {
    try {
      const m = await loadFixturesMaster();
      const cur = m.currentGameweek;
      if (cur) {
        const next = cur.nextGw;
        const target = next && next.deadlineTimeEpoch > Date.now() ? next
          : cur.deadlineTimeEpoch > Date.now() ? { id: cur.id, deadlineTimeEpoch: cur.deadlineTimeEpoch }
          : null;
        const targetGwId = target ? target.id : (cur.id || 6);
        const lastDoneGw = cur.isFinished ? cur.id : (cur.status === "upcoming" || cur.status === "pre_season" ? 0 : Math.max(0, cur.id - 1));
        info = { gw: targetGwId, ts: target ? target.deadlineTimeEpoch : 0, lastDone: lastDoneGw };
      } else {
        info = { gw: 6, ts: 0, lastDone: null };
      }
      LS.set("twfm_deadline_v17", info);
    } catch (e) { 
      console.warn("Deadline load note:", e); 
      info = info || { gw: 6, ts: 0, lastDone: null }; 
    }
  }

  deadlineTs = info.ts || 0;
  currentGwNumber = info.gw || 6;
  lastDone = info.lastDone ?? null;

  // Safe update for Deadline labels without destroying existing HTML
  if ($("gw-label")) $("gw-label").textContent = `GW${currentGwNumber} DEADLINE`;
  if ($("gw-when") && info.ts) {
    $("gw-when").textContent = new Date(info.ts).toLocaleString("en-GB", { 
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

  // 💡 Hero card ပေါ်တွင် fixtures သို့ အလိုအလျောက် ခုန်မသွားစေရန် Click ဖယ်ရှားခြင်း
  const heroCard = $("hero-deadline-card");
  if (heroCard) {
    heroCard.onclick = null;
    heroCard.style.cursor = "default";
  }

  tick();
  paintStats();
}

function tick() {
  let d = deadlineTs ? Math.max(0, deadlineTs - Date.now()) : 0;
  const days = Math.floor(d / 864e5); d -= days * 864e5;
  const h = Math.floor(d / 36e5); d -= h * 36e5;
  const m = Math.floor(d / 6e4); d -= m * 6e4;
  const s = Math.floor(d / 1e3);

  // Safe setter (element ရှိမှသာ update လုပ်မည် - crash မဖြစ်စေပါ)
  const set = (id, v) => { 
    const e = $(id); 
    if (e && e.textContent !== v) e.textContent = v; 
  };
  set("cd-d", pad(days)); 
  set("cd-h", pad(h)); 
  set("cd-m", pad(m)); 
  set("cd-s", pad(s));
}

// ============================================
// 📊 PERFORMANCE STATS ENGINE (SAFE DOM)
// ============================================
function paintStats() {
  if (!live) return;
  const g = Number(live.gameweek) || 0;
  const finished = lastDone === null || (g > 0 && g <= lastDone);
  const key = `twfm_lastdone_${fplId}`;
  let shown = { gw: g, gwPoints: live.gwPoints, averagePoints: live.averagePoints, gwRank: live.gwRank };
  let isLive = false;

  if (finished) {
    try { localStorage.setItem(key, JSON.stringify(shown)); } catch (_) {}
  } else {
    let snap = null;
    try { snap = JSON.parse(localStorage.getItem(key)); } catch (_) {}
    if (snap && snap.gw) shown = snap; else isLive = true;
  }

  const gw = Number(shown.gwPoints ?? 0), avg = Number(shown.averagePoints);
  const t = (id, v, cls) => { 
    const e = $(id); 
    if (!e) return; 
    e.textContent = v; 
    if (cls !== undefined) e.className = cls; 
  };

  t("st-total", fmt(live.totalPoints));
  t("st-total-d", shown.gw ? `▲ +${fmt(gw)} (GW${shown.gw})` : "", "up");
  t("st-rank", fmt(live.overallRank));
  t("st-rank-d", shown.gwRank ? `▲ +${fmt(shown.gwRank)}` : "", "up");
  t("st-gw-l", `GW${currentGwNumber - 1 || shown.gw || 5} Score${isLive ? " · LIVE" : ""}`);
  t("st-gw", fmt(gw));

  if (Number.isFinite(avg) && avg > 0) {
    const up = gw >= avg;
    t("st-gw-d", `${up ? "▲" : "▼"} avg ${fmt(avg)}`, up ? "up" : "dn");
  } else {
    t("st-gw-d", isLive ? "in progress" : "", "mu");
  }
}

async function loadStats() {
  if (!fplId) return;
  try { 
    live = JSON.parse(localStorage.getItem(`twf_shared_points_v2_${fplId}`)); 
    paintStats(); 
  } catch (_) {}

  const fresh = LS.get(`twfm_points_${fplId}`, 5 * MIN);
  if (fresh) { live = fresh; paintStats(); return; }

  try {
    const s = await getDoc(doc(db, "livePoints", String(fplId)));
    if (s.exists()) {
      const d = s.data();
      live = { 
        totalPoints: d.totalPoints, 
        gwPoints: d.gwPoints, 
        overallRank: d.overallRank, 
        gwRank: d.gwRank, 
        averagePoints: d.averagePoints, 
        gameweek: d.gameweek 
      };
      LS.set(`twfm_points_${fplId}`, live);
      paintStats();
    }
  } catch (e) { 
    console.warn("Live points load note:", e); 
  }
}

// ============================================
// 🌟 TOP 5 PLAYERS CARD GRID RENDERER (FIRESTORE HIGHLIGHTS)
// ============================================
async function loadScoutHighlights() {
  scoutHighlightsData = LS.get(SCOUT_CACHE_KEY_V17, 15 * MIN);

  if (!scoutHighlightsData) {
    try {
      const snap = await getDoc(doc(db, "scoutPlayers", "scoutHighlights"));
      if (snap.exists()) {
        scoutHighlightsData = snap.data();
        LS.set(SCOUT_CACHE_KEY_V17, scoutHighlightsData);
      }
    } catch (err) {
      console.warn("scoutHighlights load note:", err);
    }
  }

  renderPlayerCards();
}

function renderPlayerCards() {
  const container = $("leader-cards-container");
  if (!container) return;

  if (!scoutHighlightsData) {
    container.innerHTML = `
      <div class="player-card-skel"></div>
      <div class="player-card-skel"></div>
      <div class="player-card-skel"></div>
      <div class="player-card-skel"></div>
      <div class="player-card-skel"></div>
    `;
    return;
  }

  const M = MODES[mode];
  const activeColor = M.color;

  // Active Tab Highlight State
  document.querySelectorAll("#leader-tabs button").forEach((b) => {
    const isActive = b.dataset.k === mode;
    b.classList.toggle("on", isActive);
    if (isActive) {
      b.style.setProperty("--c", activeColor);
      b.style.backgroundColor = activeColor;
      b.style.color = "#FFFFFF";
      b.style.boxShadow = `0 4px 14px color-mix(in srgb, ${activeColor} 40%, transparent)`;
    } else {
      b.style.backgroundColor = "";
      b.style.color = "";
      b.style.boxShadow = "";
    }
  });

  let list = [];
  if (mode === "cap") {
    const capData = scoutHighlightsData.mostCaptained || {};
    list = capData.topList || [];
    if (list.length === 0 && capData.leader) {
      list = [capData.leader];
      if (capData.viceLeader) list.push(capData.viceLeader);
    }
  } else {
    const sectionData = scoutHighlightsData[M.key] || {};
    list = sectionData.topList || (sectionData.leader ? [sectionData.leader] : []);
  }

  if (!list || list.length === 0) {
    container.innerHTML = `<div class="col-span-full py-8 text-center text-xs text-slate-400 font-bold">Data မရရှိသေးပါ</div>`;
    return;
  }

  // 💡 ထိပ်တန်းကစားသမား (၅) ဦး Card Grid Render ပြုလုပ်ခြင်း
  container.innerHTML = list.slice(0, 5).map((p, i) => {
    const rawPos = String(p.position || "mid").toLowerCase().trim();
    const isGk = rawPos === "gk" || rawPos === "gkp";
    const posColor = POS[rawPos] || "#F59E0B";

    const teamMeta = getTeamMeta(p.teamCode || p.team);
    const teamColor = teamMeta.color;
    const teamShort = teamMeta.short;
    const localBadgeUrl = teamMeta.badgePath;

    // 📸 Safe Photo URL (Firestore photoUrl မှ တိုက်ရိုက်ယူသည်)
    const directPhotoUrl = resolvePlayerPhotoUrl(p);

    const fallbackSvg = `
      <div class="home-animated-badge-wrap" style="--tc:${teamColor}; width:68px; height:68px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
        <svg class="badge-pulse-svg" style="width:34px; height:34px;" viewBox="0 0 24 24" fill="none" stroke="${teamColor}">
          <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="12" cy="12" r="3.5" fill="${teamColor}"/>
        </svg>
        <span class="badge-code-text" style="color:${teamColor}; font-size:10px; font-weight:900;">${esc(teamShort)}</span>
      </div>
    `;

    return `
      <div class="top-player-card" style="border-top: 3.5px solid ${posColor};">
        <span class="player-card-rank">${i + 1}</span>

        <div class="player-card-photo-wrap">
          <img src="${directPhotoUrl || localBadgeUrl}" 
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
          <!-- 💡 Chelsea FC Overlay Badge -->
          <img src="${localBadgeUrl}" alt="${esc(teamShort)}" class="player-card-club-badge" onerror="this.style.display='none';">
        </div>

        <div class="player-card-name">${esc(p.name)}</div>
        <div class="player-card-pos" style="color: ${posColor}; font-weight:800;">
          ${isGk ? "GK" : rawPos.toUpperCase()}
        </div>
        
        <div class="player-card-pts" style="color: ${activeColor} !important; text-shadow: 0 0 10px color-mix(in srgb, ${activeColor} 30%, transparent);">
          ${M.show(p)}
        </div>
      </div>
    `;
  }).join("");
}

// ============================================
// 🗓 NEXT FIXTURE MATCH RENDERER
// ============================================
async function loadNextFixture() {
  try {
    const meta = await loadFixturesMaster();
    if (!meta) return;

    const targetGw = currentGwNumber || 6;
    let targetMatch = null;

    if (Array.isArray(meta.fixtures) && meta.fixtures.length > 0) {
      targetMatch = meta.fixtures.find(f => Number(f.event) === Number(targetGw) && !f.finished)
                 || meta.fixtures.find(f => Number(f.event) === Number(targetGw))
                 || meta.fixtures[0];
    }

    if (!targetMatch) {
      targetMatch = {
        event: targetGw,
        team_h: 1,  // Arsenal (ars.png)
        team_a: 13, // Leeds United (lee.png)
        kickoff_time: "2026-10-10T12:30:00Z"
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
        fixtureTimeEl.textContent = `GW${targetMatch.event || targetGw} · 10 Oct 2026 · 19:00`;
      }
    }

    const hCodeEl = $("fixture-home-code");
    const hNameEl = $("fixture-home-name");
    const hBadgeEl = $("fixture-home-badge");
    if (hCodeEl) hCodeEl.textContent = homeTeam.short;
    if (hNameEl) hNameEl.textContent = homeTeam.name;
    if (hBadgeEl) {
      hBadgeEl.src = homeTeam.badgePath;
      hBadgeEl.alt = homeTeam.short;
      hBadgeEl.onerror = () => { hBadgeEl.src = "./assets/badges/ars.png"; };
    }

    const aCodeEl = $("fixture-away-code");
    const aNameEl = $("fixture-away-name");
    const aBadgeEl = $("fixture-away-badge");
    if (aCodeEl) aCodeEl.textContent = awayTeam.short;
    if (aNameEl) aNameEl.textContent = awayTeam.name;
    if (aBadgeEl) {
      aBadgeEl.src = awayTeam.badgePath;
      aBadgeEl.alt = awayTeam.short;
      aBadgeEl.onerror = () => { aBadgeEl.src = "./assets/badges/lee.png"; };
    }

  } catch (err) {
    console.warn("Next fixture loader note:", err);
  }
}

// ============================================
// 🚀 EXPORT INITIALIZER (GUARDED PIPELINE)
// ============================================
export async function initHomeTab(user, profile) {
  if (profile?.fplTeamId) {
    fplId = String(profile.fplTeamId);
  }

  // ၁။ Manager Frame
  decorateManagerFrame(profile);

  // ၂။ Deadline Frame
  await loadDeadline();

  // ၃။ Stats Loading (330, 1.8M, 51)
  loadStats();

  // ၄။ Top 5 Player Cards (Most Captained etc.)
  await loadScoutHighlights();

  // ၅။ Next Fixture Card
  await loadNextFixture();

  // ၆။ Timer Interval
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(tick, 1000);

  // ၇။ Tab Switching Listener (Most Captain, Ownership, Transfers In/Out, Total/GW Points)
  const tabsContainer = $("leader-tabs");
  if (tabsContainer) {
    // Event listener အဟောင်းများ ထပ်မနေစေရန် cloneNode မသုံးဘဲ clean delegate လုပ်ခြင်း
    tabsContainer.onclick = (e) => {
      const b = e.target.closest("button[data-k]");
      if (!b) return;
      mode = b.dataset.k;
      renderPlayerCards();
    };
  }
}
