// Regression harness for the Chrome extension's content.js.
//
// Loads the REAL ../chrome-ext/content.js into a live 311 "Truck Route Complaint" page
// (with a mocked chrome.* API) and lets it drive the whole Vue wizard: it should walk
// What -> Where -> Who -> Review, select attachments "Yes", and hand off at the reCAPTCHA
// (message FORM_FILLED_WAITING_CAPTCHA + on-page banner). The reCAPTCHA blocks the final
// upload/submit from being automated here, which is by design.
//
// Run:  cd playwright && node integration-test.js
const { chromium } = require('patchright');
const fs = require('fs');
const path = require('path');

const CONTENT_JS = fs.readFileSync(path.join(__dirname, '../chrome-ext/content.js'), 'utf8');
// 1x1 red jpeg data URL
const TINY_JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AlgA//9k=";

const DATA = {
    truckImage: TINY_JPG,
    truckName: "truck-test.jpg",
    truckTimestamp: new Date("2026-05-08T08:42:00").getTime(),
    trafficImage: null,
    settings: {
        observationAddress: "165 Clinton Street, Manhattan, NY 10002",
        firstName: "Jane", lastName: "Doe", email: "jane@example.com", phone: "5555555555",
        myAddress1: "10 Test Ave", myCity: "New York", myState: "NY", myZip: "10002"
    }
};

(async () => {
    const b = await chromium.launch({ headless: true });
    const p = await b.newPage();
    p.on('console', m => { const t = m.text(); if (t.includes('[Content]')) console.log("  " + t); });
    p.on('pageerror', e => console.log("  PAGEERROR:", e.message.slice(0, 160)));

    await p.goto("https://portal.311.nyc.gov/article/?kanumber=KA-01957", { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(6000);
    // Get to the What page via a real click (this is the one real page load)
    await p.locator("a.contentaction").filter({ hasText: "report a truck on a roadway" }).click();
    await p.waitForTimeout(8000);
    console.log("At What page:", p.url());

    // Mock chrome API BEFORE injecting content.js
    await p.evaluate(() => {
        window.__msgs = [];
        window.alert = (m) => { window.__alert = m; console.log("[Content] ALERT: " + m); };
        window.chrome = {
            runtime: {
                onMessage: { addListener: () => {} },
                sendMessage: (msg) => { window.__msgs.push(msg); return Promise.resolve({}); }
            }
        };
    });

    // Load the actual content.js (via evaluate to bypass the page CSP that blocks
    // addScriptTag; real content scripts run in an isolated world exempt from page CSP).
    await p.evaluate((src) => {
        const f = new Function(src + "\n; window.runAutomation = runAutomation;");
        f();
    }, CONTENT_JS);

    // Kick off the real driver with realistic data (surface any thrown error)
    await p.evaluate((data) => {
        window.addEventListener('unhandledrejection', e => { window.__err = String(e.reason && e.reason.stack || e.reason); });
        window.runAutomation(data).catch(e => { window.__err = String(e && e.stack || e); });
    }, DATA);

    // Let it drive What -> Where -> Who -> Review
    for (let i = 0; i < 16; i++) {
        await p.waitForTimeout(3000);
        const state = await p.evaluate(() => ({
            url: location.href.split('/').pop().split('?')[0],
            msgs: window.__msgs.map(m => m.action),
            banner: (document.getElementById('truck311-banner') || {}).textContent || null,
            err: window.__err || null,
            locType: ((document.querySelector('input[name="n311_locationtypeid"]') || {}).value || '').slice(0, 20),
            addrId: ((document.querySelector('input[name="n311_addressid"]') || {}).value || '') ? 'set' : '',
            yesChecked: (() => { const y = document.querySelector('input[type=radio][value=YES]'); return y ? y.checked : null; })()
        }));
        console.log(`[t=${(i+1)*3}s] step=${state.url} loc=${state.locType} addr=${state.addrId} msgs=${JSON.stringify(state.msgs)} attachYes=${state.yesChecked} banner=${state.banner ? 'YES' : 'no'}${state.err ? ' ERR=' + state.err.slice(0,120) : ''}`);
        if (state.err) { console.log("\nFULL ERROR:\n", state.err); break; }
        if (state.msgs.includes('FORM_FILLED_WAITING_CAPTCHA')) {
            console.log("\n=== REACHED REVIEW + CAPTCHA HANDOFF ===");
            console.log("Banner:", state.banner);
            break;
        }
    }
    await p.screenshot({ path: 'integration-final.png', fullPage: true });
    await b.close();
})();
