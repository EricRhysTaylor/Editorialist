import { describe, it, expect } from "vitest";
import { HOST_OPS, STATE_MACHINE_TRACES, type HostOp } from "./ReviewStateMachineScaffold";
import {
	PURE_OR_MARKER_OPS,
	RecordingReviewStateMachineHost,
	expectedHostEffects,
} from "./ReviewStateMachineRecordingHost";
import { ReviewStateMachine } from "./ReviewStateMachine";
import type { ReviewSuggestion } from "../../models/ReviewSuggestion";

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
	host.getSelectedSuggestionId();
	host.getGuidedSweep();
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

// ── PRODUCTION-DRIVEN REPLAYS (active) ───────────────────────────────────
// Each scenario configures the recording host, drives the EXTRACTED
// ReviewStateMachine, and asserts the recorded host-effect order equals the
// frozen golden trace.

function trace(method: string, scenarioIncludes: string) {
	const t = STATE_MACHINE_TRACES.find(
		(x) => x.method === method && x.scenario.includes(scenarioIncludes),
	);
	if (!t) throw new Error(`no trace ${method}/${scenarioIncludes}`);
	return t;
}

const contributor = {
	id: "c1",
	displayName: "R",
	kind: "ai" as const,
	reviewerType: "ai-editor" as const,
	resolutionStatus: "exact" as const,
	suggestedReviewerIds: [],
	raw: {},
};
const src = { blockIndex: 0, entryIndex: 0 };

function editOpen(id: string): ReviewSuggestion {
	return {
		id,
		operation: "edit",
		status: "pending",
		contributor,
		source: src,
		location: { primary: { text: "hello", startOffset: 0, endOffset: 5, matchType: "exact" } },
		executionMode: "direct",
		payload: { original: "hello", revised: "HELLO" },
	} as ReviewSuggestion;
}
function closed(id: string): ReviewSuggestion {
	const s = editOpen(id);
	s.status = "accepted";
	return s;
}
function editNoPlan(id: string): ReviewSuggestion {
	return {
		id,
		operation: "edit",
		status: "pending",
		contributor,
		source: src,
		location: {},
		executionMode: "direct",
		payload: { original: "x", revised: "y" },
	} as ReviewSuggestion;
}
function moveValid(id: string): ReviewSuggestion {
	return {
		id,
		operation: "move",
		status: "pending",
		contributor,
		source: src,
		location: {
			relocation: {
				canApply: true,
				targetResolved: true,
				anchorResolved: true,
				targetStart: 0,
				targetEnd: 2,
				anchorStart: 10,
				anchorEnd: 12,
			},
		},
		executionMode: "direct",
		payload: { target: "T.", anchor: "A.", placement: "after" },
	} as ReviewSuggestion;
}

function run(
	config: ConstructorParameters<typeof RecordingReviewStateMachineHost>[0],
): { host: RecordingReviewStateMachineHost; sm: ReviewStateMachine } {
	const host = new RecordingReviewStateMachineHost(config);
	return { host, sm: new ReviewStateMachine(host) };
}

describe("ReviewStateMachine production-driven replay", () => {
	it("rejectSuggestion — guard fails", async () => {
		const { host, sm } = run({ guards: { canRejectSuggestion: false } });
		await sm.rejectSuggestion("x");
		expect(host.ops).toEqual(expectedHostEffects(trace("rejectSuggestion", "guard fails").steps));
	});

	it("rejectSuggestion — happy path, next exists", async () => {
		const { host, sm } = run({
			guards: { canRejectSuggestion: true },
			session: { notePath: "n.md", suggestions: [editOpen("s1")] },
			suggestionsById: { s0: editOpen("s0") },
			selectedSuggestionId: null,
		});
		await sm.rejectSuggestion("s0");
		expect(host.ops).toEqual(expectedHostEffects(trace("rejectSuggestion", "happy path, next").steps));
	});

	it("rejectSuggestion — no next -> handoff", async () => {
		const { host, sm } = run({
			guards: { canRejectSuggestion: true },
			session: { notePath: "n.md", suggestions: [closed("c1")] },
			suggestionsById: { s0: editOpen("s0") },
			guidedSweep: { batchId: "b", currentNoteIndex: 0, notePaths: ["n.md"], startedAt: 1 },
		});
		await sm.rejectSuggestion("s0");
		expect(host.ops).toEqual(expectedHostEffects(trace("rejectSuggestion", "no next").steps));
	});

	it("deferSuggestion — happy path, next exists", async () => {
		const { host, sm } = run({
			guards: { hasActiveReviewSession: true },
			session: { notePath: "n.md", suggestions: [editOpen("s1")] },
			suggestionsById: { s0: editOpen("s0") },
		});
		await sm.deferSuggestion("s0");
		expect(host.ops).toEqual(expectedHostEffects(trace("deferSuggestion", "happy path").steps));
	});

	it("markSuggestionRewritten — preferred fallback", async () => {
		const { host, sm } = run({
			guards: { canMarkSuggestionRewritten: true },
			session: { notePath: "n.md", suggestions: [closed("c1")] },
			suggestionsById: { s0: editOpen("s0") },
		});
		await sm.markSuggestionRewritten("s0");
		expect(host.ops).toEqual(
			expectedHostEffects(trace("markSuggestionRewritten", "preferred fallback").steps),
		);
	});

	it("applySuggestionById — context/session/suggestion guard fails", async () => {
		const { host, sm } = run({ noteContext: null, suggestionsById: { x: editOpen("x") } });
		const result = await sm.applySuggestionById("x");
		expect(result).toBeNull();
		expect(host.ops).toEqual(
			expectedHostEffects(trace("applySuggestionById", "context/session/suggestion guard fails").steps),
		);
	});

	it("applySuggestionById — canAccept guard fails", async () => {
		const { host, sm } = run({
			session: { notePath: "n.md", suggestions: [] },
			suggestionsById: { x: editOpen("x") },
			guards: { canAcceptSuggestion: false },
		});
		await sm.applySuggestionById("x");
		expect(host.ops).toEqual(
			expectedHostEffects(trace("applySuggestionById", "canAccept guard fails").steps),
		);
	});

	it("applySuggestionById — no apply plan", async () => {
		const { host, sm } = run({
			session: { notePath: "n.md", suggestions: [] },
			suggestionsById: { x: editNoPlan("x") },
			guards: { canAcceptSuggestion: true },
			editorValue: "",
		});
		await sm.applySuggestionById("x");
		expect(host.ops).toEqual(expectedHostEffects(trace("applySuggestionById", "no apply plan").steps));
	});

	it("applySuggestionById — success (muted)", async () => {
		const { host, sm } = run({
			session: { notePath: "n.md", suggestions: [] },
			suggestionsById: { s: editOpen("s") },
			guards: { canAcceptSuggestion: true },
			editorValue: "hello world",
		});
		const result = await sm.applySuggestionById("s", { highlightMode: "muted" });
		expect(result).toEqual({ start: 0, end: 5, suggestionId: "s" });
		expect(host.ops).toEqual(expectedHostEffects(trace("applySuggestionById", "success").steps));
	});

	it("acceptSuggestion — apply fails -> false", async () => {
		const { host, sm } = run({ noteContext: null, suggestionsById: { x: editOpen("x") } });
		const ok = await sm.acceptSuggestion("x");
		expect(ok).toBe(false);
		expect(host.ops).toEqual(expectedHostEffects(trace("acceptSuggestion", "apply fails").steps));
	});

	it("acceptSuggestion — handoff wins", async () => {
		const { host, sm } = run({
			session: { notePath: "n.md", suggestions: [closed("c1")] },
			suggestionsById: { s: editOpen("s") },
			guards: { canAcceptSuggestion: true },
			editorValue: "hello world",
			guidedSweep: { batchId: "b", currentNoteIndex: 0, notePaths: ["n.md"], startedAt: 1 },
		});
		const ok = await sm.acceptSuggestion("s");
		expect(ok).toBe(true);
		expect(host.ops).toEqual(expectedHostEffects(trace("acceptSuggestion", "handoff wins").steps));
	});

	it("acceptSuggestion — move re-selects same id", async () => {
		const { host, sm } = run({
			session: { notePath: "n.md", suggestions: [closed("c1")] },
			suggestionsById: { m: moveValid("m") },
			guards: { canAcceptSuggestion: true },
			editorValue: "T.\n\nMID.\n\nA.",
		});
		const ok = await sm.acceptSuggestion("m");
		expect(ok).toBe(true);
		expect(host.ops).toEqual(expectedHostEffects(trace("acceptSuggestion", "move").steps));
	});

	it("undoLastAppliedSuggestion — no change", async () => {
		const { host, sm } = run({});
		await sm.undoLastAppliedSuggestion();
		expect(host.ops).toEqual(
			expectedHostEffects(trace("undoLastAppliedSuggestion", "no change").steps),
		);
	});

	it("undoLastAppliedSuggestion — success with completed-sweep restore", async () => {
		const { host, sm } = run({
			session: { notePath: "n.md", suggestions: [] },
			lastAppliedChange: {
				start: 0,
				end: 1,
				notePath: "n.md",
				suggestionId: "s",
				textFingerprint: "fp",
			},
			completedSweep: { batchId: "b", currentNoteIndex: 0, notePaths: ["n.md"], startedAt: 1 },
			suggestionsById: { s: editOpen("s") },
			editorUndoResult: true,
		});
		await sm.undoLastAppliedSuggestion();
		expect(host.ops).toEqual(
			expectedHostEffects(trace("undoLastAppliedSuggestion", "success").steps),
		);
	});

	it("jumpToSuggestionTarget — happy path", async () => {
		const { host, sm } = run({
			guards: { hasReviewSessionContext: true },
			suggestionsById: { s: editOpen("s") },
		});
		await sm.jumpToSuggestionTarget("s");
		expect(host.ops).toEqual(expectedHostEffects(trace("jumpToSuggestionTarget", "happy path").steps));
	});
});
