export const REVIEW_BLOCK_FENCE = "editorialist-review";
const REVIEW_SECTION_PATTERN = /^===\s*(EDIT|MOVE|CUT|CONDENSE)\s*===\s*$/im;
const REVIEW_METADATA_PATTERN = /^(Reviewer|ReviewerType|Provider|Model)\s*:/im;
const GENERAL_FIELD_PATTERN = /^([A-Za-z][A-Za-z ]+):\s*(.*)$/;
const REVIEW_METADATA_KEYS = new Set(["reviewer", "reviewertype", "provider", "model"]);

export interface ExtractedReviewBlock {
	bodyText: string;
	endOffset: number;
	source: "fenced" | "raw";
	startOffset: number;
}

export function createReviewBlockPattern(): RegExp {
	return new RegExp(
		`(?:^|\\n)\`\`\`${REVIEW_BLOCK_FENCE}[^\\S\\r\\n]*\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\``,
		"g",
	);
}

function createGenericFencePattern(): RegExp {
	return /(?:^|\n)```([^\r\n`]*)[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/g;
}

export function createReviewBlock(bodyText: string): string {
	return `\`\`\`${REVIEW_BLOCK_FENCE}\n${bodyText.trim()}\n\`\`\``;
}

export function noteContainsReviewBlock(noteText: string): boolean {
	return extractReviewBlocks(noteText).length > 0;
}

export function normalizeImportedReviewText(rawText: string): string | null {
	const extractedBlocks = extractReviewBlocks(rawText);
	if (extractedBlocks.length === 0) {
		return null;
	}

	const [firstBlock] = extractedBlocks;
	if (!firstBlock) {
		return null;
	}

	if (firstBlock.source === "fenced") {
		return rawText.trim();
	}

	return createReviewBlock(firstBlock.bodyText);
}

export function getReviewBlockFenceLabel(): string {
	return `${REVIEW_BLOCK_FENCE} block`;
}

export function extractReviewBlocks(noteText: string): ExtractedReviewBlock[] {
	const trimmed = noteText.trim();
	if (!trimmed) {
		return [];
	}

	const fencedBlocks = extractFencedBlocks(noteText);
	if (fencedBlocks.length > 0) {
		return fencedBlocks;
	}

	const unfencedBody = unwrapPlainCodeFence(trimmed);
	const rawBlock = extractRawTopReviewBlock(unfencedBody);
	return rawBlock ? [rawBlock] : [];
}

function unwrapPlainCodeFence(rawText: string): string {
	const match = rawText.match(/^```(?:[^\n`]*)?\r?\n([\s\S]*?)\r?\n```$/);
	return match?.[1]?.trim() ?? rawText;
}

function extractFencedBlocks(noteText: string): ExtractedReviewBlock[] {
	const blocks: ExtractedReviewBlock[] = [];
	const seenRanges = new Set<string>();

	for (const blockMatch of noteText.matchAll(createGenericFencePattern())) {
		const rawBody = blockMatch[2];
		const fullMatch = blockMatch[0];
		const blockStart = blockMatch.index;
		if (rawBody === undefined || !fullMatch || blockStart === undefined) {
			continue;
		}

		const bodyStartOffset = fullMatch.indexOf(rawBody);
		if (bodyStartOffset === -1) {
			continue;
		}

		const trimmedBody = rawBody.trim();
		if (!looksLikeReviewBody(trimmedBody)) {
			continue;
		}

		const bodyStart = blockStart + bodyStartOffset;
		const rangeKey = `${bodyStart}:${blockStart + fullMatch.length}`;
		if (seenRanges.has(rangeKey)) {
			continue;
		}

		seenRanges.add(rangeKey);
		blocks.push({
			bodyText: rawBody,
			startOffset: bodyStart,
			endOffset: blockStart + fullMatch.length,
			source: "fenced",
		});
	}

	return blocks;
}

function extractRawTopReviewBlock(noteText: string): ExtractedReviewBlock | null {
	const lines = getLinesWithOffsets(noteText, 0);
	if (lines.length === 0) {
		return null;
	}

	let startIndex = 0;
	while (startIndex < lines.length && lines[startIndex]?.text.trim() === "") {
		startIndex += 1;
	}

	const firstLine = lines[startIndex];
	if (!firstLine) {
		return null;
	}

	const firstTrimmed = firstLine.text.trim();
	if (!REVIEW_METADATA_PATTERN.test(firstTrimmed) && !REVIEW_SECTION_PATTERN.test(firstTrimmed)) {
		return null;
	}

	let sawSection = false;
	let currentField: string | null = null;
	let endOffset = firstLine.endOffset;
	let lastIncludedIndex = startIndex - 1;

	for (let index = startIndex; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line) {
			continue;
		}

		const trimmed = line.text.trim();
		if (trimmed === "") {
			if (sawSection) {
				currentField = null;
			}
			lastIncludedIndex = index;
			endOffset = line.endOffset;
			continue;
		}

		if (REVIEW_SECTION_PATTERN.test(trimmed)) {
			sawSection = true;
			currentField = null;
			lastIncludedIndex = index;
			endOffset = line.endOffset;
			continue;
		}

		const fieldMatch = trimmed.match(GENERAL_FIELD_PATTERN);
		if (!sawSection) {
			if (fieldMatch && REVIEW_METADATA_KEYS.has(normalizeFieldKey(fieldMatch[1] ?? ""))) {
				lastIncludedIndex = index;
				endOffset = line.endOffset;
				continue;
			}
			break;
		}

		if (fieldMatch) {
			currentField = normalizeFieldKey(fieldMatch[1] ?? "");
			lastIncludedIndex = index;
			endOffset = line.endOffset;
			continue;
		}

		if (currentField) {
			lastIncludedIndex = index;
			endOffset = line.endOffset;
			continue;
		}

		break;
	}

	if (!sawSection || lastIncludedIndex < startIndex) {
		return null;
	}

	const bodyText = noteText.slice(firstLine.startOffset, endOffset).trim();
	if (!bodyText) {
		return null;
	}

	return {
		bodyText,
		startOffset: firstLine.startOffset,
		endOffset,
		source: "raw",
	};
}

function looksLikeReviewBody(text: string): boolean {
	if (!text.trim()) {
		return false;
	}

	const rawBlock = extractRawTopReviewBlock(text);
	return rawBlock !== null && rawBlock.startOffset === 0 && rawBlock.bodyText.trim() === text.trim();
}

function getLinesWithOffsets(text: string, baseOffset: number): Array<{ endOffset: number; startOffset: number; text: string }> {
	const lines: Array<{ endOffset: number; startOffset: number; text: string }> = [];
	const linePattern = /.*(?:\r?\n|$)/g;
	let match: RegExpExecArray | null;

	while ((match = linePattern.exec(text)) !== null) {
		const rawLine = match[0];
		if (rawLine.length === 0) {
			break;
		}

		const newlineMatch = rawLine.match(/\r?\n$/);
		const newlineLength = newlineMatch?.[0].length ?? 0;
		const textOnly = newlineLength > 0 ? rawLine.slice(0, -newlineLength) : rawLine;
		const startOffset = baseOffset + match.index;
		const endOffset = startOffset + textOnly.length;

		lines.push({
			text: textOnly,
			startOffset,
			endOffset,
		});

		if (linePattern.lastIndex >= text.length) {
			break;
		}
	}

	return lines;
}

function normalizeFieldKey(value: string): string {
	return value.toLowerCase().replace(/\s+/g, "");
}
