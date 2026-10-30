// Tags Twitch's volume slider so styles.css can lengthen it on hover.
const LENGTH_MULTIPLIER = 1.5; // extra slider length while hovered
const ZOOM = 1.5;              // matches the slider zoom in styles.css
const TRIM_SCREEN_PX = 80;     // shorten the hovered slider by this many on-screen px
const SLIDER = '[data-a-target="player-volume-slider"]';
const GROUP = ".player-controls__left-control-group";
const PLAYER = '[data-a-target="video-player"], .video-player';
const tagged = new WeakMap(); // input -> { targets, px }

function measure(input) {
  const base = parseFloat(getComputedStyle(input).width);
  if (!base) return null; // not laid out yet; the observer will retry

  // The input plus any wrappers that share its width get the longer width.
  const targets = [input];
  let el = input.parentElement;
  while (el && !el.classList.contains("player-controls__left-control-group")) {
    const w = parseFloat(getComputedStyle(el).width);
    if (Math.abs(w - base) > 4) break;
    targets.push(el);
    el = el.parentElement;
  }
  return { targets, base: base + "px", px: Math.round(base * LENGTH_MULTIPLIER - TRIM_SCREEN_PX / ZOOM) + "px" };
}

function apply(input) {
  let info = tagged.get(input);
  if (!info) {
    info = measure(input);
    if (!info) return;
    tagged.set(input, info);
  }
  // Re-apply every time in case Twitch re-renders and resets classes.
  for (const t of info.targets) {
    if (!t.classList.contains("tbc-slider-wrap")) t.classList.add("tbc-slider-wrap");
    if (t.style.getPropertyValue("--tbc-w") !== info.px) t.style.setProperty("--tbc-w", info.px);
    if (t.style.getPropertyValue("--tbc-base") !== info.base) t.style.setProperty("--tbc-base", info.base);
  }
  const top = info.targets[info.targets.length - 1];
  if (!top.classList.contains("tbc-slider-zoom")) top.classList.add("tbc-slider-zoom");
}

function scan() {
  document.querySelectorAll(SLIDER).forEach(apply);
  document.querySelectorAll(GROUP).forEach(addOnePercent);
  document.querySelectorAll(".video-player__overlay").forEach(addPauseZone);
}

new MutationObserver(scan).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["class"],
});
scan();

// --- Proximity scaling -------------------------------------------------------
// Grows the controls as the mouse gets close, reaching full size on contact.
const MAX_Z = 1.5;         // full size (matches ZOOM)
const APPROACH_PX = 100;   // start growing when the mouse is this far away

let mouse = null;
let frame = 0;

function update() {
  frame = 0;
  document.querySelectorAll(GROUP).forEach((g) => {
    let z = 1;
    if (mouse) {
      const r = g.getBoundingClientRect();
      if (r.width) {
        const dx = Math.max(r.left - mouse.x, 0, mouse.x - r.right);
        const dy = Math.max(r.top - mouse.y, 0, mouse.y - r.bottom);
        const d = Math.hypot(dx, dy);
        const t = Math.max(0, 1 - d / APPROACH_PX); // 0 far away, 1 on contact
        z = 1 + (MAX_Z - 1) * t;
      }
    }
    const v = z.toFixed(3);
    if (g.style.getPropertyValue("--tbc-z") !== v) g.style.setProperty("--tbc-z", v);
    // Once the controls are back to normal size, hide the 1% button too.
    if (z === 1) {
      const one = g.querySelector(".tbc-one--shown");
      if (one) hideOnePercent(one);
    }
  });
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(update);
}

window.addEventListener("mousemove", (e) => {
  mouse = { x: e.clientX, y: e.clientY };
  schedule();
}, { capture: true, passive: true });

document.addEventListener("mouseleave", () => {
  mouse = null;
  schedule();
});

// --- Click to pause/play ------------------------------------------------------
// Clicking anywhere on the video toggles playback. A double-click is left alone
// so Twitch's double-click-to-fullscreen still works. Where Twitch already does
// this itself (VODs), it's left to Twitch. Clicks on Twitch extensions on the
// video (Tangia, Crowd Control and the like: their icons on the right, the
// panels they open, their pop-ups) are left alone too; those are plain boxes
// rather than buttons, so they need naming here.
const PLAY_PAUSE = '[data-a-target="player-play-pause-button"]';
const IGNORE = 'button, a, input, textarea, select, label, [role="button"], [role="slider"], .tbc-editor, ' +
  '[role="menu"], [role="menuitem"], [role="dialog"], .player-controls, [data-a-target="player-settings-menu"], .tbc-pausezone, ' +
  '[class*="extensions-"], [class*="extension-"], iframe';
const DOUBLE_CLICK_MS = 250;

let pending = 0;

function toggle(player) {
  // Prefer Twitch's own button so its UI stays in sync.
  const btn = player.querySelector(PLAY_PAUSE);
  if (btn) return btn.click();
  const video = player.querySelector("video");
  if (video) video.paused ? video.play() : video.pause();
}

document.addEventListener("click", (e) => {
  if (e.button !== 0 || e.target.closest(IGNORE)) return;
  const player = e.target.closest(PLAYER);
  const video = player && player.querySelector("video");
  if (!video) return;
  const r = video.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;

  clicked(player, video, e.detail);
}, true);

function clicked(player, video, detail) {
  clearTimeout(pending);
  if (detail > 1) return; // second click of a double-click: cancel the toggle
  // Twitch pauses VODs on click by itself (but not live streams). If it already
  // has by the time we'd act, leave it, or we'd undo it.
  const wasPaused = video.paused;
  pending = setTimeout(() => {
    if (video.paused === wasPaused) toggle(player);
  }, DOUBLE_CLICK_MS);
}

// Clicks on Twitch extensions laid over the video (Tangia, Crowd Control and
// the like). Each runs in its own frame over the whole video, so its clicks
// never reach this page; but Twitch's frame around it reports every click here,
// with the tag and classes of what was clicked. A click on the extension's
// empty, see-through background (its page or its outermost box) pauses or
// plays; a click on anything it draws stays with the extension. Two quick
// clicks on the background go fullscreen, like on the plain video.
const EXT_BACKGROUND = /^(html|body|twitch-container|root|app|container|wrapper|overlay|main|content)$/i;
let lastExtClick = 0;

window.addEventListener("message", (e) => {
  if (e.origin !== "https://supervisor.ext-twitch.tv") return;
  const p = e.data?.action === "twitch-ext-user-action" && e.data.payload;
  if (!p || p.type !== "click") return;
  const tag = (p.elementTag || "").toUpperCase();
  const classes = (p.elementClass || "").trim().split(/\s+/).filter(Boolean);
  const background = tag === "HTML" || tag === "BODY" ||
    (/^(DIV|MAIN|SECTION)$/.test(tag) && classes.length && classes.every((c) => EXT_BACKGROUND.test(c)));
  if (!background) return;
  const frame = [...document.querySelectorAll("iframe")].find((f) => f.contentWindow === e.source);
  const player = frame?.closest(PLAYER);
  const video = player?.querySelector("video");
  if (!video) return;
  const now = Date.now();
  const double = now - lastExtClick < DOUBLE_CLICK_MS * 1.6;
  lastExtClick = double ? 0 : now;
  clicked(player, video, double ? 2 : 1);
  if (double) player.querySelector('[data-a-target="player-fullscreen-button"]')?.click();
});

// --- Pause corner ---------------------------------------------------------------
// A click spot in the video's bottom-left corner, just above the controls, that
// always pauses or plays. It sits on top of any extension laid over the video
// (Tangia, Crowd Control...), so it works even where clicks on the rest of the
// video go to the extension; only that corner of the extension can't be clicked.
// Hovering it shows a faint play/pause sign. Uses no top-level constants: scan()
// calls it while the page loads, before the ones below exist.
function addPauseZone(overlay) {
  if (overlay.querySelector(":scope > .tbc-pausezone")) return;
  const zone = document.createElement("div");
  zone.className = "tbc-pausezone";
  zone.title = "Pause / play";
  zone.innerHTML = '<svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true"><path d="M3 4l7 6-7 6z" fill="currentColor"/><path d="M12 4h2v12h-2zM16 4h2v12h-2z" fill="currentColor"/></svg>';
  overlay.append(zone);
}

document.addEventListener("click", (e) => {
  const zone = e.target.closest?.(".tbc-pausezone");
  if (!zone) return;
  e.preventDefault();
  e.stopPropagation();
  clearTimeout(pending);
  const player = zone.closest(PLAYER);
  if (player) toggle(player);
}, true);
document.addEventListener("dblclick", (e) => {
  if (e.target.closest?.(".tbc-pausezone")) e.stopPropagation();
}, true);

// --- 1% volume button ---------------------------------------------------------
// A small button between the speaker icon and the volume slider. It shows the
// current volume ("0%" while muted); clicking it sets the volume to 1%.
// It stays hidden until you hover the sound controls, then hides again when the
// controls shrink back to normal size (mouse moved away), or after ONE_HIDE_MS
// without you hovering or clicking it.
const ONE_HIDE_MS = 10000;
function addOnePercent(group) {
  if (group.querySelector(".tbc-one")) return;
  const mute = group.querySelector('[data-a-target="player-mute-unmute-button"]');
  const slider = group.querySelector(SLIDER);
  if (!mute || !slider) return;
  // The row holding both the speaker icon and the slider: put the button between them.
  let row = mute.parentElement;
  while (row && row !== group && !row.contains(slider)) row = row.parentElement;
  if (!row || row === group) return;
  const sliderPart = [...row.children].find((c) => c.contains(slider));
  if (!sliderPart) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tbc-one";
  b.title = "Set volume to 1%";
  b.setAttribute("aria-label", "Set volume to 1%");
  sliderPart.before(b);
  showVolume(group.closest(PLAYER)?.querySelector("video"));
}

// Write the player's volume on its button.
function showVolume(video) {
  const b = video?.closest(PLAYER)?.querySelector(".tbc-one");
  if (b) b.textContent = video.muted ? "0%" : Math.round(video.volume * 100) + "%";
}

// "volumechange" doesn't bubble, so listen for it on the way down instead.
document.addEventListener("volumechange", (e) => {
  if (e.target instanceof HTMLVideoElement) showVolume(e.target);
}, true);

async function setOnePercent(group) {
  const slider = group.querySelector(SLIDER);
  if (!slider) return;
  // Drive Twitch's own slider so the player, slider and saved volume all agree.
  // Moving it also unmutes; if Twitch hasn't after a moment, press mute ourselves.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setValue.call(slider, "0.01");
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  slider.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 100));
  const video = group.closest(PLAYER)?.querySelector("video");
  const mute = group.querySelector('[data-a-target="player-mute-unmute-button"]');
  if (video && video.muted && mute) mute.click();
}

document.addEventListener("click", (e) => {
  const b = e.target.closest(".tbc-one");
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  showOnePercent(b);
  setOnePercent(b.closest(GROUP));
}, true);

// Show the 1% button when you hover the sound controls or the button itself,
// and restart the countdown to hide it each time.
function showOnePercent(b) {
  b.classList.add("tbc-one--shown");
  clearTimeout(b.tbcHideTimer);
  b.tbcHideTimer = setTimeout(() => hideOnePercent(b), ONE_HIDE_MS);
}

function hideOnePercent(b) {
  clearTimeout(b.tbcHideTimer);
  b.classList.remove("tbc-one--shown");
}

document.addEventListener("mouseover", (e) => {
  const group = e.target.closest(GROUP);
  const b = group && group.querySelector(".tbc-one");
  if (!b) return;
  const mute = group.querySelector('[data-a-target="player-mute-unmute-button"]');
  const volume = mute && [...group.children].find((c) => c.contains(mute));
  if ((volume && volume.contains(e.target)) || b.contains(e.target)) showOnePercent(b);
}, true);

// ===== Quiet channel home =====================================================
// An offline channel's Home page autoplays a recent stream in the carousel at the
// top, with sound. Twitch keeps a separate mute setting just for that carousel
// (localStorage "video-muted": { default, carousel }), so keep that one on; live
// streams use "default" and aren't touched. If the carousel still starts with
// sound (the setting was read before this ran), mute it once per page visit;
// unmuting it yourself sticks for that visit.

function muteCarouselByDefault() {
  try {
    const prefs = JSON.parse(localStorage.getItem("video-muted") || "{}");
    if (prefs.carousel === true) return;
    prefs.carousel = true;
    localStorage.setItem("video-muted", JSON.stringify(prefs));
  } catch {
    // Storage blocked or unreadable: the play check below still mutes it.
  }
}
muteCarouselByDefault();

let quietedPage = null;
document.addEventListener("play", (e) => {
  const video = e.target;
  if (!(video instanceof HTMLVideoElement) || !video.closest(".persistent-player")) return;
  if (!document.querySelector('[data-a-target="home-offline-carousel"]')) return; // live, or not a channel home
  if (quietedPage === location.pathname) return;
  quietedPage = location.pathname;
  video.muted = true;
}, true);
