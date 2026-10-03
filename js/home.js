// ============================================
// Home tab: deadline countdown · stats (နောက်ဆုံးပြီးတဲ့ GW) · top players
// Source: scoutPlayers/scoutHighlights (Pre-computed Top Leaders Document)
// Visual Engine: Local Assets Badge -> Animated SVG (Team Branded Color Match)
// Feature: Active Tab Color & Metric Points Color 100% Synced (တူညီသောအရောင် စနစ်)
// Standards: UI Design Knowledge Pack (Sports UI & Position Palette)
// Path: js/home.js
// ============================================

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "./core/auth.js";
import { doc, getDoc } from "./core/fs.js";
import { loadFixturesMaster } from "./core/data.js";

const $ = (id) => document.getElementById(id);
const MIN = 60 * 1000;

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

let deadlineTs = 0;   // နောက် deadline (ms)
let lastDone = null;  // နောက်ဆုံး ပြီးဆုံးသွားတဲ့ GW
let live = null;      // livePoints doc
let fplId = null;

// ============================================
// 🎨 POSITION COLORS (ဆရာ့သတ်မှတ်ချက်အတိုင်း သီးသန့်အရောင်)
// GK = အပြာ (#2563EB) | DEF = အနီ (#EF4444) | MID = အဝါ (#F59E0B) | FWD = အစိမ်း (#22C55E)
// ============================================
const POS = { 
  gk: "#2563EB",   // 🧤 GK အပြာ (Primary Blue)
  gkp: "#2563EB", 
  def: "#EF4444",  // 🛡️ DEF အနီ (Vivid Red)
  mid: "#F59E0B",  // ⚡ MID အဝါ (Golden Amber)
  fwd: "#22C55E"   // ⚽ FWD အစိမ်း (Emerald Green)
};

// ============================================
// 🛡️ TEAM DETAILS & COLOR PALETTE MAP (အသင်း ၂၀ တရားဝင်အရောင်များ)
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
  TEAM_LOOKUP[meta.code.toLowerCase()] = { id, ...meta };
  TEAM_LOOKUP[meta.short.toLowerCase()] = { id, ...meta };
  TEAM_LOOKUP[meta.name.toLowerCase()] = { id, ...meta };
});

function getTeamMeta(teamIdentifier) {
  if (!teamIdentifier) {
    return { id: 1, short: "UNK", code: "unk", color: "#8C6DFF", badgePath: "./assets/badges/1.ars.png" };
  }
  const clean = String(teamIdentifier).trim().toLowerCase();
  const matched = TEAM_LOOKUP[clean];
  if (matched) {
    return {
      ...matched,
      badgePath: `./assets/badges/${matched.id}.${matched.code}.png`
    };
  }
  return { id: 1, short: clean.slice(0, 3).toUpperCase(), code: clean, color: "#8C6DFF", badgePath: `./assets/badges/1.ars.png` };
}

// ============================================
// 🔘 6 MODES (💡 Tab အရောင် နှင့် Point အရောင် ၁၀၀% တူညီစေရန် သတ်မှတ်ထားသည်)
// ============================================
const MODES = {
  cap: { 
    color: "#8c6dff",      // 👑 Most Captain: ခရမ်းရောင် (Tab ရော Point ပါ တူညီသည်)
    key: "mostCaptained", 
    badge: "👑", 
    show: (p) => `${p.totalPoints || p.gwPoints || 0} pts` 
  },
  own: { 
    color: "#38bdf8",      // 🛡️ Ownership: Cyan/Sky Blue (Tab ရော Point ပါ တူညီသည်)
    key: "mostOwned", 
    badge: "🛡️", 
    show: (p) => `${Number(p.ownership || 0).toFixed(1)}%` 
  },
  tin: { 
    color: "#22c55e",      // 📈 Transfer In: အစိမ်းရောင် (Tab ရော Point ပါ တူညီသည်)
    key: "mostTransferredIn", 
    badge: "📈", 
    show: (p) => `+${fmt(p.transfersInEvent || 0)}` 
  },
  tout: { 
    color: "#ef4444",      // 📉 Transfer Out: အနီရောင် (Tab ရော Point ပါ တူညီသည်)
    key: "mostTransferredOut", 
    badge: "📉", 
    show: (p) => `-${fmt(p.transfersOutEvent || 0)}` 
  },
  total: { 
    color: "#fbbf24",      // 🏆 Total Points: ရွှေဝါရောင် Gold (Tab ရော Point ပါ တူညီသည်)
    key: "mostTotalPoints", 
    badge: "🏆", 
    show: (p) => `${p.totalPoints || 0} pts` 
  },
  gw: { 
    color: "#34d399",      // ⚡ Week Point: စိမ်းပြာရောင် Mint (Tab ရော Point ပါ တူညီသည်)
    key: "mostGwPoints", 
    badge: "⚡", 
    show: (p) => `${p.gwPoints || 0} pts` 
  }
};

let scoutHighlightsData = null;
let mode = "cap"; // Default: Most Captained

// ---------- Deadline + Stats ----------
async function loadDeadline() {
  let info = LS.get("twfm_deadline_v3", 10 * MIN);
  if (!info || (info.ts && info.ts < Date.now())) {
    try {
      const m = await loadFixturesMaster();
      const cur = m.currentGameweek;
      if (cur) {
        const next = cur.nextGw;
        const target = next && next.deadlineTimeEpoch > Date.now() ? next
          : cur.deadlineTimeEpoch > Date.now() ? { id: cur.id, deadlineTimeEpoch: cur.deadlineTimeEpoch }
          : null;
        const lastDoneGw = cur.isFinished ? cur.id : (cur.status === "upcoming" || cur.status === "pre_season" ? 0 : Math.max(0, cur.id - 1));
        info = { gw: target ? target.id : 0, ts: target ? target.deadlineTimeEpoch : 0, lastDone: lastDoneGw };
      } else info = { gw: 0, ts: 0, lastDone: null };
      LS.set("twfm_deadline_v3", info);
    } catch (e) { 
      console.warn("deadline load failed", e); 
      info = info || { gw: 0, ts: 0, lastDone: null }; 
    }
  }

  deadlineTs = info.ts || 0;
  lastDone = info.lastDone ?? null;

  if ($("gw-label")) $("gw-label").textContent = info.gw ? `GW${info.gw} DEADLINE` : "NO DEADLINE";
  if ($("gw-when") && info.ts) {
    $("gw-when").textContent = new Date(info.ts).toLocaleString("en-GB", { 
      timeZone: "Asia/Yangon", 
      weekday: "short", 
      day: "numeric", 
      month: "short", 
      hour: "2-digit", 
      minute: "2-digit", 
      hour12: false 
    }) + " MMT";
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
  const set = (id, v) => { const e = $(id); if (e && e.textContent !== v) e.textContent = v; };
  set("cd-d", pad(days)); set("cd-h", pad(h)); set("cd-m", pad(m)); set("cd-s", pad(s));
}
setInterval(tick, 1000);

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
  const t = (id, v, cls) => { const e = $(id); if (!e) return; e.textContent = v; if (cls !== undefined) e.className = cls; };

  t("st-total", fmt(live.totalPoints));
  t("st-total-d", shown.gw ? `▲ +${fmt(gw)} in GW${shown.gw}` : "", "up");
  t("st-rank", fmt(live.overallRank));
  t("st-rank-d", shown.gwRank ? `GW${shown.gw} rank ${fmt(shown.gwRank)}` : "", "mu");
  t("st-gw-l", `${shown.gw ? "GW" + shown.gw : "GW"} score${isLive ? " · LIVE" : ""}`);
  t("st-gw", fmt(gw));

  if (Number.isFinite(avg) && avg > 0) {
    const up = gw >= avg;
    t("st-gw-d", `${up ? "▲" : "▼"} avg ${fmt(avg)}`, up ? "up" : "dn");
  } else t("st-gw-d", isLive ? "in progress" : "", "mu");
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
  } catch (e) { console.warn("points load failed", e); }
}

async function loadScoutHighlights() {
  scoutHighlightsData = LS.get("twfm_scout_highlights_v3", 15 * MIN);

  if (!scoutHighlightsData) {
    try {
      const snap = await getDoc(doc(db, "scoutPlayers", "scoutHighlights"));
      if (snap.exists()) {
        scoutHighlightsData = snap.data();
        LS.set("twfm_scout_highlights_v3", scoutHighlightsData);
      }
    } catch (err) {
      console.warn("scoutHighlights load note:", err);
    }
  }

  renderLeaders();
}

/**
 * 🌟 Smart Avatar Generator:
 * 1. Local Badge (assets/badges/{teamId}.{code}.png)
 * 2. Fallback: Animated Pulse SVG Logo (အသင်းအရောင်အတိုင်း တူညီစွာ တောက်ပသည်)
 */
function buildSmartMediaAvatar(teamMeta) {
  const teamColor = teamMeta.color;
  const teamCode = teamMeta.short;
  const localBadgeUrl = teamMeta.badgePath;

  const animatedSvgLogo = `
    <div class="home-animated-badge-wrap" style="--tc:${teamColor}">
      <svg class="badge-pulse-svg" viewBox="0 0 24 24" fill="none" stroke="${teamColor}">
        <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="12" cy="12" r="3.5" fill="${teamColor}"/>
      </svg>
      <span class="badge-code-text" style="color:${teamColor}">${esc(teamCode)}</span>
    </div>
  `;

  return `
    <div class="home-player-avatar" style="border-color:${teamColor}; box-shadow: 0 0 8px color-mix(in srgb, ${teamColor} 30%, transparent);">
      <img src="${localBadgeUrl}" 
           alt="${esc(teamCode)}" 
           loading="lazy" 
           class="avatar-img is-badge"
           onerror="this.parentElement.outerHTML = \`${animatedSvgLogo.replace(/\n/g, '').replace(/"/g, "'")}\`;">
    </div>
  `;
}

function renderLeaders() {
  const box = $("leader-list");
  if (!box) return;

  if (!scoutHighlightsData) {
    box.innerHTML = `<div class="home-empty">Data ရယူနေပါသည်...</div>`;
    return;
  }

  const M = MODES[mode];
  const activeColor = M.color;

  // 💡 Active Tab Button Highlight (Style နှင့် Class အား တူညီသော အရောင်သတ်မှတ်ခြင်း)
  document.querySelectorAll("#leader-tabs button").forEach((b) => {
    const isActive = b.dataset.k === mode;
    b.classList.toggle("on", isActive);
    if (isActive) {
      b.style.setProperty("--c", activeColor);
      b.style.backgroundColor = activeColor;
      b.style.color = "#FFFFFF";
      b.style.boxShadow = `0 4px 14px color-mix(in srgb, ${activeColor} 45%, transparent)`;
    } else {
      b.style.backgroundColor = "";
      b.style.color = "";
      b.style.boxShadow = "";
    }
  });

  box.style.setProperty("--mc", activeColor);

  let list = [];

  if (mode === "cap") {
    const capData = scoutHighlightsData.mostCaptained || {};
    list = capData.topList || [];
    if (list.length === 0) {
      if (capData.leader) list.push({ ...capData.leader, captainRankTag: "Captain" });
      if (capData.viceLeader) list.push({ ...capData.viceLeader, captainRankTag: "Vice-Cap" });
    }
  } else {
    const sectionData = scoutHighlightsData[M.key] || {};
    list = sectionData.topList || (sectionData.leader ? [sectionData.leader] : []);
  }

  if (!list || list.length === 0) {
    box.innerHTML = `<div class="home-empty">Data မရရှိသေးပါ</div>`;
    return;
  }

  // ၅ ယောက်တိတိ အပြည့်အဝ Render ပြုလုပ်ခြင်း
  box.innerHTML = list.slice(0, 5).map((p, i) => {
    const rawPos = String(p.position || "mid").toLowerCase().trim();
    const isGk = rawPos === "gk" || rawPos === "gkp";
    
    // 🎨 ၁။ Position သီးသန့် အရောင် (GK=Blue, DEF=Red, MID=Yellow, FWD=Green)
    const posColor = POS[rawPos] || "#F59E0B"; 

    // 🛡️ ၂။ Team သီးသန့် အရောင် (Logo & Team Name အတွက် သီးသန့်သုံးမည်)
    const teamMeta = getTeamMeta(p.teamCode || p.team);
    const teamColor = teamMeta.color;
    const teamShort = teamMeta.short;

    // 💡 Avatar Pipeline (Local Badge -> Animated SVG)
    const mediaHtml = buildSmartMediaAvatar(teamMeta);

    // Rank တံဆိပ် (C, V, 3, 4, 5)
    let displayRank = i + 1;
    if (mode === "cap") {
      if (i === 0) displayRank = "C";
      else if (i === 1) displayRank = "V";
      else displayRank = i + 1;
    }

    return `
      <div class="home-row" style="--pc:${posColor}; --tc:${teamColor}; --val-col:${activeColor}">
        <span class="rk">${displayRank}</span>
        ${mediaHtml}
        <div class="home-plate" style="border-left-color: ${posColor};">
          <b>${esc(p.name)}</b>
          <!-- 💡 Team Name ကို Logo နှင့် တူညီသော အသင်းအရောင် သီးသန့် ထားရှိခြင်း -->
          <i style="color: ${teamColor} !important; border-color: color-mix(in srgb, ${teamColor} 40%, transparent);">${esc(teamShort)}</i>
        </div>
        <!-- 💡 Position Tag ကို GK/DEF/MID/FWD သီးသန့် အရောင် ထားရှိခြင်း -->
        <span class="ps" style="color: ${posColor}; font-weight: 800;">
          ${isGk ? "GK" : rawPos.toUpperCase()}
        </span>
        <!-- 💡 Tabs နှင့် Point အရောင် ၁၀၀% တူညီစွာ ဖော်ပြခြင်း (activeColor) -->
        <span class="vl" style="color: ${activeColor} !important; text-shadow: 0 0 10px color-mix(in srgb, ${activeColor} 30%, transparent);">
          ${M.show(p)}
        </span>
      </div>
    `;
  }).join("");
}

// 6 Tabs Click Event Listener
$("leader-tabs")?.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-k]");
  if (!b) return;
  mode = b.dataset.k;
  renderLeaders();
});

// ---------- Boot Controller ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  try { 
    fplId = JSON.parse(localStorage.getItem(`twf_user_profile_${user.uid}`))?.fplTeamId; 
  } catch (_) {}

  if (!fplId) {
    try { 
      fplId = (await getDoc(doc(db, "users", user.uid))).data()?.fplTeamId; 
    } catch (_) {}
  }

  loadStats();
  loadDeadline();
  loadScoutHighlights();
});
