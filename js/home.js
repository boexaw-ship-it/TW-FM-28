// ============================================
// Home tab: deadline countdown · stats (နောက်ဆုံးပြီးတဲ့ GW) · top players
// Source: scoutPlayers/scoutHighlights (Pre-computed Top Leaders Document)
// Read Quota: Only 1 Read with LocalStorage Cache Guard
// Standards: UI Design Knowledge Pack (Sports UI & Position Palette)
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
// 🎨 POSITION COLORS (ဆရာ့သတ်မှတ်ချက်အတိုင်း)
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
// 🔘 6 MODES (scoutHighlights payload နှင့် ချိတ်ဆက်မှု)
// ============================================
const MODES = {
  cap:  { c: "#8c6dff", key: "mostCaptained",      badge: "👑", show: (p) => `${p.totalPoints || p.gwPoints || 0} pts` },
  own:  { c: "#10b981", key: "mostOwned",          badge: "🛡️", show: (p) => `${Number(p.ownership || 0).toFixed(1)}%` },
  tin:  { c: "#06b6d4", key: "mostTransferredIn",  badge: "📈", show: (p) => `+${fmt(p.transfersInEvent || 0)}` },
  tout: { c: "#ef4444", key: "mostTransferredOut", badge: "📉", show: (p) => `-${fmt(p.transfersOutEvent || 0)}` },
  total:{ c: "#3b82f6", key: "mostTotalPoints",    badge: "🏆", show: (p) => `${p.totalPoints || 0} pts` },
  gw:   { c: "#f59e0b", key: "mostGwPoints",       badge: "⚡", show: (p) => `${p.gwPoints || 0} pts` }
};

let scoutHighlightsData = null;
let mode = "cap"; // Default ကို Most Captained ဖြင့် စတင်ပြသမည်

// ---------- Deadline + နောက်ဆုံးပြီးတဲ့ GW ----------
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

// ---------- Stats ----------
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

// =========================================================================
// 🌟 TOP PLAYERS: `scoutPlayers/scoutHighlights` မှ တိုက်ရိုက်ဖတ်ယူခြင်း
// (allPlayers ဖိုင်ကြီးကို မဖတ်တော့သဖြင့် 0 Read/Instant Load ရရှိသည်)
// =========================================================================
async function loadScoutHighlights() {
  // 15 မိနစ် Cache Guard
  scoutHighlightsData = LS.get("twfm_scout_highlights_v1", 15 * MIN);

  if (!scoutHighlightsData) {
    try {
      const snap = await getDoc(doc(db, "scoutPlayers", "scoutHighlights"));
      if (snap.exists()) {
        scoutHighlightsData = snap.data();
        LS.set("twfm_scout_highlights_v1", scoutHighlightsData);
      }
    } catch (err) {
      console.warn("scoutHighlights load note:", err);
    }
  }

  renderLeaders();
}

function renderLeaders() {
  const box = $("leader-list");
  if (!box) return;

  if (!scoutHighlightsData) {
    box.innerHTML = `<div class="home-empty">Data ရယူနေပါသည်...</div>`;
    return;
  }

  const M = MODES[mode];
  document.querySelectorAll("#leader-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.k === mode));
  box.style.setProperty("--mc", M.c);

  let list = [];

  // scoutHighlights ထဲရှိ payload အလိုက် စာရင်းခွဲထုတ်ခြင်း
  if (mode === "cap") {
    const capData = scoutHighlightsData.mostCaptained || {};
    if (capData.leader) list.push({ ...capData.leader, rankTag: "Captain" });
    if (capData.viceLeader) list.push({ ...capData.viceLeader, rankTag: "Vice-Cap" });
  } else {
    const sectionData = scoutHighlightsData[M.key] || {};
    list = sectionData.topList || (sectionData.leader ? [sectionData.leader] : []);
  }

  if (!list || list.length === 0) {
    box.innerHTML = `<div class="home-empty">Data မရရှိသေးပါ</div>`;
    return;
  }

  // Top 5 သာ ညီညာစွာ ပြသမည်
  box.innerHTML = list.slice(0, 5).map((p, i) => {
    const rawPos = String(p.position || "mid").toLowerCase().trim();
    const isGk = rawPos === "gk" || rawPos === "gkp";
    
    // 🎨 သတ်မှတ်ထားသော အရောင်သီးသန့် ယူသုံးခြင်း
    const posColor = POS[rawPos] || "#F59E0B"; 
    const tc = String(p.teamCode || "unk").toLowerCase();

    const jerseyImg = tc && tc !== "unk"
      ? `<img class="jr" src="./public/jerseys/${isGk ? "gk" : "outfield"}/${esc(tc)}.png" alt="" loading="lazy" onerror="this.outerHTML='<span class=\\'jr flex items-center justify-center text-sm\\'>👕</span>'">`
      : `<span class="jr flex items-center justify-center text-sm">👕</span>`;

    const displayRank = p.rankTag ? p.rankTag : (i + 1);

    return `
      <div class="home-row" style="--pc:${posColor}">
        <span class="rk">${displayRank}</span>
        ${jerseyImg}
        <span class="home-plate">
          <b>${esc(p.name)}</b>
          <i>${esc(tc.toUpperCase().slice(0, 3))}</i>
        </span>
        <span class="ps" style="color:${posColor}; font-weight:800;">
          ${isGk ? "GK" : rawPos.toUpperCase()}
        </span>
        <span class="vl">
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
  loadScoutHighlights(); // 🚀 scoutHighlights document မှ အသစ်စတင်ခေါ်ယူခြင်း
});
