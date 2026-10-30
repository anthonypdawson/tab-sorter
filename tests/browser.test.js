// Browser test for Tab Sorter, using Playwright.
// This is the one test that needs a real browser. It is NOT run by
// `node --test`. Run it with:
//   npm install
//   npx playwright install chromium
//   npm run test:browser
//
// What it does, end to end:
// 1. Launches Chromium with the unpacked extension loaded.
// 2. Captures the extension id from its service worker immediately,
//    before the MV3 worker can go idle (see the comment in the test).
// 3. Opens two test tabs (data: URLs, so the test needs no network).
// 4. Opens the extension popup via its service-worker background page
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
    // channel: 'chromium' is the fix for the CI failure where the
    // service worker never started at all (worker was undefined after
    // a 20s wait, not just late). Playwright's own Chrome extensions
    // docs say to use this channel to run extensions in headless
    // mode; without it, headless Chromium can load with no extension
    // service worker to find. Headed mode is the fallback if this
    // still fails in CI — run under xvfb instead of headless.
    channel: "chromium",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    // Find the extension id from the service worker, immediately after
    // launch. This is the fix for the CI failure at the old line 55
    // (workers.length was 0): an MV3 service worker is event-driven
    // and goes idle, so it is not guaranteed to still be listed later.
    // The old code opened test tabs first, then waited for a *new*
    // serviceworker event. If the worker had already started before
    // that wait began, no new event ever fired, the 10s wait timed
    // out, and by then the worker could have idled away, leaving an
    // empty list. Capture it first, and only wait if it is not there
    // yet. The captured Worker object keeps its URL even after the
    // worker idles, and that URL is all we need for the extension id.
    let worker = context.serviceWorkers()[0];
    if (!worker) {
      worker = await context.waitForEvent("serviceworker", { timeout: 20000 }).catch(() => null);
    }
    if (!worker) worker = context.serviceWorkers()[0];
    expect(
      worker,
      "Extension service worker did not start. Check that manifest.json is at the repo root (the extension path above) and that background.js loads without errors."
    ).toBeTruthy();
    const extensionId = worker.url().split("/")[2];

    // Open two tabs the popup should be able to see.
    const page1 = await context.newPage();
    await page1.goto("data:text/html,<title>GitHub PR</title><h1>PR</h1>");
    const page2 = await context.newPage();
    await page2.goto("data:text/html,<title>Music video</title><h1>Music</h1>");

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
