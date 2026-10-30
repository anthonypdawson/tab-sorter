# Tab Sorter — Chrome / Brave extension, v0.1.0 prototype

A tab sorter with grouping, intelligent dedupe, and stale-tab reminders.
AI is optional and off by default.

## What it does, with no AI

- **Groups:** rule-based, by generic topic keywords first (Work, Code,
  Email, Media), then by domain. Press "Group these in Chrome" to create
  a real Chrome tab group. No personal project or employer names are
  hard-coded in the grouping rules. Add your own groups in Settings
  under "Custom keyword groups" — those live only in your browser
  settings, never in the shipped code, and they win over generic ones.
- **Duplicates:** exact duplicates after stripping tracking params
  (`utm_*`, `fbclid`, `gclid`, etc.), plus same-domain + same-title
  near-duplicates. Closing via the extension archives the tab first.
- **Stale tabs:** the background worker tracks when each tab was last active.
  Pick 1 / 3 / 7 / 14 days in the popup. Stale tabs are listed, never
  auto-closed. Closing via the extension archives them, and the popup
  lists recently closed tabs with a click-to-reopen link.
- **Safety:** nothing is auto-closed, ever. Every close goes through a
  button you press, and is archived first.

## Optional AI grouping

Settings (extension Settings page) offers, default `none`:

1. **None** — rule-based only, nothing leaves the machine.
2. **Local Ollama** — e.g. `http://localhost:11434`, model `qwen2.5:3b`.
   Run `ollama serve` and `ollama pull qwen2.5:3b` first.
3. **Chrome built-in on-device AI** — where that API is available in the
   browser build. Not guaranteed in Brave.
4. **Cloud API (OpenAI-compatible)** — you supply endpoint, model, and key.
   Warning: with this backend, tab titles/URLs are sent to that endpoint
   when, and only when, you press "AI group". The key lives in
   `chrome.storage.local` on this machine only.

AI grouping asks the backend for a JSON list of groups and tab ids,
validates those ids against your actual tabs, and then creates Chrome
tab groups. If AI fails, it falls back to an error message and the
rule-based groups still work.

## Install from the repo

Short answer: you cannot install directly from a GitHub URL.
Chrome and Brave do not do one-click installs from a repo, a zip,
or a folder. The repo is the source, and you load it unpacked:

1. Clone or download this repo.
2. Open `chrome://extensions` (Chrome) or `brave://extensions` (Brave).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this folder.
5. Pin Tab Sorter in the toolbar, open it, and use it on your current window.
6. Optional: open Settings from the popup to enable an AI backend.

Packaging, for convenience, not for one-click install: on every `v*`
tag, `.github/workflows/package.yml` builds a clean `tab-sorter.zip`
(extension files only, no tests or workflows) and attaches it to a
GitHub Release. Download that zip, unzip it, and Load unpacked from
the unzipped folder, same steps as above.

A true one-click install would require publishing to the Chrome Web
Store, which is a separate step (developer account, review, listing)
and is not done here.

## Load it (Chrome on macOS, or Brave on Windows)

1. Open `chrome://extensions` (Chrome) or `brave://extensions` (Brave).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this whole folder.
4. Pin Tab Sorter in the toolbar, open it, and use it on your current window.
5. Optional: open Settings from the popup to enable an AI backend.

Staleness tracking starts when the extension is installed — it cannot
know when you last used a tab before that, so stale lists will be
empty at first and fill in over days.

## Tests

How Chrome extension testing works here, in short: the extension is
JavaScript, so the pure logic is tested like JavaScript, and the
Chrome APIs are mocked or driven by a real browser only where needed.

- **Continuous integration:** `.github/workflows/test.yml` runs both
  test suites on push to `main` and on pull requests to `main`:
  a Node unit job, and a Playwright browser job that installs Chromium
  and runs the browser test with `CI=true` (headless).
- **Unit tests (fast, no browser, no dependencies):**
  `lib.js` holds all pure logic, no `chrome.*`, no DOM, so Node can
  import it directly. Tests are in `tests/unit.test.js` and use Node's
  built-in test runner:
  ```
  npm test
  # or: node --test tests/unit.test.js
  ```
  12 tests cover URL normalization, tracking-param stripping, grouping,
  dedupe (exact and near-duplicate), stale detection, and AI JSON parsing.
  These were run locally and pass 12/12.
- **Browser test (needs a real browser, Playwright):**
  `tests/browser.test.js` launches Chromium with the unpacked extension
  loaded, opens test tabs, and checks the popup page renders its
  Groups / Duplicates / Stale sections. Run it with:
  ```
  npm install
  npx playwright install chromium
  npm run test:browser
  ```
  Note: Playwright cannot click the browser toolbar, so a full
  click-through of the real toolbar popup still needs a manual smoke
  test after loading the extension unpacked (see Load it above).
  The browser test was syntax-checked here, but not executed here,
  because Playwright and its test browser are not installed in this
  environment — run it on your Mac/Windows machine after `npm install`.
- **What is not tested yet:** AI backends (Ollama / Chrome built-in /
  cloud) are not covered by automated tests, and neither is the
  background worker's last-active tracking, which needs time to pass.

## Files

- `manifest.json` — Manifest V3, permissions: tabs, tabGroups, storage.
- `background.js` — tracks last-active time per tab, locally only.
- `lib.js` — pure grouping / dedupe / stale / URL logic, shared by
  the popup and the unit tests.
- `popup.html` / `popup.js` / `popup.css` — the popup UI and Chrome wiring.
- `options.html` / `options.js` — AI backend settings, default off.
- `tests/unit.test.js` — Node unit tests, no dependencies.
- `tests/browser.test.js` — Playwright browser test, see Tests above.
- `.github/workflows/test.yml` — CI: unit + browser tests on push/PR to main.
- `package.json` — test scripts only, no runtime dependencies.

## Known prototype limits

- Works on the current window only.
- Chrome built-in AI depends on the browser build and flags.
- Cloud backend assumes an OpenAI-compatible chat-completions endpoint.
- No sync across machines, no auto-close, by design.
