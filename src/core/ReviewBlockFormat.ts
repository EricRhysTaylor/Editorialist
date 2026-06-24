import { normalizeReviewPaste } from "./PasteNormalizer";
import {
	REVIEW_FIELD_PATTERN as GENERAL_FIELD_PATTERN,
	REVIEW_METADATA_KEYS,
	REVIEW_SECTION_HEADER_PATTERN as REVIEW_SECTION_PATTERN,
	normalizeReviewFieldKey,
} from "./ReviewBlockGrammar";
import { getLinesWithOffsets } from "./TextOffsets";

export const REVIEW_BLOCK_FENCE = "editorialist-review";
const REVIEW_METADATA_PATTERN =
	/^(BatchId|ImportedBy|ImportedAt|Template|TemplateYear|SupportedOperations|SceneIdSource|Reviewer|ReviewerType|Provider|Model)\s*:/im;
// Decorative dividers some LLMs emit between sections (e.g. `⸻`, `---`, `***`,
// `═══`). Detected as a line of punctuation/symbol characters with no letters
// or digits — skipped without terminating the raw block.
const DIVIDER_LINE_PATTERN = /^[^\p{L}\p{N}]+$/u;

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

		const key = normalizeReviewFieldKey(match[1] ?? "");
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

// The standing of a single review block found inside a note, judged purely from
// its metadata stamp:
//   registered  — carries `ImportedBy: Editorialist` AND a `BatchId`. A block
//                  Editorialist itself wrote on import; resume, never re-import.
//   unimported  — carries neither stamp. A raw block an AI (or the author) wrote
//                  straight into the note; a candidate for in-place formalizing.
//   suspicious  — carries exactly one half of the stamp (a `BatchId` with no
//                  `ImportedBy`, or vice versa). Neither a clean raw block nor a
//                  trustworthy registered one, so it is never auto-handled.
type ReviewBlockRegistration = "registered" | "unimported" | "suspicious";

function classifyReviewBlock(block: ExtractedReviewBlock): ReviewBlockRegistration {
	const metadata = getReviewBlockMetadata(block.bodyText);
	const hasBatchId = Boolean(metadata.batchid);
	const isEditorialist = metadata.importedby === "Editorialist";
	if (hasBatchId && isEditorialist) {
		return "registered";
	}
	if (hasBatchId || isEditorialist) {
		return "suspicious";
	}
	return "unimported";
}

// The note-level summary the launcher uses to decide which import affordance to
// surface. `ambiguous` deliberately collapses every case where acting would be a
// guess: a half-stamped block, or more than one raw block (we cannot know which
// one the author meant to formalize).
export type NoteReviewBlockState = "none" | "registered" | "unimported" | "ambiguous";

export function classifyNoteReviewBlocks(noteText: string): NoteReviewBlockState {
	const kinds = extractReviewBlocks(noteText).map(classifyReviewBlock);
	if (kinds.length === 0) {
		return "none";
	}
	if (kinds.includes("suspicious")) {
		return "ambiguous";
	}
	const unimported = kinds.filter((kind) => kind === "unimported");
	if (unimported.length === 0) {
		return "registered";
	}
	if (unimported.length > 1) {
		return "ambiguous";
	}
	return "unimported";
}

// The single raw block eligible for in-place formalizing. Returns null unless the
// note classifies exactly as `unimported` (one raw block, no suspicious stamps),
// so the formalize path never has to choose between candidates.
export function findUnimportedReviewBlock(noteText: string): ExtractedReviewBlock | null {
	if (classifyNoteReviewBlocks(noteText) !== "unimported") {
		return null;
	}
	return extractReviewBlocks(noteText).find((block) => classifyReviewBlock(block) === "unimported") ?? null;
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
				// Inside a section body, blank lines are paragraph breaks — they do
				// NOT terminate the field continuation. Keeping currentField intact
				// lets memo sections contain bullet lists, multi-paragraph prose,
				// and dividers without dropping out of the block.
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
				// Any leading `Key: value` line counts as block header — recognized
				// metadata or not. An unknown header key (e.g. ImportedAt, or a future
				// addition) must not truncate the header and drop BatchId/ImportedBy;
				// a real block still has to reach a === SECTION === to be returned
				// (the sawSection guard below), so this stays conservative.
				if (fieldMatch) {
					lastIncludedIndex = index;
					endOffset = line.endOffset;
					continue;
				}
				break;
			}

			if (fieldMatch) {
				currentField = normalizeReviewFieldKey(fieldMatch[1] ?? "");
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
