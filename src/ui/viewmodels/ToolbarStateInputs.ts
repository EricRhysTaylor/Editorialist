// PROPOSAL ONLY — not wired into main.ts yet.
//
// Parity scaffold for the eventual extraction of
// EditorialistPlugin.getToolbarState(hasReviewBlock) into a pure
// `buildToolbarState(inputs)`. Capturing the input contract + golden
// fixtures NOW lets the future extraction be a behavior-neutral move:
// flip the fixtures' `expected` to `buildToolbarState(inputs)` and the
// test becomes a true parity gate with zero new fixture authoring.
//
// getToolbarState is a *priority-ordered decision tree*. It performs no
// mutation and writes no state — it is already a pure projection of
// resolved values. Therefore `buildToolbarState` needs NO callbacks: every
// input below is plain data, pre-resolved by the existing main.ts helper
// methods (the "input gatherers"). See PRECEDENCE / INPUT_GATHERERS.

import type { ReviewStatus, SupportedReviewOperationType } from "../../models/ReviewSuggestion";
import type { ToolbarState } from "../Toolbar";

// Ordered exactly as getToolbarState evaluates. The first matching branch
// wins; later branches require all earlier guards to be falsy.
export const TOOLBAR_BRANCH_ORDER = [
	"pending_edits_review", // 1. getPendingEditsToolbarState() truthy
	"null:no-review-block", // 2. !hasReviewBlock
	"null:no-session", // 3. getReviewSession() == null
	"applied_review", // 4. appliedReview.entries.length > 0
	"completed_review", // 5. getCompletedReviewPreviewState(session)
	"accepted_review", // 6. getAcceptedReviewPreviewState(session)
	"handoff", // 7. getGuidedSweepHandoffState()
	"panel:pre-selection", // 8. panelOnly && !selectedSuggestion
	"bulk_confirm", // 9. bulkApplyConfirm matches note && canApplyAndReview
	"panel:post-selection", // 10. !selected && panelOnly
	"null:no-selection", // 10b. !selected && !panelOnly
	"review", // 11. selected present
] as const;
export type ToolbarBranch = (typeof TOOLBAR_BRANCH_ORDER)[number];

// Sub-state shapes, mirrored from the helper return types so fixtures stay
// decoupled from main.ts internals.
export interface AppliedReviewInput {
	currentIndex: number;
	entryCount: number;
}
export interface CompletedReviewPreviewInput {
	currentIndexLabel?: string;
	title: string;
}
export interface AcceptedReviewPreviewInput {
	currentIndexLabel: string;
	title: string;
}
export interface GuidedSweepHandoffInput {
	currentLabel: string;
	isFinal: boolean;
	primaryActionLabel: string;
	progressLabel: string;
	secondaryActionLabel?: string;
	title: string;
}
export interface PanelOnlyInput {
	progressLabel?: string;
	remainingCount: number;
	unitLabel: "scene" | "note" | string;
}

// Everything getToolbarState consults, fully resolved. NOTE: the "review"
// branch values are pre-tallied here on purpose — the projection should not
// re-derive counts; the gatherers own that.
export interface ToolbarStateInputs {
	// Guards / precedence
	pendingEditsToolbarState: ToolbarState | null;
	hasReviewBlock: boolean;
	hasSession: boolean;
	sessionNotePath: string | null;

	// Preview branches
	appliedReview: AppliedReviewInput | null;
	completedReviewPreview: CompletedReviewPreviewInput | null;
	completedReviewCanNext: boolean;
	completedReviewCanPrevious: boolean;
	hasLastAppliedChange: boolean; // Boolean(this.lastAppliedChange)
	canUndoLastAppliedSuggestion: boolean;
	acceptedReviewPreview: AcceptedReviewPreviewInput | null;
	guidedSweepHandoff: GuidedSweepHandoffInput | null;
	panelOnly: PanelOnlyInput | null;
	hasSelectedSuggestion: boolean;

	// Bulk confirm
	bulkApplyConfirmNotePath: string | null;
	canApplyAndReviewSceneSuggestions: boolean;
	bulkApplicableCount: number;

	// Review branch (only consulted when a suggestion is selected)
	review: ReviewBranchInputs | null;
}

export interface ReviewBranchInputs {
	hasReviewBlock: boolean;
	selectedIndex: number; // -1 when not found
	suggestionsLength: number;
	effectiveStatuses: ReviewStatus[]; // per-suggestion, in order
	anchorDirection?: "above" | "below";
	sweepComplete: boolean; // -> completionLabel "sweep complete" | undefined
	sceneProgressLabel?: string;
	canApply: boolean;
	canDefer: boolean;
	canRewrite: boolean;
	canReject: boolean;
	canNext: boolean;
	canPrevious: boolean;
	canUndoLastAccept: boolean;
	operation: SupportedReviewOperationType;
	operationLabel: string;
}

// Which existing main.ts members feed each input. These STAY in main.ts as
// input gatherers; only the final projection moves. None are callbacks —
// they are evaluated once, eagerly, before buildToolbarState is called.
export const INPUT_GATHERERS: Record<keyof ToolbarStateInputs, string> = {
	pendingEditsToolbarState: "getPendingEditsToolbarState()",
	hasReviewBlock: "param",
	hasSession: "getReviewSession() != null",
	sessionNotePath: "getReviewSession()?.notePath",
	appliedReview: "store.getAppliedReview()",
	completedReviewPreview: "getCompletedReviewPreviewState(session)",
	completedReviewCanNext: 'getAdjacentCompletedReviewSuggestionId("next") !== null',
	completedReviewCanPrevious: 'getAdjacentCompletedReviewSuggestionId("previous") !== null',
	hasLastAppliedChange: "Boolean(this.lastAppliedChange)",
	canUndoLastAppliedSuggestion: "canUndoLastAppliedSuggestion()",
	acceptedReviewPreview: "getAcceptedReviewPreviewState(session)",
	guidedSweepHandoff: "getGuidedSweepHandoffState()",
	panelOnly: "getPanelOnlyReviewStateForSession(session)",
	hasSelectedSuggestion: "store.getSelectedSuggestion() != null",
	bulkApplyConfirmNotePath: "this.bulkApplyConfirmState?.notePath ?? null",
	canApplyAndReviewSceneSuggestions: "canApplyAndReviewSceneSuggestions()",
	bulkApplicableCount: "session.suggestions.filter(canApplySuggestionInReviewAllMode).length",
	review: "store.getSelectedSuggestion() + counts/predicates (see ReviewBranchInputs)",
};
