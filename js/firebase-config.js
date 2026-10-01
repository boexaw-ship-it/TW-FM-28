// ============================================
// TW Fantasy Official League
// Firebase Main Configuration (Production Project: tw-fm-28)
// Path: js/firebase-config.js
// ============================================

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "./core/auth.js";
import { getFirestore } from "./core/fs.js";

// Firebase Config for tw-fm-28
const firebaseConfig = {
  apiKey: "AIzaSyDrkzp70h477bMxjEwfodGUNqSkhBCh7bU",
  authDomain: "tw-fm-28.firebaseapp.com",
  projectId: "tw-fm-28",
  storageBucket: "tw-fm-28.firebasestorage.app",
  messagingSenderId: "1095591467276",
  appId: "1:1095591467276:web:d597f4a85e9dfbca79d129",
  measurementId: "G-DQG19DBXEK"
};

// Singleton Guard
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

console.log(`🔌 Connected to Firebase: tw-fm-28 [${app.name}]`);

// Export Services
export const auth = getAuth(app);
export const db = getFirestore(app);

// Lazy Loaded Analytics
export let analytics = null;
const loadAnalytics = async () => {
  try {
    const { getAnalytics, isSupported } = await import(
      "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js"
    );
    if (await isSupported()) {
      analytics = getAnalytics(app);
    }
  } catch (_) {}
};

if (typeof window !== "undefined") {
  const scheduleIdle = window.requestIdleCallback || ((cb) => setTimeout(cb, 3000));
  scheduleIdle(loadAnalytics, { timeout: 8000 });
}
