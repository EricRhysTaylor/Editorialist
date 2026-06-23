// Direct unit tests for the extracted scene-inventory builder. The Pass-2
// service invariants (ReviewRegistryService.invariants.test.ts: scene
// inventory determinism / idempotency, sweep updatedAt idempotency) remain
// the primary safety net; these pin the builder's own contracts: the
// no-imported-blocks null sentinel, record composition (counts / sceneId /
// bookLabel / lastUpdated), the single threaded `now`, retire-stale, and
// determinism. All deps are simple injected fakes — no Obsidian, no
// over-mocking; findImportedReviewBlocks / tally / getSweepStatus run real.

import { describe, it, expect } from "vitest";
import type { TFile } from "obsidian";
import { createReviewBlock } from "../../core/ReviewBlockFormat";
import { SceneInventoryBuilder, type SceneInventoryBuilderDeps } from "./SceneInventoryBuilder";
import type { ReviewSession, ReviewSuggestion } from "../../models/ReviewSuggestion";
import type { SceneReviewRecord } from "../../models/ContributorProfile";

const FIXED_NOW = 1_700_000_000_000;

function reviewNote(batchId: string): string {
	// Metadata + a section header so findImportedReviewBlocks recognizes it.
	return createReviewBlock(`ImportedBy: Editorialist\nBatchId: ${batchId}\n=== EDIT ===\nReviewer: r1`);
}

let seq = 0;
function suggestion(status: ReviewSuggestion["status"]): ReviewSuggestion {
	seq += 1;
	const s = seq;
	return {
		id: `s${s}`,
		operation: "edit",
		status,
		location: { primary: { text: `o${s}`, startOffset: 0, endOffset: 2, matchType: "exact" } },
		source: { blockIndex: 0, entryIndex: s },
		executionMode: "direct",
		contributor: {
			id: "r1",
			displayName: "r1",
			kind: "ai",
			reviewerType: "ai-editor",
			reviewerId: "r1",
			resolutionStatus: "exact",
			suggestedReviewerIds: [],
			raw: { rawName: "r1" },
		},
		payload: { original: `o${s}`, revised: `r${s}` },
	} as ReviewSuggestion;
}

function file(path: string, mtime = 100): TFile {
	const dot = path.lastIndexOf(".");
	const slash = path.lastIndexOf("/");
	return {
		path,
		basename: path.slice(slash + 1, dot === -1 ? undefined : dot),
		stat: { ctime: 0, mtime, size: 0 },
	} as unknown as TFile;
}

function session(notePath: string, suggestions: ReviewSuggestion[]): ReviewSession {
	return { notePath, hasReviewBlock: true, parsedAt: FIXED_NOW, suggestions, memos: [] };
}

function makeDeps(over: Partial<SceneInventoryBuilderDeps> = {}): SceneInventoryBuilderDeps {
	return {
		getMarkdownFiles: () => [],
		resolveNoteText: async () => "",
		buildEngineSession: (notePath) => session(notePath, []),
		applyPersistedReviewState: (s) => s,
		getPersistedDecisionRecord: () => undefined,
		getSceneId: () => undefined,
		getBookHint: () => undefined,
		getSceneReviewIndex: () => ({}),
		now: () => FIXED_NOW,
		...over,
	};
}

describe("SceneInventoryBuilder.buildSessionRecord", () => {
	it("returns null when the note carries no imported blocks (fallback signal)", async () => {
		const b = new SceneInventoryBuilder(makeDeps({ resolveNoteText: async () => "plain note, no block" }));
		expect(await b.buildSessionRecord(file("n.md"), session("n.md", []))).toBeNull();
	});

	it("composes a record with tallied counts, sceneId, bookLabel and lastUpdated", async () => {
		const b = new SceneInventoryBuilder(
			makeDeps({
				resolveNoteText: async () => reviewNote("b1"),
				getSceneId: () => "SCENE-1",
				getBookHint: () => "Book A",
				getPersistedDecisionRecord: () => ({ key: "k", status: "accepted", updatedAt: 555 }),
			}),
		);
		const s = session("BookA/s1.md", [suggestion("pending"), suggestion("rejected")]);
		const rec = await b.buildSessionRecord(file("BookA/s1.md", 100), s);
		expect(rec).toMatchObject({
			sceneId: "SCENE-1",
			notePath: "BookA/s1.md",
			noteTitle: "s1",
			bookLabel: "Book A",
			batchIds: ["b1"],
			batchCount: 1,
			pendingCount: 1,
			rejectedCount: 1,
			status: "in_progress",
			lastUpdated: 555, // max(file.mtime=100, decisionUpdatedAt=555)
		});
	});
});

describe("SceneInventoryBuilder.buildFullInventory", () => {
	it("indexes only notes with blocks, threads a single now, and is deterministic", async () => {
		const files = [file("a.md", 10), file("b.md", 20), file("plain.md", 30)];
		const texts: Record<string, string> = {
			"a.md": reviewNote("b1"),
			"b.md": reviewNote("b1"),
			"plain.md": "no block here",
		};
		const deps = makeDeps({
			getMarkdownFiles: () => files,
			resolveNoteText: async (f) => texts[f.path] ?? "",
			buildEngineSession: (notePath) => session(notePath, [suggestion("pending")]),
		});

		const first = await new SceneInventoryBuilder(deps).buildFullInventory();
		expect(Object.keys(first.nextIndex).sort()).toEqual(["a.md", "b.md"]);
		expect(first.batchPresence.get("b1")).toEqual(new Set(["a.md", "b.md"]));
		expect(first.now).toBe(FIXED_NOW);

		const second = await new SceneInventoryBuilder(deps).buildFullInventory();
		expect(JSON.stringify(second.nextIndex)).toBe(JSON.stringify(first.nextIndex));
	});

	it("retires a prior record whose note no longer carries the batch (status cleaned)", async () => {
		const prior: SceneReviewRecord = {
			sceneId: "S1",
			notePath: "gone.md",
			noteTitle: "gone",
			batchIds: ["b1"],
			batchCount: 1,
			pendingCount: 2,
			unresolvedCount: 0,
			deferredCount: 0,
			acceptedCount: 0,
			rejectedCount: 0,
			rewrittenCount: 0,
			status: "in_progress",
			lastUpdated: 1,
		};
		const b = new SceneInventoryBuilder(
			makeDeps({
				// gone.md IS scanned this round but carries no block any more, so it
				// is genuinely retired (the move-between-scenes case).
				getMarkdownFiles: () => [file("gone.md")],
				resolveNoteText: async () => "",
				getSceneReviewIndex: () => ({ "gone.md": prior }),
			}),
		);
		const { nextIndex } = await b.buildFullInventory();
		expect(nextIndex["gone.md"]).toMatchObject({
			status: "cleaned",
			batchCount: 0,
			pendingCount: 0,
			cleanedAt: FIXED_NOW,
			lastUpdated: FIXED_NOW,
		});
	});

	it("preserves a record whose scene fell outside the scan scope (not retired)", async () => {
		// Regression: a scope-limited scan must NOT retire scenes it didn't look
		// at. Retiring out-of-scope scenes wiped tracking on book switches and
		// orphaned live review blocks so the clean button could never detect them.
		const prior: SceneReviewRecord = {
			sceneId: "S1",
			notePath: "other-book/scene.md",
			noteTitle: "scene",
			batchIds: ["b1"],
			batchCount: 1,
			pendingCount: 0,
			unresolvedCount: 0,
			deferredCount: 0,
			acceptedCount: 3,
			rejectedCount: 0,
			rewrittenCount: 0,
			status: "completed",
			lastUpdated: 1,
		};
		const b = new SceneInventoryBuilder(
			makeDeps({
				// Active scope only includes a different note — the prior scene is
				// out of scope and never scanned.
				getMarkdownFiles: () => [file("in-scope.md")],
				resolveNoteText: async () => "",
				getSceneReviewIndex: () => ({ "other-book/scene.md": prior }),
			}),
		);
		const { nextIndex } = await b.buildFullInventory();
		expect(nextIndex["other-book/scene.md"]).toEqual(prior);
	});

	it("preserves an already-cleaned record's original cleanedAt", async () => {
		const cleaned: SceneReviewRecord = {
			notePath: "old.md",
			noteTitle: "old",
			batchIds: [],
			batchCount: 0,
			pendingCount: 0,
			unresolvedCount: 0,
			deferredCount: 0,
			acceptedCount: 0,
			rejectedCount: 0,
			rewrittenCount: 0,
			status: "cleaned",
			cleanedAt: 42,
			lastUpdated: 42,
		};
		const b = new SceneInventoryBuilder(makeDeps({ getSceneReviewIndex: () => ({ "old.md": cleaned }) }));
		const { nextIndex } = await b.buildFullInventory();
		expect(nextIndex["old.md"].cleanedAt).toBe(42);
		expect(nextIndex["old.md"].lastUpdated).toBe(42);
	});
});
