// SCAFFOLD ONLY — no behavior, not wired into main.ts.
//
// Safety harness for the eventual extraction of the review state machine
// (acceptSuggestion / rejectSuggestion / markSuggestionRewritten /
// deferSuggestion / applySuggestionById / undoLastAppliedSuggestion /
// jumpToSuggestionTarget) out of main.ts.
//
// Unlike ToolbarViewModel, this logic is side-effectful (editor mutation,
// Notice, app.commands, decorations, store/registry writes), so it cannot be
// fixture-tested as a pure function. Instead this file captures, from a
// read-only pass over the CURRENT main.ts code:
//   1. ReviewStateMachineHost — every collaborator the machine touches.
//   2. STATE_MACHINE_TRACES — the exact ordered host-call sequence per
//      method/branch (the behavior contract).
//   3. EXTRACTION_CHECKLIST — the gate that must be true before extracting.
//
// Post-extraction, a recording fake implementing ReviewStateMachineHost
// replays each trace: expect(recorder.ops).toEqual(trace.steps...) — turning
// these into a true parity gate with zero re-authoring.

import type { ReviewSuggestion } from "../../models/ReviewSuggestion";

// ── Host contract ────────────────────────────────────────────────────────
// Every member the state machine reads or invokes. Grouped by dependency
// class (see the original seam audit). The future ReviewStateMachine takes
// exactly this as its constructor dependency; main.ts implements it.
export interface ReviewStateMachineHost {
	// — store (mutable review state) —
	store: {
		getSession(): ReviewSession | null;
		getCompletedSweep(): CompletedSweepState | null;
		selectSuggestion(id: string | null): void;
		updateSuggestionStatus(id: string, status: ReviewSuggestion["status"]): void;
		setCompletedSweep(value: CompletedSweepState | null): void;
		setGuidedSweep(value: GuidedSweepState | null): void;
	};

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
	executeEditorUndo(): boolean; // wraps app.commands.executeCommandById("editor:undo")
	notify(message: string): void; // wraps new Notice(...)

	// — guards / resolvers (pure-ish over store + match state) —
	canAcceptSuggestion(id: string): boolean;
	canRejectSuggestion(id: string): boolean;
	canMarkSuggestionRewritten(id: string): boolean;
	hasActiveReviewSession(): boolean;
	hasReviewSessionContext(): boolean;
	getReviewSession(): ReviewSession | null;
	getSuggestionById(id: string): ReviewSuggestion | null;
	getCurrentSessionTrackingContext(): { sessionId?: string; sessionStartedAt?: number };
	shouldShowGuidedSweepHandoff(session: ReviewSession | null): boolean;
	getPanelOnlyReviewStateForSession(session: ReviewSession | null): unknown | null;

	// — UI / reveal / decorations —
	revealSelectedSuggestion(): Promise<void>;
	revealSuggestionContext(id: string): Promise<void>;
	enterGuidedSweepHandoff(): Promise<void>;
	refreshSessionAfterAcceptedEdit(session: ReviewSession, suggestionId: string): void;
	syncActiveEditorDecorations(): void;
	resyncSessionForActiveNote(): void;
	focusResolvedTarget(target: unknown): Promise<void>;

	// — mutable plugin fields (read AND write) —
	lastAppliedChange: AppliedReviewChangeLike | null;
	setActiveHighlight(range: { start: number; end: number } | null, tone: "muted" | null): void;
}

// Structural placeholders — the real types live in models/state and are not
// imported here to keep the scaffold dependency-free.
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

export const STATE_MACHINE_METHODS = [
	"acceptSuggestion",
	"rejectSuggestion",
	"markSuggestionRewritten",
	"deferSuggestion",
	"applySuggestionById",
	"undoLastAppliedSuggestion",
	"jumpToSuggestionTarget",
] as const;
export type StateMachineMethod = (typeof STATE_MACHINE_METHODS)[number];

// Every legal trace `op` value. Used by the contract test so a fixture
// cannot reference a host member that does not exist.
export const HOST_OPS = [
	"store.getSession",
	"store.getCompletedSweep",
	"store.selectSuggestion",
	"store.updateSuggestionStatus",
	"store.setCompletedSweep",
	"store.setGuidedSweep",
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
	"shouldShowGuidedSweepHandoff",
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

export interface TraceStep {
	op: HostOp;
	note?: string;
}
export interface StateMachineTrace {
	method: StateMachineMethod;
	scenario: string;
	steps: TraceStep[];
}

// ── Ordered behavior contract (golden traces) ────────────────────────────
// Derived read-only from the current main.ts. Ordering is significant; the
// callout invariants are asserted explicitly in the test.
export const STATE_MACHINE_TRACES: StateMachineTrace[] = [
	{
		method: "rejectSuggestion",
		scenario: "guard fails -> no-op",
		steps: [{ op: "canRejectSuggestion" }, { op: "return", note: "early, nothing persisted" }],
	},
	{
		method: "rejectSuggestion",
		scenario: "happy path, next suggestion exists",
		steps: [
			{ op: "canRejectSuggestion" },
			{ op: "getReviewSession" },
			{ op: "getSuggestionById" },
			{ op: "getCurrentSessionTrackingContext" },
			{ op: "registry.persistReviewDecision", note: "status 'rejected', persist:false — BEFORE status update" },
			{ op: "getAdjacentRevealableSuggestionId", note: "'next', id — computed BEFORE updateSuggestionStatus" },
			{ op: "store.updateSuggestionStatus" },
			{ op: "registry.syncReviewerSignalsForSession", note: "persist:false" },
			{ op: "registry.syncSceneInventoryForSession", note: "no persist option -> this is the single persist point" },
			{ op: "store.selectSuggestion" },
			{ op: "revealSelectedSuggestion" },
			{ op: "return" },
		],
	},
	{
		method: "rejectSuggestion",
		scenario: "no next -> guided-sweep handoff",
		steps: [
			{ op: "canRejectSuggestion" },
			{ op: "getReviewSession" },
			{ op: "getSuggestionById" },
			{ op: "getCurrentSessionTrackingContext" },
			{ op: "registry.persistReviewDecision" },
			{ op: "getAdjacentRevealableSuggestionId" },
			{ op: "store.updateSuggestionStatus" },
			{ op: "registry.syncReviewerSignalsForSession" },
			{ op: "registry.syncSceneInventoryForSession" },
			{ op: "shouldShowGuidedSweepHandoff" },
			{ op: "enterGuidedSweepHandoff" },
		],
	},
	{
		method: "deferSuggestion",
		scenario: "happy path",
		steps: [
			{ op: "hasActiveReviewSession", note: "guard differs from reject (not canRejectSuggestion)" },
			{ op: "getReviewSession" },
			{ op: "getSuggestionById" },
			{ op: "getCurrentSessionTrackingContext" },
			{ op: "registry.persistReviewDecision", note: "status 'deferred'" },
			{ op: "getAdjacentRevealableSuggestionId", note: "'next', id, treatCurrentAsDeferred = TRUE" },
			{ op: "store.updateSuggestionStatus" },
			{ op: "registry.syncReviewerSignalsForSession" },
			{ op: "registry.syncSceneInventoryForSession" },
			{ op: "store.selectSuggestion" },
			{ op: "revealSelectedSuggestion" },
			{ op: "return", note: "tail has handoff branch only — no findPreferred fallback" },
		],
	},
	{
		method: "markSuggestionRewritten",
		scenario: "no next, no handoff -> preferred fallback (UNIQUE to rewrite)",
		steps: [
			{ op: "canMarkSuggestionRewritten" },
			{ op: "getReviewSession" },
			{ op: "getSuggestionById" },
			{ op: "getCurrentSessionTrackingContext" },
			{ op: "registry.persistReviewDecision", note: "status 'rewritten'" },
			{ op: "getAdjacentRevealableSuggestionId" },
			{ op: "store.updateSuggestionStatus" },
			{ op: "registry.syncReviewerSignalsForSession" },
			{ op: "registry.syncSceneInventoryForSession" },
			{ op: "shouldShowGuidedSweepHandoff" },
			{ op: "findPreferredSuggestionId", note: "reject/defer do NOT have this fallback" },
			{ op: "store.selectSuggestion" },
			{ op: "revealSelectedSuggestion" },
		],
	},
	{
		method: "applySuggestionById",
		scenario: "context/session/suggestion guard fails",
		steps: [
			{ op: "getReviewNoteContext" },
			{ op: "store.getSession" },
			{ op: "getSuggestionById" },
			{ op: "notify", note: "active note mismatch message" },
			{ op: "return", note: "returns null" },
		],
	},
	{
		method: "applySuggestionById",
		scenario: "canAccept guard fails",
		steps: [
			{ op: "getReviewNoteContext" },
			{ op: "store.getSession" },
			{ op: "getSuggestionById" },
			{ op: "canAcceptSuggestion" },
			{ op: "notify" },
			{ op: "return", note: "null" },
		],
	},
	{
		method: "applySuggestionById",
		scenario: "no apply plan",
		steps: [
			{ op: "getReviewNoteContext" },
			{ op: "store.getSession" },
			{ op: "getSuggestionById" },
			{ op: "canAcceptSuggestion" },
			{ op: "createSuggestionApplyPlan" },
			{ op: "notify" },
			{ op: "return", note: "null" },
		],
	},
	{
		method: "applySuggestionById",
		scenario: "success (highlightMode muted, no preserveSelection)",
		steps: [
			{ op: "getReviewNoteContext" },
			{ op: "store.getSession" },
			{ op: "getSuggestionById" },
			{ op: "canAcceptSuggestion" },
			{ op: "createSuggestionApplyPlan" },
			{ op: "editor.replaceRange" },
			{ op: "editor.setSelection" },
			{ op: "editor.scrollIntoView" },
			{ op: "editor.focus" },
			{ op: "registry.clearPersistedReviewDecision", note: "persist:false" },
			{ op: "refreshSessionAfterAcceptedEdit" },
			{ op: "getCurrentSessionTrackingContext" },
			{ op: "registry.syncReviewerSignalsForSession" },
			{ op: "editor.getValue" },
			{ op: "getNoteTextFingerprint" },
			{ op: "set.lastAppliedChange", note: "written BEFORE scene-inventory sync" },
			{ op: "registry.syncSceneInventoryForSession", note: "skipped when options.syncSceneInventory === false" },
			{ op: "store.selectSuggestion", note: "skipped when options.preserveSelection" },
			{ op: "setActiveHighlight", note: "only when highlightMode === 'muted'" },
			{ op: "syncActiveEditorDecorations", note: "only when highlightMode === 'muted'" },
			{ op: "return", note: "{ start, end, suggestionId }" },
		],
	},
	{
		method: "acceptSuggestion",
		scenario: "apply fails -> false",
		steps: [
			{ op: "getSuggestionById", note: "captured BEFORE apply (operation read later)" },
			{ op: "createSuggestionApplyPlan", note: "via applySuggestionById" },
			{ op: "return", note: "false when applied change is null" },
		],
	},
	{
		method: "acceptSuggestion",
		scenario: "handoff wins over selection advance",
		steps: [
			{ op: "getSuggestionById" },
			{ op: "store.getSession", note: "refreshedSession" },
			{ op: "shouldShowGuidedSweepHandoff" },
			{ op: "enterGuidedSweepHandoff" },
			{ op: "return", note: "true; branch order: handoff > panelOnly+next > cut+next > move > !range+next > select id" },
		],
	},
	{
		method: "acceptSuggestion",
		scenario: "move operation re-selects same id",
		steps: [
			{ op: "getSuggestionById" },
			{ op: "store.getSession" },
			{ op: "shouldShowGuidedSweepHandoff" },
			{ op: "getAdjacentRevealableSuggestionId" },
			{ op: "getPanelOnlyReviewStateForSession" },
			{ op: "store.selectSuggestion", note: "operation 'move' -> select(id), not next" },
			{ op: "revealSelectedSuggestion" },
			{ op: "return" },
		],
	},
	{
		method: "undoLastAppliedSuggestion",
		scenario: "no change / wrong note -> notify + return",
		steps: [
			{ op: "getReviewNoteContext" },
			{ op: "getSuggestionById", note: "only if lastAppliedChange set" },
			{ op: "store.getCompletedSweep" },
			{ op: "notify", note: "'No applied change is ready to undo.'" },
			{ op: "return" },
		],
	},
	{
		method: "undoLastAppliedSuggestion",
		scenario: "success with completed-sweep restore",
		steps: [
			{ op: "getReviewNoteContext" },
			{ op: "getSuggestionById" },
			{ op: "store.getCompletedSweep" },
			{ op: "focusReviewLeaf" },
			{ op: "getActiveEditorView" },
			{ op: "executeEditorUndo", note: "app.commands editor:undo; false -> notify+return" },
			{ op: "registry.clearPersistedReviewDecision", note: "only if appliedSuggestion resolved" },
			{ op: "set.lastAppliedChange", note: "set to null" },
			{ op: "store.setCompletedSweep", note: "null — only when completedSweep was present" },
			{ op: "store.setGuidedSweep", note: "restores guided sweep from the completed snapshot" },
			{ op: "resyncSessionForActiveNote" },
			{ op: "store.selectSuggestion" },
			{ op: "revealSuggestionContext" },
			{ op: "notify", note: "'Applied change undone.'" },
		],
	},
	{
		method: "jumpToSuggestionTarget",
		scenario: "happy path",
		steps: [
			{ op: "hasReviewSessionContext" },
			{ op: "getSuggestionById" },
			{ op: "store.selectSuggestion" },
			{ op: "getSuggestionPrimaryTarget" },
			{ op: "focusResolvedTarget" },
		],
	},
];

// ── Invariants that must hold post-extraction ────────────────────────────
export const ORDERING_INVARIANTS = [
	"persistReviewDecision runs BEFORE store.updateSuggestionStatus (reject/defer/rewrite)",
	"getAdjacentRevealableSuggestionId is computed BEFORE store.updateSuggestionStatus",
	"syncReviewerSignalsForSession uses persist:false; syncSceneInventoryForSession is the single persisting call",
	"applySuggestionById sets lastAppliedChange BEFORE syncSceneInventoryForSession",
	"acceptSuggestion branch order: handoff > (panelOnly && next) > (cut && next) > move > (!range && next) > select(id)",
	"deferSuggestion passes treatCurrentAsDeferred=true to getAdjacentRevealableSuggestionId; reject/rewrite pass false/default",
	"only markSuggestionRewritten has the findPreferredSuggestionId fallback tail",
	"undo restores guided sweep from the completed-sweep snapshot only when one was present",
] as const;

// ── Extraction gate ──────────────────────────────────────────────────────
export const EXTRACTION_CHECKLIST = [
	"A recording fake implementing ReviewStateMachineHost exists in tests.",
	"Every STATE_MACHINE_TRACES entry is replayed against the fake post-extraction and the recorded op order toEqual the trace.",
	"All ORDERING_INVARIANTS have a dedicated assertion.",
	"createSuggestionApplyPlan is already characterized (done: OperationSupport.applyPlan.test.ts).",
	"SuggestionTraversal is already pure + tested (done).",
	"main.ts keeps thin async wrappers delegating to the extracted machine; no call sites change.",
	"npm run check + npm run test + css-drift --strict green on the extraction commit.",
	"Single revertible commit; wrappers keep main.ts independently compilable.",
] as const;
