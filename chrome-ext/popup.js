document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    loadSettings();
    setupEventHandlers();
});

function setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Deactivate all
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));

            // Activate clicked
            tab.classList.add('active');
            document.getElementById(tab.dataset.target).classList.add('active');
        });
    });
}

function setupEventHandlers() {
    document.getElementById('save-settings').addEventListener('click', saveSettings);
    document.getElementById('start-btn').addEventListener('click', startBatch);
}

async function loadSettings() {
    const raw = await chrome.storage.local.get(['settings']);
    const s = raw.settings || {};

    setVal('conf-first-name', s.firstName);
    setVal('conf-last-name', s.lastName);
    setVal('conf-email', s.email);
    setVal('conf-phone', s.phone);
    setVal('conf-obs-address', s.observationAddress);
    setVal('conf-addr-1', s.myAddress1);
    setVal('conf-city', s.myCity || 'New York');
    setVal('conf-state', s.myState || 'NY');
    setVal('conf-zip', s.myZip);
}

function setVal(id, val) {
    if (val !== undefined) document.getElementById(id).value = val;
}

function getVal(id) {
    return document.getElementById(id).value;
}

async function saveSettings() {
    const settings = {
        firstName: getVal('conf-first-name'),
        lastName: getVal('conf-last-name'),
        email: getVal('conf-email'),
        phone: getVal('conf-phone'),
        observationAddress: getVal('conf-obs-address'),
        myAddress1: getVal('conf-addr-1'),
        myCity: getVal('conf-city'),
        myState: getVal('conf-state'),
        myZip: getVal('conf-zip'),
    };

    await chrome.storage.local.set({ settings });
    alert('Settings saved!');
}

async function startBatch() {
    const truckInput = document.getElementById('truck-files');
    const trafficInput = document.getElementById('traffic-files');

    if (truckInput.files.length === 0) {
        alert("Please select at least one truck image.");
        return;
    }

    const status = document.getElementById('status');
    status.textContent = "Reading files... please wait.";
    document.getElementById('start-btn').disabled = true;

    try {
        // Read settings again to be sure
        const raw = await chrome.storage.local.get(['settings']);
        const settings = raw.settings;
        if (!settings || !settings.observationAddress) {
            throw new Error("Please configure settings first (Observation Address is required).");
        }

        // Parse Traffic Files
        const trafficFiles = [];
        if (trafficInput) {
            for (const file of trafficInput.files) {
                trafficFiles.push({
                    file: file,
                    name: file.name,
                    timestamp: file.lastModified,
                    dataUrl: null // Wait to read until needed? No, user might close popup. Read now.
                });
            }

            // Read all traffic files into memory (DataURL)
            // If too many, this might be slow.
            for (let i = 0; i < trafficFiles.length; i++) {
                trafficFiles[i].dataUrl = await readFileAsDataURL(trafficFiles[i].file);
            }
        }

        // Parse Truck Files
        const queue = [];

        for (const file of truckInput.files) {
            const truckDataUrl = await readFileAsDataURL(file);
            const truckTime = file.lastModified;

            // Find candidates
            // Logic: traffic time is BEFORE truck time, within 10 mins (600000 ms)
            const candidates = trafficFiles.filter(tf => {
                const diff = truckTime - tf.timestamp;
                return diff >= 0 && diff <= 600000; // 10 mins
            });

            // Sort candidates
            candidates.sort((a, b) => a.timestamp - b.timestamp);

            queue.push({
                truckDataUrl: truckDataUrl,
                truckName: file.name,
                truckTimestamp: truckTime,
                trafficCandidates: candidates.map(c => ({ dataUrl: c.dataUrl, name: c.name, timestamp: c.timestamp }))
            });
        }

        // Send to background
        chrome.runtime.sendMessage({
            action: 'START_BATCH',
            data: {
                items: queue,
                settings: settings
            }
        });

        status.textContent = `Batch started with ${queue.length} items.\nDo not close the browser.`;

    } catch (e) {
        alert("Error: " + e.message);
        status.textContent = "Error: " + e.message;
        document.getElementById('start-btn').disabled = false;
    }
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
