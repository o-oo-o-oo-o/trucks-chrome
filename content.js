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

async function runAutomation(data) {
    // Check for Duplicate Run
    // We clear these flags if they don't apply to the current page, or rely on unique elements.
    // Actually, simple guard: if we have done the action for THIS page load, stop.
    // Since page reloads clear window, we can just use window flags.

    // DETECT PAGE STATE WITH POLLING

    const MAX_RETRIES = 20; // 10 seconds

    console.log("[Content] Starting runAutomation loop...");

    for (let i = 0; i < MAX_RETRIES; i++) {
        console.log(`[Content] Loop ${i + 1}/${MAX_RETRIES} checking page state...`);

        // --- SUCCESS PAGE CHECK ---
        // --- SUCCESS PAGE CHECK ---
        const successText = "Your complaint has been received by the New York City Police Department";
        if (document.body.innerText.includes(successText) ||
            document.body.innerText.includes("Service Request Submitted")) {
            console.log("[Content] Success text detected on new page load! Waiting 3s...");
            await wait(3000);
            chrome.runtime.sendMessage({ action: 'SUBMISSION_SUCCESS' });
            return;
        }

        // --- PAGE 1: DETAILS (Has File Input) ---
        const fileInput = document.querySelector('input[type="file"]');
        if (fileInput) {
            console.log("[Content] Detected Page 1 (File Input)");
            if (window.hasFilledPage1) {
                console.log("[Content] Already filled Page 1, skipping.");
                return;
            }
            window.hasFilledPage1 = true;
            await fillPage1(data);
            return;
        }

        // --- PAGE 2: LOCATION (Has Location Type Select) ---
        const locSelect = document.getElementById("n311_locationtypeid_select");
        if (locSelect) {
            console.log("[Content] Detected Page 2 (Location Select)");
            if (window.hasFilledPage2) {
                console.log("[Content] Already filled Page 2, skipping.");
                return;
            }
            window.hasFilledPage2 = true;
            await fillPage2(data);
            return;
        }

        // --- PAGE 3: CONTACT (Has Contact Name Input) ---
        const contactInput = document.getElementById("n311_contactfirstname");
        if (contactInput) {
            console.log("[Content] Detected Page 3 (Contact Input)");
            if (window.hasFilledPage3) {
                console.log("[Content] Already filled Page 3, skipping.");
                return;
            }
            window.hasFilledPage3 = true;
            await fillPage3(data);
            return;
        }

        // --- START PAGE (Has Report Link) ---
        const reportLink = document.querySelector('a.contentaction');
        if (reportLink && reportLink.textContent.toLowerCase().includes("report a truck")) {
            console.log("[Content] Detected Start Page (Report Link)");
            if (window.hasClickedStartLink) {
                console.log("[Content] Already clicked start link, skipping.");
                return;
            }
            window.hasClickedStartLink = true;
            reportLink.click();
            return;
        }

        // Wait and retry
        await wait(500);
    }
    console.log("[Content] Timed out waiting for recognizable page state.");
}

async function fillPage1(data) {
    // Wait for the form to load (the 'Add Attachment' button is a good indicator)
    await waitForElement("#attachments-addbutton", 15000);

    // 2. Upload Truck Image
    await uploadFile("#attachments-addbutton", data.truckImage, data.truckName);

    // 3. Traffic Cam Logic
    let trafficCamInfo = null;
    if (data.trafficCandidates && data.trafficCandidates.length > 0) {
        // Show modal to select
        const selected = await showTrafficCamModal(data.truckImage, data.trafficCandidates);
        if (selected) {
            await uploadFile("#attachments-addbutton", selected.dataUrl, selected.name);
            trafficCamInfo = selected;
        }
    } else if (data.trafficImage) {
        // Backward compatibility if single image passed
        await uploadFile("#attachments-addbutton", data.trafficImage, "traffic-cam.jpg");
    }

    // 4. Set Time Observed
    const observedDate = new Date(data.truckTimestamp);
    // Wait for date inputs
    await waitForElement("#n311_datetimeobserved_datepicker_description", 15000);
    await setObservedDateTimeOnPage(observedDate);

    // 5. Fill Recurring
    await waitForElement('input[type="radio"]', 10000);
    setRadioByLabel("Yes");

    // 6. Fill Days/Times
    await waitForElement('textarea[id*="describethedaysandtimestheproblemhappens"]', 10000);
    document.querySelector('textarea[id*="describethedaysandtimestheproblemhappens"]').value = "all day, every day, but especially weekday mornings";

    // 7. Fill Description
    const obsText = formatObservedSummary(observedDate);
    let descBody = "Truck observed using a non-truck route.\n";

    if (trafficCamInfo) {
        // Calculate diff
        const diffMs = data.truckTimestamp - trafficCamInfo.timestamp;
        const minutes = Math.ceil(diffMs / 60000);
        descBody = `Truck observed using a non-truck route. The same truck is visible on the Williamsburg Bridge just ${minutes} minutes earlier, demonstrating that it passed straight through Clinton Street without stopping for any local business, which is a traffic law violation since Clinton Street is not a designated truck route. I'm a chronic caller because the problem is chronic and 311 explicitly instructs me to submit a new complaint if I observe a new occurrence of the violation. The complaints will continue until the problem is solved.`;
    }

    const problemText = obsText + descBody;
    const descArea = await waitForElement('textarea[aria-label="Describe the Problem"], textarea[name*="description"]', 10000);
    if (descArea) {
        descArea.value = problemText;
        descArea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 8. Go to Next Page
    await clickNext();
}

async function fillPage2(data) {
    // Page 2: Location
    await waitForElement("#n311_locationtypeid_select", 15000);

    const locSelect = document.getElementById("n311_locationtypeid_select");
    // Find "Street/Sidewalk"
    for (let opt of locSelect.options) {
        if (opt.text === "Street/Sidewalk") {
            locSelect.value = opt.value;
            break;
        }
    }
    locSelect.dispatchEvent(new Event('change', { bubbles: true }));

    // Open Address Modal
    await waitForElement("#SelectAddressWhere", 15000);
    document.getElementById("SelectAddressWhere").click();
    await waitForElement("#address-search-box-input", 15000);

    // Type Address (Slowly with verification)
    const addressInput = document.getElementById("address-search-box-input");
    const addressVal = data.settings.observationAddress;

    await typeSlowly(addressInput, addressVal);

    // Wait for suggestions
    await waitForElement("#suggestion-list-0 .ui-menu-item-wrapper", 15000);
    // Click first
    document.querySelector("#suggestion-list-0 .ui-menu-item-wrapper").click();

    // Confirm Map
    await waitForElement("#SelectAddressMap", 10000);
    document.getElementById("SelectAddressMap").click();

    // Next
    await wait(1000); // UI delay
    await clickNext();
}

async function fillPage3(data) {
    // Page 3: Contact
    await waitForElement("#n311_contactfirstname", 15000);

    const s = data.settings;
    setVal("n311_contactfirstname", s.firstName);
    setVal("n311_contactlastname", s.lastName);
    setVal("n311_contactemail", s.email);
    setVal("n311_contactphone", s.phone);

    setVal("n311_portalcustomeraddressline1", s.myAddress1);
    // line 2 skipped
    setVal("n311_portalcustomeraddresscity", s.myCity);

    // State custom select
    const stateSel = document.getElementById("custom_n311_portalcustomeraddressstate");
    if (stateSel) {
        stateSel.value = s.myState;
        stateSel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setVal("n311_portalcustomeraddressstate", s.myState); // hidden?
    setVal("n311_portalcustomeraddresszip", s.myZip);

    // Next
    await clickNext();


    // Notify background
    chrome.runtime.sendMessage({ action: 'FORM_FILLED_WAITING_CAPTCHA' });

    // Listen for success (poll for URL)
    startSuccessPoller();
}

function startSuccessPoller() {
    console.log("[Content] Starting success poller (setInterval)...");
    let checks = 0;
    const interval = setInterval(() => {
        checks++;
        if (checks % 5 === 0) console.log(`[Content] Poller check #${checks}...`);

        // Send PING to keep background alive every ~20 seconds (checks runs every 1s)
        if (checks % 20 === 0) {
            console.log("[Content] Sending PING to background...");
            chrome.runtime.sendMessage({ action: 'PING' });
        }

        // Check for success text or URL
        // We look for specific confirmation text from 311 
        const successText = "Your complaint has been received by the New York City Police Department";

        if (document.body.innerText.includes(successText) ||
            document.body.innerText.includes("Service Request Submitted") ||
            window.location.href.includes("submitted")) {

            clearInterval(interval);
            console.log("[Content] Success text detected by poller. Waiting 3s...");
            setTimeout(() => {
                console.log("[Content] Notifying background.");
                chrome.runtime.sendMessage({ action: 'SUBMISSION_SUCCESS' });
            }, 3000);
        }
    }, 1000);
}

// ---- HELPERS ----

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el && val) {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

async function clickNext() {
    const btn = await waitForElement("#NextButton", 10000);
    if (btn) btn.click();
    else console.error("Next button not found!");
}

function setRadioByLabel(label) {
    const radios = document.querySelectorAll('input[type="radio"]');
    for (let r of radios) {
        const l = r.getAttribute('aria-label');
        if (l && l === label) {
            r.click();
            return;
        }
        // Check sibling label
    }
}

async function uploadFile(btnSelector, dataUrl, filename) {
    document.querySelector(btnSelector).click();

    // Wait for file input - specific selector from Playwright
    // Also wait 1s for modal animation potentially?
    await wait(500);
    const input = await waitForElement('input[type="file"][name="file"]');

    // Create File from DataURL
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: 'image/jpeg' });

    // DataTransfer hack
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;


    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait strictly for the "Add Attachment" button
    const getModalBtn = () => {
        // Scope to modal-footer to be safe
        const btns = Array.from(document.querySelectorAll('.modal-footer button'));
        return btns.find(b => b.textContent.includes("Add Attachment"));
    };

    let modalBtn = null;
    // Poll for the button to exist AND be enabled
    for (let i = 0; i < 30; i++) {
        modalBtn = getModalBtn();
        if (modalBtn) {
            if (!modalBtn.disabled) break;
        }
        await wait(500);
    }

    if (!modalBtn || modalBtn.disabled) {
        console.error("[Content] Add Attachment button stuck or not found");
        throw new Error("Add Attachment button not found or not enabled.");
    }

    modalBtn.click();

    // Wait for row
    await waitForElement(`tr[data-entity="n311_serviceactivity"]`, 20000);
}

function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);

        const obs = new MutationObserver((mutations, observer) => {
            const el = document.querySelector(selector);
            if (el) {
                observer.disconnect();
                resolve(el);
            }
        });

        obs.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
            obs.disconnect();
            reject(new Error("Timeout waiting for " + selector));
        }, timeout);
    });
}

// Date helpers
function formatMDYTimeAMPM(date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    let hour12 = hours % 12;
    if (hour12 === 0) hour12 = 12;
    const mm = minutes.toString().padStart(2, "0");
    return `${month}/${day}/${year} ${hour12}:${mm} ${ampm}`;
}

function formatObservedSummary(date) {
    const dateStr = date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `Observed on ${dateStr} at approximately ${timeStr}.\n`;
}

async function setObservedDateTimeOnPage(observed) {
    const hiddenValueBase = observed.toISOString().replace(/\.\d+Z$/, "");
    const hiddenValue = hiddenValueBase + ".0000000Z";
    const displayValue = formatMDYTimeAMPM(observed);

    const hidden = document.getElementById("n311_datetimeobserved");
    const visible = document.getElementById("n311_datetimeobserved_datepicker_description");

    if (visible) {
        visible.value = displayValue;
        visible.classList.add("dirty");
        visible.dispatchEvent(new Event("input", { bubbles: true }));
        visible.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (hidden) {
        hidden.value = hiddenValue;
        hidden.dispatchEvent(new Event("input", { bubbles: true }));
        hidden.dispatchEvent(new Event("change", { bubbles: true }));
    }
}

// Modal for Traffic Cam
async function showTrafficCamModal(truckImgUrl, candidates) {
    return new Promise(resolve => {
        // Create UI
        const div = document.createElement('div');
        div.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:99999; color:white; display:flex; flex-direction:column; align-items:center; padding:20px; overflow:auto;";

        div.innerHTML = `
          <h2>Select Traffic Cam Match</h2>
          <div style="display:flex; gap:20px;">
             <div>
               <h3>Truck Image</h3>
               <img src="${truckImgUrl}" style="max-width:400px;">
             </div>
             <div>
               <h3>Candidates</h3>
               <div id="cam-container" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;"></div>
             </div>
          </div>
          <button id="skip-btn" style="margin-top:20px; padding:10px; font-size:16px;">Skip / None</button>
        `;

        document.body.appendChild(div);

        const container = div.querySelector('#cam-container');

        candidates.forEach(cand => {
            const img = document.createElement('img');
            img.src = cand.dataUrl;
            img.style.cssText = "width:200px; cursor:pointer; border:2px solid transparent;";
            img.onclick = () => {
                document.body.removeChild(div);
                resolve(cand);
            };
            img.onmouseenter = () => img.style.border = "2px solid lime";
            img.onmouseleave = () => img.style.border = "2px solid transparent";

            const wrapper = document.createElement('div');
            wrapper.appendChild(img);
            wrapper.appendChild(document.createTextNode(cand.name));
            container.appendChild(wrapper);
        });

        document.getElementById('skip-btn').onclick = () => {
            document.body.removeChild(div);
            resolve(null);
        };
    });
}

function waitForElementByText(selector, text, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const find = () => Array.from(document.querySelectorAll(selector)).find(el => el.textContent.toLowerCase().includes(text.toLowerCase()));

        const existing = find();
        if (existing) return resolve(existing);

        const obs = new MutationObserver((mutations, observer) => {
            const el = find();
            if (el) {
                observer.disconnect();
                resolve(el);
            }
        });

        obs.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
            obs.disconnect();
            reject(new Error("Timeout waiting for text '" + text + "' in " + selector));
        }, timeout);
    });
}

// New helper for typing slowly
async function typeSlowly(inputElement, text, retries = 3) {
    // Clear first
    inputElement.value = "";
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true })); // Some frameworks need this

    for (const char of text) {
        inputElement.value += char;
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        // Add a small delay between keystrokes to simulate user typing
        await wait(50 + Math.random() * 50);
    }

    // Check if value matches
    if (inputElement.value !== text) {
        if (retries > 0) {
            console.warn(`[Content] Mismatch in typeSlowly: expected "${text}", got "${inputElement.value}". Retrying...`);
            await wait(500);
            await typeSlowly(inputElement, text, retries - 1);
        } else {
            console.error(`[Content] Failed to type text correctly after multiple attempts.`);
            throw new Error(`Failed to type text correctly: ${text}`);
        }
    } else {
        // Dispatch final change event
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    }
}
