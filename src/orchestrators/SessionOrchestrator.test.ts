import { describe, it, expect, vi } from "vitest";
import {
	SessionOrchestrator,
	type ActiveNoteContext,
	type BulkApplyConfirmState,
	type LastAppliedChange,
	type SessionOrchestratorHost,
} from "./SessionOrchestrator";
import { ReviewStore } from "../state/ReviewStore";
import type { ReviewSession, ReviewSuggestion } from "../models/ReviewSuggestion";
import type { SceneReviewRecord } from "../models/ContributorProfile";
import type { CompletedSweepState } from "../state/ReviewStore";
import type { ReviewEngine } from "../core/ReviewEngine";
import type { ReviewRegistryService } from "../services/ReviewRegistryService";
import type { ReviewWorkflowService } from "../services/ReviewWorkflowService";

function makeSuggestion(
	id: string,
	overrides: Partial<ReviewSuggestion> = {},
): ReviewSuggestion {
	return {
		id,
		status: "pending",
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
		...overrides,
		// SAFE: fake session shape; orchestrator only inspects id/status here.
	} as unknown as ReviewSuggestion;
}

function makeSession(notePath: string, suggestions: ReviewSuggestion[] = [], hasReviewBlock = true): ReviewSession {
	return { notePath, hasReviewBlock, parsedAt: 0, suggestions, memos: [] };
}

function makeContext(filePath: string, text = "body"): ActiveNoteContext {
	return {
		filePath,
		text,
		// SAFE: tests never invoke MarkdownView methods beyond editor.getValue
		// in the refresh-edit case, which we stub there explicitly.
		view: { editor: { getValue: () => text } } as unknown as ActiveNoteContext["view"],
	};
}

function makeRecord(overrides: Partial<SceneReviewRecord> = {}): SceneReviewRecord {
	return {
		notePath: "",
		noteTitle: "",
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

interface FakeHostConfig {
	activeContext?: ActiveNoteContext | null;
	reviewContext?: ActiveNoteContext | null;
	priorSession?: ReviewSession | null;
	builtSession?: ReviewSession;
	hydratedSession?: ReviewSession;
	lastAppliedChange?: LastAppliedChange | null;
	bulkApplyConfirmState?: BulkApplyConfirmState | null;
	resolvedCompletedSweep?: CompletedSweepState | null;
	recordsByPath?: Record<string, SceneReviewRecord>;
	shouldShowHandoff?: boolean;
}

function makeFakeHost(config: FakeHostConfig = {}) {
	const calls: string[] = [];
	const store = new ReviewStore();
	if (config.priorSession) {
		store.setSession(config.priorSession);
	}

	const reviewEngine = {
		buildSession: vi.fn().mockImplementation(() => {
			calls.push("engine.buildSession");
			return config.builtSession ?? makeSession("built.md");
		}),
		refreshSuggestions: vi.fn().mockImplementation((_text: string, suggestions: ReviewSuggestion[]) => {
			calls.push("engine.refreshSuggestions");
			return suggestions;
		}),
	} as unknown as ReviewEngine;

	const registry = {
		applyPersistedReviewState: vi.fn().mockImplementation(() => {
			calls.push("registry.applyPersistedReviewState");
			return config.hydratedSession ?? config.builtSession ?? makeSession("hydrated.md");
		}),
		syncReviewerSignalsForSession: vi.fn().mockImplementation(async () => {
			calls.push("registry.syncReviewerSignalsForSession");
		}),
	} as unknown as ReviewRegistryService;

	const workflow = {
		syncCurrentNote: vi.fn().mockImplementation(async () => {
			calls.push("workflow.syncCurrentNote");
		}),
	} as unknown as ReviewWorkflowService;

	let lastAppliedChange: LastAppliedChange | null = config.lastAppliedChange ?? null;
	let bulkApplyConfirmState: BulkApplyConfirmState | null = config.bulkApplyConfirmState ?? null;

	const host: SessionOrchestratorHost = {
		store,
		reviewEngine,
		registry,
		workflow,
		getActiveNoteContext: vi.fn().mockImplementation((): ActiveNoteContext | null => config.activeContext ?? null),
		getReviewNoteContext: vi.fn().mockImplementation((): ActiveNoteContext | null => config.reviewContext ?? null),
		getReviewSession: vi.fn().mockImplementation(() => store.getSession()),
		getLastAppliedChange: () => lastAppliedChange,
		setLastAppliedChange: (value) => {
			calls.push(`setLastAppliedChange:${value === null ? "null" : "value"}`);
			lastAppliedChange = value;
		},
		getBulkApplyConfirmState: () => bulkApplyConfirmState,
		setBulkApplyConfirmState: (value) => {
			calls.push(`setBulkApplyConfirmState:${value === null ? "null" : "value"}`);
			bulkApplyConfirmState = value;
		},
		clearActiveHighlights: vi.fn().mockImplementation(() => {
			calls.push("clearActiveHighlights");
		}),
		setDefaultHighlightForSelection: vi.fn().mockImplementation(() => {
			calls.push("setDefaultHighlightForSelection");
		}),
		getResolvedCompletedSweepState: () => config.resolvedCompletedSweep ?? null,
		isCompletedReviewSuggestion: (s) =>
			s.status === "accepted" || s.status === "rejected" || s.status === "rewritten",
		getSceneReviewRecordByPath: (notePath) => config.recordsByPath?.[notePath] ?? null,
		shouldShowGuidedSweepHandoff: () => config.shouldShowHandoff ?? false,
		getCurrentSessionTrackingContext: () => ({ sessionId: undefined, sessionStartedAt: undefined }),
		openReviewPanel: vi.fn().mockImplementation(async () => {
			calls.push("openReviewPanel");
		}),
		revealSelectedSuggestion: vi.fn().mockImplementation(async () => {
			calls.push("revealSelectedSuggestion");
		}),
		startOrResumeReviewForNote: vi.fn().mockImplementation(async (notePath: string) => {
			calls.push(`startOrResumeReviewForNote:${notePath}`);
		}),
		persistContributorProfilesIfNeeded: vi.fn().mockImplementation(async () => {
			calls.push("persistContributorProfilesIfNeeded");
		}),
	};

	return { host, store, calls, reviewEngine, registry, workflow };
}

describe("SessionOrchestrator", () => {
	describe("parseCurrentNote — no context branch", () => {
		it("returns early without touching the store when there is no active context", async () => {
			const { host, store, calls } = makeFakeHost({ activeContext: null });
			const orch = new SessionOrchestrator(host);

			await orch.parseCurrentNote();

			expect(store.getSession()).toBeNull();
			expect(calls).not.toContain("engine.buildSession");
			expect(calls).not.toContain("registry.applyPersistedReviewState");
			expect(calls).not.toContain("openReviewPanel");
			expect(calls).not.toContain("revealSelectedSuggestion");
		});
	});

	describe("parseCurrentNote — no review block branch", () => {
		it("clears session, highlights, and lastAppliedChange when hydrated session has no review block", async () => {
			const builtSession = makeSession("a.md", [], false);
			const hydratedSession = makeSession("a.md", [], false);
			const { host, store, calls } = makeFakeHost({
				activeContext: makeContext("a.md"),
				builtSession,
				hydratedSession,
				lastAppliedChange: { end: 0, start: 0, notePath: "a.md", suggestionId: "x", textFingerprint: "fp" },
			});
			const orch = new SessionOrchestrator(host);

			await orch.parseCurrentNote({ suppressNotice: true });

			expect(store.getSession()).toBeNull();
			expect(calls).toContain("clearActiveHighlights");
			expect(calls).toContain("setLastAppliedChange:null");
			// The block-success path must NOT have been taken.
			expect(calls).not.toContain("openReviewPanel");
			expect(calls).not.toContain("revealSelectedSuggestion");
			expect(calls).not.toContain("workflow.syncCurrentNote");
		});
	});

	describe("parseCurrentNote — successful parse branch", () => {
		it("sets the session, syncs workflow + registry, opens panel, reveals selection — in that order", async () => {
			const hydrated = makeSession("a.md", [makeSuggestion("s1")], true);
			const { host, store, calls } = makeFakeHost({
				activeContext: makeContext("a.md"),
				builtSession: hydrated,
				hydratedSession: hydrated,
			});
			const orch = new SessionOrchestrator(host);

			await orch.parseCurrentNote({ suppressNotice: true });

			// Store updated.
			expect(store.getSession()?.notePath).toBe("a.md");
			// Ordering: persist profiles → engine → registry hydrate → workflow sync
			// → registry signal sync → open panel → reveal.
			expect(calls).toEqual([
				"engine.buildSession",
				"registry.applyPersistedReviewState",
				"persistContributorProfilesIfNeeded",
				"workflow.syncCurrentNote",
				"registry.syncReviewerSignalsForSession",
				"openReviewPanel",
				"revealSelectedSuggestion",
			]);
		});
	});

	describe("resyncSessionForActiveNote — note mismatch branch", () => {
		it("clears appliedReview + highlights + lastAppliedChange but does NOT rebuild the session", () => {
			const session = makeSession("a.md", [makeSuggestion("s1")], true);
			const { host, store, calls } = makeFakeHost({
				activeContext: makeContext("b.md"), // mismatch
				reviewContext: null,
				priorSession: session,
				lastAppliedChange: { end: 0, start: 0, notePath: "a.md", suggestionId: "x", textFingerprint: "fp" },
			});
			const orch = new SessionOrchestrator(host);

			orch.resyncSessionForActiveNote();

			expect(store.getSession()?.notePath).toBe("a.md"); // session NOT rebuilt
			expect(calls).toContain("clearActiveHighlights");
			expect(calls).toContain("setLastAppliedChange:null");
			expect(calls).toContain("setBulkApplyConfirmState:null");
			expect(calls).not.toContain("engine.buildSession");
			expect(calls).not.toContain("setDefaultHighlightForSelection");
		});
	});

	describe("resyncSessionForActiveNote — success branch", () => {
		it("rebuilds the session, syncs workflow + registry (fire-and-forget), and sets default highlight last", () => {
			const session = makeSession("a.md", [makeSuggestion("s1")], true);
			const rebuilt = makeSession("a.md", [makeSuggestion("s1"), makeSuggestion("s2")], true);
			const { host, store, calls } = makeFakeHost({
				activeContext: makeContext("a.md"),
				reviewContext: makeContext("a.md"),
				priorSession: session,
				builtSession: rebuilt,
				hydratedSession: rebuilt,
			});
			const orch = new SessionOrchestrator(host);

			orch.resyncSessionForActiveNote();

			expect(store.getSession()?.suggestions.length).toBe(2);
			// setDefaultHighlightForSelection must be the LAST orchestrator call in
			// this branch (decoration sync happens after session update).
			expect(calls[calls.length - 1]).toBe("setDefaultHighlightForSelection");
			expect(calls).toContain("engine.buildSession");
			expect(calls).toContain("registry.applyPersistedReviewState");
			// Workflow + signals sync are fire-and-forget but still invoked.
			expect(calls).toContain("workflow.syncCurrentNote");
			expect(calls).toContain("registry.syncReviewerSignalsForSession");
		});
	});

	describe("resyncSessionForActiveNote — no-context branch", () => {
		it("clears session inside a single batch when one was present", () => {
			const session = makeSession("a.md", [makeSuggestion("s1")], true);
			const { host, store, calls } = makeFakeHost({
				activeContext: null,
				reviewContext: null,
				priorSession: session,
			});
			const listener = vi.fn();
			store.subscribe(listener);
			listener.mockClear();
			const orch = new SessionOrchestrator(host);

			orch.resyncSessionForActiveNote();

			expect(store.getSession()).toBeNull();
			expect(calls).toContain("clearActiveHighlights");
			expect(calls).toContain("setLastAppliedChange:null");
			// Two store mutations (setAppliedReview + clearSession) batched into
			// exactly one listener notification.
			expect(listener).toHaveBeenCalledTimes(1);
		});
	});

	describe("refreshSessionAfterAcceptedEdit", () => {
		it("returns early when there is no review note context", () => {
			const session = makeSession("a.md", [makeSuggestion("s1")], true);
			const { host, store, calls } = makeFakeHost({
				reviewContext: null,
				priorSession: session,
			});
			const orch = new SessionOrchestrator(host);

			orch.refreshSessionAfterAcceptedEdit(session, "s1");

			expect(calls).not.toContain("engine.refreshSuggestions");
			// Session must remain untouched (replaceSuggestions never called).
			expect(store.getSession()?.suggestions).toHaveLength(1);
		});

		it("marks the accepted suggestion and replaces the session's suggestions", () => {
			const session = makeSession("a.md", [makeSuggestion("s1"), makeSuggestion("s2")], true);
			const { host, store, calls } = makeFakeHost({
				reviewContext: makeContext("a.md"),
				priorSession: session,
			});
			const orch = new SessionOrchestrator(host);

			orch.refreshSessionAfterAcceptedEdit(session, "s1");

			expect(calls).toContain("engine.refreshSuggestions");
			const next = store.getSession();
			expect(next?.suggestions.find((s) => s.id === "s1")?.status).toBe("accepted");
			expect(next?.suggestions.find((s) => s.id === "s2")?.status).toBe("pending");
		});
	});

	describe("ensureCompletedSweepAuditSession — target selection", () => {
		it("does nothing when there is no resolved completed sweep", async () => {
			const { host, calls } = makeFakeHost({ resolvedCompletedSweep: null });
			const orch = new SessionOrchestrator(host);

			await orch.ensureCompletedSweepAuditSession();

			expect(calls.filter((c) => c.startsWith("startOrResumeReviewForNote"))).toHaveLength(0);
		});

		it("opens the priority-2 target (first sweep note with decision counts)", async () => {
			const { host, calls } = makeFakeHost({
				resolvedCompletedSweep: {
					batchId: "b1",
					completedAt: 0,
					currentNoteIndex: 0,
					notePaths: ["a.md", "b.md", "c.md"],
					startedAt: 0,
					totalSuggestions: 0,
				},
				recordsByPath: {
					"a.md": makeRecord({ notePath: "a.md" }),
					"b.md": makeRecord({ notePath: "b.md", acceptedCount: 1 }),
				},
			});
			const orch = new SessionOrchestrator(host);

			await orch.ensureCompletedSweepAuditSession();

			expect(calls).toContain("startOrResumeReviewForNote:b.md");
		});

		it("short-circuits when current session already audits a sweep path with a completed suggestion", async () => {
			const sweepSession = makeSession("a.md", [makeSuggestion("s1", { status: "accepted" })], true);
			const { host, calls } = makeFakeHost({
				resolvedCompletedSweep: {
					batchId: "b1",
					completedAt: 0,
					currentNoteIndex: 0,
					notePaths: ["a.md", "b.md"],
					startedAt: 0,
					totalSuggestions: 0,
				},
				priorSession: sweepSession,
				// getReviewSession in the fake returns store.getSession(), which is
				// the prior session — i.e., the orchestrator sees a matching session.
			});
			const orch = new SessionOrchestrator(host);

			await orch.ensureCompletedSweepAuditSession();

			expect(calls.filter((c) => c.startsWith("startOrResumeReviewForNote"))).toHaveLength(0);
		});
	});
});
