// Pinned channels. On a channel's page, a "Pin" button next to Follow adds
// them to a "Pinned Channels" list at the top of the left sidebar, above
// Followed Channels. Pinned channels stay listed whether or not they're live,
// in slightly smaller rows than Twitch's own: a red dot and viewer count when
// live, "Offline" and when they were last live when not. Clicking a row goes
// to their channel. Click "Pinned" on the channel page (or the × on the row)
// to unpin.
//
// Live status comes from Twitch's public GraphQL endpoint (no sign-in), asked
// for every pinned channel at once, every 2 minutes while the tab is open.
//
// Wrapped so its names don't clash with the other scripts.
(() => {
  if (window.top !== window) return;

  const FOLLOWED = '.side-nav-section[aria-label="Followed Channels"]';
  const FOLLOW_BTN = '[data-a-target="follow-button"], [data-a-target="unfollow-button"]';
  const REFRESH_MS = 2 * 60 * 1000;
  const PIN_ICON = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M12.5 2.5l5 5-2 .8-3.4 3.4.4 4.3-1.5 1.5-3.2-3.2L3.5 18.6l-1.1-1.1 4.3-4.3-3.2-3.2L5 8.5l4.3.4 3.4-3.4z" fill="currentColor"/></svg>';

  let pins = []; // [{ login, name, avatar }] in the order they were pinned
  let info = {}; // login -> { live, viewers, game, lastLive }
  let ready = false;

  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };

  const save = () => alive() && chrome.storage.local.set({ pinnedChannels: pins });
  const isPinned = (login) => pins.some((p) => p.login === login);

  // The channel whose page you're on (also /name/videos, /name/about, ...).
  function currentChannel() {
    const parts = location.pathname.split("/").filter(Boolean);
    const name = parts[0]?.toLowerCase();
    return name && /^[a-z0-9_]+$/.test(name) &&
      !/^(directory|videos|settings|search|subscriptions|inventory|wallet|drops|downloads|following|popout|embed|moderator)$/.test(name)
      ? name
      : null;
  }

  // ===== Live status ===================================================================

  function refresh() {
    if (!pins.length || !alive()) return;
    const fields = "login displayName profileImageURL(width:70) stream{ viewersCount game{ displayName } } lastBroadcast{ startedAt }";
    const query = "{ " + pins.map((p, i) => `u${i}: user(login: "${p.login}") { ${fields} }`).join(" ") + " }";
    fetch("https://gql.twitch.tv/gql", {
      method: "POST",
      headers: { "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko" },
      body: JSON.stringify({ query }),
    })
      .then((r) => r.json())
      .then((j) => {
        let changed = false;
        pins.forEach((p, i) => {
          const u = j.data?.[`u${i}`];
          if (!u) return;
          info[p.login] = {
            live: !!u.stream,
            viewers: u.stream?.viewersCount || 0,
            game: u.stream?.game?.displayName || "",
            lastLive: Date.parse(u.lastBroadcast?.startedAt || "") || 0,
          };
          // Names and pictures can change; keep the saved copy current.
          if (u.displayName !== p.name || u.profileImageURL !== p.avatar) {
            p.name = u.displayName;
            p.avatar = u.profileImageURL;
            changed = true;
          }
        });
        if (changed) save();
        render();
      })
      .catch(() => {});
  }

  // Look a channel up when it's pinned, so its row has a picture right away.
  function pin(login) {
    if (isPinned(login)) return;
    const name = document.querySelector("h1.tw-title")?.textContent.trim() || login;
    pins.push({ login, name, avatar: "" });
    save();
    render();
    refresh();
  }

  function unpin(login) {
    pins = pins.filter((p) => p.login !== login);
    delete info[login];
    save();
    render();
  }

  // ===== The sidebar list ==============================================================

  function viewers(n) {
    return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "K" : String(n);
  }

  function ago(t) {
    if (!t) return "";
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days < 1) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return months < 12 ? `${months}mo ago` : `${Math.floor(days / 365)}y ago`;
  }

  // Go to a channel the way Twitch's own links do, without reloading the page.
  function go(login) {
    if (currentChannel() === login && location.pathname.split("/").filter(Boolean).length === 1) return;
    history.pushState(null, "", `/${login}`);
    dispatchEvent(new PopStateEvent("popstate"));
  }

  function row(p) {
    const s = info[p.login] || {};
    const a = document.createElement("a");
    a.className = "tbc-pinned__row" + (s.live ? " tbc-pinned__row--live" : "");
    a.href = `/${p.login}`;
    a.title = s.live ? `${p.name} is live${s.game ? ": " + s.game : ""}` : `${p.name} (offline)`;
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; // new tab etc. as usual
      e.preventDefault();
      go(p.login);
    });

    const img = document.createElement("img");
    img.className = "tbc-pinned__avatar";
    img.alt = "";
    if (p.avatar) img.src = p.avatar;

    const text = document.createElement("div");
    text.className = "tbc-pinned__text";
    const name = document.createElement("div");
    name.className = "tbc-pinned__name";
    name.textContent = p.name;
    const sub = document.createElement("div");
    sub.className = "tbc-pinned__sub";
    sub.textContent = s.live ? s.game || "Live" : s.lastLive ? `Offline · live ${ago(s.lastLive)}` : "Offline";
    text.append(name, sub);

    const status = document.createElement("div");
    status.className = "tbc-pinned__status";
    if (s.live) status.innerHTML = `<span class="tbc-pinned__dot"></span>${viewers(s.viewers)}`;

    const x = document.createElement("button");
    x.type = "button";
    x.className = "tbc-pinned__unpin";
    x.textContent = "×";
    x.title = `Unpin ${p.name}`;
    x.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      unpin(p.login);
    });

    a.append(img, text, status, x);
    return a;
  }

  function render() {
    if (!ready) return;
    const followed = document.querySelector(FOLLOWED);
    let box = document.querySelector(".tbc-pinned");
    if (!pins.length || !followed) {
      box?.remove();
    } else {
      if (!box) {
        box = document.createElement("div");
        box.className = "tbc-pinned";
        box.setAttribute("aria-label", "Pinned Channels");
      }
      if (box.nextElementSibling !== followed) followed.before(box);
      const head = document.createElement("h3");
      head.className = "tbc-pinned__head";
      head.textContent = "Pinned Channels";
      box.replaceChildren(head, ...pins.map(row));
    }
    renderButton();
  }

  // ===== The Pin button on a channel's page ============================================

  function renderButton() {
    const login = currentChannel();
    const follow = login && document.querySelector(FOLLOW_BTN);
    let btn = document.querySelector(".tbc-pinbtn");
    if (!follow) {
      btn?.remove();
      return;
    }
    // Twitch wraps the Follow button in a few layers; put the Pin button
    // beside the outermost one in the row (Follow / Gift a Sub / Subscribe).
    let slot = follow;
    while (slot.parentElement && slot.parentElement.children.length === 1) slot = slot.parentElement;
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tbc-pinbtn";
      btn.addEventListener("click", () => {
        const l = btn.dataset.channel;
        isPinned(l) ? unpin(l) : pin(l);
      });
    }
    if (btn.nextElementSibling !== slot) slot.before(btn);
    const on = isPinned(login);
    if (btn.dataset.channel === login && btn.classList.contains("tbc-pinbtn--on") === on && btn.firstChild) return;
    btn.dataset.channel = login;
    btn.classList.toggle("tbc-pinbtn--on", on);
    btn.innerHTML = `${PIN_ICON}<span>${on ? "Pinned" : "Pin"}</span>`;
    btn.title = on ? "Unpin from the top of your sidebar" : "Pin to the top of your sidebar";
  }

  // ===== Start =========================================================================

  chrome.storage.local.get("pinnedChannels", (d) => {
    pins = Array.isArray(d.pinnedChannels) ? d.pinnedChannels : [];
    ready = true;
    render();
    refresh();
  });

  // Pinned or unpinned in another tab.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.pinnedChannels) return;
    const before = new Set(pins.map((p) => p.login));
    pins = changes.pinnedChannels.newValue || [];
    render();
    if (pins.some((p) => !before.has(p.login))) refresh();
  });

  setInterval(() => {
    if (!alive()) return;
    if (document.visibilityState === "visible") refresh();
  }, REFRESH_MS);

  // Twitch builds the sidebar and the channel header after the page loads,
  // and changes pages without reloading.
  let pending = 0;
  const observer = new MutationObserver(() => {
    if (!alive()) return observer.disconnect();
    if (pending) return;
    pending = setTimeout(() => {
      pending = 0;
      const box = document.querySelector(".tbc-pinned");
      const followed = document.querySelector(FOLLOWED);
      if (pins.length && (!box || box.nextElementSibling !== followed)) render();
      else renderButton();
    }, 300);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
