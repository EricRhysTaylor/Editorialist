import { describe, it, expect } from "vitest";
import type { EditSuggestion, ReviewSuggestion } from "../../models/ReviewSuggestion";
import {
	REVIEW_PANEL_BRANCH_ORDER,
	selectPanelPrimarySuggestionId,
	selectReviewPanelBranch,
	shouldShowReviewerFilters,
	type ReviewPanelBranch,
	type ReviewPanelStateInputs,
} from "./ReviewPanelViewModel";
import { REVIEW_PANEL_FIXTURES, makeInputs } from "./ReviewPanelViewModel.fixtures";

// Guard-only oracle. Mirrors ONLY the if-ladder ordering of
// ReviewPanel.render() — independent of selectReviewPanelBranch's
// implementation. Each fixture must agree with this oracle AND with the
// projection; together they pin the branch decision behavior before the
// eventual ReviewPanel file split.
function selectBranch(i: ReviewPanelStateInputs): ReviewPanelBranch {
	if (i.hasCompletedSweep) return "completed_sweep";
	if (!i.hasSession) {
		return i.hasPostCompletionIdle ? "idle:post-completion" : "idle:workspace";
	}
	if (i.suggestionsLength === 0) return "session:no-suggestions";
	if (i.hasHandoff) return "session:handoff";
	if (!i.hasFilteredSuggestions) return "session:filtered-empty";
	return "session:list";
}

describe("ReviewPanelViewModel — branch coverage", () => {
	it("every branch is covered by a fixture", () => {
		const covered = new Set(REVIEW_PANEL_FIXTURES.map((f) => f.branch));
		for (const branch of REVIEW_PANEL_BRANCH_ORDER) {
			expect(covered.has(branch), `missing fixture for branch ${branch}`).toBe(true);
		}
	});

	it("every fixture targets a declared branch", () => {
		const declared = new Set<ReviewPanelBranch>(REVIEW_PANEL_BRANCH_ORDER);
		for (const fixture of REVIEW_PANEL_FIXTURES) {
			expect(declared.has(fixture.branch), `unknown branch in fixture "${fixture.name}"`).toBe(true);
		}
	});
});

describe("ReviewPanelViewModel — fixture parity", () => {
	for (const fixture of REVIEW_PANEL_FIXTURES) {
		it(`"${fixture.name}" — oracle lands in ${fixture.branch}`, () => {
			expect(selectBranch(fixture.inputs)).toBe(fixture.branch);
		});

		it(`"${fixture.name}" — selectReviewPanelBranch lands in ${fixture.branch}`, () => {
			expect(selectReviewPanelBranch(fixture.inputs)).toBe(fixture.branch);
		});
	}
});

describe("selectReviewPanelBranch — precedence invariants", () => {
	it("completed sweep wins over every other input", () => {
		expect(
			selectReviewPanelBranch(
				makeInputs({
					hasCompletedSweep: true,
					hasSession: true,
					hasPostCompletionIdle: true,
					suggestionsLength: 5,
					hasHandoff: true,
					hasFilteredSuggestions: true,
				}),
			),
		).toBe("completed_sweep");
	});

	it("post-completion idle requires !session", () => {
		// hasPostCompletionIdle is only ever set when !session; if the gatherer
		// stays correct this combination cannot occur in practice. But the
		// projection itself prioritizes hasSession=true into the session ladder
		// regardless, which is the right defensive choice — verify it.
		expect(
			selectReviewPanelBranch(
				makeInputs({ hasSession: true, hasPostCompletionIdle: true, suggestionsLength: 1, hasFilteredSuggestions: true }),
			),
		).toBe("session:list");
	});

	it("handoff preempts filtered-empty even when filter would remove everything", () => {
		expect(
			selectReviewPanelBranch(
				makeInputs({
					hasSession: true,
					suggestionsLength: 4,
					hasHandoff: true,
					hasFilteredSuggestions: false,
				}),
			),
		).toBe("session:handoff");
	});

	it("session list is the default terminal branch", () => {
		expect(
			selectReviewPanelBranch(
				makeInputs({ hasSession: true, suggestionsLength: 1, hasFilteredSuggestions: true }),
			),
		).toBe("session:list");
	});
});

// ── shouldShowReviewerFilters ────────────────────────────────────────────

function makeEditSuggestion(overrides: Partial<EditSuggestion> = {}): EditSuggestion {
	return {
		id: "s",
		operation: "edit",
		status: "pending",
		contributor: {
			id: "c",
			displayName: "C",
			kind: "human",
			reviewerType: "editor",
			resolutionStatus: "exact",
			suggestedReviewerIds: [],
			raw: {},
		},
		source: { blockIndex: 0, entryIndex: 0 },
		location: { primary: { text: "x", matchType: "exact" } },
		executionMode: "direct",
		payload: { original: "x", revised: "y" },
		...overrides,
	};
}

function withContributor(
	id: string,
	reviewerId: string | undefined,
	suggestionId = id,
): EditSuggestion {
	return makeEditSuggestion({
		id: suggestionId,
		contributor: {
			id,
			displayName: id,
			kind: "human",
			reviewerType: "editor",
			reviewerId,
			resolutionStatus: reviewerId ? "exact" : "unresolved",
			suggestedReviewerIds: [],
			raw: {},
		},
	});
}

describe("shouldShowReviewerFilters", () => {
	it("returns false for an empty list", () => {
		expect(shouldShowReviewerFilters([])).toBe(false);
	});

	it("returns false for a single reviewer", () => {
		expect(
			shouldShowReviewerFilters([
				withContributor("alex", "r:alex", "a1"),
				withContributor("alex", "r:alex", "a2"),
			]),
		).toBe(false);
	});

	it("returns true once two distinct reviewerIds appear", () => {
		expect(
			shouldShowReviewerFilters([
				withContributor("alex", "r:alex", "a1"),
				withContributor("blair", "r:blair", "b1"),
			]),
		).toBe(true);
	});

	it("falls back to contributor.id when reviewerId is missing (unresolved still counts)", () => {
		// Two unresolved contributors with DIFFERENT ids should still surface
		// the filter — the panel uses reviewerId ?? id as the key.
		expect(
			shouldShowReviewerFilters([
				withContributor("alex", undefined, "a1"),
				withContributor("blair", undefined, "b1"),
			]),
		).toBe(true);
	});

	it("collapses a resolved reviewer and an unresolved suggestion under the same fallback id", () => {
		// Same id, one resolved one unresolved → still two distinct keys
		// (the reviewerId is "r:alex", the fallback id is "alex").
		expect(
			shouldShowReviewerFilters([
				withContributor("alex", "r:alex", "a1"),
				withContributor("alex", undefined, "a2"),
			]),
		).toBe(true);
	});

	it("drops empty-string keys (matches the original Boolean() filter)", () => {
		// An empty string for both reviewerId AND id should be dropped, so the
		// resulting set has only the one real reviewer.
		expect(
			shouldShowReviewerFilters([
				withContributor("", "", "x1"),
				withContributor("alex", "r:alex", "a1"),
			]),
		).toBe(false);
	});
});

// ── selectPanelPrimarySuggestionId ───────────────────────────────────────

describe("selectPanelPrimarySuggestionId", () => {
	it("returns null when there are no suggestions", () => {
		expect(selectPanelPrimarySuggestionId([], null)).toBeNull();
		expect(selectPanelPrimarySuggestionId([], "s1")).toBeNull();
	});

	it("returns the selected id when it is still open", () => {
		const suggestions: ReviewSuggestion[] = [
			makeEditSuggestion({ id: "s1", status: "pending" }),
			makeEditSuggestion({ id: "s2", status: "pending" }),
		];
		expect(selectPanelPrimarySuggestionId(suggestions, "s2")).toBe("s2");
	});

	it("falls through to the first open suggestion when the selection has been closed", () => {
		const suggestions: ReviewSuggestion[] = [
			makeEditSuggestion({ id: "s1", status: "accepted" }),
			makeEditSuggestion({ id: "s2", status: "pending" }),
			makeEditSuggestion({ id: "s3", status: "pending" }),
		];
		expect(selectPanelPrimarySuggestionId(suggestions, "s1")).toBe("s2");
	});

	it("treats deferred and unresolved as open", () => {
		const suggestions: ReviewSuggestion[] = [
			makeEditSuggestion({ id: "s1", status: "rejected" }),
			makeEditSuggestion({ id: "s2", status: "deferred" }),
			makeEditSuggestion({ id: "s3", status: "unresolved" }),
		];
		expect(selectPanelPrimarySuggestionId(suggestions, null)).toBe("s2");
	});

	it("treats an implicitly-accepted suggestion as closed (uses effective status, not raw)", () => {
		// A pending suggestion whose primary target has matchType "already_applied"
		// is implicitly accepted -> effective status accepted -> not open.
		const implicit = makeEditSuggestion({
			id: "s1",
			status: "pending",
			location: { primary: { text: "x", matchType: "already_applied" } },
		});
		const open = makeEditSuggestion({ id: "s2", status: "pending" });
		expect(selectPanelPrimarySuggestionId([implicit, open], "s1")).toBe("s2");
	});

	it("returns null when nothing is open and nothing is selected", () => {
		const suggestions: ReviewSuggestion[] = [
			makeEditSuggestion({ id: "s1", status: "accepted" }),
			makeEditSuggestion({ id: "s2", status: "rejected" }),
		];
		expect(selectPanelPrimarySuggestionId(suggestions, null)).toBeNull();
	});

	it("returns null when the selection is closed and no other suggestion is open", () => {
		const suggestions: ReviewSuggestion[] = [
			makeEditSuggestion({ id: "s1", status: "accepted" }),
			makeEditSuggestion({ id: "s2", status: "rejected" }),
		];
		expect(selectPanelPrimarySuggestionId(suggestions, "s1")).toBeNull();
	});
});
