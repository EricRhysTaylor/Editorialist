// Direct unit tests for the extracted reviewer-stat projector. The primary
// safety net remains the Pass-2 service invariants
// (ReviewRegistryService.invariants.test.ts: incremental-vs-authoritative
// non-drift, repeated-sync no-duplicate, status-transition-replace,
// reset/remove). These pin the projector's own contracts: the pure record
// builder's status mapping, record equality, and the reconcileSession
// nextIndex/didChange result + delta application.

import { describe, it, expect } from "vitest";
import { ReviewerStatsProjector } from "./ReviewerStatsProjector";
import { ContributorDirectory } from "../../state/ContributorDirectory";
import type { ReviewSession, ReviewSuggestion } from "../../models/ReviewSuggestion";
import type { ContributorProfile, ReviewerSignalRecord } from "../../models/ContributorProfile";

function profile(id: string): ContributorProfile {
	return {
		id,
		displayName: id,
		kind: "ai",
		reviewerType: "ai-editor",
		aliases: [],
		createdAt: 0,
		updatedAt: 0,
	};
}

let seq = 0;
function suggestion(reviewerId: string, status: ReviewSuggestion["status"]): ReviewSuggestion {
	seq += 1;
	return {
		id: `s${seq}`,
		operation: "edit",
		status,
		location: { primary: { text: `o${seq}`, startOffset: 0, endOffset: 2, matchType: "exact" } },
		source: { blockIndex: 0, entryIndex: seq },
		executionMode: "direct",
		contributor: {
			id: reviewerId,
			displayName: reviewerId,
			kind: "ai",
			reviewerType: "ai-editor",
			reviewerId,
			resolutionStatus: "exact",
			suggestedReviewerIds: [],
			raw: { rawName: reviewerId },
		},
		payload: { original: `o${seq}`, revised: `r${seq}` },
	} as ReviewSuggestion;
}

function session(notePath: string, suggestions: ReviewSuggestion[]): ReviewSession {
	return { notePath, hasReviewBlock: true, parsedAt: 0, suggestions, memos: [] };
}

function makeProjector(ids: string[]) {
	const directory = new ContributorDirectory();
	directory.setProfiles(ids.map(profile));
	return { projector: new ReviewerStatsProjector(directory), directory };
}

const identity = (notePath: string): string[] => [notePath];

describe("ReviewerStatsProjector.createSignalRecord", () => {
	it("maps effective status and returns null when reviewerId is absent", () => {
		const { projector } = makeProjector([]);
		const rec = projector.createSignalRecord("k", suggestion("r1", "rejected"), "S", 7);
		expect(rec).toMatchObject({ key: "k", reviewerId: "r1", status: "rejected", operation: "edit", sessionId: "S", sessionStartedAt: 7 });

		const noReviewer = suggestion("", "pending");
		(noReviewer.contributor as { reviewerId?: string }).reviewerId = undefined;
		expect(projector.createSignalRecord("k", noReviewer)).toBeNull();
	});
});

describe("ReviewerStatsProjector.sameSignalRecord", () => {
	const base: ReviewerSignalRecord = { key: "k", reviewerId: "r", status: "accepted", operation: "edit" };
	it("treats both-absent as equal and one-absent as different", () => {
		const { projector } = makeProjector([]);
		expect(projector.sameSignalRecord(undefined, null)).toBe(true);
		expect(projector.sameSignalRecord(base, null)).toBe(false);
	});
	it("compares all identifying fields", () => {
		const { projector } = makeProjector([]);
		expect(projector.sameSignalRecord(base, { ...base })).toBe(true);
		expect(projector.sameSignalRecord(base, { ...base, status: "rejected" })).toBe(false);
	});
});

describe("ReviewerStatsProjector.rebuildFromSignals", () => {
	it("zeroes then tallies the whole index; unknown reviewers are ignored", () => {
		const { projector, directory } = makeProjector(["r1", "r2"]);
		projector.rebuildFromSignals({
			a: { key: "a", reviewerId: "r1", status: "accepted", operation: "edit" },
			b: { key: "b", reviewerId: "r1", status: "rejected", operation: "edit" },
			c: { key: "c", reviewerId: "r2", status: "pending", operation: "move" },
			d: { key: "d", reviewerId: "ghost", status: "accepted", operation: "edit" },
		});
		expect(directory.getProfileById("r1")?.stats).toMatchObject({ totalSuggestions: 2, accepted: 1, rejected: 1, acceptedEdits: 1 });
		expect(directory.getProfileById("r2")?.stats).toMatchObject({ totalSuggestions: 1, pending: 1 });
	});
});

describe("ReviewerStatsProjector.reconcileSession", () => {
	it("adds signals, reports didChange, and keeps incremental stats == authoritative rebuild", () => {
		const { projector, directory } = makeProjector(["r1", "r2"]);
		const s = session("n.md", [suggestion("r1", "accepted"), suggestion("r2", "pending")]);

		const { nextIndex, didChange } = projector.reconcileSession({}, s, identity);
		expect(didChange).toBe(true);
		expect(Object.keys(nextIndex)).toHaveLength(2);

		const incremental = directory.getProfiles().map((p) => [p.id, p.stats] as const);
		projector.rebuildFromSignals(nextIndex);
		const rebuilt = new Map(directory.getProfiles().map((p) => [p.id, p.stats]));
		for (const [id, stats] of incremental) {
			expect(stats).toEqual(rebuilt.get(id));
		}
	});

	it("is idempotent — re-running the same session reports no change", () => {
		const { projector } = makeProjector(["r1"]);
		const s = session("n.md", [suggestion("r1", "accepted")]);
		const first = projector.reconcileSession({}, s, identity);
		const second = projector.reconcileSession(first.nextIndex, s, identity);
		expect(second.didChange).toBe(false);
		expect(Object.keys(second.nextIndex)).toHaveLength(1);
	});
});
