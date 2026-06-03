// Invariant tests for ReviewRegistryService — corruption-prevention before
// any decomposition. These do NOT snapshot internal shapes; they assert the
// CONSISTENCY properties the service must never violate:
//
//  - reviewer stats always equal a direct tally of the signal index
//    (incremental delta path must not drift from the authoritative rebuild)
//  - every persisted decision key resolves back onto a real session
//    suggestion (no orphan decision keys)
//  - scene-inventory rebuild is deterministic and idempotent (re-running
//    over an unchanged manuscript writes nothing new)
//  - sweep registry entries stay attached to scenes that still exist
//  - reset / cleanup paths fully remove stale data
//  - malformed / legacy persisted data normalizes to valid enums
//  - repeated sync/rebuild never duplicates counts or orphans records
//
// The registry's pure index logic (decisions / signals / sweep / normalize)
// is driven directly with hand-built sessions. Only scene-inventory needs a
// vault + engine; a minimal in-memory app + a deterministic fake engine
// keep those fixtures small.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TFile } from "obsidian";
import { ReviewRegistryService } from "./ReviewRegistryService";
import { ContributorDirectory } from "../state/ContributorDirectory";
import { createReviewBlock } from "../core/ReviewBlockFormat";
import type { ReviewEngine } from "../core/ReviewEngine";
import type { ReviewSession, ReviewSuggestion } from "../models/ReviewSuggestion";
import type {
	ContributorProfile,
	EditorialistPluginData,
	ReviewerStats,
} from "../models/ContributorProfile";

const FIXED_NOW = 1_700_000_000_000;

// ── fixtures ─────────────────────────────────────────────────────────────

function profile(id: string, displayName: string): ContributorProfile {
	return {
		id,
		displayName,
		kind: "ai",
		reviewerType: "ai-editor",
		aliases: [],
		createdAt: FIXED_NOW,
		updatedAt: FIXED_NOW,
	};
}

let suggestionSeq = 0;
function suggestion(
	reviewerId: string,
	status: ReviewSuggestion["status"],
	overrides: Partial<ReviewSuggestion> = {},
): ReviewSuggestion {
	suggestionSeq += 1;
	const seq = suggestionSeq;
	return {
		id: `s${seq}`,
		operation: "edit",
		status,
		// matchType "exact" with offsets prevents isImplicitlyAcceptedSuggestion
		// from reclassifying a pending suggestion as accepted.
		location: {
			primary: { text: `orig-${seq}`, startOffset: 0, endOffset: 5, matchType: "exact" },
		},
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
		payload: { original: `orig-${seq}`, revised: `rev-${seq}` },
		...overrides,
	} as ReviewSuggestion;
}

function session(notePath: string, suggestions: ReviewSuggestion[]): ReviewSession {
	return { notePath, hasReviewBlock: true, parsedAt: FIXED_NOW, suggestions, memos: [] };
}

// Tally the signal index exactly the way rebuildReviewerStatsFromSignals
// should, independently, so we can assert the service never drifts from it.
function tallySignalIndex(data: EditorialistPluginData): Map<string, ReviewerStats> {
	const totals = new Map<string, ReviewerStats>();
	const blank = (): ReviewerStats => ({
		totalSuggestions: 0,
		accepted: 0,
		pending: 0,
		deferred: 0,
		rejected: 0,
		rewritten: 0,
		unresolved: 0,
		acceptedEdits: 0,
		acceptedMoves: 0,
	});
	for (const record of Object.values(data.reviewerSignalIndex)) {
		const stats = totals.get(record.reviewerId) ?? blank();
		stats.totalSuggestions += 1;
		if (record.status === "accepted") {
			stats.accepted += 1;
			if (record.operation === "move") stats.acceptedMoves = (stats.acceptedMoves ?? 0) + 1;
			else stats.acceptedEdits = (stats.acceptedEdits ?? 0) + 1;
		} else if (record.status === "pending") stats.pending = (stats.pending ?? 0) + 1;
		else if (record.status === "deferred") stats.deferred += 1;
		else if (record.status === "rejected") stats.rejected += 1;
		else if (record.status === "rewritten") stats.rewritten += 1;
		else stats.unresolved += 1;
		totals.set(record.reviewerId, stats);
	}
	return totals;
}

interface MockFile {
	path: string;
	text: string;
	frontmatter?: Record<string, unknown>;
}

function makeApp(files: MockFile[]) {
	const tfiles = new Map<string, TFile>();
	const fmByPath = new Map<string, Record<string, unknown>>();
	const textByPath = new Map<string, string>();
	for (const f of files) {
		const tf = new TFile();
		tf.path = f.path;
		tf.basename = f.path.replace(/\.md$/, "").split("/").pop() ?? f.path;
		tf.extension = "md";
		tf.stat = { ctime: FIXED_NOW, mtime: FIXED_NOW, size: f.text.length };
		tfiles.set(f.path, tf);
		fmByPath.set(f.path, f.frontmatter ?? {});
		textByPath.set(f.path, f.text);
	}
	return {
		vault: {
			configDir: ".obsidian",
			adapter: {
				exists: async () => false,
				read: async () => "",
			},
			getMarkdownFiles: () => [...tfiles.values()],
			getAbstractFileByPath: (path: string) => tfiles.get(path) ?? null,
			cachedRead: async (file: TFile) => textByPath.get(file.path) ?? "",
		},
		metadataCache: {
			getFileCache: (file: TFile) => ({ frontmatter: fmByPath.get(file.path) ?? {} }),
		},
		workspace: { getLeavesOfType: () => [] },
	} as unknown as ConstructorParameters<typeof ReviewRegistryService>[0];
}

// Deterministic engine: every call for the same path returns the same
// suggestions. Status comes from a per-path table the test controls.
function makeEngine(sessions: Record<string, ReviewSuggestion[]>): ReviewEngine {
	return {
		buildSession: (notePath: string): ReviewSession =>
			session(notePath, sessions[notePath] ?? []),
		refreshSuggestions: (_text: string, s: ReviewSuggestion[]) => s,
	} as unknown as ReviewEngine;
}

// A review block must carry metadata AND a section header to be recognized
// by findImportedReviewBlocks (looksLikeReviewBody requires a section).
function reviewNote(batchId: string): string {
	return createReviewBlock(
		`ImportedBy: Editorialist\nBatchId: ${batchId}\n=== EDIT ===\nReviewer: r1`,
	);
}

function makeService(options?: {
	app?: ConstructorParameters<typeof ReviewRegistryService>[0];
	engine?: ReviewEngine;
	profiles?: ContributorProfile[];
}) {
	const directory = new ContributorDirectory();
	directory.setProfiles(options?.profiles ?? [profile("r1", "r1"), profile("r2", "r2")]);
	let persistCalls = 0;
	const service = new ReviewRegistryService(
		options?.app ?? makeApp([]),
		options?.engine ?? makeEngine({}),
		directory,
		async () => {
			persistCalls += 1;
		},
		// Tests do not exercise the "live editor buffer" branch — every read
		// falls through to vault.cachedRead. Inject a constant null resolver
		// to keep the invariants suite decoupled from workspace state.
		() => null,
	);
	return { service, directory, persistCalls: () => persistCalls };
}

beforeEach(() => {
	suggestionSeq = 0;
	vi.useFakeTimers();
	vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

// ── reviewer totals == signal population ─────────────────────────────────

describe("invariant: reviewer stats equal a direct tally of the signal index", () => {
	it("incremental sync path never drifts from the authoritative rebuild", async () => {
		const { service, directory } = makeService();
		const s = session("n.md", [
			suggestion("r1", "accepted"),
			suggestion("r1", "rejected"),
			suggestion("r2", "pending"),
		]);

		await service.syncReviewerSignalsForSession(s, { persist: false });

		// Stats produced by the incremental delta path.
		const incremental = directory
			.getProfiles()
			.map((p) => [p.id, p.stats] as const);

		// Authoritative recompute from the signal index.
		service.rebuildReviewerStatsFromSignals();
		const rebuilt = new Map(directory.getProfiles().map((p) => [p.id, p.stats]));

		for (const [id, stats] of incremental) {
			expect(stats).toEqual(rebuilt.get(id));
		}

		// And both equal an independent tally of the persisted signal index.
		const expected = tallySignalIndex(service.buildPluginData(directory.getProfiles()));
		for (const p of directory.getProfiles()) {
			const want = expected.get(p.id);
			if (want) {
				expect(p.stats?.totalSuggestions).toBe(want.totalSuggestions);
				const sum =
					(p.stats?.accepted ?? 0) +
					(p.stats?.pending ?? 0) +
					(p.stats?.deferred ?? 0) +
					(p.stats?.rejected ?? 0) +
					(p.stats?.rewritten ?? 0) +
					(p.stats?.unresolved ?? 0);
				expect(sum).toBe(want.totalSuggestions);
			}
		}
	});

	it("repeated identical sync does not multiply counts", async () => {
		const { service, directory } = makeService();
		const s = session("n.md", [suggestion("r1", "accepted"), suggestion("r1", "pending")]);

		await service.syncReviewerSignalsForSession(s, { persist: false });
		const after1 = directory.getProfileById("r1")?.stats?.totalSuggestions;
		await service.syncReviewerSignalsForSession(s, { persist: false });
		await service.syncReviewerSignalsForSession(s, { persist: false });
		const after3 = directory.getProfileById("r1")?.stats?.totalSuggestions;

		expect(after1).toBe(2);
		expect(after3).toBe(2);
		expect(Object.keys(service.buildPluginData(directory.getProfiles()).reviewerSignalIndex)).toHaveLength(
			2,
		);
	});

	it("status transition replaces, not appends, the reviewer signal", async () => {
		const { service, directory } = makeService();
		const sug = suggestion("r1", "pending");
		await service.syncReviewerSignalsForSession(session("n.md", [sug]), { persist: false });
		expect(directory.getProfileById("r1")?.stats?.pending).toBe(1);

		await service.syncReviewerSignalsForSession(
			session("n.md", [{ ...sug, status: "accepted" } as ReviewSuggestion]),
			{ persist: false },
		);
		const stats = directory.getProfileById("r1")?.stats;
		expect(stats?.pending).toBe(0);
		expect(stats?.accepted).toBe(1);
		expect(stats?.totalSuggestions).toBe(1);
	});
});

// ── batch stats read the durable signal index ────────────────────────────

describe("invariant: batch decision stats come from durable reviewer signals", () => {
	it("tallies exact sessionId-attributed signals instead of frozen sweep counts", async () => {
		const { service } = makeService();
		await service.syncReviewerSignalsForSession(
			session("n.md", [
				suggestion("r1", "accepted"),
				suggestion("r1", "rejected"),
				suggestion("r2", "rewritten"),
				suggestion("r2", "deferred"),
			]),
			{ persist: false, sessionId: "batch-1" },
		);
		await service.syncReviewerSignalsForSession(
			session("other.md", [suggestion("r1", "accepted")]),
			{ persist: false, sessionId: "other" },
		);
		service.load({
			...service.buildPluginData([]),
			sweepRegistry: {
				"batch-1": {
					acceptedCount: 0,
					deferredCount: 0,
					importedNotePaths: ["n.md"],
					rejectedCount: 0,
					rewrittenCount: 0,
				},
			},
		});

		expect(service.getBatchDecisionStats("batch-1")).toEqual({
			accepted: 1,
			deferred: 1,
			rejected: 1,
			rewritten: 1,
		});
	});

	it("falls back to note-identity matching for legacy signals without sessionId", () => {
		const { service } = makeService();
		service.load({
			reviewerSignalIndex: {
				a: {
					key: "n.md::0::1::edit::direct::orig-a",
					reviewerId: "r1",
					status: "accepted",
					operation: "edit",
				},
				b: {
					key: "n.md::0::2::edit::direct::orig-b",
					reviewerId: "r1",
					status: "rewritten",
					operation: "edit",
				},
				c: {
					key: "other.md::0::3::edit::direct::orig-c",
					reviewerId: "r2",
					status: "rejected",
					operation: "edit",
				},
			},
			sweepRegistry: {
				"batch-1": {
					acceptedCount: 0,
					importedNotePaths: [],
					rejectedCount: 0,
					rewrittenCount: 0,
					sceneOrder: ["n.md"],
				},
			},
		});

		expect(service.getBatchDecisionStats("batch-1")).toEqual({
			accepted: 1,
			deferred: 0,
			rejected: 0,
			rewritten: 1,
		});
	});
});

// ── persisted decision keys resolve to real suggestions ──────────────────

describe("invariant: every persisted decision key resolves to a session suggestion", () => {
	it("applyPersistedReviewState reflects each decision and leaves no orphan keys", async () => {
		const { service } = makeService();
		const a = suggestion("r1", "pending");
		const b = suggestion("r1", "pending");
		const s = session("n.md", [a, b]);

		await service.persistReviewDecision("n.md", a, "accepted", { persist: false });
		await service.persistReviewDecision("n.md", b, "rejected", { persist: false });

		const applied = service.applyPersistedReviewState(s);
		expect(applied.suggestions.find((x) => x.id === a.id)?.status).toBe("accepted");
		expect(applied.suggestions.find((x) => x.id === b.id)?.status).toBe("rejected");

		// One key per decided suggestion — no duplicate/orphan keys.
		const index = service.buildPluginData([]).reviewDecisionIndex;
		expect(Object.keys(index)).toHaveLength(2);

		// Every key resolves: clearing each suggestion empties the index exactly.
		await service.clearPersistedReviewDecision("n.md", a, { persist: false });
		await service.clearPersistedReviewDecision("n.md", b, { persist: false });
		expect(Object.keys(service.buildPluginData([]).reviewDecisionIndex)).toHaveLength(0);
	});

	it("re-persisting the same status is idempotent (no key growth)", async () => {
		const { service } = makeService();
		const a = suggestion("r1", "pending");
		await service.persistReviewDecision("n.md", a, "deferred", { persist: false });
		await service.persistReviewDecision("n.md", a, "deferred", { persist: false });
		await service.persistReviewDecision("n.md", a, "deferred", { persist: false });
		expect(Object.keys(service.buildPluginData([]).reviewDecisionIndex)).toHaveLength(1);
	});
});

// ── scene inventory: deterministic + idempotent ──────────────────────────

describe("invariant: scene-inventory rebuild is deterministic and idempotent", () => {
	const files: MockFile[] = [
		{ path: "BookA/s1.md", text: reviewNote("batch-1"), frontmatter: { id: "SCENE-1" } },
		{ path: "BookA/s2.md", text: reviewNote("batch-1"), frontmatter: { id: "SCENE-2" } },
	];
	const engineSessions = {
		"BookA/s1.md": [suggestion("r1", "accepted"), suggestion("r1", "pending")],
		"BookA/s2.md": [suggestion("r2", "rejected")],
	};

	it("two independent services over identical inputs produce identical inventory", async () => {
		const a = makeService({ app: makeApp(files), engine: makeEngine(engineSessions) });
		const b = makeService({ app: makeApp(files), engine: makeEngine(engineSessions) });
		await a.service.syncSceneInventory({ persist: false });
		await b.service.syncSceneInventory({ persist: false });
		expect(JSON.stringify(a.service.buildMetadataExport([]).scenes)).toBe(
			JSON.stringify(b.service.buildMetadataExport([]).scenes),
		);
	});

	it("re-running over an unchanged manuscript writes nothing new", async () => {
		const { service, persistCalls } = makeService({
			app: makeApp(files),
			engine: makeEngine(engineSessions),
		});
		await service.syncSceneInventory();
		const callsAfterFirst = persistCalls();
		const snapshot = JSON.stringify(service.buildMetadataExport([]).scenes);

		await service.syncSceneInventory();
		await service.syncSceneInventory();

		expect(persistCalls()).toBe(callsAfterFirst);
		expect(JSON.stringify(service.buildMetadataExport([]).scenes)).toBe(snapshot);
	});

	it("idempotent even when a sweep registry entry exists and the clock advances", async () => {
		const app = makeApp(files);
		const { service, persistCalls } = makeService({
			app,
			engine: makeEngine(engineSessions),
		});
		await service.recordImportedBatch(
			{
				batchId: "batch-1",
				contentHash: "hash",
				createdAt: FIXED_NOW,
				rawText: "",
				results: [],
				groups: [
					{ filePath: "BookA/s1.md" } as never,
					{ filePath: "BookA/s2.md" } as never,
				],
				summary: { totalSuggestions: 3 } as never,
			},
			[{ filePath: "BookA/s1.md" } as never, { filePath: "BookA/s2.md" } as never],
			"in_progress",
		);
		const baseline = persistCalls();
		const snapshot = JSON.stringify(service.buildMetadataExport([]).sweeps);

		vi.setSystemTime(FIXED_NOW + 60_000);
		await service.syncSceneInventory();

		expect(JSON.stringify(service.buildMetadataExport([]).sweeps)).toBe(snapshot);
		expect(persistCalls()).toBe(baseline);
	});
});

// ── sweep registry stays attached to valid scenes ────────────────────────

describe("invariant: sweep registry entries stay attached to existing scenes", () => {
	it("imported paths remain resolvable; removing a block cleans the entry but preserves counts", async () => {
		const present: MockFile[] = [
			{ path: "BookA/s1.md", text: reviewNote("batch-1"), frontmatter: { id: "SCENE-1" } },
		];
		const app = makeApp(present);
		const { service } = makeService({
			app,
			engine: makeEngine({ "BookA/s1.md": [suggestion("r1", "accepted")] }),
		});
		await service.recordImportedBatch(
			{
				batchId: "batch-1",
				contentHash: "h",
				createdAt: FIXED_NOW,
				rawText: "",
				results: [],
				groups: [{ filePath: "BookA/s1.md" } as never],
				summary: { totalSuggestions: 1 } as never,
			},
			[{ filePath: "BookA/s1.md" } as never],
			"in_progress",
		);

		const entry = service.getSweepRegistryEntry("batch-1");
		expect(entry).not.toBeNull();
		for (const p of entry?.importedNotePaths ?? []) {
			expect(app.vault.getAbstractFileByPath(p)).not.toBeNull();
		}

		// Block removed from the only scene -> entry must transition to cleaned
		// but keep the historical accepted count, and not orphan a dangling path.
		const cleared = makeApp([{ path: "BookA/s1.md", text: "no review block here" }]);
		// Re-point the service's vault by rebuilding inventory through a fresh
		// service that shares persisted state.
		const data = service.buildPluginData([]);
		const next = makeService({
			app: cleared,
			engine: makeEngine({ "BookA/s1.md": [] }),
		});
		next.service.load(data);
		await next.service.syncSceneInventory({ persist: false });

		const cleanedEntry = next.service.getSweepRegistryEntry("batch-1");
		expect(cleanedEntry?.status).toBe("cleaned");
		expect(cleanedEntry?.acceptedCount).toBe(1);
		expect(cleanedEntry?.importedNotePaths ?? []).toHaveLength(0);
	});

	it("isSweepRegistryComplete tracks scene record completeness", async () => {
		const files: MockFile[] = [
			{ path: "BookA/s1.md", text: reviewNote("b2"), frontmatter: { id: "S1" } },
		];
		const { service } = makeService({
			app: makeApp(files),
			engine: makeEngine({ "BookA/s1.md": [suggestion("r1", "pending")] }),
		});
		await service.recordImportedBatch(
			{
				batchId: "b2",
				contentHash: "h",
				createdAt: FIXED_NOW,
				rawText: "",
				results: [],
				groups: [{ filePath: "BookA/s1.md" } as never],
				summary: { totalSuggestions: 1 } as never,
			},
			[{ filePath: "BookA/s1.md" } as never],
			"in_progress",
		);
		expect(service.isSweepRegistryComplete("b2")).toBe(false);

		const resolved = makeService({
			app: makeApp(files),
			engine: makeEngine({ "BookA/s1.md": [suggestion("r1", "accepted")] }),
		});
		resolved.service.load(service.buildPluginData([]));
		await resolved.service.syncSceneInventory({ persist: false });
		expect(resolved.service.isSweepRegistryComplete("b2")).toBe(true);
	});
});

// ── reset / cleanup removes stale data ───────────────────────────────────

describe("invariant: reset/cleanup paths remove stale registry data", () => {
	it("resetBatchHistory removes only the batch's decisions, signals and sweep", async () => {
		const { service } = makeService();
		const keep = suggestion("r1", "accepted");
		const drop = suggestion("r2", "rejected");
		await service.persistReviewDecision("k.md", keep, "accepted", {
			persist: false,
			sessionId: "KEEP",
		});
		await service.persistReviewDecision("d.md", drop, "rejected", {
			persist: false,
			sessionId: "DROP",
		});
		await service.syncReviewerSignalsForSession(session("k.md", [keep]), {
			persist: false,
			sessionId: "KEEP",
		});
		await service.syncReviewerSignalsForSession(session("d.md", [drop]), {
			persist: false,
			sessionId: "DROP",
		});

		const result = await service.resetBatchHistory("DROP");
		expect(result.removedDecisions).toBe(1);
		expect(result.removedSignals).toBe(1);

		const data = service.buildPluginData([]);
		expect(Object.values(data.reviewDecisionIndex).every((r) => r.sessionId !== "DROP")).toBe(true);
		expect(Object.values(data.reviewerSignalIndex).every((r) => r.sessionId !== "DROP")).toBe(true);
		expect(Object.values(data.reviewDecisionIndex).some((r) => r.sessionId === "KEEP")).toBe(true);
	});

	it("resetAllRevisionHistory empties every index and zeroes reviewer stats", async () => {
		const { service, directory } = makeService();
		await service.persistReviewDecision("n.md", suggestion("r1", "pending"), "accepted", {
			persist: false,
		});
		await service.syncReviewerSignalsForSession(
			session("n.md", [suggestion("r1", "accepted")]),
			{ persist: false },
		);

		const result = await service.resetAllRevisionHistory();
		expect(result.removedDecisions).toBeGreaterThan(0);

		const data = service.buildPluginData(directory.getProfiles());
		expect(Object.keys(data.reviewDecisionIndex)).toHaveLength(0);
		expect(Object.keys(data.reviewerSignalIndex)).toHaveLength(0);
		expect(Object.keys(data.sweepRegistry)).toHaveLength(0);
		for (const p of directory.getProfiles()) {
			expect(p.stats?.totalSuggestions).toBe(0);
		}
	});

	it("removeReviewerSignalsByReviewerId drops only that reviewer and rebuilds stats", async () => {
		const { service, directory } = makeService();
		await service.syncReviewerSignalsForSession(
			session("n.md", [suggestion("r1", "accepted"), suggestion("r2", "accepted")]),
			{ persist: false },
		);
		const removed = await service.removeReviewerSignalsByReviewerId("r1", { persist: false });
		expect(removed).toBe(1);
		const data = service.buildPluginData(directory.getProfiles());
		expect(Object.values(data.reviewerSignalIndex).every((r) => r.reviewerId !== "r1")).toBe(true);
		expect(directory.getProfileById("r1")?.stats?.totalSuggestions).toBe(0);
		expect(directory.getProfileById("r2")?.stats?.totalSuggestions).toBe(1);
	});
});

// ── malformed / legacy data normalizes safely ────────────────────────────

describe("invariant: malformed / legacy persisted data normalizes to valid enums", () => {
	it("legacy status aliases migrate and unknown shapes do not throw", () => {
		const { service } = makeService();
		service.load({
			reviewDecisionIndex: {
				k1: { status: "later", updatedAt: FIXED_NOW } as never,
				k2: { status: "weird-garbage" } as never,
			},
			sceneReviewIndex: {
				"p.md": { status: "not_started", notePath: "p.md" } as never,
			},
			sweepRegistry: {
				b1: { status: "cleaned_up", batchId: "b1" } as never,
				b2: { status: "imported", batchId: "b2" } as never,
			},
			reviewerSignalIndex: undefined,
		} as Partial<EditorialistPluginData>);

		const data = service.buildPluginData([]);
		expect(data.reviewDecisionIndex.k1?.status).toBe("deferred"); // "later" -> deferred
		expect(["accepted", "deferred", "rejected", "rewritten"]).toContain(
			data.reviewDecisionIndex.k2?.status,
		);
		expect(data.sceneReviewIndex["p.md"]?.status).toBe("in_progress"); // not_started -> in_progress
		expect(data.sweepRegistry.b1?.status).toBe("cleaned"); // cleaned_up -> cleaned
		expect(data.sweepRegistry.b2?.status).toBe("in_progress"); // imported -> in_progress
	});

	it("null / non-object persisted blobs load as empty indexes", () => {
		const { service } = makeService();
		service.load(null);
		const data = service.buildPluginData([]);
		expect(Object.keys(data.reviewDecisionIndex)).toHaveLength(0);
		expect(Object.keys(data.reviewerSignalIndex)).toHaveLength(0);
		expect(Object.keys(data.sceneReviewIndex)).toHaveLength(0);
		expect(Object.keys(data.sweepRegistry)).toHaveLength(0);
	});

	it("normalized data round-trips (load -> build -> load is stable)", () => {
		const { service } = makeService();
		service.load({
			reviewDecisionIndex: { k1: { status: "later" } as never },
			sweepRegistry: { b1: { status: "imported", batchId: "b1" } as never },
		} as Partial<EditorialistPluginData>);
		const first = service.buildPluginData([]);
		const reloaded = makeService();
		reloaded.service.load(first);
		expect(JSON.stringify(reloaded.service.buildPluginData([]))).toBe(JSON.stringify(first));
	});
});
