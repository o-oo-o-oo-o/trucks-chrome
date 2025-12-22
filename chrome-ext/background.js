let batchState = {
    running: false,
    queue: [], // Array of { truckFile: File, trafficCamFile: File | null } - NOTE: File objects can't be stored in background easily if service worker suspends?
    // Actually, in Manifest V3, Service Workers are ephemeral. We should keep the data mostly in the client side or use chrome.storage if serializable? 
    // File objects are NOT serializable to storage.
    // We will try to keep them in memory. If the SW dies, the batch dies. This is a known limitation.
    // We can try `chrome.runtime.onConnect` (Long Lived Connection) from the popup to keep the SW alive, 
    // BUT if the user closes the popup, the connection closes.
    // Ideally, the user keeps the browser open.

    currentIndex: 0,
    currentTabId: null
};

// Keep alive helper?
// For now, we'll assume standard flow.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'START_BATCH') {
        handleStartBatch(message.data);
    } else if (message.action === 'STOP_BATCH') {
        stopBatch();
    } else if (message.action === 'FORM_FILLED_WAITING_CAPTCHA') {
        // Notify user?
        console.log("Waiting for user to solve captcha...");
    } else if (message.action === 'SUBMISSION_SUCCESS') {
        console.log("Submission successful detected!");

        if (!batchState.queue || batchState.queue.length === 0) {
            console.error("[Background] CRITICAL: Queue is empty or lost! Service worker might have suspended.");
            // Optional: try to recover if we persisted state? 
            // For now, just log it clearly.
        }

        // Wait a bit then process next
        setTimeout(() => {
            batchState.currentIndex++;
            processNext();
        }, 3000);
    }
}, 3000);
    } else if (message.action === 'PING') {
    console.log("[Background] PING received. Keeping alive.");
    sendResponse({ status: 'alive' });
}
});

function stopBatch() {
    batchState.running = false;
    batchState.currentTabId = null;
    console.log("Batch stopped.");
}

async function handleStartBatch(data) {
    // data contains the serialized file info? No, we can't pass File objects via JSON message easily if they are large?
    // Actually sendMessage can handle JSON-compatible. File is not.
    // We need a way to get the file data.
    // Strategy: The POPUP reads the files as Base64/DataURL and sends them to background?
    // If files are many/large, this might crash.
    // Alternative: The popup keeps the state and drives the background?
    // If the popup closes, the process stops. This might be acceptable ("Keep this window open").
    // But the user asked for "Chrome Extension" automation, usually implies background capability.

    // Let's rely on the Popup staying open OR passing DataURLs to Background if they fit in memory.
    // 50 images * 2MB = 100MB. It's heavy but might fit.

    // Better: We send the list of *Metadata* and the Popup acts as a server? 
    // No, popup is short lived.

    // Let's assume the user sends us DataURLs for the files.
    console.log("Starting batch with " + data.items.length + " items.");
    batchState.queue = data.items; // Expecting { truckDataUrl, trafficDataUrl, truckName, timestamp }
    batchState.currentIndex = 0;
    batchState.running = true;
    batchState.settings = data.settings;

    processNext();
}

async function processNext() {
    if (!batchState.running) return;

    if (batchState.currentIndex >= batchState.queue.length) {
        console.log("Batch complete!");
        batchState.running = false;
        return;
    }

    const item = batchState.queue[batchState.currentIndex];
    console.log("Processing item " + (batchState.currentIndex + 1) + ": " + item.truckName);

    // Navigate to 311 page
    const ARTICLE_URL = "https://portal.311.nyc.gov/article/?kanumber=KA-01957";

    // Create tab or update existing?
    if (batchState.currentTabId) {
        try {
            await chrome.tabs.update(batchState.currentTabId, { url: ARTICLE_URL, active: true });
        } catch (e) {
            // Tab might be closed, create new
            const tab = await chrome.tabs.create({ url: ARTICLE_URL, active: true });
            batchState.currentTabId = tab.id;
        }
    } else {
        const tab = await chrome.tabs.create({ url: ARTICLE_URL, active: true });
        batchState.currentTabId = tab.id;
    }

    // Wait for load is tricky with SPA/navigation. We listen for onUpdated?
    // We'll set a one-time listener for the tab complete.
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (batchState.running && tabId === batchState.currentTabId && changeInfo.status === 'complete') {
        // Check if we are on the right domain
        if (tab.url && tab.url.includes("portal.311.nyc.gov")) {
            console.log("On 311 portal page, injecting script...");
            startComplaintFlow(tabId);
        }
    }
});

async function startComplaintFlow(tabId) {
    const item = batchState.queue[batchState.currentIndex];

    // We need to inject the content script if not already there (manifest handles it but we need to trigger action)
    // Send message to content script
    try {
        await chrome.tabs.sendMessage(tabId, {
            action: 'FILL_FORM',
            data: {
                truckImage: item.truckDataUrl,
                truckName: item.truckName, // for finding in list?
                truckTimestamp: item.truckTimestamp,
                trafficImage: item.trafficDataUrl,
                settings: batchState.settings
            }
        });
    } catch (e) {
        console.error("Error sending message to content script: ", e);
        // Maybe script not ready? Retry?
        setTimeout(() => startComplaintFlow(tabId), 1000);
    }
}
