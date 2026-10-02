// ============================================
// Strategy Draft — UI Controller (Tab Switcher)
// ============================================

function switchDraftTab(tabId) {
  // 1. Tab ခလုတ်များနှင့် Content များအားလုံး Active ဖယ်ရှားခြင်း
  document.querySelectorAll('.segment-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));

  // 2. ရွေးချယ်လိုက်သော Tab နှင့် Section အား Active ပြုလုပ်ခြင်း
  const targetBtn = document.getElementById('seg-' + tabId);
  const targetView = document.getElementById('view-' + tabId);

  if (targetBtn) targetBtn.classList.add('active');
  if (targetView) targetView.classList.remove('hidden');

  // 3. 💡 Matrix Tab ဖြစ်ပါက အပေါ်က Summary Bar ကို ဖျောက်ပြီး မျက်နှာပြင်အပြည့် ချဲ့ပေးခြင်း
  const summaryBar = document.getElementById('draft-summary-bar');
  if (summaryBar) {
    if (tabId === 'fixtures') {
      summaryBar.classList.add('hidden');
    } else {
      summaryBar.classList.remove('hidden');
    }
  }
}

// Global scope သို့ ချိတ်ဆက်ပေးခြင်း
window.switchDraftTab = switchDraftTab;
