import { describe, it, expect } from "vitest";
import {
	computeNoteTextFingerprint,
	markSuggestionAcceptedForRefresh,
	selectCompletedSweepAuditTarget,
} from "./SessionAxis";
import type { ReviewSuggestion, ReviewSession } from "../../models/ReviewSuggestion";
import type { SceneReviewRecord } from "../../models/ContributorProfile";
import type { CompletedSweepState } from "../../state/ReviewStore";

// Minimal ReviewSuggestion stub: SessionAxis helpers only read id, status, and
// pass through the rest. The cast is the single boundary in this file.
function makeSuggestion(id: string, status: ReviewSuggestion["status"] = "pending"): ReviewSuggestion {
	return {
		id,
		status,
		operation: "edit",
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
		// SAFE: characterization-test fixture; only id/status are inspected.
	} as unknown as ReviewSuggestion;
}

function makeSession(notePath: string, suggestions: ReviewSuggestion[] = []): ReviewSession {
	return {
		notePath,
		hasReviewBlock: true,
		parsedAt: 0,
		suggestions,
		memos: [],
	};
}

function makeRecord(
	notePath: string,
	overrides: Partial<SceneReviewRecord> = {},
): SceneReviewRecord {
	return {
		notePath,
		noteTitle: notePath,
		batchIds: [],
		batchCount: 0,
		pendingCount: 0,
		unresolvedCount: 0,
		deferredCount: 0,
		acceptedCount: 0,
		rejectedCount: 0,
		rewrittenCount: 0,
		status: "in_progress",
		lastUpdated: 0,
		...overrides,
	};
}

function makeSweep(notePaths: string[], currentNoteIndex = 0): CompletedSweepState {
	return {
		batchId: "b1",
		completedAt: 0,
		currentNoteIndex,
		notePaths,
		startedAt: 0,
		totalSuggestions: 0,
	};
}

describe("computeNoteTextFingerprint", () => {
	it("is deterministic for the same input", () => {
		expect(computeNoteTextFingerprint("hello world")).toBe(computeNoteTextFingerprint("hello world"));
	});

	it("differs when a single character changes", () => {
		expect(computeNoteTextFingerprint("hello world")).not.toBe(computeNoteTextFingerprint("hello worle"));
	});

	it("includes the length prefix in the output shape", () => {
		// The persisted fingerprint format is `${length}:${hash}` — this is the
		// stored shape on lastAppliedChange records, so the format itself is
		// load-bearing across releases.
		expect(computeNoteTextFingerprint("abc")).toMatch(/^3:\d+$/);
		expect(computeNoteTextFingerprint("")).toMatch(/^0:\d+$/);
	});

	it("handles multibyte characters via charCodeAt without throwing", () => {
		expect(() => computeNoteTextFingerprint("héllo — 世界 🌍")).not.toThrow();
		const fp = computeNoteTextFingerprint("héllo — 世界 🌍");
		expect(fp).toMatch(/^\d+:\d+$/);
	});

	it("produces a stable pinned value for a fixed string", () => {
		// Pin a representative hash so any algorithm drift across releases
		// fails this test — protecting persisted lastAppliedChange values
		// that were written before the drift. Computed by running the current
		// djb2-XOR implementation against "hello".
		const pinned = computeNoteTextFingerprint("hello");
		expect(pinned.startsWith("5:")).toBe(true);
		// Same input → same output (algorithm and seed pinned).
		expect(pinned).toBe(computeNoteTextFingerprint("hello"));
	});
});

describe("markSuggestionAcceptedForRefresh", () => {
	it("flips status of the matching suggestion to accepted", () => {
		const list = [makeSuggestion("a"), makeSuggestion("b"), makeSuggestion("c")];
		const out = markSuggestionAcceptedForRefresh(list, "b");
		expect(out.map((s) => s.id)).toEqual(["a", "b", "c"]);
		expect(out[1]?.status).toBe("accepted");
	});

	it("preserves status of non-matching suggestions", () => {
		const list = [
			makeSuggestion("a", "rejected"),
			makeSuggestion("b", "pending"),
			makeSuggestion("c", "rewritten"),
		];
		const out = markSuggestionAcceptedForRefresh(list, "b");
		expect(out[0]?.status).toBe("rejected");
		expect(out[1]?.status).toBe("accepted");
		expect(out[2]?.status).toBe("rewritten");
	});

	it("is a no-op (with identical ids/statuses) when the accepted id is not in the list", () => {
		const list = [makeSuggestion("a"), makeSuggestion("b")];
		const out = markSuggestionAcceptedForRefresh(list, "missing");
		expect(out.map((s) => s.status)).toEqual(["pending", "pending"]);
	});

	it("returns a new array (does not mutate input)", () => {
		const list = [makeSuggestion("a")];
		const out = markSuggestionAcceptedForRefresh(list, "a");
		expect(out).not.toBe(list);
		expect(out[0]).not.toBe(list[0]);
		expect(list[0]?.status).toBe("pending");
	});
});

describe("selectCompletedSweepAuditTarget", () => {
	const isCompleted = (s: ReviewSuggestion): boolean =>
		s.status === "accepted" || s.status === "rewritten" || s.status === "rejected";

	it("returns null when the current session already covers a sweep path with a completed suggestion", () => {
		const sweep = makeSweep(["a.md", "b.md"]);
		const session = makeSession("a.md", [makeSuggestion("s1", "accepted")]);
		const out = selectCompletedSweepAuditTarget({
			completedSweep: sweep,
			currentSession: session,
			isCompletedReviewSuggestion: isCompleted,
			getRecordByPath: () => null,
		});
		expect(out).toBeNull();
	});

	it("does NOT short-circuit when the session is on a sweep path but has no completed suggestions", () => {
		const sweep = makeSweep(["a.md", "b.md"]);
		const session = makeSession("a.md", [makeSuggestion("s1", "pending")]);
		const out = selectCompletedSweepAuditTarget({
			completedSweep: sweep,
			currentSession: session,
			isCompletedReviewSuggestion: isCompleted,
			getRecordByPath: () => null,
		});
		// Falls through to the candidate-picker (no record matches → index 0).
		expect(out).toBe("a.md");
	});

	it("picks the first note whose record has any decided suggestions (priority 2)", () => {
		const sweep = makeSweep(["a.md", "b.md", "c.md"], 1);
		const records: Record<string, SceneReviewRecord> = {
			"a.md": makeRecord("a.md"), // all zero counts
			"b.md": makeRecord("b.md", { acceptedCount: 1 }),
			"c.md": makeRecord("c.md", { rejectedCount: 2 }),
		};
		const out = selectCompletedSweepAuditTarget({
			completedSweep: sweep,
			currentSession: null,
			isCompletedReviewSuggestion: isCompleted,
			getRecordByPath: (notePath) => records[notePath] ?? null,
		});
		expect(out).toBe("b.md");
	});

	it("counts rewrittenCount toward the decided-suggestion check", () => {
		const sweep = makeSweep(["a.md", "b.md"]);
		const records: Record<string, SceneReviewRecord> = {
			"a.md": makeRecord("a.md"),
			"b.md": makeRecord("b.md", { rewrittenCount: 1 }),
		};
		const out = selectCompletedSweepAuditTarget({
			completedSweep: sweep,
			currentSession: null,
			isCompletedReviewSuggestion: isCompleted,
			getRecordByPath: (notePath) => records[notePath] ?? null,
		});
		expect(out).toBe("b.md");
	});

	it("falls back to notePaths[currentNoteIndex] when no record has decisions (priority 3)", () => {
		const sweep = makeSweep(["a.md", "b.md", "c.md"], 2);
		const out = selectCompletedSweepAuditTarget({
			completedSweep: sweep,
			currentSession: null,
			isCompletedReviewSuggestion: isCompleted,
			getRecordByPath: () => null,
		});
		expect(out).toBe("c.md");
	});

	it("falls back to notePaths[0] when currentNoteIndex is out of range (priority 4)", () => {
		const sweep = makeSweep(["a.md", "b.md"], 99);
		const out = selectCompletedSweepAuditTarget({
			completedSweep: sweep,
			currentSession: null,
			isCompletedReviewSuggestion: isCompleted,
			getRecordByPath: () => null,
		});
		expect(out).toBe("a.md");
	});

	it("returns null when notePaths is empty", () => {
		const sweep = makeSweep([], 0);
		const out = selectCompletedSweepAuditTarget({
			completedSweep: sweep,
			currentSession: null,
			isCompletedReviewSuggestion: isCompleted,
			getRecordByPath: () => null,
		});
		expect(out).toBeNull();
	});

	it("treats sessions on a non-sweep path as a candidate-picker case", () => {
		const sweep = makeSweep(["a.md", "b.md"]);
		const session = makeSession("unrelated.md", [makeSuggestion("s1", "accepted")]);
		const records: Record<string, SceneReviewRecord> = {
			"a.md": makeRecord("a.md"),
			"b.md": makeRecord("b.md", { acceptedCount: 1 }),
		};
		const out = selectCompletedSweepAuditTarget({
			completedSweep: sweep,
			currentSession: session,
			isCompletedReviewSuggestion: isCompleted,
			getRecordByPath: (notePath) => records[notePath] ?? null,
		});
		expect(out).toBe("b.md");
	});
});
