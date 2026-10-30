// Auto Streak Saver. When Twitch's left sidebar shows "Save your Streak" (a
// channel whose watch streak is at risk, linking to one of its VODs), this opens
// that VOD in a separate window, minimized and with its tab muted, sets the
// player to 1% (so Twitch sees it playing with sound), plays it until Twitch
// says the streak has been saved, plays 20 seconds more, and closes. Your
// Twitch tab then shows a pop-up saying it's saved and on which channel.
//
// Three pills above the "Save your Streak" row pick how it behaves:
//   Auto Saver    runs by itself whenever "Save your Streak" appears (and when clicked)
//   Streak Saver  only runs when you click "Save your Streak"
//   Off           does nothing; the row works like normal Twitch
//
// It counts as saved when Twitch says so ("Your … streak … is saved!"). If that
// hasn't happened by the usual time it takes plus 20 seconds, it gives up and
// your Twitch tab shows a pop-up saying so instead.
//
// background.js opens and closes the saver window (pages can't open windows
// without a click) and tells this script, running inside it, that it's the one
// to do the watching. 1% volume uses setOnePercent() from content.js, which runs
// in the same page before this script.
//
// Saved in chrome.storage.local:
//   "streakSaverMode"   "auto" | "manual" | "off" (the pills)
//   "streakSaverState"  { running: { channel, at } | null, done: { channel: timeMs } }
//   "streakSaverFailed" { channel, at } while the gave-up pop-up is waiting to be seen
//   "streakSaverSaved"  { channel, text, at } while the saved pop-up is waiting to be seen
//
// Wrapped so its names don't clash with the other scripts, and only started if
// it's switched on (settings.js).
whenOn("saver", "Streak Saver", () => {
  if (window.top !== window) return;

  const ROW = 'a[class*="saveYourStreakSideNavRow"]';
  const AT_RISK = '[role="group"][aria-label="Watch Streaks at risk"]';
  const STORIES = '[class*="storiesLeftNavSection"]';
  const EXTRA_MS = 20 * 1000;              // keep playing this long after it's saved
  const USUAL_SAVE_MS = 5 * 60 * 1000;     // how long Twitch usually takes (it took ~5 min in testing)
  const GIVE_UP_MS = USUAL_SAVE_MS + EXTRA_MS; // no "saved" by then: give up and say so
  const REDO_AFTER_MS = 6 * 60 * 60 * 1000; // don't auto-save the same channel again for this long
  const STALE_MS = 35 * 60 * 1000;         // a "running" note older than this is ignored
  const SAVED_RE = /streak[^.!\n]{0,40}\bsaved\b|\bsaved\b[^.!\n]{0,40}streak/i;
  const CHAT = '.video-chat, [class*="chat-scrollable-area"], [class*="chat-room"], .tbc-saver';

  let mode = "auto"; // "auto" | "manual" | "off"
  const MODES = [["auto", "Auto Saver"], ["manual", "Streak Saver"], ["off", "Off"]];
  let isSaver = false; // set once background.js says this tab is the saver window

  function alive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  const getState = (cb) =>
    chrome.storage.local.get(["streakSaverMode", "streakSaverAuto", "streakSaverState"], (d) => {
      // Earlier versions had a single on/off pill ("streakSaverAuto").
      mode = d.streakSaverMode || (d.streakSaverAuto === false ? "manual" : "auto");
      cb(d.streakSaverState || { running: null, done: {} });
    });
  const setState = (s) => alive() && chrome.storage.local.set({ streakSaverState: s });

  // "Save your Streak, streak of 2 streams on sheikahwolfy" -> sheikahwolfy, plus the VOD link.
  function rowInfo(a) {
    const label = a.getAttribute("aria-label") || "";
    const channel = (label.match(/\bon (\S+)\s*$/) || [])[1]?.toLowerCase() || a.getAttribute("href");
    return { channel, url: new URL(a.getAttribute("href"), location.origin).href };
  }

  function start(info) {
    getState((s) => {
      s.running = { channel: info.channel, at: Date.now() };
      setState(s);
      chrome.runtime.sendMessage({ type: "openStreakSaver", url: info.url }); // minimized and muted
    });
  }

  // ===== In your normal Twitch tabs ===================================================

  let checking = false;
  let ready = false; // true once we know whether this tab is the saver window
  function maybeAutoSave() {
    if (!ready || isSaver || checking || !alive()) return;
    const a = document.querySelector(ROW);
    if (!a) return;
    checking = true;
    getState((s) => {
      checking = false;
      if (mode !== "auto") return;
      const info = rowInfo(a);
      if (s.running && Date.now() - s.running.at < STALE_MS) return; // one at a time
      if (s.done?.[info.channel] && Date.now() - s.done[info.channel] < REDO_AFTER_MS) return;
      start(info);
    });
  }

  const MODE_TIPS = {
    auto: "When \"Save your Streak\" shows up, it's watched for you in a hidden, muted window",
    manual: "Only runs when you click \"Save your Streak\"",
    off: "Does nothing; \"Save your Streak\" works like normal Twitch",
  };

  function renderPill() {
    if (!ready || isSaver) return;
    const atRisk = document.querySelector(AT_RISK);
    const stories = document.querySelector(STORIES);
    if (!atRisk && !stories) return;
    let bar = document.querySelector(".tbc-ssmode");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "tbc-ssmode";
      bar.setAttribute("role", "radiogroup");
      bar.setAttribute("aria-label", "Streak Saver");
      for (const [value, label] of MODES) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "tbc-ssmode__opt";
        b.dataset.mode = value;
        b.textContent = label;
        b.title = MODE_TIPS[value];
        b.setAttribute("role", "radio");
        b.addEventListener("click", () => {
          mode = value;
          if (alive()) chrome.storage.local.set({ streakSaverMode: mode });
          renderPill();
          if (mode === "auto") maybeAutoSave();
        });
        bar.append(b);
      }
    }
    // Between Stories and "Save your Streak" (or just under Stories if nothing's at risk).
    if (atRisk) {
      if (bar.nextElementSibling !== atRisk) atRisk.before(bar);
    } else if (bar.previousElementSibling !== stories) {
      stories.after(bar);
    }
    for (const b of bar.children) {
      const on = b.dataset.mode === mode;
      b.classList.toggle("tbc-ssmode__opt--on", on);
      b.setAttribute("aria-checked", on);
    }
  }

  // Clicking "Save your Streak" runs the saver instead of switching this tab to the
  // VOD (unless the saver is Off, when it's left to Twitch).
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.(ROW);
    if (!a || isSaver || mode === "off") return;
    e.preventDefault();
    e.stopPropagation();
    start(rowInfo(a));
  }, true);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.streakSaverMode) {
      mode = changes.streakSaverMode.newValue || "auto";
      renderPill();
    }
    for (const key of ["streakSaverFailed", "streakSaverSaved"]) {
      if (!changes[key] || isSaver) continue;
      if (changes[key].newValue) showResult(key, changes[key].newValue);
      else document.querySelector(`.tbc-gaveup[data-key="${key}"]`)?.remove(); // dismissed in another tab
    }
  });

  // The pop-up shown in your Twitch tabs when the saver is done: saved, or gave up.
  function showResult(key, info) {
    document.querySelector(".tbc-gaveup")?.remove(); // only the latest
    const saved = key === "streakSaverSaved";
    const box = document.createElement("div");
    box.className = "tbc-gaveup";
    box.dataset.key = key;
    box.setAttribute("role", "alertdialog");
    box.innerHTML =
      `<div class="tbc-gaveup__card">` +
      `<img class="tbc-gaveup__tom" alt="">` +
      `<p class="tbc-gaveup__msg"></p>` +
      `<p class="tbc-gaveup__sub"></p>` +
      `<button type="button" class="tbc-gaveup__ok">OK</button>` +
      `</div>`;
    box.querySelector(".tbc-gaveup__tom").src = chrome.runtime.getURL("icons/icon128.png");
    box.querySelector(".tbc-gaveup__msg").textContent = saved
      ? `Streak saved with ${info.channel}`
      : "Twitch be twitching. Tom did his best, but you can take it up with Bezos.";
    box.querySelector(".tbc-gaveup__sub").textContent = saved
      ? info.text || "Twitch says your watch streak is safe."
      : `Twitch never said your streak on ${info.channel} was saved.`;
    box.querySelector(".tbc-gaveup__ok").addEventListener("click", () => {
      box.remove();
      if (alive()) chrome.storage.local.remove(key);
    });
    document.body.append(box);
  }

  // ===== Inside the saver window ======================================================

  function overlay(text) {
    let el = document.querySelector(".tbc-saver");
    if (!el) {
      el = document.createElement("div");
      el.className = "tbc-saver";
      document.body.append(el);
    }
    if (el.textContent !== text) el.textContent = text;
  }

  // Twitch's "Your streak has been saved" message, ignoring chat and our own label.
  // e.g. "Your 2-stream streak with sheikahwolfy is saved!" (Twitch splits it into
  // several pieces, so check whole short elements, not single bits of text).
  // The "Save your Streak" row disappearing from the sidebar also counts.
  // Returns Twitch's message when it shows one, "" when only the row went away,
  // or null while not saved yet.
  let rowSeen = false;
  function savedShown() {
    for (const el of document.body.querySelectorAll("div, p, span")) {
      const t = el.textContent;
      if (t.length > 200 || !SAVED_RE.test(t) || el.closest(CHAT)) continue;
      return t.replace(/\s+/g, " ").trim();
    }
    if (document.querySelector(ROW)) rowSeen = true;
    else if (rowSeen) return "";
    return null;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function keepPlaying() {
    // Click through "Start watching" / mature-content gates if Twitch shows one.
    document.querySelector('[data-a-target*="mature-accept"], [data-a-target*="start-watching"], [data-a-target="player-overlay-mature-accept"]')?.click();
    const video = document.querySelector("video");
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
      } catch {
        // Chrome may block sound without a click; play muted rather than not at all.
        video.muted = true;
        video.play().catch(() => {});
      }
    }
  }

  async function runSaver() {
    const startedAt = Date.now();
    overlay("Auto Streak Saver: watching to save your streak…");
    let volumeSet = false;
    let savedText = null;
    while (Date.now() - startedAt < GIVE_UP_MS) {
      if (!alive()) return;
      await keepPlaying();
      const controls = document.querySelector(".player-controls__left-control-group");
      if (!volumeSet && controls && typeof setOnePercent === "function") {
        await setOnePercent(controls); // from content.js
        volumeSet = true;
      }
      savedText = savedShown();
      if (savedText !== null) break;
      await wait(2000);
    }
    const saved = savedText !== null;
    if (saved) {
      // Tell your Twitch tab straight away; the window keeps playing a little longer.
      getState((s) => {
        if (alive()) chrome.storage.local.set({ streakSaverSaved: { channel: s.running?.channel || "this channel", text: savedText, at: Date.now() } });
      });
      // Keep watching a little longer, as asked, then close.
      for (let left = EXTRA_MS; left > 0; left -= 1000) {
        overlay(`Streak saved. Closing in ${Math.ceil(left / 1000)}s…`);
        await keepPlaying();
        await wait(1000);
      }
    } else {
      // The usual time plus 20 seconds has passed with no "saved": tell your Twitch tab.
      overlay("Twitch be twitching. Tom did his best, but you can take it up with Bezos.");
      getState((s) => {
        if (alive()) chrome.storage.local.set({ streakSaverFailed: { channel: s.running?.channel || "this channel", at: Date.now() } });
      });
      await wait(3000);
    }
    getState((s) => {
      // Even if Twitch never confirmed it, don't auto-retry this channel for a while
      // (clicking "Save your Streak" still works any time).
      if (s.running?.channel) s.done = { ...(s.done || {}), [s.running.channel]: Date.now() };
      s.running = null;
      setState(s);
      setTimeout(() => chrome.runtime.sendMessage({ type: "streakSaverDone" }), 300);
    });
  }

  // ===== Start ========================================================================

  chrome.runtime.sendMessage({ type: "amStreakSaver" }, (yes) => {
    isSaver = !!yes;
    ready = true;
    getState(() => {
      if (isSaver) {
        setTimeout(runSaver, 3000); // give the player a moment to load
        return;
      }
      renderPill();
      maybeAutoSave();
      // A pop-up nobody has dismissed yet (e.g. this tab was reloaded).
      chrome.storage.local.get(["streakSaverFailed", "streakSaverSaved"], (d) => {
        for (const key of ["streakSaverFailed", "streakSaverSaved"]) {
          if (d[key] && Date.now() - d[key].at < 60 * 60 * 1000) showResult(key, d[key]);
        }
      });
    });
  });

  // Twitch builds the sidebar after the page loads and redraws it now and then.
  let pending = 0;
  const observer = new MutationObserver(() => {
    if (!alive()) return observer.disconnect();
    if (isSaver || pending) return;
    pending = setTimeout(() => {
      pending = 0;
      renderPill();
      maybeAutoSave();
    }, 500);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
});
