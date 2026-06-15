import { describe, it, expect } from "vitest";
import { HOST_OPS, type HostOp } from "../../src/core/review/ReviewStateMachineHost";
import {
	STATE_MACHINE_METHODS,
	STATE_MACHINE_TRACES,
	type StateMachineMethod,
	type StateMachineTrace,
} from "./ReviewStateMachineScaffold";

const HOST_OP_SET = new Set<HostOp>(HOST_OPS);

function trace(method: StateMachineMethod, scenarioIncludes: string): StateMachineTrace {
	const found = STATE_MACHINE_TRACES.find(
		(t) => t.method === method && t.scenario.includes(scenarioIncludes),
	);
	if (!found) throw new Error(`no trace for ${method} / ${scenarioIncludes}`);
	return found;
}
function ops(t: StateMachineTrace): HostOp[] {
	return t.steps.map((s) => s.op);
}
function idx(t: StateMachineTrace, op: HostOp): number {
	return ops(t).indexOf(op);
}

describe("ReviewStateMachine scaffold — contract integrity", () => {
	it("every trace step op is a declared host op (no typos / drift)", () => {
		for (const t of STATE_MACHINE_TRACES) {
			for (const step of t.steps) {
				expect(HOST_OP_SET.has(step.op), `${t.method}/${t.scenario}: unknown op ${step.op}`).toBe(true);
			}
		}
	});

	it("every state-machine method has at least one trace", () => {
		for (const method of STATE_MACHINE_METHODS) {
			expect(
				STATE_MACHINE_TRACES.some((t) => t.method === method),
				`missing trace for ${method}`,
			).toBe(true);
		}
	});

	it("traces only reference known methods", () => {
		const known = new Set<StateMachineMethod>(STATE_MACHINE_METHODS);
		for (const t of STATE_MACHINE_TRACES) {
			expect(known.has(t.method)).toBe(true);
		}
	});
});

describe("ReviewStateMachine scaffold — ordering invariants", () => {
	it("reject/defer: persist decision BEFORE status update, and next computed BEFORE status update", () => {
		// rewrite no longer computes a next item (it stays on the current
		// suggestion like accept), so it is excluded from the next-before-status
		// invariant below.
		for (const [method, scenario] of [
			["rejectSuggestion", "happy path, next"],
			["deferSuggestion", "happy path"],
		] as const) {
			const t = trace(method, scenario);
			const persist = idx(t, "registry.persistReviewDecision");
			const next = idx(t, "getAdjacentRevealableSuggestionId");
			const status = idx(t, "store.updateSuggestionStatus");
			expect(persist).toBeGreaterThanOrEqual(0);
			expect(persist).toBeLessThan(status);
			expect(next).toBeLessThan(status);
		}
	});

	it("markSuggestionRewritten: persists BEFORE status update, then stays on the current id", () => {
		const t = trace("markSuggestionRewritten", "mirrors accept");
		expect(idx(t, "registry.persistReviewDecision")).toBeLessThan(idx(t, "store.updateSuggestionStatus"));
		// No advance: it neither computes the next item nor uses the old
		// findPreferredSuggestionId fallback — it re-selects the same suggestion.
		expect(ops(t)).not.toContain("getAdjacentRevealableSuggestionId");
		expect(ops(t)).not.toContain("findPreferredSuggestionId");
		expect(ops(t)).toContain("store.selectSuggestion");
	});

	it("reject single persist point: signals use persist:false, scene-inventory sync follows", () => {
		const t = trace("rejectSuggestion", "happy path, next");
		expect(idx(t, "registry.syncReviewerSignalsForSession")).toBeLessThan(
			idx(t, "registry.syncSceneInventoryForSession"),
		);
	});

	it("applySuggestionById success: lastAppliedChange set BEFORE scene-inventory sync", () => {
		const t = trace("applySuggestionById", "success");
		expect(idx(t, "set.lastAppliedChange")).toBeLessThan(
			idx(t, "registry.syncSceneInventoryForSession"),
		);
		// editor mutation precedes persistence bookkeeping
		expect(idx(t, "editor.replaceRange")).toBeLessThan(idx(t, "registry.clearPersistedReviewDecision"));
	});

	it("no decision path carries the findPreferredSuggestionId fallback any more", () => {
		// rewrite previously used findPreferredSuggestionId; it now mirrors accept
		// (select the current id), so no method should reference the fallback.
		expect(ops(trace("markSuggestionRewritten", "mirrors accept"))).not.toContain("findPreferredSuggestionId");
		expect(ops(trace("rejectSuggestion", "happy path, next"))).not.toContain("findPreferredSuggestionId");
		expect(ops(trace("deferSuggestion", "happy path"))).not.toContain("findPreferredSuggestionId");
	});

	it("deferSuggestion documents treatCurrentAsDeferred = true", () => {
		const t = trace("deferSuggestion", "happy path");
		const step = t.steps.find((s) => s.op === "getAdjacentRevealableSuggestionId");
		expect(step?.note ?? "").toContain("treatCurrentAsDeferred = TRUE");
	});

	it("acceptSuggestion handoff: detection precedes the handoff transition", () => {
		const t = trace("acceptSuggestion", "handoff wins");
		// shouldShowGuidedSweepHandoff decomposes to getGuidedSweep (+ store.getSession arg).
		expect(idx(t, "getGuidedSweep")).toBeLessThan(idx(t, "enterGuidedSweepHandoff"));
	});

	it("undo success: undo command runs before decision clear; sweep restored in order", () => {
		const t = trace("undoLastAppliedSuggestion", "success");
		expect(idx(t, "executeEditorUndo")).toBeLessThan(idx(t, "registry.clearPersistedReviewDecision"));
		expect(idx(t, "set.lastAppliedChange")).toBeGreaterThan(idx(t, "executeEditorUndo"));
		expect(idx(t, "store.setCompletedSweep")).toBeLessThan(idx(t, "store.setGuidedSweep"));
		expect(idx(t, "revealSuggestionContext")).toBeLessThan(idx(t, "notify"));
	});

	it("guarded methods short-circuit before any persistence", () => {
		const rejectGuard = trace("rejectSuggestion", "guard fails");
		expect(ops(rejectGuard)).toEqual(["canRejectSuggestion", "return"]);
		const applyGuard = trace("applySuggestionById", "context/session/suggestion guard fails");
		expect(ops(applyGuard)).not.toContain("editor.replaceRange");
		expect(ops(applyGuard)).not.toContain("registry.clearPersistedReviewDecision");
	});
});
