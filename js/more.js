// More tab: menu + user card + logout
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "./core/auth.js";
import { doc, getDoc } from "./core/fs.js";

const $ = (id) => document.getElementById(id);

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.go("login", true); return; }
  try {
    const snap = await getDoc(doc(db, "users", user.uid)); // fs.js cache — dashboard က ဖတ်ပြီးသားဆို 0 read
    const d = snap.exists() ? snap.data() : {};
    if ($("more-name")) $("more-name").textContent = d.teamName || d.managerName || user.email || "TW Manager";
    if ($("more-sub")) $("more-sub").textContent = [d.managerName, d.fplTeamId ? "#" + d.fplTeamId : ""].filter(Boolean).join(" · ") || user.email || "";
  } catch (_) {
    if ($("more-sub")) $("more-sub").textContent = user.email || "";
  }
});

$("more-logout")?.addEventListener("click", async () => {
  try { await signOut(auth); } catch (_) {}
  window.go("login", true);
});
