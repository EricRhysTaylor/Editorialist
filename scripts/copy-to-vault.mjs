import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIR =
	"/Users/ericrhystaylor/Documents/Author Eric Rhys Taylor/Obsidian Vault Author .nosync/.obsidian/plugins/editorialist";
const FILES_TO_COPY = ["manifest.json", "main.js", "styles.css"];

async function main() {
	await mkdir(TARGET_DIR, { recursive: true });

	for (const fileName of FILES_TO_COPY) {
		const sourcePath = path.join(ROOT, fileName);
		const targetPath = path.join(TARGET_DIR, fileName);
		await copyFile(sourcePath, targetPath);
		console.log(`[copy:dev] Copied ${fileName} -> ${targetPath}`);
	}
}

await main();
