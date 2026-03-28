import type {
	ParsedReviewDocument,
	ReviewOperationType,
	ReviewPlacement,
	ReviewSuggestion,
	ReviewSourceRef,
} from "../models/ReviewSuggestion";
import type { ParsedReviewerReference } from "../models/ReviewerProfile";
import type { ReviewerDirectory } from "../state/ReviewerDirectory";

const REVIEW_BLOCK_PATTERN = /```rt-review\s*([\s\S]*?)```/g;
const SECTION_HEADER_PATTERN = /^===\s*(EDIT|MOVE)\s*===\s*$/i;
const FIELD_PATTERN = /^([A-Za-z][A-Za-z ]+):\s*(.*)$/;

type LineWithOffsets = { endOffset: number; startOffset: number; text: string };

interface SectionBuffer {
	entryIndex: number;
	endOffset: number;
	lines: LineWithOffsets[];
	operation: ReviewOperationType;
	startOffset: number;
}

interface BlockMetadata {
	rawReviewer: ParsedReviewerReference;
}

export class SuggestionParser {
	constructor(private readonly reviewerDirectory: ReviewerDirectory) {}

	parse(noteText: string): ParsedReviewDocument {
		const suggestions: ReviewSuggestion[] = [];
		const blocks = [...noteText.matchAll(REVIEW_BLOCK_PATTERN)];

		blocks.forEach((blockMatch, blockIndex) => {
			const rawBody = blockMatch[1];
			const fullMatch = blockMatch[0];
			const blockStart = blockMatch.index;
			if (rawBody === undefined || !fullMatch || blockStart === undefined) {
				return;
			}

			const bodyStartOffset = fullMatch.indexOf(rawBody);
			if (bodyStartOffset === -1) {
				return;
			}

			const bodyStart = blockStart + bodyStartOffset;
			const blockEnd = blockStart + fullMatch.length;
			const lines = this.getLinesWithOffsets(rawBody, bodyStart);
			const metadata = this.parseBlockMetadata(lines, blockIndex);
			const sections = this.extractSections(lines, blockEnd);

			sections.forEach((section) => {
				const suggestion = this.parseSection(section, blockIndex, metadata);
				if (suggestion) {
					suggestions.push(suggestion);
				}
			});
		});

		return {
			blockCount: blocks.length,
			suggestions,
		};
	}

	private parseBlockMetadata(lines: LineWithOffsets[], _blockIndex: number): BlockMetadata {
		let reviewer = "Unknown reviewer";
		let reviewerType = "author";
		let provider: string | undefined;
		let model: string | undefined;

		for (const line of lines) {
			if (SECTION_HEADER_PATTERN.test(line.text.trim())) {
				break;
			}

			const fieldMatch = line.text.trim().match(FIELD_PATTERN);
			if (!fieldMatch) {
				continue;
			}

			const rawKey = fieldMatch[1];
			if (!rawKey) {
				continue;
			}

			const key = this.normalizeFieldName(rawKey);
			const value = fieldMatch[2]?.trim();
			if (!value) {
				continue;
			}

			if (key === "reviewer") {
				reviewer = value;
			} else if (key === "reviewertype") {
				reviewerType = value;
			} else if (key === "provider") {
				provider = value;
			} else if (key === "model") {
				model = value;
			}
		}

		return {
			rawReviewer: {
				rawName: reviewer,
				rawType: reviewerType,
				rawProvider: provider,
				rawModel: model,
			},
		};
	}

	private extractSections(lines: LineWithOffsets[], blockEnd: number): SectionBuffer[] {
		const sections: SectionBuffer[] = [];
		let currentSection: SectionBuffer | null = null;
		let entryIndex = 0;

		for (const line of lines) {
			const headerMatch = line.text.trim().match(SECTION_HEADER_PATTERN);
			if (headerMatch) {
				if (currentSection) {
					currentSection.endOffset = line.startOffset;
					sections.push(currentSection);
				}

				entryIndex += 1;
				currentSection = {
					entryIndex,
					endOffset: blockEnd,
					lines: [],
					operation: headerMatch[1]?.toLowerCase() === "move" ? "move" : "replace",
					startOffset: line.startOffset,
				};
				continue;
			}

			currentSection?.lines.push(line);
		}

		if (currentSection) {
			sections.push(currentSection);
		}

		return sections;
	}

	private parseSection(section: SectionBuffer, blockIndex: number, metadata: BlockMetadata): ReviewSuggestion | null {
		const fields = this.collectFields(section.lines);
		const source: ReviewSourceRef = {
			blockIndex,
			entryIndex: section.entryIndex - 1,
			startOffset: section.startOffset,
			endOffset: section.endOffset,
		};

		if (section.operation === "replace") {
			const original = this.cleanField(fields.get("original"));
			const revised = this.cleanField(fields.get("revised"));
			if (!original || !revised) {
				return null;
			}

			return {
				id: `review-${blockIndex + 1}-${section.entryIndex}`,
				operation: "replace",
				contributor: this.reviewerDirectory.resolveContributor(metadata.rawReviewer),
				source,
				original,
				revised,
				why: this.cleanField(fields.get("why")),
				status: "pending",
			};
		}

		if (section.operation === "move") {
			const target = this.cleanField(fields.get("target"));
			const before = this.cleanField(fields.get("before"));
			const after = this.cleanField(fields.get("after"));
			if (!target || (!before && !after) || (before && after)) {
				return null;
			}

			const placement: ReviewPlacement = before ? "before" : "after";
			const anchorText = before ?? after;
			if (!anchorText) {
				return null;
			}

			return {
				id: `review-${blockIndex + 1}-${section.entryIndex}`,
				operation: "move",
				contributor: this.reviewerDirectory.resolveContributor(metadata.rawReviewer),
				source,
				target: {
					text: target,
				},
				anchor: {
					text: anchorText,
				},
				placement,
				why: this.cleanField(fields.get("why")),
				status: "pending",
			};
		}

		return null;
	}

	private collectFields(lines: LineWithOffsets[]): Map<string, string[]> {
		const fields = new Map<string, string[]>();
		let currentField: string | null = null;

		for (const line of lines) {
			const fieldMatch = line.text.match(FIELD_PATTERN);
			if (fieldMatch) {
				const rawKey = fieldMatch[1];
				if (!rawKey) {
					continue;
				}

				currentField = this.normalizeFieldName(rawKey);
				fields.set(currentField, [fieldMatch[2] ?? ""]);
				continue;
			}

			if (currentField) {
				fields.get(currentField)?.push(line.text);
			}
		}

		return fields;
	}

	private cleanField(lines?: string[]): string | undefined {
		if (!lines || lines.length === 0) {
			return undefined;
		}

		const joined = lines.join("\n").trim();
		return joined.length > 0 ? joined : undefined;
	}

	private normalizeFieldName(value: string): string {
		return value.toLowerCase().replace(/\s+/g, "");
	}

	private getLinesWithOffsets(text: string, baseOffset: number): LineWithOffsets[] {
		const lines: LineWithOffsets[] = [];
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
}
