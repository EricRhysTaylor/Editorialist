// Direct unit tests for the extracted sweep-registry computation. The Pass-2
// service invariants (ReviewRegistryService.invariants.test.ts: sweep
// attachment, completion, and the updatedAt-idempotency fix) remain the
// primary safety net; these pin the manager's own contracts: duplicate
// detection, completion, the updateEntry meaningful-change gate, and the
// updatedAt-stability rule under an unchanged buildFromSceneInventory.

import { describe, it, expect } from "vitest";
import { SweepRegistryManager } from "./SweepRegistryManager";
import type { SceneReviewRecord } from "../../models/ContributorProfile";
import type { ReviewImportBatch, ReviewSweepRegistryEntry } from "../../models/ReviewImport";
import type { ActiveBookScopeInfo } from "../../core/VaultScope";

function entry(over: Partial<ReviewSweepRegistryEntry> = {}): ReviewSweepRegistryEntry {
	return {
		batchId: "b1",
		contentHash: "h1",
		importedAt: 100,
		importedNotePaths: ["s1.md"],
		currentNotePath: "s1.md",
		sceneOrder: ["s1.md"],
		editorialRevisionUpdatedNotePaths: [],
		status: "in_progress",
		totalSuggestions: 3,
		updatedAt: 100,
		...over,
	};
}

function sceneRecord(over: Partial<SceneReviewRecord> = {}): SceneReviewRecord {
	return {
		notePath: "s1.md",
		noteTitle: "S1",
		batchIds: ["b1"],
		batchCount: 1,
		pendingCount: 0,
		unresolvedCount: 0,
		deferredCount: 0,
		acceptedCount: 0,
		rejectedCount: 0,
		rewrittenCount: 0,
		status: "in_progress",
		lastUpdated: 0,
		...over,
	};
}

const noScope: ActiveBookScopeInfo = { label: null, sourceFolder: null };

function makeManager(
	sceneIndex: Record<string, SceneReviewRecord> = {},
	now: () => number = () => 999,
) {
	return new SweepRegistryManager({
		getSceneReviewIndex: () => sceneIndex,
		getActiveBookScope: () => noScope,
		now,
	});
}

describe("SweepRegistryManager — entries & duplicate detection", () => {
	it("sorts entries by updatedAt desc", () => {
		const m = makeManager();
		const reg = { a: entry({ batchId: "a", updatedAt: 1 }), b: entry({ batchId: "b", updatedAt: 9 }) };
		expect(m.getEntries(reg).map((e) => e.batchId)).toEqual(["b", "a"]);
	});

	it("getEntry returns null for missing/blank id", () => {
		const m = makeManager();
		expect(m.getEntry({}, undefined)).toBeNull();
		expect(m.getEntry({ b1: entry() }, "b1")?.batchId).toBe("b1");
	});

	it("findDuplicate only matches an in_progress sweep with the same contentHash", () => {
		const m = makeManager();
		const batch = { contentHash: "h1" } as ReviewImportBatch;
		expect(m.findDuplicate({ b1: entry({ status: "in_progress" }) }, batch)?.batchId).toBe("b1");
		expect(m.findDuplicate({ b1: entry({ status: "completed" }) }, batch)).toBeNull();
		expect(m.findDuplicate({ b1: entry({ status: "cleaned" }) }, batch)).toBeNull();
	});
});

describe("SweepRegistryManager — completion", () => {
	it("is complete when every sweep path's scene record is resolved (or batchCount 0 / missing)", () => {
		const m = makeManager({ "s1.md": sceneRecord({ pendingCount: 0, unresolvedCount: 0, deferredCount: 0 }) });
		expect(m.isComplete({ b1: entry() }, "b1")).toBe(true);
	});

	it("is incomplete while a path still has open items", () => {
		const m = makeManager({ "s1.md": sceneRecord({ pendingCount: 1 }) });
		expect(m.isComplete({ b1: entry() }, "b1")).toBe(false);
	});

	it("missing entry -> not complete", () => {
		expect(makeManager().isComplete({}, "ghost")).toBe(false);
	});

	it("reconcileStatus flips an in_progress sweep to completed when its paths resolve", () => {
		const m = makeManager({ "s1.md": sceneRecord() });
		const reg = { b1: entry({ status: "in_progress", updatedAt: 100 }) };
		m.reconcileStatus(reg, sceneRecord());
		expect(reg.b1.status).toBe("completed");
		expect(reg.b1.updatedAt).toBe(999);
	});
});

describe("SweepRegistryManager — updateEntry meaningful-change gate", () => {
	it("returns false (no mutation) for missing entry or no-op update", () => {
		const m = makeManager();
		expect(m.updateEntry({}, "ghost", { status: "cleaned" })).toBe(false);
		const reg = { b1: entry({ status: "in_progress" }) };
		expect(m.updateEntry(reg, "b1", { status: "in_progress" })).toBe(false);
		expect(reg.b1.updatedAt).toBe(100);
	});

	it("applies a real change and stamps updatedAt", () => {
		const m = makeManager();
		const reg = { b1: entry({ status: "in_progress", updatedAt: 100 }) };
		expect(m.updateEntry(reg, "b1", { status: "cleaned" })).toBe(true);
		expect(reg.b1.status).toBe("cleaned");
		expect(reg.b1.updatedAt).toBe(999);
	});
});

describe("SweepRegistryManager — updatedAt idempotency (Pass-2 fix)", () => {
	it("does NOT churn updatedAt when buildFromSceneInventory sees no material change", () => {
		// Status must match what the scene counts derive (zero blocking → completed)
		// so the reconciliation sees no material change and leaves updatedAt alone.
		const scene = sceneRecord({ acceptedCount: 0, rejectedCount: 0, rewrittenCount: 0, deferredCount: 0 });
		const m = makeManager({ "s1.md": scene });
		const reg = {
			b1: entry({ status: "completed", updatedAt: 100, acceptedCount: 0, rejectedCount: 0, rewrittenCount: 0, deferredCount: 0 }),
		};
		const presence = new Map([["b1", new Set(["s1.md"])]]);

		const next = m.buildFromSceneInventory(reg, presence, { "s1.md": scene }, 777);
		expect(next.b1.updatedAt).toBe(100); // preserved, NOT bumped to 777
	});

	it("stamps the new clock value when a material field changes", () => {
		const scene = sceneRecord({ acceptedCount: 5 });
		const m = makeManager({ "s1.md": scene });
		const reg = { b1: entry({ updatedAt: 100, acceptedCount: 0 }) };
		const presence = new Map([["b1", new Set(["s1.md"])]]);

		const next = m.buildFromSceneInventory(reg, presence, { "s1.md": scene }, 777);
		expect(next.b1.acceptedCount).toBe(5);
		expect(next.b1.updatedAt).toBe(777);
	});

	it("resurrects a stale 'cleaned' entry when its block reappears in a scene", () => {
		// A block that reappears (re-import, or a detection bug that hid it) must
		// pull the entry out of "cleaned" so the clean button can act on it again.
		const scene = sceneRecord({ acceptedCount: 3, pendingCount: 0 });
		const m = makeManager({ "s1.md": scene });
		const reg = { b1: entry({ status: "cleaned", cleanedAt: 50, updatedAt: 100, acceptedCount: 0 }) };
		const presence = new Map([["b1", new Set(["s1.md"])]]);

		const next = m.buildFromSceneInventory(reg, presence, { "s1.md": scene }, 777);
		expect(next.b1.status).toBe("completed");
		expect(next.b1.cleanedAt).toBeUndefined();
		expect(next.b1.acceptedCount).toBe(3);
	});

	it("marks a batch with no remaining scenes as cleaned", () => {
		const m = makeManager({});
		const reg = { b1: entry({ status: "in_progress", updatedAt: 100 }) };
		const next = m.buildFromSceneInventory(reg, new Map(), {}, 777);
		expect(next.b1.status).toBe("cleaned");
		expect(next.b1.importedNotePaths).toEqual([]);
	});
});

describe("SweepRegistryManager — recordImportedBatch", () => {
	it("writes a fresh entry using the injected scope and clock", () => {
		const m = makeManager({}, () => 555);
		const reg: Record<string, ReviewSweepRegistryEntry> = {};
		m.recordImportedBatch(
			reg,
			{ batchId: "bN", contentHash: "hN", createdAt: 50, summary: { totalSuggestions: 2 } } as ReviewImportBatch,
			[{ filePath: "x.md" }] as never,
			"in_progress",
		);
		expect(reg.bN).toMatchObject({
			batchId: "bN",
			contentHash: "hN",
			importedAt: 50,
			importedNotePaths: ["x.md"],
			sceneOrder: ["x.md"],
			currentNotePath: "x.md",
			status: "in_progress",
			totalSuggestions: 2,
			updatedAt: 555,
		});
	});
});
