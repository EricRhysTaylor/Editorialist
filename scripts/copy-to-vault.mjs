import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = [
	"/Users/ericrhystaylor/Obsidian Vault Author/.obsidian/plugins/editorialist",
	"/Users/ericrhystaylor/Documents/RT LLC/Plugin/Test Vaults/Obsidian Vault Jane Austen/.obsidian/plugins/editorialist",
	"/Users/ericrhystaylor/Documents/RT LLC/Plugin/Test Vaults/Obsidian Vault Sherlock Holmes/.obsidian/plugins/editorialist",
];
const TARGET_LABEL = "/Author/ and /Jane Austen/ and /Sherlock Holmes/";
const FILES_TO_COPY = ["manifest.json", "main.js", "styles.css"];

async function main() {
	for (const targetDir of TARGET_DIRS) {
		await mkdir(targetDir, { recursive: true });
		for (const fileName of FILES_TO_COPY) {
			const sourcePath = path.join(ROOT, fileName);
			const targetPath = path.join(targetDir, fileName);
			await copyFile(sourcePath, targetPath);
		}
	}

	console.log(`[copy:dev] Copied plugin to "${TARGET_LABEL}"`);
}

await main();
