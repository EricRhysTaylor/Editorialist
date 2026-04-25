import type {
	CondenseSuggestion,
	CutSuggestion,
	EditSuggestion,
	MoveSuggestion,
	ParsedReviewDocument,
	SupportedReviewOperationType,
	ReviewPlacement,
	ParsedReviewBlock,
	ReviewSuggestion,
	ReviewSourceRef,
	ReviewSuggestionRouting,
} from "../models/ReviewSuggestion";
import type { ParsedReviewerReference } from "../models/ReviewerProfile";
import type { ReviewerDirectory } from "../state/ReviewerDirectory";
import { extractReviewBlocks } from "./ReviewBlockFormat";
import { getLinesWithOffsets, type LineWithOffsets } from "./TextOffsets";

const SECTION_HEADER_PATTERN = /^\s*(?:={2,}|-{2,}|#{1,6}|\*{1,3}|\[)\s*(EDIT|MOVE|CUT|CONDENSE)\s*(?:={2,}|-{2,}|#{1,6}|\*{1,3}|\])?\s*$/i;
const FIELD_PATTERN = /^([A-Za-z][A-Za-z ]+):\s*(.*)$/;

interface SectionBuffer {
	entryIndex: number;
	endOffset: number;
	lines: LineWithOffsets[];
	operation: SupportedReviewOperationType;
	startOffset: number;
}

interface BlockMetadata {
	rawReviewer: ParsedReviewerReference;
}

type SectionParser = (
	fields: Map<string, string[]>,
	suggestionId: string,
	source: ReviewSourceRef,
	metadata: BlockMetadata,
) => ReviewSuggestion | null;

const OPERATION_HEADERS: Record<string, SupportedReviewOperationType> = {
	EDIT: "edit",
	MOVE: "move",
	CUT: "cut",
	CONDENSE: "condense",
};

export class SuggestionParser {
	private readonly sectionParsers: Record<SupportedReviewOperationType, SectionParser> = {
		edit: (fields, suggestionId, source, metadata) => this.parseEditSuggestion(fields, suggestionId, source, metadata),
		move: (fields, suggestionId, source, metadata) => this.parseMoveSuggestion(fields, suggestionId, source, metadata),
		cut: (fields, suggestionId, source, metadata) => this.parseCutSuggestion(fields, suggestionId, source, metadata),
		condense: (fields, suggestionId, source, metadata) =>
			this.parseCondenseSuggestion(fields, suggestionId, source, metadata),
	};

	constructor(private readonly reviewerDirectory: ReviewerDirectory) {}

	parse(noteText: string): ParsedReviewDocument {
		const suggestions: ReviewSuggestion[] = [];
		const blocks = extractReviewBlocks(noteText);

		blocks.forEach((block, blockIndex) => {
			const rawBody = block.bodyText;
			const bodyStart = block.startOffset;
			const blockEnd = block.endOffset;
			const lines = getLinesWithOffsets(rawBody, bodyStart);
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
			blocks: blocks.map((block): ParsedReviewBlock => ({
				startOffset: block.startOffset,
				endOffset: block.endOffset,
				source: block.source,
			})),
			suggestions,
		};
	}

	private parseBlockMetadata(lines: LineWithOffsets[], _blockIndex: number): BlockMetadata {
		let reviewer: string | undefined;
		let reviewerType: string | undefined;
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
				const headerKey = headerMatch[1]?.toUpperCase();
				const operation = headerKey ? OPERATION_HEADERS[headerKey] : undefined;
				if (!operation) {
					currentSection = null;
					continue;
				}

				currentSection = {
					entryIndex,
					endOffset: blockEnd,
					lines: [],
					operation,
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
		const suggestionId = `review-${blockIndex + 1}-${section.entryIndex}`;
		return this.sectionParsers[section.operation](fields, suggestionId, source, metadata);
	}

	private parseEditSuggestion(
		fields: Map<string, string[]>,
		suggestionId: string,
		source: ReviewSourceRef,
		metadata: BlockMetadata,
	): EditSuggestion | null {
		const original = this.cleanField(fields.get("original"));
		const revised = this.cleanField(fields.get("revised"));
		if (!original || !revised) {
			return null;
		}

		return {
			id: suggestionId,
			operation: "edit",
			status: "pending",
			contributor: this.reviewerDirectory.resolveContributor(metadata.rawReviewer),
			source,
			location: {},
			routing: this.parseRouting(fields),
			why: this.cleanField(fields.get("why")),
			executionMode: "direct",
			payload: {
				original,
				revised,
			},
		};
	}

	private parseMoveSuggestion(
		fields: Map<string, string[]>,
		suggestionId: string,
		source: ReviewSourceRef,
		metadata: BlockMetadata,
	): MoveSuggestion | null {
		const target = this.cleanField(fields.get("target"));
		const before = this.cleanField(fields.get("before"));
		const after = this.cleanField(fields.get("after"));
		if (!target || (!before && !after) || (before && after)) {
			return null;
		}

		const placement: ReviewPlacement = before ? "before" : "after";
		const anchor = before ?? after;
		if (!anchor) {
			return null;
		}

		return {
			id: suggestionId,
			operation: "move",
			status: "pending",
			contributor: this.reviewerDirectory.resolveContributor(metadata.rawReviewer),
			source,
			location: {},
			routing: this.parseRouting(fields),
			why: this.cleanField(fields.get("why")),
			executionMode: "direct",
			payload: {
				target,
				anchor,
				placement,
			},
		};
	}

	private parseCutSuggestion(
		fields: Map<string, string[]>,
		suggestionId: string,
		source: ReviewSourceRef,
		metadata: BlockMetadata,
	): CutSuggestion | null {
		const target = this.cleanField(fields.get("target")) ?? this.cleanField(fields.get("original"));
		if (!target) {
			return null;
		}

		return {
			id: suggestionId,
			operation: "cut",
			status: "pending",
			contributor: this.reviewerDirectory.resolveContributor(metadata.rawReviewer),
			source,
			location: {},
			routing: this.parseRouting(fields),
			why: this.cleanField(fields.get("why")),
			executionMode: "direct",
			payload: {
				target,
			},
		};
	}

	private parseCondenseSuggestion(
		fields: Map<string, string[]>,
		suggestionId: string,
		source: ReviewSourceRef,
		metadata: BlockMetadata,
	): CondenseSuggestion | null {
		const target = this.cleanField(fields.get("target")) ?? this.cleanField(fields.get("original"));
		const suggestion = this.cleanField(fields.get("suggestion")) ?? this.cleanField(fields.get("revised"));
		if (!target) {
			return null;
		}

		return {
			id: suggestionId,
			operation: "condense",
			status: "pending",
			contributor: this.reviewerDirectory.resolveContributor(metadata.rawReviewer),
			source,
			location: {},
			routing: this.parseRouting(fields),
			why: this.cleanField(fields.get("why")),
			executionMode: suggestion ? "direct" : "advisory",
			payload: {
				target,
				suggestion,
			},
		};
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

	private parseRouting(fields: Map<string, string[]>): ReviewSuggestionRouting | undefined {
		const routing: ReviewSuggestionRouting = {
			sceneId: this.cleanField(fields.get("sceneid")),
			note: this.cleanField(fields.get("note")),
			path: this.cleanField(fields.get("path")),
			scene: this.cleanField(fields.get("scene")),
		};

		return routing.sceneId || routing.note || routing.path || routing.scene ? routing : undefined;
	}
}
