// ============================================
// TW Fantasy Official League — Home UI Controller
// Path: js/home.js
//
// Features:
//   1. Deadline Countdown Timer Engine & Hero Click -> Fixtures Navigation
//   2. 3-Column Balanced Stats Alignment
//   3. Top 5 Real Captains Card Grid
//   4. Tab Color = Points Color 100% Sync System
//   5. Live Next Fixture Match Card
//   6. Firestore photoUrl = PRIMARY Player Photo Source
//   7. Firestore photoCode = FALLBACK Player Photo Source
//
// Photo System:
//   Firestore photoUrl
//        ↓
//   Firestore photoCode
//        ↓
//   Local Team Badge
//
// IMPORTANT:
//   Player ID / FPL ID is NOT used for player photo URL.
// ============================================

import { db } from "./firebase-config.js";
import { doc, getDoc } from "./core/fs.js";
import { loadFixturesMaster } from "./core/data.js";

const $ = (id) => document.getElementById(id);

const MIN = 60 * 1000;

// ============================================
// 💾 CACHE
// ============================================

// V13 = Photo URL priority update
// V12 cache ကို မသုံးတော့ဘဲ data အသစ်ပြန်ဖတ်စေမယ်
const SCOUT_CACHE_KEY_V13 = "twfm_scout_highlights_v13";

const LS = {
  get(k, ttl) {
    try {
      const o = JSON.parse(localStorage.getItem(k));

      if (o && Date.now() - o.t < ttl) {
        return o.v;
      }
    } catch (_) {}

    return null;
  },

  set(k, v) {
    try {
      localStorage.setItem(
        k,
        JSON.stringify({
          t: Date.now(),
          v
        })
      );
    } catch (_) {}
  }
};

// ============================================
// 🧰 BASIC HELPERS
// ============================================

const fmt = (n) => {
  return (
    Number.isFinite(+n) &&
    n !== null &&
    n !== undefined &&
    n !== ""
  )
    ? Number(n).toLocaleString("en-US")
    : "–";
};

const pad = (n) => {
  return String(Math.max(0, n)).padStart(2, "0");
};

const esc = (s) => {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c])
  );
};

// ============================================
// 🌐 GLOBAL STATE
// ============================================

let deadlineTs = 0;
let currentGwNumber = 6;
let lastDone = null;

let live = null;
let fplId = null;

let scoutHighlightsData = null;

let mode = "cap";

let timerInterval = null;

// ============================================
// 🎨 POSITION COLORS
// ============================================

const POS = {
  gk: "#2563EB",
  gkp: "#2563EB",
  def: "#EF4444",
  mid: "#F59E0B",
  fwd: "#22C55E"
};

// ============================================
// 🛡️ TEAM DETAILS
// 2026-27 SEASON
// ============================================

const teamDetailsMap = {
  1: {
    name: "Arsenal",
    short: "ARS",
    code: "ars",
    color: "#EF0107"
  },

  2: {
    name: "Aston Villa",
    short: "AVL",
    code: "avl",
    color: "#95BFE5"
  },

  3: {
    name: "AFC Bournemouth",
    short: "BOU",
    code: "bou",
    color: "#DA291C"
  },

  4: {
    name: "Brentford",
    short: "BRE",
    code: "bre",
    color: "#E30613"
  },

  5: {
    name: "Brighton & Hove Albion",
    short: "BHA",
    code: "bha",
    color: "#0057B8"
  },

  6: {
    name: "Chelsea",
    short: "CHE",
    code: "che",
    color: "#034694"
  },

  7: {
    name: "Coventry City",
    short: "COV",
    code: "cov",
    color: "#0099D8"
  },

  8: {
    name: "Crystal Palace",
    short: "CRY",
    code: "cry",
    color: "#1B458F"
  },

  9: {
    name: "Everton",
    short: "EVE",
    code: "eve",
    color: "#003399"
  },

  10: {
    name: "Fulham",
    short: "FUL",
    code: "ful",
    color: "#F8FAFC"
  },

  11: {
    name: "Hull City",
    short: "HUL",
    code: "hul",
    color: "#F5971E"
  },

  12: {
    name: "Ipswich Town",
    short: "IPS",
    code: "ips",
    color: "#0047AB"
  },

  13: {
    name: "Leeds United",
    short: "LEE",
    code: "lee",
    color: "#FFCD00"
  },

  14: {
    name: "Liverpool",
    short: "LIV",
    code: "liv",
    color: "#C8102E"
  },

  15: {
    name: "Manchester City",
    short: "MCI",
    code: "mci",
    color: "#6CABDD"
  },

  16: {
    name: "Manchester United",
    short: "MUN",
    code: "mun",
    color: "#DA291C"
  },

  17: {
    name: "Newcastle United",
    short: "NEW",
    code: "new",
    color: "#F8FAFC"
  },

  18: {
    name: "Nottingham Forest",
    short: "NFO",
    code: "nfo",
    color: "#DD0000"
  },

  19: {
    name: "Tottenham Hotspur",
    short: "TOT",
    code: "tot",
    color: "#8E9BB4"
  },

  20: {
    name: "Sunderland",
    short: "SUN",
    code: "sun",
    color: "#EB172B"
  }
};

// ============================================
// 🔎 TEAM LOOKUP
// ============================================

const TEAM_LOOKUP = {};

Object.entries(teamDetailsMap).forEach(([id, meta]) => {
  TEAM_LOOKUP[String(id)] = {
    id,
    ...meta
  };

  TEAM_LOOKUP[meta.code.toLowerCase()] = {
    id,
    ...meta
  };

  TEAM_LOOKUP[meta.short.toLowerCase()] = {
    id,
    ...meta
  };

  TEAM_LOOKUP[meta.name.toLowerCase()] = {
    id,
    ...meta
  };
});

// ============================================
// 🏷️ GET TEAM META
// ============================================

function getTeamMeta(teamIdentifier) {
  if (!teamIdentifier) {
    return {
      id: 6,
      name: "Chelsea",
      short: "CHE",
      code: "che",
      color: "#034694",
      badgePath: "./assets/badges/che.png"
    };
  }

  const clean = String(teamIdentifier)
    .trim()
    .toLowerCase();

  const matched = TEAM_LOOKUP[clean];

  if (matched) {
    return {
      ...matched,
      badgePath: `./assets/badges/${matched.code}.png`
    };
  }

  return {
    id: 6,
    name: "Chelsea",
    short: "CHE",
    code: "che",
    color: "#034694",
    badgePath: "./assets/badges/che.png"
  };
}

// ============================================
// 🔘 6 MODES CONFIG
// ============================================

const MODES = {
  cap: {
    color: "#8c6dff",
    key: "mostCaptained",
    show: (p) =>
      `${p.totalPoints || p.gwPoints || 0} pts`
  },

  own: {
    color: "#38bdf8",
    key: "mostOwned",
    show: (p) =>
      `${Number(p.ownership || 0).toFixed(1)}%`
  },

  tin: {
    color: "#22c55e",
    key: "mostTransferredIn",
    show: (p) =>
      `+${fmt(p.transfersInEvent || 0)}`
  },

  tout: {
    color: "#ef4444",
    key: "mostTransferredOut",
    show: (p) =>
      `-${fmt(p.transfersOutEvent || 0)}`
  },

  total: {
    color: "#fbbf24",
    key: "mostTotalPoints",
    show: (p) =>
      `${p.totalPoints || 0} pts`
  },

  gw: {
    color: "#34d399",
    key: "mostGwPoints",
    show: (p) =>
      `${p.gwPoints || 0} pts`
  }
};

// ============================================
// ⏳ DEADLINE COUNTDOWN ENGINE
// ============================================

async function loadDeadline() {
  let info = LS.get(
    "twfm_deadline_v12",
    10 * MIN
  );

  if (
    !info ||
    (info.ts && info.ts < Date.now())
  ) {
    try {
      const m = await loadFixturesMaster();

      const cur = m.currentGameweek;

      if (cur) {
        const next = cur.nextGw;

        const target =
          next &&
          next.deadlineTimeEpoch > Date.now()
            ? next
            : cur.deadlineTimeEpoch > Date.now()
            ? {
                id: cur.id,
                deadlineTimeEpoch:
                  cur.deadlineTimeEpoch
              }
            : null;

        const targetGwId = target
          ? target.id
          : cur.id || 6;

        const lastDoneGw = cur.isFinished
          ? cur.id
          : cur.status === "upcoming" ||
            cur.status === "pre_season"
          ? 0
          : Math.max(0, cur.id - 1);

        info = {
          gw: targetGwId,
          ts: target
            ? target.deadlineTimeEpoch
            : 0,
          lastDone: lastDoneGw
        };
      } else {
        info = {
          gw: 6,
          ts: 0,
          lastDone: null
        };
      }

      LS.set(
        "twfm_deadline_v12",
        info
      );
    } catch (e) {
      console.warn(
        "Deadline load note:",
        e
      );

      info =
        info || {
          gw: 6,
          ts: 0,
          lastDone: null
        };
    }
  }

  deadlineTs = info.ts || 0;

  currentGwNumber =
    info.gw || 6;

  lastDone =
    info.lastDone ?? null;

  if ($("gw-label")) {
    $("gw-label").textContent =
      `GW${currentGwNumber} DEADLINE`;
  }

  if ($("gw-when") && info.ts) {
    $("gw-when").textContent =
      new Date(info.ts).toLocaleString(
        "en-GB",
        {
          timeZone: "Asia/Yangon",
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }
      ) + " MMT";
  }

  tick();

  paintStats();
}

// ============================================
// ⏱️ COUNTDOWN TICK
// ============================================

function tick() {
  let d = deadlineTs
    ? Math.max(
        0,
        deadlineTs - Date.now()
      )
    : 0;

  const days = Math.floor(
    d / 864e5
  );

  d -= days * 864e5;

  const h = Math.floor(
    d / 36e5
  );

  d -= h * 36e5;

  const m = Math.floor(
    d / 6e4
  );

  d -= m * 6e4;

  const s = Math.floor(
    d / 1e3
  );

  const set = (id, v) => {
    const e = $(id);

    if (
      e &&
      e.textContent !== v
    ) {
      e.textContent = v;
    }
  };

  set("cd-d", pad(days));
  set("cd-h", pad(h));
  set("cd-m", pad(m));
  set("cd-s", pad(s));
}

// ============================================
// 📊 PERFORMANCE STATS ENGINE
// ============================================

function paintStats() {
  if (!live) return;

  const g =
    Number(live.gameweek) || 0;

  const finished =
    lastDone === null ||
    (g > 0 && g <= lastDone);

  const key =
    `twfm_lastdone_${fplId}`;

  let shown = {
    gw: g,
    gwPoints: live.gwPoints,
    averagePoints:
      live.averagePoints,
    gwRank: live.gwRank
  };

  let isLive = false;

  if (finished) {
    try {
      localStorage.setItem(
        key,
        JSON.stringify(shown)
      );
    } catch (_) {}
  } else {
    let snap = null;

    try {
      snap = JSON.parse(
        localStorage.getItem(key)
      );
    } catch (_) {}

    if (
      snap &&
      snap.gw
    ) {
      shown = snap;
    } else {
      isLive = true;
    }
  }

  const gw =
    Number(shown.gwPoints ?? 0);

  const avg =
    Number(shown.averagePoints);

  const t = (
    id,
    v,
    cls
  ) => {
    const e = $(id);

    if (!e) return;

    e.textContent = v;

    if (cls !== undefined) {
      e.className = cls;
    }
  };

  t(
    "st-total",
    fmt(live.totalPoints)
  );

  t(
    "st-total-d",
    shown.gw
      ? `▲ +${fmt(gw)} (GW${shown.gw})`
      : "",
    "up"
  );

  t(
    "st-rank",
    fmt(live.overallRank)
  );

  t(
    "st-rank-d",
    shown.gwRank
      ? `▲ +${fmt(shown.gwRank)}`
      : "",
    "up"
  );

  t(
    "st-gw-l",
    `GW${
      currentGwNumber - 1 ||
      shown.gw ||
      5
    } Score${
      isLive
        ? " · LIVE"
        : ""
    }`
  );

  t(
    "st-gw",
    fmt(gw)
  );

  if (
    Number.isFinite(avg) &&
    avg > 0
  ) {
    const up =
      gw >= avg;

    t(
      "st-gw-d",
      `${up ? "▲" : "▼"} avg ${fmt(avg)}`,
      up
        ? "up"
        : "dn"
    );
  } else {
    t(
      "st-gw-d",
      isLive
        ? "in progress"
        : "",
      "mu"
    );
  }
}

// ============================================
// 📥 LOAD LIVE STATS
// ============================================

async function loadStats() {
  if (!fplId) return;

  try {
    live = JSON.parse(
      localStorage.getItem(
        `twf_shared_points_v2_${fplId}`
      )
    );

    paintStats();
  } catch (_) {}

  const fresh = LS.get(
    `twfm_points_${fplId}`,
    5 * MIN
  );

  if (fresh) {
    live = fresh;
    paintStats();
    return;
  }

  try {
    const s = await getDoc(
      doc(
        db,
        "livePoints",
        String(fplId)
      )
    );

    if (s.exists()) {
      const d = s.data();

      live = {
        totalPoints:
          d.totalPoints,

        gwPoints:
          d.gwPoints,

        overallRank:
          d.overallRank,

        gwRank:
          d.gwRank,

        averagePoints:
          d.averagePoints,

        gameweek:
          d.gameweek
      };

      LS.set(
        `twfm_points_${fplId}`,
        live
      );

      paintStats();
    }
  } catch (e) {
    console.warn(
      "Live points load note:",
      e
    );
  }
}

// ============================================
// 🌟 LOAD SCOUT HIGHLIGHTS
// ============================================

async function loadScoutHighlights() {
  // V13 cache only
  scoutHighlightsData =
    LS.get(
      SCOUT_CACHE_KEY_V13,
      15 * MIN
    );

  if (!scoutHighlightsData) {
    try {
      const snap =
        await getDoc(
          doc(
            db,
            "scoutPlayers",
            "scoutHighlights"
          )
        );

      if (snap.exists()) {
        scoutHighlightsData =
          snap.data();

        LS.set(
          SCOUT_CACHE_KEY_V13,
          scoutHighlightsData
        );
      }
    } catch (err) {
      console.warn(
        "scoutHighlights load note:",
        err
      );
    }
  }

  renderPlayerCards();
}

// ============================================
// 📸 PLAYER PHOTO URL ENGINE
// ============================================
//
// PRIORITY:
//
// 1. Firestore photoUrl
// 2. Firestore photoCode
// 3. No player photo
//
// NEVER use:
// - p.id
// - p.playerId
//
// because FPL Player ID and PL Photo Code
// can be different values.
// ============================================

function getScoutPlayerPhotoUrl(p) {
  // ------------------------------------------
  // 1️⃣ Firestore photoUrl
  // ------------------------------------------

  const rawPhotoUrl =
    String(
      p?.photoUrl || ""
    ).trim();

  if (rawPhotoUrl) {
    // If URL already contains version,
    // don't add another query parameter.
    if (
      rawPhotoUrl.includes(
        "v=2026_27"
      )
    ) {
      return rawPhotoUrl;
    }

    return (
      rawPhotoUrl +
      (
        rawPhotoUrl.includes("?")
          ? "&"
          : "?"
      ) +
      "v=2026_27"
    );
  }

  // ------------------------------------------
  // 2️⃣ Firestore photoCode
  // ------------------------------------------

  const rawPhotoCode =
    String(
      p?.photoCode ??
      p?.photo ??
      ""
    ).trim();

  const cleanPhotoCode =
    rawPhotoCode
      .replace(
        /\.(png|jpg|jpeg)$/i,
        ""
      )
      .replace(
        /^p/i,
        ""
      )
      .trim();

  if (cleanPhotoCode) {
    return (
      `https://resources.premierleague.com/` +
      `premierleague/photos/players/250x250/` +
      `p${cleanPhotoCode}.png?v=2026_27`
    );
  }

  // ------------------------------------------
  // 3️⃣ No photo
  // ------------------------------------------

  return "";
}

// ============================================
// 🌟 TOP 5 PLAYERS CARD GRID
// ============================================

function renderPlayerCards() {
  const container =
    $("leader-cards-container");

  if (!container) return;

  // ------------------------------------------
  // Loading Skeleton
  // ------------------------------------------

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

  const M =
    MODES[mode] ||
    MODES.cap;

  const activeColor =
    M.color;

  // ------------------------------------------
  // Active Tab Highlight
  // ------------------------------------------

  document
    .querySelectorAll(
      "#leader-tabs button"
    )
    .forEach((b) => {
      const isActive =
        b.dataset.k === mode;

      b.classList.toggle(
        "on",
        isActive
      );

      if (isActive) {
        b.style.setProperty(
          "--c",
          activeColor
        );

        b.style.backgroundColor =
          activeColor;

        b.style.color =
          "#FFFFFF";

        b.style.boxShadow =
          `0 4px 14px color-mix(in srgb, ${activeColor} 40%, transparent)`;
      } else {
        b.style.backgroundColor =
          "";

        b.style.color =
          "";

        b.style.boxShadow =
          "";
      }
    });

  // ------------------------------------------
  // Get Player List
  // ------------------------------------------

  let list = [];

  if (mode === "cap") {
    const capData =
      scoutHighlightsData
        .mostCaptained || {};

    list =
      capData.topList || [];

    if (
      list.length === 0 &&
      capData.leader
    ) {
      list = [
        capData.leader
      ];

      if (
        capData.viceLeader
      ) {
        list.push(
          capData.viceLeader
        );
      }
    }
  } else {
    const sectionData =
      scoutHighlightsData[
        M.key
      ] || {};

    list =
      sectionData.topList ||
      (
        sectionData.leader
          ? [sectionData.leader]
          : []
      );
  }

  // ------------------------------------------
  // No Data
  // ------------------------------------------

  if (
    !list ||
    list.length === 0
  ) {
    container.innerHTML = `
      <div class="col-span-full py-8 text-center text-xs text-slate-400 font-bold">
        Data မရရှိသေးပါ
      </div>
    `;

    return;
  }

  // ==========================================
  // 🎴 RENDER TOP 5
  // ==========================================

  container.innerHTML =
    list
      .slice(0, 5)
      .map((p, i) => {

        // --------------------------------------
        // Position
        // --------------------------------------

        const rawPos =
          String(
            p.position ||
            "mid"
          )
            .toLowerCase()
            .trim();

        const isGk =
          rawPos === "gk" ||
          rawPos === "gkp";

        const posColor =
          POS[rawPos] ||
          "#F59E0B";

        // --------------------------------------
        // Team
        // --------------------------------------

        const teamMeta =
          getTeamMeta(
            p.teamCode ||
            p.team
          );

        const teamColor =
          teamMeta.color;

        const teamShort =
          teamMeta.short;

        const localBadgeUrl =
          teamMeta.badgePath;

        // --------------------------------------
        // 📸 PLAYER PHOTO
        //
        // Firestore photoUrl FIRST
        // photoCode SECOND
        //
        // NO player ID.
        // --------------------------------------

        const freshPhotoUrl =
          getScoutPlayerPhotoUrl(p);

        // --------------------------------------
        // Fallback Badge
        // --------------------------------------

        const fallbackSvg = `
          <div
            class="home-animated-badge-wrap"
            style="
              --tc:${teamColor};
              width:68px;
              height:68px;
              border-radius:50%;
              display:flex;
              flex-direction:column;
              align-items:center;
              justify-content:center;
            "
          >
            <svg
              class="badge-pulse-svg"
              style="
                width:34px;
                height:34px;
              "
              viewBox="0 0 24 24"
              fill="none"
              stroke="${teamColor}"
            >
              <polygon
                points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />

              <circle
                cx="12"
                cy="12"
                r="3.5"
                fill="${teamColor}"
              />
            </svg>

            <span
              class="badge-code-text"
              style="
                color:${teamColor};
                font-size:10px;
                font-weight:900;
              "
            >
              ${esc(teamShort)}
            </span>
          </div>
        `;

        // --------------------------------------
        // Player Name
        // --------------------------------------

        const playerName =
          p.name ||
          p.fullName ||
          "Player";

        // --------------------------------------
        // RETURN CARD
        // --------------------------------------

        return `
          <div
            class="top-player-card"
            style="
              border-top: 3.5px solid ${posColor};
            "
          >

            <!-- RANK -->
            <span
              class="player-card-rank"
            >
              ${i + 1}
            </span>

            <!-- PHOTO -->
            <div
              class="player-card-photo-wrap"
            >

              <img
                src="${esc(freshPhotoUrl)}"
                alt="${esc(playerName)}"
                loading="lazy"
                class="player-card-photo"

                onerror="
                  if (!this.dataset.triedLocalBadge) {
                    this.dataset.triedLocalBadge = '1';
                    this.src = '${localBadgeUrl}';
                    this.style.maxHeight = '65%';
                    this.style.objectFit = 'contain';
                  } else {
                    this.parentElement.innerHTML = \`${fallbackSvg
                      .replace(/\n/g, "")
                      .replace(/`/g, "\\`")}\`;
                  }
                "
              >

              <!-- CLUB BADGE -->
              <img
                src="${localBadgeUrl}"
                alt="${esc(teamShort)}"
                class="player-card-club-badge"

                onerror="
                  this.style.display='none';
                "
              >

            </div>

            <!-- PLAYER NAME -->
            <div
              class="player-card-name"
            >
              ${esc(playerName)}
            </div>

            <!-- POSITION -->
            <div
              class="player-card-pos"
              style="
                color:${posColor};
                font-weight:800;
              "
            >
              ${
                isGk
                  ? "GK"
                  : rawPos.toUpperCase()
              }
            </div>

            <!-- POINT / VALUE -->
            <div
              class="player-card-pts"
              style="
                color:${activeColor} !important;
                text-shadow:
                  0 0 10px
                  color-mix(
                    in srgb,
                    ${activeColor} 30%,
                    transparent
                  );
              "
            >
              ${M.show(p)}
            </div>

          </div>
        `;
      })
      .join("");
}

// ============================================
// 🗓 NEXT FIXTURE MATCH RENDERER
// ============================================

async function loadNextFixture() {
  try {
    const meta =
      await loadFixturesMaster();

    if (!meta) return;

    const targetGw =
      currentGwNumber || 6;

    let targetMatch =
      null;

    if (
      Array.isArray(
        meta.fixtures
      ) &&
      meta.fixtures.length > 0
    ) {
      targetMatch =
        meta.fixtures.find(
          (f) =>
            Number(f.event) ===
              Number(targetGw) &&
            !f.finished
        ) ||
        meta.fixtures.find(
          (f) =>
            Number(f.event) ===
            Number(targetGw)
        ) ||
        meta.fixtures[0];
    }

    // ------------------------------------------
    // Fallback Fixture
    // ------------------------------------------

    if (!targetMatch) {
      targetMatch = {
        event: targetGw,

        team_h: 1,

        team_a: 13,

        kickoff_time:
          "2026-10-10T12:30:00Z"
      };
    }

    const homeTeam =
      getTeamMeta(
        targetMatch.team_h || 1
      );

    const awayTeam =
      getTeamMeta(
        targetMatch.team_a || 13
      );

    // ------------------------------------------
    // Fixture Time
    // ------------------------------------------

    const fixtureTimeEl =
      $("next-fixture-time");

    if (fixtureTimeEl) {
      if (
        targetMatch.kickoff_time
      ) {
        const d =
          new Date(
            targetMatch.kickoff_time
          );

        const timeStr =
          d.toLocaleDateString(
            "en-GB",
            {
              timeZone:
                "Asia/Yangon",

              day: "numeric",

              month: "short",

              year: "numeric"
            }
          ) +
          " · " +
          d.toLocaleTimeString(
            "en-GB",
            {
              timeZone:
                "Asia/Yangon",

              hour: "2-digit",

              minute: "2-digit",

              hour12: false
            }
          );

        fixtureTimeEl.textContent =
          `GW${
            targetMatch.event ||
            targetGw
          } · ${timeStr}`;
      } else {
        fixtureTimeEl.textContent =
          `GW${
            targetMatch.event ||
            targetGw
          } · 10 Oct 2026 · 19:00`;
      }
    }

    // ------------------------------------------
    // HOME TEAM
    // ------------------------------------------

    const hCodeEl =
      $("fixture-home-code");

    const hNameEl =
      $("fixture-home-name");

    const hBadgeEl =
      $("fixture-home-badge");

    if (hCodeEl) {
      hCodeEl.textContent =
        homeTeam.short;
    }

    if (hNameEl) {
      hNameEl.textContent =
        homeTeam.name;
    }

    if (hBadgeEl) {
      hBadgeEl.src =
        homeTeam.badgePath;

      hBadgeEl.alt =
        homeTeam.short;

      hBadgeEl.onerror = () => {
        hBadgeEl.src =
          "./assets/badges/ars.png";
      };
    }

    // ------------------------------------------
    // AWAY TEAM
    // ------------------------------------------

    const aCodeEl =
      $("fixture-away-code");

    const aNameEl =
      $("fixture-away-name");

    const aBadgeEl =
      $("fixture-away-badge");

    if (aCodeEl) {
      aCodeEl.textContent =
        awayTeam.short;
    }

    if (aNameEl) {
      aNameEl.textContent =
        awayTeam.name;
    }

    if (aBadgeEl) {
      aBadgeEl.src =
        awayTeam.badgePath;

      aBadgeEl.alt =
        awayTeam.short;

      aBadgeEl.onerror = () => {
        aBadgeEl.src =
          "./assets/badges/lee.png";
      };
    }

  } catch (err) {
    console.warn(
      "Next fixture loader note:",
      err
    );
  }
}

// ============================================
// 🚀 EXPORT INITIALIZER
// ============================================

export async function initHomeTab(
  user,
  profile
) {

  // ------------------------------------------
  // FPL TEAM ID
  // ------------------------------------------

  if (
    profile?.fplTeamId
  ) {
    fplId =
      String(
        profile.fplTeamId
      );
  }

  // ------------------------------------------
  // LOAD HOME DATA
  // ------------------------------------------

  await loadDeadline();

  loadStats();

  loadScoutHighlights();

  await loadNextFixture();

  // ------------------------------------------
  // COUNTDOWN TIMER
  // ------------------------------------------

  if (timerInterval) {
    clearInterval(
      timerInterval
    );
  }

  timerInterval =
    setInterval(
      tick,
      1000
    );

  // ------------------------------------------
  // HERO DEADLINE CARD
  // ------------------------------------------

  const heroCard =
    $("hero-deadline-card");

  if (heroCard) {
    heroCard.onclick = () => {

      if (
        typeof window.go ===
        "function"
      ) {
        window.go(
          "fixtures"
        );
      } else {
        window.location.hash =
          "#/fixtures";
      }

    };
  }

  // ------------------------------------------
  // LEADERBOARD TABS
  // ------------------------------------------

  const leaderTabs =
    $("leader-tabs");

  if (leaderTabs) {

    // Avoid duplicate listeners
    // if initHomeTab runs again.

    leaderTabs.onclick =
      (e) => {

        const b =
          e.target.closest(
            "button[data-k]"
          );

        if (!b) return;

        const newMode =
          b.dataset.k;

        if (
          !MODES[newMode]
        ) {
          return;
        }

        mode =
          newMode;

        renderPlayerCards();
      };
  }
}
