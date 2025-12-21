// import { expect } from '@playwright/test'; 
// We removed @playwright/test dependency which was causing packaging errors.
import { Page } from 'patchright';
import path from 'path';
import fs from 'fs';
import * as readline from 'readline';

// Helper to wait for user input (works in pkg unlike page.pause())
function waitForUserInput(prompt: string): Promise<void> {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(prompt, () => {
            rl.close();
            resolve();
        });
    });
}

// We now start at the article URL
const ARTICLE_URL = "https://portal.311.nyc.gov/article/?kanumber=KA-01957";

// ---- Human-like helpers ----

async function randomDelay(page: Page, min = 1000, max = 3000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await page.waitForTimeout(delay);
}

async function humanMove(page: Page) {
    // Move mouse to a random position to simulate human jitter
    const x = Math.floor(Math.random() * 500);
    const y = Math.floor(Math.random() * 500);
    await page.mouse.move(x, y, { steps: 10 });
}

// ---- formatting helpers ----

function formatMDYTimeAMPM(date: Date): string {
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

function formatObservedSummary(date: Date): string {
    const dateStr = date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
    const timeStr = date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
    });

    return `Observed on ${dateStr} at approximately ${timeStr}.\n`;
}

// ---- DOM helpers executed inside the page ----

async function setObservedDateTimeOnPage(page: Page, observed: Date) {
    const hiddenValueBase = observed.toISOString().replace(/\.\d+Z$/, "");
    const hiddenValue = hiddenValueBase + ".0000000Z";
    const displayValue = formatMDYTimeAMPM(observed);

    // Use string-based evaluate to bypass pkg serialization issues
    await page.evaluate(`
    (function () {
        var hiddenValue = ${JSON.stringify(hiddenValue)
        };
var displayValue = ${JSON.stringify(displayValue)};
var hidden = document.getElementById("n311_datetimeobserved");
var visible = document.getElementById("n311_datetimeobserved_datepicker_description");

if (!hidden || !visible) {
    console.error("Observed datetime inputs not found");
    return;
}

// Visible field (user-facing)
visible.value = displayValue;
visible.classList.add("dirty");
visible.dispatchEvent(new Event("input", { bubbles: true }));
visible.dispatchEvent(new Event("change", { bubbles: true }));

// Hidden field (submit value)
hidden.value = hiddenValue;
hidden.dispatchEvent(new Event("input", { bubbles: true }));
hidden.dispatchEvent(new Event("change", { bubbles: true }));
        }) ()
    `);
}

async function setRadioByLabelInPage(
    page: Page,
    groupSelector: string,
    labelText: string
) {
    // Use string-based evaluate to bypass pkg serialization issues
    await page.evaluate(`
    (function () {
        var groupSelector = ${JSON.stringify(groupSelector)
        };
var labelText = ${JSON.stringify(labelText)};
var els = document.querySelectorAll(groupSelector);
var normalized = labelText.toLowerCase();
els.forEach(function (el) {
    var label =
        el.getAttribute("aria-label") ||
        el.textContent ||
        (el.nextElementSibling && el.nextElementSibling.textContent) ||
        "";
    if (label.toLowerCase().includes(normalized)) {
        el.click();
    }
});
        }) ()
    `);
}

async function uploadAttachmentAndGetTimestamp(page: Page, photoPath: string): Promise<Date> {

    await page.click("#attachments-addbutton");
    const fileInput = page.locator(
        'input[type="file"][name="file"]'
    );
    // await expect(fileInput).toBeVisible({ timeout: 15000 });
    await fileInput.waitFor({ state: 'visible', timeout: 15000 });

    await fileInput.setInputFiles(photoPath);
    const modal = page.locator('.modal-content', {
        hasText: 'Add Attachment',
    });
    const modalAddButton = modal
        .locator('.modal-footer')
        .getByRole('button', { name: /^Add Attachment$/i });

    await modalAddButton.click();

    const filename = path.basename(photoPath);
    // Wait for the specific entry row containing the filename
    const fileRow = page.locator('tr[data-entity="n311_serviceactivity"]', { hasText: filename });
    // await expect(fileRow).toBeVisible({ timeout: 60000 });
    await fileRow.waitFor({ state: 'visible', timeout: 60000 });

    // Return the actual file creation time, not the upload time
    const stats = fs.statSync(photoPath);
    return stats.birthtime;
}


async function fillFirstPageFromUpload(page: Page, observed: Date, problemDescriptionBody: string) {
    // 1) Set Date/Time Observed (hidden + visible)
    await setObservedDateTimeOnPage(page, observed);

    // 2) Recurring problem? select "Yes"
    await setRadioByLabelInPage(
        page,
        'input[type="radio"][name*="recurring"], input[type="radio"][aria-label*="Recurring"]',
        "Yes"
    );

    // 3) "Describe the days and times the problem happens"
    await page.fill(
        'textarea[id*="describethedaysandtimestheproblemhappens"]',
        "all day, every day, but especially weekday mornings"
    );

    // 4) Problem description, using the observed date/time
    const observedText = formatObservedSummary(observed);
    const problemText = observedText + problemDescriptionBody;

    const problemLocator = page.locator(
        'textarea[aria-label="Describe the Problem"], textarea[aria-label*="Describe the Problem"], textarea[name*="description"]'
    );
    await problemLocator.first().fill(problemText);

    // Scroll to heading for a bit of visual confirmation when you're watching it
    const heading = page.locator("h1, h2, [role='heading']").first();
    if (await heading.count()) {
        await heading.scrollIntoViewIfNeeded();
    }
}

// ---- Page 2: location + address ----

// ---- Page 2: location + address ----

async function fillSecondPage(page: Page) {
    console.log('[Page 2] Starting fillSecondPage...');
    const ADDRESS_INPUT = process.env.OBSERVATION_ADDRESS;
    if (!ADDRESS_INPUT) {
        throw new Error('OBSERVATION_ADDRESS is not set in config.txt. Please add your observation address.');
    }
    console.log(`[Page 2] Using observation address: ${ADDRESS_INPUT}`);

    // Helper: type a string one char at a time w/ random delay
    async function typeSlowly(selector: string, text: string, retries = 3) {
        await page.click(selector);
        // Ensure we start clean if we are retrying or if field has junk
        await page.fill(selector, "");

        for (const ch of text) {
            await page.type(selector, ch, {
                delay: 10 + Math.random() * 90, // between 10–100ms
            });
        }

        const val = await page.inputValue(selector);
        if (val !== text) {
            if (retries > 0) {
                console.warn(`Mismatch in typeSlowly: expected "${text}", got "${val}".Retrying...`);
                await typeSlowly(selector, text, retries - 1);
            } else {
                throw new Error(`Failed to type text correctly after multiple attempts.Expected "${text}", got "${val}"`);
            }
        }
    }

    // 1) Location type — choose "Street/Sidewalk"
    console.log('[Page 2] Step 1: Selecting location type...');
    await page.selectOption("#n311_locationtypeid_select", {
        label: "Street/Sidewalk",
    });

    // 2) Open the address-picker modal
    console.log('[Page 2] Step 2: Opening address picker...');
    await page.click("#SelectAddressWhere");

    // Wait for the modal search box
    console.log('[Page 2] Step 3: Waiting for search box...');
    await page.waitForSelector("#address-search-box-input", {
        state: "visible",
        timeout: 15000,
    });

    // 3) Type the address one character at a time
    console.log('[Page 2] Step 4: Typing address...');
    await typeSlowly("#address-search-box-input", ADDRESS_INPUT);

    // 4) Wait for typeahead suggestions
    console.log('[Page 2] Step 5: Waiting for suggestions...');
    const suggestionItems = page.locator(
        "#suggestion-list-0 .ui-menu-item-wrapper"
    );
    await suggestionItems.first().waitFor({ state: 'visible', timeout: 15000 });

    // 5) Try to select - use text containment instead of regex filter for serialization safety
    console.log('[Page 2] Step 6: Selecting address from suggestions...');
    // Simply click the first suggestion (exact match logic was fragile anyway)
    await suggestionItems.first().click();

    // 6) Confirm with "Select Address"
    console.log('[Page 2] Step 7: Confirming address...');
    await page.click("#SelectAddressMap");
    console.log('[Page 2] fillSecondPage complete.');
}

// ---- Page 3: contact info ----

async function fillThirdPage(page: Page) {
    console.log('[Page 3] Starting fillThirdPage...');

    const CONTACT_FIRST_NAME = process.env.CONTACT_FIRST_NAME || "";
    const CONTACT_LAST_NAME = process.env.CONTACT_LAST_NAME || "";
    const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "";
    const CONTACT_PRIMARY_PHONE = process.env.CONTACT_PRIMARY_PHONE || "";

    const ADDRESS_LINE_1 = process.env.ADDRESS_LINE_1 || "";
    const ADDRESS_LINE_2 = process.env.ADDRESS_LINE_2 || "";
    const ADDRESS_CITY = process.env.ADDRESS_CITY || "";
    const ADDRESS_STATE = process.env.ADDRESS_STATE || "";
    const ADDRESS_ZIP = process.env.ADDRESS_ZIP || "";

    console.log('[Page 3] Environment variables loaded:');
    console.log(`  CONTACT_FIRST_NAME: ${CONTACT_FIRST_NAME ? '✓ set' : '✗ missing'} `);
    console.log(`  CONTACT_LAST_NAME: ${CONTACT_LAST_NAME ? '✓ set' : '✗ missing'} `);
    console.log(`  CONTACT_EMAIL: ${CONTACT_EMAIL ? '✓ set' : '✗ missing'} `);
    console.log(`  CONTACT_PRIMARY_PHONE: ${CONTACT_PRIMARY_PHONE ? '✓ set' : '✗ missing'} `);
    console.log(`  ADDRESS_LINE_1: ${ADDRESS_LINE_1 ? '✓ set' : '✗ missing'} `);
    console.log(`  ADDRESS_CITY: ${ADDRESS_CITY ? '✓ set' : '✗ missing'} `);
    console.log(`  ADDRESS_STATE: ${ADDRESS_STATE ? '✓ set' : '✗ missing'} `);
    console.log(`  ADDRESS_ZIP: ${ADDRESS_ZIP ? '✓ set' : '✗ missing'} `);

    // Use string-based evaluate to bypass pkg serialization issues
    await page.evaluate(`
    (function () {
        var CONTACT_FIRST_NAME = ${JSON.stringify(CONTACT_FIRST_NAME)
        };
var CONTACT_LAST_NAME = ${JSON.stringify(CONTACT_LAST_NAME)};
var CONTACT_EMAIL = ${JSON.stringify(CONTACT_EMAIL)};
var CONTACT_PRIMARY_PHONE = ${JSON.stringify(CONTACT_PRIMARY_PHONE)};
var ADDRESS_LINE_1 = ${JSON.stringify(ADDRESS_LINE_1)};
var ADDRESS_LINE_2 = ${JSON.stringify(ADDRESS_LINE_2)};
var ADDRESS_CITY = ${JSON.stringify(ADDRESS_CITY)};
var ADDRESS_STATE = ${JSON.stringify(ADDRESS_STATE)};
var ADDRESS_ZIP = ${JSON.stringify(ADDRESS_ZIP)};

function setValueById(id, value) {
    var el = document.getElementById(id);
    if (!el) {
        console.warn("Truck helper: element not found:", id);
        return;
    }
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
}

// "My Information" section
setValueById("n311_contactfirstname", CONTACT_FIRST_NAME);
setValueById("n311_contactlastname", CONTACT_LAST_NAME);
setValueById("n311_contactemail", CONTACT_EMAIL);
setValueById("n311_contactphone", CONTACT_PRIMARY_PHONE);

// "My Address" section
setValueById("n311_portalcustomeraddressline1", ADDRESS_LINE_1);
setValueById("n311_portalcustomeraddressline2", ADDRESS_LINE_2);
setValueById("n311_portalcustomeraddresscity", ADDRESS_CITY);

var stateSelect = document.getElementById("custom_n311_portalcustomeraddressstate");
if (stateSelect) {
    stateSelect.value = ADDRESS_STATE;
    stateSelect.dispatchEvent(new Event("input", { bubbles: true }));
    stateSelect.dispatchEvent(new Event("change", { bubbles: true }));
} else {
    console.warn("Truck helper: custom_n311_portalcustomeraddressstate not found");
}

// Hidden state text input
setValueById("n311_portalcustomeraddressstate", ADDRESS_STATE);
setValueById("n311_portalcustomeraddresszip", ADDRESS_ZIP);
        }) ()
    `);
}

export async function runComplaint(page: Page, imagePath: string, trafficCamFile: string | null) {
    console.log('\n========================================');
    console.log('Starting runComplaint...');
    console.log(`Image: ${imagePath} `);
    console.log(`Traffic cam: ${trafficCamFile || 'none'} `);
    console.log('========================================\n');

    // 0) Start at the article URL
    console.log('[Step 0] Navigating to article URL...');
    await page.goto(ARTICLE_URL, { waitUntil: "domcontentloaded" });

    await page.waitForTimeout(5000);

    // 1) Click the "report a truck on a roadway where truck traffic is not allowed" link
    console.log('[Step 1] Looking for report link...');
    // Use text containment instead of regex for better serialization in packaged mode
    const link = page.locator('a.contentaction').filter({ hasText: 'report a truck on a roadway' });

    // Click and then wait for some element that only exists on the SR page
    console.log('[Step 1] Clicking report link...');
    await link.click();

    await page.waitForSelector(
        "#n311_datetimeobserved_datepicker_description",
        { timeout: 60000 }
    );

    const observedFromUpload = await uploadAttachmentAndGetTimestamp(page, imagePath);

    let problemDescriptionBody = "Truck observed using a non-truck route. NYPD is misunderstanding the complaint. The truck is not conducting business (making a pickup or delivery) on Clinton Street. It's driving straight through, which is a traffic law violation since Clinton Street is not a designated truck route. I'm a chronic caller because the problem is chronic and 311 explicitly instructs me to submit a new complaint if I observe a new occurrence of the violation.\n";

    if (trafficCamFile) {
        // 1. Upload traffic cam pic
        await uploadAttachmentAndGetTimestamp(page, trafficCamFile);

        // 2. Calculate time difference
        const truckStats = fs.statSync(imagePath);
        const camStats = fs.statSync(trafficCamFile);
        // Time diff in minutes, rounded up
        const diffMs = truckStats.birthtime.getTime() - camStats.birthtime.getTime();
        const X = Math.ceil(diffMs / 60000);

        problemDescriptionBody = `Truck observed using a non-truck route.The same truck is visible on the Williamsburg Bridge just ${X} minutes earlier, demonstrating that it passed straight through Clinton Street without stopping for any local business, which is a traffic law violation since Clinton Street is not a designated truck route.I'm a chronic caller because the problem is chronic and 311 explicitly instructs me to submit a new complaint if I observe a new occurrence of the violation. The complaints will continue until the problem is solved.`;
    }

    // Use that server-side timestamp to populate Date/Time Observed + text
    console.log('[Step 5] Filling first page form...');
    await fillFirstPageFromUpload(page, observedFromUpload, problemDescriptionBody);

    console.log('[Step 6] Clicking Next to go to page 2...');
    await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        page.locator("#NextButton").click(),
    ]);

    // 7) Fill page 2 (location + address) then click Next with Playwright
    console.log('[Step 7] Filling page 2...');
    await fillSecondPage(page);

    console.log('[Step 8] Clicking Next to go to page 3...');
    await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        page.locator("#NextButton").click(),
    ]);

    // 8) Fill page 3 (your contact info) then click Next with Playwright
    console.log('[Step 9] Filling page 3...');
    await fillThirdPage(page);

    await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        page.locator("#NextButton").click(),
    ]);

    // Wait for user to complete captcha manually
    console.log('\n============================================');
    console.log('CAPTCHA PAUSE: Complete the captcha in the browser,');
    console.log('then press ENTER here to submit and continue...');
    console.log('============================================\n');
    await waitForUserInput('Press ENTER when ready to submit: ');

    // Click submit after user confirms
    console.log('Submitting...');
    await page.locator('#SubmitButton').click();
    console.log('Submission complete!');
}
