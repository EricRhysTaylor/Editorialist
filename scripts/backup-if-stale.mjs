import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ONE_HOUR_MS = 60 * 60 * 1000;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const backupStampPath = path.join(repoRoot, ".git", "editorialist-last-backup.json");

function readLastBackupAt() {
	if (!existsSync(backupStampPath)) {
		return null;
	}

	try {
		const raw = readFileSync(backupStampPath, "utf8");
		const parsed = JSON.parse(raw);
		if (!parsed.backedUpAt) {
			return null;
		}

		const timestamp = Date.parse(parsed.backedUpAt);
		return Number.isNaN(timestamp) ? null : timestamp;
	} catch {
		return null;
	}
}

function formatAge(ms) {
	const minutes = Math.floor(ms / 60000);
	if (minutes < 60) {
		return `${minutes}m`;
	}

	const hours = Math.floor(minutes / 60);
	const remainderMinutes = minutes % 60;
	return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m` : `${hours}h`;
}

const lastBackupAt = readLastBackupAt();
const ageMs = lastBackupAt ? Date.now() - lastBackupAt : Number.POSITIVE_INFINITY;

if (ageMs < ONE_HOUR_MS) {
	console.log(`[backup:hourly] Last backup ${formatAge(ageMs)} ago. Skipping.`);
	process.exit(0);
}

console.log(
	lastBackupAt
		? `[backup:hourly] Last backup ${formatAge(ageMs)} ago. Running backup.`
		: "[backup:hourly] No recorded backup found. Running backup.",
);

try {
	const autoMessage = `backup: auto ${new Date().toISOString().replace("T", " ").replace(/\..+/, "")}`;
	execSync(`node scripts/backup.mjs "${autoMessage}"`, {
		cwd: repoRoot,
		stdio: "inherit",
	});
} catch (error) {
	const message = error instanceof Error ? error.message : "Backup failed.";
	console.warn(`[backup:hourly] ${message}`);
	process.exit(0);
}
