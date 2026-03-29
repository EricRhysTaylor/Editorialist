import type { ReviewSession, ReviewSuggestion } from "../models/ReviewSuggestion";
import { getLegacyContributorSignatureKind } from "./ContributorIdentity";
import { getSuggestionSignatureParts } from "./OperationSupport";
import type { MatchEngine } from "./MatchEngine";
import type { SuggestionParser } from "./SuggestionParser";

export class ReviewEngine {
	constructor(
		private readonly parser: SuggestionParser,
		private readonly matchEngine: MatchEngine,
	) {}

	buildSession(notePath: string, noteText: string, previousSession?: ReviewSession | null): ReviewSession {
		const parsedDocument = this.parser.parse(noteText);
		const reconciledSuggestions = this.reconcileSuggestions(parsedDocument.suggestions, previousSession);
		const resolvedSuggestions = this.matchEngine.matchSuggestions(
			this.maskReviewBlocks(noteText, parsedDocument.blocks),
			reconciledSuggestions,
		);

		return {
			notePath,
			hasReviewBlock: parsedDocument.blockCount > 0,
			parsedAt: Date.now(),
			suggestions: this.finalizeStatuses(resolvedSuggestions),
		};
	}

	refreshSuggestions(noteText: string, suggestions: ReviewSuggestion[]): ReviewSuggestion[] {
		const parsedDocument = this.parser.parse(noteText);
		return this.finalizeStatuses(
			this.matchEngine.matchSuggestions(this.maskReviewBlocks(noteText, parsedDocument.blocks), suggestions),
		);
	}

	private reconcileSuggestions(parsedSuggestions: ReviewSuggestion[], previousSession?: ReviewSession | null): ReviewSuggestion[] {
		if (!previousSession) {
			return parsedSuggestions;
		}

		const previousById = new Map(previousSession.suggestions.map((suggestion) => [suggestion.id, suggestion]));
		const previousBySignature = new Map(
			previousSession.suggestions.map((suggestion) => [this.getSuggestionSignature(suggestion), suggestion]),
		);

		return parsedSuggestions.map((suggestion) => {
			const previousSuggestion =
				previousById.get(suggestion.id) ?? previousBySignature.get(this.getSuggestionSignature(suggestion));

			if (!previousSuggestion) {
				return suggestion;
			}

			return {
				...suggestion,
				status: previousSuggestion.status,
				contributor:
					suggestion.contributor.reviewerId === undefined && previousSuggestion.contributor.reviewerId !== undefined
						? previousSuggestion.contributor
						: suggestion.contributor,
			};
		});
	}

	private finalizeStatuses(suggestions: ReviewSuggestion[]): ReviewSuggestion[] {
		return suggestions.map((suggestion) => {
			if (suggestion.status === "accepted") {
				const targets = [suggestion.location.primary, suggestion.location.target, suggestion.location.anchor];
				const reason = targets.some((target) => target?.matchType === "already_applied")
					? "Already reflected in the manuscript."
					: "Accepted into the manuscript.";
				return this.markTerminalSuggestion(suggestion, reason);
			}

			if (suggestion.status === "rejected") {
				return this.markTerminalSuggestion(suggestion, "Rejected for this review session.");
			}

			return suggestion;
		});
	}

	private markTerminalSuggestion(suggestion: ReviewSuggestion, reason: string): ReviewSuggestion {
		return {
			...suggestion,
			location: {
				primary: suggestion.location.primary
					? {
							...suggestion.location.primary,
							startOffset: undefined,
							endOffset: undefined,
							reason,
						}
					: undefined,
				target: suggestion.location.target
					? {
							...suggestion.location.target,
							startOffset: undefined,
							endOffset: undefined,
							reason,
						}
					: undefined,
				anchor: suggestion.location.anchor
					? {
							...suggestion.location.anchor,
							startOffset: undefined,
							endOffset: undefined,
							reason,
						}
					: undefined,
				relocation: suggestion.location.relocation
					? {
							...suggestion.location.relocation,
							targetStart: undefined,
							targetEnd: undefined,
							anchorStart: undefined,
							anchorEnd: undefined,
							reason,
						}
					: undefined,
			},
		};
	}

	private getSuggestionSignature(suggestion: ReviewSuggestion): string {
		return [
			suggestion.operation,
			suggestion.executionMode,
			suggestion.contributor.displayName,
			getLegacyContributorSignatureKind(suggestion.contributor),
			...getSuggestionSignatureParts(suggestion),
			suggestion.why ?? "",
		].join("\u0000");
	}

	private maskReviewBlocks(noteText: string, blocks: Array<{ startOffset: number; endOffset: number }>): string {
		if (blocks.length === 0) {
			return noteText;
		}

		let maskedText = noteText;
		for (const block of [...blocks].sort((left, right) => right.startOffset - left.startOffset)) {
			const segment = maskedText.slice(block.startOffset, block.endOffset);
			const maskedSegment = segment.replace(/[^\r\n]/g, " ");
			maskedText =
				maskedText.slice(0, block.startOffset) +
				maskedSegment +
				maskedText.slice(block.endOffset);
		}

		return maskedText;
	}
}
