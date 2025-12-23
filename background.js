// background.js - Persistent Batch Handling using chrome.storage.local

// --- STATE MANAGEMENT ---

/**
 * Validates and retrieves current batch state from storage.
 * @returns {Promise<{running: boolean, queue: Array, currentIndex: number, currentTabId: number|null, settings: Object}>}
 */
async function getBatchState() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['batchState'], (result) => {
            resolve(result.batchState || {
                running: false,
                queue: [],
                currentIndex: 0,
                currentTabId: null,
                settings: {}
            });
        });
    });
}

/**
 * Saves the batch state to storage.
 * @param {Object} state 
 */
async function setBatchState(state) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ batchState: state }, () => {
            resolve();
        });
    });
}

// --- MESSAGE LISTENERS ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Return true to indicate async response for PING or others if needed
    if (message.action === 'PING') {
        console.log("[Background] PING received.");
        sendResponse({ status: 'alive' });
        return false;
    }

    handleMessage(message, sender, sendResponse);
    return true; // Keep channel open for async handlers
});

async function handleMessage(message, sender, sendResponse) {
    try {
        if (message.action === 'START_BATCH') {
            await handleStartBatch(message.data);
            sendResponse({ success: true });
        } else if (message.action === 'STOP_BATCH') {
            await stopBatch();
            sendResponse({ success: true });
        } else if (message.action === 'SUBMISSION_SUCCESS') {
            console.log("[Background] Submission success reported.");
            // Content script already waited 3s.
            await advanceBatch();
            sendResponse({ received: true });
        } else if (message.action === 'FORM_FILLED_WAITING_CAPTCHA') {
            console.log("[Background] Form filled, waiting for CAPTCHA.");
            sendResponse({ received: true });
        }
    } catch (e) {
        console.error("[Background] Message handling error:", e);
        // sendResponse({ error: e.message }); // Optional
    }
}

// --- CORE LOGIC ---

async function handleStartBatch(data) {
    console.log(`[Background] Starting batch with ${data.items.length} items.`);

    // Initial State
    const newState = {
        running: true,
        queue: data.items,
        currentIndex: 0,
        currentTabId: null, // Will be set when created
        settings: data.settings
    };

    await setBatchState(newState);
    await processNext();
}

async function stopBatch() {
    console.log("[Background] Stopping batch.");
    const state = await getBatchState();
    state.running = false;
    state.currentTabId = null;
    await setBatchState(state);
}

async function advanceBatch() {
    const state = await getBatchState();
    if (!state.running) return;

    state.currentIndex++;
    await setBatchState(state);
    await processNext();
}

async function processNext() {
    const state = await getBatchState();
    if (!state.running) {
        console.log("[Background] Batch not running.");
        return;
    }

    if (state.currentIndex >= state.queue.length) {
        console.log("[Background] Batch complete!");
        state.running = false;
        await setBatchState(state);

        // Notify user via tab
        if (state.currentTabId) {
            chrome.tabs.sendMessage(state.currentTabId, { action: 'BATCH_COMPLETE' })
                .catch(() => console.log("Could not send completion message (tab closed?)"));
        }
        return;
    }

    const item = state.queue[state.currentIndex];
    console.log(`[Background] Processing item ${state.currentIndex + 1}/${state.queue.length}: ${item.truckName}`);

    const ARTICLE_URL = "https://portal.311.nyc.gov/article/?kanumber=KA-01957";

    // 1. Clear Cookies for a fresh session
    console.log("[Background] Clearing cookies...");
    const cookies = await chrome.cookies.getAll({ domain: "portal.311.nyc.gov" });
    for (const cookie of cookies) {
        const url = "https://" + cookie.domain.replace(/^\./, "") + cookie.path;
        await chrome.cookies.remove({ url: url, name: cookie.name });
    }

    // 2. Close existing tab if any
    let tabId = state.currentTabId;
    if (tabId) {
        try {
            await chrome.tabs.remove(tabId);
            console.log("[Background] Closed previous tab:", tabId);
        } catch (e) {
            console.log("[Background] Previous tab already closed or invalid.");
        }
        state.currentTabId = null;
        await setBatchState(state);
    }

    // 3. Random Delay before opening new tab (2s - 5s)
    const delay = Math.floor(Math.random() * 3000) + 2000;
    console.log(`[Background] Waiting ${delay}ms before opening new tab...`);
    await new Promise(r => setTimeout(r, delay));

    // 4. Create New Tab
    console.log("[Background] Opening new tab...");
    const tab = await chrome.tabs.create({ url: ARTICLE_URL, active: true });
    state.currentTabId = tab.id;
    await setBatchState(state);
}

// --- TAB MONITORING ---

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.includes("portal.311.nyc.gov")) {
        // Check if this is our batch tab
        checkAndInject(tabId);
    }
});

async function checkAndInject(tabId) {
    const state = await getBatchState();
    if (state.running && state.currentTabId === tabId) {
        console.log("[Background] Target tab loaded. Injecting flow...");
        // Add small delay to ensure content script is ready/page fully interactive
        setTimeout(() => startComplaintFlow(tabId, state), 1000);
    }
}

async function startComplaintFlow(tabId, state) {
    // Double check state just in case
    if (!state) state = await getBatchState();

    if (!state.running || state.currentIndex >= state.queue.length) return;

    const item = state.queue[state.currentIndex];

    console.log("[Background] Sending FILL_FORM command.");

    try {
        await chrome.tabs.sendMessage(tabId, {
            action: 'FILL_FORM',
            data: {
                truckImage: item.truckDataUrl,
                truckName: item.truckName,
                truckTimestamp: item.truckTimestamp,
                trafficImage: item.trafficDataUrl,
                settings: state.settings
            }
        });
    } catch (e) {
        console.error("[Background] Failed to send message to content script (retry in 1s):", e);
        setTimeout(() => startComplaintFlow(tabId, state), 1000);
    }
}

// --- INITIALIZATION CHECK ---
// If the Service Worker restarts, check if we were supposed to be running.
getBatchState().then(state => {
    if (state.running) {
        console.log("[Background] Service Worker woke up. Batch is RUNNING. Resuming monitoring...");
        // We don't auto-navigate here to avoid loop if the user is just browsing. 
        // We rely on the user interacting OR the previous flow continuing.
        // However, if we were in the middle of a "wait for success", we are good.
        // If we were supposed to be "processing next", we might need to nudge it?
        // Safe bet: Do nothing, let the PINGs or Events drive it, OR check integrity.

        // Actually, if we were waiting for the user, we just wait.
        // If the user submits, content script sends SUBMISSION_SUCCESS -> we advance.
    }
});
