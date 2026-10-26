// Adds a flame button next to the Bits / channel points balances showing your
// watch streak for this channel, plus how many more minutes of the current live
// stream you need to watch for it to count. Clicking it opens Twitch's own
// rewards panel, where the streak is shown.
//
// Twitch only shows the streak inside its rewards panel, so the number is read
// from there: the panel is opened invisibly, read and closed again.
//
// Twitch doesn't publish how long you must watch for a stream to count, so this
// learns it: while you watch a stream that hasn't counted yet, it re-reads the
// streak once a minute and notes how many minutes you'd watched when it went up.
// Until it has seen that happen, it assumes DEFAULT_MINUTES.
//
// Wrapped so its names (render, peek, ...) don't clash with the other scripts.
(() => {
  const DEFAULT_MINUTES = 10;
  const CHECK_EVERY_MS = 60 * 1000; // how often to re-read the streak while waiting for it to go up
  const STOP_CHECKING_MIN = 90;     // give up re-reading after this many minutes of a stream
  const SAME_STREAM_MS = 10 * 60 * 1000;
  const MAX_SAMPLES = 10;
  const BALANCES = 'button[aria-label="Bits and Points Balances"]';
  const REWARDS = ".rewards-list";
  const PANEL = '[role="dialog"][aria-labelledby="channel-points-reward-center-header"]';
  const STREAK_RE = /Watch Streak:\s*([\d,]+)/;
  const FLAME_PATH =
    "M5.295 8.05 10 2l3 4 2-3 3.8 5.067a11 11 0 0 1 2.2 6.6A7.333 7.333 0 0 1 13.667 22h-3.405A7.262 7.262 0 0 1 3 14.738c0-2.423.807-4.776 2.295-6.688Zm7.801 1.411 2-3L17.2 9.267a9 9 0 0 1 1.8 5.4 5.334 5.334 0 0 1-4.826 5.31 3 3 0 0 0 .174-3.748L12 13l-2.348 3.229a3 3 0 0 0 .18 3.754A5.263 5.263 0 0 1 5 14.738c0-1.978.66-3.9 1.873-5.46l3.098-3.983 3.125 4.166Z";

  // After the extension is reloaded, the copy still running in already-open tabs
  // loses access to chrome.storage and every call throws "Extension context
  // invalidated". alive() lets this copy notice and shut itself down quietly.
  function alive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function save(items) {
    if (alive()) chrome.storage.local.set(items);
  }

  const notes = {};         // channel -> Twitch's extra streak line ("3 more streams until …")
  const streaks = {};       // channel -> number (or null if Twitch shows none), saved between visits
  const fresh = {};         // channel -> streak as read during this page visit
  const peeked = new Set(); // channels read this page load
  let samples = [];         // minutes watched when a stream was seen to count
  let peeking = false;
  let lastCheck = 0;        // when the streak was last read
  // The stream being watched, saved per channel:
  // { channel, start, seconds, streakAtStart, counted, countedAt }
  let watch = null;

  function channelName() {
    const parts = location.pathname.split("/").filter(Boolean);
    const name = parts[0] === "popout" || parts[0] === "embed" ? parts[1] : parts[0];
    return name ? name.toLowerCase() : null;
  }

  chrome.storage.local.get(null, (data) => {
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith("streak:")) streaks[k.slice(7)] = v;
      if (k.startsWith("streakNote:")) notes[k.slice(11)] = v;
    }
    samples = data.streakSamples || [];
    render();
  });

  // Minutes a stream needs: the median of what's been learned, or the default.
  function threshold() {
    if (!samples.length) return DEFAULT_MINUTES;
    const s = [...samples].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function saveWatch() {
    if (watch) save({ ["watch:" + watch.channel]: watch });
  }

  // --- Reading the streak ------------------------------------------------------

  // Twitch's extra line under the streak, e.g. "3 more streams until …".
  function readStreakNote() {
    const list = document.querySelector(REWARDS);
    if (!list) return undefined;
    for (const p of list.querySelectorAll("p")) {
      if (!STREAK_RE.test(p.textContent)) continue;
      // The extra line sits a few levels out from the streak text; walk outward
      // until there's more text, but stop before reaching the rest of the list.
      let box = p.parentElement;
      for (let i = 0; i < 6 && box && box !== list; i++, box = box.parentElement) {
        const rest = box.textContent.replace(p.textContent, "").replace(/\s+/g, " ").trim();
        if (rest && rest.length < 120) return rest;
        if (rest) break;
      }
      return "";
    }
    return undefined;
  }

  function storeNote(channel, note) {
    if (note === undefined || notes[channel] === note) return;
    notes[channel] = note;
    if (alive()) chrome.storage.local.set({ ["streakNote:" + channel]: note });
    render();
  }

  function readStreak() {
    const list = document.querySelector(REWARDS);
    if (!list) return undefined;
    for (const p of list.querySelectorAll("p")) {
      const m = p.textContent.match(STREAK_RE);
      if (m) return parseInt(m[1].replace(/,/g, ""), 10);
    }
    return undefined;
  }

  function storeStreak(channel, n) {
    const previousCheck = lastCheck;
    lastCheck = Date.now();
    fresh[channel] = n;
    if (watch && watch.channel === channel && !watch.counted) {
      if (watch.streakAtStart == null) {
        watch.streakAtStart = n;
        saveWatch();
      } else if (n != null && n > watch.streakAtStart) {
        // The streak went up during this stream: it counted.
        watch.counted = true;
        watch.countedAt = Math.round(watch.seconds / 60);
        saveWatch();
        // Only learn from it if the previous read was recent, so the minute is accurate.
        if (Date.now() - previousCheck <= CHECK_EVERY_MS * 1.5) {
          samples = [...samples, watch.countedAt].slice(-MAX_SAMPLES);
          save({ streakSamples: samples });
        }
      }
    }
    if (streaks[channel] !== n) {
      streaks[channel] = n;
      save({ ["streak:" + channel]: n });
    }
    render();
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Don't open anything while you're busy: typing in chat, or another panel open.
  function busy() {
    const active = document.activeElement;
    if (active && active.closest('[data-a-target="chat-input"], input, textarea, [contenteditable="true"]')) return true;
    // Twitch leaves the emote picker in the page after closing it, so ask its button.
    if (document.querySelector('[data-a-target="emote-picker-button"]')?.getAttribute("aria-expanded") === "true") return true;
    // Only dialogs actually on screen (closed ones can linger at zero size).
    return [...document.querySelectorAll('[role="dialog"]')].some((d) => d.getBoundingClientRect().height > 0);
  }

  // Opens the rewards panel invisibly, reads the streak, and closes it again.
  async function peek() {
    const channel = channelName();
    const btn = document.querySelector(BALANCES);
    if (!channel || !btn || peeking) return;
    if (document.querySelector(REWARDS)) return; // already open; the observer reads it
    if (busy()) return;
    peeking = true;
    peeked.add(channel);
    const focused = document.activeElement;
    document.documentElement.classList.add("tbc-peek");
    try {
      btn.click();
      let n;
      for (let i = 0; i < 40 && n === undefined; i++) {
        await wait(100);
        n = readStreak();
      }
      // The list loaded but has no streak line: no streak on this channel.
      if (n === undefined && document.querySelector(REWARDS)) n = null;
      if (n !== undefined) storeStreak(channel, n);
      if (document.querySelector(REWARDS)) btn.click();
      await wait(300);
    } finally {
      document.documentElement.classList.remove("tbc-peek");
      if (focused && focused !== document.activeElement && focused.focus) focused.focus();
      peeking = false;
    }
  }

  // --- Watch time ----------------------------------------------------------------

  // Start time of the current live stream, from Twitch's "0:18:52" uptime counter.
  function streamStart() {
    const el = document.querySelector(".live-time");
    const m = el && el.textContent.match(/(\d+):(\d\d):(\d\d)/);
    if (!m) return null;
    const up = (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000;
    return Date.now() - up;
  }

  let lastTick = Date.now();
  let loading = false;

  function tick() {
    if (!alive()) return shutDown();
    const now = Date.now();
    const dt = Math.min((now - lastTick) / 1000, 70); // background tabs tick slowly
    lastTick = now;

    const channel = channelName();
    const start = streamStart();
    if (!channel || !start) {
      watch = null;
      return render();
    }
    // A different channel or a new broadcast: load what we saved for it, if anything.
    if (!watch || watch.channel !== channel || Math.abs(watch.start - start) > SAME_STREAM_MS) {
      if (loading) return;
      loading = true;
      const key = "watch:" + channel;
      chrome.storage.local.get(key, (data) => {
        const saved = data[key];
        watch = saved && Math.abs(saved.start - start) < SAME_STREAM_MS
          ? saved
          : { channel, start, seconds: 0, streakAtStart: fresh[channel] ?? null, counted: false, countedAt: null };
        saveWatch();
        loading = false;
        render();
      });
      return;
    }
    const video = document.querySelector("video");
    if (video && !video.paused && !video.ended) {
      watch.seconds += dt;
      saveWatch();
    }
    // Until this stream counts, re-read the streak every minute to catch the moment it does.
    if (!watch.counted && watch.seconds >= 60 && watch.seconds < STOP_CHECKING_MIN * 60 &&
        now - lastCheck >= CHECK_EVERY_MS) {
      peek();
    }
    render();
  }

  const timer = setInterval(tick, 5000);

  // --- The button ----------------------------------------------------------------

  function buildButton() {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tbc-streak";
    b.innerHTML =
      `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="${FLAME_PATH}"></path></svg>` +
      `<span class="tbc-streak__count"></span><span class="tbc-streak__left"></span>`;
    return b;
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  function render() {
    const btn = document.querySelector(BALANCES);
    const channel = channelName();
    if (!btn || !channel) return;
    const anchor = btn.parentElement.parentElement; // Twitch's wrapper around the balances button
    let flame = document.querySelector(".tbc-streak");
    if (!flame) flame = buildButton();
    if (flame.previousElementSibling !== anchor) anchor.after(flame);
    snugUp(btn, flame);

    const n = streaks[channel];
    const count = n == null ? "–" : String(n);
    const target = threshold();
    const source = samples.length
      ? `learned from ${plural(samples.length, "stream")}`
      : "a guess until it sees your streak go up";
    let left = "";
    let state = "";
    const tip = [n == null ? "No watch streak found for this channel" : `Watch streak: ${n}`];
    if (notes[channel]) tip.push(notes[channel]);
    if (!watch || watch.channel !== channel) {
      tip.push(uptimeShown()
        ? "Minutes left will show once the stream is playing"
        : "Minutes left shows on the channel's page while it's live and playing");
    } else {
      const watched = Math.floor(watch.seconds / 60);
      tip.push(`You've watched ${plural(watched, "minute")} of this stream`);
      if (watch.counted) {
        left = "✓";
        state = "done";
        tip.push(`It counted toward your streak after about ${plural(watch.countedAt, "minute")}`);
      } else {
        const remaining = Math.ceil(target - watch.seconds / 60);
        if (remaining > 0) {
          left = `${remaining}m`;
          tip.push(`About ${plural(remaining, "more minute")} to count it (target ${target} min, ${source})`);
        } else {
          left = "…";
          state = "waiting";
          tip.push(`Past the ${target} min target; waiting for Twitch to update your streak`);
        }
      }
    }
    setText(flame.querySelector(".tbc-streak__count"), count);
    setText(flame.querySelector(".tbc-streak__left"), left);
    tipLines = tip;
    if (flame.hasAttribute("title")) flame.removeAttribute("title"); // the tooltip below replaces it
    if (tipEl) fillTip();
    flame.classList.toggle("tbc-streak--done", state === "done");
  }

  // ===== Hover tooltip ============================================================
  // Shows straight away on hover (the browser's own tooltip is slow and easy to miss).

  let tipLines = [];
  let tipEl = null;

  const uptimeShown = () => !!document.querySelector(".live-time");

  function fillTip() {
    const html = tipLines.map((l, i) => `<div class="${i ? "" : "tbc-streak-tip__head"}"></div>`).join("");
    if (tipEl.childElementCount !== tipLines.length) tipEl.innerHTML = html;
    tipLines.forEach((l, i) => {
      if (tipEl.children[i].textContent !== l) tipEl.children[i].textContent = l;
    });
    const flame = document.querySelector(".tbc-streak");
    if (!flame) return;
    const r = flame.getBoundingClientRect();
    tipEl.style.left = Math.max(8, Math.min(r.left + r.width / 2 - tipEl.offsetWidth / 2, innerWidth - tipEl.offsetWidth - 8)) + "px";
    tipEl.style.top = Math.max(8, r.top - tipEl.offsetHeight - 8) + "px";
  }

  document.addEventListener("mouseover", (e) => {
    const over = e.target.closest?.(".tbc-streak");
    if (over && !tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "tbc-streak-tip";
      document.body.append(tipEl);
      fillTip();
    } else if (!over && tipEl) {
      tipEl.remove();
      tipEl = null;
    }
  }, true);

  // Twitch's balances button has empty space on its right (more when a channel
  // shows only Bits). Pull the flame left so it sits just after the last number.
  function snugUp(btn, flame) {
    let textRight = 0;
    for (const el of btn.querySelectorAll("*")) {
      if (el.children.length || !el.textContent.trim()) continue;
      const r = el.getBoundingClientRect();
      if (r.width) textRight = Math.max(textRight, r.right);
    }
    if (!textRight) return;
    const spare = btn.getBoundingClientRect().right - textRight;
    const margin = Math.round(6 - spare) + "px";
    if (flame.style.marginLeft !== margin) flame.style.marginLeft = margin;
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  const observer = new MutationObserver(() => {
    if (!alive()) return shutDown();
    const channel = channelName();
    if (!channel) return;
    // Whenever Twitch's rewards panel is open (by us or by you), grab the streak.
    if (document.querySelector(PANEL)) {
      const n = readStreak();
      if (n !== undefined && n !== streaks[channel]) storeStreak(channel, n);
      storeNote(channel, readStreakNote());
    }
    if (!document.querySelector(".tbc-streak")) render();
    if (!peeked.has(channel) && document.querySelector(BALANCES)) peek();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  function shutDown() {
    clearInterval(timer);
    observer.disconnect();
  }

  // Clicking the flame opens Twitch's rewards panel and scrolls to the streak line.
  document.addEventListener("click", async (e) => {
    if (!e.target.closest(".tbc-streak")) return;
    e.preventDefault();
    e.stopPropagation();
    const btn = document.querySelector(BALANCES);
    if (!btn) return;
    if (!document.querySelector(REWARDS)) btn.click();
    for (let i = 0; i < 30; i++) {
      await wait(100);
      const line = [...document.querySelectorAll(`${REWARDS} p`)].find((p) => STREAK_RE.test(p.textContent));
      if (line) return line.scrollIntoView({ block: "nearest" });
    }
  }, true);
})();
