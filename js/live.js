import { auth, db } from "../js/firebase-config.js";
import { onAuthStateChanged } from "./core/auth.js";
import { 
  doc, getDoc, getDocFromServer, getDocs, setDoc, onSnapshot, collection, addDoc, deleteDoc, updateDoc, 
  arrayUnion, arrayRemove, orderBy, query, serverTimestamp, limit 
} from "./core/fs.js";
import { jerseyPath, splitSquadByPosition } from "./pitch-renderer.js";

// =========================================================================
//  Live squad loader (quota-safe) — liveteamquota.js ကို ဒီထဲ ပေါင်းထည့်ထား
//  getLiveSquadWithQuota(fplId, force) -> { squad, points, fromCache }
//   squad  = liveTeams/{fplId}  (picks, bank, freeTransfers, gameweek ...)
//   points = livePoints/{fplId} (gwPoints, totalPoints, overallRank ...)
//  normal load  : 3 မိနစ်အတွင်း cache ရှိရင် Firestore 0 read
//  force refresh: 20 စက္ကန့်အတွင်း ထပ်နှိပ်ရင် cache ပြန်ပေး (spam ကာကွယ်)
//  Cache key (team / live / draft / home မျှဝေ): twf_shared_squad_v2_<id> · twf_shared_points_v2_<id>
// =========================================================================
const LIVE_FRESH_MS = 3 * 60 * 1000;
const LIVE_COOLDOWN_MS = 20 * 1000;
const lsRead = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
const lsWrite = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

async function getLiveSquadWithQuota(fplId, force = false) {
  if (!fplId) return null;
  const id = String(fplId);
  const kSquad = `twf_shared_squad_v2_${id}`;
  const kPts = `twf_shared_points_v2_${id}`;
  const kTime = `twf_live_quota_t_${id}`;

  const cachedSquad = lsRead(kSquad);
  const cachedPts = lsRead(kPts);
  const haveCache = !!(cachedSquad || cachedPts);
  const age = Date.now() - Number(localStorage.getItem(kTime) || 0);

  if (haveCache && ((!force && age < LIVE_FRESH_MS) || (force && age < LIVE_COOLDOWN_MS))) {
    return { squad: cachedSquad, points: cachedPts, fromCache: true };
  }
  if (!navigator.onLine) return haveCache ? { squad: cachedSquad, points: cachedPts, fromCache: true } : null;

  try {
    const read = force ? getDocFromServer : getDoc;
    const [sSnap, pSnap] = await Promise.all([
      read(doc(db, "liveTeams", id)),
      read(doc(db, "livePoints", id)),
    ]);
    const squad = sSnap.exists() ? sSnap.data() : cachedSquad;
    const points = pSnap.exists() ? pSnap.data() : cachedPts;
    if (squad) lsWrite(kSquad, squad);
    if (points) lsWrite(kPts, points);
    try { localStorage.setItem(kTime, String(Date.now())); } catch (_) {}
    return { squad, points, fromCache: false };
  } catch (e) {
    console.warn("getLiveSquadWithQuota failed:", e);
    return haveCache ? { squad: cachedSquad, points: cachedPts, fromCache: true } : null;
  }
}

let currentUser = null; 
let currentTeamName = ""; 
let isApproved = false; 
let currentFplTeamIdStr = null;

// 💡 Reply/Delete State Variables
let activeReplyId = null; 
let selectedMessageData = null; 

// 💡 Snapshot Listeners Cleanup References
let unsubscribeChat = null;
let unsubscribePresence = null;
let presenceHeartbeatInterval = null;

// 💡 Audio Notification Alarm State
let isSoundAlarmEnabled = localStorage.getItem("twf_chat_alarm_enabled") !== "false";
let initialChatLoadDone = false;

// 🔊 Web Audio API Synthesizer (Crystal Chime Notification)
function playChatNotificationSound() {
  if (!isSoundAlarmEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) {
    console.warn("AudioContext playback prevented:", e);
  }
}

// 🔔 Alarm Switch Toggle Handler
window.toggleChatAlarm = () => {
  isSoundAlarmEnabled = !isSoundAlarmEnabled;
  localStorage.setItem("twf_chat_alarm_enabled", String(isSoundAlarmEnabled));
  updateAlarmUI();
  if (isSoundAlarmEnabled) playChatNotificationSound();
};

function updateAlarmUI() {
  const iconEl = document.getElementById("alarm-icon");
  const textEl = document.getElementById("alarm-status-text");
  const toggleBtn = document.getElementById("chat-alarm-toggle");

  if (iconEl) iconEl.textContent = isSoundAlarmEnabled ? "🔔" : "🔕";
  if (textEl) textEl.textContent = isSoundAlarmEnabled ? "ON" : "OFF";
  if (toggleBtn) {
    if (isSoundAlarmEnabled) {
      toggleBtn.style.borderColor = "rgba(140,109,255,0.6)";
      toggleBtn.style.color = "#b3a1ff";
    } else {
      toggleBtn.style.borderColor = "rgba(255,255,255,0.2)";
      toggleBtn.style.color = "#94A3B8";
    }
  }
}

// 🔄 REFRESH BUTTON HANDLER (Quota & Alarm အားလုံးကို liveteamquota.js သို့သာ လွှဲအပ်ထားသည်)
window.forceRefreshLive = async function() {
  if (!currentFplTeamIdStr) return;

  const btn = document.getElementById("btn-refresh-live") || document.querySelector("button[onclick*='forceRefreshLive']");
  const icon = document.getElementById("refresh-live-icon");

  if (btn) {
    btn.disabled = true;
    btn.style.setProperty("background-color", "#8c6dff", "important");
    btn.style.setProperty("color", "#14172b", "important");
    btn.style.setProperty("border-color", "#b3a1ff", "important");
    btn.style.setProperty("box-shadow", "0 0 12px rgba(140,109,255, 0.8)", "important");
  }
  if (icon) icon.classList.add("animate-spin");

  try {
    // 🛡️ liveteamquota.js ထံမှ squad နှင့် points ၂ မျိုးလုံးကို destructure လုပ်၍ ရယူခြင်း
    const result = await getLiveSquadWithQuota(currentFplTeamIdStr, true);
    if (result) {
      const squad = result.squad || (result.picks ? result : null);
      const points = result.points || result;
      if (squad) renderPitch(squad);
      if (points) renderLivePointsUI(points);
    }
  } catch (err) {
    console.error("Live Quota Refresh Error:", err);
  } finally {
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.style.removeProperty("background-color");
        btn.style.removeProperty("color");
        btn.style.removeProperty("border-color");
        btn.style.removeProperty("box-shadow");
      }
      if (icon) icon.classList.remove("animate-spin");
    }, 400);
  }
};

function renderLivePointsUI(ptData) {
  if (!ptData) return;
  const gwPtsEl = document.getElementById("gw-points");
  const gwLabelEl = document.getElementById("gw-label");
  const totalPtsEl = document.getElementById("overall-pts");
  const rankEl = document.getElementById("overall-rank");
  const capPtsEl = document.getElementById("captain-pts");
  const gwRankEl = document.getElementById("gw-rank");
  const hitEl = document.getElementById("hit-label");
  const chipEl = document.getElementById("chip-badge");

  if (gwPtsEl) gwPtsEl.textContent = ptData.gwPoints ?? ptData.livePoints ?? "—"; 
  if (gwLabelEl) gwLabelEl.textContent = "GW " + (ptData.gameweek ?? "—"); 
  if (totalPtsEl) totalPtsEl.textContent = ptData.totalPoints ?? "—"; 
  if (rankEl) rankEl.textContent = ptData.overallRank ? ptData.overallRank.toLocaleString() : "—"; 
  if (capPtsEl) capPtsEl.textContent = ptData.captainPoints ?? "—"; 
  if (gwRankEl) gwRankEl.textContent = ptData.gwRank ? ptData.gwRank.toLocaleString() : "—"; 
  
  const hit = ptData.transferCost || 0; 
  if (hitEl) hitEl.textContent = "Hit: -" + hit; 
  
  const chip = ptData.activeChip; 
  if (chipEl) chipEl.textContent = chip ? chip.toUpperCase() : "NO CHIP"; 
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.go("login"); return; } 
  currentUser = user; 

  updateAlarmUI();

  try {
    const userCacheKey = `twf_user_profile_${user.uid}`;
    let uData = null;
    const cachedUser = localStorage.getItem(userCacheKey);
    if (cachedUser) {
      try { uData = JSON.parse(cachedUser); } catch (_) {}
    }

    if (!uData) {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        uData = snap.data();
        localStorage.setItem(userCacheKey, JSON.stringify(uData));
      }
    }

    if (!uData) { window.go("login"); return; } 

    currentTeamName = uData.teamName || ""; 
    const userTeamEl = document.getElementById("user-team");
    if (userTeamEl) userTeamEl.textContent = currentTeamName; 

    isApproved = uData.status === "approved"; 
    updateChatLock(); 

    initPresenceEngine(user.uid, currentTeamName);

    if (uData.fplTeamId) {
      currentFplTeamIdStr = String(uData.fplTeamId);
      // 💡 App စဖွင့်ချိန်တွင် liveteamquota.js က Fake Refresh ၃ စက္ကန့်နှင့် Cache ချက်ချင်းပြသပေးမည် (0 Read)
      const result = await getLiveSquadWithQuota(currentFplTeamIdStr, false);
      if (result) {
        const squad = result.squad || (result.picks ? result : null);
        const points = result.points || result;
        if (squad) renderPitch(squad);
        if (points) renderLivePointsUI(points);
      }
    }
  } catch (err) {
    console.warn("Error initializing live dashboard:", err);
  }

  loadChat(); 
});

// =========================================================================
// 🟢 PRESENCE ENGINE
// =========================================================================
let totalRegisteredCount = 0;

async function initPresenceEngine(uid, teamName) {
  const userStatusRef = doc(db, "userStatus", uid);

  try {
    // users collection တစ်ခုလုံး မဖတ်တော့ဘဲ count aggregation (≈1 read) + 30 မိနစ် cache
    const cachedCnt = JSON.parse(localStorage.getItem("twfm_users_count") || "null");
    if (cachedCnt && Date.now() - cachedCnt.t < 30 * 60 * 1000) {
      totalRegisteredCount = cachedCnt.n;
    } else {
      const { getCountFromServer } = await import("./core/fs.js");
      const cnt = await getCountFromServer(collection(db, "users"));
      totalRegisteredCount = cnt.data().count || 0;
      localStorage.setItem("twfm_users_count", JSON.stringify({ t: Date.now(), n: totalRegisteredCount }));
    }
  } catch (e) {
    console.warn("Could not fetch total users count:", e);
  }

  const sendHeartbeat = async () => {
    try {
      await setDoc(userStatusRef, {
        uid: uid,
        teamName: teamName || "Manager",
        lastSeen: serverTimestamp(),
        online: true
      }, { merge: true });
    } catch (e) {
      console.warn("Heartbeat error:", e);
    }
  };

  sendHeartbeat();
  if (presenceHeartbeatInterval) clearInterval(presenceHeartbeatInterval);
  presenceHeartbeatInterval = setInterval(() => { if (!document.hidden) sendHeartbeat(); }, 60000);

  window.addEventListener("beforeunload", () => {
    setDoc(userStatusRef, { online: false, lastSeen: serverTimestamp() }, { merge: true });
  });

  if (unsubscribePresence) unsubscribePresence();
  unsubscribePresence = onSnapshot(collection(db, "userStatus"), (snapshot) => {
    const now = Date.now();
    let currentActiveOnline = 0;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const lastSeenMillis = data.lastSeen?.toDate ? data.lastSeen.toDate().getTime() : 0;
      
      if (data.online !== false && (now - lastSeenMillis < 180000)) {
        currentActiveOnline++;
      }
    });

    currentActiveOnline = Math.max(1, currentActiveOnline);
    const totalCount = Math.max(totalRegisteredCount, currentActiveOnline);
    const calculatedOffline = Math.max(0, totalCount - currentActiveOnline);

    const onlineEl = document.getElementById("online-count");
    const offlineEl = document.getElementById("offline-count");
    if (onlineEl) onlineEl.textContent = `${currentActiveOnline} On`;
    if (offlineEl) offlineEl.textContent = `${calculatedOffline} Off`;
  });
}

function playerCard(p, isBench = false, isFiveRow = false) {
  const mult = Number(p.multiplier ?? 1); 
  const displayPoints = (p.livePoints ?? 0) * (mult > 1 ? mult : 1); 
  const isCap = p.isCaptain === true || p.isCaptain === "true" || mult > 1;
  const isVc = p.isVice === true || p.isVice === "true";
  
  const borderHighlight = isCap 
    ? 'border: 2px solid #b3a1ff; box-shadow: 0 0 6px rgba(179,161,255,0.6);' 
    : isVc 
    ? 'border: 2px solid #C0C0C0; box-shadow: 0 0 5px rgba(192,192,192,0.4);' 
    : 'border: 1.5px solid rgba(255,255,255,0.15);';

  const badge = mult === 3
    ? '<span class="absolute -top-1 -right-1 text-[7.5px] font-black bg-[#b3a1ff] text-[#14172b] w-3.5 h-3.5 rounded-full flex items-center justify-center border border-black shadow-md z-20">3x</span>' 
    : isCap
    ? '<span class="absolute -top-1 -right-1 text-[7.5px] font-black bg-[#b3a1ff] text-[#14172b] w-3.5 h-3.5 rounded-full flex items-center justify-center border border-black shadow-md z-20">C</span>' 
    : isVc
    ? '<span class="absolute -top-1 -right-1 text-[7.5px] font-black bg-[#C0C0C0] text-[#14172b] w-3.5 h-3.5 rounded-full flex items-center justify-center border border-black shadow-md z-20">V</span>' 
    : '';

  const cardMaxWidth = isFiveRow ? 'max-width: 44px;' : 'max-width: 58px;';
  const circleSize = isFiveRow ? 'w-[30px] h-[30px]' : 'w-[36px] h-[36px]';
  const nameFontSize = isFiveRow ? 'text-[7px]' : 'text-[8px]';
  const ptsFontSize = isFiveRow ? 'font-size: 8.5px;' : 'font-size: 9.5px;';

  return `
    <div class="flex flex-col items-center justify-center relative select-none" style="flex: 1 1 0; min-width: 0; ${cardMaxWidth} margin: 0 1px;">
      <div class="${circleSize} rounded-full flex items-center justify-center mb-1 relative bg-[#2d3366]/80 shrink-0" style="${borderHighlight}">
        <img src="${jerseyPath(p)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" class="w-[80%] h-[80%] object-contain rounded-full" alt="${p.name}" />
        <span style="display:none; align-items:center; justify-content:center; font-size:0.85rem;">👕</span>
        ${badge}
      </div>

      <div class="w-full flex flex-col rounded overflow-hidden shadow-md border border-black/30">
        <div class="w-full bg-white px-0.5 text-center flex items-center justify-center" style="height: 13px;">
          <p class="text-[#14172b] font-black ${nameFontSize} leading-none tracking-tight truncate w-full px-0.5">${p.name || "?"}</p>
        </div>
        <div class="w-full bg-[#000000] text-center flex items-center justify-center font-black" style="height: 14px;">
          <span style="color: ${displayPoints > 0 ? '#b3a1ff' : '#FFFFFF'}; ${ptsFontSize} line-height: 1;">${displayPoints}</span>
        </div>
      </div>
    </div>
  `;
}

function renderPitch(data) {
  if (!data) return;
  const picks = data.picks || []; 
  const { subs, gk, def, mid, fwd } = splitSquadByPosition(picks);

  const makeRow = (players) => {
    const isFive = players.length >= 5;
    const gapStyle = isFive ? 'gap: 2px;' : 'gap: 4px;';
    return `
      <div class="flex justify-center items-center w-full my-auto px-1" style="${gapStyle} min-height: 64px;">
        ${players.map(p => playerCard(p, false, isFive)).join("")}
      </div>
    `;
  }; 

  let htmlContent = `
    <div class="flex flex-col justify-between w-full h-full py-1.5" style="min-height: 100%;">
      ${makeRow(gk)}
      ${makeRow(def)}
      ${makeRow(mid)}
      ${makeRow(fwd)}
    </div>
  `;
  const pitchEl = document.getElementById("pitch");
  if (pitchEl) pitchEl.innerHTML = htmlContent;

  let benchContent = "";
  if (subs.length > 0) {
    benchContent += `
      <div class="w-full px-2 py-1.5 rounded-xl border border-[#8c6dff]/30" style="background: rgba(0,0,0,0.25);">
        <p class="text-center font-black tracking-wide text-[#8c6dff]/80 uppercase mb-1" style="font-size: 0.55rem; letter-spacing: 0.05em;">
          📋 BENCH (အရံလူစာရင်း)
        </p>
        <div class="flex justify-around items-center w-full">
          ${subs.map(p => playerCard(p, true, false)).join("")}
        </div>
      </div>
    `;
  }
  const benchEl = document.getElementById("bench-container");
  if (benchEl) benchEl.innerHTML = benchContent;
}

function updateChatLock() {
  const input = document.getElementById("chat-input"); 
  const sendBtn = document.getElementById("send-btn"); 
  const lockBanner = document.getElementById("chat-lock-banner"); 
  if (isApproved) {
    if (input) { input.disabled = false; input.placeholder = "Message ရိုက်ပါ..."; }
    if (sendBtn) { sendBtn.disabled = false; sendBtn.style.opacity = "1"; }
    if (lockBanner) lockBanner.classList.add("hidden"); 
  } else {
    if (input) { input.disabled = true; input.placeholder = "Approve ပြီးမှ Chat ရေးနိုင်သည်"; }
    if (sendBtn) { sendBtn.disabled = true; sendBtn.style.opacity = "0.4"; }
    if (lockBanner) lockBanner.classList.remove("hidden"); 
  }
}

// 💬 Real-time Chat Listener
function loadChat() {
  const q = query(collection(db, "chat"), orderBy("createdAt", "desc"), limit(55)); 
  if (unsubscribeChat) unsubscribeChat();

  unsubscribeChat = onSnapshot(q, (snapshot) => {
    const msgs = []; 
    snapshot.forEach(d => msgs.unshift({ id: d.id, ...d.data() })); 
    const chatEl = document.getElementById("chat-messages"); 
    if (!chatEl) return;

    if (initialChatLoadDone && snapshot.docChanges().length > 0) {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const newMsg = change.doc.data();
          if (newMsg.uid !== currentUser?.uid) {
            playChatNotificationSound();
          }
        }
      });
    }
    initialChatLoadDone = true;

    if (msgs.length === 0) {
      chatEl.innerHTML = `<p class="text-center text-xs py-8 text-[#8c6dff]">Chat မစသေးပါ — ပထမဆုံး Message ရေးလိုက်ပါ</p>`; 
      return;
    }

    window.chatMessagesCache = msgs; 

    chatEl.innerHTML = msgs.map(m => {
      const isSelf = m.uid === currentUser?.uid; 
      const time = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }) : ""; 
      
      let replyBoxHtml = "";
      if (m.replyToName && m.replyToText) {
        replyBoxHtml = `
          <div class="text-[10px] bg-black/10 rounded px-2 py-1 mb-1 border-l-2 border-[#2d3366] max-w-xs text-left truncate opacity-80" style="color: #2d3366;">
              ↩️ <b>${m.replyToName}</b>: ${m.replyToText}
          </div>
        `;
      }

      const reactionsData = m.reactions || {};
      const reactionPills = Object.keys(reactionsData)
        .filter(emo => (reactionsData[emo] || []).length > 0)
        .map(emo => {
          const uids = reactionsData[emo] || [];
          const reactedByMe = uids.includes(currentUser?.uid);
          return `<span onclick="event.stopPropagation(); window.toggleReaction('${m.id}', '${emo}')"
            class="text-[11px] rounded-full px-1.5 py-0.5 mr-1 cursor-pointer select-none inline-flex items-center gap-0.5 shadow-2xs"
            style="background:${reactedByMe ? '#8c6dff' : '#E8EFEA'}; border:1px solid ${reactedByMe ? '#A88428' : '#CBDAD0'}; color:${reactedByMe ? '#14172b' : '#2d3366'};">
            ${emo} <b style="font-weight:800;">${uids.length}</b>
          </span>`;
        }).join("");
      const reactionsRowHtml = reactionPills ? `<div class="mt-1 flex flex-wrap ${isSelf ? 'justify-end' : 'justify-start'}">${reactionPills}</div>` : "";

      return isSelf
        ? `<div class="flex flex-col items-end mb-3">
            <div class="text-xs font-bold mb-0.5 text-[#8c6dff]">${m.teamName}</div>
            ${replyBoxHtml}
            <div class="rounded-2xl rounded-br-xs px-3.5 py-2 text-sm max-w-xs cursor-pointer shadow-xs active:scale-[0.98] transition-transform" onclick="window.openOptionsModal('${m.id}')" style="background: linear-gradient(135deg, #b3a1ff, #8c6dff); color: #0b0d1a; font-weight: 600; text-align: left; word-break: break-word; line-height: 1.35;">${m.text}</div>
            ${reactionsRowHtml}
            <div class="text-[9px] mt-1 font-semibold text-[#529E70]">${time}</div>
           </div>` 
        : `<div class="flex flex-col items-start mb-3">
            <div class="text-xs font-bold mb-0.5 text-[#d9d0ff]">${m.teamName}</div>
            ${replyBoxHtml}
            <div class="rounded-2xl rounded-bl-xs px-3.5 py-2 text-sm max-w-xs cursor-pointer shadow-xs border border-emerald-900/10 active:scale-[0.98] transition-transform" onclick="window.openOptionsModal('${m.id}')" style="background: #D7E2DA; color: #0b0d1a; font-weight: 600; text-align: left; word-break: break-word; line-height: 1.35;">${m.text}</div>
            ${reactionsRowHtml}
            <div class="text-[9px] mt-1 font-semibold text-[#529E70]">${time}</div>
           </div>`; 
    }).join("");
    chatEl.scrollTop = chatEl.scrollHeight; 
  });
}

// 📥 Send Message Trigger
window.sendMessage = async () => {
  if (!isApproved) return; 
  const input = document.getElementById("chat-input"); 
  const text = input.value.trim(); 
  if (!text || !currentUser) return; 

  const payload = {
    text: text,
    teamName: currentTeamName,
    uid: currentUser.uid,
    createdAt: serverTimestamp()
  };

  if (activeReplyId && selectedMessageData) {
    payload.replyToId = activeReplyId;
    payload.replyToName = selectedMessageData.teamName;
    payload.replyToText = selectedMessageData.text;
  }

  input.value = ""; 
  window.cancelReply(); 
  await addDoc(collection(db, "chat"), payload); 
};

// ❤️ Reaction Toggle
window.toggleReaction = async (msgId, emoji) => {
  if (!isApproved || !currentUser) return;
  const found = window.chatMessagesCache?.find(m => m.id === msgId);
  if (!found) return;

  const existingUids = (found.reactions && found.reactions[emoji]) || [];
  const alreadyReacted = existingUids.includes(currentUser.uid);
  const msgRef = doc(db, "chat", msgId);

  try {
    await updateDoc(msgRef, {
      [`reactions.${emoji}`]: alreadyReacted ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid)
    });
  } catch (err) {
    console.error("Reaction toggle error:", err);
  }
};

window.openOptionsModal = (msgId) => {
  if (!isApproved) return;
  const found = window.chatMessagesCache?.find(m => m.id === msgId);
  if (!found) return;

  selectedMessageData = found;
  window.activeReactionMsgId = msgId; 
  document.getElementById("modal-msg-preview").textContent = `"${found.text}"`; 
  
  const deleteBtn = document.getElementById("modal-delete-btn");
  if (found.uid === currentUser?.uid) {
    deleteBtn.classList.remove("hidden");
  } else {
    deleteBtn.classList.add("hidden");
  }

  document.getElementById("message-options-modal").classList.remove("hidden");
};

window.closeOptionsModal = () => {
  document.getElementById("message-options-modal").classList.add("hidden");
};

window.reactAndClose = (emoji) => {
  if (window.activeReactionMsgId) {
    window.toggleReaction(window.activeReactionMsgId, emoji);
  }
  window.closeOptionsModal();
};

const modalReplyBtn = document.getElementById("modal-reply-btn");
if (modalReplyBtn) {
  modalReplyBtn.onclick = () => {
    if (!selectedMessageData) return;
    activeReplyId = selectedMessageData.id;

    document.getElementById("reply-target-name").textContent = `Reply to ${selectedMessageData.teamName}`;
    document.getElementById("reply-target-text").textContent = selectedMessageData.text;
    document.getElementById("reply-preview-bar").classList.remove("hidden");
    
    window.closeOptionsModal();
    document.getElementById("chat-input").focus();
  };
}

window.cancelReply = () => {
  activeReplyId = null;
  const bar = document.getElementById("reply-preview-bar");
  if (bar) bar.classList.add("hidden");
};

const modalDeleteBtn = document.getElementById("modal-delete-btn");
if (modalDeleteBtn) {
  modalDeleteBtn.onclick = async () => {
    if (!selectedMessageData) return;
    window.closeOptionsModal();
    try {
      await deleteDoc(doc(db, "chat", selectedMessageData.id));
    } catch (error) {
      console.error("Error deleting message: ", error);
    }
  };
}

window.handleKeydown = (e) => { 
  if (e.key === "Enter" && isApproved) window.sendMessage(); 
};
