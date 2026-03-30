import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CSS_FILES = collectCssFiles(ROOT);

const ALLOWED_ROOT_CLASSES = [".editorialist-", ".ert-"];

const DISALLOWED_BARE_SELECTORS = new Set([
	"button",
	"input",
	"select",
	"textarea",
	"label",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"p",
	"ul",
	"ol",
	"li",
]);

const SUSPICIOUS_GLOBAL_SELECTORS = [
	".modal",
	".menu",
	".workspace-leaf",
	".workspace-tabs",
	".view-content",
	".markdown-source-view",
	".cm-editor",
	".cm-content",
	".cm-line",
	".setting-item",
];

let hasError = false;

for (const file of CSS_FILES) {
	const css = fs.readFileSync(file, "utf8");
	const blocks = extractSelectorBlocks(css);

	for (const block of blocks) {
		const selectors = splitSelectors(block.selector);

		for (const selector of selectors) {
			auditSelector(file, selector.trim());
		}
	}
}

if (hasError) {
	process.exit(1);
}

console.log("CSS audit passed.");

function auditSelector(file, selector) {
	if (!selector || selector.startsWith("@")) {
		return;
	}

	const normalized = selector.replace(/\s+/g, " ").trim();

	checkBareSelector(file, normalized);
	checkSuspiciousGlobals(file, normalized);
	checkUnprefixedClasses(file, normalized);
}

function checkBareSelector(file, selector) {
	const firstToken = selector
		.replace(/::?[a-zA-Z-]+(\(.+?\))?/g, "")
		.trim()
		.split(/[\s>+~]+/)[0];

	if (!firstToken) {
		return;
	}

	if (DISALLOWED_BARE_SELECTORS.has(firstToken)) {
		fail(
			file,
			selector,
			`Bare element selector "${firstToken}" is not allowed. Scope it under an Editorialist root class.`,
		);
	}
}

function checkSuspiciousGlobals(file, selector) {
	for (const suspicious of SUSPICIOUS_GLOBAL_SELECTORS) {
		if (selector.includes(suspicious) && !hasEditorialistScope(selector)) {
			fail(
				file,
				selector,
				`Suspicious global selector "${suspicious}" must be scoped under an Editorialist root class.`,
			);
		}
	}
}

function checkUnprefixedClasses(file, selector) {
	const classMatches = selector.match(/\.[a-zA-Z0-9_-]+/g) || [];
	for (const className of classMatches) {
		if (
			className.startsWith(".editorialist-") ||
			className.startsWith(".ert-") ||
			className.startsWith(".is-") ||
			className.startsWith(".mod-") ||
			className.startsWith(".theme-")
		) {
			continue;
		}

		if (SUSPICIOUS_GLOBAL_SELECTORS.includes(className)) {
			continue;
		}

		fail(
			file,
			selector,
			`Unprefixed class "${className}" found. Editorialist-owned classes must use the "editorialist-" prefix, or the canonical "ert-" archetype prefix.`,
		);
	}
}

function hasEditorialistScope(selector) {
	return ALLOWED_ROOT_CLASSES.some((prefix) => selector.includes(prefix));
}

function fail(file, selector, message) {
	hasError = true;
	console.error(`\n[css-audit] ${path.relative(ROOT, file)}`);
	console.error(`  Selector: ${selector}`);
	console.error(`  Error: ${message}`);
}

function collectCssFiles(dir) {
	const results = [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });

	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
			continue;
		}

		const fullPath = path.join(dir, entry.name);

		if (entry.isDirectory()) {
			results.push(...collectCssFiles(fullPath));
			continue;
		}

		if (entry.isFile() && entry.name.endsWith(".css")) {
			results.push(fullPath);
		}
	}

	return results;
}

function extractSelectorBlocks(css) {
	const results = [];
	const regex = /([^{}]+)\{/g;
	let match;

	while ((match = regex.exec(css)) !== null) {
		const selector = match[1]?.trim();

		if (
			!selector ||
			selector.startsWith("@") ||
			selector.includes("from") ||
			selector.includes("to") ||
			/^\d+%/.test(selector)
		) {
			continue;
		}

		results.push({ selector });
	}

	return results;
}

function splitSelectors(selectorGroup) {
	return selectorGroup
		.split(",")
		.map((selector) => selector.trim())
		.filter(Boolean);
}
