import type {
	CondenseSuggestion,
	CutSuggestion,
	EditSuggestion,
	ExpandSuggestion,
	MoveSuggestion,
	RelocationResolution,
	ReviewStatus,
	ReviewSuggestion,
	ReviewTargetRef,
} from "../models/ReviewSuggestion";
import { rewriteAnchorEdit } from "./AnchorDirective";
import { findExactMatches, findFuzzyMatches, normalizeMatchText } from "./TextMatching";

interface TextResolution {
	matchCount: number;
	target: ReviewTargetRef;
}

// Tries byte-exact first, then falls back to fuzzy. Returns the first occurrence's
// offset range, or null if neither matches. Used by the already-applied detection
// for multi-line paraphrase content where punctuation/whitespace drift between
// the AI's output and the manuscript would defeat a pure byte-exact .includes.
function findFirstFuzzyRange(noteText: string, target: string): { startOffset: number; endOffset: number } | null {
	const exact = findExactMatches(noteText, target);
	if (exact.length >= 1) {
		const start = exact[0];
		if (start !== undefined) {
			return { startOffset: start, endOffset: start + target.length };
		}
	}
	const fuzzy = findFuzzyMatches(noteText, target);
	if (fuzzy.length >= 1) {
		const range = fuzzy[0];
		if (range) {
			return { startOffset: range.startOffset, endOffset: range.endOffset };
		}
	}
	return null;
}

type OperationMatcher = (noteText: string, suggestion: ReviewSuggestion) => ReviewSuggestion;

export class MatchEngine {
	private readonly operationMatchers: Record<ReviewSuggestion["operation"], OperationMatcher> = {
		edit: (noteText, suggestion) => this.resolveEditSuggestion(noteText, suggestion as EditSuggestion),
		move: (noteText, suggestion) => this.resolveMoveSuggestion(noteText, suggestion as MoveSuggestion),
		cut: (noteText, suggestion) => this.resolveCutSuggestion(noteText, suggestion as CutSuggestion),
		condense: (noteText, suggestion) => this.resolveCondenseSuggestion(noteText, suggestion as CondenseSuggestion),
		expand: (noteText, suggestion) => this.resolveExpandSuggestion(noteText, suggestion as ExpandSuggestion),
	};

	matchSuggestions(noteText: string, suggestions: ReviewSuggestion[]): ReviewSuggestion[] {
		return suggestions.map((suggestion) => this.matchSuggestion(noteText, suggestion));
	}

	matchSuggestion(noteText: string, suggestion: ReviewSuggestion): ReviewSuggestion {
		return this.operationMatchers[suggestion.operation](noteText, suggestion);
	}

	private resolveEditSuggestion(noteText: string, suggestion: EditSuggestion): EditSuggestion {
		const rewritten = this.rewriteForAnchorDirective(noteText, suggestion);
		const effective = rewritten ?? suggestion;

		if (effective.payload.original === effective.payload.revised) {
			return {
				...effective,
				status: this.preserveTerminalStatus(effective.status, "unresolved"),
				location: {
					primary: {
						text: effective.payload.original,
						matchType: "none",
						reason: "Original and revised text are identical. Check this suggestion.",
					},
				},
			};
		}

		const resolution = this.resolveTextTarget(
			noteText,
			effective.payload.original,
			effective.payload.revised,
		);

		const target = rewritten && resolution.target.matchType === "exact"
			? { ...resolution.target, reason: rewritten.directiveReason }
			: resolution.target;

		return {
			...effective,
			status: this.resolveSuggestionStatus(effective.status, resolution),
			location: {
				primary: target,
			},
		};
	}

	private rewriteForAnchorDirective(
		noteText: string,
		suggestion: EditSuggestion,
	): (EditSuggestion & { directiveReason: string }) | null {
		const rewrite = rewriteAnchorEdit(
			noteText,
			suggestion.payload.original,
			suggestion.payload.revised,
		);
		if (!rewrite) {
			return null;
		}

		return {
			...suggestion,
			payload: {
				original: rewrite.original,
				revised: rewrite.revised,
			},
			directiveReason: rewrite.reason,
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
		const anchors = suggestion.payload.targetAnchors;
		if (anchors) {
			return this.resolveCondenseAnchorPair(noteText, suggestion, anchors);
		}

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

	// EXPAND resolves like a non-anchor CONDENSE: locate the verbatim target, and
	// pass the optional expanded `suggestion` as the alternate so an already-applied
	// expansion (target gone, longer version present) is detected.
	private resolveExpandSuggestion(noteText: string, suggestion: ExpandSuggestion): ExpandSuggestion {
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

	// Anchor-pair condense: the AI emitted "<start>" → "<end>" instead of the
	// full verbatim passage. We resolve each anchor independently. If both land
	// unambiguously and the start precedes the end, the resolved span runs from
	// the start anchor's startOffset to the end anchor's endOffset, and we
	// rewrite payload.target to that slice so the apply path matches against
	// the actual manuscript text rather than the anchor expression.
	private resolveCondenseAnchorPair(
		noteText: string,
		suggestion: CondenseSuggestion,
		anchors: { start: string; end: string },
	): CondenseSuggestion {
		const startResolution = this.resolveTextTarget(noteText, anchors.start);
		const endResolution = this.resolveTextTarget(noteText, anchors.end);

		const failureTarget = this.buildAnchorFailureTarget(
			suggestion.payload.target,
			startResolution.target,
			endResolution.target,
		);
		if (failureTarget) {
			return {
				...suggestion,
				status: this.preserveTerminalStatus(suggestion.status, "unresolved"),
				location: { target: failureTarget },
			};
		}

		const startOffset = startResolution.target.startOffset;
		const endOffset = endResolution.target.endOffset;
		if (startOffset === undefined || endOffset === undefined || startOffset >= endOffset) {
			return {
				...suggestion,
				status: this.preserveTerminalStatus(suggestion.status, "unresolved"),
				location: {
					target: {
						text: suggestion.payload.target,
						matchType: "none",
						reason: "Closing anchor does not follow opening anchor in the manuscript.",
					},
				},
			};
		}

		const resolvedText = noteText.slice(startOffset, endOffset);

		return {
			...suggestion,
			status: this.preserveTerminalStatus(suggestion.status, "pending"),
			payload: {
				...suggestion.payload,
				target: resolvedText,
			},
			location: {
				target: {
					text: resolvedText,
					startOffset,
					endOffset,
					matchType: "exact",
					reason: "Resolved from opening and closing anchors.",
				},
			},
		};
	}

	private buildAnchorFailureTarget(
		rawTarget: string,
		startTarget: ReviewTargetRef,
		endTarget: ReviewTargetRef,
	): ReviewTargetRef | null {
		const startBad = startTarget.matchType !== "exact" || startTarget.startOffset === undefined;
		const endBad = endTarget.matchType !== "exact" || endTarget.endOffset === undefined;
		if (!startBad && !endBad) {
			return null;
		}

		const reasons: string[] = [];
		if (startBad) {
			reasons.push(`Opening anchor: ${startTarget.reason ?? "not found"}`);
		}
		if (endBad) {
			reasons.push(`Closing anchor: ${endTarget.reason ?? "not found"}`);
		}

		return {
			text: rawTarget,
			matchType: "none",
			reason: reasons.join(" "),
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
				reason: this.describeMoveSideFailure("source", target),
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
				reason: this.describeMoveSideFailure("destination", anchor),
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

	// A move has two distinct sides — the "source" (text to move) and the
	// "destination" (the anchor it lands next to). When one fails to resolve the
	// reviewer needs to know WHICH side is the problem; the bare per-target reason
	// ("Text not found in the manuscript.") is identical for both and hid that.
	private describeMoveSideFailure(side: "source" | "destination", ref: ReviewTargetRef): string {
		const what = side === "source" ? "the text to move" : "the destination text";
		if (ref.matchType === "multiple") {
			return `Found ${what} more than once in the manuscript, so it can't be located unambiguously.`;
		}
		return `Couldn't find ${what} in the manuscript.`;
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
		// Add-only-edit short-circuit. When the revised text is a strict superset
		// of the original (revised contains original as substring + extra content)
		// AND the revised text already appears in the manuscript, the edit has
		// already been applied. Without this check the original would still match
		// as a substring of the revised text — exact would win and re-applying
		// would duplicate the added content. Detection uses fuzzy matching so
		// punctuation/whitespace drift between AI output and manuscript doesn't
		// hide a legitimate "already applied" state.
		if (
			alternateText
			&& alternateText.length > text.length
			&& alternateText.includes(text)
		) {
			const range = findFirstFuzzyRange(noteText, alternateText);
			if (range) {
				return {
					matchCount: 0,
					target: {
						text,
						startOffset: range.startOffset,
						endOffset: range.endOffset,
						matchType: "already_applied",
						reason: "Suggestion appears to already be applied.",
					},
				};
			}
		}

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

		// Byte-exact match failed. Try a quote/dash/whitespace-tolerant pass
		// before giving up — AIs frequently emit curly quotes, em-dashes, or
		// collapsed whitespace that wouldn't match a manuscript with straight
		// punctuation.
		const fuzzyRanges = findFuzzyMatches(noteText, text);
		if (fuzzyRanges.length === 1) {
			const range = fuzzyRanges[0];
			if (range) {
				return {
					matchCount: 1,
					target: {
						text,
						startOffset: range.startOffset,
						endOffset: range.endOffset,
						matchType: "exact",
						reason: "Match found after normalizing quotes/dashes/whitespace.",
					},
				};
			}
		}
		if (fuzzyRanges.length > 1) {
			return {
				matchCount: fuzzyRanges.length,
				target: {
					text,
					matchType: "multiple",
					reason: "Multiple matches found after normalizing quotes/dashes/whitespace.",
				},
			};
		}

		// Already-applied detection: when the AI's revised text appears in the
		// manuscript (byte-exact or under fuzzy normalization), the edit/condense/expand
		// is in place. Particularly important for condense, where AFTER text is
		// a multi-line paraphrase — byte-exact matching is fragile to any drift.
		if (alternateText) {
			const range = findFirstFuzzyRange(noteText, alternateText);
			if (range) {
				return {
					matchCount: 0,
					target: {
						text,
						startOffset: range.startOffset,
						endOffset: range.endOffset,
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
