// Orchestration tests for ReviewBatchProcessor. We exercise the decision /
// ordering logic — NOT modal or DOM internals. Notice/TFile come from the
// obsidian test mock (no-ops); the choice modal is never reached because
// findDuplicateSweep returns null in the import paths.

import { describe, it, expect, vi } from "vitest";
import { ReviewBatchProcessor, type ReviewBatchProcessorHost } from "./ReviewBatchProcessor";
import type { ReviewImportBatch, ReviewImportNoteGroup } from "../models/ReviewImport";

function makeHost(overrides: Partial<ReviewBatchProcessorHost> = {}) {
	const calls: string[] = [];
	const importEngine = {
		inspectBatch: vi.fn(),
		importBatch: vi.fn(),
	};
	const host: ReviewBatchProcessorHost = {
		app: {} as never,
		getImportEngine: () => importEngine as never,
		getActiveNoteContext: () => null,
		getReviewNoteContext: () => null,
		getNoteContextByPath: () => null,
		getResolvedCompletedSweepState: () => null,
		getGuidedSweep: () => null,
		setGuidedSweep: () => calls.push("setGuidedSweep"),
		persistContributorProfilesIfNeeded: async () => { calls.push("persistProfiles"); },
		savePluginData: async () => { calls.push("savePluginData"); },
		resyncSessionForActiveNote: () => calls.push("resync"),
		refreshReviewPanel: () => calls.push("refreshPanel"),
		findDuplicateSweep: () => null,
		recordImportedBatch: async () => { calls.push("recordImportedBatch"); },
		getSweepRegistryEntry: () => null,
		updateSweepRegistry: async () => { calls.push("updateSweepRegistry"); },
		syncSceneInventory: async () => { calls.push("syncSceneInventory"); },
		getSceneReviewRecords: () => [],
		resetBatchHistoryInRegistry: async () => ({
			removedDecisions: 3,
			removedSignals: 2,
			removedSweep: true,
		}),
		openExistingSweep: async () => { calls.push("openExistingSweep"); },
		startGuidedSweep: async () => { calls.push("startGuidedSweep"); },
		cleanupCurrentBatch: async () => true,
		...overrides,
	};
	return { host, calls, importEngine };
}

const batch = {
	batchId: "b1",
	createdAt: 123,
	summary: {},
	results: [],
} as unknown as ReviewImportBatch;

describe("ReviewBatchProcessor.getBatchDecisionStats", () => {
	it("prefers the frozen registry-entry snapshot", () => {
		const { host } = makeHost({
			getSweepRegistryEntry: () =>
				({ acceptedCount: 5, rejectedCount: 2, rewrittenCount: 1, deferredCount: 3 }) as never,
		});
		const stats = new ReviewBatchProcessor(host).getBatchDecisionStats("b1");
		expect(stats).toEqual({ accepted: 5, rejected: 2, rewritten: 1, deferred: 3 });
	});

	it("falls back to summing scene records that include the batch id", () => {
		const { host } = makeHost({
			getSweepRegistryEntry: () => null,
			getSceneReviewRecords: () =>
				[
					{ batchIds: ["b1"], acceptedCount: 2, rejectedCount: 1, rewrittenCount: 0, deferredCount: 1 },
					{ batchIds: ["other"], acceptedCount: 9, rejectedCount: 9, rewrittenCount: 9, deferredCount: 9 },
					{ batchIds: ["b1"], acceptedCount: 1, rejectedCount: 0, rewrittenCount: 4, deferredCount: 0 },
				] as never,
		});
		const stats = new ReviewBatchProcessor(host).getBatchDecisionStats("b1");
		expect(stats).toEqual({ accepted: 3, rejected: 1, rewritten: 4, deferred: 1 });
	});
});

describe("ReviewBatchProcessor.resetBatchHistory", () => {
	it("resets registry then saves, resyncs and refreshes — in order", async () => {
		const { host, calls } = makeHost();
		const result = await new ReviewBatchProcessor(host).resetBatchHistory("b1");
		expect(result).toEqual({ removedDecisions: 3, removedSignals: 2, removedSweep: true });
		expect(calls).toEqual(["savePluginData", "resync", "refreshPanel"]);
	});
});

describe("ReviewBatchProcessor.importReviewBatch", () => {
	it("notifies and stops when nothing was imported", async () => {
		const { host, calls, importEngine } = makeHost();
		importEngine.importBatch.mockResolvedValue([]);
		await new ReviewBatchProcessor(host).importReviewBatch(batch, true);
		expect(calls).not.toContain("recordImportedBatch");
		expect(calls).not.toContain("startGuidedSweep");
	});

	it("records the batch and starts the sweep when startReview is true", async () => {
		const { host, calls, importEngine } = makeHost();
		const groups = [
			{ filePath: "a.md", suggestions: [{}, {}] },
		] as unknown as ReviewImportNoteGroup[];
		importEngine.importBatch.mockResolvedValue(groups);
		await new ReviewBatchProcessor(host).importReviewBatch(batch, true);
		expect(calls).toEqual(["recordImportedBatch", "startGuidedSweep"]);
	});

	it("records the batch but does NOT start a sweep when startReview is false", async () => {
		const { host, calls, importEngine } = makeHost();
		importEngine.importBatch.mockResolvedValue([
			{ filePath: "a.md", suggestions: [{}] },
		] as unknown as ReviewImportNoteGroup[]);
		await new ReviewBatchProcessor(host).importReviewBatch(batch, false);
		expect(calls).toContain("recordImportedBatch");
		expect(calls).not.toContain("startGuidedSweep");
	});
});

describe("ReviewBatchProcessor.cleanupReviewBatch", () => {
	it("returns early without touching the registry when the entry is missing", async () => {
		const { host, calls } = makeHost({ getSweepRegistryEntry: () => null });
		await new ReviewBatchProcessor(host).cleanupReviewBatch("missing");
		expect(calls).toEqual([]);
	});

	it("marks cleaned, clears the matching guided sweep, syncs and resyncs", async () => {
		const { host, calls } = makeHost({
			getSweepRegistryEntry: () => ({ importedNotePaths: [] }) as never,
			getGuidedSweep: () => ({ batchId: "b1" }) as never,
		});
		await new ReviewBatchProcessor(host).cleanupReviewBatch("b1");
		expect(calls).toEqual([
			"updateSweepRegistry",
			"setGuidedSweep",
			"syncSceneInventory",
			"resync",
		]);
	});

	it("does not clear an unrelated guided sweep", async () => {
		const { host, calls } = makeHost({
			getSweepRegistryEntry: () => ({ importedNotePaths: [] }) as never,
			getGuidedSweep: () => ({ batchId: "other" }) as never,
		});
		await new ReviewBatchProcessor(host).cleanupReviewBatch("b1");
		expect(calls).not.toContain("setGuidedSweep");
		expect(calls).toEqual(["updateSweepRegistry", "syncSceneInventory", "resync"]);
	});
});

describe("ReviewBatchProcessor.removeImportedReviewBlocksInCurrentNote", () => {
	it("no-ops without an active note", async () => {
		const { host, calls } = makeHost({ getActiveNoteContext: () => null });
		await new ReviewBatchProcessor(host).removeImportedReviewBlocksInCurrentNote();
		expect(calls).toEqual([]);
	});

	it("rewrites the note then syncs inventory and resyncs when blocks are removed", async () => {
		let written: string | null = null;
		const note = "before\n```editorialist-review\nImportedBy: Editorialist\nBatchId: x\n=== EDIT ===\nReviewer: r\n```\nafter";
		const { host, calls } = makeHost({
			getActiveNoteContext: () =>
				({
					filePath: "n.md",
					text: note,
					view: { editor: { getValue: () => note, setValue: (v: string) => { written = v; } } },
				}) as never,
		});
		await new ReviewBatchProcessor(host).removeImportedReviewBlocksInCurrentNote();
		expect(written).not.toBeNull();
		expect(written).not.toContain("editorialist-review");
		expect(calls).toEqual(["syncSceneInventory", "resync"]);
	});
});
