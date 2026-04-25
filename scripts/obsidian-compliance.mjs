#!/usr/bin/env node
// Obsidian Community Plugin submission compliance checks.
//
// This script enforces rules from the official guidelines so we don't get
// rejected by the review bot or reviewer comments. Run via:
//   npm run compliance
// and it is wired into `npm run check` / `npm run release:check`.
//
// Guideline source: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

let hasError = false;
const warnings = [];

function fail(file, message) {
	hasError = true;
	const rel = path.relative(ROOT, file);
	console.error(`\n[compliance] ${rel}`);
	console.error(`  ❌ ${message}`);
}

function warn(file, message) {
	const rel = file ? path.relative(ROOT, file) : "(repo)";
	warnings.push(`${rel}: ${message}`);
}

function readJSON(relativePath) {
	const full = path.join(ROOT, relativePath);
	if (!fs.existsSync(full)) {
		fail(full, `Missing required file.`);
		return null;
	}
	try {
		return { data: JSON.parse(fs.readFileSync(full, "utf8")), file: full };
	} catch (err) {
		fail(full, `Invalid JSON: ${err.message}`);
		return null;
	}
}

// ---------- manifest.json ----------
const manifestResult = readJSON("manifest.json");
if (manifestResult) {
	const { data: manifest, file: manifestFile } = manifestResult;
	const requiredFields = ["id", "name", "version", "minAppVersion", "description", "author"];
	for (const field of requiredFields) {
		if (!manifest[field]) {
			fail(manifestFile, `manifest.json is missing required field "${field}".`);
		}
	}
	if (!manifest.authorUrl) {
		fail(manifestFile, `manifest.json is missing "authorUrl". Reviewers require this.`);
	}
	if (manifest.id && !/^[a-z0-9-]+$/.test(manifest.id)) {
		fail(manifestFile, `manifest id "${manifest.id}" must match /^[a-z0-9-]+$/.`);
	}
	if (manifest.id && manifest.id.startsWith("obsidian-")) {
		fail(manifestFile, `manifest id must not start with "obsidian-".`);
	}
	if (manifest.name && /obsidian/i.test(manifest.name)) {
		fail(manifestFile, `manifest name must not contain "Obsidian".`);
	}
	if (manifest.description && !/[.!?]$/.test(manifest.description.trim())) {
		fail(manifestFile, `manifest description should end with a period.`);
	}
	if (manifest.description && manifest.description.length > 250) {
		warn(manifestFile, `manifest description is ${manifest.description.length} chars — keep it tight.`);
	}
	if (manifest.minAppVersion === "0.15.0") {
		warn(manifestFile, `minAppVersion 0.15.0 is ancient — set to a version you actually test.`);
	}

	// Cross-check versions.json
	const versionsResult = readJSON("versions.json");
	if (versionsResult && manifest.version) {
		const { data: versions, file: versionsFile } = versionsResult;
		if (!versions[manifest.version]) {
			fail(versionsFile, `versions.json must contain an entry for "${manifest.version}".`);
		}
		if (versions[manifest.version] && versions[manifest.version] !== manifest.minAppVersion) {
			fail(versionsFile, `versions.json["${manifest.version}"] (${versions[manifest.version]}) must equal manifest.minAppVersion (${manifest.minAppVersion}).`);
		}
	}
}

// ---------- package.json ----------
const pkgResult = readJSON("package.json");
if (pkgResult) {
	const { data: pkg, file: pkgFile } = pkgResult;
	if (pkg.dependencies && pkg.dependencies.obsidian) {
		fail(pkgFile, `"obsidian" must be in devDependencies, not dependencies.`);
	}
	const obsidianDep = pkg.devDependencies?.obsidian;
	if (obsidianDep === "latest" || obsidianDep === "*") {
		fail(pkgFile, `devDependencies.obsidian must be a pinned/ranged version, not "${obsidianDep}".`);
	}
	if (!pkg.scripts?.build) {
		fail(pkgFile, `package.json must define a "build" script.`);
	}
}

// ---------- source code patterns ----------
const SOURCE_FILES = collectSources(path.join(ROOT, "src"));

for (const file of SOURCE_FILES) {
	const text = fs.readFileSync(file, "utf8");
	const lines = text.split(/\r?\n/);

	// Build a map of line numbers that are inside an onunload() body.
	const onunloadLines = collectOnunloadLineNumbers(lines);

	lines.forEach((line, index) => {
		const lineNumber = index + 1;
		const safe = line.includes("// SAFE:");
		if (safe) return;

		// detachLeavesOfType is ONLY banned inside onunload() — Obsidian restores
		// workspace state on reload. User-initiated close actions may use it.
		if (/detachLeavesOfType\(/.test(line) && onunloadLines.has(lineNumber)) {
			failLine(file, lineNumber, line, `detachLeavesOfType() inside onunload() is banned — Obsidian restores leaves automatically.`);
		}

		// Ribbon/command labels must not include the plugin name.
		const ribbonMatch = line.match(/addRibbonIcon\([^,]+,\s*(['"`])([^'"`]+)\1/);
		if (ribbonMatch && /\beditorialist\b/i.test(ribbonMatch[2])) {
			failLine(file, lineNumber, line, `Ribbon label "${ribbonMatch[2]}" must not include the plugin name. Obsidian adds it automatically.`);
		}

		// Command names: matched from the 'name' property — checked separately below.

		// innerHTML / outerHTML etc. (already enforced by qa-audit but keep as safety net).
		if (/\.innerHTML\b/.test(line)) { // SAFE: audit regex scanning source for banned token
			failLine(file, lineNumber, line, `innerHTML is banned — use createEl/setText/createDiv.`);
		}
		if (/\.outerHTML\s*=/.test(line)) { // SAFE: audit regex scanning source for banned token
			failLine(file, lineNumber, line, `outerHTML assignment is banned.`);
		}
		if (/insertAdjacentHTML\(/.test(line)) { // SAFE: audit regex scanning source for banned token
			failLine(file, lineNumber, line, `insertAdjacentHTML is banned.`);
		}

		// Deprecated workspace.activeLeaf.
		if (/workspace\.activeLeaf\b/.test(line)) {
			failLine(file, lineNumber, line, `workspace.activeLeaf is deprecated — use getActiveViewOfType / getActiveFile.`);
		}

		// moment() used directly (should use window.moment through obsidian).
		if (/^\s*import\s+moment\b|from ['"]moment['"]/.test(line)) {
			failLine(file, lineNumber, line, `Do not import moment directly — use window.moment or import from "obsidian".`);
		}
	});

	// Block-scope scan for addCommand({ name: "..." }) checking for plugin-name prefix.
	const commandNameRegex = /addCommand\(\s*\{[\s\S]*?name:\s*(['"`])([^'"`]+)\1/g;
	let commandMatch;
	while ((commandMatch = commandNameRegex.exec(text)) !== null) {
		const name = commandMatch[2];
		if (/\beditorialist\b/i.test(name)) {
			const lineNumber = text.slice(0, commandMatch.index).split(/\r?\n/).length;
			failLine(file, lineNumber, `addCommand(... name: "${name}" ...)`, `Command name "${name}" must not include the plugin name — Obsidian prefixes it automatically.`);
		}
	}
}

// ---------- report ----------
if (warnings.length > 0) {
	console.log("\n[compliance] Warnings:");
	for (const w of warnings) {
		console.log(`  ⚠️  ${w}`);
	}
}

if (hasError) {
	console.error("\n[compliance] FAILED — fix blockers before submitting.");
	process.exit(1);
}

console.log("Obsidian submission compliance passed.");

// ---------- helpers ----------
function failLine(file, lineNumber, line, message) {
	hasError = true;
	const rel = path.relative(ROOT, file);
	console.error(`\n[compliance] ${rel}:${lineNumber}`);
	console.error(`  ❌ ${message}`);
	console.error(`  ${line.trim()}`);
}

// Returns a Set of 1-indexed line numbers that fall inside an onunload() body.
// Uses brace counting starting from the `onunload(` signature line.
function collectOnunloadLineNumbers(lines) {
	const inside = new Set();
	for (let i = 0; i < lines.length; i++) {
		if (!/\bonunload\s*\(/.test(lines[i])) continue;
		// Walk forward to find the opening brace.
		let j = i;
		while (j < lines.length && !lines[j].includes("{")) j++;
		if (j >= lines.length) continue;
		let depth = 0;
		let started = false;
		for (let k = j; k < lines.length; k++) {
			for (const ch of lines[k]) {
				if (ch === "{") { depth++; started = true; }
				else if (ch === "}") { depth--; }
			}
			if (started) inside.add(k + 1);
			if (started && depth === 0) break;
		}
	}
	return inside;
}

function collectSources(dir) {
	if (!fs.existsSync(dir)) return [];
	const results = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectSources(full));
		} else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			results.push(full);
		}
	}
	return results;
}
