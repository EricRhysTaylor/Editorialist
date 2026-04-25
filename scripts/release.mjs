#!/usr/bin/env node
// Release driver for the Editorialist Obsidian plugin.
//
// Usage:
//   npm run release -- <patch|minor|major|x.y.z>
//
// What it does:
//   1. Runs the full check funnel (typecheck, lint, css-check, compliance, qa-audit, tests).
//   2. Bumps manifest.json + versions.json + package.json to the target version.
//   3. Builds the production bundle.
//   4. Prints the exact assets to attach to the GitHub Release
//      (manifest.json, main.js, styles.css) and the tag name Obsidian expects
//      (tag equals manifest version, no "v" prefix).
//
// It does NOT push, tag, or publish — that stays explicit and manual.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ROOT = process.cwd();
const MANIFEST = path.join(ROOT, "manifest.json");
const VERSIONS = path.join(ROOT, "versions.json");
const PKG = path.join(ROOT, "package.json");

function run(command, description) {
	console.log(`\n→ ${description}`);
	execSync(command, { stdio: "inherit", cwd: ROOT });
}

function parseSemver(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) {
		throw new Error(`Not a semver: ${version}`);
	}
	return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function formatSemver({ major, minor, patch }) {
	return `${major}.${minor}.${patch}`;
}

function bumpSemver(current, bumpType) {
	const parsed = parseSemver(current);
	switch (bumpType) {
		case "major":
			return formatSemver({ major: parsed.major + 1, minor: 0, patch: 0 });
		case "minor":
			return formatSemver({ major: parsed.major, minor: parsed.minor + 1, patch: 0 });
		case "patch":
			return formatSemver({ major: parsed.major, minor: parsed.minor, patch: parsed.patch + 1 });
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

async function main() {
	const bumpArg = process.argv[2];
	if (!bumpArg) {
		console.error("Usage: npm run release -- <patch|minor|major|x.y.z>");
		process.exit(1);
	}

	if (!existsSync(MANIFEST) || !existsSync(VERSIONS) || !existsSync(PKG)) {
		console.error("Missing manifest.json, versions.json, or package.json.");
		process.exit(1);
	}

	const manifest = readJSON(MANIFEST);
	const versions = readJSON(VERSIONS);
	const pkg = readJSON(PKG);

	const currentVersion = manifest.version;
	const targetVersion = bumpSemver(currentVersion, bumpArg);
	const minAppVersion = manifest.minAppVersion;

	console.log(`\nEditorialist release: ${currentVersion} → ${targetVersion} (minAppVersion ${minAppVersion})`);

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

	// 3. Build once more after version bump so the banner/manifest pickup is correct.
	run("node esbuild.config.mjs production", `Rebuilding production bundle for ${targetVersion}`);

	// 4. Print post-release instructions.
	console.log(`\n✅ Release ${targetVersion} prepared.\n`);
	console.log("Next steps (manual):");
	console.log(`  1. Commit the version bump:`);
	console.log(`       git add manifest.json versions.json package.json main.js`);
	console.log(`       git commit -m "release: ${targetVersion}"`);
	console.log(`  2. Tag and push (note: tag name is the bare version — no "v" prefix):`);
	console.log(`       git tag ${targetVersion}`);
	console.log(`       git push origin master --tags`);
	console.log(`  3. Create a GitHub Release for tag ${targetVersion} and attach:`);
	console.log(`       - manifest.json`);
	console.log(`       - main.js`);
	console.log(`       - styles.css`);
	console.log(`     (These must be attached as release assets, not zipped, not inside a folder.)`);
	console.log(`  4. For first-time submission only: open a PR to`);
	console.log(`     https://github.com/obsidianmd/obsidian-releases adding an entry to community-plugins.json.`);
}

main().catch((err) => {
	console.error(`\n[release] ${err.message}`);
	process.exit(1);
});
