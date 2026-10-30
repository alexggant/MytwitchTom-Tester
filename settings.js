// Feature switches. Clicking the extension's icon opens a list of the bigger
// features, each with an on/off switch (switches.html); a feature that's
// switched off doesn't start at all, from the next time Twitch loads.
//
// This loads before the other scripts. Each of them starts through
// whenOn(key, label, start), which also puts it on the list, and the list is
// saved for the icon's pop-up, so it only shows the features this copy has.
//
// Saved in chrome.storage.local:
//   "featuresOff"  [key]              features switched off (everything else is on)
//   "featureList"  [{ key, label }]   the features this copy has, for the pop-up

const tbcFeatures = []; // [{ key, label }], in the order the scripts load
let tbcOff = null;      // keys switched off, once loaded
const tbcWaiting = [];

chrome.storage.local.get(["featuresOff", "featureList"], (d) => {
  tbcOff = d.featuresOff || [];
  tbcWaiting.splice(0).forEach((go) => go());
  // Every script has registered by now (they all run before this answer comes back).
  if (window.top === window && JSON.stringify(d.featureList) !== JSON.stringify(tbcFeatures)) {
    chrome.storage.local.set({ featureList: tbcFeatures });
  }
});

function whenOn(key, label, start) {
  if (!tbcFeatures.some((f) => f.key === key)) tbcFeatures.push({ key, label });
  const go = () => {
    if (!tbcOff.includes(key)) start();
  };
  tbcOff ? go() : tbcWaiting.push(go);
}
