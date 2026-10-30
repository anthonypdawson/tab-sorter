async function load() {
  const data = await chrome.storage.local.get("tabSorterSettings");
  const s = data.tabSorterSettings || {};
  document.getElementById("backend").value = s.backend || "none";
  document.getElementById("ollamaUrl").value = s.ollamaUrl || "http://localhost:11434";
  document.getElementById("ollamaModel").value = s.ollamaModel || "qwen2.5:3b";
  document.getElementById("cloudUrl").value = s.cloudUrl || "";
  document.getElementById("cloudModel").value = s.cloudModel || "gpt-4o-mini";
  document.getElementById("cloudKey").value = s.cloudKey || "";
  document.getElementById("customGroups").value = s.customGroups ? JSON.stringify(s.customGroups, null, 2) : "";
}
document.getElementById("save").onclick = async () => {
  let customGroups = [];
  const raw = document.getElementById("customGroups").value.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("Custom groups must be a JSON list.");
      for (const g of parsed) {
        if (!g.name || !Array.isArray(g.keywords)) throw new Error("Each custom group needs a name and a keywords list.");
      }
      customGroups = parsed;
    } catch (e) {
      document.getElementById("status").textContent = "Custom groups not saved: " + e.message;
      return;
    }
  }
  const settings = {
    backend: document.getElementById("backend").value,
    ollamaUrl: document.getElementById("ollamaUrl").value.trim(),
    ollamaModel: document.getElementById("ollamaModel").value.trim(),
    cloudUrl: document.getElementById("cloudUrl").value.trim(),
    cloudModel: document.getElementById("cloudModel").value.trim(),
    cloudKey: document.getElementById("cloudKey").value,
    customGroups,
  };
  await chrome.storage.local.set({ tabSorterSettings: settings });
  document.getElementById("status").textContent = "Saved. AI backend: " + settings.backend;
};
load();
