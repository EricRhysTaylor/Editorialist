// Characterization scaffold for the review state machine.
//
// This file is test-only data: golden host-call traces, ordering invariants,
// and the original extraction checklist. It used to live in
// src/core/review/ReviewStateMachineScaffold.ts; it has been moved out of the
// production source path because (a) it is never bundled by esbuild (no
// production import reaches it) and (b) keeping it under tests/scaffolds/
// makes its role unambiguous to readers and to the toolchain.
//
// History (preserved): this content was captured from a LINE-FAITHFUL read
// of the original main.ts implementation (~lines 1282–1567 plus the
// traversal/handoff wrappers ~3008–3057) as the safety harness for the
// extraction of the review state machine (acceptSuggestion /
// rejectSuggestion / markSuggestionRewritten / deferSuggestion /
// applySuggestionById / undoLastAppliedSuggestion / jumpToSuggestionTarget)
// out of main.ts.
//
// IMPORTANT — three former "pure/atomic" ops were corrected to their real
// host effects (they read the store via main.ts private wrappers):
//   • getAdjacentRevealableSuggestionId (main.ts:3011) calls
//       this.getReviewSession()  +  this.store.getState().selectedSuggestionId
//     before the pure ranking. → emits getReviewSession + getSelectedSuggestionId.
//   • shouldShowGuidedSweepHandoff (main.ts:3050) calls this.getGuidedSweep()
//     (and this.getReviewSession() only when no session arg is supplied).
//     Every caller passes an arg, so → emits getGuidedSweep. The ARG
//     expression `this.store.getSession()` is itself a recorded store.getSession.
//   • findPreferredSuggestionId (main.ts:3046) is genuinely pure, BUT its
//     caller passes `this.store.getSession()?.suggestions` → an extra
//     store.getSession at that call site.
// Repeated `this.store.getSession()` passed as arguments to the registry
// syncs are also recorded (they were previously omitted).
//
// RecordingReviewStateMachineHost replays each trace and asserts
// host.ops === expectedHostEffects(trace) (pure markers filtered).

import type { HostOp } from "../../src/core/review/ReviewStateMachineHost";

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

export interface TraceStep {
	op: HostOp;
	note?: string;
}
export interface StateMachineTrace {
	method: StateMachineMethod;
	scenario: string;
	steps: TraceStep[];
}

// Decomposition shared by every "compute adjacent" point (main.ts:3011):
//   const s = this.getReviewSession();            -> getReviewSession
//   if (!s || s.suggestions.length === 0) return null;
//   return pure(s.suggestions, this.store.getState().selectedSuggestionId, ...)
//                                                 -> getSelectedSuggestionId
const COMPUTE_NEXT: TraceStep[] = [
	{ op: "getReviewSession", note: "inside getAdjacentRevealableSuggestionId wrapper" },
	{ op: "getSelectedSuggestionId", note: "store.getState().selectedSuggestionId — DO NOT optimize away" },
	{ op: "getAdjacentRevealableSuggestionId", note: "pure ranking (filtered from host effects)" },
];

// ── Ordered behavior contract (golden traces) ────────────────────────────
export const STATE_MACHINE_TRACES: StateMachineTrace[] = [
	{
		method: "rejectSuggestion",
		scenario: "guard fails -> no-op",
		steps: [{ op: "canRejectSuggestion" }, { op: "return", note: "early; nothing persisted" }],
	},
	{
		method: "rejectSuggestion",
		scenario: "happy path, next suggestion exists",
		steps: [
			{ op: "canRejectSuggestion" },
			{ op: "getReviewSession", note: "const session" },
			{ op: "getSuggestionById" },
			{ op: "getCurrentSessionTrackingContext" },
			{ op: "registry.persistReviewDecision", note: "'rejected', persist:false — BEFORE status update" },
			...COMPUTE_NEXT,
			{ op: "store.updateSuggestionStatus" },
			{ op: "store.getSession", note: "ARG to syncReviewerSignalsForSession — extra read" },
			{ op: "registry.syncReviewerSignalsForSession", note: "persist:false" },
			{ op: "store.getSession", note: "ARG to syncSceneInventoryForSession — extra read" },
			{ op: "registry.syncSceneInventoryForSession", note: "single persisting call" },
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
			...COMPUTE_NEXT,
			{ op: "store.updateSuggestionStatus" },
			{ op: "store.getSession" },
			{ op: "registry.syncReviewerSignalsForSession" },
			{ op: "store.getSession" },
			{ op: "registry.syncSceneInventoryForSession" },
			{ op: "store.getSession", note: "ARG to shouldShowGuidedSweepHandoff(this.store.getSession())" },
			{ op: "getGuidedSweep", note: "shouldShowGuidedSweepHandoff decomposed; left operand of &&" },
			{ op: "enterGuidedSweepHandoff" },
		],
	},
	{
		method: "deferSuggestion",
		scenario: "happy path, next exists",
		steps: [
			{ op: "hasActiveReviewSession", note: "guard differs from reject" },
			{ op: "getReviewSession" },
			{ op: "getSuggestionById" },
			{ op: "getCurrentSessionTrackingContext" },
			{ op: "registry.persistReviewDecision", note: "'deferred'" },
			{ op: "getReviewSession", note: "compute-next wrapper" },
			{ op: "getSelectedSuggestionId" },
			{ op: "getAdjacentRevealableSuggestionId", note: "treatCurrentAsDeferred = TRUE (pure, filtered)" },
			{ op: "store.updateSuggestionStatus" },
			{ op: "store.getSession" },
			{ op: "registry.syncReviewerSignalsForSession" },
			{ op: "store.getSession" },
			{ op: "registry.syncSceneInventoryForSession" },
			{ op: "store.selectSuggestion" },
			{ op: "revealSelectedSuggestion" },
			{ op: "return", note: "tail has handoff branch only — no findPreferred fallback" },
		],
	},
	{
		method: "markSuggestionRewritten",
		scenario: "no handoff -> stays on current item (mirrors accept)",
		steps: [
			{ op: "canMarkSuggestionRewritten" },
			{ op: "getReviewSession" },
			{ op: "getSuggestionById" },
			{ op: "getCurrentSessionTrackingContext" },
			{ op: "registry.persistReviewDecision", note: "'rewritten'" },
			{ op: "store.updateSuggestionStatus" },
			{ op: "store.getSession" },
			{ op: "registry.syncReviewerSignalsForSession" },
			{ op: "store.getSession" },
			{ op: "registry.syncSceneInventoryForSession" },
			{ op: "store.getSession", note: "ARG to shouldShowGuidedSweepHandoff" },
			{ op: "getGuidedSweep", note: "handoff check returns false here" },
			{ op: "store.selectSuggestion", note: "stays on the just-rewritten id; no advance, no findPreferred (mirrors acceptSuggestion's select(id) tail)" },
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
			{ op: "notify", note: "active note mismatch" },
			{ op: "return", note: "null" },
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
			{ op: "createSuggestionApplyPlan", note: "pure (filtered)" },
			{ op: "notify" },
			{ op: "return", note: "null" },
		],
	},
	{
		method: "applySuggestionById",
		scenario: "success (highlightMode muted, no preserveSelection, syncSceneInventory default)",
		steps: [
			{ op: "getReviewNoteContext" },
			{ op: "store.getSession" },
			{ op: "getSuggestionById" },
			{ op: "canAcceptSuggestion" },
			{ op: "createSuggestionApplyPlan", note: "pure (filtered)" },
			{ op: "editor.replaceRange", note: "after offsetToPos(from/to) — offsetToPos not recorded" },
			{ op: "editor.setSelection" },
			{ op: "editor.scrollIntoView" },
			{ op: "editor.focus" },
			{ op: "registry.clearPersistedReviewDecision", note: "persist:false" },
			{ op: "refreshSessionAfterAcceptedEdit" },
			{ op: "getCurrentSessionTrackingContext" },
			{ op: "store.getSession", note: "ARG to syncReviewerSignalsForSession" },
			{ op: "registry.syncReviewerSignalsForSession" },
			{ op: "editor.getValue", note: "arg to getNoteTextFingerprint" },
			{ op: "getNoteTextFingerprint", note: "pure (filtered)" },
			{ op: "set.lastAppliedChange", note: "BEFORE scene-inventory sync" },
			{ op: "store.getSession", note: "ARG to syncSceneInventoryForSession (skipped if syncSceneInventory===false)" },
			{ op: "registry.syncSceneInventoryForSession" },
			{ op: "store.selectSuggestion", note: "skipped if options.preserveSelection" },
			{ op: "setActiveHighlight", note: "only highlightMode==='muted'" },
			{ op: "syncActiveEditorDecorations", note: "only highlightMode==='muted'" },
			{ op: "return", note: "{ start, end, suggestionId }" },
		],
	},
	{
		method: "acceptSuggestion",
		scenario: "apply fails -> false",
		steps: [
			{ op: "getSuggestionById", note: "acceptedSuggestion, BEFORE apply" },
			{ op: "getReviewNoteContext", note: "applySuggestionById internal" },
			{ op: "store.getSession" },
			{ op: "getSuggestionById" },
			{ op: "notify", note: "apply guard fails -> applied change null" },
			{ op: "return", note: "false" },
		],
	},
	{
		method: "acceptSuggestion",
		scenario: "handoff wins over selection advance",
		steps: [
			{ op: "getSuggestionById", note: "acceptedSuggestion" },
			// applySuggestionById success (inlined)
			{ op: "getReviewNoteContext" },
			{ op: "store.getSession" },
			{ op: "getSuggestionById" },
			{ op: "canAcceptSuggestion" },
			{ op: "createSuggestionApplyPlan", note: "pure (filtered)" },
			{ op: "editor.replaceRange" },
			{ op: "editor.setSelection" },
			{ op: "editor.scrollIntoView" },
			{ op: "editor.focus" },
			{ op: "registry.clearPersistedReviewDecision" },
			{ op: "refreshSessionAfterAcceptedEdit" },
			{ op: "getCurrentSessionTrackingContext" },
			{ op: "store.getSession" },
			{ op: "registry.syncReviewerSignalsForSession" },
			{ op: "editor.getValue" },
			{ op: "getNoteTextFingerprint", note: "pure (filtered)" },
			{ op: "set.lastAppliedChange" },
			{ op: "store.getSession" },
			{ op: "registry.syncSceneInventoryForSession" },
			{ op: "store.selectSuggestion" },
			{ op: "setActiveHighlight" },
			{ op: "syncActiveEditorDecorations" },
			// back in acceptSuggestion
			{ op: "store.getSession", note: "const refreshedSession" },
			{ op: "getGuidedSweep", note: "shouldShowGuidedSweepHandoff(refreshedSession) — arg supplied, no getReviewSession" },
			{ op: "enterGuidedSweepHandoff" },
			{ op: "return", note: "true; branch order: handoff > panelOnly+next > cut+next > move > !range+next > select id" },
		],
	},
	{
		method: "acceptSuggestion",
		scenario: "move operation re-selects same id",
		steps: [
			{ op: "getSuggestionById", note: "acceptedSuggestion" },
			{ op: "getReviewNoteContext" },
			{ op: "store.getSession" },
			{ op: "getSuggestionById" },
			{ op: "canAcceptSuggestion" },
			{ op: "createSuggestionApplyPlan", note: "pure (filtered)" },
			{ op: "editor.replaceRange" },
			{ op: "editor.setSelection" },
			{ op: "editor.scrollIntoView" },
			{ op: "editor.focus" },
			{ op: "registry.clearPersistedReviewDecision" },
			{ op: "refreshSessionAfterAcceptedEdit" },
			{ op: "getCurrentSessionTrackingContext" },
			{ op: "store.getSession" },
			{ op: "registry.syncReviewerSignalsForSession" },
			{ op: "editor.getValue" },
			{ op: "getNoteTextFingerprint", note: "pure (filtered)" },
			{ op: "set.lastAppliedChange" },
			{ op: "store.getSession" },
			{ op: "registry.syncSceneInventoryForSession" },
			{ op: "store.selectSuggestion" },
			{ op: "setActiveHighlight" },
			{ op: "syncActiveEditorDecorations" },
			{ op: "store.getSession", note: "refreshedSession" },
			{ op: "getGuidedSweep", note: "shouldShowGuidedSweepHandoff false" },
			{ op: "getReviewSession", note: "getAdjacentRevealableSuggestionId('next', id)" },
			{ op: "getSelectedSuggestionId" },
			{ op: "getAdjacentRevealableSuggestionId", note: "pure (filtered)" },
			{ op: "getPanelOnlyReviewStateForSession", note: "false -> not panel branch" },
			{ op: "store.selectSuggestion", note: "operation 'move' -> select(id)" },
			{ op: "revealSelectedSuggestion" },
			{ op: "return" },
		],
	},
	{
		method: "undoLastAppliedSuggestion",
		scenario: "no change / wrong note -> notify + return",
		steps: [
			{ op: "getReviewNoteContext" },
			{ op: "store.getCompletedSweep", note: "getSuggestionById NOT called — change is null" },
			{ op: "notify", note: "'No applied change is ready to undo.'" },
			{ op: "return" },
		],
	},
	{
		method: "undoLastAppliedSuggestion",
		scenario: "success with completed-sweep restore",
		steps: [
			{ op: "getReviewNoteContext" },
			{ op: "getSuggestionById", note: "only because lastAppliedChange is set" },
			{ op: "store.getCompletedSweep" },
			{ op: "focusReviewLeaf" },
			{ op: "getActiveEditorView" },
			{ op: "executeEditorUndo", note: "false -> notify+return" },
			{ op: "registry.clearPersistedReviewDecision", note: "only if appliedSuggestion resolved" },
			{ op: "set.lastAppliedChange", note: "= null" },
			{ op: "store.setCompletedSweep", note: "null — only when completedSweep present" },
			{ op: "store.setGuidedSweep", note: "restore from completed snapshot" },
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
			{ op: "getSuggestionPrimaryTarget", note: "pure (filtered)" },
			{ op: "store.selectSuggestion" },
			{ op: "focusResolvedTarget" },
		],
	},
];

export const ORDERING_INVARIANTS = [
	"persistReviewDecision runs BEFORE store.updateSuggestionStatus (reject/defer/rewrite)",
	"the compute-next read pair (getReviewSession + getSelectedSuggestionId) runs BEFORE store.updateSuggestionStatus",
	"each registry sync is preceded by its own store.getSession ARG read — these extra reads must NOT be optimized away",
	"syncReviewerSignalsForSession uses persist:false; syncSceneInventoryForSession is the single persisting call",
	"applySuggestionById sets lastAppliedChange BEFORE syncSceneInventoryForSession",
	"editor.replaceRange precedes registry.clearPersistedReviewDecision",
	"acceptSuggestion branch order: handoff > (panelOnly && next) > (cut && next) > move > (!range && next) > select(id)",
	"deferSuggestion passes treatCurrentAsDeferred=true; reject/rewrite pass false/default",
	"markSuggestionRewritten stays on the just-rewritten id (mirrors acceptSuggestion's select(id) tail); no advance, no findPreferredSuggestionId fallback",
	"shouldShowGuidedSweepHandoff is NOT atomic: it decomposes to getGuidedSweep, and its caller arg `store.getSession()` is a recorded read",
	"undo restores guided sweep from the completed-sweep snapshot only when one was present",
] as const;

export const EXTRACTION_CHECKLIST = [
	"Host adds focused getSelectedSuggestionId() and getGuidedSweep() (done in this scaffold).",
	"Recording fake implements ReviewStateMachineHost and replays every STATE_MACHINE_TRACES entry; host.ops toEqual expectedHostEffects(trace).",
	"All ORDERING_INVARIANTS have a dedicated assertion.",
	"createSuggestionApplyPlan characterized (done: OperationSupport.applyPlan.test.ts).",
	"SuggestionTraversal pure + tested (done).",
	"The extracted machine reimplements getAdjacentRevealableSuggestionId/shouldShowGuidedSweepHandoff via host primitives — it must NOT collapse the documented extra store reads.",
	"main.ts keeps thin async wrappers delegating to the extracted machine; no call sites change.",
	"npm run check + npm run test + css-drift --strict green on the extraction commit.",
	"Single revertible commit; wrappers keep main.ts independently compilable.",
] as const;
