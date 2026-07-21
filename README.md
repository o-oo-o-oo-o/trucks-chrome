# Trucks 311

A Chrome extension that automates filing NYC 311 **Truck Route Complaint** service
requests (for trucks using non-truck routes).

- **Extension** — install and usage: [`chrome-ext/README.md`](chrome-ext/README.md)
- **Regression harness** — `playwright/integration-test.js` drives the *live* 311 form
  with the extension's real `content.js` to verify it still works after 311 site changes.
  Run it with `node integration-test.js` from the `playwright/` directory
  (`npm install` there first to get `patchright`).

> A standalone Playwright/exe version of this automation used to live here; it was
> removed since the Chrome extension is the only path in use.
