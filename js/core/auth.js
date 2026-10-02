// ============================================
// TW FM Core Authentication Service (Auth Wrapper)
// Features:
//  1) Sync User Auth State with LocalStorage (tw_auth flag)
//  2) Auto-clear Database In-memory Cache on Login/Logout (fs.js)
//  3) Safe Observer Support for onAuthStateChanged
//  4) Optional Scoped Tracking (Global Listener မသေစေရန် ကာကွယ်ခြင်း)
// ============================================

import * as A from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { track } from "./scope.js";
import { clearReadCache } from "./fs.js";

// Firebase Auth SDK official APIs အားလုံးကို တိုက်ရိုက် export ပေးခြင်း
export * from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const FLAG = "tw_auth";

/**
 * LocalStorage Flag အား Safe Set ပြုလုပ်ပေးသော Helper
 */
function setAuthFlag(isAuthed) {
  try {
    if (isAuthed) {
      localStorage.setItem(FLAG, "1");
    } else {
      localStorage.removeItem(FLAG);
    }
  } catch (_) {
    // Private Browsing သို့မဟုတ် Storage Quota ပြည့်နေပါက app မပျက်စေရန်
  }
}

/**
 * onAuthStateChanged Wrapper
 * @param {import("firebase/auth").Auth} auth 
 * @param {Function|Object} nextOrObserver 
 * @param {Function} [error] 
 * @param {Function} [completed] 
 * @param {boolean} [scoped=true] - true (default) ပေးမှသာ စာမျက်နှာပြောင်းချိန် track() ဖြင့် unsubscribe လုပ်မည်
 */
export function onAuthStateChanged(auth, nextOrObserver, error, completed, scoped = true) {
  const wrapped = (user) => {
    setAuthFlag(!!user);
    if (typeof nextOrObserver === "function") {
      return nextOrObserver(user);
    }
    if (nextOrObserver && typeof nextOrObserver.next === "function") {
      return nextOrObserver.next(user);
    }
  };

  const unsubscribe = A.onAuthStateChanged(
    auth,
    wrapped,
    typeof nextOrObserver === "object" ? nextOrObserver.error : error,
    typeof nextOrObserver === "object" ? nextOrObserver.complete : completed
  );

  // စာမျက်နှာအတွင်း သီးခြားခေါ်ယူပြီး scope ဖြင့် ရှင်းထုတ်လိုမှသာ track() လုပ်မည်
  return scoped && typeof track === "function" ? track(unsubscribe) : unsubscribe;
}

/**
 * Email & Password ဖြင့် Login ဝင်ခြင်း
 */
export async function signInWithEmailAndPassword(auth, email, password) {
  clearReadCache();
  const res = await A.signInWithEmailAndPassword(auth, email, password);
  setAuthFlag(true);
  return res;
}

/**
 * Account မှ ထွက်ခြင်း (Logout)
 */
export async function signOut(auth) {
  clearReadCache();
  setAuthFlag(false);
  return A.signOut(auth);
}

/**
 * လက်ရှိ Auth State အား Sync စစ်ဆေးပေးသော Helper
 */
export function isAuthenticated() {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch (_) {
    return false;
  }
}
