// content.js — drives the NYC 311 "Truck Route Complaint" service-request wizard.
//
// IMPORTANT: In ~mid-2026 NYC rebuilt the service-request creation form from the old
// Dynamics 365 server-rendered multi-page form into a Vue single-page-app wizard
// (steps: What -> Where -> Who -> Review -> attachments substep). This file was
// rewritten to drive that new flow. See README.md for the human-in-the-loop steps.

// Listen for messages
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.action === 'FILL_FORM') {
        try {
            await runAutomation(message.data);
        } catch (e) {
            console.error("[Content] Automation error:", e);
            alert("Automation Error: " + e.message);
        }
    } else if (message.action === 'BATCH_COMPLETE') {
        alert("Batch Processing Complete!");
    }
});

// Helper to wait
const wait = (ms) => new Promise(res => setTimeout(res, ms));

// The wizard steps What -> Where -> Who -> Review are SPA route changes inside a SINGLE
// document (only Article -> What is a real page load). So one FILL_FORM invocation on the
// What page must drive the whole wizard: this loop keeps processing steps as they appear
// and does NOT return after each one. Per-step window flags prevent re-processing a step.
async function runAutomation(data) {
    if (window.__truckRunning) { console.log("[Content] runAutomation already active, ignoring."); return; }
    window.__truckRunning = true;

    console.log("[Content] Starting runAutomation loop...");
    const deadline = Date.now() + 6 * 60 * 1000; // safety cap

    try {
        while (Date.now() < deadline) {
            // --- SUCCESS PAGE ---
            if (isSuccessPage()) {
                console.log("[Content] Success detected! Waiting 3s...");
                await wait(3000);
                chrome.runtime.sendMessage({ action: 'SUBMISSION_SUCCESS' });
                return;
            }

            // --- REVIEW STEP (has "Do You have Attachments?") ---
            if (findLabel("Do You have Attachments") && !window.hasHandledReview) {
                console.log("[Content] Detected Review step");
                window.hasHandledReview = true;
                await handleReview(data); // hands off to the captcha watcher
                return;
            }

            // --- ATTACHMENTS UPLOAD SUBSTEP (after captcha + Continue) ---
            if (isAttachmentUploadPage() && !window.hasUploaded) {
                console.log("[Content] Detected attachments upload substep");
                window.hasUploaded = true;
                await handleAttachmentUpload(data);
                return;
            }

            // --- WHAT STEP (vue datepicker + description) ---
            if (document.querySelector('input.dp__input') && document.getElementById('n311_description') && !window.hasFilledWhat) {
                console.log("[Content] Detected What step");
                window.hasFilledWhat = true;
                await fillWhat(data);
                // do NOT return — keep looping for the next SPA step
            }
            // --- WHERE STEP (address picker) ---
            else if ((document.getElementById('SelectAddressWhere') || document.getElementById('address-search-box-input')) && !window.hasFilledWhere) {
                console.log("[Content] Detected Where step");
                window.hasFilledWhere = true;
                await fillWhere(data);
            }
            // --- WHO STEP (contact name input) ---
            else if (document.getElementById('n311_contactfirstname') && !window.hasFilledWho) {
                console.log("[Content] Detected Who step");
                window.hasFilledWho = true;
                await fillWho(data);
            }
            // --- START PAGE (KB article; separate document) ---
            else if (!window.hasClickedStartLink) {
                const reportLink = document.querySelector('a.contentaction');
                if (reportLink && reportLink.textContent.toLowerCase().includes("report a truck")) {
                    console.log("[Content] Detected Start Page (Report Link)");
                    window.hasClickedStartLink = true;
                    reportLink.click();
                    return; // What loads as a fresh document; FILL_FORM fires again there
                }
            }

            await wait(500);
        }
        console.log("[Content] runAutomation timed out.");
    } finally {
        window.__truckRunning = false;
    }
}

// ---- STEP: WHAT ----

async function fillWhat(data) {
    // 1. Date/Time Observed (drive the readonly vue-datepicker)
    await waitForElement('input.dp__input', 15000);
    await setObservedDateTime(new Date(data.truckTimestamp));

    // 2. Recurring problem = Yes (radios have no aria-label anymore; value "true" = Yes)
    setRecurringYes();

    // 3. Description
    const observedDate = new Date(data.truckTimestamp);
    const obsText = formatObservedSummary(observedDate);
    let descBody = "Truck observed using a non-truck route. NYPD is misunderstanding the complaint. The truck is not conducting business (making a pickup or delivery) on Clinton Street. It's driving straight through, which is a traffic law violation since Clinton Street is not a designated truck route. I'm a chronic caller because the problem is chronic and 311 explicitly instructs me to submit a new complaint if I observe a new occurrence of the violation.\n";
    const problemText = obsText + descBody;

    const descArea = document.getElementById('n311_description');
    if (descArea) {
        setNativeValue(descArea, problemText);
        descArea.dispatchEvent(new Event('input', { bubbles: true }));
        descArea.dispatchEvent(new Event('change', { bubbles: true }));
    }

    await wait(500);
    await clickNext();
}

// Drive @vuepic/vue-datepicker entirely with in-page synthetic clicks.
async function setObservedDateTime(d) {
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    // open
    document.querySelector('input.dp__input').click();
    await wait(500);

    // Navigate to the target month/year via prev/next arrows (the year overlay is a
    // huge virtualized list; arrow stepping is reliable for the recent dates we handle).
    for (let i = 0; i < 240; i++) {
        const selects = document.querySelectorAll('.dp__month_year_select');
        if (selects.length < 2) break;
        const curMonth = MONTHS.indexOf((selects[0].textContent || '').trim());
        const curYear = parseInt((selects[1].textContent || '').trim(), 10);
        if (curMonth < 0 || isNaN(curYear)) break;
        const curIdx = curYear * 12 + curMonth;
        const tgtIdx = d.getFullYear() * 12 + d.getMonth();
        if (curIdx === tgtIdx) break;
        const navs = document.querySelectorAll('.dp__inner_nav'); // [0]=prev, [1]=next
        if (navs.length < 2) break;
        (curIdx > tgtIdx ? navs[0] : navs[1]).click();
        await wait(180);
    }
    await wait(200);

    // day cell (skip offset/disabled cells from adjacent months)
    const day = String(d.getDate());
    const cell = Array.from(document.querySelectorAll('.dp__cell_inner')).find(c =>
        (c.textContent || '').trim() === day &&
        !c.className.includes('offset') && !c.className.includes('disabled'));
    if (cell) cell.click();
    await wait(300);

    // time
    const timeBtn = document.querySelector('[aria-label="Open time picker"]');
    if (timeBtn) {
        timeBtn.click();
        await wait(300);

        let hr = d.getHours();
        const pm = hr >= 12;
        let h12 = hr % 12; if (h12 === 0) h12 = 12;

        // hours (cells may be zero-padded -> match numerically)
        const hrsOverlay = document.querySelector('[aria-label="Open hours overlay"]');
        if (hrsOverlay) {
            hrsOverlay.click();
            await wait(300);
            const hrCell = Array.from(document.querySelectorAll('.dp__overlay_cell'))
                .find(c => parseInt((c.textContent || '').trim(), 10) === h12);
            if (hrCell) hrCell.click();
            await wait(300);
        }

        // minutes (overlay is in 5-min steps -> pick nearest)
        const minOverlay = document.querySelector('[aria-label="Open minutes overlay"]');
        if (minOverlay) {
            minOverlay.click();
            await wait(300);
            const want = d.getMinutes();
            const minCells = Array.from(document.querySelectorAll('.dp__overlay_cell'))
                .map(c => ({ c, v: parseInt((c.textContent || '').trim(), 10) }))
                .filter(x => !isNaN(x.v));
            if (minCells.length) {
                minCells.sort((a, b) => Math.abs(a.v - want) - Math.abs(b.v - want));
                minCells[0].c.click();
                await wait(300);
            }
        }

        // AM/PM
        const ampmBtn = document.querySelector('.dp__pm_am_button');
        if (ampmBtn) {
            const cur = (ampmBtn.textContent || '').trim();
            if ((pm && cur === 'AM') || (!pm && cur === 'PM')) ampmBtn.click();
            await wait(200);
        }
    }

    // confirm
    const selectBtn = document.querySelector('.dp__action.dp__select') || document.querySelector('.dp__select');
    if (selectBtn) selectBtn.click();
    await wait(400);
}

function setRecurringYes() {
    const radios = document.querySelectorAll('input[type="radio"][name="n311_isthisarecurringproblem"]');
    for (const r of radios) {
        if (r.value === 'true') {
            r.click();
            r.dispatchEvent(new Event('change', { bubbles: true }));
            return;
        }
    }
}

// ---- STEP: WHERE ----

async function fillWhere(data) {
    // 1. Location Type = Street/Sidewalk. This is a vue-multiselect. Its options only react
    //    once the control is "activated", and selection fires on the option's `mousedown`
    //    handler (a plain .click() on the <li> does nothing). So: activate the control, then
    //    mousedown the option span. Poll for the option since Vue may mount it a beat late.
    const ms = await waitForElement('.multiselect', 15000);
    const tags = ms.querySelector('.multiselect__tags') || ms;
    tags.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    const msInput = ms.querySelector('input.multiselect__input');
    if (msInput) msInput.focus();
    await wait(300);

    let opt = null;
    for (let i = 0; i < 30; i++) {
        opt = Array.from(document.querySelectorAll('.multiselect__option'))
            .find(el => (el.textContent || '').trim() === 'Street/Sidewalk');
        if (opt) break;
        await wait(500);
    }
    if (opt) {
        fireClick(opt);
        await wait(500);
    } else {
        console.error("[Content] Location type option 'Street/Sidewalk' not found");
    }

    // 2. Open the address picker + type the address (synthetic keystrokes drive the geocoder)
    const openBtn = document.getElementById('SelectAddressWhere');
    if (openBtn) { fireClick(openBtn); await wait(1500); }

    const addressVal = data.settings.observationAddress;
    const box = await waitForElement('#address-search-box-input', 15000);
    await typeSynthetic(box, addressVal);

    // 3. Wait for suggestions and select the first
    const suggestion = await waitForElement('.vue-address-search-results-item', 15000);
    fireClick(suggestion);
    await wait(1500);

    // 4. Confirm ("Select Address" button — no stable id anymore)
    const confirm = findButton(/^Select Address$/i);
    if (confirm) fireClick(confirm);
    await wait(1800);

    // 5. Next
    await clickNext();
}

// ---- STEP: WHO ----

async function fillWho(data) {
    await waitForElement('#n311_contactfirstname', 15000);
    const s = data.settings;

    setVal('n311_contactfirstname', s.firstName);
    setVal('n311_contactlastname', s.lastName);
    setVal('n311_contactemail', s.email);
    setVal('n311_contactphone', s.phone);

    setVal('n311_portalcustomeraddressline1', s.myAddress1);
    setVal('n311_portalcustomeraddresscity', s.myCity);

    // State is now a plain <select> with no id; find the one whose options include the state code.
    if (s.myState) {
        const stateSel = Array.from(document.querySelectorAll('select'))
            .find(sel => Array.from(sel.options).some(o => o.value === s.myState));
        if (stateSel) {
            stateSel.value = s.myState;
            stateSel.dispatchEvent(new Event('input', { bubbles: true }));
            stateSel.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    setVal('n311_portalcustomeraddresszip', s.myZip);

    await wait(500);
    await clickNext();
}

// ---- STEP: REVIEW ----

async function handleReview(data) {
    // We always have at least the truck photo, so declare attachments = Yes to unlock
    // the upload substep. (Radios use value NO / YES.)
    const yes = document.querySelector('input[type="radio"][value="YES"]');
    if (yes) { fireClick(yes); yes.dispatchEvent(new Event('change', { bubbles: true })); }
    await wait(1000);

    // A reCAPTCHA now sits on the Review step, BEFORE the upload page. It must be solved
    // by a human. Pause here and tell the user what to do; the poller will pick the flow
    // back up on the attachments upload substep and finish the upload + submit.
    showCaptchaBanner("Solve the “I'm not a robot” reCAPTCHA, then click Continue. The extension will upload your photo(s) on the next page.");

    chrome.runtime.sendMessage({ action: 'FORM_FILLED_WAITING_CAPTCHA' });
    startPageWatcher(data);
}

// After the human solves the captcha and clicks Continue, we land on the upload substep.
// This page is gated behind the reCAPTCHA so it could not be DOM-verified in advance; the
// upload here is best-effort and tries both a plain file input and the older
// "Add Attachment" modal pattern. Adjust selectors if 311 differs from this.
async function handleAttachmentUpload(data) {
    removeCaptchaBanner();

    const images = [{ dataUrl: data.truckImage, name: data.truckName || 'truck.jpg' }];
    if (data.trafficImage) images.push({ dataUrl: data.trafficImage, name: 'traffic-cam.jpg' });

    for (const img of images) {
        try {
            await uploadOneAttachment(img.dataUrl, img.name);
        } catch (e) {
            console.error("[Content] Attachment upload failed:", e);
            showCaptchaBanner("Automatic upload of \"" + img.name + "\" failed. Please add the photo manually, then submit.");
        }
    }

    // Final submit ("Complete and Submit"). If a second captcha appears, the human handles it.
    await wait(1000);
    const submitBtn = findButton(/Complete and Submit|Submit/i);
    if (submitBtn && !submitBtn.disabled) {
        submitBtn.click();
    } else {
        showCaptchaBanner("Photo(s) uploaded. Solve any remaining captcha and click “Complete and Submit”.");
    }

    startPageWatcher(data);
}

async function uploadOneAttachment(dataUrl, filename) {
    // Strategy A: old-style "Add Attachment" button opens a modal with a file input.
    const addBtn = document.getElementById('attachments-addbutton') ||
        findButton(/Add Attachment|Add File|Upload/i);
    if (addBtn) {
        addBtn.click();
        await wait(800);
    }

    // Find a file input (modal or inline).
    const input = await waitForElement('input[type="file"]', 15000);
    await setFileInput(input, dataUrl, filename);

    // If a modal confirm button exists, click it; otherwise the inline input auto-adds.
    const modalBtn = findButton(/^Add Attachment$/i);
    if (modalBtn) {
        for (let i = 0; i < 30 && modalBtn.disabled; i++) await wait(500);
        if (!modalBtn.disabled) modalBtn.click();
    }
    await wait(1500);
}

async function setFileInput(input, dataUrl, filename) {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

// ---- SUCCESS DETECTION ----

function isSuccessPage() {
    const t = document.body.innerText || '';
    return t.includes("Your complaint has been received by the New York City Police Department") ||
        t.includes("Service Request Submitted") ||
        t.includes("Your Service Request has been submitted") ||
        /\bSR\d{6,}\b/.test(t) && /submitted|received|thank you/i.test(t) ||
        location.href.includes('confirmation') ||
        location.href.includes('submitted');
}

function isAttachmentUploadPage() {
    // The upload substep: a file input is present but we are past the Review summary.
    return !!document.querySelector('input[type="file"]') && !findLabel("Do You have Attachments");
}

function startPageWatcher(data) {
    if (window.__truckWatcher) return;
    console.log("[Content] Starting page watcher...");
    let checks = 0;
    window.__truckWatcher = setInterval(() => {
        checks++;
        if (checks % 20 === 0) chrome.runtime.sendMessage({ action: 'PING' });

        if (isSuccessPage()) {
            clearInterval(window.__truckWatcher);
            window.__truckWatcher = null;
            removeCaptchaBanner();
            console.log("[Content] Success detected by watcher. Waiting 3s...");
            setTimeout(() => chrome.runtime.sendMessage({ action: 'SUBMISSION_SUCCESS' }), 3000);
            return;
        }

        // If the user solved the captcha and advanced to the upload substep, drive it.
        if (!window.hasUploaded && isAttachmentUploadPage()) {
            window.hasUploaded = true;
            handleAttachmentUpload(data).catch(e => console.error(e));
        }
    }, 1000);
}

// ---- HELPERS ----

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el && val) {
        setNativeValue(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

// Set value via the native setter so Vue/framework bindings notice the change.
function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
}

async function clickNext() {
    const btn = await waitForElement('#NextStepBtn', 10000);
    if (btn) btn.click();
    else console.error("[Content] Next button (#NextStepBtn) not found!");
}

function findLabel(text) {
    const needle = text.toLowerCase();
    return Array.from(document.querySelectorAll('label, legend, h1, h2, h3, span, p'))
        .find(el => (el.textContent || '').trim().toLowerCase().includes(needle)) || null;
}

// Dispatch a full synthetic mouse sequence — some Vue components (multiselect options,
// address suggestions, "Select Address") react to mousedown/mouseup rather than click().
function fireClick(el) {
    for (const type of ['mousedown', 'mouseup', 'click']) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
}

function findButton(regex) {
    return Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn'))
        .find(b => regex.test((b.textContent || b.value || '').trim())) || null;
}

// Type into an input using synthetic events (works for the ESRI address autocomplete).
async function typeSynthetic(inputElement, text) {
    inputElement.focus();
    setNativeValue(inputElement, '');
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    for (const ch of text) {
        setNativeValue(inputElement, inputElement.value + ch);
        inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
        await wait(60 + Math.random() * 40);
    }
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
}

function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        const obs = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) { obs.disconnect(); resolve(el); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { obs.disconnect(); reject(new Error("Timeout waiting for " + selector)); }, timeout);
    });
}

// ---- On-page captcha banner ----

function showCaptchaBanner(msg) {
    let el = document.getElementById('truck311-banner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'truck311-banner';
        el.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#111;color:#fff;padding:14px 20px;font:600 15px/1.4 system-ui,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.4);";
        document.body.appendChild(el);
    }
    el.textContent = "🚚 311 Automation: " + msg;
}

function removeCaptchaBanner() {
    const el = document.getElementById('truck311-banner');
    if (el) el.remove();
}

// ---- Date formatting ----

function formatObservedSummary(date) {
    const dateStr = date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `Observed on ${dateStr} at approximately ${timeStr}.\n`;
}
