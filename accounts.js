// Account switcher. In Twitch's avatar menu (top right), a small ▾ next to your
// name opens a list of accounts you've added here; pick one to switch to it.
// "Add another account" saves the account you're on, signs this browser out of
// Twitch (only locally, so that account's saved sign-in keeps working) and opens
// Twitch's login page; once you've signed in, that account is saved too.
//
// The cookie work happens in background.js (pages can't touch cookies).
//
// Wrapped so its names don't clash with the other scripts.
(() => {
  if (window.top !== window) return;

  const NAME = '[data-a-target="user-display-name"]';
  const ask = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));

  function alive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  // Keep saved sign-ins fresh: whenever you're signed into an account that's on the
  // list (or you've just signed in after "Add another account"), save it again.
  chrome.storage.local.get(["accounts", "accountAdding"], async (d) => {
    const login = (document.cookie.match(/(?:^|;\s*)login=([^;]+)/) || [])[1];
    if (login && (d.accountAdding || d.accounts?.[login])) await ask({ type: "accountSave" });
  });

  // ===== The ▾ button next to your name ============================================

  function addButton() {
    const name = document.querySelector(NAME);
    if (!name || name.parentElement.querySelector(".tbc-acct-btn")) return;
    name.parentElement.classList.add("tbc-acct-row");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tbc-acct-btn";
    b.textContent = "▾";
    b.title = "Switch account";
    b.setAttribute("aria-label", "Switch account");
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleList(name);
    });
    name.after(b);
  }

  // ===== The list of accounts ======================================================

  async function toggleList(name) {
    const open = document.querySelector(".tbc-acct-list");
    if (open) return open.remove();

    // Full width under the avatar-and-name header: climb out of its side-by-side
    // (flex) layout to the block it sits in.
    let header = name;
    while (header.parentElement && getComputedStyle(header.parentElement).display.includes("flex")) {
      header = header.parentElement;
    }
    const list = document.createElement("div");
    list.className = "tbc-acct-list";
    header.after(list); // inside Twitch's menu, so clicks here don't close it
    list.textContent = "Loading…";
    const { current, accounts } = await ask({ type: "accountsList" });
    list.textContent = "";

    for (const a of accounts) {
      const row = document.createElement("div");
      row.className = "tbc-acct-item" + (a.login === current ? " tbc-acct-item--current" : "");
      const pick = document.createElement("button");
      pick.type = "button";
      pick.className = "tbc-acct-pick";
      pick.textContent = (a.login === current ? "✓ " : "") + a.name;
      pick.disabled = a.login === current;
      pick.addEventListener("click", async () => {
        list.textContent = `Switching to ${a.name}…`;
        const r = await ask({ type: "accountSwitch", login: a.login });
        if (r?.ok) location.reload();
        else list.textContent = "Couldn't switch; try adding that account again.";
      });
      row.append(pick);
      if (a.login !== current) {
        const x = document.createElement("button");
        x.type = "button";
        x.className = "tbc-acct-forget";
        x.textContent = "×";
        x.title = `Forget ${a.name} (signs nothing out)`;
        x.addEventListener("click", async () => {
          await ask({ type: "accountForget", login: a.login });
          list.remove();
          toggleList(name);
        });
        row.append(x);
      }
      list.append(row);
    }

    // The account you're on isn't saved yet: offer to remember it.
    if (current && !accounts.some((a) => a.login === current)) {
      const save = document.createElement("button");
      save.type = "button";
      save.className = "tbc-acct-action";
      save.textContent = "Remember this account";
      save.addEventListener("click", async () => {
        await ask({ type: "accountSave" });
        list.remove();
        toggleList(name);
      });
      list.append(save);
    }

    const add = document.createElement("button");
    add.type = "button";
    add.className = "tbc-acct-action";
    add.textContent = "+ Add another account";
    add.title = "Saves this account, then opens Twitch's login so you can sign into the other one";
    add.addEventListener("click", async () => {
      list.textContent = "Opening Twitch login…";
      await ask({ type: "accountAdd" });
      location.href = "https://www.twitch.tv/login";
    });
    list.append(add);
  }

  // Twitch builds the menu when you open it; add the button each time.
  let pending = 0;
  const observer = new MutationObserver(() => {
    if (!alive()) return observer.disconnect();
    if (pending) return;
    pending = setTimeout(() => {
      pending = 0;
      addButton();
    }, 200);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
