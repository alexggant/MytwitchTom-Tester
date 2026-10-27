// A search box at the top of the channel points rewards panel (the Bits and
// Points button under chat). Type to narrow the rewards down by name or by their
// description; every word you type has to appear in one or the other.
//
// The panel only shows reward names, so descriptions are looked up from Twitch
// (public, no login needed) once per channel and kept for a few minutes.
//
// Each channel points reward also gets a star (top-right corner, shown on
// hover) to make it a favorite. Favorites move up under a "Favorites" heading,
// below Power-ups and the watch streak, right above the channel's other
// rewards; per channel, and they stay next time. Saved in chrome.storage.local
// as "starredRewards": { channel: [reward titles] }.
//
// Wrapped so its names don't clash with the other scripts.
(() => {
  const LIST = ".rewards-list";
  const ITEM = '[class*="rewardListItem--"]'; // channel point rewards and Bits power-ups
  const CACHE_MS = 5 * 60 * 1000;

  const prompts = {}; // channel -> { at, byTitle: { title: description } }
  let query = "";
  let starred = {}; // channel -> [titles]
  chrome.storage.local.get("starredRewards", (d) => {
    starred = d.starredRewards || {};
    const list = document.querySelector(LIST);
    if (list) applyStars(list);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.starredRewards) return;
    starred = changes.starredRewards.newValue || {};
    const list = document.querySelector(LIST);
    if (list) applyStars(list);
  });

  function channelName() {
    const parts = location.pathname.split("/").filter(Boolean);
    const name = parts[0] === "popout" || parts[0] === "embed" ? parts[1] : parts[0];
    return name && /^[a-z0-9_]+$/i.test(name) ? name.toLowerCase() : null;
  }

  function loadPrompts(channel) {
    const cached = prompts[channel];
    if (cached && Date.now() - cached.at < CACHE_MS) return;
    prompts[channel] = { at: Date.now(), byTitle: cached?.byTitle || {} };
    fetch("https://gql.twitch.tv/gql", {
      method: "POST",
      headers: { "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko" },
      body: JSON.stringify({
        query: "query($l:String!){ channel(name:$l){ communityPointsSettings { customRewards { title prompt } } } }",
        variables: { l: channel },
      }),
    })
      .then((r) => r.json())
      .then((j) => {
        const byTitle = {};
        for (const r of j.data?.channel?.communityPointsSettings?.customRewards || []) {
          if (r.prompt) byTitle[r.title.trim()] = r.prompt;
        }
        prompts[channel] = { at: Date.now(), byTitle };
        filter();
      })
      .catch(() => {});
  }

  const titleOf = (item) => (item.querySelector("p[title]")?.getAttribute("title") || item.textContent).trim();

  // Show only rewards matching the search; with an empty search, show everything.
  function filter() {
    const list = document.querySelector(LIST);
    if (!list) return;
    const box = list.querySelector(".tbc-rsearch");
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const byTitle = prompts[channelName()]?.byTitle || {};
    let shown = 0;
    for (const child of list.children) {
      if (child === box) continue;
      if (child.matches(".tbc-rstar-head, .tbc-rstar-end")) {
        child.classList.toggle("tbc-rsearch-hide", !!words.length);
        continue;
      }
      const item = child.matches(ITEM) ? child : child.querySelector(ITEM);
      if (!words.length) {
        child.classList.remove("tbc-rsearch-hide");
        continue;
      }
      // Section headings, the watch streak line etc. are hidden while searching.
      let match = false;
      if (item) {
        const title = titleOf(item);
        const text = (title + " " + (byTitle[title] || "")).toLowerCase();
        match = words.every((w) => text.includes(w));
      }
      child.classList.toggle("tbc-rsearch-hide", !match);
      if (match) shown++;
    }
    if (box) {
      // Only touch the count when it changes: writing it is itself a page change,
      // which would set the observer off again.
      const count = box.querySelector(".tbc-rsearch__count");
      const text = words.length ? (shown ? `${shown} found` : "No matches") : "";
      if (count.textContent !== text) count.textContent = text;
    }
  }

  // ===== Stars ======================================================================

  const STAR = '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M10 1.8l2.5 5.3 5.8.7-4.3 4 1.1 5.7L10 14.7l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z"/></svg>';

  function isStarred(title) {
    return (starred[channelName()] || []).includes(title);
  }

  function toggleStar(title) {
    const channel = channelName();
    if (!channel) return;
    const set = starred[channel] || [];
    starred = { ...starred, [channel]: set.includes(title) ? set.filter((t) => t !== title) : [...set, title] };
    if (!starred[channel].length) delete starred[channel];
    try {
      chrome.storage.local.set({ starredRewards: starred });
    } catch {}
    const list = document.querySelector(LIST);
    if (list) applyStars(list);
  }

  // A star on every reward, and favorites moved up above the other rewards. The
  // list is a wrapping row, so CSS "order" moves them without touching Twitch's
  // elements: everything up to the first reward keeps its place (order 0), then
  // the Favorites heading (1), favorites (2), a dividing line (3), the rest (4).
  function applyStars(list) {
    let any = false;
    let reached = false; // past the first reward
    for (const child of list.children) {
      if (child.matches(".tbc-rstar-head, .tbc-rstar-end, .tbc-rsearch")) continue;
      const item = child.matches(ITEM) ? child : child.querySelector(ITEM);
      reached ||= !!item;
      if (child.classList.contains("tbc-rafter") !== (reached && !(item && isStarred(titleOf(item))))) {
        child.classList.toggle("tbc-rafter");
      }
      if (!item) continue;
      const title = titleOf(item);
      const on = isStarred(title);
      any ||= on;
      let star = child.querySelector(":scope > .tbc-rstar");
      if (!star) {
        star = document.createElement("button");
        star.type = "button";
        star.className = "tbc-rstar";
        star.innerHTML = STAR;
        star.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleStar(star.dataset.title);
        });
        child.classList.add("tbc-rstar-host");
        child.append(star);
      }
      if (star.dataset.title !== title) star.dataset.title = title;
      if (star.classList.contains("tbc-rstar--on") !== on) {
        star.classList.toggle("tbc-rstar--on", on);
        star.title = on ? "Remove from favorites" : "Favorite: show this one first";
      }
      if (child.classList.contains("tbc-rstarred") !== on) child.classList.toggle("tbc-rstarred", on);
    }
    // The Favorites heading, and a line after the favorites so the other
    // rewards start on a row of their own.
    let head = list.querySelector(":scope > .tbc-rstar-head");
    if (any && !head) {
      head = document.createElement("div");
      head.className = "tbc-rstar-head";
      head.textContent = "Favorites";
      const end = document.createElement("div");
      end.className = "tbc-rstar-end";
      list.append(head, end);
    } else if (!any && head) {
      head.remove();
      list.querySelector(":scope > .tbc-rstar-end")?.remove();
    }
  }

  function addBox(list) {
    if (list.querySelector(".tbc-rsearch")) return;
    const box = document.createElement("div");
    box.className = "tbc-rsearch";
    box.innerHTML =
      `<input type="search" class="tbc-rsearch__input" placeholder="Search rewards and sounds" spellcheck="false" autocomplete="off">` +
      `<span class="tbc-rsearch__count"></span>`;
    const input = box.querySelector("input");
    input.value = query;
    input.addEventListener("input", () => {
      query = input.value;
      filter();
    });
    // Keep typing away from Twitch's shortcuts; Esc clears the search first.
    for (const type of ["keydown", "keyup", "keypress"]) {
      input.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === "keydown" && e.key === "Escape" && input.value) {
          e.preventDefault();
          input.value = query = "";
          filter();
        }
      });
    }
    list.prepend(box);
    // Ready to type as soon as the panel opens (not while streak.js reads it invisibly).
    if (!document.documentElement.classList.contains("tbc-peek")) input.focus();
  }

  let wasOpen = false;
  const observer = new MutationObserver((mutations) => {
    // Ignore changes inside the search box itself (its count updating).
    if (mutations.every((m) => m.target.closest?.(".tbc-rsearch, .tbc-rstar") || m.target.parentElement?.closest(".tbc-rsearch, .tbc-rstar"))) return;
    try {
      if (!chrome.runtime?.id) return observer.disconnect();
    } catch {
      return observer.disconnect();
    }
    const list = document.querySelector(LIST);
    if (!list) {
      // Panel closed: start fresh next time.
      if (wasOpen) query = "";
      wasOpen = false;
      return;
    }
    wasOpen = true;
    const channel = channelName();
    if (channel) loadPrompts(channel);
    addBox(list);
    applyStars(list);
    if (query) filter();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
