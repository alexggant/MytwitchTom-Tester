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
// this itself (VODs), it's left to Twitch.
const PLAY_PAUSE = '[data-a-target="player-play-pause-button"]';
const IGNORE = 'button, a, input, textarea, select, label, [role="button"], [role="slider"], .tbc-editor, ' +
  '[role="menu"], [role="menuitem"], [role="dialog"], .player-controls, [data-a-target="player-settings-menu"]';
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

  clearTimeout(pending);
  if (e.detail > 1) return; // second click of a double-click: cancel the toggle
  // Twitch pauses VODs on click by itself (but not live streams). If it already
  // has by the time we'd act, leave it, or we'd undo it.
  const wasPaused = video.paused;
  pending = setTimeout(() => {
    if (video.paused === wasPaused) toggle(player);
  }, DOUBLE_CLICK_MS);
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
