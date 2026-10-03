// ============================================
// TW Fantasy Official League — Player Photo Resolver Engine
// Season: 2026-2027 Official Premier League
// Features:
//   - Clean Numeric Asset Code Extraction
//   - CDN Cache-Busting (?v=2026_27) for Instant Jersey Updates
//   - 3-Tier Fallback Pipeline (CDN HD -> Local Club Badge -> SVG Fallback)
// Standards: UI Design Knowledge Pack (Sports UI & Large Player Images)
// ============================================

/**
 * 📸 Clean Numeric Photo Code Parser
 * @param {Object} player - Player object from Firestore or FPL API
 * @returns {string} - Clean numeric code (e.g., "493392", "223094")
 */
export function extractCleanPhotoCode(player) {
  if (!player) return "";

  // ၁။ ရရှိနိုင်သော Photo Keys များကို ဦးစားပေးအလိုက် ရှာဖွေခြင်း
  const rawCandidate = player.photoCode 
    ?? player.photo 
    ?? player.photo_code 
    ?? player.code 
    ?? player.id 
    ?? "";

  // ၂။ ".jpg", ".png", "jpeg" extension များနှင့် prefix "p" များကို Regex ဖြင့် သန့်စင်ခြင်း
  return String(rawCandidate)
    .replace(/\.(png|jpg|jpeg)$/i, "")
    .replace(/^p/i, "")
    .trim();
}

/**
 * 🌟 Premier League Official 250x250 HD Photo URL Builder (Cache-Busted)
 * @param {Object} player - Player object
 * @returns {string} - Direct CDN URL with 2026-27 Version Query
 */
export function getPlayerPhotoUrl(player) {
  if (!player) return "";

  const photoCode = extractCleanPhotoCode(player);
  if (!photoCode || photoCode === "undefined" || photoCode === "null") {
    return "";
  }

  // 💡 Browser Cache ကြောင့် ပုံဟောင်း မပြစေရန် ?v=2026_27 Cache-Buster ထည့်သွင်းခြင်း
  return `https://resources.premierleague.com/premierleague/photos/players/250x250/p${photoCode}.png?v=2026_27`;
}

/**
 * 🛡️ 3-Tier Graceful Image Renderer Helper
 * @param {Object} player - Player object
 * @param {string} localClubBadge - Fallback Club Badge URL (e.g., "./assets/badges/che.png")
 * @param {string} customClass - Optional CSS Classes
 * @returns {string} - HTML <img> Element with Onerror Handler
 */
export function renderPlayerImageHtml(player, localClubBadge = "./assets/badges/che.png", customClass = "player-card-photo") {
  const photoUrl = getPlayerPhotoUrl(player);
  const playerName = String(player?.name || "Player").replace(/[&<>"']/g, "");

  // ပုံ လုံးဝ မရှိပါက Local Club Badge ကို တိုက်ရိုက်ပြသခြင်း
  if (!photoUrl) {
    return `
      <img src="${localClubBadge}" 
           alt="${playerName}" 
           loading="lazy" 
           class="${customClass}" 
           style="max-height: 65%; object-fit: contain;" />
    `;
  }

  return `
    <img src="${photoUrl}" 
         alt="${playerName}" 
         loading="lazy" 
         class="${customClass}" 
         onerror="
           if (!this.dataset.triedBadge) {
             this.dataset.triedBadge = '1';
             this.src = '${localClubBadge}';
             this.style.maxHeight = '65%';
             this.style.objectFit = 'contain';
           }
         " />
  `;
}
