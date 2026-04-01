import type {
	CondenseSuggestion,
	CutSuggestion,
	EditSuggestion,
	MoveSuggestion,
	RelocationResolution,
	ReviewStatus,
	ReviewSuggestion,
	ReviewTargetRef,
} from "../models/ReviewSuggestion";
import { findExactMatches, normalizeMatchText } from "./TextMatching";

interface TextResolution {
	matchCount: number;
	target: ReviewTargetRef;
}

type OperationMatcher = (noteText: string, suggestion: ReviewSuggestion) => ReviewSuggestion;

export class MatchEngine {
	private readonly operationMatchers: Record<ReviewSuggestion["operation"], OperationMatcher> = {
		edit: (noteText, suggestion) => this.resolveEditSuggestion(noteText, suggestion as EditSuggestion),
		move: (noteText, suggestion) => this.resolveMoveSuggestion(noteText, suggestion as MoveSuggestion),
		cut: (noteText, suggestion) => this.resolveCutSuggestion(noteText, suggestion as CutSuggestion),
		condense: (noteText, suggestion) => this.resolveCondenseSuggestion(noteText, suggestion as CondenseSuggestion),
	};

	matchSuggestions(noteText: string, suggestions: ReviewSuggestion[]): ReviewSuggestion[] {
		return suggestions.map((suggestion) => this.matchSuggestion(noteText, suggestion));
	}

	matchSuggestion(noteText: string, suggestion: ReviewSuggestion): ReviewSuggestion {
		return this.operationMatchers[suggestion.operation](noteText, suggestion);
	}

	private resolveEditSuggestion(noteText: string, suggestion: EditSuggestion): EditSuggestion {
		if (suggestion.payload.original === suggestion.payload.revised) {
			return {
				...suggestion,
				status: this.preserveTerminalStatus(suggestion.status, "unresolved"),
				location: {
					primary: {
						text: suggestion.payload.original,
						matchType: "none",
						reason: "Original and revised text are identical. Check this suggestion.",
					},
				},
			};
		}

		const resolution = this.resolveTextTarget(
			noteText,
			suggestion.payload.original,
			suggestion.payload.revised,
		);

		return {
			...suggestion,
			status: this.resolveSuggestionStatus(suggestion.status, resolution),
			location: {
				primary: resolution.target,
			},
		};
	}

	private resolveMoveSuggestion(noteText: string, suggestion: MoveSuggestion): MoveSuggestion {
		const targetResolution = this.resolveTextTarget(noteText, suggestion.payload.target);
		const anchorResolution = this.resolveTextTarget(noteText, suggestion.payload.anchor);
		const relocation = this.resolveRelocation(
			noteText,
			targetResolution.target,
			anchorResolution.target,
			suggestion.payload.placement,
		);

		return {
			...suggestion,
			status: this.preserveTerminalStatus(
				suggestion.status,
				relocation.alreadyApplied ? "accepted" : relocation.canApply ? "pending" : "unresolved",
			),
			location: {
				target: targetResolution.target,
				anchor: anchorResolution.target,
				relocation,
			},
		};
	}

	private resolveCutSuggestion(noteText: string, suggestion: CutSuggestion): CutSuggestion {
		const resolution = this.resolveTextTarget(noteText, suggestion.payload.target);

		return {
			...suggestion,
			status: this.resolveSuggestionStatus(suggestion.status, resolution),
			location: {
				target: resolution.target,
			},
		};
	}

	private resolveCondenseSuggestion(noteText: string, suggestion: CondenseSuggestion): CondenseSuggestion {
		const resolution = this.resolveTextTarget(
			noteText,
			suggestion.payload.target,
			suggestion.payload.suggestion,
		);

		return {
			...suggestion,
			status: this.resolveSuggestionStatus(suggestion.status, resolution),
			location: {
				target: resolution.target,
			},
		};
	}

	private resolveRelocation(
		noteText: string,
		target: ReviewTargetRef,
		anchor: ReviewTargetRef,
		placement?: "before" | "after",
	): RelocationResolution {
		const targetResolved =
			target.matchType === "exact" && target.startOffset !== undefined && target.endOffset !== undefined;
		const anchorResolved =
			anchor.matchType === "exact" && anchor.startOffset !== undefined && anchor.endOffset !== undefined;

		if (!targetResolved) {
			return {
				targetResolved: false,
				anchorResolved,
				anchorStart: anchor.startOffset,
				anchorEnd: anchor.endOffset,
				placement,
				canApply: false,
				reason: target.reason ?? "Target text not found.",
			};
		}

		if (!anchorResolved) {
			return {
				targetResolved: true,
				anchorResolved: false,
				targetStart: target.startOffset,
				targetEnd: target.endOffset,
				placement,
				canApply: false,
				reason: anchor.reason ?? "Anchor text not found.",
			};
		}

		if (
			target.startOffset === undefined ||
			target.endOffset === undefined ||
			anchor.startOffset === undefined ||
			anchor.endOffset === undefined
		) {
			return {
				targetResolved,
				anchorResolved,
				placement,
				canApply: false,
				reason: "Move resolution is incomplete.",
			};
		}

		const overlaps = !(target.endOffset <= anchor.startOffset || anchor.endOffset <= target.startOffset);
		if (overlaps) {
			return {
				targetResolved: true,
				anchorResolved: true,
				targetStart: target.startOffset,
				targetEnd: target.endOffset,
				anchorStart: anchor.startOffset,
				anchorEnd: anchor.endOffset,
				placement,
				canApply: false,
				reason: "Target and anchor overlap in the manuscript.",
			};
		}

		const alreadyApplied = this.isRelocationAlreadyApplied(
			noteText,
			target.startOffset,
			target.endOffset,
			anchor.startOffset,
			anchor.endOffset,
			placement,
		);
		if (alreadyApplied) {
			return {
				targetResolved: true,
				anchorResolved: true,
				alreadyApplied: true,
				targetStart: target.startOffset,
				targetEnd: target.endOffset,
				anchorStart: anchor.startOffset,
				anchorEnd: anchor.endOffset,
				placement,
				canApply: false,
				reason: placement ? `Move already reflected ${placement} anchor.` : "Move already reflected in the manuscript.",
			};
		}

		return {
			targetResolved: true,
			anchorResolved: true,
			targetStart: target.startOffset,
			targetEnd: target.endOffset,
			anchorStart: anchor.startOffset,
			anchorEnd: anchor.endOffset,
			placement,
			canApply: true,
			reason: placement ? `Ready to move target ${placement} anchor.` : "Ready to move target.",
		};
	}

	private isRelocationAlreadyApplied(
		noteText: string,
		targetStart: number,
		targetEnd: number,
		anchorStart: number,
		anchorEnd: number,
		placement?: "before" | "after",
	): boolean {
		if (placement === "after") {
			if (anchorEnd > targetStart) {
				return false;
			}

			return /^\s*$/.test(noteText.slice(anchorEnd, targetStart));
		}

		if (targetEnd > anchorStart) {
			return false;
		}

		return /^\s*$/.test(noteText.slice(targetEnd, anchorStart));
	}

	private resolveTextTarget(noteText: string, text: string, alternateText?: string): TextResolution {
		const matches = findExactMatches(noteText, text);

		if (matches.length === 1) {
			const startOffset = matches[0];
			if (startOffset !== undefined) {
				return {
					matchCount: 1,
					target: {
						text,
						startOffset,
						endOffset: startOffset + text.length,
						matchType: "exact",
						reason: "Exact match found in the manuscript.",
					},
				};
			}
		}

		if (matches.length > 1) {
			return {
				matchCount: matches.length,
				target: {
					text,
					matchType: "multiple",
					reason: "Multiple exact matches found.",
				},
			};
		}

		if (alternateText && noteText.includes(alternateText)) {
			const alternateMatches = findExactMatches(noteText, alternateText);
			if (alternateMatches.length === 1) {
				const startOffset = alternateMatches[0];
				if (startOffset !== undefined) {
					return {
						matchCount: 0,
						target: {
							text,
							startOffset,
							endOffset: startOffset + alternateText.length,
							matchType: "already_applied",
							reason: "Suggestion may already be applied.",
						},
					};
				}
			}

			return {
				matchCount: 0,
				target: {
					text,
					matchType: "already_applied",
					reason: "Suggestion may already be applied.",
				},
			};
		}

		return {
			matchCount: 0,
			target: {
				text,
				matchType: "none",
				reason: "Text not found in the manuscript.",
			},
		};
	}

	private preserveTerminalStatus(currentStatus: ReviewStatus, nextStatus: ReviewStatus): ReviewStatus {
		return currentStatus === "accepted" || currentStatus === "rejected" || currentStatus === "deferred" || currentStatus === "rewritten"
			? currentStatus
			: nextStatus;
	}

	private resolveSuggestionStatus(currentStatus: ReviewStatus, resolution: TextResolution): ReviewStatus {
		if (resolution.target.matchType === "already_applied") {
			return this.preserveTerminalStatus(currentStatus, "accepted");
		}

		return this.preserveTerminalStatus(currentStatus, resolution.matchCount === 1 ? "pending" : "unresolved");
	}

	// TODO Phase 2: add normalized matching fallback after the exact path is proven.
	normalizeText(value: string): string {
		return normalizeMatchText(value);
	}
}
