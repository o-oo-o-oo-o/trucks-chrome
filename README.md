# Trucks 311 Automation

This project automates the submission of truck complaints to NYC 311 using Playwright. It can be run as a developer script or packaged into a standalone executable for non-technical users.

## Developer Setup

1.  **Install Dependencies**:
    ```bash
    cd playwright
    npm install
    ```

2.  **Configuration**:
    Create a `.env` file in the `playwright` directory with your contact details:
    ```env
    CONTACT_FIRST_NAME=Jane
    CONTACT_LAST_NAME=Doe
    CONTACT_EMAIL=jane@example.com
    CONTACT_PRIMARY_PHONE=555-555-5555
    ADDRESS_LINE_1=123 Main St
    ADDRESS_CITY=New York
    ADDRESS_STATE=NY
    ADDRESS_ZIP=10001
    ```

3.  **Run Locally**:
    ```bash
    npx ts-node process_batch.ts
    ```

## Packaging for Release

To create a standalone executable that can be shared with others:

1.  **Build**:
    Run the build script from the `playwright` directory:
    ```bash
    cd playwright
    npm run build:exe
    ```

2.  **Locate Artifact**:
    The build process will generate a zip file containing the executable and necessary folders:
    `playwright/dist/Trucks311.zip`

## End User Instructions

To use the packaged application:

1.  **Installation**:
    -   Unzip `Trucks311.zip` to a folder on your computer.

2.  **Configuration**:
    -   Open `config.txt` (included in the folder) and fill in your contact details.

3.  **Prepare Images**:
    -   **Option A (JPGs)**: Place the photos you want to submit directly into the `media/ondeck` folder.
    -   **Option B (HEICs)**:
        1.  Place `.HEIC` files into the `media/raw` folder.
        2.  Double-click the `ConvertImages` executable. This will convert them to JPG and place them in `media/ondeck`.
            *   *Note: This requires `exiftool` to be installed on your system (e.g., `brew install exiftool`).*
    -   (Optional) If using traffic cam evidence, ensure images are in `realtimetraffic/media` (or the configured location).

4.  **Run**:
    -   Double-click the `Trucks311` executable.
    -   A terminal window will open showing the progress.
    -   Follow any on-screen prompts (e.g., occasional CAPTCHA pauses).

5.  **Results**:
    -   Successfully submitted images will be moved to `media/submitted`.
    -   The window will close when processing is complete or if an error occurs.
