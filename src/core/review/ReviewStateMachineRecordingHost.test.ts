import { describe, it, expect } from "vitest";
import { HOST_OPS, STATE_MACHINE_TRACES, type HostOp } from "./ReviewStateMachineScaffold";
import {
	PURE_OR_MARKER_OPS,
	RecordingReviewStateMachineHost,
	expectedHostEffects,
} from "./ReviewStateMachineRecordingHost";

const HOST_EFFECT_VOCAB = new Set<HostOp>(HOST_OPS.filter((op) => !PURE_OR_MARKER_OPS.has(op)));

// Exercise every host member (incl. the fake editor + mutable-field setters)
// and collect the set of ops it can emit.
function drainEmittableOps(): Set<HostOp> {
	const host = new RecordingReviewStateMachineHost({
		session: { notePath: "n.md", suggestions: [] },
		suggestionsById: {},
	});
	host.store.getSession();
	host.store.getCompletedSweep();
	host.store.selectSuggestion();
	host.store.updateSuggestionStatus();
	host.store.setCompletedSweep();
	host.store.setGuidedSweep(null);
	void host.registry.persistReviewDecision();
	void host.registry.clearPersistedReviewDecision();
	void host.registry.syncReviewerSignalsForSession();
	void host.registry.syncSceneInventoryForSession();
	const ctx = host.getReviewNoteContext() as { view: { editor: Record<string, (...a: unknown[]) => unknown> } };
	host.getActiveEditorView();
	void host.focusReviewLeaf();
	host.executeEditorUndo();
	host.notify();
	host.canAcceptSuggestion();
	host.canRejectSuggestion();
	host.canMarkSuggestionRewritten();
	host.hasActiveReviewSession();
	host.hasReviewSessionContext();
	host.shouldShowGuidedSweepHandoff();
	host.getReviewSession();
	host.getSuggestionById("x");
	host.getCurrentSessionTrackingContext();
	host.getPanelOnlyReviewStateForSession();
	void host.revealSelectedSuggestion();
	void host.revealSuggestionContext();
	void host.enterGuidedSweepHandoff();
	host.refreshSessionAfterAcceptedEdit();
	host.syncActiveEditorDecorations();
	host.resyncSessionForActiveNote();
	void host.focusResolvedTarget();
	ctx.view.editor.replaceRange("", null, null);
	ctx.view.editor.setSelection(null, null);
	ctx.view.editor.scrollIntoView(null, true);
	ctx.view.editor.focus();
	ctx.view.editor.getValue();
	host.lastAppliedChange = null;
	host.setActiveHighlight();
	return new Set(host.ops);
}

describe("RecordingReviewStateMachineHost — harness self-tests", () => {
	it("records host calls in order and reset() clears the log", () => {
		const host = new RecordingReviewStateMachineHost({ guards: { canRejectSuggestion: true } });
		host.canRejectSuggestion();
		host.getReviewSession();
		host.store.updateSuggestionStatus();
		expect(host.ops).toEqual(["canRejectSuggestion", "getReviewSession", "store.updateSuggestionStatus"]);
		host.reset();
		expect(host.ops).toEqual([]);
	});

	it("the fake editor (via getReviewNoteContext) records editor.* sub-ops", () => {
		const host = new RecordingReviewStateMachineHost({ editorValue: "DOC" });
		const ctx = host.getReviewNoteContext() as { view: { editor: { replaceRange: (...a: unknown[]) => void; getValue: () => string } } };
		ctx.view.editor.replaceRange("x", null, null);
		expect(ctx.view.editor.getValue()).toBe("DOC");
		expect(host.ops).toEqual(["getReviewNoteContext", "editor.replaceRange", "editor.getValue"]);
	});

	it("the lastAppliedChange setter records and round-trips the value", () => {
		const host = new RecordingReviewStateMachineHost();
		const change = { start: 1, end: 2, notePath: "n.md", suggestionId: "s", textFingerprint: "fp" };
		host.lastAppliedChange = change;
		expect(host.lastAppliedChange).toEqual(change);
		expect(host.ops).toEqual(["set.lastAppliedChange"]);
	});

	it("configured returns flow through (guards, undo result, suggestion lookup)", () => {
		const s = { id: "s1" } as never;
		const host = new RecordingReviewStateMachineHost({
			guards: { canAcceptSuggestion: true },
			editorUndoResult: false,
			suggestionsById: { s1: s },
		});
		expect(host.canAcceptSuggestion()).toBe(true);
		expect(host.canRejectSuggestion()).toBe(false); // unset guard defaults false
		expect(host.executeEditorUndo()).toBe(false);
		expect(host.getSuggestionById("s1")).toBe(s);
		expect(host.getSuggestionById("missing")).toBeNull();
	});
});

describe("RecordingReviewStateMachineHost — trace-vocabulary closure", () => {
	it("the fake can emit exactly the host-effect vocabulary used by traces", () => {
		expect(drainEmittableOps()).toEqual(HOST_EFFECT_VOCAB);
	});

	it("every golden trace's host-effect subsequence is fully emittable by the fake", () => {
		const emittable = drainEmittableOps();
		for (const trace of STATE_MACHINE_TRACES) {
			const expected = expectedHostEffects(trace.steps);
			expect(expected.length).toBeGreaterThan(0);
			for (const op of expected) {
				expect(
					emittable.has(op),
					`${trace.method}/${trace.scenario}: fake cannot emit ${op}`,
				).toBe(true);
			}
		}
	});
});

// ── PRODUCTION-DRIVEN REPLAYS — DOCUMENTED PENDING ───────────────────────
//
// These cannot execute yet WITHOUT faking success. The state-machine logic
// lives as private, `this`-bound async methods on EditorialistPlugin
// (src/main.ts ~1282–1567): acceptSuggestion / rejectSuggestion /
// markSuggestionRewritten / deferSuggestion / applySuggestionById /
// undoLastAppliedSuggestion / jumpToSuggestionTarget. They take NO host
// parameter and reach into `this.store`, `this.registry`, `this.app`, the
// editor, and mutable fields directly.
//
// MISSING SEAM: there is no entry point that accepts a ReviewStateMachineHost.
// Replay becomes executable only after the extraction commit introduces
//   class ReviewStateMachine { constructor(host: ReviewStateMachineHost) ... }
// at which point each it.todo below becomes:
//   const host = new RecordingReviewStateMachineHost(config);
//   await new ReviewStateMachine(host).<method>(...);
//   expect(host.ops).toEqual(expectedHostEffects(trace.steps));
// Writing a parallel reimplementation here to make them pass now would test
// the reimplementation, not production — explicitly out of scope.
describe("ReviewStateMachine production-driven replay (pending extraction)", () => {
	for (const trace of STATE_MACHINE_TRACES) {
		it.todo(`replay: ${trace.method} — ${trace.scenario}`);
	}
});
