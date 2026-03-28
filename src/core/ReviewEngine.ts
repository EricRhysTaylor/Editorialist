import type { ReviewSession, ReviewSuggestion } from "../models/ReviewSuggestion";
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
		const resolvedSuggestions = this.matchEngine.matchSuggestions(noteText, reconciledSuggestions);

		return {
			notePath,
			hasReviewBlock: parsedDocument.blockCount > 0,
			parsedAt: Date.now(),
			suggestions: this.finalizeStatuses(resolvedSuggestions),
		};
	}

	refreshSuggestions(noteText: string, suggestions: ReviewSuggestion[]): ReviewSuggestion[] {
		return this.finalizeStatuses(this.matchEngine.matchSuggestions(noteText, suggestions));
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
				return this.markTerminalSuggestion(suggestion, "Accepted into the manuscript.");
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
			manuscriptMatch: suggestion.manuscriptMatch
				? {
						...suggestion.manuscriptMatch,
						startOffset: undefined,
						endOffset: undefined,
						reason,
					}
				: undefined,
			target: suggestion.target
				? {
						...suggestion.target,
						startOffset: undefined,
						endOffset: undefined,
						reason,
					}
				: undefined,
			anchor: suggestion.anchor
				? {
						...suggestion.anchor,
						startOffset: undefined,
						endOffset: undefined,
						reason,
					}
				: undefined,
			relocation: suggestion.relocation
				? {
						...suggestion.relocation,
						targetStart: undefined,
						targetEnd: undefined,
						anchorStart: undefined,
						anchorEnd: undefined,
						reason,
					}
				: undefined,
		};
	}

	private getSuggestionSignature(suggestion: ReviewSuggestion): string {
		return [
			suggestion.operation,
			suggestion.contributor.displayName,
			suggestion.contributor.kind,
			suggestion.original ?? "",
			suggestion.revised ?? "",
			suggestion.target?.text ?? "",
			suggestion.anchor?.text ?? "",
			suggestion.placement ?? "",
			suggestion.why ?? "",
		].join("\u0000");
	}
}
