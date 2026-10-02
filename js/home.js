// ============================================
// Home tab: deadline countdown · stats (နောက်ဆုံးပြီးတဲ့ GW) · top players
// Firestore read: livePoints 1 + fixturesMeta 1 + scoutPlayers/allPlayers 1 (LS cache နဲ့ ထပ်သက်သာ)
// ============================================
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "./core/auth.js";
import { doc, getDoc } from "./core/fs.js";
import { loadFixturesMaster, loadScoutMaster } from "./core/data.js";

const $ = (id) => document.getElementById(id);
const MIN = 60 * 1000;
const LS = {
  get(k, ttl) { try { const o = JSON.parse(localStorage.getItem(k)); if (o && Date.now() - o.t < ttl) return o.v; } catch (_) {} return null; },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); } catch (_) {} },
};
const fmt = (n) => (Number.isFinite(+n) && n !== null && n !== undefined && n !== "" ? Number(n).toLocaleString("en-US") : "–");
const pad = (n) => String(Math.max(0, n)).padStart(2, "0");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let deadlineTs = 0;   // နောက် deadline (ms)
let lastDone = null;  // နောက်ဆုံး ပြီးဆုံးသွားတဲ့ GW (fixtures အားလုံး finished)
let live = null;      // livePoints doc
let fplId = null;

// ---------- Deadline + နောက်ဆုံးပြီးတဲ့ GW ----------
// fixturesMeta/allFixtures.currentGameweek (sync script က FPL events ကနေ တွက်ပေး) — read 1 ခုပဲ
async function loadDeadline() {
  let info = LS.get("twfm_deadline_v3", 10 * MIN);
  if (!info || (info.ts && info.ts < Date.now())) {
    try {
      const m = await loadFixturesMaster();
      const cur = m.currentGameweek;
      if (cur) {
        const next = cur.nextGw;
        // deadline ကျော်ပြီးသား current ကို မပြဘဲ နောက် deadline ကိုပြ
        const target = next && next.deadlineTimeEpoch > Date.now() ? next
          : cur.deadlineTimeEpoch > Date.now() ? { id: cur.id, deadlineTimeEpoch: cur.deadlineTimeEpoch }
          : null;
        const lastDoneGw = cur.isFinished ? cur.id : (cur.status === "upcoming" || cur.status === "pre_season" ? 0 : Math.max(0, cur.id - 1));
        info = { gw: target ? target.id : 0, ts: target ? target.deadlineTimeEpoch : 0, lastDone: lastDoneGw };
      } else info = { gw: 0, ts: 0, lastDone: null };
      LS.set("twfm_deadline_v3", info);
    } catch (e) { console.warn("deadline load failed", e); info = info || { gw: 0, ts: 0, lastDone: null }; }
  }
  deadlineTs = info.ts || 0;
  lastDone = info.lastDone ?? null;
  if ($("gw-label")) $("gw-label").textContent = info.gw ? `GW${info.gw} DEADLINE` : "NO DEADLINE";
  if ($("gw-when") && info.ts) {
    $("gw-when").textContent = new Date(info.ts).toLocaleString("en-GB", { timeZone: "Asia/Yangon", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) + " MMT";
  }
  tick();
  paintStats(); // lastDone သိပြီ → stats ပြန်တွက်
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
setInterval(tick, 1000); // scope က page ထွက်ရင် auto clear

// ---------- Stats ----------
// GW score card = "နောက်ဆုံးပြီးတဲ့ GW" ကိုပဲ ပြ (live GW ဆိုရင် ပြီးခဲ့တဲ့ GW snapshot ကိုပြ၊ မရှိမှ LIVE နဲ့ပြ)
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
  try { live = JSON.parse(localStorage.getItem(`twf_shared_points_v2_${fplId}`)); paintStats(); } catch (_) {}
  const fresh = LS.get(`twfm_points_${fplId}`, 5 * MIN);
  if (fresh) { live = fresh; paintStats(); return; }
  try {
    const s = await getDoc(doc(db, "livePoints", String(fplId)));
    if (s.exists()) {
      const d = s.data();
      live = { totalPoints: d.totalPoints, gwPoints: d.gwPoints, overallRank: d.overallRank, gwRank: d.gwRank, averagePoints: d.averagePoints, gameweek: d.gameweek };
      LS.set(`twfm_points_${fplId}`, live);
      paintStats();
    }
  } catch (e) { console.warn("points load failed", e); }
}

// ---------- Top players ----------
const POS = { gk: "#22c55e", gkp: "#22c55e", def: "#3b82f6", mid: "#8c6dff", fwd: "#ef4444" };
const MODES = {
  gw:    { c: "#8c6dff", sort: (p) => p.gwPoints,    show: (p) => `${p.gwPoints} pts` },
  total: { c: "#3b82f6", sort: (p) => p.totalPoints, show: (p) => `${p.totalPoints} pts` },
  form:  { c: "#f59e0b", sort: (p) => p.form,        show: (p) => Number(p.form).toFixed(1) },
  own:   { c: "#10b981", sort: (p) => p.ownership,   show: (p) => `${Number(p.ownership).toFixed(1)}%` },
};
let players = null, mode = "gw";

async function loadPlayers() {
  players = LS.get("twfm_leaders_v3", 30 * MIN);
  if (!players) {
    try {
      const m = await loadScoutMaster(); // doc 1 ခု (players ~700 ကို doc တစ်ခုထဲက)
      players = m.players.map((x) => ({
        name: x.name || x.fullName || "?", pos: String(x.position || "").toLowerCase().trim(), tc: String(x.teamCode || "").toLowerCase().trim(),
        gwPoints: +x.gwPoints || 0, totalPoints: +x.totalPoints || 0, form: +x.form || 0, ownership: +x.ownership || 0,
      }))
        // LS ကြီးမသွားအောင် tab တစ်ခုချင်း top 8 ပဲသိမ်း
        .filter((p, _, all) => true);
      const keep = new Set();
      ["gwPoints", "totalPoints", "form", "ownership"].forEach((k) => [...players].sort((a, b) => b[k] - a[k]).slice(0, 8).forEach((p) => keep.add(p)));
      players = [...keep];
      LS.set("twfm_leaders_v3", players);
    } catch (e) { console.warn("players load failed", e); players = []; }
  }
  renderLeaders();
}
function renderLeaders() {
  const box = $("leader-list");
  if (!box || !players) return;
  const M = MODES[mode];
  document.querySelectorAll("#leader-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.k === mode));
  box.style.setProperty("--mc", M.c);
  const top = [...players].sort((a, b) => M.sort(b) - M.sort(a)).slice(0, 5).filter((p) => M.sort(p) > 0);
  box.innerHTML = top.length
    ? top.map((p, i) => {
        const isGk = p.pos === "gk" || p.pos === "gkp";
        const col = POS[p.pos] || "#8b90b3";
        const img = p.tc ? `<img class="jr" src="./public/jerseys/${isGk ? "gk" : "outfield"}/${esc(p.tc)}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="jr"></span>`;
        return `<div class="home-row" style="--pc:${col}"><span class="rk">${i + 1}</span>${img}<span class="home-plate"><b>${esc(p.name)}</b><i>${esc(p.tc.toUpperCase().slice(0, 3))}</i></span><span class="ps">${isGk ? "GK" : p.pos.toUpperCase()}</span><span class="vl">${M.show(p)}</span></div>`;
      }).join("")
    : `<div class="home-empty">Data မရသေးပါ</div>`;
}
$("leader-tabs")?.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-k]");
  if (!b) return;
  mode = b.dataset.k;
  renderLeaders();
});

// ---------- boot ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) return; // dashboard.js က login ပို့ပေးမယ်
  try { fplId = JSON.parse(localStorage.getItem(`twf_user_profile_${user.uid}`))?.fplTeamId; } catch (_) {}
  if (!fplId) {
    try { fplId = (await getDoc(doc(db, "users", user.uid))).data()?.fplTeamId; } catch (_) {}
  }
  loadStats();
  loadDeadline();
  loadPlayers();
});
