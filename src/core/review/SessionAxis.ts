// Pure helpers carved out of main.ts's parse / resync / refresh axis. These
// are characterization seams for the eventual SessionOrchestrator extraction:
// they pin the exact behavior of three load-bearing pieces of logic so that
// extraction (Pass 14+) cannot silently regress them.
//
// Each function here is pure. No Obsidian, no store, no plugin state. Callers
// (currently src/main.ts) thread the inputs in and apply side effects on the
// way out.

import type { ReviewSession, ReviewSuggestion } from "../../models/ReviewSuggestion";
import type { SceneReviewRecord } from "../../models/ContributorProfile";
import type { CompletedSweepState } from "../../state/ReviewStore";

// Stable fingerprint used to decide whether a remembered lastAppliedChange
// still corresponds to the editor text we are looking at. Algorithm is djb2
// XOR (the same shape used in main.ts before this extraction); the exact bit
// shape is load-bearing because the value is persisted on lastAppliedChange.
export function computeNoteTextFingerprint(text: string): string {
	let hash = 5381;
	for (let index = 0; index < text.length; index += 1) {
		hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
	}
	return `${text.length}:${hash >>> 0}`;
}

// Stamp the just-accepted suggestion's status to "accepted" before handing the
// list to refreshSuggestions(). This is the pre-step inside
// refreshSessionAfterAcceptedEdit — separating it makes the
// "accepted-id-not-in-list" edge case explicit.
export function markSuggestionAcceptedForRefresh(
	suggestions: ReviewSuggestion[],
	acceptedSuggestionId: string,
): ReviewSuggestion[] {
	return suggestions.map((item) =>
		item.id === acceptedSuggestionId
			? {
					...item,
					status: "accepted",
				}
			: item,
	);
}

export interface CompletedSweepAuditTargetInput {
	completedSweep: CompletedSweepState;
	// Currently-open session, if any. Used to short-circuit when the active
	// session already covers a completed-sweep note and has at least one
	// completed suggestion to audit.
	currentSession: ReviewSession | null;
	// Caller-side predicate. main.ts threads through its effective-status
	// resolver so this function does not have to know about persisted decisions.
	isCompletedReviewSuggestion: (suggestion: ReviewSuggestion) => boolean;
	// Scene-record lookup. Returning null is treated as "no decisions yet."
	getRecordByPath: (notePath: string) => SceneReviewRecord | null;
}

// Picks which note path the completed-sweep audit should open. Priority:
//   1. Short-circuit (return null) if the current session already covers a
//      completed-sweep path AND already has at least one completed suggestion.
//   2. First sweep note path whose record has any decided suggestions
//      (accepted + rewritten + rejected > 0).
//   3. completedSweep.notePaths[currentNoteIndex].
//   4. completedSweep.notePaths[0].
//   5. null if the sweep has no paths.
//
// Returning null means "do not change the session" — either because the
// caller already has the right one, or because the sweep is empty.
export function selectCompletedSweepAuditTarget(
	input: CompletedSweepAuditTargetInput,
): string | null {
	const { completedSweep, currentSession, isCompletedReviewSuggestion, getRecordByPath } = input;

	if (
		currentSession &&
		completedSweep.notePaths.includes(currentSession.notePath) &&
		currentSession.suggestions.some((suggestion) => isCompletedReviewSuggestion(suggestion))
	) {
		return null;
	}

	const candidate =
		completedSweep.notePaths.find((notePath) => {
			const record = getRecordByPath(notePath);
			return Boolean(record && record.acceptedCount + record.rewrittenCount + record.rejectedCount > 0);
		}) ?? completedSweep.notePaths[completedSweep.currentNoteIndex] ?? completedSweep.notePaths[0];

	return candidate ?? null;
}
