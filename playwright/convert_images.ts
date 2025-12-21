
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const isPkg = (process as any).pkg !== undefined;
const rootDir = isPkg ? path.dirname(process.execPath) : __dirname;

const RAW_DIR = path.resolve(rootDir, 'media/raw');
const ONDECK_DIR = path.resolve(rootDir, 'media/ondeck');

console.log(`\n================================`);
console.log(`Trucks311 Image Converter`);
console.log(`================================`);
console.log(`Input:  ${RAW_DIR}`);
console.log(`Output: ${ONDECK_DIR}\n`);

// Ensure dirs exist
if (!fs.existsSync(RAW_DIR)) {
    console.error(`Error: Raw directory not found: ${RAW_DIR}`);
    console.log("Press any key to exit...");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', process.exit.bind(process, 1));
}
if (!fs.existsSync(ONDECK_DIR)) {
    fs.mkdirSync(ONDECK_DIR, { recursive: true });
}

function checkDependency(command: string): boolean {
    try {
        execSync(`which ${command}`);
        return true;
    } catch {
        return false;
    }
}

if (!checkDependency('sips')) {
    console.error("Error: 'sips' command not found. Are you on macOS?");
    process.exit(1);
}
if (!checkDependency('exiftool')) {
    console.error("Error: 'exiftool' command not found.");
    console.error("Please install exiftool to preserve photo timestamps.");
    console.error("Homebrew: brew install exiftool");
    console.error("Or download from: https://exiftool.org/");
    console.log("\nPress any key to exit...");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', process.exit.bind(process, 1));
} else {

    try {
        const files = fs.readdirSync(RAW_DIR).filter(f => /\.(heic)$/i.test(f));

        if (files.length === 0) {
            console.log("No .HEIC files found in media/raw.");
        } else {
            console.log(`Found ${files.length} .HEIC file(s). Processing...\n`);

            for (const file of files) {
                const srcPath = path.join(RAW_DIR, file);
                const basename = path.parse(file).name;

                let dstPath = path.join(ONDECK_DIR, `${basename}.jpg`);
                let counter = 1;
                while (fs.existsSync(dstPath)) {
                    dstPath = path.join(ONDECK_DIR, `${basename}_${counter}.jpg`);
                    counter++;
                }

                console.log(`Converting: ${file} -> ${path.basename(dstPath)}`);

                // 1) sips
                execSync(`sips -s format jpeg "${srcPath}" --out "${dstPath}"`, { stdio: 'ignore' });

                // 2) exiftool
                // '-TagsFromFile', src, '-All:All', '-FileCreateDate<FileCreateDate', '-FileModifyDate<FileModifyDate', '-overwrite_original', dst
                execSync(`exiftool -TagsFromFile "${srcPath}" -All:All "-FileCreateDate<FileCreateDate" "-FileModifyDate<FileModifyDate" -overwrite_original "${dstPath}"`, { stdio: 'ignore' });

                // Delete original? Script said yes.
                fs.unlinkSync(srcPath);
                console.log(`Deleted original: ${file}`);
            }
            console.log("\nAll done!");
        }

    } catch (err) {
        console.error("An error occurred:", err);
    }
}

console.log("\nPress any key to exit...");
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', process.exit.bind(process, 0));
