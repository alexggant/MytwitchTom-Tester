// Chapter-style markers with notes, on VODs and live streams.
//
// On a VOD (twitch.tv/videos/...):
//   Right-click the seek bar  -> drop a marker there and type a note
//   Click a marker            -> jump to it
//   Drag a marker             -> move it
//   Right-click a marker      -> edit its note or remove it
//
// On a live stream there's no seek bar, so a bookmark button in the player's
// right-hand controls marks "now" (time since the stream started). Those marks
// are saved against the broadcast's start time. When you later open that
// broadcast's VOD, they're copied onto it automatically: VOD time = stream time.
//
// Saved in chrome.storage.local:
//   "marks:<vodId>"            { marks: [{ id, t, note }], removed: [ids] }
//   "live:<channel>:<startMs>" { channel, start, marks: [{ id, t, note }] }
//
// Wrapped so its names don't clash with the other scripts.
(() => {
  const SEEKBAR = '[data-a-target="player-seekbar"]';
  const BAR = ".seekbar-bar";      // the visible timeline inside the seek bar
  const RIGHT_CONTROLS = ".player-controls__right-control-group";
  const DRAG_PX = 3;               // movement before a press counts as a drag
  const LIVE_DELAY_S = 10;         // live video plays a few seconds behind; mark a bit earlier
  const SAME_STREAM_MS = 2 * 60 * 1000; // live start vs VOD start must be this close
  const BOOKMARK_PATH = "M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Zm1 2v12.55l5-2.86 5 2.86V5H7Z";

  let videoId = null;
  let vod = { marks: [], removed: [] };
  let drag = null; // { el, startX, moved, index, t }
  let liveKey = null; // storage key of the live broadcast being watched
  let live = null;

  // See streak.js: after a reload, copies left in open tabs lose chrome.storage.
  function alive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  const newId = () => Math.random().toString(36).slice(2, 10);
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

  // ===== VOD =====================================================================

  function currentVideoId() {
    const m = location.pathname.match(/^\/videos\/(\d+)/);
    return m ? m[1] : null;
  }

  // When the VOD's broadcast started, and whose it is, from the page's metadata.
  // Twitch only fills these in on a full page load, so check they're for this video.
  function vodInfo(id) {
    const url = document.querySelector('meta[property="og:url"]')?.content || "";
    if (!url.includes(`/videos/${id}`)) return null;
    const date = document.querySelector('meta[property="og:video:release_date"]')?.content;
    const start = date ? Date.parse(date) : NaN;
    if (!start) return null;
    const desc = document.querySelector('meta[property="og:description"]')?.content || "";
    const who = desc.match(/^(\S+) went live/);
    return { start, channel: who ? who[1].toLowerCase() : null };
  }

  function loadVod() {
    videoId = currentVideoId();
    vod = { marks: [], removed: [] };
    closeList();
    if (!videoId || !alive()) return render();
    const id = videoId;
    const key = "marks:" + id;
    chrome.storage.local.get(null, (data) => {
      if (id !== videoId) return; // navigated away meanwhile
      const saved = data[key];
      // Older versions saved a plain list of seconds.
      if (Array.isArray(saved)) vod.marks = saved.map((t) => ({ id: newId(), t, note: "" }));
      else if (saved) vod = { marks: saved.marks || [], removed: saved.removed || [] };
      const added = importLive(data, id);
      if (added || Array.isArray(saved)) saveVod();
      render();
    });
  }

  // Copy marks made while this broadcast was live onto the VOD (once each).
  function importLive(data, id) {
    const info = vodInfo(id);
    if (!info) return 0;
    const streams = Object.entries(data)
      .filter(([k, v]) => k.startsWith("live:") && Math.abs(v.start - info.start) < SAME_STREAM_MS)
      .map(([, v]) => v);
    // Two marked channels starting within 2 minutes is unlikely; if it happens, use the name.
    const match = streams.length > 1 && info.channel
      ? streams.filter((s) => s.channel === info.channel)
      : streams;
    let added = 0;
    for (const s of match) {
      for (const m of s.marks) {
        if (vod.removed.includes(m.id) || vod.marks.some((x) => x.id === m.id)) continue;
        vod.marks.push({ ...m });
        added++;
      }
    }
    return added;
  }

  function saveVod() {
    if (!videoId || !alive()) return;
    vod.marks.sort((a, b) => a.t - b.t);
    chrome.storage.local.set({ ["marks:" + videoId]: vod });
  }

  // Seconds at a screen x position on the timeline.
  function timeAt(bar, clientX) {
    const r = bar.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.round(f * duration() * 10) / 10;
  }

  function tip(m) {
    const head = m.note ? `${formatTime(m.t)}: ${m.note}` : formatTime(m.t);
    return `${head}\nClick to jump · drag to move · right-click to edit or remove`;
  }

  function render() {
    renderSeekbar();
    renderLiveButton();
  }

  function renderSeekbar() {
    const d = duration();
    const key = videoId && d ? `${videoId}|${d}|${JSON.stringify(vod.marks)}` : "";
    document.querySelectorAll(`${SEEKBAR} ${BAR}`).forEach((bar) => {
      let layer = bar.querySelector(".tbc-marks");
      if (!key) {
        if (layer) layer.remove();
        return;
      }
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "tbc-marks";
        bar.append(layer);
      }
      if (layer.dataset.key === key) return;
      layer.dataset.key = key;
      layer.textContent = "";
      vod.marks.forEach((m, i) => {
        const el = document.createElement("div");
        el.className = "tbc-mark" + (m.note ? " tbc-mark--noted" : "");
        el.dataset.index = i;
        el.style.left = (m.t / d) * 100 + "%";
        el.title = tip(m);
        layer.append(el);
      });
    });
  }

  // ===== Note editor ===============================================================
  // A small box for typing a note: Enter saves, Esc closes, clicking away saves.

  let editor = null;

  function closeEditor(save) {
    if (!editor) return;
    const { el, input, onSave } = editor;
    editor = null;
    el.remove();
    if (save) onSave(input.value.trim());
  }

  function openEditor({ x, y, title, note, onSave, onRemove }) {
    closeEditor(true);
    const el = document.createElement("div");
    el.className = "tbc-editor";
    el.innerHTML =
      `<div class="tbc-editor__title"></div>` +
      `<input class="tbc-editor__input" type="text" maxlength="200" placeholder="Note (optional)">` +
      `<div class="tbc-editor__buttons"><button type="button" class="tbc-editor__remove">Remove</button>` +
      `<button type="button" class="tbc-editor__save">Save</button></div>`;
    el.querySelector(".tbc-editor__title").textContent = title;
    const input = el.querySelector("input");
    input.value = note || "";
    // Keep typing away from Twitch's keyboard shortcuts (space, f, m, k...).
    for (const type of ["keydown", "keyup", "keypress"]) {
      el.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type !== "keydown") return;
        if (e.key === "Enter") closeEditor(true);
        if (e.key === "Escape") closeEditor(false);
      });
    }
    el.querySelector(".tbc-editor__save").addEventListener("click", () => closeEditor(true));
    el.querySelector(".tbc-editor__remove").addEventListener("click", () => {
      closeEditor(false);
      onRemove();
    });
    // Inside the fullscreen element when fullscreen, so it stays visible.
    (document.fullscreenElement || document.body).append(el);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = Math.min(Math.max(8, x - w / 2), innerWidth - w - 8) + "px";
    el.style.top = Math.max(8, y - h - 14) + "px";
    editor = { el, input, onSave };
    input.focus();
  }

  // Clicking anywhere outside the editor saves and closes it.
  window.addEventListener("pointerdown", (e) => {
    if (editor && !editor.el.contains(e.target)) closeEditor(true);
  }, true);

  function editVodMark(index, x, y) {
    const m = vod.marks[index];
    if (!m) return;
    const id = m.id;
    openEditor({
      x, y,
      title: `Marker at ${formatTime(m.t)}`,
      note: m.note,
      onSave: (note) => {
        const cur = vod.marks.find((k) => k.id === id);
        if (cur && cur.note !== note) {
          cur.note = note;
          saveVod();
          render();
        }
      },
      onRemove: () => {
        vod.marks = vod.marks.filter((k) => k.id !== id);
        if (!vod.removed.includes(id)) vod.removed.push(id); // don't re-import it from the live copy
        saveVod();
        render();
      },
    });
  }

  // ===== VOD mouse handling ==========================================================
  // Listeners sit on window in the capture phase and stop the event there, so
  // Twitch's own seek bar never sees presses on a marker (no accidental seeks).

  const onMark = (e) => e.target.closest?.(".tbc-mark");

  window.addEventListener("contextmenu", (e) => {
    if (!videoId || !duration()) return;
    const mark = onMark(e);
    const seekbar = e.target.closest?.(SEEKBAR);
    if (!mark && !seekbar) return;
    e.preventDefault();
    e.stopPropagation();
    if (mark) return editVodMark(+mark.dataset.index, e.clientX, e.clientY);
    const bar = seekbar.querySelector(BAR) || seekbar;
    const t = timeAt(bar, e.clientX);
    if (vod.marks.some((m) => Math.abs(m.t - t) < 1)) return;
    vod.marks.push({ id: newId(), t, note: "" });
    saveVod();
    render();
    const index = vod.marks.findIndex((m) => m.t === t);
    editVodMark(index, e.clientX, e.clientY);
  }, true);

  window.addEventListener("pointerdown", (e) => {
    const mark = onMark(e);
    if (!mark || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag = { el: mark, startX: e.clientX, moved: false, index: +mark.dataset.index };
    mark.classList.add("tbc-mark--dragging");
  }, true);

  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    e.stopPropagation();
    if (!drag.moved && Math.abs(e.clientX - drag.startX) < DRAG_PX) return;
    drag.moved = true;
    const t = timeAt(drag.el.closest(BAR), e.clientX);
    drag.el.style.left = (t / duration()) * 100 + "%";
    drag.el.title = tip({ ...vod.marks[drag.index], t });
    drag.t = t;
  }, true);

  window.addEventListener("pointerup", (e) => {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    const { el, moved, index, t } = drag;
    drag = null;
    el.classList.remove("tbc-mark--dragging");
    if (moved && t != null) {
      vod.marks[index].t = t;
      saveVod();
      render();
    } else {
      const v = video();
      if (v && vod.marks[index]) v.currentTime = vod.marks[index].t;
    }
  }, true);

  // Twitch seeks on any mouse press on the bar, even a right-click. Swallow
  // presses on a marker, during a drag, and right-button presses on the bar.
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click"]) {
    window.addEventListener(type, (e) => {
      const rightOnBar = e.button === 2 && e.target.closest?.(SEEKBAR);
      if (onMark(e) || drag || rightOnBar) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  // ===== Live streams ================================================================

  function channelName() {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts.length === 1 && parts[0] !== "videos" ? parts[0].toLowerCase() : null;
  }

  // Seconds since the broadcast started, from Twitch's "0:18:52" uptime counter.
  function uptime() {
    const el = document.querySelector(".live-time");
    const m = el && el.textContent.match(/(\d+):(\d\d):(\d\d)/);
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
  }

  // Find (or start) the saved record for the broadcast being watched.
  function liveRecord(cb) {
    const channel = channelName();
    const up = uptime();
    if (!channel || up == null || !alive()) return;
    const start = Date.now() - up * 1000;
    if (live && live.channel === channel && Math.abs(live.start - start) < SAME_STREAM_MS) return cb();
    chrome.storage.local.get(null, (data) => {
      const found = Object.entries(data).find(([k, v]) =>
        k.startsWith(`live:${channel}:`) && Math.abs(v.start - start) < SAME_STREAM_MS);
      if (found) [liveKey, live] = found;
      else {
        liveKey = `live:${channel}:${start}`;
        live = { channel, start, marks: [] };
      }
      renderLiveButton();
      cb();
    });
  }

  function saveLive() {
    if (live && alive()) chrome.storage.local.set({ [liveKey]: live });
  }

  function markLiveNow(button) {
    liveRecord(() => {
      const t = Math.max(0, uptime() - LIVE_DELAY_S);
      const mark = { id: newId(), t, note: "" };
      live.marks.push(mark);
      live.marks.sort((a, b) => a.t - b.t);
      saveLive();
      renderLiveButton();
      const r = button.getBoundingClientRect();
      openEditor({
        x: r.left + r.width / 2,
        y: r.top,
        title: `Marked ${formatTime(t)} into the stream`,
        note: "",
        onSave: (note) => {
          mark.note = note;
          saveLive();
        },
        onRemove: () => {
          live.marks = live.marks.filter((m) => m.id !== mark.id);
          saveLive();
          renderLiveButton();
        },
      });
    });
  }

  // The bookmark button in the player's right-hand controls. Live: marks the
  // current moment. VOD: opens the list of this video's markers.
  function renderLiveButton() {
    const isLive = !videoId && channelName() && uptime() != null;
    const isVod = !!videoId && duration() > 0;
    document.querySelectorAll(RIGHT_CONTROLS).forEach((group) => {
      let b = group.querySelector(".tbc-live-mark");
      if (!isLive && !isVod) {
        if (b) b.remove();
        return;
      }
      if (!b) {
        b = document.createElement("button");
        b.type = "button";
        b.className = "tbc-live-mark";
        b.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${BOOKMARK_PATH}"></path></svg><span class="tbc-live-mark__count"></span>`;
        group.prepend(b);
      }
      const n = isVod ? vod.marks.length : live && live.channel === channelName() ? live.marks.length : 0;
      const count = b.querySelector(".tbc-live-mark__count");
      if (count.textContent !== (n ? String(n) : "")) count.textContent = n ? String(n) : "";
      const title = isVod
        ? `Markers${n ? ` (${n})` : ""}: click to see the list`
        : `Mark this moment${n ? ` (${n} marked this stream)` : ""}\nMarks show up on this stream's VOD later`;
      if (b.title !== title) b.title = title;
    });
    if (list) fillList();
  }

  window.addEventListener("click", (e) => {
    const b = e.target.closest?.(".tbc-live-mark");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (videoId) toggleList(b);
    else markLiveNow(b);
  }, true);

  // ===== VOD marker list ===============================================================
  // A pop-up above the bookmark button listing every marker (time, and note in
  // small text). Click one to jump there.

  let list = null; // { el, button }

  function closeList() {
    if (!list) return;
    list.el.remove();
    list = null;
  }

  function toggleList(button) {
    if (list) return closeList();
    closeEditor(true);
    const el = document.createElement("div");
    el.className = "tbc-marklist";
    el.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") closeList();
    });
    (document.fullscreenElement || document.body).append(el);
    list = { el, button };
    fillList();
  }

  function fillList() {
    const { el, button } = list;
    const key = JSON.stringify(vod.marks);
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.textContent = "";
      const head = document.createElement("div");
      head.className = "tbc-marklist__head";
      head.innerHTML = `<strong>Markers</strong>`;
      const add = document.createElement("button");
      add.type = "button";
      add.className = "tbc-marklist__add";
      add.textContent = "+ Mark current time";
      add.addEventListener("click", () => markVodNow(button));
      head.append(add);
      el.append(head);
      if (!vod.marks.length) {
        const empty = document.createElement("p");
        empty.className = "tbc-marklist__empty";
        empty.textContent = "No markers yet. Right-click the seek bar or use Mark current time.";
        el.append(empty);
      }
      const items = document.createElement("div");
      items.className = "tbc-marklist__items";
      for (const m of vod.marks) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "tbc-marklist__item";
        const time = document.createElement("span");
        time.className = "tbc-marklist__time";
        time.textContent = formatTime(m.t);
        item.append(time);
        if (m.note) {
          const note = document.createElement("span");
          note.className = "tbc-marklist__note";
          note.textContent = m.note;
          item.append(note);
        }
        item.title = `Jump to ${formatTime(m.t)}`;
        item.addEventListener("click", () => {
          const v = video();
          if (v) v.currentTime = m.t;
          closeList();
        });
        items.append(item);
      }
      el.append(items);
    }
    // Sit just above the button, kept on screen.
    const r = button.getBoundingClientRect();
    if (!r.width) return; // controls hidden for the moment; keep the last spot
    el.style.left = Math.max(8, Math.min(r.right - el.offsetWidth, innerWidth - el.offsetWidth - 8)) + "px";
    el.style.top = Math.max(8, r.top - el.offsetHeight - 8) + "px";
  }

  // Add a marker where the video is now, then ask for a note.
  function markVodNow(button) {
    const v = video();
    if (!v) return;
    const t = Math.round(v.currentTime * 10) / 10;
    closeList();
    if (!vod.marks.some((m) => Math.abs(m.t - t) < 1)) {
      vod.marks.push({ id: newId(), t, note: "" });
      saveVod();
      render();
    }
    const r = button.getBoundingClientRect();
    editVodMark(vod.marks.findIndex((m) => Math.abs(m.t - t) < 1), r.left + r.width / 2, r.top);
  }

  // Clicking anywhere outside the list (other than its button) closes it.
  window.addEventListener("pointerdown", (e) => {
    if (list && !list.el.contains(e.target) && !e.target.closest?.(".tbc-live-mark")) closeList();
  }, true);

  // ===== Keeping up with the page =====================================================

  loadVod();
  liveRecord(() => {});
  const observer = new MutationObserver(() => {
    if (!alive()) return observer.disconnect();
    if (currentVideoId() !== videoId) loadVod();
    else if (!drag) render();
    if (!live && channelName() && uptime() != null) liveRecord(() => {});
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // The duration arrives after the page loads; redraw when it does.
  document.addEventListener("durationchange", () => render(), true);
  document.addEventListener("loadedmetadata", () => render(), true);
})();
