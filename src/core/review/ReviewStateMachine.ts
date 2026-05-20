// Extracted review state machine. Faithful 1:1 port of the accept / reject /
// rewrite / defer / apply / undo / jump flows previously inlined in
// EditorialistPlugin (main.ts). Behavior — including effect ORDER and the
// intentionally-repeated store.getSession() argument reads — is preserved
// exactly per STATE_MACHINE_TRACES. main.ts keeps thin delegating wrappers.

import {
	createSuggestionApplyPlan,
	getSuggestionPrimaryTarget,
} from "../OperationSupport";
import {
	findPreferredSuggestionId as findPreferredSuggestionIdShared,
	getAdjacentRevealableSuggestionId as getAdjacentRevealableSuggestionIdShared,
	hasLiveActionableSuggestions as hasLiveActionableSuggestionsShared,
} from "./SuggestionTraversal";
import { ReviewMutationScope } from "./ReviewMutationScope";
import type { ReviewSuggestion } from "../../models/ReviewSuggestion";
import type {
	ReviewSession,
	ReviewStateMachineHost,
} from "./ReviewStateMachineHost";

export interface AppliedReviewChangeResult {
	start: number;
	end: number;
	suggestionId: string;
}

export interface ApplySuggestionOptions {
	highlightMode?: "muted" | "none";
	preserveSelection?: boolean;
	syncSceneInventory?: boolean;
}

interface EditorLike {
	offsetToPos(offset: number): unknown;
	replaceRange(replacement: string, from: unknown, to: unknown): void;
	setSelection(anchor: unknown, head: unknown): void;
	scrollIntoView(range: unknown, center?: boolean): void;
	focus(): void;
	getValue(): string;
}

function noteTextFingerprint(text: string): string {
	let hash = 5381;
	for (let index = 0; index < text.length; index += 1) {
		hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
	}

	return `${text.length}:${hash >>> 0}`;
}

export class ReviewStateMachine {
	constructor(private readonly host: ReviewStateMachineHost) {}

	// Mirrors main.ts getAdjacentRevealableSuggestionId wrapper (3011):
	// getReviewSession, then store.getState().selectedSuggestionId, then the
	// pure ranking. The two host reads must not be collapsed.
	private computeAdjacent(
		direction: "next" | "previous",
		fromId?: string,
		treatCurrentAsDeferred = false,
	): string | null {
		const session = this.host.getReviewSession();
		if (!session || session.suggestions.length === 0) {
			return null;
		}

		return getAdjacentRevealableSuggestionIdShared(
			session.suggestions,
			this.host.getSelectedSuggestionId(),
			direction,
			{ fromId, treatCurrentAsDeferred },
		);
	}

	// Mirrors main.ts shouldShowGuidedSweepHandoff (3050). getGuidedSweep is
	// the left operand of && and is always evaluated.
	private handoffApplies(sessionArg: ReviewSession | null): boolean {
		const targetSession = sessionArg ?? this.host.getReviewSession();
		return Boolean(
			this.host.getGuidedSweep() &&
				targetSession &&
				!hasLiveActionableSuggestionsShared(targetSession.suggestions),
		);
	}

	async acceptSuggestion(id: string): Promise<boolean> {
		const acceptedSuggestion = this.host.getSuggestionById(id);
		const appliedChange = await this.applySuggestionById(id, {
			highlightMode: "muted",
		});
		if (!appliedChange) {
			return false;
		}

		const refreshedSession = this.host.store.getSession();
		if (this.handoffApplies(refreshedSession)) {
			await this.host.enterGuidedSweepHandoff();
			return true;
		}

		const nextSuggestionId = this.computeAdjacent("next", id);
		if (this.host.getPanelOnlyReviewStateForSession(refreshedSession) && nextSuggestionId) {
			this.host.store.selectSuggestion(nextSuggestionId);
			await this.host.revealSelectedSuggestion();
			return true;
		}

		if (acceptedSuggestion?.operation === "cut" && nextSuggestionId) {
			this.host.store.selectSuggestion(nextSuggestionId);
			await this.host.revealSelectedSuggestion();
			return true;
		}

		if (acceptedSuggestion?.operation === "move") {
			this.host.store.selectSuggestion(id);
			await this.host.revealSelectedSuggestion();
			return true;
		}

		const hasHighlightableRange = appliedChange.end > appliedChange.start;
		if (!hasHighlightableRange && nextSuggestionId) {
			this.host.store.selectSuggestion(nextSuggestionId);
			await this.host.revealSelectedSuggestion();
			return true;
		}

		this.host.store.selectSuggestion(id);
		return true;
	}

	async rejectSuggestion(id: string): Promise<void> {
		if (!this.host.canRejectSuggestion(id)) {
			return;
		}

		const session = this.host.getReviewSession();
		const suggestion = this.host.getSuggestionById(id);
		const previousStatus = suggestion?.status ?? null;
		const tracking = this.host.getCurrentSessionTrackingContext();
		const { sessionId, sessionStartedAt } = tracking;
		const scope = new ReviewMutationScope();
		try {
			if (session && suggestion) {
				await this.host.registry.persistReviewDecision(session.notePath, suggestion, "rejected", {
					persist: false,
					sessionId,
					sessionStartedAt,
				});
				scope.onRollback(() =>
					this.host.registry.clearPersistedReviewDecision(session.notePath, suggestion, {
						persist: false,
					}),
				);
			}

			const nextSuggestionId = this.computeAdjacent("next", id);
			this.host.store.updateSuggestionStatus(id, "rejected");
			if (previousStatus) {
				scope.onRollback(() => this.host.store.updateSuggestionStatus(id, previousStatus));
			}
			await this.host.registry.syncReviewerSignalsForSession(this.host.store.getSession(), {
				persist: false,
				sessionId,
				sessionStartedAt,
			});
			await this.host.registry.syncSceneInventoryForSession(this.host.store.getSession());
			if (nextSuggestionId) {
				this.host.store.selectSuggestion(nextSuggestionId);
				await this.host.revealSelectedSuggestion();
				return;
			}

			if (this.handoffApplies(this.host.store.getSession())) {
				await this.host.enterGuidedSweepHandoff();
			}
		} catch {
			await this.repairFailedDecision(scope, tracking);
		}
	}

	async markSuggestionRewritten(id: string): Promise<void> {
		if (!this.host.canMarkSuggestionRewritten(id)) {
			return;
		}

		const session = this.host.getReviewSession();
		const suggestion = this.host.getSuggestionById(id);
		const previousStatus = suggestion?.status ?? null;
		const tracking = this.host.getCurrentSessionTrackingContext();
		const { sessionId, sessionStartedAt } = tracking;
		const scope = new ReviewMutationScope();
		try {
			if (session && suggestion) {
				await this.host.registry.persistReviewDecision(session.notePath, suggestion, "rewritten", {
					persist: false,
					sessionId,
					sessionStartedAt,
				});
				scope.onRollback(() =>
					this.host.registry.clearPersistedReviewDecision(session.notePath, suggestion, {
						persist: false,
					}),
				);
			}

			const nextSuggestionId = this.computeAdjacent("next", id);
			this.host.store.updateSuggestionStatus(id, "rewritten");
			if (previousStatus) {
				scope.onRollback(() => this.host.store.updateSuggestionStatus(id, previousStatus));
			}
			await this.host.registry.syncReviewerSignalsForSession(this.host.store.getSession(), {
				persist: false,
				sessionId,
				sessionStartedAt,
			});
			await this.host.registry.syncSceneInventoryForSession(this.host.store.getSession());
			if (nextSuggestionId) {
				this.host.store.selectSuggestion(nextSuggestionId);
				await this.host.revealSelectedSuggestion();
				return;
			}

			if (this.handoffApplies(this.host.store.getSession())) {
				await this.host.enterGuidedSweepHandoff();
				return;
			}

			this.host.store.selectSuggestion(
				findPreferredSuggestionIdShared(this.host.store.getSession()?.suggestions ?? []),
			);
			await this.host.revealSelectedSuggestion();
		} catch {
			await this.repairFailedDecision(scope, tracking);
		}
	}

	async deferSuggestion(id: string): Promise<void> {
		if (!this.host.hasActiveReviewSession()) {
			return;
		}

		const session = this.host.getReviewSession();
		const suggestion = this.host.getSuggestionById(id);
		const previousStatus = suggestion?.status ?? null;
		const tracking = this.host.getCurrentSessionTrackingContext();
		const { sessionId, sessionStartedAt } = tracking;
		const scope = new ReviewMutationScope();
		try {
			if (session && suggestion) {
				await this.host.registry.persistReviewDecision(session.notePath, suggestion, "deferred", {
					persist: false,
					sessionId,
					sessionStartedAt,
				});
				scope.onRollback(() =>
					this.host.registry.clearPersistedReviewDecision(session.notePath, suggestion, {
						persist: false,
					}),
				);
			}

			const nextSuggestionId = this.computeAdjacent("next", id, true);
			this.host.store.updateSuggestionStatus(id, "deferred");
			if (previousStatus) {
				scope.onRollback(() => this.host.store.updateSuggestionStatus(id, previousStatus));
			}
			await this.host.registry.syncReviewerSignalsForSession(this.host.store.getSession(), {
				persist: false,
				sessionId,
				sessionStartedAt,
			});
			await this.host.registry.syncSceneInventoryForSession(this.host.store.getSession());
			if (nextSuggestionId) {
				this.host.store.selectSuggestion(nextSuggestionId);
				await this.host.revealSelectedSuggestion();
				return;
			}

			if (this.handoffApplies(this.host.store.getSession())) {
				await this.host.enterGuidedSweepHandoff();
			}
		} catch {
			await this.repairFailedDecision(scope, tracking);
		}
	}

	async applySuggestionById(
		id: string,
		options?: ApplySuggestionOptions,
	): Promise<AppliedReviewChangeResult | null> {
		const context = this.host.getReviewNoteContext();
		const session = this.host.store.getSession();
		const suggestion = this.host.getSuggestionById(id);

		if (!context || !session || session.notePath !== context.filePath || !suggestion) {
			this.host.notify("The active note does not match the current review session.");
			return null;
		}

		if (!this.host.canAcceptSuggestion(id)) {
			this.host.notify("This suggestion cannot be safely accepted yet.");
			return null;
		}

		const applyPlan = createSuggestionApplyPlan(context.text, suggestion);
		if (!applyPlan) {
			this.host.notify(`The ${suggestion.operation} suggestion could not be applied safely.`);
			return null;
		}

		const editor = (context.view as { editor: EditorLike }).editor;
		const from = editor.offsetToPos(applyPlan.from);
		const to = editor.offsetToPos(applyPlan.to);
		editor.replaceRange(applyPlan.text, from, to);
		const appliedStartOffset = applyPlan.focusStart ?? applyPlan.from;
		const appliedEndOffset = applyPlan.focusEnd ?? applyPlan.from + applyPlan.text.length;
		const appliedFrom = editor.offsetToPos(appliedStartOffset);
		const appliedTo = editor.offsetToPos(appliedEndOffset);
		editor.setSelection(appliedFrom, appliedTo);
		editor.scrollIntoView({ from: appliedFrom, to: appliedTo }, true);
		editor.focus();

		// The document edit above is committed and intentionally NOT rolled
		// back on a post-edit failure: reverting applied editor text would
		// require an editor-undo and change user-visible UX. Instead a
		// post-edit failure is repaired so the change stays tracked
		// (undoable) and the registry projections cannot silently diverge
		// from the applied document state.
		try {
			await this.host.registry.clearPersistedReviewDecision(context.filePath, suggestion, {
				persist: false,
			});
			await this.host.refreshSessionAfterAcceptedEdit(session, suggestion.id);
			const { sessionId, sessionStartedAt } = this.host.getCurrentSessionTrackingContext();
			await this.host.registry.syncReviewerSignalsForSession(this.host.store.getSession(), {
				persist: false,
				sessionId,
				sessionStartedAt,
			});
			this.host.lastAppliedChange = {
				start: appliedStartOffset,
				end: appliedEndOffset,
				notePath: context.filePath,
				suggestionId: suggestion.id,
				textFingerprint: noteTextFingerprint(editor.getValue()),
			};
			if (options?.syncSceneInventory !== false) {
				await this.host.registry.syncSceneInventoryForSession(this.host.store.getSession());
			}
			if (!options?.preserveSelection) {
				this.host.store.selectSuggestion(id);
			}
			if (options?.highlightMode === "muted") {
				this.host.setActiveHighlight({ start: appliedStartOffset, end: appliedEndOffset }, "muted");
				this.host.syncActiveEditorDecorations();
			}
		} catch {
			await this.repairFailedAcceptedEdit(context.filePath, suggestion, {
				start: appliedStartOffset,
				end: appliedEndOffset,
			});
		}

		return {
			start: appliedStartOffset,
			end: appliedEndOffset,
			suggestionId: suggestion.id,
		};
	}

	async undoLastAppliedSuggestion(): Promise<void> {
		const change = this.host.lastAppliedChange;
		const context = this.host.getReviewNoteContext();
		const appliedSuggestion = change ? this.host.getSuggestionById(change.suggestionId) : null;
		const completedSweep = this.host.store.getCompletedSweep();
		if (!change || !context || context.filePath !== change.notePath) {
			this.host.notify("No applied change is ready to undo.");
			return;
		}

		await this.host.focusReviewLeaf(context.view);
		if (!this.host.getActiveEditorView()) {
			this.host.notify("The editor is not available for undo.");
			return;
		}

		if (!this.host.executeEditorUndo()) {
			this.host.notify("Nothing to undo.");
			return;
		}

		if (appliedSuggestion) {
			await this.host.registry.clearPersistedReviewDecision(change.notePath, appliedSuggestion, {
				persist: false,
			});
		}
		this.host.lastAppliedChange = null;
		if (completedSweep) {
			this.host.store.setCompletedSweep(null);
			this.host.store.setGuidedSweep({
				batchId: completedSweep.batchId,
				currentNoteIndex: completedSweep.currentNoteIndex,
				notePaths: [...completedSweep.notePaths],
				startedAt: completedSweep.startedAt,
			});
		}
		this.host.resyncSessionForActiveNote();
		this.host.store.selectSuggestion(change.suggestionId);
		await this.host.revealSuggestionContext(change.suggestionId);
		this.host.notify("Applied change undone.");
	}

	async jumpToSuggestionTarget(id: string): Promise<void> {
		if (!this.host.hasReviewSessionContext()) {
			return;
		}

		const suggestion = this.host.getSuggestionById(id);
		if (!suggestion) {
			return;
		}

		this.host.store.selectSuggestion(id);
		await this.host.focusResolvedTarget(getSuggestionPrimaryTarget(suggestion));
	}

	// Failure path for reject / rewrite / defer. Replays the registered
	// inverses (clear persisted decision, restore prior store status) so the
	// two authoritative sources of truth cannot diverge, then recomputes the
	// derived projections (reviewer signals + scene inventory) from the
	// reverted state. If that reconciliation itself fails the authoritative
	// pair is still consistent; the user is notified rather than left with a
	// silent split.
	private async repairFailedDecision(
		scope: ReviewMutationScope,
		tracking: { sessionId?: string; sessionStartedAt?: number },
	): Promise<void> {
		await scope.rollback();
		try {
			await this.host.registry.syncReviewerSignalsForSession(this.host.store.getSession(), {
				persist: false,
				sessionId: tracking.sessionId,
				sessionStartedAt: tracking.sessionStartedAt,
			});
			await this.host.registry.syncSceneInventoryForSession(this.host.store.getSession());
		} catch {
			// Projection reconciliation failed; authoritative state is
			// already consistent and the next successful decision rebuilds
			// signals / inventory. Surfaced loudly below.
		}
		this.host.notify("The review decision could not be completed; your changes were rolled back.");
	}

	// Failure path for applySuggestionById AFTER the editor edit committed.
	// The edit is not reverted (see callsite). This guarantees the change
	// stays undoable (lastAppliedChange set) and best-effort reconciles the
	// registry so an accepted edit never carries a stale pending decision or
	// diverged projections.
	private async repairFailedAcceptedEdit(
		notePath: string,
		suggestion: ReviewSuggestion,
		appliedRange: { start: number; end: number },
	): Promise<void> {
		const change = this.host.lastAppliedChange;
		if (!change || change.suggestionId !== suggestion.id || change.notePath !== notePath) {
			const context = this.host.getReviewNoteContext();
			const editorValue = context
				? (context.view as { editor: EditorLike }).editor.getValue()
				: "";
			this.host.lastAppliedChange = {
				start: appliedRange.start,
				end: appliedRange.end,
				notePath,
				suggestionId: suggestion.id,
				textFingerprint: noteTextFingerprint(editorValue),
			};
		}
		try {
			await this.host.registry.clearPersistedReviewDecision(notePath, suggestion, {
				persist: false,
			});
			await this.host.registry.syncReviewerSignalsForSession(this.host.store.getSession(), {
				persist: false,
			});
			await this.host.registry.syncSceneInventoryForSession(this.host.store.getSession());
		} catch {
			// Best-effort reconcile failed; the edit is applied and tracked.
			// Surfaced loudly below.
		}
		this.host.notify(
			"The accepted edit was applied but follow-up sync failed; it remains undoable.",
		);
	}
}
