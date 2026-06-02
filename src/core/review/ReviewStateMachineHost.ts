// Host contract for the extracted review state machine.
//
// The state machine (ReviewStateMachine) is side-effectful: it mutates the
// editor, fires Notice, calls app.commands, writes decorations, and persists
// store + registry changes. Rather than reach for those collaborators
// directly, it depends only on this host interface, which main.ts adapts to
// the live plugin. The same interface is what RecordingReviewStateMachineHost
// implements when replaying golden traces.
//
// This module is production code — it ships in the bundle and is the only
// shared file between main.ts, ReviewStateMachine, and the recording host.
// The test-only characterization data (golden traces, ordering invariants,
// extraction checklist) used to live alongside this contract in a
// "ReviewStateMachineScaffold" file; it now lives in
// tests/scaffolds/ReviewStateMachineScaffold.ts.

import type { ReviewSuggestion } from "../../models/ReviewSuggestion";

// ── Host contract ────────────────────────────────────────────────────────
export interface ReviewStateMachineHost {
	// — store (mutable review state) —
	store: {
		getSession(): ReviewSession | null;
		getCompletedSweep(): CompletedSweepState | null;
		selectSuggestion(id: string | null): void;
		updateSuggestionStatus(id: string, status: ReviewSuggestion["status"]): void;
		// Within the extracted state machine this is only ever called with null
		// (undo clears the completed sweep); narrowed to keep the main.ts
		// adapter type-safe without exposing the full CompletedSweepState shape.
		setCompletedSweep(value: null): void;
		setGuidedSweep(value: GuidedSweepState | null): void;
	};

	// — focused store reads the traversal/handoff logic depends on —
	// (kept as focused host methods rather than exposing store.getState()) —
	getSelectedSuggestionId(): string | null; // = this.store.getState().selectedSuggestionId
	getGuidedSweep(): GuidedSweepState | null; // = this.store.getGuidedSweep()

	// — registry (persisted indexes; injected, never modified here) —
	registry: {
		persistReviewDecision(
			notePath: string,
			suggestion: ReviewSuggestion,
			status: "rejected" | "rewritten" | "deferred",
			options: { persist: false; sessionId?: string; sessionStartedAt?: number },
		): Promise<void>;
		clearPersistedReviewDecision(
			notePath: string,
			suggestion: ReviewSuggestion,
			options: { persist: false },
		): Promise<void>;
		syncReviewerSignalsForSession(
			session: ReviewSession | null,
			options: { persist: false; sessionId?: string; sessionStartedAt?: number },
		): Promise<void>;
		syncSceneInventoryForSession(session: ReviewSession | null): Promise<void>;
	};

	// — editor / Obsidian —
	getReviewNoteContext(): ReviewNoteContextLike | null;
	getActiveEditorView(): unknown | null;
	focusReviewLeaf(view: unknown): Promise<void>;
	executeEditorUndo(): boolean; // drives the active MarkdownView editor's undo(); returns whether the document changed
	notify(message: string): void; // wraps new Notice(...)

	// — guards / resolvers (atomic adapter methods) —
	canAcceptSuggestion(id: string): boolean;
	canRejectSuggestion(id: string): boolean;
	canMarkSuggestionRewritten(id: string): boolean;
	hasActiveReviewSession(): boolean;
	hasReviewSessionContext(): boolean;
	getReviewSession(): ReviewSession | null;
	getSuggestionById(id: string): ReviewSuggestion | null;
	getCurrentSessionTrackingContext(): { sessionId?: string; sessionStartedAt?: number };
	getPanelOnlyReviewStateForSession(session: ReviewSession | null): unknown | null;

	// — UI / reveal / decorations —
	revealSelectedSuggestion(): Promise<void>;
	revealSuggestionContext(id: string): Promise<void>;
	enterGuidedSweepHandoff(): Promise<void>;
	refreshSessionAfterAcceptedEdit(session: ReviewSession, suggestionId: string): void | Promise<void>;
	syncActiveEditorDecorations(): void;
	resyncSessionForActiveNote(): void;
	focusResolvedTarget(target: unknown): Promise<void>;

	// — mutable plugin fields (read AND write) —
	lastAppliedChange: AppliedReviewChangeLike | null;
	setActiveHighlight(range: { start: number; end: number } | null, tone: "muted" | null): void;
}

// Structural placeholders — real types live in models/state.
export interface ReviewSession {
	notePath: string;
	suggestions: ReviewSuggestion[];
}
export interface CompletedSweepState {
	batchId: string;
	currentNoteIndex: number;
	notePaths: string[];
	startedAt: number;
}
export interface GuidedSweepState {
	batchId: string;
	currentNoteIndex: number;
	notePaths: string[];
	startedAt: number;
}
export interface ReviewNoteContextLike {
	filePath: string;
	text: string;
	view: unknown;
}
export interface AppliedReviewChangeLike {
	start: number;
	end: number;
	notePath: string;
	suggestionId: string;
	textFingerprint: string;
}

// Every legal trace `op`. `shouldShowGuidedSweepHandoff` is GONE — it is not
// a host op; it decomposes to getGuidedSweep (+ store.getSession arg).
// getSelectedSuggestionId / getGuidedSweep are NEW host effects.
//
// The HOST_OPS list is part of the host contract because the recording host
// (production-source test helper) types its `ops` array against HostOp.
// The golden trace data that ranges over this vocabulary lives in
// tests/scaffolds/ReviewStateMachineScaffold.ts.
export const HOST_OPS = [
	"store.getSession",
	"store.getCompletedSweep",
	"store.selectSuggestion",
	"store.updateSuggestionStatus",
	"store.setCompletedSweep",
	"store.setGuidedSweep",
	"getSelectedSuggestionId",
	"getGuidedSweep",
	"registry.persistReviewDecision",
	"registry.clearPersistedReviewDecision",
	"registry.syncReviewerSignalsForSession",
	"registry.syncSceneInventoryForSession",
	"getReviewNoteContext",
	"getActiveEditorView",
	"focusReviewLeaf",
	"executeEditorUndo",
	"notify",
	"canAcceptSuggestion",
	"canRejectSuggestion",
	"canMarkSuggestionRewritten",
	"hasActiveReviewSession",
	"hasReviewSessionContext",
	"getReviewSession",
	"getSuggestionById",
	"getCurrentSessionTrackingContext",
	"getPanelOnlyReviewStateForSession",
	"revealSelectedSuggestion",
	"revealSuggestionContext",
	"enterGuidedSweepHandoff",
	"refreshSessionAfterAcceptedEdit",
	"syncActiveEditorDecorations",
	"resyncSessionForActiveNote",
	"focusResolvedTarget",
	"createSuggestionApplyPlan",
	"editor.replaceRange",
	"editor.setSelection",
	"editor.scrollIntoView",
	"editor.focus",
	"editor.getValue",
	"getNoteTextFingerprint",
	"set.lastAppliedChange",
	"setActiveHighlight",
	"getAdjacentRevealableSuggestionId",
	"findPreferredSuggestionId",
	"getSuggestionPrimaryTarget",
	"return",
] as const;
export type HostOp = (typeof HOST_OPS)[number];
