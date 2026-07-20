# 311 Automation Chrome Extension

This extension automates the submission of NYC 311 complaints for trucks on non-truck routes.

## Installation

1. Open Google Chrome.
2. Navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in top right).
4. Click **Load unpacked**.
5. Select this `chrome-ext` directory.

## Usage

1. **Configure Settings**:
   - Click the extension icon to open the popup.
   - Go to the **Settings** tab.
   - Enter your Contact Information and the Observation Address.
   - Click **Save Settings**. (You only need to do this once).

2. **Run Batch**:
   - Go to the **Run** tab.
   - Click **Select Truck Images** and select all the `.jpg` files you want to process.
   - (Optional) Click **Select Traffic Cam Images** if you have corresponding evidence files.
   - Click **Start Processing**.

3. **Automation Process**:
   - The extension will open a new tab to the 311 portal.
   - It walks the current 311 wizard (**What → Where → Who → Review**): it sets the
     date/time observed (from each photo's file timestamp), fills the description,
     selects Location Type "Street/Sidewalk", enters the observation address, and fills
     your contact info.
   - On the **Review** step it selects **"Yes"** for attachments and then **pauses** with
     a black banner across the top of the page.
   - **CAPTCHA (now mid-flow)**: 311 moved the reCAPTCHA to the Review step, *before* the
     photo upload. When you see the banner:
     1. Solve the **"I'm not a robot"** reCAPTCHA.
     2. Click **Continue**.
   - On the attachment page that follows, the extension uploads your photo(s) and clicks
     **Complete and Submit**. If the automatic upload does not take, the banner will ask
     you to add the photo manually and submit.
   - The extension detects the submission confirmation and automatically proceeds to the
     next file in the queue.

## Notes

- **Do not close the browser** or the batch will be lost (files are held in memory).
- If the extension stops working, check the Console (Right Click Popup > Inspect, or Developer Tools on the 311 page).
- **Why this was rewritten (mid-2026):** NYC replaced the old Dynamics 365 multi-page
  complaint form with a Vue single-page wizard, which broke every selector the old
  automation used. The date field, location type, address suggestions, "Next"/"Submit"
  buttons, and the photo-upload step all changed, and the reCAPTCHA moved earlier in the
  flow. `content.js` now drives the new wizard. The final attachment-upload page sits
  behind the reCAPTCHA, so its upload logic is best-effort — if 311 changes it, adjust
  `handleAttachmentUpload` in `content.js`.
