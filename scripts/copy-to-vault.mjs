import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const FILES_TO_COPY = ["manifest.json", "main.js", "styles.css"];

async function main() {
	const targetDir = process.env.EDITORIALIST_DEV_PLUGIN_DIR?.trim();
	if (!targetDir) {
		throw new Error(
			"Set EDITORIALIST_DEV_PLUGIN_DIR to your Obsidian dev vault plugin folder before running copy:dev.",
		);
	}

	const resolvedTargetDir = path.resolve(targetDir);
	await mkdir(resolvedTargetDir, { recursive: true });

	for (const fileName of FILES_TO_COPY) {
		const sourcePath = path.join(ROOT, fileName);
		const targetPath = path.join(resolvedTargetDir, fileName);
		await copyFile(sourcePath, targetPath);
	}

	console.log(`[copy:dev] Copied plugin to "${resolvedTargetDir}"`);
}

await main();
