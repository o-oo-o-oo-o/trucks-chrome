import fs from 'fs';
import path from 'path';
import { chromium } from 'patchright';
import dotenv from 'dotenv';
// Load .env explicitly from the current working directory or adjacent to executable
// We do this LATER after we define rootDir, but rootDir deps on nothing.
// Actually, we need to defer dotenv config until we have rootDir, BUT imports hover.
// So we will just use dotenv.config() with path argument later or re-config.
// However, top-level import 'dotenv/config' runs immediately.
// We should remove the side-effect import and call it manually.

import { runComplaint } from './automation';

// npx ts-node process_batch.ts

// Configuration
const isPkg = (process as any).pkg !== undefined;
const rootDir = isPkg ? path.dirname(process.execPath) : __dirname;

const SOURCE_DIR = path.resolve(rootDir, 'media/ondeck');
const SUBMITTED_DIR = path.resolve(rootDir, 'media/submitted');

// Initialize dotenv with portable path - use config.txt so it's visible in Finder
const configPath = path.join(rootDir, 'config.txt');
dotenv.config({ path: configPath });
console.log(`Config file: ${configPath}`);

const TRAFFIC_CAM_DIR = path.resolve(rootDir, isPkg ? 'realtimetraffic/media' : '../realtimetraffic/media');
console.log(`Running in ${isPkg ? 'packaged' : 'development'} mode`);
console.log(`Root directory: ${rootDir}`);

// Ensure submitted directory exists
if (!fs.existsSync(SUBMITTED_DIR)) {
    fs.mkdirSync(SUBMITTED_DIR, { recursive: true });
}

function parseTrafficTimestamp(filename: string): Date | null {
    // Expected format: 2025-12-16-08-50-31.jpg
    const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.jpg$/);
    if (!match) return null;
    const [_, y, m, d, h, min, s] = match.map(Number);
    return new Date(y, m - 1, d, h, min, s);
}

function getTrafficCamCandidates(truckPhotoTime: Date): string[] {
    if (!fs.existsSync(TRAFFIC_CAM_DIR)) return [];

    const candidates: { file: string; time: number }[] = [];
    const files = fs.readdirSync(TRAFFIC_CAM_DIR);

    // 10 minutes in milliseconds
    const TEN_MINUTES = 10 * 60 * 1000;
    const truckTime = truckPhotoTime.getTime();

    for (const file of files) {
        const date = parseTrafficTimestamp(file);
        if (!date) continue;

        const time = date.getTime();
        // Check if time is within [truckTime - 5min, truckTime]
        // Actually slightly relaxed to allow exact match or small clock skew if needed,
        // but strict "before or equal" is safer for "provenance".
        if (time <= truckTime && time >= truckTime - TEN_MINUTES) {
            candidates.push({ file, time });
        }
    }

    // Sort chronologically ascending
    return candidates.sort((a, b) => a.time - b.time).map(c => path.join(TRAFFIC_CAM_DIR, c.file));
}

async function selectTrafficCamImage(browser: any, candidates: string[], truckPhotoTime: Date, truckImagePath: string): Promise<string | null> {
    if (candidates.length === 0) {
        console.log("No matching traffic cam images found.");
        return null;
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    let selectedImage: string | null = null;
    let resolved = false;

    // Create a promise that resolves when user makes a selection
    const selectionPromise = new Promise<string | null>((resolve) => {
        // expose binding to receive selection from browser
        page.exposeFunction('onSelection', (imagePath: string | null) => {
            if (!resolved) {
                resolved = true;
                selectedImage = imagePath;
                resolve(imagePath);
            }
        });
    });

    // Prepare HTML content
    // We'll pass the images as base64 for simplicity or file:// URLs if allowed.
    // Playwright can load local files if we give it a file url or serve it.
    // Simplest is to just use file:// urls in the img src if the browser context permits it.
    // Note: 'chrome' channel usually allows local file access if strict security is off or if opened via file://.
    // Safer to just embed them or serve a simple page.

    // Let's interpret candidates locally and just pass the paths to the frontend, 
    // assuming we can render them via `file://` because we launched with --no-sandbox etc? 
    // Actually, local file access from "setContent" might be restricted.
    // Better to read them as base64.

    // Convert images to base64 for display
    const imagesData = candidates.map(filePath => {
        const base64 = fs.readFileSync(filePath, 'base64');
        return {
            path: filePath,
            src: `data:image/jpeg;base64,${base64}`,
            name: path.basename(filePath)
        };
    });

    const truckImageBase64 = fs.readFileSync(truckImagePath, 'base64');
    const truckImageData = `data:image/jpeg;base64,${truckImageBase64}`;

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Select Traffic Cam Image</title>
        <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; padding: 20px; background: #222; color: #fff; }
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; padding: 20px; background: #222; color: #fff; }
            #container { display: flex; flex-direction: column; align-items: center; gap: 20px; }
            #image-display { max-width: 800px; max-height: 600px; border: 2px solid #555; }
            #info { font-size: 1.2em; margin-bottom: 10px; }
            #controls { margin-top: 10px; font-size: 0.9em; color: #aaa; }
            .highlight { color: #4CAF50; font-weight: bold; }
        </style>
    </head>
    <body>
        <h1>Select Traffic Cam Image</h1>
        <div id="container">
            <div id="truck-section">
                <h2>Truck Image</h2>
                <img src="${truckImageData}" style="max-width: 600px; max-height: 400px; border: 2px solid #f00;" />
            </div>
            
            <div id="cam-section">
                <h2>Traffic Cam</h2>
                <div id="info">Image <span id="current-index" class="highlight">1</span> of ${imagesData.length}</div>
                <div id="filename"></div>
                <img id="image-display" src="" />
            </div>
        </div>
        
        <div id="controls">
            <p>LEFT / RIGHT arrow to navigate</p>
            <p>ENTER to SELECT current image</p>
            <p>ESCAPE to SKIP (select none)</p>
        </div>

        <script>
            const images = ${JSON.stringify(imagesData)};
            let currentIndex = 0;

            const imgEl = document.getElementById('image-display');
            const indexEl = document.getElementById('current-index');
            const filenameEl = document.getElementById('filename');

            function updateDisplay() {
                const img = images[currentIndex];
                imgEl.src = img.src;
                indexEl.textContent = currentIndex + 1;
                filenameEl.textContent = img.name;
            }

            document.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowRight') {
                    currentIndex = (currentIndex + 1) % images.length;
                    updateDisplay();
                } else if (e.key === 'ArrowLeft') {
                    currentIndex = (currentIndex - 1 + images.length) % images.length;
                    updateDisplay();
                } else if (e.key === 'Enter') {
                    window.onSelection(images[currentIndex].path);
                } else if (e.key === 'Escape') {
                    window.onSelection(null);
                }
            });

            updateDisplay();
        </script>
    </body>
    </html>
    `;

    await page.setContent(htmlContent);

    console.log("Waiting for user selection in the popup window...");
    await selectionPromise;
    await context.close();

    if (selectedImage) {
        console.log(`User selected: ${path.basename(selectedImage)}`);
    } else {
        console.log("User skipped selection.");
    }

    return selectedImage;
}


async function processBatch() {
    console.log(`Scanning for images in: ${SOURCE_DIR}`);

    if (!fs.existsSync(SOURCE_DIR)) {
        console.error(`Source directory not found: ${SOURCE_DIR}`);
        process.exit(1);
    }

    const files = fs.readdirSync(SOURCE_DIR)
        .filter(f => /\.(jpe?g)$/i.test(f))
        .sort(); // Sort to process in order

    console.log(`Found ${files.length} images to process.`);

    // Launch Patchright browser (Chrome channel)
    const browser = await chromium.launch({
        channel: 'chrome',
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Optional args
    });

    try {
        for (const file of files) {
            const fullPath = path.join(SOURCE_DIR, file);
            console.log(`\n--------------------------------------------------`);
            console.log(`Processing: ${file}`);
            console.log(`--------------------------------------------------\n`);

            const context = await browser.newContext({
                viewport: null, // Let browser decide or maximize
            });
            const page = await context.newPage();


            // Get truck photo timestamp (creation time)
            const stats = fs.statSync(fullPath);
            const truckTime = stats.birthtime;

            // Find and select traffic cam image
            const candidates = getTrafficCamCandidates(truckTime);
            const trafficCamFile = await selectTrafficCamImage(browser, candidates, truckTime, fullPath);

            try {
                await runComplaint(page, fullPath, trafficCamFile);

                // If we get here, the function completed (meaning user resumed after pause)
                console.log(`\n[SUCCESS] Submission completed for ${file}`);

                // Move to submitted folder
                const destPath = path.join(SUBMITTED_DIR, file);
                fs.renameSync(fullPath, destPath);
                console.log(`Moved to: ${destPath}`);

                // Random delay between 1 and 3 seconds to mimic human pace
                const delaySeconds = Math.floor(Math.random() * (3 - 1 + 1)) + 1;
                console.log(`Waiting ${delaySeconds} seconds before next submission...`);
                await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));

            } catch (error) {
                console.error(`\n[FAILURE] Failed to process ${file}`);
                console.error(error);

                // Stop processing on failure to let user investigate
                console.log('Stopping batch processing due to error.');
                await context.close();
                await browser.close();
                process.exit(1);
            }

            await context.close();
        }
    } finally {
        await browser.close();
    }

    console.log(`\nAll images processed!`);
}

processBatch().catch(console.error);
