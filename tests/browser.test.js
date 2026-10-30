// Browser test for Tab Sorter, using Playwright.
// This is the one test that needs a real browser. It is NOT run by
// `node --test`. Run it with:
//   npm install
//   npx playwright install chromium
//   npm run test:browser
//
// What it does, end to end:
// 1. Launches Chromium with the unpacked extension loaded.
// 2. Opens two test tabs (example.com pages with distinct titles are
//    replaced here by data: URLs, so the test needs no network).
// 3. Opens the extension popup via its service-worker background page
//    approach used by Playwright's persistent context: it finds the
//    extension's popup page by loading popup.html directly in a tab,
//    which is enough to check the popup renders groups, because the
//    popup reads tabs from chrome.tabs in the extension context.
//    Note: a full click-through of the real toolbar popup requires
//    a manual smoke test (see README), because Playwright cannot
//    click the browser toolbar. This test covers the next best thing:
//    the extension loads without errors, and its popup page renders
//    groups / duplicates / stale sections.
//
// If this test fails on your machine, check first that Chromium
// launched with the extension path below, and that no other
// extension is interfering. It is intentionally lenient about
// exact group names, which are rule-based and can change.

const { test, expect, chromium } = require("@playwright/test");
const path = require("node:path");

const extensionPath = path.join(__dirname, "..");

test("extension loads and popup renders", async () => {
  const context = await chromium.launchPersistentContext("", {
    // In CI, run headless. Locally, headed, so you can watch the extension load.
    headless: process.env.CI === "true",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    // Open two tabs the popup should be able to see.
    const page1 = await context.newPage();
    await page1.goto("data:text/html,<title>GitHub PR</title><h1>PR</h1>");
    const page2 = await context.newPage();
    await page2.goto("data:text/html,<title>Music video</title><h1>Music</h1>");

    // Find the extension id from the service worker.
    const serviceWorkers = context.serviceWorkers();
    // The service worker may take a moment to register.
    await context.waitForEvent("serviceworker", { timeout: 10000 }).catch(() => {});
    const workers = context.serviceWorkers();
    expect(workers.length).toBeGreaterThan(0);
    const extensionId = workers[0].url().split("/")[2];

    // Load the popup page directly in a tab and check it renders.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator("h1")).toHaveText("Tab Sorter");
    await expect(popup.locator("h2").first()).toBeVisible();
    // Groups section should exist, even if group names change.
    await expect(popup.locator("#groups")).toBeVisible();
    await expect(popup.locator("#dupes")).toBeVisible();
    await expect(popup.locator("#stale")).toBeVisible();

    await page1.close();
    await page2.close();
    await popup.close();
  } finally {
    await context.close();
  }
});
