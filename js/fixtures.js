/**
 * 📡 Local JSON မှ ဒေါင်လိုက်စီထားသော ပွဲစဉ်ဒေတာများကို ဖတ်ယူပြီး
 * ဇယားကွက်ထဲသို့ Dynamic အရောင်ခြယ်စနစ်ဖြင့် ထည့်သွင်းပေးမည့် Function
 */
export function loadFixturesFromLocalJSON() {
  fetch('../fixtures.json')
    .then(res => res.json())
    .then(data => {
      data.forEach(t => {
        const team = t.teamCode;
        
        if (t.fixtures && Array.isArray(t.fixtures)) {
          t.fixtures.forEach(f => {
            const gw = f.gw;
            const cell = document.getElementById(`${team}-gw${gw}`);
            
            if (cell) {
              const opponentText = f.opponent ? String(f.opponent).trim().toUpperCase() : ""; // 👈 စာလုံးအကြီးအဖြစ် ကြိုပြောင်းထားခြင်း
              const isHome = f.isHome;
              const fdrValue = f.fdr !== undefined ? String(f.fdr).trim() : "3";
              
              cell.style.padding = "0px"; 
              cell.style.borderColor = "rgba(45,51,102,0.15)";
              
              // 1️⃣ BGW (Blank Game Week) Logic
              if (opponentText === "BLANK" || opponentText === "—" || opponentText === "") {
                cell.innerHTML = `<div class="w-full h-full bg-gray-800 text-gray-500 font-bold flex items-center justify-center" style="min-height:38px; font-size:10px;">BLANK</div>`;
              }
              
              // 2️⃣ DGW (Double Game Week) Multi-Color Split Logic
              else if (fdrValue.includes("+") && opponentText.includes("+")) {
                const partsFDR = fdrValue.split("+");
                const partsText = opponentText.split("+");
                
                const fdrA = partsFDR[0].trim();
                const fdrB = partsFDR[1].trim();
                const textA = partsText[0].trim();
                const textB = partsText[1].trim();
                
                const getColor = (fdr) => (fdr === "1" || fdr === "2") ? "#22c55e" : (fdr === "3" ? "#eab308" : "#ef4444");
                const getTextColor = (fdr) => fdr === "3" ? "#0b0d1a" : "#ffffff";

                cell.innerHTML = `
                  <div class="flex w-full h-full font-bold" style="min-height:38px; font-size:8px; line-height:1.1;">
                    <div class="w-1/2 flex items-center justify-center p-1 border-r border-black/10" style="background-color:${getColor(fdrA)}; color:${getTextColor(fdrA)};">${textA}</div>
                    <div class="w-1/2 flex items-center justify-center p-1" style="background-color:${getColor(fdrB)}; color:${getTextColor(fdrB)};">${textB}</div>
                  </div>
                `;
              } 
              
              // 3️⃣ Normal Single Match Logic
              else {
                // 💡 ပြင်ဆင်လိုက်သည့်အပိုင်း: အဝေးကွင်းလည်း .toLowerCase() မလုပ်တော့ဘဲ စာလုံးအကြီးအတိုင်း ကွက်တိပြသခြင်း
                let matchText = isHome ? `${opponentText} (H)` : `${opponentText} (A)`;
                
                cell.innerHTML = `<div class="w-full h-full fdr-${fdrValue} flex items-center justify-center" style="min-height:38px; font-size:10px; padding:10px 4px;">${matchText}</div>`;
              }
            }
          });
        }
      });
    })
    .catch(err => console.error("Error loading fixtures JSON:", err));
}

/**
 * 🔍 Dropdown Filter
 */
export function buildCustomDropdownOptions(plTeams) {
  const listEl = document.getElementById("team-options-list");
  if (listEl) {
    listEl.innerHTML = plTeams.map(t => `
      <div onclick="selectTeamFilter('${t.code}', '${t.name}')" class="p-3 rounded-xl flex items-center justify-between cursor-pointer active:scale-[0.98] transition border border-[#3a3f7a]/30" style="background:#2d3366;">
        <span class="text-xs font-bold text-white">${t.name}</span>
        <span class="text-xs font-bold" style="color:#8c6dff;">⚽</span>
      </div>
    `).join("");
  }
}
