import { describe, it, expect } from "vitest";
import { SuggestionParser } from "../SuggestionParser";
import { ContributorDirectory } from "../../state/ContributorDirectory";
import type { ReviewStatus, ReviewSuggestion } from "../../models/ReviewSuggestion";
import {
	deriveSweepSummary,
	getSweepStatus,
	isSweepComplete,
	isSweepCompleteFromCounts,
	isSweepCompleteFromTally,
	tallyReviewStatuses,
	tallySuggestionStatuses,
} from "./SweepCompletion";

function buildEditSuggestion(status: ReviewStatus): ReviewSuggestion {
	const parser = new SuggestionParser(new ContributorDirectory());
	const note = `\`\`\`editorialist-review
Reviewer: GPT-5.4
ReviewerType: ai-editor

=== EDIT ===
SceneId: scn_test
Original: the original line
Revised: the revised line
Why: testing
\`\`\``;
	const parsed = parser.parse(note);
	const suggestion = parsed.suggestions[0];
	if (!suggestion) throw new Error("expected one suggestion");
	suggestion.status = status;
	return suggestion;
}

describe("SweepCompletion — tally", () => {
	it("tallies a flat status list with totalSuggestions", () => {
		const tally = tallyReviewStatuses([
			"pending",
			"pending",
			"accepted",
			"rejected",
			"deferred",
			"unresolved",
			"rewritten",
		]);
		expect(tally).toEqual({
			totalSuggestions: 7,
			pending: 2,
			accepted: 1,
			rejected: 1,
			deferred: 1,
			unresolved: 1,
			rewritten: 1,
		});
	});

	it("empty list tallies to all zero", () => {
		expect(tallyReviewStatuses([])).toEqual({
			totalSuggestions: 0,
			pending: 0,
			accepted: 0,
			rejected: 0,
			deferred: 0,
			unresolved: 0,
			rewritten: 0,
		});
	});

	it("tallies suggestions by effective status", () => {
		const tally = tallySuggestionStatuses([
			buildEditSuggestion("pending"),
			buildEditSuggestion("accepted"),
			buildEditSuggestion("rejected"),
		]);
		expect(tally.totalSuggestions).toBe(3);
		expect(tally.pending).toBe(1);
		expect(tally.accepted).toBe(1);
		expect(tally.rejected).toBe(1);
	});
});

describe("SweepCompletion — completion rule", () => {
	it("pending blocks completion", () => {
		expect(isSweepCompleteFromCounts({ pendingCount: 1, unresolvedCount: 0, deferredCount: 0 })).toBe(false);
	});

	it("unresolved blocks completion", () => {
		expect(isSweepCompleteFromCounts({ pendingCount: 0, unresolvedCount: 1, deferredCount: 0 })).toBe(false);
	});

	it("deferred blocks completion", () => {
		expect(isSweepCompleteFromCounts({ pendingCount: 0, unresolvedCount: 0, deferredCount: 1 })).toBe(false);
	});

	it("only accepted/rejected/rewritten => complete", () => {
		expect(isSweepCompleteFromCounts({ pendingCount: 0, unresolvedCount: 0, deferredCount: 0 })).toBe(true);
		const tally = tallyReviewStatuses(["accepted", "rejected", "rewritten", "accepted"]);
		expect(isSweepCompleteFromTally(tally)).toBe(true);
	});

	it("a mixed fully-decided batch is complete", () => {
		const suggestions = [
			buildEditSuggestion("accepted"),
			buildEditSuggestion("rejected"),
			buildEditSuggestion("rewritten"),
		];
		expect(isSweepComplete(suggestions)).toBe(true);
	});

	it("any open item prevents completion of an otherwise-decided batch", () => {
		for (const open of ["pending", "deferred", "unresolved"] as const) {
			const suggestions = [
				buildEditSuggestion("accepted"),
				buildEditSuggestion("rejected"),
				buildEditSuggestion(open),
			];
			expect(isSweepComplete(suggestions)).toBe(false);
		}
	});

	it("an empty suggestion list is trivially complete", () => {
		expect(isSweepComplete([])).toBe(true);
	});
});

function buildOpSuggestion(
	kind: "move" | "condense",
	status: ReviewStatus,
): ReviewSuggestion {
	const parser = new SuggestionParser(new ContributorDirectory());
	const section =
		kind === "move"
			? `=== MOVE ===
SceneId: scn_test
Target: the target line
After: the anchor line
Why: testing`
			: `=== CONDENSE ===
SceneId: scn_test
Target: the long passage to tighten
Suggestion: tight
Why: testing`;
	const note = `\`\`\`editorialist-review
Reviewer: GPT-5.4
ReviewerType: ai-editor

${section}
\`\`\``;
	const parsed = parser.parse(note);
	const suggestion = parsed.suggestions[0];
	if (!suggestion) throw new Error(`expected one ${kind} suggestion`);
	if (suggestion.operation !== kind) {
		throw new Error(`expected ${kind}, got ${suggestion.operation}`);
	}
	suggestion.status = status;
	return suggestion;
}

describe("SweepCompletion — canonical rule across all operations (mixed pass)", () => {
	it("MOVE and CONDENSE tally by status identically to EDIT", () => {
		for (const kind of ["move", "condense"] as const) {
			expect(tallySuggestionStatuses([buildOpSuggestion(kind, "accepted")]).accepted).toBe(1);
			expect(tallySuggestionStatuses([buildOpSuggestion(kind, "rejected")]).rejected).toBe(1);
			expect(tallySuggestionStatuses([buildOpSuggestion(kind, "rewritten")]).rewritten).toBe(1);
			expect(tallySuggestionStatuses([buildOpSuggestion(kind, "pending")]).pending).toBe(1);
		}
	});

	it("a fully-decided mixed pass (accept/reject/rewrite + MOVE + CONDENSE) is complete", () => {
		const suggestions = [
			buildEditSuggestion("accepted"),
			buildEditSuggestion("rejected"),
			buildEditSuggestion("rewritten"),
			buildOpSuggestion("move", "accepted"),
			buildOpSuggestion("condense", "rewritten"),
		];
		const tally = tallySuggestionStatuses(suggestions);
		// DONE = accepted + rejected + rewritten ; OPEN = pending + deferred + unresolved
		expect(tally.accepted + tally.rejected + tally.rewritten).toBe(5);
		expect(tally.pending + tally.deferred + tally.unresolved).toBe(0);
		expect(isSweepComplete(suggestions)).toBe(true);
		expect(deriveSweepSummary(suggestions).status).toBe("completed");
	});

	it("one still-open MOVE keeps the same mixed pass incomplete", () => {
		const suggestions = [
			buildEditSuggestion("accepted"),
			buildEditSuggestion("rejected"),
			buildOpSuggestion("condense", "rewritten"),
			buildOpSuggestion("move", "deferred"), // OPEN
		];
		expect(isSweepComplete(suggestions)).toBe(false);
		expect(deriveSweepSummary(suggestions).status).toBe("in_progress");
	});
});

describe("SweepCompletion — derived status", () => {
	it("getSweepStatus reflects counts and the cleaned override", () => {
		expect(getSweepStatus({ pendingCount: 0, unresolvedCount: 0, deferredCount: 0 })).toBe("completed");
		expect(getSweepStatus({ pendingCount: 1, unresolvedCount: 0, deferredCount: 0 })).toBe("in_progress");
		expect(getSweepStatus({ pendingCount: 0, unresolvedCount: 0, deferredCount: 0 }, { cleaned: true })).toBe("cleaned");
	});

	it("toolbar/panel summary derives from the same tally + rule", () => {
		const suggestions = [
			buildEditSuggestion("accepted"),
			buildEditSuggestion("pending"),
		];
		const summary = deriveSweepSummary(suggestions);
		expect(summary.tally).toEqual(tallySuggestionStatuses(suggestions));
		expect(summary.complete).toBe(isSweepComplete(suggestions));
		expect(summary.complete).toBe(false);
		expect(summary.status).toBe("in_progress");
	});
});
