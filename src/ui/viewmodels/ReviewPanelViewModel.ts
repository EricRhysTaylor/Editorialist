// Pure projection layer for ReviewPanel.
//
// ReviewPanel.ts (2,006 lines) owns DOM rendering; this module owns the
// decisions ReviewPanel makes about WHICH top-level layout fires and the
// small pure helpers it used to inline. Extracting these now — before
// splitting the panel into per-section files — gives the eventual split a
// frozen contract to refactor against. The fixtures in
// ReviewPanelViewModel.fixtures.ts are an active parity gate over the
// branch-selection logic.
//
// This module performs no DOM work, holds no state, and does not import
// Obsidian. It mirrors the pattern established by ToolbarStateInputs /
// ToolbarViewModel.

import { isSuggestionOpen } from "../../core/OperationSupport";
import type { ReviewSuggestion } from "../../models/ReviewSuggestion";

// Ordered exactly as ReviewPanel.render() evaluates. The first matching
// branch wins; later branches require all earlier guards to be falsy.
//
// Source ladder (ReviewPanel.render()):
//   1. completedSweep present                                          -> completed_sweep
//   2. !session && postCompletionIdle && !hasReviewActivityHistory     -> idle:post-completion
//   3. !session && (otherwise)                                         -> idle:workspace
//   4. session && suggestions.length === 0                             -> session:no-suggestions
//   5. session && suggestions.length > 0 && handoff                    -> session:handoff
//   6. session && suggestions.length > 0 && !handoff
//        && getFilteredSuggestions(...).length === 0                   -> session:filtered-empty
//   7. session && suggestions.length > 0 && !handoff
//        && getFilteredSuggestions(...).length > 0                     -> session:list
//
// Branch 2 (the compact "No active review" onboarding card) now requires
// BOTH a post-completion idle signal AND the absence of any prior review
// activity — it is reserved for a genuinely new / empty workspace. Any
// existing review history, recent sweep, pending edit, or contributor
// history routes to the richer idle:workspace view instead, even when the
// plugin's post-completion gate would otherwise fire.
export const REVIEW_PANEL_BRANCH_ORDER = [
	"completed_sweep",
	"idle:post-completion",
	"idle:workspace",
	"session:no-suggestions",
	"session:handoff",
	"session:filtered-empty",
	"session:list",
] as const;
export type ReviewPanelBranch = (typeof REVIEW_PANEL_BRANCH_ORDER)[number];

// Everything ReviewPanel.render() needs to choose its top-level branch,
// fully resolved. The gatherers (the plugin/store/session reads ReviewPanel
// currently does inline at the top of render()) own the actual reads; this
// projection only sees plain booleans/counts.
export interface ReviewPanelStateInputs {
	hasCompletedSweep: boolean; // Boolean(plugin.getCompletedSweepPanelState())
	hasSession: boolean; // plugin.getCurrentReviewSession() != null
	hasPostCompletionIdle: boolean; // !session && !completedSweep && plugin.getPostCompletionIdleState() != null
	// True when ANY of the following indicates prior review activity or
	// pending work: sweep registry entries, pending-edits segments, stored
	// reviewer profiles, or a non-empty review-state overview. Used to gate
	// the compact "No active review" onboarding card so it appears only for
	// genuinely empty workspaces.
	hasReviewActivityHistory: boolean;
	suggestionsLength: number; // session?.suggestions.length ?? 0
	hasHandoff: boolean; // session && plugin.getGuidedSweepHandoffState() != null
	hasFilteredSuggestions: boolean; // session && getFilteredSuggestions(session.suggestions).length > 0
}

// Which ReviewPanel reads feed each input. Mirrors INPUT_GATHERERS in
// ToolbarStateInputs.ts; useful when wiring main.ts to gather these eagerly.
export const REVIEW_PANEL_INPUT_GATHERERS: Record<keyof ReviewPanelStateInputs, string> = {
	hasCompletedSweep: "Boolean(plugin.getCompletedSweepPanelState())",
	hasSession: "plugin.getCurrentReviewSession() != null",
	hasPostCompletionIdle:
		"!session && !completedSweep ? Boolean(plugin.getPostCompletionIdleState()) : false",
	hasReviewActivityHistory:
		"plugin.getSweepRegistryEntries().length > 0 || (plugin.getPendingEditsSummary()?.segmentCount ?? 0) > 0 || plugin.getSortedReviewerProfiles().length > 0 || plugin.getReviewStateOverview() != null",
	suggestionsLength: "session?.suggestions.length ?? 0",
	hasHandoff: "session ? Boolean(plugin.getGuidedSweepHandoffState()) : false",
	hasFilteredSuggestions:
		"session ? getFilteredSuggestions(session.suggestions).length > 0 : false",
};

export function selectReviewPanelBranch(inputs: ReviewPanelStateInputs): ReviewPanelBranch {
	if (inputs.hasCompletedSweep) {
		return "completed_sweep";
	}

	if (!inputs.hasSession) {
		// Compact onboarding card is reserved for a genuinely empty workspace:
		// the post-completion idle gate must fire AND there must be no prior
		// review activity to anchor a history view on. Every other idle case
		// falls through to the richer workspace composition.
		if (inputs.hasPostCompletionIdle && !inputs.hasReviewActivityHistory) {
			return "idle:post-completion";
		}
		return "idle:workspace";
	}

	if (inputs.suggestionsLength === 0) {
		return "session:no-suggestions";
	}

	if (inputs.hasHandoff) {
		return "session:handoff";
	}

	if (!inputs.hasFilteredSuggestions) {
		return "session:filtered-empty";
	}

	return "session:list";
}

// ── Pure helpers extracted from ReviewPanel ──────────────────────────────

// True when more than one distinct reviewer identity contributes to the
// suggestion set. The key is `reviewerId ?? id` so a suggestion that has not
// yet been resolved to a stored reviewer still counts under its raw
// contributor id — falsy keys (empty string / undefined) are dropped, which
// matches the original Boolean() filter ReviewPanel used.
export function shouldShowReviewerFilters(suggestions: readonly ReviewSuggestion[]): boolean {
	const reviewerIds = new Set<string>();
	for (const suggestion of suggestions) {
		const key = suggestion.contributor.reviewerId ?? suggestion.contributor.id;
		if (key) {
			reviewerIds.add(key);
		}
	}
	return reviewerIds.size > 1;
}

// The "primary" card ReviewPanel highlights in panel-only mode. When the
// currently selected suggestion is still open (effective status is pending /
// deferred / unresolved), it wins; otherwise the first open suggestion in
// list order is picked. "Open" follows getEffectiveSuggestionStatus via
// isSuggestionOpen, NOT raw suggestion.status — so an implicitly-accepted
// suggestion is correctly treated as closed even when its persisted status
// is still pending.
export function selectPanelPrimarySuggestionId(
	suggestions: readonly ReviewSuggestion[],
	selectedSuggestionId: string | null,
): string | null {
	if (
		selectedSuggestionId &&
		suggestions.some(
			(suggestion) => suggestion.id === selectedSuggestionId && isSuggestionOpen(suggestion),
		)
	) {
		return selectedSuggestionId;
	}

	return suggestions.find(isSuggestionOpen)?.id ?? null;
}
