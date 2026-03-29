import type { EditorView } from "@codemirror/view";
import { MarkdownView, normalizePath, Notice, Plugin, TFile, type App } from "obsidian";
import { registerCommands } from "./commands/Commands";
import { deriveContributorIdentitySeed } from "./core/ContributorIdentity";
import { ImportEngine } from "./core/ImportEngine";
import { MatchEngine } from "./core/MatchEngine";
import {
	canApplySuggestionDirectly,
	createSuggestionApplyPlan,
	getSuggestionAnchorTarget,
	getSuggestionPresentationTone,
	getSuggestionPrimaryTarget,
	getSuggestionStatusRank,
} from "./core/OperationSupport";
import {
	REVIEW_BLOCK_FENCE,
	getReviewBlockFenceLabel,
	normalizeImportedReviewText,
	noteContainsReviewBlock,
	removeImportedReviewBlocks,
} from "./core/ReviewBlockFormat";
import { ReviewEngine } from "./core/ReviewEngine";
import { buildReviewTemplate } from "./core/ReviewTemplate";
import { SuggestionParser } from "./core/SuggestionParser";
import type {
	EditorialistMetadataExport,
	ReviewImportBatch,
	ReviewSweepRegistryEntry,
} from "./models/ReviewImport";
import type { ReviewSession, ReviewSuggestion, ReviewTargetRef } from "./models/ReviewSuggestion";
import type {
	EditorialistPluginData,
	ParsedReviewerReference,
	ReviewerProfile,
	ReviewerResolutionStatus,
	SceneReviewRecord,
	ReviewerStats,
} from "./models/ReviewerProfile";
import { ReviewStore, type GuidedSweepState } from "./state/ReviewStore";
import { ReviewerDirectory } from "./state/ReviewerDirectory";
import { ReviewRegistryService } from "./services/ReviewRegistryService";
import { ReviewWorkflowService } from "./services/ReviewWorkflowService";
import { EditorialistModal, type ClipboardReviewBatch } from "./ui/EditorialistModal";
import { openEditorialistChoiceModal } from "./ui/EditorialistChoiceModal";
import { REVIEW_PANEL_VIEW_TYPE, ReviewPanel } from "./ui/ReviewPanel";
import { EditorialistSettingTab } from "./ui/EditorialistSettingTab";
import { createReviewDecorationsExtension, syncReviewDecorations } from "./ui/Decorations";
import { createReviewToolbarElement, type ToolbarState } from "./ui/Toolbar";

interface ActiveNoteContext {
	filePath: string;
	text: string;
	view: MarkdownView;
}

interface OffsetRange {
	end: number;
	start: number;
}

interface LastAppliedChange {
	end: number;
	notePath: string;
	start: number;
	suggestionId: string;
}

export default class EditorialistPlugin extends Plugin {
	readonly store = new ReviewStore();

	private readonly reviewerDirectory = new ReviewerDirectory();
	private readonly parser = new SuggestionParser(this.reviewerDirectory);
	private readonly matchEngine = new MatchEngine();
	private readonly reviewEngine = new ReviewEngine(this.parser, this.matchEngine);
	private readonly registry = new ReviewRegistryService(
		this.app,
		this.reviewEngine,
		this.reviewerDirectory,
		() => this.savePluginData(),
	);
	private readonly workflow = new ReviewWorkflowService(this.store, this.registry, {
		clearReviewSelection: async () => {
			this.store.selectSuggestion(null);
			await this.revealSelectedSuggestion();
		},
		confirmSweepCompletion: async () =>
			openEditorialistChoiceModal(this.app, {
				title: "Sweep complete",
				description: "This guided sweep is complete. Keep the imported review blocks or clean up this batch now.",
				choices: [
					{ label: "Keep review blocks", value: "keep" },
					{ label: "Clean up this batch", value: "cleanup" },
				],
			}),
		cleanupBatchById: async (batchId) => {
			await this.cleanupReviewBatch(batchId);
		},
		notify: (message) => {
			new Notice(message);
		},
		openNoteForReview: async (filePath) => {
			await this.openSceneNote(filePath);
			await this.parseCurrentNote({ suppressNotice: true });
			this.syncActiveEditorDecorations();
		},
	});
	private importEngine!: ImportEngine;

	private activeHighlightRange: OffsetRange | null = null;
	private activeHighlightTone: "active" | "applied" = "active";
	private lastAppliedChange: LastAppliedChange | null = null;
	private toolbarOverlayEl: HTMLElement | null = null;
	private toolbarOverlayEditorView: EditorView | null = null;
	private readonly toolbarOverlayScrollHandler = (): void => {
		this.positionToolbarOverlay();
	};

	async onload(): Promise<void> {
		await this.loadPluginData();
		await this.persistContributorProfilesIfNeeded();
		await this.registry.refreshActiveBookScope();
		this.importEngine = new ImportEngine(this.app, this.parser, this.matchEngine);
		this.registerEditorExtension(createReviewDecorationsExtension());
		this.registerView(REVIEW_PANEL_VIEW_TYPE, (leaf) => new ReviewPanel(leaf, this));
		this.addSettingTab(new EditorialistSettingTab(this.app, this));
		registerCommands(this);
		this.registerDomEvent(window, "resize", () => {
			this.positionToolbarOverlay();
		});

		const unsubscribe = this.store.subscribe(() => {
			this.refreshReviewPanel();
			this.syncActiveEditorDecorations();
		});
		this.register(unsubscribe);

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				if (this.workflow.isTransitioning()) {
					return;
				}
				this.resyncSessionForActiveNote();
				this.syncActiveEditorDecorations();
			}),
		);

		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				if (this.workflow.isTransitioning()) {
					return;
				}
				this.resyncSessionForActiveNote();
				this.syncActiveEditorDecorations();
			}),
		);

		this.registerEvent(
			this.app.workspace.on("editor-change", () => {
				this.resyncSessionForActiveNote();
			}),
		);

		this.syncActiveEditorDecorations();
	}

	async onunload(): Promise<void> {
		this.destroyToolbarOverlay();
		this.app.workspace.detachLeavesOfType(REVIEW_PANEL_VIEW_TYPE);
	}

	async parseCurrentNote(options?: { suppressNotice?: boolean }): Promise<void> {
		const suppressNotice = options?.suppressNotice ?? false;
		const context = this.getActiveNoteContext();
		if (!context) {
			if (!suppressNotice) {
				new Notice("No active markdown note to review.");
			}
			return;
		}

		const previousSession = this.store.getSession();
		const preferredSelectionId =
			previousSession?.notePath === context.filePath ? this.store.getState().selectedSuggestionId : null;
		const session = this.reviewEngine.buildSession(
			context.filePath,
			context.text,
			previousSession?.notePath === context.filePath ? previousSession : null,
		);
		const hydratedSession = this.registry.applyPersistedReviewState(session);
		await this.persistContributorProfilesIfNeeded();

		if (!hydratedSession.hasReviewBlock) {
			this.activeHighlightRange = null;
			this.activeHighlightTone = "active";
			this.lastAppliedChange = null;
			this.store.clearSession();
			if (!suppressNotice) {
				new Notice(`No ${getReviewBlockFenceLabel()} found in this note.`);
			}
			return;
		}

		this.store.setSession(hydratedSession, preferredSelectionId);
		this.selectPreferredSuggestionForSession(preferredSelectionId);
		await this.workflow.syncCurrentNote(context.filePath);
		await this.registry.syncReviewerSignalsForSession(hydratedSession);
		await this.openReviewPanel();
		this.revealSelectedSuggestion();
		if (!suppressNotice) {
			new Notice(
				hydratedSession.suggestions.length > 0
					? `Parsed ${hydratedSession.suggestions.length} review suggestion${hydratedSession.suggestions.length === 1 ? "" : "s"}.`
					: "Review block found, but no valid review entries were parsed.",
			);
		}
	}

	async openPrepareReviewFormatModal(): Promise<void> {
		await this.openEditorialistModal();
	}

	async openImportReviewBatchModal(): Promise<void> {
		await this.openEditorialistModal();
	}

	async openEditorialistModal(): Promise<void> {
		const context = this.getActiveNoteContext();
		const selectedText = this.getActiveEditorSelection();
		new EditorialistModal(this.app, {
			activeNoteLabel: context?.view.file?.basename,
			currentNoteHasReviewBlock: Boolean(context && noteContainsReviewBlock(context.text)),
			onCopyTemplate: async () => {
				await this.copyReviewTemplateToClipboard(selectedText);
			},
			onImportBatch: async (batch, startReview) => {
				await this.importReviewBatch(batch, startReview);
			},
			onImportRawToActiveNote: async (rawText, startReview) => {
				await this.importReviewBatchToActiveNote(rawText, startReview);
			},
			onInspectBatch: async (rawText) =>
				this.inspectReviewBatch(rawText, { activeNotePath: context?.filePath }),
			onLoadClipboardBatch: async () => this.loadClipboardReviewBatch(),
			onOpenReviewPanel: async () => {
				await this.openReviewPanel();
			},
			onStartReviewInCurrentNote: async () => {
				await this.parseCurrentNote({ suppressNotice: true });
			},
		}).open();
	}

	async openReviewPanel(): Promise<void> {
		const existingLeaves = this.app.workspace.getLeavesOfType(REVIEW_PANEL_VIEW_TYPE);
		const [primaryLeaf, ...duplicateLeaves] = existingLeaves;
		for (const duplicateLeaf of duplicateLeaves) {
			duplicateLeaf.detach();
		}

		const leaf = primaryLeaf ?? this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			return;
		}

		await leaf.setViewState({
			type: REVIEW_PANEL_VIEW_TYPE,
			active: false,
		});
		this.app.workspace.revealLeaf(leaf);
		this.refreshReviewPanel();
	}

	openSettings(): void {
		const appWithSettings = this.app as App & {
			setting?: {
				open: () => void;
				openTabById?: (id: string) => void;
			};
		};

		appWithSettings.setting?.open();
		appWithSettings.setting?.openTabById?.(this.manifest.id);
	}

	async selectSuggestion(id: string): Promise<void> {
		if (!this.hasReviewSessionContext()) {
			return;
		}

		this.store.selectSuggestion(id);
		await this.revealSuggestionContext(id);
	}

	async selectNextSuggestion(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const nextSuggestionId = this.getAdjacentRevealableSuggestionId("next");
		if (!nextSuggestionId) {
			await this.workflow.advanceGuidedSweep();
			return;
		}

		this.store.selectSuggestion(nextSuggestionId);
		await this.revealSelectedSuggestion();
	}

	async selectPreviousSuggestion(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const previousSuggestionId = this.getAdjacentRevealableSuggestionId("previous");
		if (!previousSuggestionId) {
			return;
		}

		this.store.selectSuggestion(previousSuggestionId);
		await this.revealSelectedSuggestion();
	}

	async acceptSelectedSuggestion(): Promise<boolean> {
		if (!this.hasActiveReviewSession()) {
			return false;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return false;
		}

		return this.acceptSuggestion(selectedSuggestion.id);
	}

	async acceptSelectedSuggestionAndAdvance(): Promise<void> {
		if (!(await this.acceptSelectedSuggestion())) {
			return;
		}

		await this.selectNextSuggestion();
	}

	async rejectSelectedSuggestion(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		await this.rejectSuggestion(selectedSuggestion.id);
	}

	deferSelectedSuggestion(): void {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		void this.deferSuggestion(selectedSuggestion.id);
	}

	async jumpToSelectedSuggestionTarget(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		await this.jumpToSuggestionTarget(selectedSuggestion.id);
	}

	async jumpToSelectedSuggestionAnchor(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		await this.jumpToSuggestionAnchor(selectedSuggestion.id);
	}

	async jumpToSelectedSuggestionSource(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		await this.jumpToSuggestionSource(selectedSuggestion.id);
	}

	async acceptSuggestion(id: string): Promise<boolean> {
		const context = this.getReviewNoteContext();
		const session = this.store.getSession();
		const suggestion = this.getSuggestionById(id);

		if (!context || !session || session.notePath !== context.filePath || !suggestion) {
			new Notice("The active note does not match the current review session.");
			return false;
		}

		if (!this.canAcceptSuggestion(id)) {
			new Notice("This suggestion cannot be safely accepted yet.");
			return false;
		}

		const applyPlan = createSuggestionApplyPlan(context.text, suggestion);
		if (!applyPlan) {
			new Notice(`The ${suggestion.operation} suggestion could not be applied safely.`);
			return false;
		}

		const from = context.view.editor.offsetToPos(applyPlan.from);
		const to = context.view.editor.offsetToPos(applyPlan.to);
		context.view.editor.replaceRange(applyPlan.text, from, to);
		const appliedEnd = applyPlan.from + applyPlan.text.length;
		const appliedFrom = context.view.editor.offsetToPos(applyPlan.from);
		const appliedTo = context.view.editor.offsetToPos(appliedEnd);
		context.view.editor.setSelection(appliedFrom, appliedTo);
		context.view.editor.scrollIntoView({ from: appliedFrom, to: appliedTo }, true);
		context.view.editor.focus();

		await this.registry.clearPersistedReviewDecision(context.filePath, suggestion, { persist: false });
		this.refreshSessionAfterAcceptedEdit(session, suggestion.id);
		await this.registry.syncReviewerSignalsForSession(this.store.getSession(), { persist: false });
		this.store.selectSuggestion(id);
		this.activeHighlightRange = {
			start: applyPlan.from,
			end: appliedEnd,
		};
		this.activeHighlightTone = "applied";
		this.lastAppliedChange = {
			start: applyPlan.from,
			end: appliedEnd,
			notePath: context.filePath,
			suggestionId: suggestion.id,
		};
		this.syncActiveEditorDecorations();
		await this.registry.syncSceneInventory();
		return true;
	}

	async rejectSuggestion(id: string): Promise<void> {
		if (!this.canRejectSuggestion(id)) {
			return;
		}

		const session = this.getReviewSession();
		const suggestion = this.getSuggestionById(id);
		if (session && suggestion) {
			await this.registry.persistReviewDecision(session.notePath, suggestion, "rejected", { persist: false });
		}

		const nextSuggestionId = this.getAdjacentRevealableSuggestionId("next", id);
		this.store.updateSuggestionStatus(id, "rejected");
		await this.registry.syncReviewerSignalsForSession(this.store.getSession(), { persist: false });
		await this.registry.syncSceneInventory();
		if (nextSuggestionId) {
			this.store.selectSuggestion(nextSuggestionId);
			await this.revealSelectedSuggestion();
			return;
		}

		await this.workflow.advanceGuidedSweep();
	}

	async deferSuggestion(id: string): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const session = this.getReviewSession();
		const suggestion = this.getSuggestionById(id);
		if (session && suggestion) {
			await this.registry.persistReviewDecision(session.notePath, suggestion, "deferred", { persist: false });
		}

		const nextSuggestionId = this.getAdjacentRevealableSuggestionId("next", id, true);
		this.store.updateSuggestionStatus(id, "deferred");
		await this.registry.syncReviewerSignalsForSession(this.store.getSession(), { persist: false });
		await this.registry.syncSceneInventory();
		if (nextSuggestionId) {
			this.store.selectSuggestion(nextSuggestionId);
			await this.revealSelectedSuggestion();
			return;
		}

		await this.workflow.advanceGuidedSweep();
	}

	async undoLastAppliedSuggestion(): Promise<void> {
		const change = this.lastAppliedChange;
		const context = this.getReviewNoteContext();
		const appliedSuggestion = change ? this.getSuggestionById(change.suggestionId) : null;
		if (!change || !context || context.filePath !== change.notePath) {
			new Notice("No applied change is ready to undo.");
			return;
		}

		await this.focusReviewLeaf(context.view);
		if (!this.getActiveEditorView()) {
			new Notice("The editor is not available for undo.");
			return;
		}

		const commands = (this.app as typeof this.app & {
			commands?: { executeCommandById: (id: string) => boolean };
		}).commands;
		if (!commands?.executeCommandById("editor:undo")) {
			new Notice("Nothing to undo.");
			return;
		}

		if (appliedSuggestion) {
			await this.registry.clearPersistedReviewDecision(change.notePath, appliedSuggestion, { persist: false });
		}
		this.lastAppliedChange = null;
		this.resyncSessionForActiveNote();
		this.store.selectSuggestion(change.suggestionId);
		await this.revealSuggestionContext(change.suggestionId);
		new Notice("Applied change undone.");
	}

	async jumpToSuggestionTarget(id: string): Promise<void> {
		if (!this.hasReviewSessionContext()) {
			return;
		}

		const suggestion = this.getSuggestionById(id);
		if (!suggestion) {
			return;
		}

		this.store.selectSuggestion(id);
		await this.focusResolvedTarget(getSuggestionPrimaryTarget(suggestion));
	}

	async jumpToSuggestionAnchor(id: string): Promise<void> {
		if (!this.hasReviewSessionContext()) {
			return;
		}

		const suggestion = this.getSuggestionById(id);
		const anchor = suggestion ? getSuggestionAnchorTarget(suggestion) : undefined;
		if (!suggestion || !anchor) {
			return;
		}

		this.store.selectSuggestion(id);
		await this.focusResolvedTarget(anchor);
	}

	async jumpToSuggestionSource(id: string): Promise<void> {
		if (!this.hasReviewSessionContext()) {
			return;
		}

		const suggestion = this.getSuggestionById(id);
		const start = suggestion?.source.startOffset;
		const end = suggestion?.source.endOffset;
		if (!suggestion || start === undefined || end === undefined) {
			return;
		}

		this.store.selectSuggestion(id);
		await this.focusEditorRange(start, end);
	}

	getReviewerProfiles(): ReviewerProfile[] {
		return this.reviewerDirectory.getProfiles();
	}

	getSortedReviewerProfiles(): ReviewerProfile[] {
		return this.reviewerDirectory.getSortedProfiles();
	}

	getReviewerProfile(reviewerId?: string): ReviewerProfile | null {
		return reviewerId ? this.reviewerDirectory.getProfileById(reviewerId) : null;
	}

	getReviewerStats(reviewerId?: string): ReviewerStats | null {
		return reviewerId ? this.reviewerDirectory.getStats(reviewerId) : null;
	}

	getSweepRegistryEntries(): ReviewSweepRegistryEntry[] {
		return this.registry.getSweepRegistryEntries();
	}

	getSceneReviewRecords(options?: { activeBookOnly?: boolean }): SceneReviewRecord[] {
		return this.registry.getSceneReviewRecords(options);
	}

	getActiveBookScopeInfo(): { label: string | null; sourceFolder: string | null } {
		return this.registry.getActiveBookScopeInfo();
	}

	async syncOperationalMetadata(): Promise<void> {
		await this.registry.syncOperationalMetadata();
	}

	getReviewActivitySummary(): {
		accepted: number;
		cleanedSweeps: number;
		completedSweeps: number;
		deferred: number;
		processed: number;
		inProgressSweeps: number;
		pending: number;
		rejected: number;
		totalSuggestions: number;
		totalSweeps: number;
		unresolved: number;
	} {
		return this.registry.getReviewActivitySummary(this.getReviewerProfiles());
	}

	getReviewPanelHeaderDetails(): {
		summary: string;
		warnings: string[];
	} {
		const session = this.store.getSession();
		if (!session) {
			return {
				summary: "",
				warnings: [],
			};
		}

		const parts = [`${session.suggestions.length} suggestions`];
		const guidedSweep = this.getGuidedSweep();
		if (guidedSweep?.notePaths.length) {
			parts.push(`${guidedSweep.notePaths.length} scene${guidedSweep.notePaths.length === 1 ? "" : "s"}`);
			if (guidedSweep.notePaths.length > 1) {
				parts.push(`${guidedSweep.currentNoteIndex + 1}/${guidedSweep.notePaths.length}`);
			}
		} else {
			const batchId = this.getCurrentBatchId();
			const entry = this.getSweepRegistryEntry(batchId ?? undefined);
			if (entry?.importedNotePaths.length) {
				parts.push(`${entry.importedNotePaths.length} scene${entry.importedNotePaths.length === 1 ? "" : "s"}`);
			}
		}

		return {
			summary: parts.join(" • "),
			warnings: this.getReviewPanelWarnings(session.notePath),
		};
	}

	async toggleReviewerStarById(reviewerId: string): Promise<void> {
		const updatedProfile = this.reviewerDirectory.toggleStar(reviewerId);
		if (!updatedProfile) {
			return;
		}

		await this.savePluginData();
		this.refreshReviewPanel();
	}

	async clearCleanedSweepRecords(): Promise<number> {
		return this.registry.clearCleanedSweepRecords();
	}

	async useSuggestedReviewer(suggestionId: string, reviewerId?: string): Promise<void> {
		const suggestion = this.getSuggestionById(suggestionId);
		const resolvedReviewerId = reviewerId ?? suggestion?.contributor.suggestedReviewerIds[0];
		if (!suggestion || !resolvedReviewerId) {
			return;
		}

		await this.applyReviewerResolutionToMatchingSuggestions(
			suggestion.contributor.raw,
			resolvedReviewerId,
			"suggested",
		);
	}

	async createReviewerFromSuggestion(suggestionId: string): Promise<void> {
		const suggestion = this.getSuggestionById(suggestionId);
		if (!suggestion) {
			return;
		}

		const profile = this.reviewerDirectory.createProfileFromParsedReviewer(suggestion.contributor.raw);
		await this.savePluginData();
		await this.applyReviewerProfileToMatchingSuggestions(suggestion.contributor.raw, profile, "new");
	}

	leaveReviewerUnresolved(suggestionId: string): void {
		const suggestion = this.getSuggestionById(suggestionId);
		if (!suggestion) {
			return;
		}

		const unresolvedContributor = this.createUnresolvedContributor(
			suggestion.contributor.raw,
			suggestion.contributor.suggestedReviewerIds,
		);
		void this.applyContributorToMatchingSuggestions(suggestion.contributor.raw, unresolvedContributor);
	}

	async saveReviewerAliasForSuggestion(suggestionId: string): Promise<void> {
		const suggestion = this.getSuggestionById(suggestionId);
		const rawName = suggestion?.contributor.raw.rawName?.trim();
		const reviewerId = suggestion?.contributor.reviewerId;
		if (!suggestion || !rawName || !reviewerId) {
			return;
		}

		const updatedProfile = this.reviewerDirectory.addAlias(reviewerId, rawName);
		if (!updatedProfile) {
			return;
		}

		await this.savePluginData();
		this.resyncSessionForActiveNote();
	}

	async toggleReviewerStarForSuggestion(suggestionId: string): Promise<void> {
		const suggestion = this.getSuggestionById(suggestionId);
		const reviewerId = suggestion?.contributor.reviewerId;
		if (!reviewerId) {
			return;
		}

		const updatedProfile = this.reviewerDirectory.toggleStar(reviewerId);
		if (!updatedProfile) {
			return;
		}

		await this.savePluginData();
		this.refreshReviewPanel();
	}

	canToggleReviewerStar(suggestionId: string): boolean {
		return Boolean(this.getSuggestionById(suggestionId)?.contributor.reviewerId);
	}

	canSaveReviewerAlias(suggestionId: string): boolean {
		const suggestion = this.getSuggestionById(suggestionId);
		const rawName = suggestion?.contributor.raw.rawName?.trim();
		const reviewerId = suggestion?.contributor.reviewerId;
		if (!suggestion || !rawName || !reviewerId) {
			return false;
		}

		const profile = this.reviewerDirectory.getProfileById(reviewerId);
		if (!profile) {
			return false;
		}

		const normalizedRaw = this.reviewerDirectory.normalizeValue(rawName);
		if (normalizedRaw === this.reviewerDirectory.normalizeValue(profile.displayName)) {
			return false;
		}

		return !profile.aliases.some((alias) => this.reviewerDirectory.normalizeValue(alias) === normalizedRaw);
	}

	canAcceptSuggestion(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		if (!suggestion || suggestion.status !== "pending") {
			return false;
		}

		return canApplySuggestionDirectly(suggestion);
	}

	canAcceptSelectedSuggestion(): boolean {
		const selected = this.store.getSelectedSuggestion();
		return selected ? this.canAcceptSuggestion(selected.id) : false;
	}

	canRejectSuggestion(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		return Boolean(suggestion && suggestion.status !== "accepted" && suggestion.status !== "rejected");
	}

	canRejectSelectedSuggestion(): boolean {
		const selected = this.store.getSelectedSuggestion();
		return selected ? this.canRejectSuggestion(selected.id) : false;
	}

	canDeferSuggestion(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		return Boolean(suggestion && suggestion.status !== "accepted" && suggestion.status !== "rejected");
	}

	canDeferSelectedSuggestion(): boolean {
		const selected = this.store.getSelectedSuggestion();
		return selected ? this.canDeferSuggestion(selected.id) : false;
	}

	canUndoLastAppliedSuggestion(): boolean {
		const context = this.getReviewNoteContext();
		return Boolean(this.lastAppliedChange && context && context.filePath === this.lastAppliedChange.notePath);
	}

	private shouldShowUndoForSelectedSuggestion(selectedId: string): boolean {
		const context = this.getReviewNoteContext();
		return Boolean(
			this.lastAppliedChange &&
			context &&
			context.filePath === this.lastAppliedChange.notePath &&
			this.lastAppliedChange.suggestionId === selectedId,
		);
	}

	getSuggestionPresentationTone(suggestion: ReviewSuggestion): "active" | "muted" {
		return getSuggestionPresentationTone(suggestion);
	}

	getSuggestionPresentationRank(suggestion: ReviewSuggestion): number {
		return getSuggestionStatusRank(suggestion.status);
	}

	canJumpToSuggestionTarget(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		if (!suggestion) {
			return false;
		}

		return this.hasResolvedRange(getSuggestionPrimaryTarget(suggestion));
	}

	canJumpToSuggestionAnchor(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		return this.hasResolvedRange(suggestion ? getSuggestionAnchorTarget(suggestion) : undefined);
	}

	canJumpToSuggestionSource(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const source = this.getSuggestionById(id)?.source;
		return Boolean(source && source.startOffset !== undefined && source.endOffset !== undefined);
	}

	private refreshReviewPanel(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(REVIEW_PANEL_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof ReviewPanel) {
				view.render();
			}
		}
	}

	private getActiveNoteContext(): ActiveNoteContext | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (!view || !file) {
			return null;
		}

		return {
			filePath: file.path,
			text: view.editor.getValue(),
			view,
		};
	}

	private getNoteContextByPath(filePath: string): ActiveNoteContext | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || view.file?.path !== filePath) {
				continue;
			}

			return {
				filePath: view.file.path,
				text: view.editor.getValue(),
				view,
			};
		}

		return null;
	}

	private getReviewNoteContext(): ActiveNoteContext | null {
		const session = this.store.getSession();
		if (!session) {
			return null;
		}

		const activeContext = this.getActiveNoteContext();
		if (activeContext?.filePath === session.notePath) {
			return activeContext;
		}

		return this.getNoteContextByPath(session.notePath);
	}

	private getActiveEditorSelection(): string | undefined {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const selectedText = view?.editor.getSelection();
		return selectedText?.trim() ? selectedText : undefined;
	}

	private getActiveEditorView(): EditorView | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			return null;
		}

		// @ts-expect-error Obsidian exposes the CM6 instance at runtime but does not type it.
		return view.editor.cm as EditorView;
	}

	private getToolbarState(hasReviewBlock: boolean): ToolbarState | null {
		if (!hasReviewBlock) {
			return null;
		}

		const session = this.getReviewSession();
		const selected = this.store.getSelectedSuggestion();
		if (!session || !selected) {
			return null;
		}

		const suggestions = session.suggestions;
		const selectedIndex = suggestions.findIndex((suggestion) => suggestion.id === selected.id);
		const pendingCount = suggestions.filter((suggestion) => suggestion.status === "pending").length;
		const unresolvedCount = suggestions.filter((suggestion) => suggestion.status === "unresolved").length;
		const acceptedCount = suggestions.filter((suggestion) => suggestion.status === "accepted").length;
		const rejectedCount = suggestions.filter((suggestion) => suggestion.status === "rejected").length;
		const deferredCount = suggestions.filter((suggestion) => suggestion.status === "deferred").length;
		const canUndoLastAccept = this.shouldShowUndoForSelectedSuggestion(selected.id);
		const guidedSweep = this.getGuidedSweep();
		const sceneProgressLabel =
			guidedSweep && guidedSweep.notePaths.length > 1
				? `scene ${guidedSweep.currentNoteIndex + 1} of ${guidedSweep.notePaths.length}`
				: undefined;

		return {
			hasReviewBlock,
			completionLabel: this.isSweepComplete(suggestions) ? "sweep complete" : undefined,
			pendingCount,
			acceptedCount,
			rejectedCount,
			deferredCount,
			sceneProgressLabel,
			selectedIndexLabel:
				selectedIndex === -1 ? `${suggestions.length} total` : `${selectedIndex + 1} of ${suggestions.length}`,
			unresolvedCount,
			canApply: this.canAcceptSelectedSuggestion(),
			canDefer: this.canDeferSelectedSuggestion(),
			canNext: this.getAdjacentRevealableSuggestionId("next") !== null,
			canPrevious: this.getAdjacentRevealableSuggestionId("previous") !== null,
			canReject: this.canRejectSelectedSuggestion(),
			canUndoLastAccept,
			operationLabel: selected.operation.toUpperCase(),
			selectedLabel: selectedIndex === -1 ? "Current suggestion" : `Suggestion ${selectedIndex + 1} of ${suggestions.length}`,
		};
	}

	private syncActiveEditorDecorations(): void {
		const editorView = this.getActiveEditorView();
		const context = this.getActiveNoteContext();
		if (!editorView || !context) {
			this.destroyToolbarOverlay();
			return;
		}

		const hasReviewBlock = noteContainsReviewBlock(context.text);
		const highlight = this.hasReviewSessionContext() ? this.activeHighlightRange : null;
		const toolbarState = this.getToolbarState(hasReviewBlock);

		syncReviewDecorations(editorView, {
			highlight,
			highlightTone: this.activeHighlightTone,
		});
		this.syncToolbarOverlay(editorView, toolbarState, highlight);
	}

	private resyncSessionForActiveNote(): void {
		const context = this.getReviewNoteContext() ?? this.getActiveNoteContext();
		const session = this.store.getSession();
		if (!context || !session || session.notePath !== context.filePath) {
			this.activeHighlightRange = null;
			this.activeHighlightTone = "active";
			this.lastAppliedChange = null;
			return;
		}

		const refreshedSession = this.reviewEngine.buildSession(context.filePath, context.text, session);
		const hydratedSession = this.registry.applyPersistedReviewState(refreshedSession);
		void this.persistContributorProfilesIfNeeded();
		if (!hydratedSession.hasReviewBlock) {
			this.activeHighlightRange = null;
			this.activeHighlightTone = "active";
			this.lastAppliedChange = null;
			this.store.clearSession();
			return;
		}

		const preferredSelectionId = this.store.getState().selectedSuggestionId;
		this.store.setSession(hydratedSession, preferredSelectionId);
		this.selectPreferredSuggestionForSession(preferredSelectionId);
		void this.workflow.syncCurrentNote(context.filePath);
		void this.registry.syncReviewerSignalsForSession(hydratedSession);
		this.setDefaultHighlightForSelection();
	}

	private refreshSessionAfterAcceptedEdit(session: ReviewSession, acceptedSuggestionId: string): void {
		const context = this.getReviewNoteContext();
		if (!context) {
			return;
		}

		const refreshedSuggestions = this.reviewEngine.refreshSuggestions(
			context.view.editor.getValue(),
			session.suggestions.map((item) =>
				item.id === acceptedSuggestionId
					? {
							...item,
							status: "accepted",
						}
					: item,
			),
		);

		this.store.replaceSuggestions(refreshedSuggestions);
	}

	private getSuggestionById(id: string): ReviewSuggestion | null {
		const session = this.store.getSession();
		return session?.suggestions.find((suggestion) => suggestion.id === id) ?? null;
	}

	private applyReviewerResolutionToMatchingSuggestions(
		raw: ParsedReviewerReference,
		reviewerId: string,
		resolutionStatus: ReviewerResolutionStatus,
	): Promise<void> {
		const profile = this.reviewerDirectory.getProfileById(reviewerId);
		if (!profile) {
			new Notice(`Reviewer profile "${reviewerId}" was not found.`);
			return Promise.resolve();
		}

		return this.applyReviewerProfileToMatchingSuggestions(raw, profile, resolutionStatus);
	}

	private applyReviewerProfileToMatchingSuggestions(
		raw: ParsedReviewerReference,
		profile: ReviewerProfile,
		resolutionStatus: ReviewerResolutionStatus,
	): Promise<void> {
		const contributor = this.createResolvedContributor(raw, profile, resolutionStatus);
		return this.applyContributorToMatchingSuggestions(raw, contributor);
	}

	private async applyContributorToMatchingSuggestions(raw: ParsedReviewerReference, contributor: ReviewSuggestion["contributor"]): Promise<void> {
		const session = this.store.getSession();
		if (!session) {
			return;
		}

		this.store.replaceSuggestions(
			session.suggestions.map((suggestion) =>
				this.sameRawReviewer(suggestion.contributor.raw, raw)
					? {
							...suggestion,
							contributor,
						}
					: suggestion,
			),
		);
		await this.registry.syncReviewerSignalsForSession(this.store.getSession());
	}

	private createResolvedContributor(
		raw: ParsedReviewerReference,
		profile: ReviewerProfile,
		resolutionStatus: ReviewerResolutionStatus,
	): ReviewSuggestion["contributor"] {
		return {
			id: profile.id,
			displayName: profile.displayName,
			kind: profile.kind,
			reviewerType: profile.reviewerType,
			provider: profile.provider,
			model: profile.model,
			reviewerId: profile.id,
			resolutionStatus,
			suggestedReviewerIds: [],
			raw,
		};
	}

	private createUnresolvedContributor(
		raw: ParsedReviewerReference,
		suggestedReviewerIds: string[],
	): ReviewSuggestion["contributor"] {
		const seed = deriveContributorIdentitySeed(raw);
		return {
			id: raw.rawName ? `parsed-${this.reviewerDirectory.normalizeValue(raw.rawName).replace(/\s+/g, "-")}` : "parsed-unknown-reviewer",
			displayName: seed.displayName,
			kind: seed.kind,
			reviewerType: seed.reviewerType,
			provider: seed.provider,
			model: seed.model,
			reviewerId: undefined,
			resolutionStatus: "unresolved",
			suggestedReviewerIds,
			raw,
		};
	}

	private sameRawReviewer(left: ParsedReviewerReference, right: ParsedReviewerReference): boolean {
		return (
			(left.rawName ?? "").trim() === (right.rawName ?? "").trim() &&
			(left.rawType ?? "").trim() === (right.rawType ?? "").trim() &&
			(left.rawProvider ?? "").trim() === (right.rawProvider ?? "").trim() &&
			(left.rawModel ?? "").trim() === (right.rawModel ?? "").trim()
		);
	}

	private getReviewSession(): ReviewSession | null {
		const context = this.getReviewNoteContext();
		const session = this.store.getSession();
		if (!context || !session || session.notePath !== context.filePath) {
			return null;
		}

		return session;
	}

	private getGuidedSweep(): GuidedSweepState | null {
		return this.store.getGuidedSweep();
	}

	private getSweepRegistryEntry(batchId?: string): ReviewSweepRegistryEntry | null {
		return this.registry.getSweepRegistryEntry(batchId);
	}

	private getCurrentBatchId(): string | null {
		const context = this.getReviewNoteContext() ?? this.getActiveNoteContext();
		if (!context) {
			return null;
		}

		return this.workflow.getCurrentBatchId(context.text);
	}

	private hasReviewSessionContext(): boolean {
		return Boolean(this.getReviewSession());
	}

	private hasActiveReviewSession(): boolean {
		return Boolean(this.getReviewSession()?.suggestions.length);
	}

	private async revealSelectedSuggestion(): Promise<void> {
		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			this.activeHighlightRange = null;
			this.activeHighlightTone = "active";
			this.syncActiveEditorDecorations();
			return;
		}

		await this.revealSuggestionContext(selectedSuggestion.id);
	}

	private async revealSuggestionContext(id: string): Promise<void> {
		const suggestion = this.getSuggestionById(id);
		if (!suggestion) {
			this.activeHighlightRange = null;
			this.activeHighlightTone = "active";
			return;
		}

		if (suggestion.operation === "move") {
			if (await this.focusResolvedTarget(getSuggestionPrimaryTarget(suggestion))) {
				return;
			}

			if (await this.focusResolvedTarget(getSuggestionAnchorTarget(suggestion))) {
				return;
			}
		} else if (await this.focusResolvedTarget(getSuggestionPrimaryTarget(suggestion))) {
			return;
		}
		this.activeHighlightRange = null;
		this.activeHighlightTone = "active";
		this.syncActiveEditorDecorations();
	}

	private async focusResolvedTarget(target?: ReviewTargetRef): Promise<boolean> {
		if (!target || !this.hasResolvedRange(target)) {
			return false;
		}

		const start = target.startOffset;
		const end = target.endOffset;
		if (start === undefined || end === undefined) {
			return false;
		}

		await this.focusEditorRange(start, end);
		return true;
	}

	private hasResolvedRange(target?: ReviewTargetRef): boolean {
		return Boolean(target && target.startOffset !== undefined && target.endOffset !== undefined);
	}

	private canRevealSuggestionInManuscript(suggestion: ReviewSuggestion): boolean {
		if (!this.isSuggestionOpen(suggestion)) {
			return false;
		}

		if (this.hasResolvedRange(getSuggestionPrimaryTarget(suggestion))) {
			return true;
		}

		return this.hasResolvedRange(getSuggestionAnchorTarget(suggestion));
	}

	private getAdjacentRevealableSuggestionId(
		direction: "next" | "previous",
		fromId?: string,
		treatCurrentAsDeferred = false,
	): string | null {
		const session = this.getReviewSession();
		if (!session || session.suggestions.length === 0) {
			return null;
		}

		const suggestions = session.suggestions;
		const currentId = fromId ?? this.store.getState().selectedSuggestionId;
		const currentIndex = currentId
			? suggestions.findIndex((suggestion) => suggestion.id === currentId)
			: -1;
		const normalizedStartIndex =
			currentIndex === -1
				? direction === "next"
					? suggestions.length - 1
					: 0
				: currentIndex;

		for (const tier of [0, 1, 2]) {
			for (let offset = 1; offset <= suggestions.length; offset += 1) {
				const index =
					direction === "next"
						? (normalizedStartIndex + offset) % suggestions.length
						: (normalizedStartIndex - offset + suggestions.length) % suggestions.length;
				const suggestion = suggestions[index];
				if (
					suggestion &&
					this.getSuggestionTraversalTier(
						suggestion,
						treatCurrentAsDeferred && suggestion.id === fromId,
					) === tier
				) {
					return suggestion.id;
				}
			}
		}

		return null;
	}

	private getSuggestionTraversalTier(suggestion: ReviewSuggestion, forceDeferred = false): number | null {
		if (!this.isSuggestionOpen(suggestion)) {
			return null;
		}

		if (this.canRevealSuggestionInManuscript(suggestion)) {
			if (forceDeferred || suggestion.status === "deferred") {
				return 1;
			}

			return 0;
		}

		if (forceDeferred || suggestion.status === "deferred") {
			return 1;
		}

		return 2;
	}

	private selectPreferredSuggestionForSession(preferredSelectionId?: string | null): void {
		const session = this.store.getSession();
		if (!session) {
			return;
		}

		if (
			preferredSelectionId &&
			session.suggestions.some((suggestion) => suggestion.id === preferredSelectionId)
		) {
			this.store.selectSuggestion(preferredSelectionId);
			return;
		}

		this.store.selectSuggestion(this.findPreferredSuggestionId(session.suggestions));
	}

	private findPreferredSuggestionId(suggestions: ReviewSuggestion[]): string | null {
		for (const tier of [0, 1, 2]) {
			const match = suggestions.find((suggestion) => this.getSuggestionTraversalTier(suggestion) === tier);
			if (match) {
				return match.id;
			}
		}

		return suggestions[0]?.id ?? null;
	}

	private isSweepComplete(suggestions: ReviewSuggestion[]): boolean {
		return !suggestions.some((suggestion) => this.isSuggestionOpen(suggestion));
	}

	private isSuggestionOpen(suggestion: ReviewSuggestion): boolean {
		return suggestion.status === "pending" || suggestion.status === "deferred" || suggestion.status === "unresolved";
	}

	private setDefaultHighlightForSelection(): void {
		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			this.activeHighlightRange = null;
			return;
		}

		const target =
			getSuggestionPrimaryTarget(selectedSuggestion) && this.hasResolvedRange(getSuggestionPrimaryTarget(selectedSuggestion))
				? getSuggestionPrimaryTarget(selectedSuggestion)
				: getSuggestionAnchorTarget(selectedSuggestion);

		this.activeHighlightRange = this.hasResolvedRange(target)
			? {
					start: target?.startOffset as number,
					end: target?.endOffset as number,
				}
			: null;
		this.activeHighlightTone = "active";
	}

	private async focusEditorRange(start: number, end: number): Promise<void> {
		const context = this.getReviewNoteContext();
		if (!context) {
			return;
		}

		await this.focusReviewLeaf(context.view);
		this.activeHighlightRange = { start, end };
		this.activeHighlightTone = "active";
		const from = context.view.editor.offsetToPos(start);
		const to = context.view.editor.offsetToPos(end);
		context.view.editor.setSelection(from, to);
		context.view.editor.scrollIntoView({ from, to }, true);
		context.view.editor.focus();
		this.ensureToolbarViewportClearance(start);
		this.syncActiveEditorDecorations();
	}

	private ensureToolbarViewportClearance(start: number): void {
		const editorView = this.getActiveEditorView();
		if (!editorView) {
			return;
		}

		const coords = editorView.coordsAtPos(start);
		const scrollRect = editorView.scrollDOM.getBoundingClientRect();
		if (!coords) {
			return;
		}

		const topPadding = 110;
		const topOffset = coords.top - scrollRect.top;
		if (topOffset < topPadding) {
			editorView.scrollDOM.scrollTop -= topPadding - topOffset;
		}
		this.positionToolbarOverlay();
	}

	private async focusReviewLeaf(view: MarkdownView): Promise<void> {
		const leaf = this.app.workspace.getLeavesOfType("markdown").find((candidate) => candidate.view === view);
		if (!leaf) {
			return;
		}

		await this.app.workspace.setActiveLeaf(leaf, false, true);
		this.app.workspace.revealLeaf(leaf);
	}

	private syncToolbarOverlay(
		editorView: EditorView | null,
		toolbarState: ToolbarState | null,
		highlight: OffsetRange | null,
	): void {
		if (!editorView || !toolbarState || !highlight || highlight.end <= highlight.start) {
			this.destroyToolbarOverlay();
			return;
		}

		if (this.toolbarOverlayEditorView !== editorView) {
			if (this.toolbarOverlayEditorView) {
				this.toolbarOverlayEditorView.scrollDOM.removeEventListener("scroll", this.toolbarOverlayScrollHandler);
			}

			this.toolbarOverlayEditorView = editorView;
			this.toolbarOverlayEditorView.scrollDOM.addEventListener("scroll", this.toolbarOverlayScrollHandler, {
				passive: true,
			});
		}

		if (this.toolbarOverlayEl) {
			this.toolbarOverlayEl.remove();
		}

		this.toolbarOverlayEl = createReviewToolbarElement(this, toolbarState);
		document.body.appendChild(this.toolbarOverlayEl);
		this.positionToolbarOverlay();
	}

	private positionToolbarOverlay(): void {
		if (!this.toolbarOverlayEl || !this.toolbarOverlayEditorView || !this.activeHighlightRange) {
			return;
		}

		const coords = this.toolbarOverlayEditorView.coordsAtPos(this.activeHighlightRange.start);
		const editorRect = this.toolbarOverlayEditorView.scrollDOM.getBoundingClientRect();
		if (!coords) {
			this.toolbarOverlayEl.style.display = "none";
			return;
		}

		const toolbar = this.toolbarOverlayEl.firstElementChild as HTMLElement | null;
		const toolbarHeight = toolbar?.offsetHeight ?? 0;
		const left = editorRect.left + editorRect.width / 2;
		const top = coords.top - 50 - toolbarHeight;
		const minimumTop = editorRect.top + 8;
		const maximumTop = editorRect.bottom - 8 - toolbarHeight;
		const clampedTop = Math.min(Math.max(top, minimumTop), maximumTop);

		if (coords.bottom < editorRect.top || coords.top > editorRect.bottom) {
			this.toolbarOverlayEl.style.display = "none";
			return;
		}

		this.toolbarOverlayEl.style.display = "";
		this.toolbarOverlayEl.style.left = `${left}px`;
		this.toolbarOverlayEl.style.top = `${clampedTop}px`;
	}

	private destroyToolbarOverlay(): void {
		if (this.toolbarOverlayEditorView) {
			this.toolbarOverlayEditorView.scrollDOM.removeEventListener("scroll", this.toolbarOverlayScrollHandler);
			this.toolbarOverlayEditorView = null;
		}

		if (this.toolbarOverlayEl) {
			this.toolbarOverlayEl.remove();
			this.toolbarOverlayEl = null;
		}
	}

	private async loadPluginData(): Promise<void> {
		const savedData = (await this.loadData()) as Partial<EditorialistPluginData> | null;
		const reviewerProfiles = Array.isArray(savedData?.reviewerProfiles) ? savedData.reviewerProfiles : [];
		this.registry.load(savedData);
		this.reviewerDirectory.setProfiles(reviewerProfiles);
	}

	private async savePluginData(): Promise<void> {
		await this.saveData(this.registry.buildPluginData(this.reviewerDirectory.getProfiles()));
	}

	private async syncSceneReviewIndex(): Promise<void> {
		await this.registry.syncSceneInventory();
	}

	async openSceneNote(notePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) {
			new Notice("Scene note not found.");
			return;
		}

		const leaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(true);
		await leaf.openFile(file);
	}

	async startOrResumeReviewForNote(notePath: string): Promise<void> {
		await this.openSceneNote(notePath);
		await this.parseCurrentNote({ suppressNotice: true });
	}

	async cleanSceneReviewNote(notePath: string): Promise<void> {
		const context = this.getNoteContextByPath(notePath);
		let removedCount = 0;

		if (context) {
			const removed = removeImportedReviewBlocks(context.view.editor.getValue());
			if (removed.removedCount > 0) {
				context.view.editor.setValue(removed.text);
				removedCount = removed.removedCount;
			}
		} else {
			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (!(file instanceof TFile)) {
				new Notice("Scene note not found.");
				return;
			}
			const removed = removeImportedReviewBlocks(await this.app.vault.cachedRead(file));
			if (removed.removedCount > 0) {
				await this.app.vault.modify(file, removed.text);
				removedCount = removed.removedCount;
			}
		}

		await this.syncSceneReviewIndex();
		this.resyncSessionForActiveNote();
		new Notice(
			removedCount > 0
				? `Cleaned ${removedCount} imported review block${removedCount === 1 ? "" : "s"} from this note.`
				: "No imported review blocks were found in this note.",
		);
	}

	async cleanupSceneReviewNotes(notePaths: string[]): Promise<number> {
		let removedCount = 0;
		for (const notePath of notePaths) {
			const context = this.getNoteContextByPath(notePath);
			if (context) {
				const removed = removeImportedReviewBlocks(context.view.editor.getValue());
				if (removed.removedCount > 0) {
					context.view.editor.setValue(removed.text);
					removedCount += removed.removedCount;
				}
				continue;
			}

			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (!(file instanceof TFile)) {
				continue;
			}

			const removed = removeImportedReviewBlocks(await this.app.vault.cachedRead(file));
			if (removed.removedCount > 0) {
				await this.app.vault.modify(file, removed.text);
				removedCount += removed.removedCount;
			}
		}

		await this.syncSceneReviewIndex();
		this.resyncSessionForActiveNote();
		return removedCount;
	}

	async cleanupCompletedSceneReviewNotes(activeBookOnly = false): Promise<number> {
		const notePaths = this.getSceneReviewRecords({ activeBookOnly })
			.filter((record) => record.status === "completed")
			.map((record) => record.notePath);
		return this.cleanupSceneReviewNotes(notePaths);
	}

	async cleanupAllSceneReviewNotes(activeBookOnly = false): Promise<number> {
		const notePaths = this.getSceneReviewRecords({ activeBookOnly })
			.filter((record) => record.batchCount > 0)
			.map((record) => record.notePath);
		return this.cleanupSceneReviewNotes(notePaths);
	}

	async exportEditorialistMetadata(): Promise<string> {
		await this.syncOperationalMetadata();
		const payload: EditorialistMetadataExport = this.registry.buildMetadataExport(this.getSortedReviewerProfiles());
		const date = new Date();
		const dateLabel = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
		let targetPath = normalizePath(`editorialist-data-export-${dateLabel}.json`);
		if (await this.app.vault.adapter.exists(targetPath)) {
			const timeLabel = `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
			targetPath = normalizePath(`editorialist-data-export-${dateLabel}-${timeLabel}.json`);
		}

		await this.app.vault.create(targetPath, JSON.stringify(payload, null, 2));
		return targetPath;
	}

	private getReviewPanelWarnings(notePath: string): string[] {
		return this.registry.getReviewPanelWarnings(notePath);
	}

	private async copyReviewTemplateToClipboard(selectedText?: string): Promise<void> {
		const template = buildReviewTemplate(selectedText);
		if (!navigator.clipboard?.writeText) {
			new Notice("Clipboard access is not available in this environment.");
			return;
		}

		try {
			await navigator.clipboard.writeText(template);
			new Notice("Review template copied");
		} catch {
			new Notice("Could not copy the review template.");
		}
	}

	private async loadClipboardReviewBatch(): Promise<ClipboardReviewBatch | null> {
		if (!navigator.clipboard?.readText) {
			return null;
		}

		try {
			const rawText = await navigator.clipboard.readText();
			const normalizedText = normalizeImportedReviewText(rawText);
			if (!normalizedText) {
				return null;
			}

			const context = this.getActiveNoteContext();
			const batch = await this.importEngine.inspectBatch(normalizedText, {
				activeNotePath: context?.filePath,
			});
			await this.persistContributorProfilesIfNeeded();
			if (batch.summary.totalSuggestions === 0) {
				return null;
			}

			return {
				rawText: normalizedText,
				batch,
			};
		} catch {
			return null;
		}
	}

	private async importReviewBatch(batch: ReviewImportBatch, startReview: boolean): Promise<void> {
		const duplicateSweep = this.registry.findDuplicateSweep(batch);
		if (duplicateSweep) {
			const choice = await openEditorialistChoiceModal(this.app, {
				title: "Possible existing review batch detected",
				description: "This review batch appears to match an existing imported sweep. Open it, import again, or cancel.",
				choices: [
					{ label: "Open existing sweep", value: "open" },
					{ label: "Import anyway", value: "import" },
					{ label: "Cancel", value: "cancel" },
				],
			});
			if (choice === "open") {
				await this.workflow.openExistingSweep(duplicateSweep);
			}
			if (choice !== "import") {
				return;
			}
		}

		const importedGroups = await this.importEngine.importBatch(batch);
		if (importedGroups.length === 0) {
			new Notice("No review blocks were imported.");
			return;
		}

		await this.registry.recordImportedBatch(batch, importedGroups, "in_progress");

		if (!startReview) {
			new Notice(
				`Imported ${importedGroups.reduce((count, group) => count + group.suggestions.length, 0)} suggestions into ${importedGroups.length} note${importedGroups.length === 1 ? "" : "s"}.`,
			);
		}

		if (!startReview) {
			return;
		}

		await this.workflow.startGuidedSweep(
			batch.batchId,
			batch.createdAt,
			importedGroups.map((group) => group.filePath),
		);
	}

	private async importReviewBatchToActiveNote(rawText: string, startReview: boolean): Promise<void> {
		const context = this.getActiveNoteContext();
		if (!context) {
			new Notice("No active markdown note to import into.");
			return;
		}

		const normalizedText = normalizeImportedReviewText(rawText);
		if (!normalizedText) {
			new Notice(`No ${getReviewBlockFenceLabel()} found in the imported text.`);
			return;
		}

		const batch = await this.inspectReviewBatch(rawText, { activeNotePath: context.filePath });
		const duplicateSweep = this.registry.findDuplicateSweep(batch);
		if (duplicateSweep) {
			const choice = await openEditorialistChoiceModal(this.app, {
				title: "Possible existing review batch detected",
				description: "This review batch appears to match an existing imported sweep. Open it, import again, or cancel.",
				choices: [
					{ label: "Open existing sweep", value: "open" },
					{ label: "Import anyway", value: "import" },
					{ label: "Cancel", value: "cancel" },
				],
			});
			if (choice === "open") {
				await this.workflow.openExistingSweep(duplicateSweep);
			}
			if (choice !== "import") {
				return;
			}
		}

		const batchText = this.addImportedBlockMetadata(normalizedText, batch.batchId);

		const currentText = context.view.editor.getValue();
		const trimmedCurrentText = currentText.trimEnd();
		const trimmedBatch = batchText.trim();
		const separator = trimmedCurrentText.length > 0 ? "\n\n" : "";
		const nextText = `${trimmedCurrentText}${separator}${trimmedBatch}\n`;
		context.view.editor.setValue(nextText);
		await this.registry.recordImportedBatch(
			batch,
			[
				{
					filePath: context.filePath,
					fileName: context.view.file?.basename ?? context.filePath,
					sceneId: undefined,
					suggestions: batch.results,
					exactCount: batch.summary.totalExactMatches,
					declaredCount: batch.summary.totalDeclaredRoutes,
					inferredCount: batch.summary.totalInferredRoutes,
					exactInferredCount: batch.results.filter(
						(result) => result.routeStrategy === "inferred_exact" && result.verificationStatus === "exact",
					).length,
					advisoryCount: batch.summary.totalAdvisoryOnly,
					unresolvedCount: batch.summary.totalUnresolvedMatches,
					mismatchCount: batch.summary.totalMismatches,
					isReady: true,
				},
			],
			"in_progress",
			context.filePath,
		);

		if (startReview) {
			await this.workflow.startGuidedSweep(batch.batchId, batch.createdAt, [context.filePath]);
			return;
		}

		new Notice("Imported review block into the active note.");
	}

	private addImportedBlockMetadata(blockText: string, batchId: string): string {
		if (blockText.includes(`BatchId: ${batchId}`)) {
			return blockText;
		}

		return blockText.replace(
			new RegExp(`^\\\`\\\`\\\`${REVIEW_BLOCK_FENCE}\\s*$`, "m"),
			(match) => `${match}\nBatchId: ${batchId}\nImportedBy: Editorialist`,
		);
	}

	private async inspectReviewBatch(
		rawText: string,
		options?: Parameters<ImportEngine["inspectBatch"]>[1],
	): Promise<ReviewImportBatch> {
		const batch = await this.importEngine.inspectBatch(rawText, options);
		await this.persistContributorProfilesIfNeeded();
		return batch;
	}

	private async persistContributorProfilesIfNeeded(): Promise<void> {
		if (!this.reviewerDirectory.consumeDidChange()) {
			return;
		}

		await this.savePluginData();
	}

	async cleanupCurrentReviewBatch(): Promise<void> {
		const context = this.getReviewNoteContext() ?? this.getActiveNoteContext();
		if (!(await this.workflow.cleanupCurrentBatch(context?.text))) {
			new Notice("No imported review batch is active.");
		}
	}

	async cleanupReviewBatchById(batchId: string): Promise<void> {
		await this.cleanupReviewBatch(batchId);
	}

	async removeImportedReviewBlocksInCurrentNote(): Promise<void> {
		const context = this.getActiveNoteContext();
		if (!context) {
			new Notice("No active markdown note.");
			return;
		}

		const removed = removeImportedReviewBlocks(context.view.editor.getValue());
		if (removed.removedCount === 0) {
			new Notice("No imported Editorialist review blocks found in this note.");
			return;
		}

		context.view.editor.setValue(removed.text);
		await this.registry.syncSceneInventory();
		this.resyncSessionForActiveNote();
		new Notice(`Removed ${removed.removedCount} imported review block${removed.removedCount === 1 ? "" : "s"} from this note.`);
	}

	private async cleanupReviewBatch(batchId: string): Promise<void> {
		const entry = this.getSweepRegistryEntry(batchId);
		if (!entry) {
			new Notice("Review batch registry entry not found.");
			return;
		}

		let removedCount = 0;
		for (const notePath of entry.importedNotePaths) {
			const context = this.getNoteContextByPath(notePath);
			if (context) {
				const removed = removeImportedReviewBlocks(context.view.editor.getValue(), batchId);
				if (removed.removedCount > 0) {
					context.view.editor.setValue(removed.text);
					removedCount += removed.removedCount;
				}
				continue;
			}

			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (!(file instanceof TFile)) {
				continue;
			}

			const currentText = await this.app.vault.cachedRead(file);
			const removed = removeImportedReviewBlocks(currentText, batchId);
			if (removed.removedCount === 0) {
				continue;
			}

			await this.app.vault.modify(file, removed.text);
			removedCount += removed.removedCount;
		}

		await this.registry.updateSweepRegistry(
			batchId,
			{
				status: "cleaned",
				cleanedAt: Date.now(),
			},
			{ persist: false },
		);
		if (this.getGuidedSweep()?.batchId === batchId) {
			this.store.setGuidedSweep(null);
		}
		await this.registry.syncSceneInventory();
		this.resyncSessionForActiveNote();
		new Notice(
			removedCount > 0
				? `Cleaned ${removedCount} imported review block${removedCount === 1 ? "" : "s"}.`
				: "No imported review blocks were found for this batch.",
		);
	}
}
