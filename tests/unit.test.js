// Unit tests for Tab Sorter pure logic (lib.js).
// Run with Node's built-in test runner, no dependencies to install:
//   node --test tests/
// These tests do not need Chrome, a browser, or any chrome.* API.

const test = require("node:test");
const assert = require("node:assert/strict");
const Lib = require("../lib.js");

const tab = (id, title, url, active = false) => ({ id, title, url, active });

test("normalizeUrl strips tracking params, hash, and trailing slash", () => {
  assert.equal(
    Lib.normalizeUrl("https://example.com/article/?utm_source=twitter&fbclid=abc&keep=1#section"),
    "https://example.com/article?keep=1"
  );
  assert.equal(
    Lib.normalizeUrl("https://EXAMPLE.com/Article/"),
    "https://example.com/Article"
  );
});

test("normalizeUrl keeps a real query param that changes the page", () => {
  assert.equal(
    Lib.normalizeUrl("https://example.com/search?q=books"),
    "https://example.com/search?q=books"
  );
});

test("normalizeUrl returns the input unchanged for a bad URL", () => {
  assert.equal(Lib.normalizeUrl("not a url"), "not a url");
});

test("groupName prefers topic keywords over domain", () => {
  assert.equal(
    Lib.groupName(tab(1, "Project planning notes", "https://example.com/notes")),
    "Work"
  );
  assert.equal(
    Lib.groupName(tab(2, "Meeting notes and project tickets", "https://example.com/run")),
    "Work"
  );
  assert.equal(
    Lib.groupName(tab(2, "Network status page", "https://example.com/status")),
    "example.com"
  );
});

test("groupName falls back to domain, then Other", () => {
  assert.equal(
    Lib.groupName(tab(3, "Some blog post", "https://www.example.com/post")),
    "example.com"
  );
  assert.equal(Lib.groupName(tab(4, "", "not a url")), "Other");
});

test("custom groups win over generic groups", () => {
  assert.equal(
    Lib.groupName(
      tab(1, "Alpha project notes", "https://example.com/notes"),
      [{ name: "My project", keywords: ["alpha"] }]
    ),
    "My project"
  );
  assert.equal(
    Lib.groupName(
      tab(2, "Unrelated page", "https://example.com/other"),
      [{ name: "My project", keywords: ["alpha"] }]
    ),
    "example.com"
  );
});

test("custom groups do not match substrings like network for work", () => {
  assert.equal(
    Lib.groupName(
      tab(1, "Network status", "https://example.com/status"),
      [{ name: "My project", keywords: ["work"] }]
    ),
    "example.com"
  );
});

test("groupTabs puts tabs in the right groups", () => {
  const groups = Lib.groupTabs([
    tab(1, "GitHub PR", "https://github.com/foo/bar"),
    tab(2, "Another GitHub issue", "https://github.com/foo/bar/issues/1"),
    tab(3, "Music video", "https://example.com/video/1"),
  ]);
  assert.equal(groups["Code"].length, 2);
  assert.equal(groups["Media"].length, 1);
});

test("findDuplicates catches exact URL duplicates after tracking-param stripping", () => {
  const dupes = Lib.findDuplicates([
    tab(1, "Article", "https://example.com/a?utm_source=x"),
    tab(2, "Article", "https://example.com/a?fbclid=y"),
    tab(3, "Different", "https://example.com/b"),
  ]);
  assert.equal(dupes.length, 1);
  assert.deepEqual(dupes[0].map((t) => t.id), [1, 2]);
});

test("findDuplicates catches same-domain same-title near-duplicates", () => {
  const dupes = Lib.findDuplicates([
    tab(1, "Job posting — Senior SWE", "https://jobs.example.com/123?ref=a"),
    tab(2, "Job posting: Senior SWE!", "https://jobs.example.com/123?ref=b"),
    tab(3, "Job posting — Senior SWE", "https://other.example.com/123"),
  ]);
  // First two share domain + normalized title; third is a different domain.
  assert.equal(dupes.length, 1);
  assert.deepEqual(dupes[0].map((t) => t.id), [1, 2]);
});

test("findDuplicates does not flag different tabs", () => {
  assert.deepEqual(
    Lib.findDuplicates([
      tab(1, "One", "https://example.com/1"),
      tab(2, "Two", "https://example.com/2"),
    ]),
    []
  );
});

test("findStale flags only inactive tabs older than the threshold", () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const tabs = [
    tab(1, "Old", "https://example.com/old"),
    tab(2, "Recent", "https://example.com/recent"),
    tab(3, "Old but active", "https://example.com/active", true),
    tab(4, "Never tracked", "https://example.com/new"),
  ];
  const lastSeen = {
    1: now - 5 * day,
    2: now - 1 * day,
    3: now - 5 * day,
  };
  assert.deepEqual(
    Lib.findStale(tabs, lastSeen, 3, now).map((t) => t.id),
    [1]
  );
});

test("extractJson pulls a JSON list out of surrounding AI text", () => {
  const groups = Lib.extractJson(
    'Here you go:\n[{"name":"Work","tabIds":[1,2]}]\nDone.'
  );
  assert.deepEqual(groups, [{ name: "Work", tabIds: [1, 2] }]);
});

test("extractJson throws when there is no JSON list", () => {
  assert.throws(() => Lib.extractJson("no json here"), /JSON list/);
});
