// Owns the parse / resync / refresh axis of the review session. Extracted
// verbatim from EditorialistPlugin (main.ts) — Notices, store mutation
// ordering, decoration sync ordering, workflow + registry sync calls, and
// async fire-and-forget semantics are byte-identical. main.ts is now only
// the composition root; it constructs this orchestrator and delegates the
// public entry points to it.
//
// The orchestrator knows nothing about Obsidian beyond `Notice` for user
// messages and the typed `MarkdownView` carried inside ActiveNoteContext.
// Everything else is reached through the SessionOrchestratorHost interface
// the orchestrator is constructed with.

import { Notice, type MarkdownView } from "obsidian";
import { getReviewBlockFenceLabel } from "../core/ReviewBlockFormat";
import {
	computeNoteTextFingerprint,
	markSuggestionAcceptedForRefresh,
	selectCompletedSweepAuditTarget,
} from "../core/review/SessionAxis";
import { findPreferredSuggestionId as findPreferredSuggestionIdShared } from "../core/review/SuggestionTraversal";
import type { ReviewEngine } from "../core/ReviewEngine";
import type { SceneReviewRecord } from "../models/ContributorProfile";
import type { ReviewSession, ReviewSuggestion } from "../models/ReviewSuggestion";
import type { ReviewRegistryService } from "../services/ReviewRegistryService";
import type { ReviewWorkflowService } from "../services/ReviewWorkflowService";
import type { CompletedSweepState, ReviewStore } from "../state/ReviewStore";

export interface ActiveNoteContext {
	filePath: string;
	text: string;
	view: MarkdownView;
}

export interface LastAppliedChange {
	end: number;
	notePath: string;
	start: number;
	suggestionId: string;
	textFingerprint: string;
}

export interface BulkApplyConfirmState {
	notePath: string;
}

export interface SessionOrchestratorHost {
	readonly store: ReviewStore;
	readonly reviewEngine: ReviewEngine;
	readonly registry: ReviewRegistryService;
	readonly workflow: ReviewWorkflowService;

	// Context discovery — Obsidian-bound; stays on plugin.
	getActiveNoteContext(): ActiveNoteContext | null;
	getReviewNoteContext(): ActiveNoteContext | null;
	// Gated getter: returns the session ONLY when the active note matches it.
	// The orchestrator uses this where the plugin previously consulted its own
	// private getReviewSession().
	getReviewSession(): ReviewSession | null;

	// Plugin-owned transient state the orchestrator must read/clear.
	getLastAppliedChange(): LastAppliedChange | null;
	setLastAppliedChange(value: LastAppliedChange | null): void;
	getBulkApplyConfirmState(): BulkApplyConfirmState | null;
	setBulkApplyConfirmState(value: BulkApplyConfirmState | null): void;
	clearActiveHighlights(): void;
	setDefaultHighlightForSelection(): void;

	// Completed-sweep helpers (stay on plugin, used by audit-session path).
	getResolvedCompletedSweepState(): CompletedSweepState | null;
	isCompletedReviewSuggestion(suggestion: ReviewSuggestion): boolean;
	getSceneReviewRecordByPath(notePath: string): SceneReviewRecord | null;

	// Guided-sweep handoff predicate is used by selection sync; the predicate
	// itself stays on the plugin because it consults guidedSweep state plus
	// liveness heuristics shared with the toolbar viewmodel.
	shouldShowGuidedSweepHandoff(session: ReviewSession): boolean;

	// Tracking context for registry sync. Driven by sweep registry on plugin.
	getCurrentSessionTrackingContext(): { sessionId?: string; sessionStartedAt?: number };

	// Async flows delegated back to plugin.
	openReviewPanel(): Promise<void>;
	revealSelectedSuggestion(): Promise<void>;
	startOrResumeReviewForNote(notePath: string): Promise<void>;
	persistContributorProfilesIfNeeded(): Promise<void>;
}

export class SessionOrchestrator {
	constructor(private readonly host: SessionOrchestratorHost) {}

	async parseCurrentNote(options?: { suppressNotice?: boolean }): Promise<void> {
		const suppressNotice = options?.suppressNotice ?? false;
		const context = this.host.getActiveNoteContext();
		if (!context) {
			if (!suppressNotice) {
				new Notice("No active markdown note to review.");
			}
			return;
		}

		await this.parseReviewContext(context, suppressNotice);
	}

	async parseReviewContext(context: ActiveNoteContext, suppressNotice: boolean): Promise<void> {
		const previousSession = this.host.store.getSession();
		const preferredSelectionId =
			previousSession?.notePath === context.filePath ? this.host.store.getState().selectedSuggestionId : null;
		const session = this.host.reviewEngine.buildSession(
			context.filePath,
			context.text,
			previousSession?.notePath === context.filePath ? previousSession : null,
		);
		const hydratedSession = this.host.registry.applyPersistedReviewState(session);
		await this.host.persistContributorProfilesIfNeeded();

		if (!hydratedSession.hasReviewBlock) {
			this.host.clearActiveHighlights();
			this.host.setLastAppliedChange(null);
			this.host.store.clearSession();
			if (!suppressNotice) {
				new Notice(`No ${getReviewBlockFenceLabel()} found in this note.`);
			}
			return;
		}

		this.host.store.setSession(hydratedSession, preferredSelectionId);
		this.syncSelectionForSession(hydratedSession, preferredSelectionId);
		await this.host.workflow.syncCurrentNote(context.filePath);
		await this.host.registry.syncReviewerSignalsForSession(hydratedSession, {
			...this.host.getCurrentSessionTrackingContext(),
		});
		await this.host.openReviewPanel();
		await this.host.revealSelectedSuggestion();
		if (!suppressNotice) {
			new Notice(
				hydratedSession.suggestions.length > 0
					? `Parsed ${hydratedSession.suggestions.length} review suggestion${hydratedSession.suggestions.length === 1 ? "" : "s"}.`
					: "Review block found, but no valid review entries were parsed.",
			);
		}
	}

	resyncSessionForActiveNote(): void {
		const context = this.host.getReviewNoteContext() ?? this.host.getActiveNoteContext();
		const session = this.host.store.getSession();
		if (!context) {
			this.host.setBulkApplyConfirmState(null);
			this.host.store.batch(() => {
				this.host.store.setAppliedReview(null);
				if (session) {
					this.host.store.clearSession();
				}
			});
			this.host.clearActiveHighlights();
			this.host.setLastAppliedChange(null);
			return;
		}

		if (!session || session.notePath !== context.filePath) {
			this.host.setBulkApplyConfirmState(null);
			this.host.store.setAppliedReview(null);
			this.host.clearActiveHighlights();
			this.host.setLastAppliedChange(null);
			return;
		}

		if (!this.hasCurrentLastAppliedChangeForContext(context)) {
			this.host.setLastAppliedChange(null);
		}

		const refreshedSession = this.host.reviewEngine.buildSession(context.filePath, context.text, session);
		const hydratedSession = this.host.registry.applyPersistedReviewState(refreshedSession);
		void this.host.persistContributorProfilesIfNeeded();
		if (!hydratedSession.hasReviewBlock) {
			this.host.setBulkApplyConfirmState(null);
			this.host.store.batch(() => {
				this.host.store.setAppliedReview(null);
				this.host.store.clearSession();
			});
			this.host.clearActiveHighlights();
			this.host.setLastAppliedChange(null);
			return;
		}

		const preferredSelectionId = this.host.store.getState().selectedSuggestionId;
		if (this.host.getBulkApplyConfirmState()?.notePath !== hydratedSession.notePath) {
			this.host.setBulkApplyConfirmState(null);
		}
		this.host.store.setSession(hydratedSession, preferredSelectionId);
		this.syncSelectionForSession(hydratedSession, preferredSelectionId);
		void this.host.workflow.syncCurrentNote(context.filePath);
		void this.host.registry.syncReviewerSignalsForSession(hydratedSession, {
			...this.host.getCurrentSessionTrackingContext(),
		});
		this.host.setDefaultHighlightForSelection();
	}

	refreshSessionAfterAcceptedEdit(session: ReviewSession, acceptedSuggestionId: string): void {
		const context = this.host.getReviewNoteContext();
		if (!context) {
			return;
		}

		const refreshedSuggestions = this.host.reviewEngine.refreshSuggestions(
			context.view.editor.getValue(),
			markSuggestionAcceptedForRefresh(session.suggestions, acceptedSuggestionId),
		);

		this.host.store.replaceSuggestions(refreshedSuggestions);
	}

	async ensureCompletedSweepAuditSession(): Promise<void> {
		const completedSweep = this.host.getResolvedCompletedSweepState();
		if (!completedSweep) {
			return;
		}

		const targetNotePath = selectCompletedSweepAuditTarget({
			completedSweep,
			currentSession: this.host.getReviewSession(),
			isCompletedReviewSuggestion: (suggestion) => this.host.isCompletedReviewSuggestion(suggestion),
			getRecordByPath: (notePath) => this.host.getSceneReviewRecordByPath(notePath),
		});
		if (!targetNotePath) {
			return;
		}

		await this.host.startOrResumeReviewForNote(targetNotePath);
	}

	hasCurrentLastAppliedChangeForContext(context?: ActiveNoteContext | null): boolean {
		const lastAppliedChange = this.host.getLastAppliedChange();
		if (!lastAppliedChange || !context || context.filePath !== lastAppliedChange.notePath) {
			return false;
		}

		return computeNoteTextFingerprint(context.text) === lastAppliedChange.textFingerprint;
	}

	private syncSelectionForSession(session: ReviewSession, preferredSelectionId?: string | null): void {
		const appliedReview = this.host.store.getAppliedReview();
		if (appliedReview && appliedReview.notePath !== session.notePath) {
			this.host.store.setAppliedReview(null);
		}

		if (this.host.shouldShowGuidedSweepHandoff(session)) {
			this.host.store.selectSuggestion(null);
			this.host.clearActiveHighlights();
			return;
		}

		this.selectPreferredSuggestionForSession(preferredSelectionId);
	}

	private selectPreferredSuggestionForSession(preferredSelectionId?: string | null): void {
		const session = this.host.store.getSession();
		if (!session) {
			return;
		}

		if (
			preferredSelectionId &&
			session.suggestions.some((suggestion) => suggestion.id === preferredSelectionId)
		) {
			this.host.store.selectSuggestion(preferredSelectionId);
			return;
		}

		this.host.store.selectSuggestion(findPreferredSuggestionIdShared(session.suggestions));
	}
}
