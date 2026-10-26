// A bigger, easier-to-grab playhead for VODs. It sits on the seek bar where the
// video is, grows as the mouse gets close (like the player buttons do), and can
// be dragged: the time shows above it while you drag, and the video jumps
// there when you let go.
//
// Twitch's own playhead only appears while you hover the bar, so this one
// replaces it (Twitch's is hidden in styles.css). VOD markers stay on top of it.
//
// Wrapped so its names don't clash with the other scripts.
(() => {
  const SEEKBAR = '[data-a-target="player-seekbar"]';
  const BAR = ".seekbar-bar";
  const MAX_SCALE = 2.2;   // size on contact, relative to normal
  const APPROACH_PX = 100; // start growing when the mouse is this far away

  let knob = null;
  let mouse = null;
  let frame = 0;
  let drag = null; // { t } while dragging

  const video = () => document.querySelector("video");

  function duration() {
    const v = video();
    return v && isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
  }

  function formatTime(s) {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  }

  // The visible timeline (Twitch keeps a second, hidden copy of the controls).
  function bar() {
    return [...document.querySelectorAll(`${SEEKBAR} ${BAR}`)].find((b) => b.getBoundingClientRect().width > 0);
  }

  function timeAt(b, clientX) {
    const r = b.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return f * duration();
  }

  function ensure() {
    const b = /^\/videos\/\d+/.test(location.pathname) && duration() ? bar() : null;
    if (!b) {
      if (knob && !drag) {
        knob.remove();
        knob = null;
      }
      return null;
    }
    if (!knob) {
      knob = document.createElement("div");
      knob.className = "tbc-knob";
      knob.innerHTML = `<div class="tbc-knob__dot"></div><div class="tbc-knob__time"></div>`;
    }
    if (knob.parentElement !== b) b.append(knob);
    return b;
  }

  function place(t) {
    knob.style.left = (t / duration()) * 100 + "%";
  }

  function update() {
    frame = 0;
    const b = ensure();
    if (!b) return;
    if (!drag) place(video().currentTime);
    // Grow with closeness, measured from the mouse to the playhead's centre.
    let scale = 1;
    if (drag) scale = MAX_SCALE;
    else if (mouse) {
      const r = knob.getBoundingClientRect();
      const d = Math.hypot(mouse.x - r.left, mouse.y - r.top);
      scale = 1 + (MAX_SCALE - 1) * Math.max(0, 1 - d / APPROACH_PX);
    }
    const v = scale.toFixed(3);
    if (knob.style.getPropertyValue("--tbc-k") !== v) knob.style.setProperty("--tbc-k", v);
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
  // Follow the video as it plays or seeks.
  for (const type of ["timeupdate", "seeked", "durationchange"]) {
    document.addEventListener(type, schedule, true);
  }

  // --- Dragging -------------------------------------------------------------------
  // Handled on window in the capture phase and stopped there, so Twitch's seek bar
  // doesn't also react to the press.

  window.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.target.closest?.(".tbc-knob__dot")) return;
    e.preventDefault();
    e.stopPropagation();
    drag = { t: video().currentTime };
    knob.classList.add("tbc-knob--drag");
    schedule();
  }, true);

  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    e.stopPropagation();
    const b = bar();
    if (!b) return;
    drag.t = timeAt(b, e.clientX);
    place(drag.t);
    knob.querySelector(".tbc-knob__time").textContent = formatTime(drag.t);
  }, true);

  window.addEventListener("pointerup", (e) => {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    const v = video();
    if (v) v.currentTime = drag.t;
    drag = null;
    knob.classList.remove("tbc-knob--drag");
    schedule();
  }, true);

  for (const type of ["mousedown", "mouseup", "click"]) {
    window.addEventListener(type, (e) => {
      if (drag || e.target.closest?.(".tbc-knob__dot")) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  // Twitch redraws its controls; put the playhead back when it does.
  const observer = new MutationObserver(() => {
    try {
      if (!chrome.runtime?.id) return observer.disconnect();
    } catch {
      return observer.disconnect();
    }
    if (!knob || !knob.isConnected) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
