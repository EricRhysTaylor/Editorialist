// The ONLY place that decides whether a review sweep is complete.
//
// Completion rule (centralized here, must not be duplicated elsewhere):
//   A sweep is complete when, and only when,
//     pendingCount === 0 && unresolvedCount === 0 && deferredCount === 0.
//
// Accepted / rejected / rewritten (and implicitly-accepted suggestions, via
// getEffectiveSuggestionStatus) are terminal and do not block completion.
// This is mathematically identical to the prior "no suggestion is open"
// check, so wiring existing call sites through here preserves behavior.

import type { ReviewSuggestion } from "../../models/ReviewSuggestion";
import { getEffectiveSuggestionStatus } from "../OperationSupport";
import type { ReviewStatus, ReviewSweepStatus } from "../status/ReviewStatusModel";

export interface ReviewStatusTally {
	totalSuggestions: number;
	accepted: number;
	pending: number;
	deferred: number;
	rejected: number;
	rewritten: number;
	unresolved: number;
}

/** Minimal shape carrying the three completion-blocking counts. */
export interface SweepBlockingCounts {
	pendingCount: number;
	unresolvedCount: number;
	deferredCount: number;
}

function emptyTally(): ReviewStatusTally {
	return {
		totalSuggestions: 0,
		accepted: 0,
		pending: 0,
		deferred: 0,
		rejected: 0,
		rewritten: 0,
		unresolved: 0,
	};
}

/** Tally a flat list of review statuses (e.g. reviewer-signal records). */
export function tallyReviewStatuses(statuses: readonly ReviewStatus[]): ReviewStatusTally {
	const tally = emptyTally();
	for (const status of statuses) {
		tally.totalSuggestions += 1;
		tally[status] += 1;
	}
	return tally;
}

/**
 * Tally suggestions by their *effective* status (so implicitly-accepted
 * suggestions count as accepted), replacing the switch previously duplicated
 * in ReviewRegistryService's inventory loops.
 */
export function tallySuggestionStatuses(
	suggestions: readonly ReviewSuggestion[],
): ReviewStatusTally {
	return tallyReviewStatuses(
		suggestions.map((suggestion) => getEffectiveSuggestionStatus(suggestion)),
	);
}

export function isSweepCompleteFromCounts(counts: SweepBlockingCounts): boolean {
	return (
		counts.pendingCount === 0 &&
		counts.unresolvedCount === 0 &&
		counts.deferredCount === 0
	);
}

export function isSweepCompleteFromTally(tally: ReviewStatusTally): boolean {
	return isSweepCompleteFromCounts({
		pendingCount: tally.pending,
		unresolvedCount: tally.unresolved,
		deferredCount: tally.deferred,
	});
}

// Whether a single sweep-registry batch can have its review block removed now.
//
// Deliberately NOT keyed on the entry's `status`: that is "completed" only when
// every scene the batch touched is clear across ALL batches on those scenes, so
// a second batch sharing a scene pins the first at "in_progress" indefinitely.
// Comparing the batch's own terminal decisions to its suggestion count sidesteps
// that — a batch whose every suggestion is accepted/rejected/rewritten (and none
// deferred) is finished and cleanable regardless of unrelated batches. A
// `cleaned` batch has already had its block removed, so there is nothing left.
export function isBatchReadyToClean(
	entry: { status: string; totalSuggestions: number },
	stats: { accepted: number; rejected: number; rewritten: number; deferred: number },
): boolean {
	if (entry.status === "cleaned") {
		return false;
	}
	if (entry.totalSuggestions <= 0 || stats.deferred > 0) {
		return false;
	}
	const decidedCount = stats.accepted + stats.rejected + stats.rewritten;
	return decidedCount >= entry.totalSuggestions;
}

/** Suggestion-list entrypoint (used by the toolbar/panel + main.ts). */
export function isSweepComplete(suggestions: readonly ReviewSuggestion[]): boolean {
	return isSweepCompleteFromTally(tallySuggestionStatuses(suggestions));
}

/**
 * Derive the sweep status from blocking counts. `cleaned` short-circuits
 * (a batch with no scenes left is cleaned regardless of counts); otherwise
 * complete → `completed`, else `in_progress`.
 */
export function getSweepStatus(
	counts: SweepBlockingCounts,
	options?: { cleaned?: boolean },
): ReviewSweepStatus {
	if (options?.cleaned) {
		return "cleaned";
	}
	return isSweepCompleteFromCounts(counts) ? "completed" : "in_progress";
}

export interface SweepSummary {
	tally: ReviewStatusTally;
	complete: boolean;
	status: ReviewSweepStatus;
}

/** One-shot summary for a suggestion list: tally + completeness + status. */
export function deriveSweepSummary(
	suggestions: readonly ReviewSuggestion[],
): SweepSummary {
	const tally = tallySuggestionStatuses(suggestions);
	const counts: SweepBlockingCounts = {
		pendingCount: tally.pending,
		unresolvedCount: tally.unresolved,
		deferredCount: tally.deferred,
	};
	return {
		tally,
		complete: isSweepCompleteFromCounts(counts),
		status: getSweepStatus(counts),
	};
}
