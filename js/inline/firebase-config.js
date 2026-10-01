
// ============================================
// TW Fantasy Official League
// Firebase Main Configuration (tw-fm-28)
// Path: js/firebase-config.js
// ============================================

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "./core/auth.js";
import { getFirestore } from "./core/fs.js";

const firebaseConfig = {
  apiKey: "AIzaSyDrkzp70h477bMxjEwfodGUNqSkhBCh7bU",
  authDomain: "tw-fm-28.firebaseapp.com",
  projectId: "tw-fm-28",
  storageBucket: "tw-fm-28.firebasestorage.app",
  messagingSenderId: "1095591467276",
  appId: "1:1095591467276:web:d597f4a85e9dfbca79d129",
  measurementId: "G-DQG19DBXEK"
};

// Singleton App Instance
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Database & Authentication Export
export const auth = getAuth(app);
export const db = getFirestore(app);

console.log("🔌 Connected to Firebase: Project (tw-fm-28)");
