// Background helper for the Auto Streak Saver (streaksaver.js). Pages can't open
// windows by themselves without a click (Chrome's pop-up blocker), but the
// extension can, so the page asks this to open, recognise and close the saver window.
//
// Saved in chrome.storage.local:
//   "streakSaverTab"  id of the tab inside the saver window
//   "askSenderTab"    id of the tab in the window sending Ask the Streamer whispers

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "openStreakSaver") {
    chrome.windows.create(
      { url: msg.url, type: "popup", width: msg.width, height: msg.height, left: msg.left, top: msg.top, focused: false },
      (win) => chrome.storage.local.set({ streakSaverTab: win.tabs[0].id }),
    );
  }

  if (msg.type === "amStreakSaver") {
    chrome.storage.local.get("streakSaverTab", (d) => reply(!!sender.tab && d.streakSaverTab === sender.tab.id));
    return true; // reply comes later
  }

  if (msg.type === "streakSaverDone" && sender.tab) {
    chrome.storage.local.remove("streakSaverTab");
    chrome.windows.remove(sender.tab.windowId);
  }

  // Ask the Streamer (askstreamer.js): a small window on a Twitch settings page
  // sends the waiting whispers from Twitch's whisper window, then asks to be closed. One at a time;
  // a window already sending picks up anything queued meanwhile.
  if (msg.type === "openAskSender") {
    chrome.storage.local.get("askSenderTab", (d) => {
      const open = d.askSenderTab ? chrome.tabs.get(d.askSenderTab).then(() => true, () => false) : Promise.resolve(false);
      open.then((busy) => {
        if (busy) return;
        chrome.windows.create(
          // Same side as the page that asked: an Incognito page's whisper goes out
          // from Incognito (its own Twitch sign-in), not from your normal window.
          { url: msg.url, type: "popup", width: 420, height: 520, left: msg.left, top: msg.top, focused: false,
            incognito: !!sender.tab?.incognito },
          (win) => chrome.storage.local.set({ askSenderTab: win.tabs[0].id }),
        );
      });
    });
  }

  if (msg.type === "amAskSender") {
    chrome.storage.local.get("askSenderTab", (d) => reply(!!sender.tab && d.askSenderTab === sender.tab.id));
    return true; // reply comes later
  }

  // Your recent whispers, for Ask the Streamer (askstreamer.js). Asked from
  // here because a page's own scripts can't send your sign-in to Twitch's data
  // service; the token is the page's own and only goes to Twitch.
  if (msg.type === "askWhispers") {
    fetch("https://gql.twitch.tv/gql", {
      method: "POST",
      headers: { "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko", Authorization: `OAuth ${msg.token}` },
      body: JSON.stringify({ query: msg.query }),
    })
      .then((r) => r.json())
      .then(reply, (e) => reply({ error: String(e) }));
    return true; // reply comes later
  }

  if (msg.type === "askSenderDone" && sender.tab) {
    chrome.storage.local.remove("askSenderTab");
    chrome.windows.remove(sender.tab.windowId);
  }
});

// ===== Account switcher (accounts.js) ================================================
// Twitch has no account switcher, so this remembers each account's Twitch sign-in
// cookies and swaps them. Content scripts can't touch cookies, so the page asks here.
//
// Saved in chrome.storage.local:
//   "accounts"       { login: { login, name, cookies: [cookie], savedAt } }
//   "accountAdding"  true while you're signing into a new account

const twitchCookies = () => chrome.cookies.getAll({ domain: "twitch.tv" });
const cookieUrl = (c) => `https://${c.domain.replace(/^\./, "")}${c.path}`;

// Save the signed-in account's cookies (if anyone is signed in). Returns its login.
async function saveCurrentAccount() {
  const cookies = await twitchCookies();
  const login = cookies.find((c) => c.name === "login")?.value;
  if (!login) return null;
  const name = decodeURIComponent(cookies.find((c) => c.name === "name")?.value || login);
  const { accounts = {} } = await chrome.storage.local.get("accounts");
  accounts[login] = { login, name, cookies, savedAt: Date.now() };
  await chrome.storage.local.set({ accounts });
  return login;
}

// Remove Twitch's cookies from this browser only. This is not Twitch's "Log out"
// (which would cancel the saved sign-in on Twitch's side too).
async function clearTwitchCookies() {
  for (const c of await twitchCookies()) {
    await chrome.cookies.remove({ url: cookieUrl(c), name: c.name, storeId: c.storeId });
  }
}

async function restoreCookies(cookies) {
  for (const c of cookies) {
    const d = {
      url: cookieUrl(c), name: c.name, value: c.value, path: c.path,
      secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, storeId: c.storeId,
    };
    if (!c.hostOnly) d.domain = c.domain;
    if (!c.session && c.expirationDate) d.expirationDate = c.expirationDate;
    try {
      await chrome.cookies.set(d);
    } catch {
      // A cookie Chrome won't take back as-is isn't needed to stay signed in.
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const run = {
    async accountsList() {
      const { accounts = {} } = await chrome.storage.local.get("accounts");
      const current = (await twitchCookies()).find((c) => c.name === "login")?.value || null;
      return { current, accounts: Object.values(accounts).map(({ login, name }) => ({ login, name })) };
    },
    async accountSave() {
      const login = await saveCurrentAccount();
      await chrome.storage.local.remove("accountAdding");
      return { login };
    },
    async accountSwitch() {
      const { accounts = {} } = await chrome.storage.local.get("accounts");
      const target = accounts[msg.login];
      if (!target) return { ok: false };
      await saveCurrentAccount(); // keep the account you're leaving up to date
      await clearTwitchCookies();
      await restoreCookies(target.cookies);
      return { ok: true };
    },
    async accountAdd() {
      await saveCurrentAccount();
      await chrome.storage.local.set({ accountAdding: true });
      await clearTwitchCookies();
      return { ok: true };
    },
    async accountForget() {
      const { accounts = {} } = await chrome.storage.local.get("accounts");
      delete accounts[msg.login];
      await chrome.storage.local.set({ accounts });
      return { ok: true };
    },
  }[msg.type];
  if (!run) return;
  run().then(reply, (e) => reply({ ok: false, error: String(e) }));
  return true; // reply comes later
});

// ===== Follow list refresh (people.js) ==============================================
// Opens the Following page in a small window in front, where it loads fully;
// people.js reads it and saves "follows", then this closes the window.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "syncFollows") return;
  chrome.windows.create({ url: msg.url, type: "popup", width: 520, height: 700, focused: true }, (win) => {
    const close = () => {
      chrome.storage.onChanged.removeListener(done);
      chrome.windows.remove(win.id).catch(() => {});
    };
    const done = (changes, area) => {
      if (area === "local" && changes.follows) close();
    };
    chrome.storage.onChanged.addListener(done);
    setTimeout(close, 2 * 60 * 1000); // give up after 2 minutes either way
  });
});
