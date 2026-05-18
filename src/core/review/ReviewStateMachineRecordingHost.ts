// Test-support scaffold (no production wiring).
//
// A recording implementation of ReviewStateMachineHost. Every host call
// appends its canonical HostOp name to an ordered log; a recording fake
// editor (reached via getReviewNoteContext().view.editor) records the
// editor.* sub-ops. Return values are configurable so a future extracted
// ReviewStateMachine can be driven down any STATE_MACHINE_TRACES branch and
// asserted with `expect(host.ops).toEqual(expectedHostEffects(trace))`.
//
// Until extraction this fake is exercised only by its own self-tests and the
// trace-vocabulary closure check — the production-driven replays remain
// it.todo (see ReviewStateMachineRecordingHost.test.ts) because the live
// logic in main.ts takes no host parameter.

import type { ReviewSuggestion } from "../../models/ReviewSuggestion";
import type {
	AppliedReviewChangeLike,
	CompletedSweepState,
	GuidedSweepState,
	HostOp,
	ReviewNoteContextLike,
	ReviewSession,
	ReviewStateMachineHost,
} from "./ReviewStateMachineScaffold";

// Ops a host (incl. its fake editor / mutable-field setters) can emit. Pure
// ops in HOST_OPS (createSuggestionApplyPlan, getNoteTextFingerprint,
// getAdjacentRevealableSuggestionId, findPreferredSuggestionId,
// getSuggestionPrimaryTarget) and the "return" marker are NOT host effects —
// post-extraction the machine calls the real pure modules for those, so the
// parity assertion compares the host-effect subsequence only.
export const PURE_OR_MARKER_OPS = new Set<HostOp>([
	"createSuggestionApplyPlan",
	"getNoteTextFingerprint",
	"getAdjacentRevealableSuggestionId",
	"findPreferredSuggestionId",
	"getSuggestionPrimaryTarget",
	"return",
]);

export interface RecordingEditor {
	replaceRange(text: string, from: unknown, to: unknown): void;
	setSelection(from: unknown, to: unknown): void;
	scrollIntoView(range: unknown, center?: boolean): void;
	focus(): void;
	getValue(): string;
	offsetToPos(offset: number): { offset: number };
}

export interface RecordingHostConfig {
	session?: ReviewSession | null;
	completedSweep?: CompletedSweepState | null;
	guidedSweep?: GuidedSweepState | null;
	selectedSuggestionId?: string | null;
	noteContext?: ReviewNoteContextLike | null;
	activeEditorView?: unknown | null;
	suggestionsById?: Record<string, ReviewSuggestion>;
	guards?: Partial<
		Record<
			| "canAcceptSuggestion"
			| "canRejectSuggestion"
			| "canMarkSuggestionRewritten"
			| "hasActiveReviewSession"
			| "hasReviewSessionContext",
			boolean
		>
	>;
	panelOnly?: unknown | null;
	editorUndoResult?: boolean;
	trackingContext?: { sessionId?: string; sessionStartedAt?: number };
	editorValue?: string;
}

export class RecordingReviewStateMachineHost implements ReviewStateMachineHost {
	readonly ops: HostOp[] = [];
	private _lastAppliedChange: AppliedReviewChangeLike | null = null;

	constructor(private readonly config: RecordingHostConfig = {}) {}

	private rec(op: HostOp): void {
		this.ops.push(op);
	}

	reset(): void {
		this.ops.length = 0;
	}

	private readonly editor: RecordingEditor = {
		replaceRange: () => this.rec("editor.replaceRange"),
		setSelection: () => this.rec("editor.setSelection"),
		scrollIntoView: () => this.rec("editor.scrollIntoView"),
		focus: () => this.rec("editor.focus"),
		getValue: () => {
			this.rec("editor.getValue");
			return this.config.editorValue ?? "";
		},
		offsetToPos: (offset: number) => ({ offset }),
	};

	// — store —
	store = {
		getSession: (): ReviewSession | null => {
			this.rec("store.getSession");
			return this.config.session ?? null;
		},
		getCompletedSweep: (): CompletedSweepState | null => {
			this.rec("store.getCompletedSweep");
			return this.config.completedSweep ?? null;
		},
		selectSuggestion: (): void => this.rec("store.selectSuggestion"),
		updateSuggestionStatus: (): void => this.rec("store.updateSuggestionStatus"),
		setCompletedSweep: (): void => this.rec("store.setCompletedSweep"),
		setGuidedSweep: (_value: GuidedSweepState | null): void => this.rec("store.setGuidedSweep"),
	};

	// — registry (recorded only; never mutates anything) —
	registry = {
		persistReviewDecision: async (): Promise<void> => {
			this.rec("registry.persistReviewDecision");
		},
		clearPersistedReviewDecision: async (): Promise<void> => {
			this.rec("registry.clearPersistedReviewDecision");
		},
		syncReviewerSignalsForSession: async (): Promise<void> => {
			this.rec("registry.syncReviewerSignalsForSession");
		},
		syncSceneInventoryForSession: async (): Promise<void> => {
			this.rec("registry.syncSceneInventoryForSession");
		},
	};

	getReviewNoteContext(): ReviewNoteContextLike | null {
		this.rec("getReviewNoteContext");
		if (this.config.noteContext === null) {
			return null;
		}
		return (
			this.config.noteContext ?? {
				filePath: this.config.session?.notePath ?? "note.md",
				text: this.config.editorValue ?? "",
				view: { editor: this.editor },
			}
		);
	}

	getActiveEditorView(): unknown | null {
		this.rec("getActiveEditorView");
		return this.config.activeEditorView ?? {};
	}

	async focusReviewLeaf(): Promise<void> {
		this.rec("focusReviewLeaf");
	}

	executeEditorUndo(): boolean {
		this.rec("executeEditorUndo");
		return this.config.editorUndoResult ?? true;
	}

	notify(): void {
		this.rec("notify");
	}

	private guard(
		name:
			| "canAcceptSuggestion"
			| "canRejectSuggestion"
			| "canMarkSuggestionRewritten"
			| "hasActiveReviewSession"
			| "hasReviewSessionContext",
		op: HostOp,
	): boolean {
		this.rec(op);
		return this.config.guards?.[name] ?? false;
	}

	canAcceptSuggestion(): boolean {
		return this.guard("canAcceptSuggestion", "canAcceptSuggestion");
	}
	canRejectSuggestion(): boolean {
		return this.guard("canRejectSuggestion", "canRejectSuggestion");
	}
	canMarkSuggestionRewritten(): boolean {
		return this.guard("canMarkSuggestionRewritten", "canMarkSuggestionRewritten");
	}
	hasActiveReviewSession(): boolean {
		return this.guard("hasActiveReviewSession", "hasActiveReviewSession");
	}
	hasReviewSessionContext(): boolean {
		return this.guard("hasReviewSessionContext", "hasReviewSessionContext");
	}

	getSelectedSuggestionId(): string | null {
		this.rec("getSelectedSuggestionId");
		return this.config.selectedSuggestionId ?? null;
	}
	getGuidedSweep(): GuidedSweepState | null {
		this.rec("getGuidedSweep");
		return this.config.guidedSweep ?? null;
	}

	getReviewSession(): ReviewSession | null {
		this.rec("getReviewSession");
		return this.config.session ?? null;
	}
	getSuggestionById(id: string): ReviewSuggestion | null {
		this.rec("getSuggestionById");
		return this.config.suggestionsById?.[id] ?? null;
	}
	getCurrentSessionTrackingContext(): { sessionId?: string; sessionStartedAt?: number } {
		this.rec("getCurrentSessionTrackingContext");
		return this.config.trackingContext ?? {};
	}
	getPanelOnlyReviewStateForSession(): unknown | null {
		this.rec("getPanelOnlyReviewStateForSession");
		return this.config.panelOnly ?? null;
	}

	async revealSelectedSuggestion(): Promise<void> {
		this.rec("revealSelectedSuggestion");
	}
	async revealSuggestionContext(): Promise<void> {
		this.rec("revealSuggestionContext");
	}
	async enterGuidedSweepHandoff(): Promise<void> {
		this.rec("enterGuidedSweepHandoff");
	}
	refreshSessionAfterAcceptedEdit(): void {
		this.rec("refreshSessionAfterAcceptedEdit");
	}
	syncActiveEditorDecorations(): void {
		this.rec("syncActiveEditorDecorations");
	}
	resyncSessionForActiveNote(): void {
		this.rec("resyncSessionForActiveNote");
	}
	async focusResolvedTarget(): Promise<void> {
		this.rec("focusResolvedTarget");
	}

	get lastAppliedChange(): AppliedReviewChangeLike | null {
		return this._lastAppliedChange;
	}
	set lastAppliedChange(value: AppliedReviewChangeLike | null) {
		this._lastAppliedChange = value;
		this.rec("set.lastAppliedChange");
	}
	setActiveHighlight(): void {
		this.rec("setActiveHighlight");
	}
}

// The host-observable subsequence of a golden trace: drop pure ops and the
// "return" marker. This is exactly what `host.ops` must equal post-extraction.
export function expectedHostEffects(steps: ReadonlyArray<{ op: HostOp }>): HostOp[] {
	return steps.map((s) => s.op).filter((op) => !PURE_OR_MARKER_OPS.has(op));
}
