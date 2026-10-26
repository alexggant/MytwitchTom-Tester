// Collects channel points bonuses automatically. While you watch, Twitch
// shows a "Claim Bonus" button next to your channel points every so often;
// this clicks it as soon as it appears. It's the same click you'd make
// yourself, on the button Twitch puts there.
//
// Wrapped so its names don't clash with the other scripts.
(() => {
  const SUMMARY = '[data-test-selector="community-points-summary"], .community-points-summary';
  const BONUS = 'button[aria-label="Claim Bonus"], .claimable-bonus__icon';

  let lastClick = 0;

  function claim() {
    const icon = document.querySelector(`:is(${SUMMARY}) :is(${BONUS})`);
    if (!icon) return;
    const button = icon.closest("button") || icon;
    // One click per bonus: Twitch takes a moment to remove the button.
    if (Date.now() - lastClick < 3000) return;
    lastClick = Date.now();
    button.click();
  }

  const observer = new MutationObserver(() => {
    try {
      if (!chrome.runtime?.id) return observer.disconnect();
    } catch {
      return observer.disconnect();
    }
    claim();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  claim();
})();
