#!/usr/bin/env node
// Release driver for the Editorialist Obsidian plugin.
//
// Two-phase flow (mirrors radial-timeline's release-script.mjs):
//
//   Phase 1 — start a release:
//     npm run release -- <patch|minor|major|x.y.z>
//       1. Runs the full check funnel (typecheck, lint, css, compliance, audits, tests, build).
//       2. Bumps manifest.json + versions.json + package.json.
//       3. Rebuilds the production bundle, commits, tags (bare version, no "v"),
//          pushes master + tag.
//       4. Creates a DRAFT GitHub release with an auto-generated changelog and
//          opens it in the browser so the notes can be polished by hand.
//
//   Phase 2 — finish the release:
//     npm run release
//       1. Detects the draft release for the current manifest version.
//       2. Dispatches .github/workflows/release-build.yml — GitHub-hosted
//          runners build main.js, attest build provenance for all three
//          assets, and upload manifest.json, main.js, styles.css to the release.
//       3. Publishes the draft (with confirmation).
//
// Requires: gh CLI authenticated, releases cut from master.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ROOT = process.cwd();
const MANIFEST = path.join(ROOT, "manifest.json");
const VERSIONS = path.join(ROOT, "versions.json");
const PKG = path.join(ROOT, "package.json");
const REPO_URL = "https://github.com/EricRhysTaylor/Editorialist";

function run(command, description, { silent = false, allowFail = false } = {}) {
	if (!silent) console.log(`\n→ ${description}`);
	try {
		return execSync(command, { encoding: "utf8", stdio: silent ? "pipe" : "inherit", cwd: ROOT });
	} catch (error) {
		if (!allowFail) {
			console.error(`\n[release] Failed: ${description}`);
			console.error(error.message);
			process.exit(1);
		}
		if (!silent) console.warn(`[release] ${description} failed but continuing.`);
		return null;
	}
}

function capture(command) {
	return execSync(command, { encoding: "utf8", cwd: ROOT }).trim();
}

function parseSemver(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) {
		throw new Error(`Not a semver: ${version}`);
	}
	return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function bumpSemver(current, bumpType) {
	const { major, minor, patch } = parseSemver(current);
	switch (bumpType) {
		case "major":
			return `${major + 1}.0.0`;
		case "minor":
			return `${major}.${minor + 1}.0`;
		case "patch":
			return `${major}.${minor}.${patch + 1}`;
		default:
			if (/^\d+\.\d+\.\d+$/.test(bumpType)) {
				return bumpType;
			}
			throw new Error(`Invalid bump argument: ${bumpType} — use patch|minor|major|x.y.z`);
	}
}

function readJSON(file) {
	return JSON.parse(readFileSync(file, "utf8"));
}

function writeJSON(file, data) {
	writeFileSync(file, `${JSON.stringify(data, null, "\t")}\n`, "utf8");
}

async function confirm(question) {
	if (!process.stdin.isTTY) return true;
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise((resolve) => rl.question(question, resolve));
	rl.close();
	return /^y(es)?$/i.test(answer.trim());
}

function requireMasterBranch() {
	const branch = capture("git rev-parse --abbrev-ref HEAD");
	if (branch !== "master") {
		console.error(`[release] Releases must be cut from 'master'. Current: '${branch}'`);
		process.exit(1);
	}
}

function fetchReleaseInfo(tag) {
	try {
		const json = capture(`gh release view ${tag} --json name,isDraft,tagName`);
		return JSON.parse(json);
	} catch {
		return null;
	}
}

function getLastReleaseTag() {
	try {
		const releases = JSON.parse(capture("gh release list --limit 1 --json tagName"));
		if (releases.length > 0) return releases[0].tagName;
	} catch {
		/* fall through to git tags */
	}
	try {
		return capture("git tag --sort=-version:refname").split("\n")[0] || null;
	} catch {
		return null;
	}
}

// --- Changelog -------------------------------------------------------------

const CATEGORIES = [
	{ title: "New Features", keywords: [/feat/i, /\badd/i, /\bnew\b/i, /implement/i, /create/i] },
	{ title: "Bug Fixes", keywords: [/fix/i, /resolve/i, /\bbug/i, /correct/i, /repair/i] },
	{ title: "Improvements", keywords: [/improve/i, /refactor/i, /perf/i, /optimi[sz]/i, /polish/i, /refine/i, /update/i] },
	{ title: "Documentation", keywords: [/docs?\b/i, /readme/i, /wiki/i] },
	{ title: "Maintenance", keywords: [/chore/i, /build/i, /\bci\b/i, /bump/i, /upgrade/i, /script/i] },
];

// Automated backup commits ("backup: auto 2026-06-11 16:44:32") carry no
// release-note information — drop them entirely.
function isNoiseCommit(message) {
	return /^backup: auto \d{4}-/.test(message);
}

function generateChangelog(fromTag, toRef = "HEAD") {
	try {
		const range = fromTag ? `${fromTag}..${toRef}` : toRef;
		const logs = capture(`git log ${range} --pretty=format:"%h|%H|%s" --no-merges`);
		if (!logs) return "No changes since last release.";

		const categorized = Object.fromEntries(CATEGORIES.map((c) => [c.title, []]));
		const uncategorized = [];

		for (const line of logs.split("\n")) {
			const [shortHash, fullHash, ...rest] = line.split("|");
			if (!shortHash || !fullHash || rest.length === 0) continue;
			let message = rest.join("|").trim();
			if (isNoiseCommit(message)) continue;
			if (message.endsWith(".")) message = message.slice(0, -1);
			message = message.replace(/#(\d+)/g, `[#$1](${REPO_URL}/issues/$1)`);
			const entry = `- ${message} ([${shortHash}](${REPO_URL}/commit/${fullHash}))`;

			const category = CATEGORIES.find((c) => c.keywords.some((re) => re.test(message)));
			(category ? categorized[category.title] : uncategorized).push(entry);
		}

		let changelog = "";
		for (const { title } of CATEGORIES) {
			if (categorized[title].length > 0) {
				changelog += `### ${title}\n${categorized[title].join("\n")}\n\n`;
			}
		}
		if (uncategorized.length > 0) {
			changelog += `### Other Changes\n${uncategorized.join("\n")}\n\n`;
		}
		return changelog.trim() || "No significant changes since last release.";
	} catch (error) {
		console.error(error);
		return "Could not generate changelog.";
	}
}

function readLocalReleaseDraft(version) {
	const draftPath = path.join(ROOT, "docs", "releases", `draft-for-release-${version}.md`);
	if (!existsSync(draftPath)) return null;
	const body = readFileSync(draftPath, "utf8").trim();
	return body.length > 0 ? body : null;
}

// --- CI build: dispatch release-build.yml and wait -------------------------
// Build + attestation + asset upload happen on GitHub-hosted runners so the
// assets carry build provenance.
function runReleaseWorkflowAndWait(version) {
	run(
		`gh workflow run release-build.yml --ref master -f version=${version}`,
		"Dispatching release build workflow on GitHub"
	);

	console.log("\n⏳ Waiting for workflow run to register...");
	let runId = null;
	for (let attempt = 0; attempt < 10 && !runId; attempt++) {
		execSync("sleep 3");
		try {
			const runs = JSON.parse(
				capture("gh run list --workflow=release-build.yml --limit 1 --json databaseId,status")
			);
			if (runs.length > 0 && runs[0].status !== "completed") {
				runId = runs[0].databaseId;
			}
		} catch {
			/* retry */
		}
	}
	if (!runId) {
		console.error("[release] Could not find the dispatched workflow run. Check: gh run list --workflow=release-build.yml");
		process.exit(1);
	}

	run(`gh run watch ${runId} --exit-status`, `Building, attesting, and uploading assets in CI (run ${runId})`);
}

// --- Phase 2: finish an existing draft/published release --------------------
async function finishRelease(version, isDraft) {
	runReleaseWorkflowAndWait(version);

	if (isDraft) {
		if (await confirm(`\nDraft release ${version} has assets. Publish it now? [y/N] `)) {
			run(`gh release edit ${version} --draft=false --latest`, "Publishing release");
			console.log(`\n🎉 Release ${version} published.`);
			console.log(`📦 ${REPO_URL}/releases/tag/${version}`);
		} else {
			console.log(`\nAssets uploaded. Release ${version} remains a draft.`);
		}
	} else {
		console.log(`\nAssets updated for existing release ${version}.`);
	}
}

// --- Phase 1: start a new release -------------------------------------------
async function startRelease(bumpArg) {
	const manifest = readJSON(MANIFEST);
	const versions = readJSON(VERSIONS);
	const pkg = readJSON(PKG);

	const currentVersion = manifest.version;
	const targetVersion = bumpSemver(currentVersion, bumpArg);
	const minAppVersion = manifest.minAppVersion;

	console.log(`\nEditorialist release: ${currentVersion} → ${targetVersion} (minAppVersion ${minAppVersion})`);

	if (fetchReleaseInfo(targetVersion)) {
		console.error(`[release] A release for ${targetVersion} already exists on GitHub.`);
		process.exit(1);
	}

	if (!(await confirm("\nProceed? [y/N] "))) {
		console.log("Aborted.");
		process.exit(1);
	}

	// 1. Run the full check funnel.
	run("npm run release:check", "Running release:check (typecheck, lint, css, compliance, audit, tests, build)");

	// 2. Bump versions in all three files.
	manifest.version = targetVersion;
	writeJSON(MANIFEST, manifest);
	versions[targetVersion] = minAppVersion;
	writeJSON(VERSIONS, versions);
	pkg.version = targetVersion;
	writeJSON(PKG, pkg);
	console.log(`\n→ Synced manifest.json, versions.json, package.json to ${targetVersion}`);

	// 3. Rebuild after the bump so the bundled manifest pickup is correct.
	run("node esbuild.config.mjs production", `Rebuilding production bundle for ${targetVersion}`);

	// 4. Commit, tag (bare version — no "v" prefix), push.
	run(
		"git add manifest.json versions.json package.json package-lock.json main.js",
		"Staging version bump"
	);
	run(`git commit -m "release: ${targetVersion}"`, "Committing version bump");
	run(`git tag ${targetVersion}`, `Creating tag ${targetVersion}`);
	run("git push origin master", "Pushing master");
	run(`git push origin ${targetVersion}`, "Pushing tag");

	// 5. Create a draft release with the changelog.
	const lastTag = getLastReleaseTag();
	const localDraft = readLocalReleaseDraft(targetVersion);
	const notes = localDraft ?? `## What's Changed\n\n${generateChangelog(lastTag === targetVersion ? null : lastTag)}`;
	if (localDraft) {
		console.log(`→ Using local release notes draft: docs/releases/draft-for-release-${targetVersion}.md`);
	}

	const notesFile = path.join(ROOT, ".release-notes-temp.md");
	writeFileSync(notesFile, notes, "utf8");
	run(
		`gh release create ${targetVersion} --title "${targetVersion}" --notes-file "${notesFile}" --draft`,
		"Creating draft release on GitHub"
	);
	unlinkSync(notesFile);

	console.log(`\n✅ Draft release ${targetVersion} created.\n`);
	console.log("Next steps:");
	console.log("  1. Edit the release notes on GitHub (browser is opening). SAVE the draft — do not publish.");
	console.log("  2. Run `npm run release` (no arguments) to build/attest/upload assets in CI and publish.");
	run(`gh release view ${targetVersion} --web`, "Opening GitHub", { silent: true, allowFail: true });
}

async function main() {
	if (!existsSync(MANIFEST) || !existsSync(VERSIONS) || !existsSync(PKG)) {
		console.error("[release] Missing manifest.json, versions.json, or package.json.");
		process.exit(1);
	}
	requireMasterBranch();
	run("gh auth status", "Checking gh CLI authentication", { silent: true });

	const bumpArg = process.argv[2];
	const currentVersion = readJSON(MANIFEST).version;

	if (!bumpArg) {
		// Finish phase: look for an existing release of the current version.
		const release = fetchReleaseInfo(currentVersion);
		if (!release) {
			console.error(`[release] No GitHub release found for ${currentVersion}.`);
			console.error("Usage:");
			console.error("  npm run release -- <patch|minor|major|x.y.z>   # start a release");
			console.error("  npm run release                                 # finish the draft for the current version");
			process.exit(1);
		}
		if (release.isDraft) {
			console.log(`Found DRAFT release ${currentVersion}.`);
			if (await confirm(`\nFinish release ${currentVersion}? (CI build → attest → upload → publish) [y/N] `)) {
				await finishRelease(currentVersion, true);
			}
		} else {
			console.log(`Found PUBLISHED release ${currentVersion}.`);
			if (await confirm(`\nRepair/update assets for ${currentVersion}? [y/N] `)) {
				await finishRelease(currentVersion, false);
			}
		}
		return;
	}

	await startRelease(bumpArg);
}

main().catch((err) => {
	console.error(`\n[release] ${err.message}`);
	process.exit(1);
});
