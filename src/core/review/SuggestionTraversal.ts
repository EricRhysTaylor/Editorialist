// Pure suggestion traversal / selection logic, extracted verbatim from
// main.ts. No store, Obsidian, or UI dependencies — callers pass the
// suggestion list and the currently selected id. main.ts retains thin
// wrappers that resolve those from the store and delegate here, so behavior
// and call sites are unchanged.

import {
	getSuggestionAnchorTarget,
	getSuggestionPrimaryTarget,
	isSuggestionOpen,
} from "../OperationSupport";
import type { ReviewSuggestion, ReviewTargetRef } from "../../models/ReviewSuggestion";

export type TraversalDirection = "next" | "previous";

export interface AdjacentTraversalOptions {
	fromId?: string;
	treatCurrentAsDeferred?: boolean;
}

function hasResolvedRange(target?: ReviewTargetRef): boolean {
	return Boolean(target && target.startOffset !== undefined && target.endOffset !== undefined);
}

export function canRevealSuggestionInManuscript(suggestion: ReviewSuggestion): boolean {
	if (!isSuggestionOpen(suggestion)) {
		return false;
	}

	if (hasResolvedRange(getSuggestionPrimaryTarget(suggestion))) {
		return true;
	}

	return hasResolvedRange(getSuggestionAnchorTarget(suggestion));
}

export function getSuggestionTraversalTier(
	suggestion: ReviewSuggestion,
	forceDeferred = false,
): number | null {
	if (!isSuggestionOpen(suggestion)) {
		return null;
	}

	if (canRevealSuggestionInManuscript(suggestion)) {
		if (forceDeferred || suggestion.status === "deferred") {
			return 1;
		}

		return 0;
	}

	if (forceDeferred || suggestion.status === "deferred") {
		return 1;
	}

	return 2;
}

export function findPreferredSuggestionId(suggestions: readonly ReviewSuggestion[]): string | null {
	for (const tier of [0, 1, 2]) {
		const match = suggestions.find((suggestion) => getSuggestionTraversalTier(suggestion) === tier);
		if (match) {
			return match.id;
		}
	}

	return suggestions[0]?.id ?? null;
}

export function hasLiveActionableSuggestions(suggestions: readonly ReviewSuggestion[]): boolean {
	return suggestions.some((suggestion) => isSuggestionOpen(suggestion));
}

export function getAdjacentRevealableSuggestionId(
	suggestions: readonly ReviewSuggestion[],
	selectedSuggestionId: string | null,
	direction: TraversalDirection,
	options?: AdjacentTraversalOptions,
): string | null {
	if (suggestions.length === 0) {
		return null;
	}

	const fromId = options?.fromId;
	const treatCurrentAsDeferred = options?.treatCurrentAsDeferred ?? false;
	const currentId = fromId ?? selectedSuggestionId;
	const currentIndex = currentId
		? suggestions.findIndex((suggestion) => suggestion.id === currentId)
		: -1;
	const normalizedStartIndex =
		currentIndex === -1
			? direction === "next"
				? suggestions.length - 1
				: 0
			: currentIndex;

	for (const tier of [0, 1, 2]) {
		for (let offset = 1; offset <= suggestions.length; offset += 1) {
			const index =
				direction === "next"
					? (normalizedStartIndex + offset) % suggestions.length
					: (normalizedStartIndex - offset + suggestions.length) % suggestions.length;
			const suggestion = suggestions[index];
			if (
				suggestion &&
				getSuggestionTraversalTier(
					suggestion,
					treatCurrentAsDeferred && suggestion.id === fromId,
				) === tier
			) {
				return suggestion.id;
			}
		}
	}

	return null;
}
