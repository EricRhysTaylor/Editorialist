/**
 * CSS drift checker for Editorialist.
 *
 * Scope: a single styles.css. Checks for token-discipline regressions:
 *   - !important usage (fail)
 *   - Global element selectors (fail)
 *   - Raw hex colors outside CSS variable definitions (tracked against a baseline)
 *   - Raw rgb()/rgba()/hsl()/hsla() values outside variable definitions (tracked against a baseline)
 *
 * Modes:
 *   --strict       Every warning fails.
 *   --maintenance  (default) Warnings allowed up to baseline count per rule. Regressions fail.
 *   --write-baseline Rewrite baseline to current state.
 *
 * Run:
 *   node scripts/css-drift-check.mjs              # maintenance
 *   node scripts/css-drift-check.mjs --strict
 *   node scripts/css-drift-check.mjs --write-baseline
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CSS_FILES = ["styles.css"].map((p) => path.join(ROOT, p)).filter((p) => fs.existsSync(p));
const BASELINE_PATH = path.join(ROOT, "scripts/css-drift-baseline.json");

const args = new Set(process.argv.slice(2));
const MODE = args.has("--strict") ? "strict" : "maintenance";
const WRITE_BASELINE = args.has("--write-baseline");

const fails = [];
const warnings = [];

function buildLineIndex(text) {
	const starts = [0];
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === "\n") starts.push(i + 1);
	}
	return starts;
}

function getLineNumber(lineStarts, index) {
	let low = 0;
	let high = lineStarts.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (lineStarts[mid] <= index) {
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return high + 1;
}

function findAll(re, text) {
	const hits = [];
	let m;
	while ((m = re.exec(text))) hits.push(m);
	return hits;
}

function pushFail(file, rule, line, sample, message) {
	fails.push({ file: path.relative(ROOT, file), rule, line, sample, message });
}

function pushWarn(file, rule, line, sample, message) {
	warnings.push({ file: path.relative(ROOT, file), rule, line, sample, message });
}

for (const file of CSS_FILES) {
	const css = fs.readFileSync(file, "utf8");
	const lineStarts = buildLineIndex(css);

	for (const m of findAll(/!important\b/g, css)) {
		pushFail(file, "important", getLineNumber(lineStarts, m.index), "!important", "Use of !important is banned.");
	}

	const globalSelectorRe = /(^|\n)\s*(\*|html|body|button|input|select|textarea)\s*\{/g;
	for (const m of findAll(globalSelectorRe, css)) {
		pushFail(
			file,
			"global-element",
			getLineNumber(lineStarts, m.index),
			`${m[2]} {`,
			"Global element selector bleeds outside the plugin. Scope under an editorialist-* class.",
		);
	}

	const lines = css.split("\n");
	lines.forEach((line, idx) => {
		const lineNumber = idx + 1;
		const isVarDefinition = /--[a-zA-Z0-9-_]+\s*:/.test(line);

		if (/#[0-9a-fA-F]{3,8}\b/.test(line) && !isVarDefinition) {
			pushWarn(file, "raw-hex", lineNumber, line.trim(), "Raw hex color outside a --var definition.");
		}

		if (/\b(rgb|rgba|hsl|hsla)\s*\(/.test(line) && !isVarDefinition) {
			pushWarn(file, "raw-color-fn", lineNumber, line.trim(), "Raw rgb()/hsl() outside a --var definition.");
		}
	});
}

const warningsByRule = warnings.reduce((acc, w) => {
	acc[w.rule] = (acc[w.rule] || 0) + 1;
	return acc;
}, {});

const currentState = {
	generatedAt: new Date().toISOString().slice(0, 10),
	totalWarnings: warnings.length,
	warningsByRule,
};

if (WRITE_BASELINE) {
	fs.writeFileSync(
		BASELINE_PATH,
		JSON.stringify({ maintenance: currentState }, null, 2) + "\n",
		"utf8",
	);
	console.log(`[css-drift] Baseline written: total ${warnings.length} warning(s) across ${Object.keys(warningsByRule).length} rule(s).`);
	process.exit(fails.length > 0 ? 1 : 0);
}

let baseline = null;
if (fs.existsSync(BASELINE_PATH)) {
	try {
		const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
		baseline = raw?.maintenance || null;
	} catch {
		baseline = null;
	}
}

if (fails.length > 0) {
	console.error("[css-drift] FAIL");
	for (const f of fails) {
		console.error(`  ${f.file}:${f.line}  (${f.rule})  ${f.message}\n    ${f.sample}`);
	}
}

if (MODE === "strict") {
	for (const w of warnings) {
		console.error(`  ${w.file}:${w.line}  (${w.rule})  ${w.message}\n    ${w.sample}`);
	}
	if (warnings.length > 0 || fails.length > 0) {
		console.error(`\n[css-drift] ${fails.length} fail + ${warnings.length} warning (strict mode).`);
		process.exit(1);
	}
	console.log("[css-drift] strict: clean.");
	process.exit(0);
}

// Maintenance mode: compare against baseline
const regressions = [];
if (baseline) {
	for (const rule of Object.keys(warningsByRule)) {
		const current = warningsByRule[rule];
		const prior = baseline.warningsByRule?.[rule] ?? 0;
		if (current > prior) {
			regressions.push({ rule, current, prior, delta: current - prior });
		}
	}
} else {
	console.warn("[css-drift] No baseline file. Run with --write-baseline to seed one.");
}

if (regressions.length > 0) {
	console.error("[css-drift] REGRESSION vs baseline:");
	for (const r of regressions) {
		console.error(`  ${r.rule}: ${r.prior} -> ${r.current}  (+${r.delta})`);
	}
}

const shouldFail = fails.length > 0 || regressions.length > 0;
if (shouldFail) {
	process.exit(1);
}

if (baseline) {
	const deltas = Object.keys(warningsByRule)
		.map((rule) => {
			const prior = baseline.warningsByRule?.[rule] ?? 0;
			return `${rule}: ${warningsByRule[rule]}/${prior}`;
		})
		.join(", ");
	console.log(`[css-drift] maintenance: clean. ${deltas || "no warnings"}`);
} else {
	console.log("[css-drift] maintenance: clean (no baseline).");
}
