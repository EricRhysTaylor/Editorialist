import type {
	RelocationResolution,
	ReviewSuggestion,
	ReviewTargetRef,
} from "../models/ReviewSuggestion";

interface TextResolution {
	matchCount: number;
	target: ReviewTargetRef;
}

export class MatchEngine {
	matchSuggestions(noteText: string, suggestions: ReviewSuggestion[]): ReviewSuggestion[] {
		return suggestions.map((suggestion) => this.matchSuggestion(noteText, suggestion));
	}

	matchSuggestion(noteText: string, suggestion: ReviewSuggestion): ReviewSuggestion {
		if (suggestion.operation === "move") {
			return this.resolveMoveSuggestion(noteText, suggestion);
		}

		return this.resolveReplaceSuggestion(noteText, suggestion);
	}

	private resolveReplaceSuggestion(noteText: string, suggestion: ReviewSuggestion): ReviewSuggestion {
		const original = suggestion.original;
		if (!original) {
			return {
				...suggestion,
				status: this.preserveTerminalStatus(suggestion.status, "unresolved"),
				manuscriptMatch: {
					text: "",
					matchType: "none",
					reason: "Replace suggestion is missing original text.",
				},
			};
		}

		const resolution = this.resolveTextTarget(noteText, original, suggestion.revised);
		return {
			...suggestion,
			status: this.preserveTerminalStatus(suggestion.status, resolution.matchCount === 1 ? "pending" : "unresolved"),
			manuscriptMatch: resolution.target,
			target: undefined,
			anchor: undefined,
			relocation: undefined,
		};
	}

	private resolveMoveSuggestion(noteText: string, suggestion: ReviewSuggestion): ReviewSuggestion {
		const targetText = suggestion.target?.text;
		const anchorText = suggestion.anchor?.text;

		const targetResolution = targetText
			? this.resolveTextTarget(noteText, targetText)
			: this.createMissingResolution("Target text is missing.");
		const anchorResolution = anchorText
			? this.resolveTextTarget(noteText, anchorText)
			: this.createMissingResolution("Anchor text is missing.");

		const relocation = this.resolveRelocation(
			targetResolution.target,
			anchorResolution.target,
			suggestion.placement,
		);

		return {
			...suggestion,
			status: this.preserveTerminalStatus(suggestion.status, relocation.canApply ? "pending" : "unresolved"),
			target: targetResolution.target,
			anchor: anchorResolution.target,
			manuscriptMatch: undefined,
			relocation,
		};
	}

	private resolveRelocation(
		target: ReviewTargetRef,
		anchor: ReviewTargetRef,
		placement?: "before" | "after",
	): RelocationResolution {
		const targetResolved = target.matchType === "exact" && target.startOffset !== undefined && target.endOffset !== undefined;
		const anchorResolved = anchor.matchType === "exact" && anchor.startOffset !== undefined && anchor.endOffset !== undefined;

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

	private resolveTextTarget(noteText: string, text: string, alternateText?: string): TextResolution {
		const matches = this.findAllExactMatches(noteText, text);

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

	private createMissingResolution(reason: string): TextResolution {
		return {
			matchCount: 0,
			target: {
				text: "",
				matchType: "none",
				reason,
			},
		};
	}

	private preserveTerminalStatus(currentStatus: ReviewSuggestion["status"], nextStatus: ReviewSuggestion["status"]): ReviewSuggestion["status"] {
		return currentStatus === "accepted" || currentStatus === "rejected" ? currentStatus : nextStatus;
	}

	private findAllExactMatches(noteText: string, text: string): number[] {
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

	// TODO Phase 2: add normalized matching fallback after the exact path is proven.
	normalizeText(value: string): string {
		return value.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
	}
}
