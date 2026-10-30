// Tab Sorter popup.
// Pure logic lives in lib.js (window.TabSorterLib) and is unit-tested.
// This file is only chrome.* + DOM wiring. AI grouping is optional,
// off by default, and only runs when you press "AI group".

const Lib = window.TabSorterLib;

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function getSettings() {
  const data = await chrome.storage.local.get("tabSorterSettings");
  return data.tabSorterSettings || { backend: "none", ollamaUrl: "http://localhost:11434", ollamaModel: "qwen2.5:3b", cloudUrl: "", cloudModel: "gpt-4o-mini", cloudKey: "", customGroups: [] };
}

async function archiveTabs(tabs) {
  const data = await chrome.storage.local.get("archivedTabs");
  const list = data.archivedTabs || [];
  for (const t of tabs) list.unshift({ title: t.title, url: t.url, closedAt: Date.now() });
  await chrome.storage.local.set({ archivedTabs: list.slice(0, 200) });
}

async function closeTabs(tabs) {
  if (!tabs.length) return;
  await archiveTabs(tabs);
  await chrome.tabs.remove(tabs.map((t) => t.id));
}

async function aiGroup(tabs, settings, statusEl) {
  const list = tabs.map((t) => ({ id: t.id, title: t.title, url: t.url }));
  const prompt = "Group these browser tabs by topic/project. Return ONLY a JSON array like " +
    '[{"name":"Group name","tabIds":[1,2]}]. Use only the tab ids given, put every tab in exactly one group. Tabs:\n' +
    JSON.stringify(list, null, 2);

  let text = "";
  if (settings.backend === "ollama") {
    const res = await fetch(settings.ollamaUrl.replace(/\/$/, "") + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: settings.ollamaModel, stream: false, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error("Ollama request failed: " + res.status);
    const data = await res.json();
    text = data.message?.content || "";
  } else if (settings.backend === "chrome") {
    const LM = self.LanguageModel || window.LanguageModel;
    if (!LM) throw new Error("Chrome built-in AI is not available in this browser build.");
    const session = await LM.create();
    text = await session.prompt(prompt);
  } else if (settings.backend === "cloud") {
    if (!settings.cloudUrl || !settings.cloudKey) throw new Error("Set a cloud endpoint and API key in Settings first.");
    const res = await fetch(settings.cloudUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + settings.cloudKey },
      body: JSON.stringify({ model: settings.cloudModel, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error("Cloud request failed: " + res.status);
    const data = await res.json();
    text = data.choices?.[0]?.message?.content || "";
  } else {
    throw new Error("AI is off. Turn on a backend in Settings to use AI grouping.");
  }

  const groups = Lib.extractJson(text);
  const validIds = new Set(tabs.map((t) => t.id));
  for (const g of groups) {
    const ids = (g.tabIds || []).filter((id) => validIds.has(id));
    if (ids.length) {
      const groupId = await chrome.tabs.group({ tabIds: ids });
      await chrome.tabGroups.update(groupId, { title: String(g.name).slice(0, 40) });
    }
  }
  statusEl.textContent = "AI grouped " + groups.length + " groups. Rule-based groups below are unchanged.";
}

async function render() {
  const statusEl = document.getElementById("status");
  const aiStatusEl = document.getElementById("aiStatus");
  const win = await chrome.windows.getCurrent();
  const tabs = await chrome.tabs.query({ windowId: win.id });
  const seenData = await chrome.storage.local.get("tabSorterLastSeen");
  const lastSeen = seenData.tabSorterLastSeen || {};
  const archivedData = await chrome.storage.local.get("archivedTabs");
  const archived = archivedData.archivedTabs || [];
  const settings = await getSettings();
  const staleDays = Number(document.getElementById("staleDays").value);
  const now = Date.now();

  statusEl.textContent = tabs.length + " tabs in this window. AI backend: " + settings.backend + " (off by default, change in Settings).";
  aiStatusEl.textContent = settings.backend === "none"
    ? "AI is off. Grouping, dedupe and stale checks below are rule-based and local."
    : "AI backend: " + settings.backend + ". Press AI group to use it. Tab titles/URLs go to that backend only when you press it.";

  // Groups (pure logic in lib.js)
  const groups = Lib.groupTabs(tabs, settings.customGroups || []);
  const groupsEl = document.getElementById("groups");
  groupsEl.innerHTML = "";
  for (const [name, list] of Object.entries(groups).sort()) {
    const div = document.createElement("div");
    div.className = "group";
    div.innerHTML = "<strong>" + escapeHtml(name) + " (" + list.length + ")</strong>" +
      list.map((t) => '<div class="tab">' + escapeHtml(t.title || t.url) + "</div>").join("");
    const btn = document.createElement("button");
    btn.textContent = "Group these in Chrome";
    btn.onclick = async () => {
      const groupId = await chrome.tabs.group({ tabIds: list.map((t) => t.id) });
      await chrome.tabGroups.update(groupId, { title: name.slice(0, 40) });
      render();
    };
    div.appendChild(btn);
    groupsEl.appendChild(div);
  }

  // Duplicates (pure logic in lib.js)
  const dupesEl = document.getElementById("dupes");
  dupesEl.innerHTML = "";
  for (const unique of Lib.findDuplicates(tabs)) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = "<strong>Possible duplicates (" + unique.length + ")</strong>" +
      unique.map((t) => '<div class="tab">' + escapeHtml(t.title || t.url) + "</div>").join("");
    const btn = document.createElement("button");
    btn.textContent = "Close all but first (archived)";
    btn.onclick = async () => { await closeTabs(unique.slice(1)); render(); };
    div.appendChild(btn);
    dupesEl.appendChild(div);
  }
  if (!dupesEl.children.length) dupesEl.textContent = "No duplicates found.";

  // Stale (pure logic in lib.js)
  const staleEl = document.getElementById("stale");
  staleEl.innerHTML = "";
  const stale = Lib.findStale(tabs, lastSeen, staleDays, now);
  for (const t of stale) {
    const div = document.createElement("div");
    div.className = "item";
    const days = Math.floor((now - lastSeen[t.id]) / (24 * 60 * 60 * 1000));
    div.innerHTML = "<strong>" + escapeHtml(t.title || t.url) + "</strong><div class='tab'>Last active ~" + days + " days ago</div>";
    const btn = document.createElement("button");
    btn.textContent = "Close (archived)";
    btn.onclick = async () => { await closeTabs([t]); render(); };
    div.appendChild(btn);
    staleEl.appendChild(div);
  }
  if (!stale.length) staleEl.textContent = "No stale tabs at this threshold. Note: staleness is tracked only from when the extension was installed.";
  if (stale.length) {
    const allBtn = document.createElement("button");
    allBtn.textContent = "Close all stale (archived)";
    allBtn.onclick = async () => { await closeTabs(stale); render(); };
    staleEl.appendChild(allBtn);
  }

  // Archived
  const archivedEl = document.getElementById("archived");
  archivedEl.innerHTML = "";
  if (!archived.length) archivedEl.textContent = "Nothing closed by Tab Sorter yet.";
  for (const a of archived.slice(0, 20)) {
    const div = document.createElement("div");
    div.className = "tab";
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = a.title || a.url;
    link.onclick = async (e) => { e.preventDefault(); await chrome.tabs.create({ url: a.url }); };
    div.appendChild(link);
    archivedEl.appendChild(div);
  }

  document.getElementById("aiGroup").onclick = async () => {
    aiStatusEl.textContent = "Running AI grouping…";
    try { await aiGroup(tabs, settings, aiStatusEl); render(); }
    catch (e) { aiStatusEl.textContent = "AI grouping failed: " + e.message + " Rule-based groups still work."; }
  };
}

document.getElementById("refresh").onclick = render;
document.getElementById("staleDays").onchange = render;
document.getElementById("openOptions").onclick = () => chrome.runtime.openOptionsPage();
document.getElementById("clearArchived").onclick = async () => {
  await chrome.storage.local.set({ archivedTabs: [] });
  render();
};
render();
