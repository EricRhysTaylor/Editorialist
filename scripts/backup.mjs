import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const messageInput = args.filter((arg) => arg !== "--dry-run").join(" ").trim();

function safe(command) {
	try {
		return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return "";
	}
}

function run(command) {
	console.log(`\n[backup] ${command}`);

	if (dryRun) {
		return;
	}

	execSync(command, { stdio: "inherit" });
}

function ensureGitReady() {
	if (!safe("git --version")) {
		throw new Error("Git is not available in this environment.");
	}

	if (!safe("git rev-parse --is-inside-work-tree")) {
		throw new Error("This directory is not inside a git repository.");
	}

	if (!safe("git remote get-url origin")) {
		throw new Error('No "origin" remote is configured for this repository.');
	}
}

function createMessage() {
	if (messageInput) {
		return messageInput;
	}

	return `backup: ${new Date().toISOString().replace("T", " ").replace(/\..+/, "")}`;
}

try {
	ensureGitReady();

	const branch = safe("git rev-parse --abbrev-ref HEAD") || "main";
	const status = safe("git status --porcelain");

	if (!status) {
		console.log("[backup] No changes to commit.");
		process.exit(0);
	}

	const message = createMessage().replace(/"/g, '\\"');
	run("git add .");
	run(`git commit -m "${message}"`);
	run(`git push origin ${branch}`);

	console.log(`\n[backup] Done. ${dryRun ? `Would push to ${branch}.` : `Pushed to ${branch}.`}`);
} catch (error) {
	const message = error instanceof Error ? error.message : "Backup failed.";
	console.error(`[backup] ${message}`);
	process.exit(1);
}
