// 🧩 Shared Pitch/Squad Helpers — team.js နှင့် live.js နှစ်ဖိုင်စလုံးက
// တစ်ကြောင်းချင်း တူညီစွာ ရေးနေခဲ့ကြသော code များကို ဒီနေရာမှာ တစ်ခါတည်း ပေါင်းစည်းထားသည်
// (jersey path logic နှင့် squad filtering logic ပြောင်းလဲရန် လိုအပ်ရင် ဒီဖိုင်တစ်ခုတည်း
// ပြင်ရုံနဲ့ team.html + live.html နှစ်ခုစလုံးအလုပ်ဖြစ်စေရန်)

// 👕 ဂျာစီပုံရိပ် လမ်းကြောင်း ရယူခြင်း (team.js/live.js နှစ်ဖိုင်စလုံးတွင် တစ်ကြောင်းချင်း တူညီစွာ ရှိခဲ့သည်)
export function jerseyPath(p) {
  const pos = String(p.position || "").toUpperCase().trim();
  const folder = (pos === "GK" || pos === "GKP") ? "gk" : "outfield";
  const code = String(p.teamCode || "unknown").toLowerCase().trim();
  return `./public/jerseys/${folder}/${code}.png`;
}

// 🏟️ Squad picks array ကို starters (GK/DEF/MID/FWD) + subs (bench) အဖြစ် ခွဲထုတ်ခြင်း
// team.js ရဲ့ renderTeam() နှင့် live.js ရဲ့ renderPitch() နှစ်ခုစလုံးက တူညီသော filtering logic ကို သုံးနေခဲ့သည်
export function splitSquadByPosition(picks) {
  const starters = picks.filter(p => Number(p.multiplier ?? 1) > 0);
  const subs = picks.filter(p => Number(p.multiplier ?? 1) === 0);

  const normalizedPos = p => String(p.position || "").toUpperCase().trim();

  const gk = starters.filter(p => { const pos = normalizedPos(p); return pos === "GK" || pos === "GKP"; });
  const def = starters.filter(p => normalizedPos(p) === "DEF");
  const mid = starters.filter(p => normalizedPos(p) === "MID");
  const fwd = starters.filter(p => normalizedPos(p) === "FWD");

  return { starters, subs, gk, def, mid, fwd };
}
