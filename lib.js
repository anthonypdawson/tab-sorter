// Tab Sorter pure logic — no chrome.*, no DOM.
// This file is shared by popup.js (in the browser, via <script> tags)
// and by the Node unit tests (via require/module.exports).
// Keep it pure so it stays testable.

const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "gbraid", "wbraid", "_ga", "mc_cid", "mc_eid",
];

function domainOf(tab) {
  try {
    return new URL(tab.url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    for (const p of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.includes(p) || p.startsWith("utm_")) {
        u.searchParams.delete(p);
      }
    }
    u.hash = "";
    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return (
      u.protocol + "//" + u.hostname.toLowerCase() + path + (u.search ? u.search : "")
    );
  } catch {
    return url || "";
  }
}

function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Topic keywords first (generic topics, not personal projects),
// then domain. User-configurable groups, if any, win over the generic
// defaults, so personal project names live only in the user's own
// Settings, never in the shipped code. Word-boundary matching avoids
// false positives like "network" matching "work".
function hasWord(hay, word) {
  return new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(hay);
}
function matchesKeyword(hay, keyword) {
  const kw = String(keyword || "").toLowerCase().trim();
  if (!kw) return false;
  if (kw.includes(" ")) return hay.includes(kw);
  return hasWord(hay, kw);
}
function groupName(tab, customGroups = []) {
  const hay = ((tab.title || "") + " " + (tab.url || "")).toLowerCase();
  for (const g of Array.isArray(customGroups) ? customGroups : []) {
    if (!g || !g.name || !Array.isArray(g.keywords)) continue;
    if (g.keywords.some((kw) => matchesKeyword(hay, kw))) return g.name;
  }
  if (
    hasWord(hay, "work") ||
    hasWord(hay, "project") ||
    hasWord(hay, "ticket") ||
    hasWord(hay, "meeting")
  ) {
    return "Work";
  }
  if (
    hay.includes("github") ||
    hay.includes("gitlab") ||
    hay.includes("code") ||
    hay.includes("pull request")
  ) {
    return "Code";
  }
  if (hay.includes("gmail") || hay.includes("mail.google") || hay.includes("inbox")) {
    return "Email";
  }
  if (
    hay.includes("music") ||
    hay.includes("video") ||
    hay.includes("youtube")
  ) {
    return "Media";
  }
  const d = domainOf(tab);
  return d || "Other";
}

function groupTabs(tabs, customGroups = []) {
  const groups = {};
  for (const t of tabs) (groups[groupName(t, customGroups)] ||= []).push(t);
  return groups;
}

// Duplicates: exact normalized URL, or same domain + same normalized title.
// Returns an array of groups, each with 2+ tabs. A tab can appear in only
// one duplicate group in the returned list (first match wins).
function findDuplicates(tabs) {
  const byKey = {};
  for (const t of tabs) {
    const urlKey = "url:" + normalizeUrl(t.url);
    (byKey[urlKey] ||= []).push(t);
    const title = normalizeTitle(t.title);
    if (title) {
      const titleKey = "title:" + domainOf(t) + "|" + title;
      (byKey[titleKey] ||= []).push(t);
    }
  }
  const result = [];
  const used = new Set();
  for (const list of Object.values(byKey)) {
    const unique = [...new Map(list.map((t) => [t.id, t])).values()];
    if (unique.length < 2) continue;
    // Skip if this exact set was already reported, or if all its tabs
    // were already reported in another duplicate group.
    const key = unique.map((t) => t.id).sort().join(",");
    if (used.has(key)) continue;
    used.add(key);
    result.push(unique);
  }
  return result;
}

function findStale(tabs, lastSeen, staleDays, now = Date.now()) {
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  return tabs.filter(
    (t) => lastSeen[t.id] && now - lastSeen[t.id] > staleMs && !t.active
  );
}

// AI preview validation, pure so it is unit-testable: keep only tab ids
// that actually exist, put a tab in at most one group (first group wins,
// matching what Chrome would do by moving the tab), drop empty groups,
// and report tabs the AI left out so the preview can show them.
function filterValidAiGroups(groups, tabs) {
  const byId = new Map((tabs || []).map((t) => [t.id, t]));
  const used = new Set();
  const result = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    if (!g) continue;
    const name = g.name || g.title || g.group;
    if (!name) continue;
    const ids = Array.isArray(g.tabIds) ? g.tabIds : Array.isArray(g.tabs) ? g.tabs : Array.isArray(g.ids) ? g.ids : [];
    const list = [];
    for (const id of ids) {
      if (byId.has(id) && !used.has(id)) {
        used.add(id);
        list.push(byId.get(id));
      }
    }
    if (list.length) result.push({ name: String(name).slice(0, 40), tabs: list });
  }
  return { groups: result, unassigned: (tabs || []).filter((t) => !used.has(t.id)) };
}

// Robust AI JSON extraction. Small local models often wrap the JSON in
// prose or markdown fences, and tab titles themselves can contain
// brackets like "[JN-2644]". The old version took the first "[" and
// the last "]" and JSON.parsed that slice, so a title bracket at the
// start of the response produced exactly:
//   Unexpected token 'J', "[JN-2644]**"... is not valid JSON
// Instead: strip fences, then try every candidate array that starts
// with "[{" (allowing whitespace), longest end first, and return the
// first slice that parses to a list of objects. If none parses, throw
// a readable error with a snippet of what the model actually returned,
// instead of the raw JSON.parse token error.
function extractJson(text) {
  const raw = String(text || "");
  const cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
  const candidates = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] !== "[") continue;
    let j = i + 1;
    while (j < cleaned.length && /\s/.test(cleaned[j])) j++;
    if (cleaned[j] === "{") candidates.push(i);
  }
  for (const start of candidates) {
    for (let end = cleaned.lastIndexOf("]"); end > start; end = cleaned.lastIndexOf("]", end - 1)) {
      const slice = cleaned.slice(start, end + 1);
      try {
        const parsed = JSON.parse(slice);
        if (Array.isArray(parsed) && parsed.every((g) => g && typeof g === "object")) return parsed;
      } catch {
        // Try once with trailing commas removed, a common small-model slip.
        try {
          const fixed = JSON.parse(slice.replace(/,\s*([}\]])/g, "$1"));
          if (Array.isArray(fixed) && fixed.every((g) => g && typeof g === "object")) return fixed;
        } catch {}
      }
    }
  }
  const snippet = raw.slice(0, 200).replace(/\s+/g, " ");
  throw new Error("AI did not return a usable JSON group list. Model output started: " + snippet);
}

const lib = {
  TRACKING_PARAMS,
  domainOf,
  normalizeUrl,
  normalizeTitle,
  groupName,
  groupTabs,
  findDuplicates,
  findStale,
  filterValidAiGroups,
  extractJson,
};

// Node / test environment.
if (typeof module !== "undefined" && module.exports) {
  module.exports = lib;
}
// Browser / extension environment.
if (typeof window !== "undefined") {
  window.TabSorterLib = lib;
}
