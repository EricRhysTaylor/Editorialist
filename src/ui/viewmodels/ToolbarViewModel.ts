// Pure toolbar-state projection, extracted verbatim from
// EditorialistPlugin.getToolbarState. No store / Obsidian / UI access — the
// caller (main.ts) gathers the resolved values into ToolbarStateInputs (see
// INPUT_GATHERERS) and this function performs only the priority-ordered
// if-ladder + return-shape assembly. Behavior is byte-identical to the prior
// inline logic; the ToolbarStateInputs fixtures are the parity gate.

import type { ToolbarState } from "../Toolbar";
import type { ReviewStatus } from "../../models/ReviewSuggestion";
import type { ReviewBranchInputs, ToolbarStateInputs } from "./ToolbarStateInputs";

function countStatus(statuses: readonly ReviewStatus[], status: ReviewStatus): number {
	return statuses.filter((value) => value === status).length;
}

function buildReviewState(hasReviewBlock: boolean, review: ReviewBranchInputs): ToolbarState {
	const { effectiveStatuses, selectedIndex, suggestionsLength } = review;
	const unresolvedPositions = effectiveStatuses
		.map((status, index) => ({ status, index }))
		.filter(({ status }) => status === "unresolved")
		.map(({ index }) => index + 1);

	return {
		mode: "review",
		anchorDirection: review.anchorDirection,
		hasReviewBlock,
		completionLabel: review.sweepComplete ? "sweep complete" : undefined,
		pendingCount: countStatus(effectiveStatuses, "pending"),
		acceptedCount: countStatus(effectiveStatuses, "accepted"),
		rejectedCount: countStatus(effectiveStatuses, "rejected"),
		deferredCount: countStatus(effectiveStatuses, "deferred"),
		rewrittenCount: countStatus(effectiveStatuses, "rewritten"),
		sceneProgressLabel: review.sceneProgressLabel,
		selectedIndexLabel:
			selectedIndex === -1 ? `${suggestionsLength} total` : `${selectedIndex + 1} of ${suggestionsLength}`,
		unresolvedCount: unresolvedPositions.length,
		unresolvedDetails:
			unresolvedPositions.length > 0 ? `Unresolved items: ${unresolvedPositions.join(", ")}` : undefined,
		canApply: review.canApply,
		canDefer: review.canDefer,
		canRewrite: review.canRewrite,
		canNext: review.canNext,
		canPrevious: review.canPrevious,
		canReject: review.canReject,
		canUndoLastAccept: review.canUndoLastAccept,
		operation: review.operation,
		operationLabel: review.operationLabel,
		selectedLabel:
			selectedIndex === -1
				? "Current suggestion"
				: `Suggestion ${selectedIndex + 1} of ${suggestionsLength}`,
	};
}

export function buildToolbarState(inputs: ToolbarStateInputs): ToolbarState | null {
	if (inputs.pendingEditsToolbarState) {
		return inputs.pendingEditsToolbarState;
	}

	if (!inputs.hasReviewBlock) {
		return null;
	}

	if (!inputs.hasSession) {
		return null;
	}

	const appliedReview = inputs.appliedReview;
	if (appliedReview && appliedReview.entryCount > 0) {
		return {
			mode: "applied_review",
			canUndo: inputs.canUndoLastAppliedSuggestion,
			currentIndexLabel: `${appliedReview.currentIndex + 1} of ${appliedReview.entryCount}`,
			title: "Review applied changes",
		};
	}

	const completedReview = inputs.completedReviewPreview;
	if (completedReview) {
		return {
			mode: "completed_review",
			currentIndexLabel: completedReview.currentIndexLabel,
			title: completedReview.title,
			canNext: inputs.completedReviewCanNext,
			canPrevious: inputs.completedReviewCanPrevious,
			canUndo: inputs.hasLastAppliedChange,
		};
	}

	const acceptedReview = inputs.acceptedReviewPreview;
	if (acceptedReview) {
		return {
			mode: "accepted_review",
			canNext: inputs.acceptedReviewCanNext,
			canPrevious: inputs.acceptedReviewCanPrevious,
			canUndo: inputs.canUndoLastAppliedSuggestion,
			currentIndexLabel: acceptedReview.currentIndexLabel,
			title: acceptedReview.title,
		};
	}

	const handoff = inputs.guidedSweepHandoff;
	if (handoff) {
		return {
			mode: "handoff",
			currentLabel: handoff.currentLabel,
			isFinal: handoff.isFinal,
			primaryActionLabel: handoff.primaryActionLabel,
			progressLabel: handoff.progressLabel,
			secondaryActionLabel: handoff.secondaryActionLabel,
			title: handoff.title,
		};
	}

	const panelOnly = inputs.panelOnly;
	if (panelOnly && !inputs.hasSelectedSuggestion) {
		return {
			mode: "panel",
			progressLabel: panelOnly.progressLabel,
			remainingLabel: `${panelOnly.remainingCount} remaining`,
			title: `Continue in ${panelOnly.unitLabel === "scene" ? "this scene" : "this note"}`,
		};
	}

	if (
		inputs.bulkApplyConfirmNotePath !== null &&
		inputs.bulkApplyConfirmNotePath === inputs.sessionNotePath &&
		inputs.canApplyAndReviewSceneSuggestions
	) {
		const count = inputs.bulkApplicableCount;
		return {
			mode: "bulk_confirm",
			countLabel: `${count} ${count === 1 ? "change" : "changes"}`,
			title: "Apply to all?",
		};
	}

	// Terminal/audit fallback: an active session whose work is fully decided
	// (no pending/deferred/unresolved) always converges to the "All revisions
	// complete" audit toolbar — review navigation + undo, no edit actions —
	// instead of a dead/empty toolbar. This is the lifecycle end state and
	// must not be preempted by handoff/panel/bulk (handled above).
	if (inputs.sessionHasNoOpenWork) {
		return {
			mode: "completed_review",
			title: "All revisions complete",
			canNext: inputs.completedReviewCanNext,
			canPrevious: inputs.completedReviewCanPrevious,
			canUndo: inputs.hasLastAppliedChange,
		};
	}

	// Open work remains but nothing is selected yet (transient — selection
	// auto-runs). No coherent terminal state to show.
	if (!inputs.hasSelectedSuggestion) {
		return null;
	}

	if (!inputs.review) {
		return null;
	}

	return buildReviewState(inputs.hasReviewBlock, inputs.review);
}
