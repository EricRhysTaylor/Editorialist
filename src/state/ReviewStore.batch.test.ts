import { describe, it, expect, vi } from "vitest";
import { ReviewStore } from "./ReviewStore";
import type { ReviewSession, ReviewSuggestion } from "../models/ReviewSuggestion";

// Minimal session factory: batch() only inspects suggestion id/status, so the
// surrounding ReviewSuggestion fields are typed loosely here and cast at the
// boundary. The cast is the only escape hatch in this file.
function makeSuggestion(id: string): ReviewSuggestion {
	return {
		id,
		operation: "edit",
		status: "pending",
		contributor: {
			id: "c",
			displayName: "c",
			kind: "human",
			reviewerType: "editor",
			resolutionStatus: "verified",
			suggestedReviewerIds: [],
			raw: { displayName: "c" },
		},
		source: { blockIndex: 0, entryIndex: 0 },
		location: {},
		executionMode: "direct",
		payload: { original: "", revised: "" },
		// SAFE: test fixture; minimal ReviewSuggestion shape for the fields
		// the store actually inspects.
	} as unknown as ReviewSuggestion;
}

function makeSession(notePath = "note.md"): ReviewSession {
	return {
		notePath,
		hasReviewBlock: true,
		parsedAt: 0,
		suggestions: [makeSuggestion("sug-1"), makeSuggestion("sug-2")],
		memos: [],
	};
}

describe("ReviewStore.batch", () => {
	it("emits once for a single mutation outside of a batch", () => {
		const store = new ReviewStore();
		const listener = vi.fn();
		// subscribe() fires once synchronously with the initial state.
		store.subscribe(listener);
		listener.mockClear();

		store.setSession(makeSession());

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("emits exactly once when multiple mutations run inside a batch", () => {
		const store = new ReviewStore();
		store.setSession(makeSession());
		const listener = vi.fn();
		store.subscribe(listener);
		listener.mockClear();

		store.batch(() => {
			store.selectSuggestion("sug-1");
			store.setAppliedReview({
				currentIndex: 0,
				entries: [{ end: 10, start: 0, suggestionId: "sug-1" }],
				notePath: "note.md",
			});
			store.setGuidedSweep({
				batchId: "b1",
				currentNoteIndex: 0,
				notePaths: ["note.md"],
				startedAt: 0,
			});
		});

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("nested batches still emit only once", () => {
		const store = new ReviewStore();
		store.setSession(makeSession());
		const listener = vi.fn();
		store.subscribe(listener);
		listener.mockClear();

		store.batch(() => {
			store.selectSuggestion("sug-1");
			store.batch(() => {
				store.setGuidedSweep({
					batchId: "b1",
					currentNoteIndex: 0,
					notePaths: ["note.md"],
					startedAt: 0,
				});
				store.batch(() => {
					store.setAppliedReview({
						currentIndex: 0,
						entries: [{ end: 10, start: 0, suggestionId: "sug-1" }],
						notePath: "note.md",
					});
				});
			});
			store.selectSuggestion("sug-2");
		});

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("emits when at least one mutation inside the batch changed state", () => {
		const store = new ReviewStore();
		store.setSession(makeSession());
		store.selectSuggestion("sug-1");
		const listener = vi.fn();
		store.subscribe(listener);
		listener.mockClear();

		store.batch(() => {
			// One no-op (appliedReview already null) plus one real mutation.
			store.setAppliedReview(null);
			store.selectSuggestion("sug-2");
		});

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener.mock.calls[0]?.[0].selectedSuggestionId).toBe("sug-2");
	});

	it("does not emit when no mutation inside the batch actually changed state", () => {
		const store = new ReviewStore();
		// appliedReview is null at construction; setAppliedReview(null) is a
		// no-op per the store's own equality guard, so emit() never runs.
		const listener = vi.fn();
		store.subscribe(listener);
		listener.mockClear();

		store.batch(() => {
			store.setAppliedReview(null);
			store.setAppliedReview(null);
		});

		expect(listener).not.toHaveBeenCalled();
	});

	it("does not re-notify when a rebuilt session changes only parsedAt or offsets", () => {
		const store = new ReviewStore();
		store.setSession(makeSession());
		const listener = vi.fn();
		store.subscribe(listener);
		listener.mockClear();

		// Mirrors the per-keystroke resync: same suggestions/statuses, but a
		// fresh parse timestamp and shifted target offsets. The panel renders
		// identically, so no notification should fire (no flicker).
		const rebuilt = makeSession();
		rebuilt.parsedAt = 12345;
		(rebuilt.suggestions[0] as unknown as { startOffset: number }).startOffset = 99;
		(rebuilt.suggestions[0] as unknown as { endOffset: number }).endOffset = 142;
		store.setSession(rebuilt);

		expect(listener).not.toHaveBeenCalled();
		// State still advanced so later reveals use current offsets.
		expect(store.getState().session?.parsedAt).toBe(12345);
	});

	it("re-notifies when a rebuilt session changes a suggestion status", () => {
		const store = new ReviewStore();
		store.setSession(makeSession());
		const listener = vi.fn();
		store.subscribe(listener);
		listener.mockClear();

		const rebuilt = makeSession();
		rebuilt.parsedAt = 999;
		(rebuilt.suggestions[0] as unknown as { status: string }).status = "accepted";
		store.setSession(rebuilt);

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("exits safely when the batched function throws", () => {
		const store = new ReviewStore();
		store.setSession(makeSession());
		const listener = vi.fn();
		store.subscribe(listener);
		listener.mockClear();

		expect(() => {
			store.batch(() => {
				store.selectSuggestion("sug-1");
				throw new Error("boom");
			});
		}).toThrow("boom");

		// Depth must reset so the next batch flushes normally and listeners
		// must remain functional.
		listener.mockClear();
		store.batch(() => {
			store.selectSuggestion("sug-2");
		});
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener.mock.calls[0]?.[0].selectedSuggestionId).toBe("sug-2");
	});
});
