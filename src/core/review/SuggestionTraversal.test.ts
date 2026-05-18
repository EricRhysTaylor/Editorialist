import { describe, it, expect } from "vitest";
import type { ReviewStatus, ReviewSuggestion } from "../../models/ReviewSuggestion";
import {
	canRevealSuggestionInManuscript,
	findPreferredSuggestionId,
	getAdjacentRevealableSuggestionId,
	getSuggestionTraversalTier,
	hasLiveActionableSuggestions,
} from "./SuggestionTraversal";

// Minimal edit-suggestion factory. `resolved` controls whether the primary
// target carries a resolved offset range (manuscript-revealable).
function makeSuggestion(
	id: string,
	status: ReviewStatus,
	resolved: boolean,
): ReviewSuggestion {
	return {
		id,
		operation: "edit",
		status,
		contributor: {
			id: "c1",
			displayName: "R",
			kind: "ai",
			reviewerType: "ai-editor",
			resolutionStatus: "exact",
			suggestedReviewerIds: [],
			raw: {},
		},
		source: { blockIndex: 0, entryIndex: 0 },
		location: {
			primary: resolved
				? { text: "x", startOffset: 0, endOffset: 1 }
				: { text: "x" },
		},
		executionMode: "direct",
		payload: { original: "x", revised: "y" },
	} as ReviewSuggestion;
}

describe("getSuggestionTraversalTier", () => {
	it("open + resolved manuscript range => tier 0", () => {
		expect(getSuggestionTraversalTier(makeSuggestion("a", "pending", true))).toBe(0);
	});

	it("open + no resolved range => tier 2", () => {
		expect(getSuggestionTraversalTier(makeSuggestion("a", "pending", false))).toBe(2);
	});

	it("open + resolved + deferred => tier 1", () => {
		expect(getSuggestionTraversalTier(makeSuggestion("a", "deferred", true))).toBe(1);
	});

	it("open + no range + deferred => tier 1", () => {
		expect(getSuggestionTraversalTier(makeSuggestion("a", "deferred", false))).toBe(1);
	});

	it("forceDeferred promotes a resolved pending item to tier 1", () => {
		expect(getSuggestionTraversalTier(makeSuggestion("a", "pending", true), true)).toBe(1);
	});

	it("closed (accepted/rejected/rewritten) => null", () => {
		for (const status of ["accepted", "rejected", "rewritten"] as const) {
			expect(getSuggestionTraversalTier(makeSuggestion("a", status, true))).toBeNull();
		}
	});
});

describe("canRevealSuggestionInManuscript", () => {
	it("true when open with a resolved range", () => {
		expect(canRevealSuggestionInManuscript(makeSuggestion("a", "pending", true))).toBe(true);
	});

	it("false when open without a resolved range", () => {
		expect(canRevealSuggestionInManuscript(makeSuggestion("a", "pending", false))).toBe(false);
	});

	it("false when closed even if range resolved", () => {
		expect(canRevealSuggestionInManuscript(makeSuggestion("a", "accepted", true))).toBe(false);
	});
});

describe("hasLiveActionableSuggestions", () => {
	it("true when any suggestion is open", () => {
		expect(
			hasLiveActionableSuggestions([
				makeSuggestion("a", "accepted", true),
				makeSuggestion("b", "pending", false),
			]),
		).toBe(true);
	});

	it("false when all suggestions are closed", () => {
		expect(
			hasLiveActionableSuggestions([
				makeSuggestion("a", "accepted", true),
				makeSuggestion("b", "rejected", true),
			]),
		).toBe(false);
	});

	it("false for an empty list", () => {
		expect(hasLiveActionableSuggestions([])).toBe(false);
	});
});

describe("findPreferredSuggestionId", () => {
	it("prefers tier 0 over tier 1 over tier 2", () => {
		const list = [
			makeSuggestion("t2", "pending", false), // tier 2
			makeSuggestion("t1", "deferred", true), // tier 1
			makeSuggestion("t0", "pending", true), // tier 0
		];
		expect(findPreferredSuggestionId(list)).toBe("t0");
	});

	it("falls through tiers to the best available", () => {
		const list = [
			makeSuggestion("t2", "pending", false),
			makeSuggestion("t1", "deferred", false),
		];
		expect(findPreferredSuggestionId(list)).toBe("t1");
	});

	it("falls back to the first id when nothing is actionable", () => {
		const list = [
			makeSuggestion("first", "accepted", true),
			makeSuggestion("second", "rejected", true),
		];
		expect(findPreferredSuggestionId(list)).toBe("first");
	});

	it("returns null for an empty list", () => {
		expect(findPreferredSuggestionId([])).toBeNull();
	});
});

describe("getAdjacentRevealableSuggestionId", () => {
	const list = [
		makeSuggestion("s0", "pending", true),
		makeSuggestion("s1", "pending", true),
		makeSuggestion("s2", "pending", true),
	];

	it("next moves forward from the selected id", () => {
		expect(getAdjacentRevealableSuggestionId(list, "s0", "next")).toBe("s1");
	});

	it("previous moves backward from the selected id", () => {
		expect(getAdjacentRevealableSuggestionId(list, "s1", "previous")).toBe("s0");
	});

	it("next wraps around the end", () => {
		expect(getAdjacentRevealableSuggestionId(list, "s2", "next")).toBe("s0");
	});

	it("previous wraps around the start", () => {
		expect(getAdjacentRevealableSuggestionId(list, "s0", "previous")).toBe("s2");
	});

	it("fromId overrides the selected id", () => {
		expect(getAdjacentRevealableSuggestionId(list, "s0", "next", { fromId: "s1" })).toBe("s2");
	});

	it("missing current id: next starts from the end (wraps to s0)", () => {
		expect(getAdjacentRevealableSuggestionId(list, null, "next")).toBe("s0");
	});

	it("missing current id: previous starts from the front", () => {
		expect(getAdjacentRevealableSuggestionId(list, null, "previous")).toBe("s2");
	});

	it("returns null for an empty list", () => {
		expect(getAdjacentRevealableSuggestionId([], "x", "next")).toBeNull();
	});

	it("skips closed suggestions, landing on the next actionable one", () => {
		const mixed = [
			makeSuggestion("s0", "pending", true),
			makeSuggestion("s1", "accepted", true), // closed -> skipped
			makeSuggestion("s2", "pending", true),
		];
		expect(getAdjacentRevealableSuggestionId(mixed, "s0", "next")).toBe("s2");
	});

	it("treatCurrentAsDeferred only re-tiers the fromId item", () => {
		// All tier 0; deferring the immediate next still returns it because the
		// tier-1 pass eventually reaches it after no tier-0 candidate is found
		// from the deferred-adjusted scan. Verifies the flag is wired through.
		const id = getAdjacentRevealableSuggestionId(list, "s0", "next", {
			fromId: "s0",
			treatCurrentAsDeferred: true,
		});
		expect(id).toBe("s1");
	});
});
