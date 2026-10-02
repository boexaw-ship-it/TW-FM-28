const cardColorObserver = new MutationObserver(() => {
      document.querySelectorAll("#player-list > div").forEach(card => {
        const badge = card.querySelector('span[style*="background"]');
        if (badge) {
          const bgStyle = badge.style.backgroundColor;
          if (bgStyle.includes("1d4ed8") || badge.innerText.includes("GK")) {
            card.style.setProperty('border-left', '6px solid #1d4ed8', 'important');
          } else if (bgStyle.includes("dc2626") || badge.innerText.includes("DEF")) {
            card.style.setProperty('border-left', '6px solid #dc2626', 'important');
          } else if (bgStyle.includes("eab308") || badge.innerText.includes("MID")) {
            card.style.setProperty('border-left', '6px solid #eab308', 'important');
          } else if (bgStyle.includes("16a34a") || badge.innerText.includes("FWD")) {
            card.style.setProperty('border-left', '6px solid #16a34a', 'important');
          }
        }
      });
    });
    cardColorObserver.observe(document.getElementById("player-list"), { childList: true, subtree: true });
