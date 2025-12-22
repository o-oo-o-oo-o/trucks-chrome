# 311 Automation Chrome Extension

This extension automates the submission of NYC 311 complaints for trucks on non-truck routes.

## Installation

0. Click the green Code button, then Download ZIP, then unzip the zipfile.
1. Open Google Chrome.
2. Navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in top right).
4. Click **Load unpacked**.
5. Select the `trucks-chrome` folder that was inside the zip file you unzipped in step 0.

## Usage

1. **Configure Settings**:
   - Click the extension icon to open the popup.
   - Go to the **Settings** tab.
   - Enter your Contact Information and the Observation Address.
   - Click **Save Settings**. (You only need to do this once).

2. **Run Batch**:
   - Go to the **Run** tab.
   - Click **Select Truck Images** and select all the `.jpg` files you want to process.
   - Click **Start Processing**.

3. **Automation Process**:
   - The extension will open a new tab to the 311 portal.
   - It will automatically upload the image, set the date/time, and fill out the form.
   - **CAPTCHA**: The automation will pause when it reaches the Captcha/Submit step.
   - **Manually solve the Captcha and click Submit**.
   - The extension detects the "Service Request Submitted" confirmation and automatically proceeds to the next file in the queue.

## Notes

- **Do not close the browser** or the batch will be lost (files are held in memory).
- If the extension stops working, check the Console (Right Click Popup > Inspect, or Developer Tools on the 311 page).
