// Adds a "Frequent Channels" row to the emote picker, under Pinned and above
// Frequently Used:
// the channels whose emotes show up most in your Frequently Used list, most-used
// first. Click (or right-click) a channel to jump to its emotes.
//
// You can arrange it: drag channels to reorder, hover one and click × to remove
// it, and right-click any channel picture in the picker's right-hand sidebar to
// add it (right-click again there to take it back out). Once you've arranged
// it, your order is kept; newly frequent channels are added at the end.
//
// Twitch only fills in a channel's section of the picker when you scroll to it,
// so to learn which channel each emote belongs to, the picker's list is made
// very tall for a moment (hidden), which loads every section at once. The
// result is saved, and that pass only runs again when an emote in Frequently
// Used isn't recognised yet.
//
// Saved in chrome.storage.local:
//   "emoteOwners"   { emoteName: channelName, or "" for Twitch's own emotes }
//   "emoteChannels" { channelName: imageUrl }
//   "freqChannelLayout" { order: [channelName], hidden: [channelName] }
//
// Wrapped so its names don't clash with the other scripts.
(() => {
  const PICKER = '[data-a-target="chat-emote-picker"]';
  const EMOTE = '[data-test-selector="emote-button-clickable"]';
  const BLOCK = ".emote-picker__content-block";
  const TITLE = ".emote-grid-section__header-title";
  // The channel buttons down the picker's right-hand side.
  const NAV = `${PICKER} [data-a-target^="category-ref-"], ${PICKER} [data-a-target="CHANNEL_EMOTES"]`;
  const MAX_CHANNELS = 12;
  // Picker sections that aren't a streamer's emotes.
  const NOT_CHANNELS = /^(frequently used|unlocked|twitch|global|hype train|twitchhypetrain)$/i;

  let owners = {};   // emote name -> channel name
  let channels = {}; // channel name -> picture url
  let scanned = new WeakSet(); // pickers already scanned this page visit
  let order = [];  // your arrangement (channel names), once you've changed anything
  let hidden = []; // frequent channels you removed

  function alive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  chrome.storage.local.get(["emoteOwners", "emoteChannels", "freqChannelLayout"], (data) => {
    owners = data.emoteOwners || {};
    channels = data.emoteChannels || {};
    order = data.freqChannelLayout?.order || [];
    hidden = data.freqChannelLayout?.hidden || [];
    render();
  });

  function saveLayout() {
    if (alive()) chrome.storage.local.set({ freqChannelLayout: { order, hidden } });
  }

  // Your arrangement first, then any frequent channels it doesn't have yet.
  function shown(auto) {
    const out = order.filter((n) => !hidden.includes(n));
    for (const n of auto) if (!out.includes(n) && !hidden.includes(n)) out.push(n);
    return out;
  }

  // The row as it is on screen right now.
  function current() {
    return [...document.querySelectorAll(".tbc-freqch [data-tbc-channel]")].map((b) => b.dataset.tbcChannel);
  }

  function removeChannel(name) {
    order = current().filter((n) => n !== name);
    if (!hidden.includes(name)) hidden.push(name);
    saveLayout();
    render();
  }

  // Right-clicking a sidebar channel adds it, or takes it out if it's already there.
  function toggleChannel(name, img) {
    if (img && !channels[name]) {
      channels[name] = img;
      save();
    }
    const now = current();
    if (now.includes(name)) return removeChannel(name);
    hidden = hidden.filter((n) => n !== name);
    order = [...now, name];
    saveLayout();
    render();
    const added = document.querySelector(`.tbc-freqch [data-tbc-channel="${CSS.escape(name)}"]`);
    if (added) {
      added.classList.add("tbc-freqch__channel--new");
      setTimeout(() => added.classList.remove("tbc-freqch__channel--new"), 900);
    }
  }

  function save() {
    if (alive()) chrome.storage.local.set({ emoteOwners: owners, emoteChannels: channels });
  }

  function titleOf(block) {
    return (block.querySelector(TITLE)?.textContent || "").trim();
  }

  function frequentBlock(picker) {
    return [...picker.querySelectorAll(BLOCK)].find((b) => /frequently/i.test(titleOf(b)));
  }

  // Record the owner of every emote in the channel sections that are loaded.
  function learn(picker) {
    let changed = false;
    for (const block of picker.querySelectorAll(BLOCK)) {
      const name = titleOf(block);
      if (!name || /frequently/i.test(name)) continue;
      if (NOT_CHANNELS.test(name)) {
        // Twitch's own emotes: remember them as "no channel" so they don't trigger a scan.
        for (const e of block.querySelectorAll(EMOTE)) {
          const emote = e.dataset.aTarget;
          if (emote && owners[emote] === undefined) {
            owners[emote] = "";
            changed = true;
          }
        }
        continue;
      }
      const img = block.querySelector(`${TITLE} img`);
      if (img && channels[name] !== img.src) {
        channels[name] = img.src;
        changed = true;
      }
      for (const e of block.querySelectorAll(EMOTE)) {
        const emote = e.dataset.aTarget;
        if (emote && owners[emote] !== name) {
          owners[emote] = name;
          changed = true;
        }
      }
    }
    if (changed) save();
  }

  // Make the list tall for a moment so Twitch loads every section, then put it back.
  async function scan(picker) {
    scanned.add(picker);
    const first = picker.querySelector(BLOCK);
    const list = first && first.closest(".scrollable-area");
    if (!list) return;
    const top = list.scrollTop;
    list.style.setProperty("visibility", "hidden", "important");
    list.style.setProperty("max-height", "none", "important");
    list.style.setProperty("height", "20000px", "important");
    const blocks = () => [...picker.querySelectorAll(BLOCK)];
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      if (blocks().every((b) => b.querySelector(EMOTE) || !titleOf(b))) break;
    }
    learn(picker);
    // Anything still unknown (e.g. from a sub that ended) has no section; stop looking for it.
    const freq = frequentBlock(picker);
    if (freq) {
      for (const e of freq.querySelectorAll(EMOTE)) {
        if (owners[e.dataset.aTarget] === undefined) owners[e.dataset.aTarget] = "";
      }
      save();
    }
    list.style.removeProperty("height");
    list.style.removeProperty("max-height");
    list.style.removeProperty("visibility");
    list.scrollTop = top;
    render();
  }

  // Channels ranked by how many of your Frequently Used emotes are theirs,
  // counting emotes nearer the top (used more) a bit higher.
  function ranking(freq) {
    const emotes = [...freq.querySelectorAll(EMOTE)].map((e) => e.dataset.aTarget);
    const score = {};
    emotes.forEach((emote, i) => {
      const ch = owners[emote];
      if (ch) score[ch] = (score[ch] || 0) + 1 + (emotes.length - i) / emotes.length;
    });
    const unknown = emotes.some((emote) => owners[emote] === undefined);
    const list = Object.keys(score).sort((a, b) => score[b] - score[a]).slice(0, MAX_CHANNELS);
    return { list, unknown };
  }

  // Twitch only fills in a section's title once it's scrolled near, so click the
  // channel's own button in the picker's right-hand sidebar, which always exists
  // and scrolls straight to it. Fall back to scrolling to a loaded section.
  function jumpTo(picker, name) {
    if (!picker) return;
    const navs = [...picker.querySelectorAll(NAV)];
    const nav =
      navs.find((n) => navLabel(n).toLowerCase() === name.toLowerCase()) ||
      (channels[name] && navs.find((n) => n.querySelector("img")?.src === channels[name]));
    if (nav) return nav.click();
    const block = [...picker.querySelectorAll(BLOCK)].find((b) => titleOf(b) === name);
    const list = block && block.closest(".scrollable-area");
    if (!list) return;
    list.scrollTop += block.getBoundingClientRect().top - list.getBoundingClientRect().top;
  }

  function render() {
    const picker = document.querySelector(PICKER);
    if (!picker) return;
    const freq = frequentBlock(picker);
    if (!freq) return;
    learn(picker);
    const ranked = ranking(freq);
    if (ranked.unknown && !scanned.has(picker)) scan(picker);
    const list = shown(ranked.list);

    let row = picker.querySelector(".tbc-freqch");
    if (!list.length) {
      if (row) row.remove();
      return;
    }
    if (!row) {
      row = document.createElement("div");
      row.className = "tbc-freqch";
      row.innerHTML = `<div class="tbc-pins__title"><strong>Frequent Channels</strong></div><div class="tbc-freqch__row"></div>`;
    }
    // Just above Frequently Used (the Pinned row from pins.js goes above this one).
    if (row.nextElementSibling !== freq) freq.before(row);
    const key = list.join("|") + "|" + list.map((n) => channels[n] || "").join("|");
    const grid = row.querySelector(".tbc-freqch__row");
    if (grid.dataset.key === key) return;
    grid.dataset.key = key;
    grid.textContent = "";
    for (const name of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tbc-freqch__channel";
      b.dataset.tbcChannel = name;
      b.title = `${name}: click to jump to their emotes, drag to move`;
      b.draggable = true;
      const img = document.createElement("img");
      img.alt = name;
      img.draggable = false; // drag the button, not the picture
      if (channels[name]) img.src = channels[name];
      const x = document.createElement("span");
      x.className = "tbc-freqch__x";
      x.textContent = "×";
      x.title = `Remove ${name}`;
      b.append(img, x);
      grid.append(b);
    }
  }

  // Click or right-click a channel to jump to its emotes; × removes it.
  for (const type of ["click", "contextmenu"]) {
    document.addEventListener(type, (e) => {
      const b = e.target.closest?.("[data-tbc-channel]");
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      if (type === "click" && e.target.closest(".tbc-freqch__x")) return removeChannel(b.dataset.tbcChannel);
      jumpTo(b.closest(PICKER), b.dataset.tbcChannel);
    }, true);
  }

  // Right-click a channel in the picker's sidebar to add it to the row.
  document.addEventListener("contextmenu", (e) => {
    const nav = e.target.closest?.(NAV);
    if (!nav) return;
    const name = navChannel(nav);
    if (!name) return;
    e.preventDefault();
    e.stopPropagation();
    toggleChannel(name, nav.querySelector("img")?.src);
  }, true);

  // The channel a sidebar button stands for: "TallGlassOfBees's Emotes" -> "TallGlassOfBees".
  function navLabel(nav) {
    return (nav.getAttribute("aria-label") || "").replace(/['’]s Emotes$/i, "").trim();
  }

  function navChannel(nav) {
    const label = navLabel(nav);
    const picker = nav.closest(PICKER);
    const titles = [...picker.querySelectorAll(BLOCK)].map(titleOf);
    if (titles.includes(label)) return label;
    // The current channel's button may just say "Channel Emotes"; match it by picture instead.
    const src = nav.querySelector("img")?.src;
    const block = src && [...picker.querySelectorAll(BLOCK)].find((b) => b.querySelector(`${TITLE} img`)?.src === src);
    if (block) return titleOf(block);
    return label && !/^channel/i.test(label) ? label : null;
  }

  // --- Drag to rearrange ----------------------------------------------------------
  let dragging = null;

  function clearMarks() {
    document.querySelectorAll(".tbc-drop-before, .tbc-drop-after").forEach((el) =>
      el.classList.remove("tbc-drop-before", "tbc-drop-after"));
  }

  function dropSide(target, e) {
    const r = target.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? "before" : "after";
  }

  document.addEventListener("dragstart", (e) => {
    const b = e.target.closest?.("[data-tbc-channel]");
    if (!b) return;
    dragging = b.dataset.tbcChannel;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragging);
    b.classList.add("tbc-dragging");
  });

  document.addEventListener("dragover", (e) => {
    if (!dragging) return;
    const b = e.target.closest?.("[data-tbc-channel]");
    if (!b) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    clearMarks();
    if (b.dataset.tbcChannel !== dragging) b.classList.add(`tbc-drop-${dropSide(b, e)}`);
  });

  document.addEventListener("drop", (e) => {
    if (!dragging) return;
    const b = e.target.closest?.("[data-tbc-channel]");
    if (!b) return;
    e.preventDefault();
    const target = b.dataset.tbcChannel;
    if (target === dragging) return;
    const list = current().filter((n) => n !== dragging);
    let i = list.indexOf(target);
    if (dropSide(b, e) === "after") i++;
    list.splice(i, 0, dragging);
    order = list;
    saveLayout();
    render();
  });

  document.addEventListener("dragend", () => {
    if (!dragging) return;
    dragging = null;
    clearMarks();
    document.querySelectorAll(".tbc-freqch .tbc-dragging").forEach((el) => el.classList.remove("tbc-dragging"));
  });

  // Chat changes the page constantly, so re-check at most every 150ms (waiting for
  // a quiet moment could mean never re-checking while chat is busy).
  let pending = 0;
  const observer = new MutationObserver(() => {
    if (!alive()) return observer.disconnect();
    if (!document.querySelector(PICKER) || pending) return;
    pending = setTimeout(() => {
      pending = 0;
      render();
    }, 150);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
