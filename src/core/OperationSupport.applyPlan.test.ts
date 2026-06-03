import { describe, it, expect } from "vitest";
import { createSuggestionApplyPlan } from "./OperationSupport";
import type {
	CondenseSuggestion,
	CutSuggestion,
	EditSuggestion,
	ExpandSuggestion,
	MatchType,
	MoveSuggestion,
	ReviewPlacement,
	ReviewTargetRef,
} from "../models/ReviewSuggestion";

// Characterization tests — these assert CURRENT behavior of
// createSuggestionApplyPlan, not desired behavior. ReviewStateMachine's
// apply path depends on this, so move/condense are covered most heavily.

const contributor = {
	id: "c1",
	displayName: "R",
	kind: "ai" as const,
	reviewerType: "ai-editor" as const,
	resolutionStatus: "exact" as const,
	suggestedReviewerIds: [],
	raw: {},
};
const source = { blockIndex: 0, entryIndex: 0 };

function target(over: Partial<ReviewTargetRef> = {}): ReviewTargetRef {
	return { text: "x", matchType: "exact", ...over };
}

function editSuggestion(
	primary: ReviewTargetRef | undefined,
	payload: { original: string; revised: string },
): EditSuggestion {
	return {
		id: "e",
		operation: "edit",
		status: "pending",
		contributor,
		source,
		location: { primary },
		executionMode: "direct",
		payload,
	};
}

function cutSuggestion(t: ReviewTargetRef | undefined, payloadTarget: string): CutSuggestion {
	return {
		id: "c",
		operation: "cut",
		status: "pending",
		contributor,
		source,
		location: { target: t },
		executionMode: "direct",
		payload: { target: payloadTarget },
	};
}

function condenseSuggestion(
	t: ReviewTargetRef | undefined,
	payload: { target: string; suggestion?: string },
): CondenseSuggestion {
	return {
		id: "cd",
		operation: "condense",
		status: "pending",
		contributor,
		source,
		location: { target: t },
		executionMode: "direct",
		payload,
	};
}

function expandSuggestion(
	t: ReviewTargetRef | undefined,
	payload: { target: string; suggestion?: string },
	executionMode: "direct" | "advisory" = "direct",
): ExpandSuggestion {
	return {
		id: "ex",
		operation: "expand",
		status: "pending",
		contributor,
		source,
		location: { target: t },
		executionMode,
		payload,
	};
}

function moveSuggestion(
	relocation: MoveSuggestion["location"]["relocation"],
	payload: { target: string; anchor: string; placement: ReviewPlacement },
): MoveSuggestion {
	return {
		id: "m",
		operation: "move",
		status: "pending",
		contributor,
		source,
		location: { relocation },
		executionMode: "direct",
		payload,
	};
}

describe("createSuggestionApplyPlan — edit", () => {
	it("exact match returns a replace plan over the matched span", () => {
		const s = editSuggestion(target({ startOffset: 6, endOffset: 10 }), {
			original: "beta",
			revised: "BETA",
		});
		expect(createSuggestionApplyPlan("alpha beta gamma", s)).toEqual({
			from: 6,
			to: 10,
			text: "BETA",
		});
	});

	it("non-exact matchType => null", () => {
		const s = editSuggestion(target({ startOffset: 6, endOffset: 10, matchType: "multiple" as MatchType }), {
			original: "beta",
			revised: "BETA",
		});
		expect(createSuggestionApplyPlan("alpha beta gamma", s)).toBeNull();
	});

	it("already_applied matchType => null (no-op, not a plan)", () => {
		const s = editSuggestion(target({ startOffset: 0, endOffset: 4, matchType: "already_applied" }), {
			original: "beta",
			revised: "BETA",
		});
		expect(createSuggestionApplyPlan("beta", s)).toBeNull();
	});

	it("missing primary => null", () => {
		expect(createSuggestionApplyPlan("x", editSuggestion(undefined, { original: "a", revised: "b" }))).toBeNull();
	});

	it("missing offsets => null", () => {
		const s = editSuggestion(target({ matchType: "exact" }), { original: "a", revised: "b" });
		expect(createSuggestionApplyPlan("a", s)).toBeNull();
	});

	it("span does not match original (raw and normalized) => null", () => {
		const s = editSuggestion(target({ startOffset: 6, endOffset: 10 }), {
			original: "beta",
			revised: "BETA",
		});
		expect(createSuggestionApplyPlan("alpha ZZZZ gamma", s)).toBeNull();
	});

	it("normalized (curly vs straight quotes) match still applies", () => {
		const note = "say “hello” now"; // curly quotes in the manuscript
		const s = editSuggestion(target({ startOffset: 4, endOffset: 11 }), {
			original: '"hello"', // straight quotes from the AI
			revised: "HELLO",
		});
		expect(createSuggestionApplyPlan(note, s)).toEqual({ from: 4, to: 11, text: "HELLO" });
	});
});

describe("createSuggestionApplyPlan — cut", () => {
	it("exact match returns an empty-text deletion plan", () => {
		const s = cutSuggestion(target({ startOffset: 2, endOffset: 3 }), "B");
		expect(createSuggestionApplyPlan("A B C", s)).toEqual({ from: 2, to: 3, text: "" });
	});

	it("normalized whitespace drift still cuts", () => {
		// "He  said   hello" (len 16) normalizes to "He said hello".
		const s = cutSuggestion(target({ startOffset: 0, endOffset: 16 }), "He said hello");
		expect(createSuggestionApplyPlan("He  said   hello", s)).toEqual({ from: 0, to: 16, text: "" });
	});

	it("missing target / non-exact => null", () => {
		expect(createSuggestionApplyPlan("A B C", cutSuggestion(undefined, "B"))).toBeNull();
		expect(
			createSuggestionApplyPlan(
				"A B C",
				cutSuggestion(target({ startOffset: 2, endOffset: 3, matchType: "none" }), "B"),
			),
		).toBeNull();
	});
});

describe("createSuggestionApplyPlan — condense", () => {
	it("exact match with suggestion returns a replace plan", () => {
		const s = condenseSuggestion(target({ startOffset: 0, endOffset: 11 }), {
			target: "long winded",
			suggestion: "tight",
		});
		expect(createSuggestionApplyPlan("long winded text", s)).toEqual({
			from: 0,
			to: 11,
			text: "tight",
		});
	});

	it("missing payload.suggestion => null even with a valid target", () => {
		const s = condenseSuggestion(target({ startOffset: 0, endOffset: 11 }), { target: "long winded" });
		expect(createSuggestionApplyPlan("long winded text", s)).toBeNull();
	});

	it("target span mismatch => null", () => {
		const s = condenseSuggestion(target({ startOffset: 0, endOffset: 4 }), {
			target: "long winded",
			suggestion: "tight",
		});
		expect(createSuggestionApplyPlan("ZZZZ winded text", s)).toBeNull();
	});
});

describe("createSuggestionApplyPlan — expand", () => {
	it("direct expand with suggestion returns a replace plan over the target span", () => {
		const s = expandSuggestion(target({ startOffset: 0, endOffset: 5 }), {
			target: "terse",
			suggestion: "a much longer, developed beat",
		});
		expect(createSuggestionApplyPlan("terse text", s)).toEqual({
			from: 0,
			to: 5,
			text: "a much longer, developed beat",
		});
	});

	it("advisory expand (no suggestion) => null — guidance only, nothing to apply", () => {
		const s = expandSuggestion(target({ startOffset: 0, endOffset: 5 }), { target: "terse" }, "advisory");
		expect(createSuggestionApplyPlan("terse text", s)).toBeNull();
	});

	it("direct mode but missing payload.suggestion => null", () => {
		const s = expandSuggestion(target({ startOffset: 0, endOffset: 5 }), { target: "terse" });
		expect(createSuggestionApplyPlan("terse text", s)).toBeNull();
	});

	it("target span mismatch => null", () => {
		const s = expandSuggestion(target({ startOffset: 0, endOffset: 5 }), {
			target: "terse",
			suggestion: "longer",
		});
		expect(createSuggestionApplyPlan("ZZZZZ text", s)).toBeNull();
	});
});

describe("createSuggestionApplyPlan — move", () => {
	it("relocation missing or canApply false => null", () => {
		expect(
			createSuggestionApplyPlan("a", moveSuggestion(undefined, { target: "a", anchor: "b", placement: "after" })),
		).toBeNull();
		expect(
			createSuggestionApplyPlan(
				"a",
				moveSuggestion({ canApply: false, targetResolved: true, anchorResolved: true }, {
					target: "a",
					anchor: "b",
					placement: "after",
				}),
			),
		).toBeNull();
	});

	it("canApply true but an offset undefined => null", () => {
		const s = moveSuggestion(
			{ canApply: true, targetResolved: true, anchorResolved: true, targetStart: 0, targetEnd: 2 },
			{ target: "T.", anchor: "A.", placement: "after" },
		);
		expect(createSuggestionApplyPlan("T.\n\nA.", s)).toBeNull();
	});

	it("target verification is STRICT — normalized-equivalent drift does NOT apply", () => {
		// edit/cut/condense fall back to normalizeMatchText; move does not.
		const note = "“Quote”\n\nAnchor"; // curly quotes in manuscript
		const s = moveSuggestion(
			{
				canApply: true,
				targetResolved: true,
				anchorResolved: true,
				targetStart: 0,
				targetEnd: 7,
				anchorStart: 9,
				anchorEnd: 15,
			},
			{ target: '"Quote"', anchor: "Anchor", placement: "after" }, // straight quotes
		);
		expect(createSuggestionApplyPlan(note, s)).toBeNull();
	});

	it("placement 'after', target before anchor — anchor offsets shift by removed length", () => {
		const note = "T.\n\nMID.\n\nA."; // len 12; target [0,2) precedes anchor [10,12)
		const s = moveSuggestion(
			{
				canApply: true,
				targetResolved: true,
				anchorResolved: true,
				targetStart: 0,
				targetEnd: 2,
				anchorStart: 10,
				anchorEnd: 12,
			},
			{ target: "T.", anchor: "A.", placement: "after" },
		);
		expect(createSuggestionApplyPlan(note, s)).toEqual({
			from: 0,
			to: 12,
			text: "\n\nMID.\n\nA.\n\nT.",
			focusStart: 12,
			focusEnd: 14,
		});
	});

	it("placement 'before', target after anchor — no offset adjustment", () => {
		const note = "ANCHOR\n\nTARGET"; // len 14; anchor [0,6), target [8,14)
		const s = moveSuggestion(
			{
				canApply: true,
				targetResolved: true,
				anchorResolved: true,
				targetStart: 8,
				targetEnd: 14,
				anchorStart: 0,
				anchorEnd: 6,
			},
			{ target: "TARGET", anchor: "ANCHOR", placement: "before" },
		);
		expect(createSuggestionApplyPlan(note, s)).toEqual({
			from: 0,
			to: 14,
			text: "TARGET\n\nANCHOR\n\n",
			focusStart: 0,
			focusEnd: 6,
		});
	});

	it("strips leading/trailing newlines from the moved block and re-spaces", () => {
		const note = "P1.\n\nMOVE BLOCK\n\nP2."; // len 20; target slice incl. surrounding \n\n
		const s = moveSuggestion(
			{
				canApply: true,
				targetResolved: true,
				anchorResolved: true,
				targetStart: 3,
				targetEnd: 17,
				anchorStart: 0,
				anchorEnd: 3,
			},
			{ target: "\n\nMOVE BLOCK\n\n", anchor: "P1.", placement: "before" },
		);
		expect(createSuggestionApplyPlan(note, s)).toEqual({
			from: 0,
			to: 20,
			text: "MOVE BLOCK\n\nP1.P2.",
			focusStart: 0,
			focusEnd: 10,
		});
	});
});
