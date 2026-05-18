import { describe, it, expect } from "vitest";
import type { ToolbarState } from "../Toolbar";
import {
	TOOLBAR_BRANCH_ORDER,
	type ToolbarBranch,
	type ToolbarStateInputs,
} from "./ToolbarStateInputs";
import { TOOLBAR_FIXTURES, makeInputs } from "./ToolbarStateInputs.fixtures";
import { buildToolbarState } from "./ToolbarViewModel";

// Guard-only oracle. Mirrors ONLY the if-ladder ordering of
// EditorialistPlugin.getToolbarState — it does not build any ToolbarState.
// Its job is to prove each fixture's inputs unambiguously select the
// intended branch under the documented precedence. When ToolbarViewModel is
// extracted, buildToolbarState must agree with this branch selection AND
// emit fixture.expected.
function selectBranch(i: ToolbarStateInputs): ToolbarBranch {
	if (i.pendingEditsToolbarState) return "pending_edits_review";
	if (!i.hasReviewBlock) return "null:no-review-block";
	if (!i.hasSession) return "null:no-session";
	if (i.appliedReview && i.appliedReview.entryCount > 0) return "applied_review";
	if (i.completedReviewPreview) return "completed_review";
	if (i.acceptedReviewPreview) return "accepted_review";
	if (i.guidedSweepHandoff) return "handoff";
	if (i.panelOnly && !i.hasSelectedSuggestion) return "panel:pre-selection";
	if (
		i.bulkApplyConfirmNotePath !== null &&
		i.bulkApplyConfirmNotePath === i.sessionNotePath &&
		i.canApplyAndReviewSceneSuggestions
	) {
		return "bulk_confirm";
	}
	if (!i.hasSelectedSuggestion) {
		// NOTE: getToolbarState also has `if (panelOnly) return panel` here, but
		// branch 8 already returned for `panelOnly && !selected`, so that inner
		// panel return is UNREACHABLE. Only the null path is live here.
		return i.panelOnly ? "panel:post-selection" : "null:no-selection";
	}
	return "review";
}

const REQUIRED_KEYS: Record<ToolbarState["mode"], string[]> = {
	pending_edits_review: [
		"mode",
		"title",
		"sceneLabel",
		"segmentKindLabel",
		"segmentIndexLabel",
		"segmentActionText",
		"canComplete",
		"canNext",
		"canPrevious",
	],
	applied_review: ["mode", "canUndo", "currentIndexLabel", "title"],
	completed_review: ["mode", "canNext", "canPrevious", "canUndo", "title"],
	accepted_review: ["mode", "canNext", "canPrevious", "canUndo", "currentIndexLabel", "title"],
	handoff: ["mode", "currentLabel", "isFinal", "primaryActionLabel", "progressLabel", "title"],
	panel: ["mode", "remainingLabel", "title"],
	bulk_confirm: ["mode", "countLabel", "title"],
	review: [
		"mode",
		"canApply",
		"canDefer",
		"canNext",
		"canPrevious",
		"canReject",
		"canRewrite",
		"canUndoLastAccept",
		"acceptedCount",
		"deferredCount",
		"hasReviewBlock",
		"operation",
		"operationLabel",
		"pendingCount",
		"rejectedCount",
		"rewrittenCount",
		"selectedIndexLabel",
		"selectedLabel",
		"unresolvedCount",
	],
};

describe("ToolbarState parity scaffold — branch coverage", () => {
	it("every branch is covered by a fixture, or documented unreachable", () => {
		const covered = new Set(TOOLBAR_FIXTURES.map((f) => f.branch));
		const UNREACHABLE: ToolbarBranch[] = ["panel:post-selection"];
		for (const branch of TOOLBAR_BRANCH_ORDER) {
			if (UNREACHABLE.includes(branch)) {
				expect(covered.has(branch), `${branch} is documented unreachable; no fixture expected`).toBe(false);
				continue;
			}
			expect(covered.has(branch), `missing fixture for branch ${branch}`).toBe(true);
		}
	});

	it("the documented-unreachable inner panel return cannot fire", () => {
		// Construct the only inputs that could reach branch 10's panel return:
		// no selection + panelOnly present. selectBranch must route to branch 8
		// (panel:pre-selection) first, proving 10's panel path is dead code.
		const candidate: ToolbarStateInputs = TOOLBAR_FIXTURES.find(
			(f) => f.branch === "panel:pre-selection",
		)!.inputs;
		expect(candidate.panelOnly).not.toBeNull();
		expect(candidate.hasSelectedSuggestion).toBe(false);
		expect(selectBranch(candidate)).toBe("panel:pre-selection");
	});
});

describe("ToolbarState parity scaffold — fixture integrity", () => {
	for (const fixture of TOOLBAR_FIXTURES) {
		it(`"${fixture.name}" — inputs select branch ${fixture.branch}`, () => {
			expect(selectBranch(fixture.inputs)).toBe(fixture.branch);
		});

		it(`"${fixture.name}" — expected conforms to ToolbarState`, () => {
			if (fixture.branch.startsWith("null:")) {
				expect(fixture.expected).toBeNull();
				return;
			}
			const state = fixture.expected;
			expect(state).not.toBeNull();
			const mode = state!.mode as ToolbarState["mode"];
			const required = REQUIRED_KEYS[mode];
			expect(required, `unknown mode ${mode}`).toBeDefined();
			for (const key of required) {
				expect(key in state!, `${mode} missing required key "${key}"`).toBe(true);
			}
		});
	}
});

describe("accepted_review toolbar navigation (consistency with completed_review)", () => {
	const base = {
		hasReviewBlock: true,
		hasSession: true,
		acceptedReviewPreview: { currentIndexLabel: "1 of 3", title: "Review accepted edits" },
	} as const;

	it("exposes canNext/canPrevious driven by adjacency inputs", () => {
		const state = buildToolbarState(
			makeInputs({ ...base, acceptedReviewCanNext: true, acceptedReviewCanPrevious: true }),
		);
		expect(state?.mode).toBe("accepted_review");
		expect(state).toMatchObject({ canNext: true, canPrevious: true });
	});

	it("reflects disabled navigation when no adjacent accepted suggestion exists", () => {
		const state = buildToolbarState(
			makeInputs({ ...base, acceptedReviewCanNext: false, acceptedReviewCanPrevious: false }),
		);
		expect(state).toMatchObject({ mode: "accepted_review", canNext: false, canPrevious: false });
	});
});

// ── PARITY GATE (active) ─────────────────────────────────────────────────
// buildToolbarState is now extracted; every golden fixture must round-trip.
describe("buildToolbarState parity", () => {
	for (const fixture of TOOLBAR_FIXTURES) {
		it(`"${fixture.name}" produces the captured ToolbarState`, () => {
			expect(buildToolbarState(fixture.inputs)).toEqual(fixture.expected);
		});
	}
});
