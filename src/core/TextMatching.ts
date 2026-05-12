export function findExactMatches(noteText: string, text: string): number[] {
	if (!text) {
		return [];
	}

	const matches: number[] = [];
	let searchFrom = 0;

	while (searchFrom < noteText.length) {
		const index = noteText.indexOf(text, searchFrom);
		if (index === -1) {
			break;
		}

		matches.push(index);
		searchFrom = index + text.length;
	}

	return matches;
}

export function normalizeMatchText(value: string): string {
	return value.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

interface FuzzyMatchRange {
	startOffset: number;
	endOffset: number;
}

// Returns offsets in the raw note text where the target appears under
// quote/dash/whitespace-tolerant matching. Used as a fallback when byte-exact
// match fails — most commonly because the AI emitted curly quotes/apostrophes
// while the manuscript has straight ones (or vice versa).
export function findFuzzyMatches(noteText: string, text: string): FuzzyMatchRange[] {
	if (!text || !noteText) {
		return [];
	}
	const pattern = buildFuzzyMatchPattern(text);
	if (!pattern) {
		return [];
	}
	const ranges: FuzzyMatchRange[] = [];
	const regex = new RegExp(pattern, "g");
	let match: RegExpExecArray | null;
	while ((match = regex.exec(noteText)) !== null) {
		if (match[0].length === 0) {
			regex.lastIndex += 1;
			continue;
		}
		ranges.push({ startOffset: match.index, endOffset: match.index + match[0].length });
	}
	return ranges;
}

const REGEX_META_CHARS = /[.*+?^${}()|[\]\\]/g;

function buildFuzzyMatchPattern(text: string): string | null {
	// Collapse runs of whitespace in the target so they map to `\s+` in the
	// pattern. Then escape regex meta chars and replace the placeholder runs
	// of single spaces with `\s+`. Quote and dash variants get character classes.
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (!collapsed) {
		return null;
	}
	let out = "";
	for (const char of collapsed) {
		if (char === " ") {
			out += "\\s+";
			continue;
		}
		if (char === "'" || char === "‘" || char === "’" || char === "ʼ") {
			out += "['‘’ʼ]";
			continue;
		}
		if (char === "\"" || char === "“" || char === "”") {
			out += "[\"“”]";
			continue;
		}
		if (char === "-" || char === "–" || char === "—" || char === "−") {
			out += "[-–—−]";
			continue;
		}
		out += char.replace(REGEX_META_CHARS, "\\$&");
	}
	return out;
}

export function countNormalizedMatches(noteText: string, text: string): number {
	const normalizedText = normalizeMatchText(noteText);
	const normalizedTarget = normalizeMatchText(text);
	if (!normalizedText || !normalizedTarget) {
		return 0;
	}

	let count = 0;
	let searchFrom = 0;
	while (searchFrom < normalizedText.length) {
		const index = normalizedText.indexOf(normalizedTarget, searchFrom);
		if (index === -1) {
			break;
		}

		count += 1;
		searchFrom = index + normalizedTarget.length;
	}

	return count;
}
