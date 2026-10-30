// The toolbar popup (click the extension's icon): a switch for each of the
// bigger features. The list comes from settings.js, which saves the features
// this copy has ("featureList") whenever a Twitch page loads; what's switched
// off is saved as "featuresOff" and takes effect when Twitch is refreshed.
const list = document.getElementById("list");
const footer = document.querySelector("footer");
const note = document.getElementById("note");

let off = [];

chrome.storage.local.get(["featureList", "featuresOff"], (d) => {
  off = d.featuresOff || [];
  const features = d.featureList || [];
  if (!features.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Open or refresh a Twitch tab once, then the switches show here.";
    list.append(p);
    return;
  }
  for (const { key, label } of features) {
    const row = document.createElement("label");
    row.className = "row";
    const name = document.createElement("span");
    name.textContent = label;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !off.includes(key);
    box.addEventListener("change", () => {
      off = box.checked ? off.filter((k) => k !== key) : [...off, key];
      chrome.storage.local.set({ featuresOff: off });
      offerRefresh();
    });
    row.append(name, box);
    list.append(row);
  }
});

// After a change: a button that refreshes every open Twitch tab.
function offerRefresh() {
  note.textContent = "Refresh Twitch to apply.";
  if (footer.querySelector("button")) return;
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = "Refresh Twitch";
  go.addEventListener("click", async () => {
    const tabs = await chrome.tabs.query({ url: "*://*.twitch.tv/*" });
    for (const tab of tabs) chrome.tabs.reload(tab.id);
    window.close();
  });
  footer.append(go);
}
