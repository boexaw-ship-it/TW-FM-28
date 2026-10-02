// ============================================
// TW FM — App Shell / Hash Router (single index.html)
//  #/dashboard  #/team  #/live ...   (views/*.html = fragment၊ css/*.css + js/*.js ခွဲထား)
// ============================================
import { ROUTES } from "./routes.js";
import { beginScope, endScope, installScopePatches } from "./core/scope.js";

// shell ကိုယ်တိုင်သုံးမယ့် timer/event ကို patch မလုပ်ခင် မူရင်းကို ယူထား
const _setTimeout = window.setTimeout.bind(window);
const _clearTimeout = window.clearTimeout.bind(window);
installScopePatches();

const view = document.getElementById("view");
const bar = document.getElementById("bar");
const boot = document.getElementById("boot");
const twLink = document.getElementById("tw-utilities");
const tabbar = document.getElementById("tabbar");
const tabLinks = Array.from(tabbar.querySelectorAll("a"));
const baseBody = new Set(Array.from(document.body.children)); // shell element တွေ (cleanup မှာ မဖျက်)

function setTab(tab) {
  tabbar.hidden = !tab;
  tabLinks.forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
}

const frags = new Map();     // name -> html (memory)
const linkSets = new Map();  // name -> [<link>]
let navId = 0, loadN = 0, scope = null, barTimer = null;

const DEFAULT_AUTHED = "dashboard";
const DEFAULT_GUEST = "login";

// ---------- public navigation API ----------
window.go = function (name, replace = false) {
  if (name === "login") replace = true; // auth guard redirect တွေက back-loop မဖြစ်စေဖို့
  const h = "#/" + name;
  if (location.hash === h) return route();
  if (replace) location.replace(h); else location.hash = h;
};

// ---------- helpers ----------
function parseHash() {
  return (location.hash.replace(/^#\/?/, "").split(/[?/]/)[0] || "").trim();
}

async function getFragment(name) {
  if (frags.has(name)) return frags.get(name);
  const r = await fetch(`./views/${name}.html`);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const t = await r.text();
  frags.set(name, t);
  return t;
}

function ensureCss(name, def) {
  if (linkSets.has(name)) return Promise.resolve();
  const links = def.css.map((href) => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "./" + href;
    l.media = "not all"; // load လုပ်ပေမယ့် page မပြောင်းခင်အထိ မသက်ရောက်စေဘူး
    l.dataset.route = name;
    document.head.insertBefore(l, twLink); // tailwind utilities က နောက်ဆုံးမှာ ရှိနေရမယ်
    return l;
  });
  linkSets.set(name, links);
  return Promise.all(links.map((l) => new Promise((res) => {
    l.addEventListener("load", res, { once: true });
    l.addEventListener("error", res, { once: true });
    _setTimeout(res, 4000);
  })));
}

function activateCss(name) {
  linkSets.forEach((links, n) => links.forEach((l) => { l.media = n === name ? "all" : "not all"; }));
}

function cleanBodyExtras() {
  Array.from(document.body.children).forEach((el) => { if (!baseBody.has(el)) el.remove(); });
}

function runClassic(path) {
  return new Promise((res) => {
    const s = document.createElement("script");
    s.src = `./${path}?r=${++loadN}`;
    s.onload = s.onerror = () => { s.remove(); res(); };
    document.head.appendChild(s);
  });
}

function progress(on) {
  _clearTimeout(barTimer);
  if (on) { barTimer = _setTimeout(() => { bar.className = "on"; }, 180); }
  else if (bar.className === "on") { bar.className = "done"; _setTimeout(() => { bar.className = ""; }, 250); }
  else bar.className = "";
}

function showError(name) {
  view.innerHTML = `<div class="tw-err"><p>စာမျက်နှာ ဖွင့်မရပါ — အင်တာနက် စစ်ပြီး ထပ်ကြိုးစားပါ။</p><button id="tw-retry">ပြန်ကြိုးစားမယ်</button></div>`;
  document.getElementById("tw-retry").onclick = () => route();
}

// ---------- router ----------
async function route() {
  const id = ++navId;
  let name = parseHash();
  if (!ROUTES[name]) name = localStorage.getItem("tw_auth") === "1" ? DEFAULT_AUTHED : DEFAULT_GUEST;
  const def = ROUTES[name];
  progress(true);

  let html;
  try {
    [html] = await Promise.all([getFragment(name), ensureCss(name, def)]);
  } catch (e) {
    console.warn("[router] load failed:", name, e);
    if (id === navId) { progress(false); showError(name); boot.classList.add("hide"); }
    return;
  }
  if (id !== navId) return; // အခြား page ကို ထပ်နှိပ်လိုက်ပြီ

  // ----- swap (တစ်ချက်တည်း) -----
  endScope(scope);
  cleanBodyExtras();
  view.innerHTML = html;
  view.className = def.body || "";
  setTab(def.tab);
  document.title = def.title;
  activateCss(name);
  window.scrollTo(0, 0);
  scope = beginScope();

  try {
    for (const c of def.classic) await runClassic(c);
    for (const m of def.modules) await import(`./${m.replace(/^js\//, "")}?r=${++loadN}`);
  } catch (e) {
    console.error("[router] page script error:", name, e);
  }
  if (id === navId) { progress(false); boot.classList.add("hide"); _setTimeout(() => boot.remove(), 400); }
}

window.addEventListener("hashchange", route);
route();

// ---------- Service Worker ----------
// Deploy အသစ်တင်ရင် SW အဟောင်း cache (ဥပမာ dashboard.js/style.css အဟောင်း) ကို သုံးနေတာမျိုး မဖြစ်အောင်:
// SW အသစ် activate ဖြစ်တာနဲ့ page ကို တစ်ကြိမ် auto reload လုပ်ပေးတယ်
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return; // ပထမဆုံး install မှာ reload မလုပ်
    reloaded = true;
    location.reload();
  });
  const reg = () => navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
    .then((r) => {
      r.update().catch(() => {});
      document.addEventListener("visibilitychange", () => { if (!document.hidden) r.update().catch(() => {}); });
    })
    .catch((e) => console.warn("SW register failed:", e));
  if (document.readyState === "complete") reg(); else window.addEventListener("load", reg, { once: true });
}
console.log("%cTW FM build", "color:#8c6dff;font-weight:bold", document.querySelector('link[href*="app.css"]') ? "spa" : "?");
