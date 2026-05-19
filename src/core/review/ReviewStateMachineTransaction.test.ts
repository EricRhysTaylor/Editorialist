// Partial-failure / transaction-safety tests for ReviewStateMachine.
//
// These do NOT use RecordingReviewStateMachineHost (that harness records op
// ORDER and is governed by the frozen golden traces). Instead a small
// STATEFUL host models the two authoritative sources of truth — the
// registry decision index and the UI store status — plus the derived
// projections (reviewer signals, scene inventory). It can throw on the
// first occurrence of a chosen host op. The assertions check that after a
// mid-sequence failure the store status and the persisted decision index
// agree with each other and with the pre-decision state (no SILENT
// divergence), and that the user was notified.

import { describe, it, expect } from "vitest";
import { ReviewStateMachine } from "./ReviewStateMachine";
import type {
	AppliedReviewChangeLike,
	GuidedSweepState,
	ReviewNoteContextLike,
	ReviewSession,
	ReviewStateMachineHost,
} from "./ReviewStateMachineScaffold";
import type { ReviewSuggestion } from "../../models/ReviewSuggestion";

type FailOp =
	| "store.updateSuggestionStatus"
	| "registry.persistReviewDecision"
	| "registry.syncReviewerSignalsForSession"
	| "registry.syncSceneInventoryForSession"
	| "refreshSessionAfterAcceptedEdit";

const contributor = {
	id: "c1",
	displayName: "R",
	kind: "ai" as const,
	reviewerType: "ai-editor" as const,
	resolutionStatus: "exact" as const,
	suggestedReviewerIds: [],
	raw: {},
};

function editOpen(id: string): ReviewSuggestion {
	return {
		id,
		operation: "edit",
		status: "pending",
		contributor,
		source: { blockIndex: 0, entryIndex: 0 },
		location: { primary: { text: "hello", startOffset: 0, endOffset: 5, matchType: "exact" } },
		executionMode: "direct",
		payload: { original: "hello", revised: "HELLO" },
	} as ReviewSuggestion;
}

interface StatefulHostConfig {
	failOnceAt?: FailOp;
}

// Host with real in-memory authoritative + derived state.
class StatefulHost implements ReviewStateMachineHost {
	notices: string[] = [];
	persistedDecisions = new Map<string, string>(); // registry decision index
	storeStatuses = new Map<string, ReviewSuggestion["status"]>(); // UI store
	signalsReflect: Record<string, string> | null = null; // last synced snapshot
	inventoryReflect: Record<string, string> | null = null;
	private failed = new Set<FailOp>();
	private readonly suggestion: ReviewSuggestion;
	_lastAppliedChange: AppliedReviewChangeLike | null = null;

	constructor(private readonly config: StatefulHostConfig = {}) {
		this.suggestion = editOpen("s1");
		this.storeStatuses.set("s1", "pending");
	}

	private maybeFail(op: FailOp): void {
		if (this.config.failOnceAt === op && !this.failed.has(op)) {
			this.failed.add(op);
			throw new Error(`injected failure at ${op}`);
		}
	}

	private snapshot(): Record<string, string> {
		return Object.fromEntries(this.storeStatuses.entries());
	}

	private currentSession(): ReviewSession {
		return {
			notePath: "n.md",
			suggestions: [{ ...this.suggestion, status: this.storeStatuses.get("s1") ?? "pending" }],
		};
	}

	store = {
		getSession: (): ReviewSession | null => this.currentSession(),
		getCompletedSweep: () => null,
		selectSuggestion: (): void => {},
		updateSuggestionStatus: (id: string, status: ReviewSuggestion["status"]): void => {
			this.maybeFail("store.updateSuggestionStatus");
			this.storeStatuses.set(id, status);
		},
		setCompletedSweep: (): void => {},
		setGuidedSweep: (): void => {},
	};

	getSelectedSuggestionId(): string | null {
		return null;
	}
	getGuidedSweep(): GuidedSweepState | null {
		return null;
	}

	registry = {
		persistReviewDecision: async (
			_notePath: string,
			suggestion: ReviewSuggestion,
			status: "rejected" | "rewritten" | "deferred",
		): Promise<void> => {
			this.maybeFail("registry.persistReviewDecision");
			this.persistedDecisions.set(suggestion.id, status);
		},
		clearPersistedReviewDecision: async (
			_notePath: string,
			suggestion: ReviewSuggestion,
		): Promise<void> => {
			this.persistedDecisions.delete(suggestion.id);
		},
		syncReviewerSignalsForSession: async (): Promise<void> => {
			this.maybeFail("registry.syncReviewerSignalsForSession");
			this.signalsReflect = this.snapshot();
		},
		syncSceneInventoryForSession: async (): Promise<void> => {
			this.maybeFail("registry.syncSceneInventoryForSession");
			this.inventoryReflect = this.snapshot();
		},
	};

	getReviewNoteContext(): ReviewNoteContextLike | null {
		return {
			filePath: "n.md",
			text: "hello world",
			view: {
				editor: {
					offsetToPos: (offset: number) => ({ offset }),
					replaceRange: (): void => {},
					setSelection: (): void => {},
					scrollIntoView: (): void => {},
					focus: (): void => {},
					getValue: () => "HELLO world",
				},
			},
		};
	}
	getActiveEditorView(): unknown | null {
		return {};
	}
	async focusReviewLeaf(): Promise<void> {}
	executeEditorUndo(): boolean {
		return true;
	}
	notify(message: string): void {
		this.notices.push(message);
	}
	canAcceptSuggestion(): boolean {
		return true;
	}
	canRejectSuggestion(): boolean {
		return true;
	}
	canMarkSuggestionRewritten(): boolean {
		return true;
	}
	hasActiveReviewSession(): boolean {
		return true;
	}
	hasReviewSessionContext(): boolean {
		return true;
	}
	getReviewSession(): ReviewSession | null {
		return this.currentSession();
	}
	getSuggestionById(id: string): ReviewSuggestion | null {
		return id === "s1"
			? { ...this.suggestion, status: this.storeStatuses.get("s1") ?? "pending" }
			: null;
	}
	getCurrentSessionTrackingContext(): { sessionId?: string; sessionStartedAt?: number } {
		return { sessionId: "sess", sessionStartedAt: 1 };
	}
	getPanelOnlyReviewStateForSession(): unknown | null {
		return null;
	}
	async revealSelectedSuggestion(): Promise<void> {}
	async revealSuggestionContext(): Promise<void> {}
	async enterGuidedSweepHandoff(): Promise<void> {}
	refreshSessionAfterAcceptedEdit(): void {
		this.maybeFail("refreshSessionAfterAcceptedEdit");
	}
	syncActiveEditorDecorations(): void {}
	resyncSessionForActiveNote(): void {}
	async focusResolvedTarget(): Promise<void> {}
	get lastAppliedChange(): AppliedReviewChangeLike | null {
		return this._lastAppliedChange;
	}
	set lastAppliedChange(value: AppliedReviewChangeLike | null) {
		this._lastAppliedChange = value;
	}
	setActiveHighlight(): void {}
}

// After a failed decision the two authoritative sources of truth must agree
// AND match the pre-decision "pending" state, and the user must have been
// told.
function expectRolledBackToPending(host: StatefulHost): void {
	expect(host.storeStatuses.get("s1")).toBe("pending");
	expect(host.persistedDecisions.has("s1")).toBe(false);
	expect(host.notices.length).toBeGreaterThan(0);
}

describe("ReviewStateMachine — transaction safety on partial failure", () => {
	it("registry persist OK then store update fails -> decision rolled back, no divergence", async () => {
		const host = new StatefulHost({ failOnceAt: "store.updateSuggestionStatus" });
		const sm = new ReviewStateMachine(host);
		await sm.rejectSuggestion("s1");
		// persist had committed "rejected"; the failed store update must not
		// leave the decision index ahead of the store.
		expectRolledBackToPending(host);
	});

	it("store update OK then reviewer-signal sync fails -> store + decision reverted, signals reconciled", async () => {
		const host = new StatefulHost({ failOnceAt: "registry.syncReviewerSignalsForSession" });
		const sm = new ReviewStateMachine(host);
		await sm.rejectSuggestion("s1");
		expectRolledBackToPending(host);
		// reconcile re-ran signals against the reverted state.
		expect(host.signalsReflect).toEqual({ s1: "pending" });
	});

	it("reviewer-signal sync OK then scene-inventory sync fails -> reverted + projections reconciled", async () => {
		const host = new StatefulHost({ failOnceAt: "registry.syncSceneInventoryForSession" });
		const sm = new ReviewStateMachine(host);
		await sm.rejectSuggestion("s1");
		expectRolledBackToPending(host);
		expect(host.signalsReflect).toEqual({ s1: "pending" });
		expect(host.inventoryReflect).toEqual({ s1: "pending" });
	});

	it("defer: partial failure rolls back the same way", async () => {
		const host = new StatefulHost({ failOnceAt: "registry.syncSceneInventoryForSession" });
		const sm = new ReviewStateMachine(host);
		await sm.deferSuggestion("s1");
		expectRolledBackToPending(host);
	});

	it("rewrite: partial failure rolls back the same way", async () => {
		const host = new StatefulHost({ failOnceAt: "store.updateSuggestionStatus" });
		const sm = new ReviewStateMachine(host);
		await sm.markSuggestionRewritten("s1");
		expectRolledBackToPending(host);
	});

	it("accepted-edit refresh failure -> edit stays undoable, decision cleared, user notified", async () => {
		const host = new StatefulHost({ failOnceAt: "refreshSessionAfterAcceptedEdit" });
		const sm = new ReviewStateMachine(host);
		const result = await sm.applySuggestionById("s1", { highlightMode: "muted" });
		// The committed editor edit is reported and remains undoable.
		expect(result).toEqual({ start: 0, end: 5, suggestionId: "s1" });
		expect(host.lastAppliedChange?.suggestionId).toBe("s1");
		expect(host.lastAppliedChange?.notePath).toBe("n.md");
		// An accepted edit must not carry a stale pending decision.
		expect(host.persistedDecisions.has("s1")).toBe(false);
		expect(host.notices.length).toBeGreaterThan(0);
	});

	it("happy path is unaffected: reject with no injected failure commits cleanly", async () => {
		const host = new StatefulHost();
		const sm = new ReviewStateMachine(host);
		await sm.rejectSuggestion("s1");
		expect(host.storeStatuses.get("s1")).toBe("rejected");
		expect(host.persistedDecisions.get("s1")).toBe("rejected");
		expect(host.signalsReflect).toEqual({ s1: "rejected" });
		expect(host.inventoryReflect).toEqual({ s1: "rejected" });
		expect(host.notices).toEqual([]);
	});
});
