// Runs inside the embedded players and chats that split screen (splitview.js)
// opens. Each side only has half the screen, so:
// - the player's overlay (title and buttons at the top, the "intended for
//   certain audiences" tag, the controls at the bottom) is shrunk;
// - the chat drops the extras Twitch stacks above the messages (top gifters,
//   goals, hype trains, pinned messages), and its pop-up cards ("Sub for…",
//   drops) become small boxes in the corner instead of full-width banners.
//
// Only inside a player or chat embedded on twitch.tv itself, which is the split
// view; Twitch embeds on other websites are left alone.
(() => {
  if (window.top === window || location.ancestorOrigins?.[0] !== "https://www.twitch.tv") return;

  const PLAYER_CSS = `
    .video-player__overlay .top-bar,
    .video-player__overlay .player-controls,
    .disclosure-tool { zoom: 0.65; }
  `;
  const CHAT_CSS = `
    .chat-room__content > :has(~ [class*="chat-list--"]):not(:has(.community-highlight-stack__card)) {
      display: none !important;
    }
    .community-highlight-stack__card {
      zoom: 0.7;
      width: fit-content !important;
      max-width: 100%;
      margin-left: auto !important;
    }
  `;

  const style = document.createElement("style");
  style.textContent = location.hostname === "player.twitch.tv" ? PLAYER_CSS : CHAT_CSS;
  document.documentElement.append(style);

  // The split's sound menu tells each player to mute or unmute. Use the
  // player's own mute button so its controls stay in step; if the player
  // doesn't respond, set the video directly.
  if (location.hostname !== "player.twitch.tv") return;
  window.addEventListener("message", (e) => {
    if (e.origin !== "https://www.twitch.tv" || typeof e.data?.tbcSplitMuted !== "boolean") return;
    const want = e.data.tbcSplitMuted;
    const video = document.querySelector("video");
    if (!video) return;
    const muted = () => video.muted || video.volume === 0;
    if (muted() === want) return;
    document.querySelector('[data-a-target="player-mute-unmute-button"]')?.click();
    setTimeout(() => {
      if (muted() === want) return;
      video.muted = want;
      if (!want && video.volume === 0) video.volume = 0.5;
    }, 300);
  });
})();
