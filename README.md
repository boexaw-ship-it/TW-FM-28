# TW FM — Single-page PWA + Android

## Structure
```
index.html          app shell (TW FM purple UI + bottom tab bar) — #view ထဲကို page တွေ လဲထည့်
views/*.html        page fragment (အရင် pages/*.html) · more.html = More tab menu
css/                style.css (global) + page css + inline/ (page ထဲက <style> ကို ခွဲထုတ်) + tailwind.css (built)
js/app.js           hash router (#/dashboard, #/team, #/live ...)
js/routes.js        route table (view + css + js)
js/core/            scope.js (listener cleanup) · fs.js (Firestore read-cache) · auth.js
js/inline/          page ထဲက inline <script> ခွဲထုတ်ထားတာ
scripts/            GitHub Actions sync (scripts/lib/diff-sync.js = write/read သက်သာ)
tools/build.js      Tailwind build + sw.js precache/version auto stamp
```

## Deploy
```
npm --prefix tools install      # တစ်ကြိမ်
node tools/build.js             # CSS ပြောင်း / file ထည့်ထုတ်တိုင်း run
```
sw.js ရဲ့ version ကို build က auto ပြောင်းပေးတယ် (CACHE_NAME လက်နဲ့ မတိုးရတော့ဘူး)။

## Page အသစ်ထည့်ရင်
1. `views/xxx.html` (body အတွင်းပိုင်းပဲ) · `css/xxx.css` · `js/xxx.js`
2. `js/routes.js` ထဲ `xxx: { title, body, css:[], classic:[], modules:[] }` ထည့်
3. လင့်ခ် = `href="#/xxx"` သို့ `window.go('xxx')`

## Firestore quota
- Client: `js/core/fs.js` က fixtures/scoutPlayers/users/standings... ကို TTL cache (page ပြောင်းတိုင်း ပြန်မဖတ်), onSnapshot ကို page ထွက်ရင် auto-unsubscribe
- Sync scripts: hash နဲ့ မပြောင်းတဲ့ doc ကို မရေးတော့ဘူး (`FORCE_FULL=1` ထည့်ရင် အကုန်ပြန်ရေး, register-sync `FULL_SCAN=1` ဆို users အကုန်စစ်)

## Tabs (bottom nav)
Home=dashboard · My Team=team · Points=live · Leagues=leagues · More=fixtures/scout/transfers/draft/twsuper/logout
Route တစ်ခုချင်းရဲ့ `tab` ကို js/routes.js မှာ သတ်မှတ် (null = tab bar ဖျောက်: login/register/pending)
Theme အရောင်: css/app.css :root (--ac = purple accent) · ကွင်း (pitch) = indigo gradient · Tailwind `emerald-*` = violet (tailwind.config.js)

## Firebase (project: tw-fm-28) — 1-document schema
```
fixturesMeta/allFixtures   fixtures[] + currentGameweek + gameweekSummary   (fixtures-sync.js)
scoutPlayers/allPlayers    players[] + fixturesByTeam                       (player-scout-sync.js)
leagues/{league1..5}       teams[] (standings + picks)                      (league-sync.js)
liveTeams/{fplId} · livePoints/{fplId}                                      (weekly-live-sync.js / register-sync.js)
```
- Frontend ကနေ `js/core/data.js` အတွင်းကပဲ ဖတ် (page တွေက `getFixturesSnap()` · `getScoutSnap()` · `getLeagueStandingsSnap()`)
- Home deadline / နောက်ဆုံးပြီးတဲ့ GW = `fixturesMeta.currentGameweek`
- `firestore.rules.example` = Security Rules နမူနာ

## GitHub Pages (boexaw-ship-it.github.io/TW-FM-28/)
`<base>` မသုံးတော့ဘူး — လမ်းကြောင်းအားလုံး relative (`./`) ဖြစ်လို့ sub-path / localhost / Capacitor မှာ အတူတူ အလုပ်လုပ်တယ်။
Push မတင်ခင် `node tools/build.js` ကို run (tailwind.css + sw.js version အသစ်)။
