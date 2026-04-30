import { normalizeReviewPaste } from "./PasteNormalizer";
import { getLinesWithOffsets } from "./TextOffsets";

export const REVIEW_BLOCK_FENCE = "editorialist-review";
const REVIEW_SECTION_PATTERN = /^\s*(?:={2,}|-{2,}|#{1,6}|\*{1,3}|\[)\s*(EDIT|MOVE|CUT|CONDENSE|MEMO)\s*(?:={2,}|-{2,}|#{1,6}|\*{1,3}|\])?\s*$/im;
const REVIEW_METADATA_PATTERN =
	/^(BatchId|ImportedBy|Template|TemplateYear|SupportedOperations|SceneIdSource|Reviewer|ReviewerType|Provider|Model)\s*:/im;
const GENERAL_FIELD_PATTERN = /^([A-Za-z][A-Za-z ]+):\s*(.*)$/;
// Decorative dividers some LLMs emit between sections (e.g. `⸻`, `---`, `***`,
// `═══`). Detected as a line of punctuation/symbol characters with no letters
// or digits — skipped without terminating the raw block.
const DIVIDER_LINE_PATTERN = /^[^\p{L}\p{N}]+$/u;
const REVIEW_METADATA_KEYS = new Set([
	"batchid",
	"importedby",
	"template",
	"templateyear",
	"supportedoperations",
	"sceneidsource",
	"reviewer",
	"reviewertype",
	"provider",
	"model",
]);

export interface ExtractedReviewBlock {
	bodyText: string;
	endOffset: number;
	source: "fenced" | "raw";
	startOffset: number;
}

export interface ImportedReviewBlock extends ExtractedReviewBlock {
	batchId?: string;
	importedBy?: string;
}

export interface RemoveImportedReviewBlocksResult {
	batchIds: string[];
	removedCount: number;
	text: string;
}

export interface StripReviewBlocksResult {
	removedCount: number;
	text: string;
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
	const candidates = [rawText, normalizeReviewPaste(rawText)];
	for (const candidate of candidates) {
		if (!candidate || !candidate.trim()) {
			continue;
		}

		const extractedBlocks = extractReviewBlocks(candidate);
		const firstBlock = extractedBlocks[0];
		if (!firstBlock) {
			continue;
		}

		if (firstBlock.source === "fenced") {
			return candidate.trim();
		}

		return createReviewBlock(firstBlock.bodyText);
	}

	return null;
}

export function getReviewBlockFenceLabel(): string {
	return `${REVIEW_BLOCK_FENCE} block`;
}

export function getReviewBlockMetadata(bodyText: string): Record<string, string> {
	const metadata: Record<string, string> = {};
	for (const line of bodyText.split(/\r?\n/)) {
		const match = line.trim().match(GENERAL_FIELD_PATTERN);
		if (!match) {
			if (REVIEW_SECTION_PATTERN.test(line.trim())) {
				break;
			}
			continue;
		}

		const key = normalizeFieldKey(match[1] ?? "");
		if (!REVIEW_METADATA_KEYS.has(key)) {
			if (REVIEW_SECTION_PATTERN.test(line.trim())) {
				break;
			}
			continue;
		}

		metadata[key] = (match[2] ?? "").trim();
	}

	return metadata;
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

export function findImportedReviewBlocks(noteText: string, batchId?: string): ImportedReviewBlock[] {
	return extractReviewBlocks(noteText)
		.map((block) => {
			const metadata = getReviewBlockMetadata(block.bodyText);
			return {
				...block,
				batchId: metadata.batchid,
				importedBy: metadata.importedby,
			};
		})
		.filter((block) => {
			if (block.importedBy !== "Editorialist") {
				return false;
			}

			return batchId ? block.batchId === batchId : true;
		});
}

export function removeImportedReviewBlocks(noteText: string, batchId?: string): RemoveImportedReviewBlocksResult {
	const blocks = findImportedReviewBlocks(noteText, batchId).sort((left, right) => right.startOffset - left.startOffset);
	if (blocks.length === 0) {
		return {
			batchIds: [],
			removedCount: 0,
			text: noteText,
		};
	}

	let nextText = noteText;
	for (const block of blocks) {
		nextText = nextText.slice(0, block.startOffset) + nextText.slice(block.endOffset);
	}

	return {
		batchIds: [...new Set(blocks.map((block) => block.batchId).filter((value): value is string => Boolean(value)))],
		removedCount: blocks.length,
		text: normalizeRemovedReviewSpacing(nextText),
	};
}

export function stripAllReviewBlocks(noteText: string): StripReviewBlocksResult {
	const blocks = extractReviewBlocks(noteText).sort((left, right) => right.startOffset - left.startOffset);
	if (blocks.length === 0) {
		return {
			removedCount: 0,
			text: noteText,
		};
	}

	let nextText = noteText;
	for (const block of blocks) {
		nextText = nextText.slice(0, block.startOffset) + nextText.slice(block.endOffset);
	}

	return {
		removedCount: blocks.length,
		text: normalizeRemovedReviewSpacing(nextText),
	};
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

		const rangeKey = `${blockStart}:${blockStart + fullMatch.length}`;
		if (seenRanges.has(rangeKey)) {
			continue;
		}

		seenRanges.add(rangeKey);
		blocks.push({
			bodyText: rawBody,
			startOffset: blockStart,
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

	for (let startIndex = 0; startIndex < lines.length; startIndex += 1) {
		const firstLine = lines[startIndex];
		if (!firstLine || firstLine.text.trim() === "") {
			continue;
		}

		const firstTrimmed = firstLine.text.trim();
		if (!REVIEW_METADATA_PATTERN.test(firstTrimmed) && !REVIEW_SECTION_PATTERN.test(firstTrimmed)) {
			continue;
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
				// Permissive sentinel: section bodies (especially MEMO) may contain
				// prose lines without the Field: pattern. Treat them as continuation
				// content rather than terminating the block.
				currentField = "__section_body__";
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

			// Decorative divider between sections — skip without ending the block.
			if (DIVIDER_LINE_PATTERN.test(trimmed)) {
				lastIncludedIndex = index;
				endOffset = line.endOffset;
				continue;
			}

			break;
		}

		if (!sawSection || lastIncludedIndex < startIndex) {
			continue;
		}

		const bodyText = noteText.slice(firstLine.startOffset, endOffset).trim();
		if (!bodyText) {
			continue;
		}

		return {
			bodyText,
			startOffset: firstLine.startOffset,
			endOffset,
			source: "raw",
		};
	}

	return null;
}

function looksLikeReviewBody(text: string): boolean {
	if (!text.trim()) {
		return false;
	}

	const rawBlock = extractRawTopReviewBlock(text);
	return rawBlock !== null && rawBlock.startOffset === 0 && rawBlock.bodyText.trim() === text.trim();
}

function normalizeRemovedReviewSpacing(text: string): string {
	const collapsed = text
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n");

	return collapsed.trimEnd().length > 0 ? `${collapsed.trimEnd()}\n` : "";
}

function normalizeFieldKey(value: string): string {
	return value.toLowerCase().replace(/\s+/g, "");
}
