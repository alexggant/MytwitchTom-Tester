// A search box at the top of the channel points rewards panel (the Bits and
// Points button under chat). Type to narrow the rewards down by name or by their
// description; every word you type has to appear in one or the other.
//
// The panel only shows reward names, so descriptions are looked up from Twitch
// (public, no login needed) once per channel and kept for a few minutes.
//
// Wrapped so its names don't clash with the other scripts.
(() => {
  const LIST = ".rewards-list";
  const ITEM = '[class*="rewardListItem--"]'; // channel point rewards and Bits power-ups
  const CACHE_MS = 5 * 60 * 1000;

  const prompts = {}; // channel -> { at, byTitle: { title: description } }
  let query = "";

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
    if (mutations.every((m) => m.target.closest?.(".tbc-rsearch") || m.target.parentElement?.closest(".tbc-rsearch"))) return;
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
    if (query) filter();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
