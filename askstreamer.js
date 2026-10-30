// Ask the Streamer: a private quick question from a trusted viewer (a mod, a
// regular) to the streamer, who answers with one click. Both need Twitch Space (or MytwitchTom,
// its old name: the [MTT] tag below is kept so old and new copies still talk).
//
// Connections: it only works between two people who have added each other.
// Your list ("Ask connections") is both who you can ask and who can ask you.
// On a channel that isn't on it, the Ask button only offers to add them; on
// yours, the Questions button shows the whole list. A question from someone
// you haven't added never pops up, and you can't send one to someone you
// haven't added, so two strangers with the extension can't reach each other.
//
// Asking: on a channel you've connected with, the "Ask" button in the channel
// header (just left of Pin) opens a box: type a question and Send. It goes to the
// streamer as a Twitch whisper, so only the two of you see it. The whisper reads
// fine on its own too ("❓ Can I clip that? [MTT ?k3j9x2]"), so a streamer
// without Twitch Space just gets a plain whisper.
//
// Answering: on your own channel the same button says "Questions" and opens
// your allow list ("Who can ask you", searchable by people in chat, channels
// you follow and Twitch's user search). A question from someone on it shows as
// an outlined card at the top of your chat, just under Twitch's pinned
// messages. Cards and the Ask / Questions button only show where the chat is
// on screen (the stream and chat views, not a channel's Home tab); a question
// waits until you're somewhere with chat. It has six answers,
// each with its icon (Yes, No, Maybe, Soon, OK, Thank you), a box to type your
// own reply, and Dismiss. The answer goes back as a whisper and shows for the
// asker as a card with the same icon.
//
// Safety: nobody can put a card on your screen until you add them to your
// list (and they have to add you to ask); who sent a whisper comes from Twitch's whisper window, which is
// labelled with the other person's username, not from the message text; and at
// most 3 unanswered questions per person show at once. Anything else stays a
// normal whisper.
//
// Sending: Twitch only sends whispers from its whisper window, so background.js
// opens a small window on a Twitch settings page (no video, nothing that can go
// live), this script sends the whisper from the whisper window there, and the
// window closes. If Twitch won't send it (say the other person blocks whispers
// from strangers), you get a card saying why.
//
// Receiving: every 15 seconds this asks Twitch (with your own sign-in, through
// background.js, the same request Twitch's page makes) for your recent whisper conversations and picks
// out tagged messages from the last day. It only does this while someone is on
// your list or you're waiting on an answer. Twitch's whisper window, when it's
// open, is read too, so cards can show a little sooner.
//
// Saved in chrome.storage.local:
//   "askTrusted" [logins]                                   your connections
//   "askInbox"   { id: { from, name, text, at, done, error } } questions to you
//                (kept a week once answered, so an old whisper window can't
//                bring them back)
//   "askSent"    { id: { to, text, at, answer, failed, ... } } questions you asked
//   "askOutbox"  [{ to, text, ref, incognito }]             whispers waiting to go
//
// Wrapped so its names don't clash with the other scripts, and only started if
// it's switched on (settings.js).
whenOn("ask", "Ask the Streamer", () => {
  if (window.top !== window) return;

  const FOLLOW_BTN = '[data-a-target="follow-button"], [data-a-target="unfollow-button"]';
  const EDIT_INFO = '[data-a-target="channel-info-bar-edit-button"]'; // the pencil in your own channel's header
  const CUSTOMIZE = 'main a[href*="/settings/channel"]'; // "Customize channel", on your own channel's Home
  const CHAT_ROOM = ".chat-room__content"; // the chat column: pinned messages, then the chat list
  const CHAT_LIST = ':scope > [class*="chat-list--"]';
  const MAX_LEN = 200;
  const MAX_OPEN_PER_PERSON = 3;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TAG_RE = /\[MTT ([?!])([a-z0-9]{4,10})(?: ([ynmsotc]))?\]/; // ?id, or !id + answer code

  const svg = (paths, size = 18) => `<svg viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true">${paths}</svg>`;
  const LINE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
  // Each answer: its label, an emoji for the whisper text (so it reads fine
  // without Twitch Space), and the icon shown on the cards.
  const ANSWERS = {
    y: { label: "Yes", emoji: "✅", icon: `<path d="M4 10.5l4 4 8-9" ${LINE} stroke-width="2.4"/>` },
    n: { label: "No", emoji: "❌", icon: `<path d="M5 5l10 10M15 5L5 15" ${LINE} stroke-width="2.4"/>` },
    m: { label: "Maybe", emoji: "🤔", icon: `<path d="M7 7.2a3 3 0 1 1 4.2 2.8c-.8.4-1.2 1-1.2 1.8v.7" ${LINE} stroke-width="2.2"/><circle cx="10" cy="15.6" r="1.3" fill="currentColor"/>` },
    s: { label: "Soon", emoji: "⏳", icon: `<path d="M5 2.5h10M5 17.5h10M6 2.5c0 4 8 4.5 8 7.5s-8 3.5-8 7.5M14 2.5c0 4-8 4.5-8 7.5s8 3.5 8 7.5" ${LINE} stroke-width="1.8"/>` },
    o: { label: "OK", emoji: "👍", icon: '<path d="M7 9l3-6c1.2 0 2 .8 2 2v3h3.5a1.5 1.5 0 0 1 1.5 1.8l-1.1 6A1.5 1.5 0 0 1 14.4 17H7zM3 9h3v8H3z" fill="currentColor"/>' },
    t: { label: "Thank you", emoji: "💜", icon: '<path d="M10 17s-6.5-4-6.5-8.6A3.6 3.6 0 0 1 10 6.2a3.6 3.6 0 0 1 6.5 2.2C16.5 13 10 17 10 17z" fill="currentColor"/>' },
    c: { label: "Replied", emoji: "💬", icon: `<path d="M3 4h14v9H8l-4 3v-3H3z" ${LINE} stroke-width="1.8"/>` }, // a typed reply
  };
  const WARN_ICON = `<path d="M10 3l8 14H2z" ${LINE} stroke-width="1.8"/><path d="M10 8v4" ${LINE} stroke-width="2"/><circle cx="10" cy="14.6" r="1" fill="currentColor"/>`;
  const ASK_ICON = svg(`<path d="M3 3h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H8l-4 3v-3H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" ${LINE} stroke-width="1.6"/><path d="M8.2 6.9a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4" ${LINE} stroke-width="1.6"/><circle cx="10" cy="11.6" r=".9" fill="currentColor"/>`, 17);

  let trusted = [];
  let inbox = {};
  let sent = {};
  let follows = []; // [{ login, name, img }] saved by people.js for chatter notes
  let isSender = false; // this tab is the little sending window
  let ready = false; // saved questions loaded
  const drafts = {}; // question id -> reply being typed (kept if the cards redraw)

  function alive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function myLogin() {
    const m = document.cookie.match(/(?:^|; )login=([^;]+)/);
    try {
      return m ? decodeURIComponent(m[1]).toLowerCase() : "";
    } catch {
      return "";
    }
  }

  // The channel whose page you're on.
  function channelName() {
    const parts = location.pathname.split("/").filter(Boolean);
    const name = (parts[0] === "popout" ? parts[1] : parts[0])?.toLowerCase();
    return name && /^[a-z0-9_]+$/.test(name) &&
      !/^(directory|videos|settings|search|subscriptions|inventory|wallet|drops|downloads|following|moderator|u)$/.test(name)
      ? name
      : null;
  }

  const newId = () => Math.random().toString(36).slice(2, 8);
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const cleanText = (s) => s.replace(/\[MTT/gi, "[mtt").trim(); // nobody can fake a tag

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  // Keep typing in our boxes away from Twitch's keyboard shortcuts.
  function shieldKeys(target, onEscape) {
    for (const type of ["keydown", "keyup", "keypress"]) {
      target.addEventListener(type, (e) => {
        e.stopPropagation();
        if (onEscape && type === "keydown" && e.key === "Escape") onEscape();
      });
    }
  }

  // Change one saved object. Changes to the same one wait their turn, so two
  // arriving at once don't overwrite each other.
  const queues = {};
  function update(key, change) {
    const run = async () => {
      const d = await chrome.storage.local.get(key);
      const value = d[key] || {};
      change(value);
      await chrome.storage.local.set({ [key]: value });
    };
    queues[key] = (queues[key] || Promise.resolve()).then(run, run);
    return queues[key];
  }

  // ===== Sending whispers ===================================================================

  // ref: { kind: "ask" | "answer", id }, so a failure can be shown. Marked with
  // its side: an Incognito window has its own Twitch sign-in but shares this
  // saved data, so each side's sending window only sends its own.
  async function queueWhisper(to, text, ref) {
    const { askOutbox = [] } = await chrome.storage.local.get("askOutbox");
    askOutbox.push({ to, text, ref, incognito: chrome.extension.inIncognitoContext });
    await chrome.storage.local.set({ askOutbox });
    if (!myLogin()) return;
    chrome.runtime.sendMessage({
      type: "openAskSender",
      url: "https://www.twitch.tv/settings/profile",
      left: Math.max(0, screen.availWidth - 440), // bottom-right, out of the way
      top: Math.max(0, screen.availHeight - 560),
    });
  }

  async function waitFor(find, ms) {
    for (let t = 0; t < ms; t += 250) {
      const found = typeof find === "string" ? document.querySelector(find) : find();
      if (found) return found;
      await wait(250);
    }
    return null;
  }

  // Set a box Twitch's page controls (a plain value change isn't noticed).
  function setValue(input, value) {
    const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // The whisper window's "Search for People" box: the visible input in the
  // same pop-up as the conversation list (found by layout, as its wording
  // depends on your language).
  function whisperSearch() {
    return [...document.querySelectorAll("input")].find((input) => {
      if (!input.offsetParent) return false;
      for (let p = input, k = 0; p && k < 10; p = p.parentElement, k++) {
        if (p.querySelector?.('[class*="whispers-threads-box"]')) return true;
      }
      return false;
    });
  }

  // Send one whisper the way you would by hand. Returns "" once sent, or why not.
  async function sendWhisper(to, text) {
    const box = await waitFor('[data-a-target="whisper-box-button"]', 20000);
    if (!box) return "Twitch's whisper window didn't load";
    box.click();
    const search = await waitFor(whisperSearch, 8000);
    if (!search) return "Twitch's whisper window didn't open";
    search.focus();
    setValue(search, to);
    // A new person shows as a search result, someone you've whispered as a conversation.
    const person = await waitFor(`[data-a-target="whisper-search-result-${to}"], [data-a-target="whisper-with-${to}"]`, 8000);
    if (!person) return `couldn't find ${to} in Twitch's whisper search`;
    (person.closest("button") || person).click();
    const thread = await waitFor(`[data-a-target="whisper-thread-${to}"]`, 8000);
    if (!thread) return `couldn't open a whisper conversation with ${to}`;
    const input = await waitFor(() => thread.querySelector('input[placeholder]:not([type="search"]), textarea'), 8000);
    if (!input) {
      return /block whispers from strangers/i.test(thread.innerText)
        ? `${to} blocks whispers from people they haven't whispered, so they need to whisper you first`
        : `Twitch didn't let you whisper ${to}`;
    }
    input.focus();
    setValue(input, text);
    await wait(400);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    for (let t = 0; t < 5000; t += 250) {
      await wait(250);
      if (!input.value.trim()) {
        thread.querySelector(`[data-a-target="thread-close-button-${to}"]`)?.click();
        return "";
      }
    }
    return "Twitch didn't send it";
  }

  // Tell the asker why their question didn't go, or bring a question back for
  // the streamer with why their answer didn't.
  async function reportFailure({ ref }, reason) {
    if (!ref?.id) return;
    if (ref.kind === "ask") {
      await update("askSent", (all) => {
        if (all[ref.id]) all[ref.id].failed = reason;
      });
    } else {
      await update("askInbox", (box) => {
        if (box[ref.id]) Object.assign(box[ref.id], { done: false, error: `Your answer didn't send: ${reason}.` });
      });
    }
  }

  async function runSender() {
    await wait(2000);
    const mine = (item) => !!item.incognito === chrome.extension.inIncognitoContext;
    for (let i = 0; i < 6; i++) {
      const { askOutbox = [] } = await chrome.storage.local.get("askOutbox");
      const next = askOutbox.find(mine);
      if (!next) break;
      await chrome.storage.local.set({ askOutbox: askOutbox.filter((item) => item !== next) });
      const problem = await sendWhisper(next.to, next.text);
      if (problem) await reportFailure(next, problem);
      await wait(800);
    }
    chrome.runtime.sendMessage({ type: "askSenderDone" });
  }

  // ===== The header button: "Ask" on other channels, "Questions" on yours ===============

  let panel = null; // { el, button }

  // Twitch wraps each header button in a few layers; the outermost one in the row.
  function slotOf(node) {
    while (node.parentElement && node.parentElement.children.length === 1) node = node.parentElement;
    return node;
  }

  function addHeaderButton() {
    const channel = channelName();
    const me = myLogin();
    const own = !!channel && channel === me;
    // Just before our Pin button (Pin keeps itself right before Follow, so this
    // way they don't keep swapping), or before Follow; on your own channel,
    // before the Edit pencil in the header (the stream and chat views), or else
    // before the "Customize channel" beside your name (Home; Twitch's notices
    // have such links too, so take the last one).
    const pin = !own && document.querySelector(".tbc-pinbtn");
    const anchor = own
      ? document.querySelector(EDIT_INFO) || [...document.querySelectorAll(CUSTOMIZE)].pop()
      : document.querySelector(FOLLOW_BTN);
    let btn = document.querySelector(".tbc-askhdr");
    // Only in the stream and chat views, where the chat is on screen.
    if (isSender || !channel || !me || (!pin && !anchor) || !visibleRoom()) {
      btn?.remove();
      return;
    }
    if (!btn) {
      btn = el("button", "tbc-askhdr");
      btn.type = "button";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        panel?.button === btn ? closePanel() : openPanel(btn);
      });
    }
    if (pin) {
      if (btn.nextElementSibling !== pin) pin.before(btn);
    } else {
      const slot = slotOf(anchor);
      if (btn.nextElementSibling !== slot) slot.before(btn);
    }
    const mode = own ? "own" : trusted.includes(channel) ? "ask" : "connect";
    if (btn.dataset.mode === mode && btn.dataset.channel === channel) return;
    btn.dataset.mode = mode;
    btn.dataset.channel = channel;
    btn.innerHTML = `${ASK_ICON}<span>${own ? "Questions" : "Ask"}</span>`;
    btn.classList.toggle("tbc-askhdr--off", mode === "connect");
    btn.title = own
      ? "Your Ask the Streamer connections"
      : mode === "ask"
        ? `Ask ${channel} a private question (they answer with one click)`
        : `You're not connected with ${channel} for Ask the Streamer`;
    closePanel();
  }

  function closePanel() {
    panel?.el.remove();
    panel = null;
  }

  function openPanel(button) {
    closePanel();
    const box = el("div", "tbc-askpanel");
    shieldKeys(box, closePanel);
    document.body.append(box);
    panel = { el: box, button };
    if (button.dataset.mode === "own") fillAllowList();
    else if (button.dataset.mode === "connect") fillConnect(button.dataset.channel);
    else fillAsk(button.dataset.channel);
    placePanel();
  }

  // Just under the button, kept on screen.
  function placePanel() {
    if (!panel) return;
    const r = panel.button.getBoundingClientRect();
    if (!r.width) return;
    panel.el.style.left = Math.max(8, Math.min(r.left, innerWidth - panel.el.offsetWidth - 8)) + "px";
    panel.el.style.top = r.bottom + 8 + "px";
  }

  window.addEventListener("pointerdown", (e) => {
    if (panel && !panel.el.contains(e.target) && !e.target.closest?.(".tbc-askhdr")) closePanel();
  }, true);
  window.addEventListener("resize", placePanel);
  window.addEventListener("scroll", placePanel, true);

  // ----- Asking -------------------------------------------------------------------------------

  function fillAsk(channel) {
    const box = panel.el;
    box.innerHTML =
      `<div class="tbc-askpanel__head">Ask <b></b> privately</div>` +
      `<p class="tbc-askpanel__sub">Sent as a whisper, so only you two see it. They tap an answer or type a reply. Only shows for them if they've added you too.</p>` +
      `<form class="tbc-askpanel__form"><input type="text" maxlength="${MAX_LEN}" placeholder="Your question" autocomplete="off">` +
      `<button type="submit">Send</button></form>` +
      `<p class="tbc-askpanel__note"></p>` +
      `<button type="button" class="tbc-askpanel__link">Remove from your connections</button>`;
    box.querySelector("b").textContent = channel;
    box.querySelector(".tbc-askpanel__link").addEventListener("click", () => {
      setTrusted(trusted.filter((l) => l !== channel));
      closePanel();
      addHeaderButton();
    });
    const input = box.querySelector("input");
    box.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = cleanText(input.value);
      if (!text || !trusted.includes(channel)) return; // only to your connections
      const id = newId();
      input.value = "";
      box.querySelector(".tbc-askpanel__note").textContent = "Sent. A small window opens for a moment to send it.";
      await update("askSent", (all) => (all[id] = { to: channel, text, at: Date.now(), answer: null }));
      await queueWhisper(channel, `❓ ${text} [MTT ?${id}]`, { kind: "ask", id });
      setTimeout(closePanel, 2500);
    });
    input.focus();
  }

  // A channel you're not connected with: offer to add them.
  function fillConnect(channel) {
    const box = panel.el;
    box.innerHTML =
      `<div class="tbc-askpanel__head">Connect with <b></b>?</div>` +
      `<p class="tbc-askpanel__sub">Ask the Streamer only works between people who have added each other. Add them here, and they add you (from Questions on their own channel). Then you can ask each other private questions.</p>` +
      `<form class="tbc-askpanel__form"><button type="submit">Add to your connections</button></form>`;
    box.querySelector("b").textContent = channel;
    box.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      if (!trusted.includes(channel)) setTrusted([...trusted, channel]);
      addHeaderButton(); // now "Ask", and closes this
      openPanel(document.querySelector(".tbc-askhdr"));
    });
  }

  // ----- Your connections, searchable ---------------------------------------------------------

  const pics = {}; // login -> picture url
  const picsAsked = new Set();
  const searches = {}; // search text -> Twitch's results [{ login, name, img }]
  let searchTimer = 0;

  function gql(query, variables) {
    return fetch("https://gql.twitch.tv/gql", {
      method: "POST",
      headers: { "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko" },
      body: JSON.stringify({ query, variables }),
    }).then((r) => r.json());
  }

  function avatar(login) {
    const img = el("img", "tbc-usearch__pic");
    img.alt = "";
    if (pics[login]) img.src = pics[login];
    return img;
  }

  // Pictures, asked for once each, filled in wherever they're showing.
  function loadPics(logins) {
    const need = logins.filter((l) => !pics[l] && !picsAsked.has(l));
    if (!need.length) return;
    need.forEach((l) => picsAsked.add(l));
    gql("query($l:[String!]){ users(logins:$l){ login profileImageURL(width:70) } }", { l: need })
      .then((j) => {
        for (const u of j.data?.users || []) if (u) pics[u.login] = u.profileImageURL;
        for (const img of document.querySelectorAll(".tbc-askpanel .tbc-usearch__pic:not([src])")) {
          const login = img.closest("[data-login]")?.dataset.login;
          if (pics[login]) img.src = pics[login];
        }
      })
      .catch(() => {});
  }

  // People chatting in this chat right now.
  function chatters() {
    const seen = new Map();
    for (const name of document.querySelectorAll('[data-a-target="chat-message-username"]')) {
      const display = name.textContent.trim();
      const login = display.toLowerCase();
      if (/^[a-z0-9_]+$/.test(login)) seen.set(login, { login, name: display });
    }
    return [...seen.values()];
  }

  function searchTwitch(q, redraw) {
    if (searches[q]) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      gql("query($q:String!){ searchUsers(userQuery:$q, first:6){ edges{ node{ login displayName profileImageURL(width:70) } } } }", { q })
        .then((j) => {
          searches[q] = (j.data?.searchUsers?.edges || []).map(({ node: u }) => ({ login: u.login, name: u.displayName, img: u.profileImageURL }));
          redraw();
        })
        .catch(() => {});
    }, 250);
  }

  function setTrusted(list) {
    trusted = list;
    chrome.storage.local.set({ askTrusted: list });
  }

  function fillAllowList() {
    const box = panel.el;
    box.innerHTML =
      `<div class="tbc-askpanel__head">Ask connections</div>` +
      `<p class="tbc-askpanel__sub">People you can ask, and who can ask you. It only works once you've both added each other; anyone else's question stays a normal whisper.</p>` +
      `<div class="tbc-allow"></div>` +
      `<input type="text" class="tbc-usearch__input" placeholder="Search people to connect with" autocomplete="off" spellcheck="false">` +
      `<div class="tbc-usearch"></div>`;
    const list = box.querySelector(".tbc-allow");
    if (!trusted.length) list.append(el("p", "tbc-askpanel__sub", "Nobody yet. Search below to add your mods, regulars or streamers you ask."));
    for (const login of trusted) {
      const row = el("div", "tbc-allow__row");
      row.dataset.login = login;
      const x = el("button", "tbc-x", "×");
      x.type = "button";
      x.title = `Disconnect from ${login}`;
      x.addEventListener("click", () => {
        setTrusted(trusted.filter((l) => l !== login));
        fillAllowList();
      });
      row.append(avatar(login), el("span", "tbc-allow__name", login), x);
      list.append(row);
    }
    loadPics(trusted);
    const input = box.querySelector(".tbc-usearch__input");
    const results = box.querySelector(".tbc-usearch");
    const pick = (login) => {
      if (!trusted.includes(login)) setTrusted([...trusted, login]);
      fillAllowList();
    };
    input.addEventListener("input", () => drawResults(input, results, pick));
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const typed = input.value.trim().replace(/^@/, "").toLowerCase();
      const first = results.querySelector(".tbc-usearch__item");
      if (first) first.click();
      else if (/^[a-z0-9_]{3,25}$/.test(typed)) pick(typed);
    });
    input.focus();
    placePanel();
  }

  // Suggestions: people in this chat, then channels you follow, then Twitch's search.
  function drawResults(input, results, pick) {
    const q = input.value.trim().toLowerCase().replace(/^@/, "");
    results.textContent = "";
    if (!q) return;
    const found = new Map();
    const add = (u, from) => {
      if (!u.login || trusted.includes(u.login) || found.has(u.login)) return;
      if (u.img) pics[u.login] = u.img;
      found.set(u.login, { ...u, from });
    };
    const matches = (u) => u.login.includes(q) || (u.name || "").toLowerCase().includes(q);
    const startsFirst = (a, b) => (b.login.startsWith(q) - a.login.startsWith(q)) || a.login.localeCompare(b.login);
    chatters().filter(matches).sort(startsFirst).forEach((u) => add(u, "In this chat"));
    follows.filter(matches).sort(startsFirst).forEach((u) => add(u, "You follow"));
    (searches[q] || []).forEach((u) => add(u, "Twitch"));
    searchTwitch(q, () => {
      if (input.isConnected && input.value.trim().toLowerCase().replace(/^@/, "") === q) drawResults(input, results, pick);
    });
    const list = [...found.values()].slice(0, 6);
    if (!list.length) {
      results.append(el("div", "tbc-usearch__empty", searches[q] ? "Nobody found" : "Searching…"));
      return;
    }
    for (const u of list) {
      const item = el("button", "tbc-usearch__item");
      item.type = "button";
      item.dataset.login = u.login;
      item.title = `Connect with ${u.name || u.login}`;
      item.append(avatar(u.login), el("span", "tbc-usearch__name", u.name || u.login), el("span", "tbc-usearch__from", u.from));
      item.addEventListener("click", () => pick(u.login));
      results.append(item);
    }
    loadPics(list.map((u) => u.login));
  }

  // ===== Incoming whispers =================================================================

  const POLL_MS = 15 * 1000;
  const handled = new Set(); // whisper message ids already looked at

  const authToken = () => document.cookie.match(/(?:^|; )auth-token=([^;]+)/)?.[1] || "";

  // Anything to listen for: someone allowed to ask you, or a question of yours
  // still waiting for its answer.
  const listening = () => trusted.length > 0 || Object.values(sent).some((q) => !q.answer && !q.failed);

  // The asking goes through background.js: a page's own scripts can't send your
  // sign-in to Twitch's data service, but the extension's background can. A
  // short status is left on the page (data-tbc-ask-poll) for troubleshooting.
  async function pollWhispers() {
    const token = authToken();
    const status = (text) => (document.documentElement.dataset.tbcAskPoll = `${new Date().toLocaleTimeString()} ${text}`);
    if (!alive()) return;
    if (!token) return status("signed out");
    if (!listening()) return status("idle (nobody on your list, no questions waiting)");
    const query = "{ currentUser { whisperThreads(first: 10) { edges { node { messages(first: 10) { edges { node { id sentAt content { content } from { login displayName } } } } } } } } }";
    let j;
    try {
      j = await chrome.runtime.sendMessage({ type: "askWhispers", token, query });
    } catch (e) {
      return status(`couldn't ask Twitch: ${e.message}`);
    }
    if (!j?.data) return status(`Twitch said: ${j?.error || j?.errors?.[0]?.message || "nothing"}`);
    let tagged = 0;
    for (const thread of j.data?.currentUser?.whisperThreads?.edges || []) {
      for (const { node: m } of thread.node?.messages?.edges || []) {
        if (!m || handled.has(m.id)) continue;
        handled.add(m.id);
        const body = m.content?.content || "";
        if (!body.includes("[MTT ") || Date.now() - Date.parse(m.sentAt) > DAY_MS) continue;
        tagged++;
        handleWhisper(body, (m.from?.login || "").toLowerCase(), m.from?.displayName);
      }
    }
    status(`checked, ${tagged} new tagged`);
  }

  // Twitch opens its whisper window when a whisper arrives. Each conversation
  // is labelled with the other person's username, and each line starts with
  // who wrote it; their tagged lines are handled once each.
  function readWhisperWindows() {
    const me = myLogin();
    for (const thread of document.querySelectorAll('[data-a-target^="whisper-thread-"]')) {
      const login = thread.dataset.aTarget.match(/^whisper-thread-([a-z0-9_]+)$/)?.[1];
      if (!login) continue;
      for (const msg of thread.querySelectorAll('[data-a-target="whisper-message"]:not([data-tbc-seen])')) {
        const text = msg.innerText;
        if (!text.trim()) continue; // not drawn yet
        msg.dataset.tbcSeen = "1";
        const colon = text.indexOf(":");
        const author = text.slice(0, colon).trim();
        // Skip your own lines; theirs may show a display name rather than the username.
        if (colon < 0 || !text.includes("[MTT ") || author.toLowerCase() === me) continue;
        handleWhisper(text.slice(colon + 1).trim(), login, author);
      }
    }
  }

  function handleWhisper(body, from, name) {
    const m = body.match(TAG_RE);
    if (!m || from === myLogin()) return;
    const [, kind, id, code] = m;
    const text = body.replace(TAG_RE, "").trim();
    if (kind === "?") {
      if (!trusted.includes(from) || inbox[id]) return; // not on your list (stays a normal whisper), or already have it
      update("askInbox", (box) => {
        const open = Object.values(box).filter((q) => q.from === from && !q.done).length;
        if (box[id] || open >= MAX_OPEN_PER_PERSON) return; // already have it, or too many
        box[id] = { from, name: name || from, text: text.replace(/^❓\s*/, ""), at: Date.now() };
      });
    } else if (ANSWERS[code] && sent[id] && !sent[id].answer) {
      update("askSent", (all) => {
        const q = all[id];
        if (!q || q.to !== from || q.answer) return; // only answers to your own questions
        q.answer = { code, at: Date.now(), seen: false };
        if (code === "c") q.answer.text = text.replace(/^💬\s*/, "");
      });
    }
  }

  // ===== Cards: at the top of chat, just under Twitch's pinned messages ====================

  // The box for our cards, or null with no chat on the page. Twitch's pinned
  // messages, drops and hype trains float in a stack over the top of the chat
  // list; while it's showing, the box hangs from its bottom so nothing covers
  // it, otherwise it sits just above the chat list.
  // The chat column, only if it's actually on screen: on an offline channel's
  // Home tab Twitch keeps it in the page but pushes it off the right edge.
  function visibleRoom() {
    const room = document.querySelector(CHAT_ROOM);
    if (!room?.querySelector(CHAT_LIST)) return null;
    const r = room.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left < innerWidth - 40 && r.right > 40 ? room : null;
  }

  function chatPins() {
    const room = visibleRoom();
    const list = room?.querySelector(CHAT_LIST);
    if (!list) return null;
    let box = room.querySelector(".tbc-chatpins");
    if (!box) box = el("div", "tbc-chatpins");
    let stack = room.querySelector('[class*="community-highlight-stack__scroll-area"]');
    while (stack && stack !== room && getComputedStyle(stack).position !== "absolute") stack = stack.parentElement;
    if (stack && stack !== room) {
      if (box.parentElement !== stack || box.nextElementSibling) stack.append(box);
    } else if (box.nextElementSibling !== list) {
      list.before(box);
    }
    return box;
  }

  // Show exactly the cards that should be showing, at the top of the chat. With
  // no chat on screen they're put away until there is one (they stay saved).
  function showCards(attr, ids, build) {
    const pins = ids.length ? chatPins() : null; // (also keeps it in place if Twitch redraws)
    for (const card of document.querySelectorAll(`[data-${attr}]`)) {
      if (!pins || !ids.includes(card.dataset[attr]) || !pins.contains(card)) card.remove();
    }
    if (pins) {
      for (const id of ids) {
        if (pins.querySelector(`[data-${attr}="${id}"]`)) continue;
        const fresh = build(id);
        fresh.dataset[attr] = id;
        pins.append(fresh);
      }
    }
    for (const box of document.querySelectorAll(".tbc-chatpins")) {
      if (!box.children.length) box.remove();
    }
  }

  function render() {
    if (isSender || !ready) return;
    const questions = Object.keys(inbox).filter((id) => !inbox[id].done).sort((a, b) => inbox[a].at - inbox[b].at);
    showCards("qid", questions, questionCard);
    const replies = Object.keys(sent).filter((id) => (sent[id].answer && !sent[id].answer.seen) || (sent[id].failed && !sent[id].failSeen));
    showCards("aid", replies, replyCard);
  }

  // ----- The streamer's question card ----------------------------------------------------------

  function questionCard(id) {
    const q = inbox[id];
    const card = el("div", "tbc-qcard");
    card.setAttribute("role", "alertdialog");
    card.append(el("div", "tbc-qcard__head", `${q.name} asks`), el("div", "tbc-qcard__text", q.text));
    if (q.error) card.append(el("div", "tbc-qcard__error", q.error));
    const buttons = el("div", "tbc-qcard__answers");
    for (const [code, a] of Object.entries(ANSWERS)) {
      if (code === "c") continue;
      const b = el("button", `tbc-qcard__answer tbc-answer--${code}`);
      b.type = "button";
      b.innerHTML = svg(a.icon);
      b.append(el("span", null, a.label));
      b.addEventListener("click", () => answer(id, code));
      buttons.append(b);
    }
    const own = el("form", "tbc-qcard__own");
    const input = el("input");
    input.type = "text";
    input.maxLength = MAX_LEN;
    input.placeholder = "Or type your own reply";
    input.autocomplete = "off";
    input.value = drafts[id] || "";
    input.addEventListener("input", () => (drafts[id] = input.value));
    shieldKeys(input);
    const send = el("button", null, "Send");
    send.type = "submit";
    own.append(input, send);
    own.addEventListener("submit", (e) => {
      e.preventDefault();
      const reply = cleanText(input.value);
      if (reply) answer(id, "c", reply);
    });
    const dismiss = el("button", "tbc-qcard__dismiss", "Dismiss without answering");
    dismiss.type = "button";
    dismiss.addEventListener("click", () => closeQuestion(id));
    card.append(buttons, own, dismiss);
    return card;
  }

  // Answered or dismissed: marked done, and forgotten after a week.
  function closeQuestion(id) {
    update("askInbox", (box) => {
      if (box[id]) Object.assign(box[id], { done: true, error: null });
      for (const [k, q] of Object.entries(box)) if (Date.now() - q.at > 7 * DAY_MS) delete box[k];
    });
  }

  function answer(id, code, reply) {
    const q = inbox[id];
    if (!q) return;
    const a = ANSWERS[code];
    const text = code === "c"
      ? `${a.emoji} ${reply} [MTT !${id} c]`
      : `${a.emoji} ${a.label} (re: "${clip(q.text, 60)}") [MTT !${id} ${code}]`;
    queueWhisper(q.from, text, { kind: "answer", id });
    delete drafts[id];
    closeQuestion(id);
  }

  // ----- The asker's card: their answer, or why the question didn't send -----------------------

  function replyCard(id) {
    const q = sent[id];
    const failed = !q.answer;
    const a = failed ? null : ANSWERS[q.answer.code];
    const card = el("div", `tbc-acard${failed ? " tbc-acard--failed" : ""}`);
    const icon = el("div", `tbc-acard__icon tbc-answer--${failed ? "failed" : q.answer.code}`);
    icon.innerHTML = svg(failed ? WARN_ICON : a.icon, 20);
    const body = el("div", "tbc-acard__body");
    if (failed) {
      body.append(el("div", "tbc-acard__head", `Couldn't ask ${q.to}`), el("div", "tbc-acard__text", `${q.failed}.`));
    } else {
      body.append(el("div", "tbc-acard__who", `${q.to} answered`), el("div", "tbc-acard__head", q.answer.code === "c" ? q.answer.text : a.label));
    }
    body.append(el("div", "tbc-acard__question", q.text));
    const x = el("button", "tbc-x", "×");
    x.type = "button";
    x.title = "Close";
    x.addEventListener("click", () => update("askSent", (all) => {
      if (!all[id]) return;
      if (all[id].answer) all[id].answer.seen = true;
      else all[id].failSeen = true;
    }));
    card.append(icon, body, x);
    return card;
  }

  // ===== Start ================================================================================

  function load(d) {
    if (d.askTrusted) trusted = d.askTrusted.map((l) => l.toLowerCase());
    if (d.askInbox) inbox = d.askInbox;
    if (d.askSent) sent = Object.fromEntries(Object.entries(d.askSent).filter(([, q]) => Date.now() - q.at < DAY_MS));
    if (d.follows) follows = d.follows.list || [];
    addHeaderButton(); // Ask, or the offer to connect
    render();
  }

  chrome.runtime.sendMessage({ type: "amAskSender" }, (yes) => {
    isSender = !!yes;
    if (isSender) return void runSender();
    chrome.storage.local.get(["askTrusted", "askInbox", "askSent", "follows"], (d) => {
      ready = true;
      load(d);
      pollWhispers();
      setInterval(pollWhispers, POLL_MS);
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || isSender) return;
    const d = {};
    for (const k of ["askTrusted", "askInbox", "askSent", "follows"]) {
      if (changes[k]) d[k] = changes[k].newValue || (k === "askTrusted" ? [] : {});
    }
    if (Object.keys(d).length) load(d);
  });

  // Twitch builds and rebuilds the header, chat and whisper windows as you go.
  let pending = 0;
  const observer = new MutationObserver(() => {
    if (!alive()) return observer.disconnect();
    if (pending) return;
    pending = setTimeout(() => {
      pending = 0;
      addHeaderButton();
      if (ready && !isSender) {
        readWhisperWindows();
        render();
      }
    }, 400);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
});
