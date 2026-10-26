// Split screen. While you're watching a channel, hover another channel in the
// left sidebar and Twitch's hover box gets a "Split screen" pill. Click it and
// the area right of the left sidebar splits in two: the stream you were on and
// the new one side by side, each with its own chat underneath.
//
// Both sides are Twitch's own embeddable player and chat, so you stay signed in
// and can chat in either. The original page's video is paused while split, so
// you don't hear it twice. The new stream starts muted; unmute it in its player.
// Hovering the videos shows a sound menu on the line between them: hear only
// the left stream, both, or only the right. "×" on a side closes it: close the new one to go back to normal, or the
// original one to switch over to the new channel.
//
// Wrapped so its names don't clash with the other scripts.
(() => {
  if (window.top !== window) return;

  const TOOLTIP = '[class*="online-side-nav-channel-tooltip"]';
  const CARD = ".side-nav-card";
  const SIDEBAR = '[data-a-target="side-nav-bar"]';
  const TOP_NAV = 'nav[data-a-target="top-nav-container"]';

  let hovered = null; // channel of the sidebar card under the mouse
  let split = null;   // { el, menu, channels: [a, b], path, resumeVideo, audio }

  // The channel whose page you're on, if it's a channel page.
  function currentChannel() {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts.length === 1 && /^[a-z0-9_]+$/i.test(parts[0]) &&
      !/^(directory|videos|settings|search|subscriptions|inventory|wallet|drops)$/i.test(parts[0])
      ? parts[0].toLowerCase()
      : null;
  }

  // ===== The pill in the sidebar hover box ===========================================

  document.addEventListener("mouseover", (e) => {
    const a = e.target.closest?.(`${CARD} a[href^="/"]`);
    if (a) hovered = a.getAttribute("href").slice(1).toLowerCase();
  }, true);

  function addPill() {
    const tip = document.querySelector(TOOLTIP);
    if (!tip || !hovered) return;
    const here = currentChannel();
    let pill = tip.querySelector(".tbc-split-pill");
    // Only while watching someone, and not for the channel you're already on.
    if (!here || hovered === here || split) {
      pill?.remove();
      return;
    }
    if (!pill) {
      pill = document.createElement("button");
      pill.type = "button";
      pill.className = "tbc-split-pill";
      pill.textContent = "Split screen";
      pill.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSplit(currentChannel(), pill.dataset.channel);
      });
      tip.append(pill);
    }
    pill.dataset.channel = hovered;
    pill.title = `Watch ${hovered} side by side with ${here}`;
  }

  // ===== The split view ==============================================================

  function column(channel, sound) {
    const col = document.createElement("div");
    col.className = "tbc-split__col";
    col.dataset.channel = channel;
    const head = document.createElement("div");
    head.className = "tbc-split__head";
    const name = document.createElement("span");
    name.textContent = channel;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "tbc-split__close";
    close.textContent = "×";
    close.title = `Close ${channel}`;
    close.addEventListener("click", () => closeSide(channel));
    head.append(name, close);
    const player = document.createElement("iframe");
    player.className = "tbc-split__player";
    player.allow = "autoplay; fullscreen";
    player.allowFullscreen = true;
    player.src = `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${location.hostname}&autoplay=true&muted=${!sound}`;
    const chat = document.createElement("iframe");
    chat.className = "tbc-split__chat";
    chat.src = `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?parent=${location.hostname}&darkpopout`;
    col.append(head, player, chat);
    return col;
  }

  // Cover everything right of the left sidebar and below the top bar.
  function place() {
    if (!split) return;
    const side = document.querySelector(SIDEBAR)?.getBoundingClientRect();
    const top = document.querySelector(TOP_NAV)?.getBoundingClientRect();
    split.el.style.left = (side ? side.right : 0) + "px";
    split.el.style.top = (top ? top.bottom : 0) + "px";
    // The sound menu sits on the line between the two videos, halfway down them.
    const box = split.el.getBoundingClientRect();
    const video = split.el.querySelector(".tbc-split__player").getBoundingClientRect();
    split.menu.style.left = video.right - box.left + 1 + "px";
    split.menu.style.top = video.top - box.top + video.height / 2 + "px";
  }

  // ===== Which side you hear ===========================================================

  // Speaker icons: a speaker facing right, mirrored for one facing left.
  const SPEAKER = '<path d="M1 6h3l4-4v12l-4-4H1z" fill="currentColor"/><path d="M10.5 5.5q2 2.5 0 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';
  const right = (x) => `<g transform="translate(${x} 0)">${SPEAKER}</g>`;
  const left = (x) => `<g transform="translate(${x + 12} 0) scale(-1 1)">${SPEAKER}</g>`;
  const LINE = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  const AUDIO_MODES = [
    { mode: "left", title: "Only hear the left stream", icon: `<path d="M11 8H2M5.5 4.5 2 8l3.5 3.5" ${LINE}/>${right(15)}` },
    { mode: "both", title: "Hear both streams", icon: `${left(0)}<path d="M15 2v12" ${LINE}/>${right(18)}` },
    { mode: "right", title: "Only hear the right stream", icon: `${left(0)}<path d="M19 8h9M24.5 4.5 28 8l-3.5 3.5" ${LINE}/>` },
  ];

  function audioMenu() {
    const menu = document.createElement("div");
    menu.className = "tbc-split__audio";
    for (const { mode, title, icon } of AUDIO_MODES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tbc-split__audio-btn";
      b.dataset.mode = mode;
      b.title = title;
      b.innerHTML = `<svg viewBox="0 0 30 16" width="21" height="11" aria-hidden="true">${icon}</svg>`;
      b.addEventListener("click", () => setAudio(mode));
      menu.append(b);
    }
    return menu;
  }

  // Tell each player (splitframes.js, running inside it) to mute or unmute.
  function setAudio(mode) {
    if (!split) return;
    split.audio = mode;
    const [pa, pb] = split.el.querySelectorAll(".tbc-split__player");
    pa.contentWindow?.postMessage({ tbcSplitMuted: mode === "right" }, "https://player.twitch.tv");
    pb.contentWindow?.postMessage({ tbcSplitMuted: mode === "left" }, "https://player.twitch.tv");
    for (const b of split.menu.children) b.classList.toggle("tbc-split__audio-btn--on", b.dataset.mode === mode);
  }

  function openSplit(a, b) {
    if (!a || !b || split) return;
    const el = document.createElement("div");
    el.className = "tbc-split";
    const menu = audioMenu();
    el.append(column(a, true), column(b, false), menu);
    document.body.append(el);
    // Pause the page's own player underneath so it isn't heard twice.
    const video = document.querySelector("video");
    const resumeVideo = !!video && !video.paused;
    if (video) video.pause();
    split = { el, menu, channels: [a, b], path: location.pathname, resumeVideo, audio: "left" };
    // The left stream starts with sound and the right one muted.
    for (const btn of menu.children) btn.classList.toggle("tbc-split__audio-btn--on", btn.dataset.mode === "left");
    place();
  }

  function closeSplit() {
    if (!split) return;
    const { el, resumeVideo } = split;
    split = null;
    el.remove();
    if (resumeVideo) document.querySelector("video")?.play().catch(() => {});
  }

  // Close one side. The other one carries on as a normal Twitch page.
  function closeSide(channel) {
    if (!split) return;
    const [a, b] = split.channels;
    const keep = channel === a ? b : a;
    closeSplit();
    if (keep !== currentChannel()) location.href = `/${keep}`;
  }

  window.addEventListener("resize", place);

  // Esc closes the split (back to the stream you were on).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && split && !e.target.closest?.("input, textarea, [contenteditable='true']")) closeSplit();
  });

  let pending = 0;
  const observer = new MutationObserver(() => {
    try {
      if (!chrome.runtime?.id) return observer.disconnect();
    } catch {
      return observer.disconnect();
    }
    if (pending) return;
    pending = setTimeout(() => {
      pending = 0;
      // Leaving the page (Twitch changes pages without reloading) ends the split.
      if (split && location.pathname !== split.path) closeSplit();
      addPill();
      place();
    }, 150);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
