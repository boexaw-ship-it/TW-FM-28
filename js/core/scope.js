// ============================================
// TW FM — Memory & Lifecycle Scope Manager
// Features:
//  1) Route Scope Isolation (Prevent Memory & Firestore Quota Leaks)
//  2) Protected Native Events (Router Safe: Never unbind Shell events)
//  3) Isolated Clean-up with Error Boundaries (Safe Execution)
//  4) Automatic Timer & Realtime Listener Tracking
// ============================================

let currentScopeInstance = null;

// Router သို့မဟုတ် App Shell ကိုယ်တိုင် အသုံးပြုသည့် Core Event များကို ကာကွယ်ထားသော List
const PROTECTED_EVENTS = new Set([
  "DOMContentLoaded",
  "hashchange",
  "popstate"
]);

/**
 * စာမျက်နှာအသစ် စတင်ချိန်တွင် Scope အသစ် ဖွင့်လှစ်ခြင်း
 */
export function beginScope() {
  currentScopeInstance = {
    offs: [],       // Firestore onSnapshot / custom unsubscribers
    timers: [],     // setTimeout IDs
    intervals: [],  // setInterval IDs
    events: []      // [target, eventType, handler, options]
  };
  return currentScopeInstance;
}

/**
 * လက်ရှိ အသက်ဝင်နေသော Scope ကို ပြန်ထုတ်ပေးခြင်း
 */
export function currentScope() {
  return currentScopeInstance;
}

/**
 * Firestore Realtime Listener သို့မဟုတ် Custom Cleanup Function များကို မှတ်သားခြင်း
 * @param {Function} offFn - Unsubscribe callback function
 */
export function track(offFn) {
  if (currentScopeInstance && typeof offFn === "function") {
    currentScopeInstance.offs.push(offFn);
  }
  return offFn;
}

/**
 * စာမျက်နှာ ကူးပြောင်းချိန်တွင် ယခင် Page ၏ Memory အားလုံးကို အလိုအလျောက် သန့်စင်ပေးခြင်း
 * @param {Object} scope - beginScope မှ ရရှိခဲ့သော scope instance
 */
export function endScope(scope) {
  if (!scope) return;

  // beforeunload handler (ဥပမာ live presence offline) ကို page မထွက်ခင် တစ်ကြိမ်ခေါ်
  if (Array.isArray(scope.events)) {
    scope.events.forEach(([, type, fn]) => {
      if (type === "beforeunload" && typeof fn === "function") {
        try { fn(new Event("beforeunload")); } catch (_) {}
      }
    });
  }

  // ၁။ Firestore Listeners & Unsubscribers များကို ပိတ်သိမ်းခြင်း
  if (Array.isArray(scope.offs)) {
    scope.offs.forEach((fn) => {
      try {
        if (typeof fn === "function") fn();
      } catch (err) {
        console.warn("[Scope] Error cleaning unsubscribe function:", err);
      }
    });
  }

  // ၂။ Timers & Intervals များကို ဖျက်ထုတ်ခြင်း
  if (Array.isArray(scope.intervals)) {
    scope.intervals.forEach((id) => clearInterval(id));
  }
  if (Array.isArray(scope.timers)) {
    scope.timers.forEach((id) => clearTimeout(id));
  }

  // ၃။ DOM & Window Event Listeners များကို ဖယ်ရှားခြင်း
  if (Array.isArray(scope.events)) {
    scope.events.forEach(([target, type, fn, opt]) => {
      try {
        if (target && typeof target.removeEventListener === "function") {
          target.removeEventListener(type, fn, opt);
        }
      } catch (err) {
        console.warn(`[Scope] Error removing event listener (${type}):`, err);
      }
    });
  }

  // Memory References အားလုံးကို အပြီးတိုင် ရှင်းထုတ်ခြင်း
  scope.offs.length = 0;
  scope.intervals.length = 0;
  scope.timers.length = 0;
  scope.events.length = 0;

  if (currentScopeInstance === scope) {
    currentScopeInstance = null;
  }
}

/**
 * Window/Document Listeners, setInterval နှင့် setTimeout တို့ကို Safe Auto-Track ပြုလုပ်ခြင်း
 * (App စတင်ချိန်တွင် တစ်ကြိမ်သာ အသက်သွင်းရမည်)
 */
export function installScopePatches() {
  if (window.__twScopePatched) return;
  window.__twScopePatched = true;

  // Native Methods များကို မူရင်း Backup အဖြစ် သိမ်းဆည်းခြင်း
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeSetTimeout = window.setTimeout.bind(window);

  // setInterval Patch
  window.setInterval = (...args) => {
    const id = nativeSetInterval(...args);
    if (currentScopeInstance) {
      currentScopeInstance.intervals.push(id);
    }
    return id;
  };

  // setTimeout Patch
  window.setTimeout = (...args) => {
    const id = nativeSetTimeout(...args);
    if (currentScopeInstance) {
      currentScopeInstance.timers.push(id);
    }
    return id;
  };

  // addEventListener Patch (Window & Document)
  [window, document].forEach((target) => {
    const nativeAddEventListener = target.addEventListener.bind(target);

    target.addEventListener = (type, fn, opt) => {
      // Router ၏ အသက်သွေးကြောဖြစ်သော Protected Events များကို Auto-Track ထဲ မထည့်ပါ
      if (currentScopeInstance && !PROTECTED_EVENTS.has(type)) {
        currentScopeInstance.events.push([target, type, fn, opt]);
      }
      return nativeAddEventListener(type, fn, opt);
    };
  });

  console.log("🛡️ Scope Engine: Protected Patches Installed");
}
