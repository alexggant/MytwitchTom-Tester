// Adds a "Pinned" row to Twitch's emote picker, above Frequently Used.
// Right-click any emote in the picker to pin it; right-click a pinned one to unpin.
// Only started if switched on (settings.js); shares its switch with freqchannels.js.
whenOn("emotes", "Pinned emotes and Frequent Channels", () => {
const PICKER = '[data-a-target="chat-emote-picker"]';
const EMOTE = '[data-test-selector="emote-button-clickable"]';
const BLOCK = ".emote-picker__content-block";
const STORE_KEY = "pinnedEmotes";

// Saved as [{ name, id }]. Chrome's synced storage allows only 8 KB per item, so
// each pin keeps just the emote's ID and the picture links are rebuilt from it.
let pins = [];
const EMOTE_ID_RE = /\/emoticons\/v2\/([^/]+)\//;
const CDN = "https://static-cdn.jtvnw.net/emoticons/v2/";

// Older pins stored full picture links ({ name, src, srcset }); shrink them to { name, id }.
function compact(p) {
  if (p.id) return { name: p.name, id: p.id };
  const m = (p.src || "").match(EMOTE_ID_RE);
  return m ? { name: p.name, id: m[1] } : { name: p.name, src: p.src || "" };
}

chrome.storage.sync.get(STORE_KEY, (data) => {
  const saved = data[STORE_KEY] || [];
  pins = saved.map(compact);
  if (JSON.stringify(pins) !== JSON.stringify(saved)) save();
  render();
});
chrome.storage.onChanged.addListener((changes) => {
  if (!changes[STORE_KEY]) return;
  pins = (changes[STORE_KEY].newValue || []).map(compact);
  render();
});

// After the extension is reloaded, the copy still running in already-open tabs
// can't reach chrome.storage any more ("Extension context invalidated").
function alive() {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function save() {
  if (!alive()) return;
  chrome.storage.sync.set({ [STORE_KEY]: pins }, () => {
    if (chrome.runtime.lastError) console.warn("Twitch Space: couldn't save pinned emotes:", chrome.runtime.lastError.message);
  });
}

// Use the same light/dark artwork as the picker's own emotes.
function emoteTheme() {
  const img = document.querySelector(`${PICKER} ${EMOTE} img`);
  const m = img && img.src.match(/\/(light|dark)\/[\d.]+$/);
  return m ? m[1] : "dark";
}

function emoteImages(p) {
  if (!p.id) return { src: p.src || "", srcset: "" };
  const base = `${CDN}${p.id}/default/${emoteTheme()}/`;
  return { src: base + "1.0", srcset: `${base}1.0 1x, ${base}2.0 2x, ${base}3.0 3x` };
}

function togglePin(btn) {
  const name = btn.dataset.aTarget || btn.getAttribute("aria-label");
  if (!name) return;
  const i = pins.findIndex((p) => p.name === name);
  if (i >= 0) pins.splice(i, 1);
  else {
    const img = btn.querySelector("img");
    pins.push(compact({ name, src: img ? img.src : "" }));
  }
  save();
  render();
}

function sendEmote(name) {
  // Clicking Twitch's own button keeps its behaviour (spacing, recents); fall back to typing it.
  const original = document.querySelector(`${PICKER} ${EMOTE}[data-a-target="${CSS.escape(name)}"]`);
  if (original) return original.click();
  const input = document.querySelector('[data-a-target="chat-input"]');
  if (!input) return;
  input.focus();
  // As a paste, so Twitch's chat box registers it (see phrases.js).
  const data = new DataTransfer();
  data.setData("text/plain", name + " ");
  const paste = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
  input.dispatchEvent(paste);
  if (!paste.defaultPrevented) document.execCommand("insertText", false, name + " ");
}

function buildRow() {
  const block = document.createElement("div");
  block.className = "tbc-pins";
  const title = document.createElement("div");
  title.className = "tbc-pins__title";
  title.innerHTML = "<strong>Pinned</strong>";
  const grid = document.createElement("div");
  grid.className = "tbc-pins__grid";
  block.append(title, grid);
  return block;
}

function fill(block) {
  const grid = block.querySelector(".tbc-pins__grid");
  const key = pins.map((p) => p.name).join("\n");
  if (grid.dataset.key === key) return;
  grid.dataset.key = key;
  grid.textContent = "";
  if (!pins.length) {
    const hint = document.createElement("p");
    hint.className = "tbc-pins__hint";
    hint.textContent = "Right-click any emote below to pin it here.";
    grid.append(hint);
    return;
  }
  for (const p of pins) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tbc-pins__emote";
    b.title = `${p.name} (drag to reorder, right-click to unpin)`;
    b.dataset.tbcPin = p.name;
    b.draggable = true;
    const img = document.createElement("img");
    img.alt = p.name;
    img.draggable = false; // drag the button, not the picture
    const { src, srcset } = emoteImages(p);
    img.src = src;
    if (srcset) img.setAttribute("srcset", srcset);
    b.append(img);
    grid.append(b);
  }
}

function render() {
  const picker = document.querySelector(PICKER);
  if (!picker) return;
  // Anchor on the "Frequently Used" block (or the first section if it isn't there).
  const blocks = [...picker.querySelectorAll(BLOCK)];
  const anchor = blocks.find((b) => /frequently/i.test(b.querySelector(".emote-grid-section__header-title")?.textContent || "")) || blocks[0];
  if (!anchor) return;
  let row = picker.querySelector(".tbc-pins");
  if (!row) row = buildRow();
  // At the top: above the Frequent Channels row (freqchannels.js) if it's there.
  const above = picker.querySelector(".tbc-freqch") || anchor;
  if (row.nextElementSibling !== above) above.before(row);
  fill(row);
}

new MutationObserver(() => {
  if (document.querySelector(PICKER)) render();
}).observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("click", (e) => {
  const pin = e.target.closest("[data-tbc-pin]");
  if (!pin) return;
  e.preventDefault();
  e.stopPropagation();
  sendEmote(pin.dataset.tbcPin);
}, true);

document.addEventListener("contextmenu", (e) => {
  const pin = e.target.closest("[data-tbc-pin]");
  if (pin) {
    e.preventDefault();
    pins = pins.filter((p) => p.name !== pin.dataset.tbcPin);
    save();
    render();
    return;
  }
  const emote = e.target.closest(`${PICKER} ${EMOTE}`);
  if (!emote) return;
  e.preventDefault();
  togglePin(emote);
}, true);

// --- Drag to reorder pins -----------------------------------------------------
let dragging = null; // name of the pin being dragged

function clearMarks() {
  document.querySelectorAll(".tbc-drop-before, .tbc-drop-after").forEach((el) =>
    el.classList.remove("tbc-drop-before", "tbc-drop-after"));
}

// Which side of the hovered pin the dragged one would land on.
function dropSide(pin, e) {
  const r = pin.getBoundingClientRect();
  return e.clientX < r.left + r.width / 2 ? "before" : "after";
}

document.addEventListener("dragstart", (e) => {
  const pin = e.target.closest?.("[data-tbc-pin]");
  if (!pin) return;
  dragging = pin.dataset.tbcPin;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragging);
  pin.classList.add("tbc-dragging");
});

document.addEventListener("dragover", (e) => {
  if (!dragging) return;
  const pin = e.target.closest("[data-tbc-pin]");
  if (!pin) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  clearMarks();
  if (pin.dataset.tbcPin !== dragging) pin.classList.add(`tbc-drop-${dropSide(pin, e)}`);
});

document.addEventListener("drop", (e) => {
  if (!dragging) return;
  const pin = e.target.closest("[data-tbc-pin]");
  if (!pin) return;
  e.preventDefault();
  const target = pin.dataset.tbcPin;
  if (target !== dragging) {
    const moved = pins.find((p) => p.name === dragging);
    pins = pins.filter((p) => p.name !== dragging);
    let i = pins.findIndex((p) => p.name === target);
    if (dropSide(pin, e) === "after") i++;
    pins.splice(i, 0, moved);
    save();
    render();
  }
});

document.addEventListener("dragend", () => {
  dragging = null;
  clearMarks();
  document.querySelectorAll(".tbc-dragging").forEach((el) => el.classList.remove("tbc-dragging"));
});
});
