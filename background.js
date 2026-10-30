// Tab Sorter background service worker.
// Tracks when each tab was last active, so the popup can flag stale tabs.
// It never sends anything anywhere. AI, if enabled, runs from the popup/options,
// not from here, and only when you press the AI button.
// Note: routing AI fetches through this worker was tried and reverted —
// it did not fix Ollama's 403, because both popup and worker send the
// same chrome-extension:// origin. The Ollama setup is documented in
// the README instead, via OLLAMA_ORIGINS.

const LAST_SEEN_KEY = "tabSorterLastSeen";

async function getLastSeen() {
  const data = await chrome.storage.local.get(LAST_SEEN_KEY);
  return data[LAST_SEEN_KEY] || {};
}

async function setLastSeen(map) {
  await chrome.storage.local.set({ [LAST_SEEN_KEY]: map });
}

async function touch(tabId) {
  if (!tabId || tabId < 0) return;
  const map = await getLastSeen();
  map[tabId] = Date.now();
  await setLastSeen(map);
}

async function forget(tabId) {
  const map = await getLastSeen();
  delete map[tabId];
  await setLastSeen(map);
}

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  const map = await getLastSeen();
  const now = Date.now();
  for (const tab of tabs) {
    if (!(tab.id in map)) map[tab.id] = now;
  }
  await setLastSeen(map);
});

chrome.tabs.onActivated.addListener((info) => touch(info.tabId));
chrome.tabs.onCreated.addListener((tab) => touch(tab.id));
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete") touch(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => forget(tabId));
