import type { EditorView } from "@codemirror/view";
import { MarkdownView, normalizePath, Notice, Plugin, TFile, type App } from "obsidian";
import { registerCommands } from "./commands/Commands";
import {
	deriveContributorIdentitySeed,
	getLegacyContributorSignatureKind,
} from "./core/ContributorIdentity";
import { ImportEngine } from "./core/ImportEngine";
import { MatchEngine } from "./core/MatchEngine";
import {
	canApplySuggestionDirectly,
	createSuggestionApplyPlan,
	getSuggestionAnchorTarget,
	getSuggestionPrimaryTarget,
	getSuggestionSignatureParts,
	isSuggestionResolved,
} from "./core/OperationSupport";
import {
	findImportedReviewBlocks,
	REVIEW_BLOCK_FENCE,
	getReviewBlockFenceLabel,
	normalizeImportedReviewText,
	noteContainsReviewBlock,
	removeImportedReviewBlocks,
} from "./core/ReviewBlockFormat";
import { ReviewEngine } from "./core/ReviewEngine";
import { SuggestionParser } from "./core/SuggestionParser";
import type {
	EditorialistMetadataExport,
	ReviewImportBatch,
	ReviewImportNoteGroup,
	ReviewSweepRegistryEntry,
	ReviewSweepStatus,
} from "./models/ReviewImport";
import type { ReviewSession, ReviewSuggestion, ReviewTargetRef } from "./models/ReviewSuggestion";
import type {
	EditorialistPluginData,
	ParsedReviewerReference,
	PersistedReviewDecisionRecord,
	ReviewerProfile,
	ReviewerResolutionStatus,
	ReviewerSignalRecord,
	SceneReviewRecord,
	ReviewerStats,
} from "./models/ReviewerProfile";
import { ReviewStore, type GuidedSweepState } from "./state/ReviewStore";
import { ReviewerDirectory } from "./state/ReviewerDirectory";
import { EditorialistModal, type ClipboardReviewBatch } from "./ui/EditorialistModal";
import { openEditorialistChoiceModal } from "./ui/EditorialistChoiceModal";
import { buildReviewTemplate } from "./ui/PrepareReviewFormatModal";
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
	private importEngine!: ImportEngine;
	private isGuidedSweepTransitioning = false;
	private radialTimelineActiveBookLabel: string | null = null;
	private radialTimelineActiveBookSourceFolder: string | null = null;

	private activeHighlightRange: OffsetRange | null = null;
	private activeHighlightTone: "active" | "applied" = "active";
	private deferredSuggestionIds = new Set<string>();
	private lastAppliedChange: LastAppliedChange | null = null;
	private pluginData: EditorialistPluginData = {
		reviewerProfiles: [],
		reviewerSignalIndex: {},
		reviewDecisionIndex: {},
		sceneReviewIndex: {},
		sweepRegistry: {},
	};
	private toolbarOverlayEl: HTMLElement | null = null;
	private toolbarOverlayEditorView: EditorView | null = null;
	private readonly toolbarOverlayScrollHandler = (): void => {
		this.positionToolbarOverlay();
	};

	async onload(): Promise<void> {
		await this.loadPluginData();
		await this.persistContributorProfilesIfNeeded();
		await this.refreshRadialTimelineBookScope();
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
				if (this.isGuidedSweepTransitioning) {
					return;
				}
				this.resyncSessionForActiveNote();
				this.syncActiveEditorDecorations();
			}),
		);

		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				if (this.isGuidedSweepTransitioning) {
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
		const hydratedSession = this.applyPersistedReviewDecisionsToSession(session);
		await this.persistContributorProfilesIfNeeded();

		if (!hydratedSession.hasReviewBlock) {
			this.activeHighlightRange = null;
			this.activeHighlightTone = "active";
			this.deferredSuggestionIds.clear();
			this.lastAppliedChange = null;
			this.store.clearSession();
			if (!suppressNotice) {
				new Notice(`No ${getReviewBlockFenceLabel()} found in this note.`);
			}
			return;
		}

		this.store.setSession(hydratedSession, preferredSelectionId);
		this.restoreDeferredSuggestionsForSession(hydratedSession);
		this.selectPreferredSuggestionForSession(preferredSelectionId);
		this.store.updateGuidedSweepCurrentNote(context.filePath);
		this.pruneDeferredSuggestions();
		await this.syncReviewerSignalsForSession(hydratedSession);
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
			await this.advanceGuidedSweepToNextScene();
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

	async acceptSelectedSuggestion(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		await this.acceptSuggestion(selectedSuggestion.id);
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

	laterSelectedSuggestion(): void {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		void this.laterSuggestion(selectedSuggestion.id);
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

	async acceptSuggestion(id: string): Promise<void> {
		const context = this.getReviewNoteContext();
		const session = this.store.getSession();
		const suggestion = this.getSuggestionById(id);

		if (!context || !session || session.notePath !== context.filePath || !suggestion) {
			new Notice("The active note does not match the current review session.");
			return;
		}

		if (!this.canAcceptSuggestion(id)) {
			new Notice("This suggestion cannot be safely accepted yet.");
			return;
		}

		const applyPlan = createSuggestionApplyPlan(context.text, suggestion);
		if (!applyPlan) {
			new Notice(`The ${suggestion.operation} suggestion could not be applied safely.`);
			return;
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

		this.deferredSuggestionIds.delete(suggestion.id);
		await this.clearPersistedReviewDecision(context.filePath, suggestion);
		this.refreshSessionAfterAcceptedEdit(session, suggestion.id);
		await this.syncReviewerSignalsForSession(this.store.getSession());
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
		await this.syncSceneReviewIndex();
	}

	async rejectSuggestion(id: string): Promise<void> {
		if (!this.canRejectSuggestion(id)) {
			return;
		}

		const session = this.getReviewSession();
		const suggestion = this.getSuggestionById(id);
		if (session && suggestion) {
			await this.persistReviewDecision(session.notePath, suggestion, "rejected");
		}

		const nextSuggestionId = this.getAdjacentRevealableSuggestionId("next", id);
		this.store.updateSuggestionStatus(id, "rejected");
		this.deferredSuggestionIds.delete(id);
		await this.syncSceneReviewIndex();
		await this.syncReviewerSignalsForSession(this.store.getSession());
		if (nextSuggestionId) {
			this.store.selectSuggestion(nextSuggestionId);
			await this.revealSelectedSuggestion();
			return;
		}

		await this.advanceGuidedSweepToNextScene();
	}

	async laterSuggestion(id: string): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const session = this.getReviewSession();
		const suggestion = this.getSuggestionById(id);
		if (session && suggestion) {
			await this.persistReviewDecision(session.notePath, suggestion, "later");
		}

		const nextSuggestionId = this.getAdjacentRevealableSuggestionId("next", id, true);
		this.deferredSuggestionIds.add(id);
		await this.syncSceneReviewIndex();
		await this.syncReviewerSignalsForSession(this.store.getSession());
		if (nextSuggestionId) {
			this.store.selectSuggestion(nextSuggestionId);
			await this.revealSelectedSuggestion();
			return;
		}

		await this.advanceGuidedSweepToNextScene();
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
			await this.clearPersistedReviewDecision(change.notePath, appliedSuggestion);
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
		return Object.values(this.pluginData.sweepRegistry).sort((left, right) => right.updatedAt - left.updatedAt);
	}

	getSceneReviewRecords(options?: { activeBookOnly?: boolean }): SceneReviewRecord[] {
		const records = Object.values(this.pluginData.sceneReviewIndex).sort((left, right) => {
			if (left.status !== right.status) {
				return this.getSceneReviewStatusRank(left.status) - this.getSceneReviewStatusRank(right.status);
			}

			return right.lastUpdated - left.lastUpdated;
		});

		if (options?.activeBookOnly && this.radialTimelineActiveBookSourceFolder) {
			return records.filter((record) => this.isPathInFolderScope(record.notePath, this.radialTimelineActiveBookSourceFolder as string));
		}

		return records;
	}

	getActiveBookScopeInfo(): { label: string | null; sourceFolder: string | null } {
		return {
			label: this.radialTimelineActiveBookLabel,
			sourceFolder: this.radialTimelineActiveBookSourceFolder,
		};
	}

	async syncOperationalMetadata(): Promise<void> {
		await this.refreshRadialTimelineBookScope();
		await this.syncSceneReviewIndex();
	}

	getReviewActivitySummary(): {
		accepted: number;
		cleanedUpSweeps: number;
		completedSweeps: number;
		deferred: number;
		processed: number;
		inProgressSweeps: number;
		rejected: number;
		totalSuggestions: number;
		totalSweeps: number;
		unresolved: number;
	} {
		const sceneTotals = this.getSceneReviewRecords().reduce(
			(totals, record) => {
				totals.totalSuggestions += record.pendingCount + record.deferredCount + record.resolvedCount + record.rejectedCount;
				totals.accepted += record.resolvedCount;
				totals.deferred += record.deferredCount;
				totals.rejected += record.rejectedCount;
				totals.unresolved += record.pendingCount;
				return totals;
			},
			{
				totalSuggestions: 0,
				accepted: 0,
				deferred: 0,
				rejected: 0,
				unresolved: 0,
			},
		);
		const reviewerTotals = this.getReviewerProfiles().reduce(
			(totals, profile) => {
				totals.totalSuggestions += profile.stats?.totalSuggestions ?? 0;
				totals.accepted += profile.stats?.accepted ?? 0;
				totals.deferred += profile.stats?.deferred ?? 0;
				totals.rejected += profile.stats?.rejected ?? 0;
				totals.unresolved += profile.stats?.unresolved ?? 0;
				return totals;
			},
			{
				totalSuggestions: 0,
				accepted: 0,
				deferred: 0,
				rejected: 0,
				unresolved: 0,
			},
		);
		const entries = this.getSweepRegistryEntries();
		const totals = sceneTotals.totalSuggestions > 0 ? sceneTotals : reviewerTotals;

		return {
			...totals,
			processed: Math.max(0, totals.totalSuggestions - totals.unresolved),
			totalSweeps: entries.length,
			inProgressSweeps: entries.filter((entry) => entry.status === "in_progress").length,
			completedSweeps: entries.filter((entry) => entry.status === "completed").length,
			cleanedUpSweeps: entries.filter((entry) => entry.status === "cleaned_up").length,
		};
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

	async clearCleanedUpSweepRecords(): Promise<number> {
		const nextRegistry = Object.fromEntries(
			Object.entries(this.pluginData.sweepRegistry).filter(([, entry]) => entry.status !== "cleaned_up"),
		);
		const removedCount = Object.keys(this.pluginData.sweepRegistry).length - Object.keys(nextRegistry).length;
		if (removedCount === 0) {
			return 0;
		}

		this.pluginData.sweepRegistry = nextRegistry;
		await this.savePluginData();
		return removedCount;
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

	canLaterSuggestion(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		return Boolean(suggestion && suggestion.status !== "accepted" && suggestion.status !== "rejected");
	}

	canLaterSelectedSuggestion(): boolean {
		const selected = this.store.getSelectedSuggestion();
		return selected ? this.canLaterSuggestion(selected.id) : false;
	}

	canUndoLastAppliedSuggestion(): boolean {
		const context = this.getReviewNoteContext();
		return Boolean(this.lastAppliedChange && context && context.filePath === this.lastAppliedChange.notePath);
	}

	isSuggestionDeferred(id: string): boolean {
		return this.deferredSuggestionIds.has(id);
	}

	getSuggestionPresentationState(
		suggestion: ReviewSuggestion,
	): "pending" | "later" | "resolved" | "accepted" | "rejected" | "unresolved" {
		if (suggestion.status === "accepted") {
			return "accepted";
		}

		if (suggestion.status === "rejected") {
			return "rejected";
		}

		if (isSuggestionResolved(suggestion)) {
			return "resolved";
		}

		if (this.deferredSuggestionIds.has(suggestion.id)) {
			return "later";
		}

		return suggestion.status;
	}

	getSuggestionPresentationRank(suggestion: ReviewSuggestion): number {
		switch (this.getSuggestionPresentationState(suggestion)) {
			case "pending":
			case "unresolved":
				return 0;
			case "later":
				return 1;
			case "resolved":
				return 2;
			case "accepted":
				return 3;
			case "rejected":
				return 4;
		}
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
		const unresolvedCount = suggestions.filter(
			(suggestion) => suggestion.status === "unresolved" && !isSuggestionResolved(suggestion),
		).length;
		const resolvedCount = suggestions.filter(
			(suggestion) => suggestion.status !== "rejected" && isSuggestionResolved(suggestion),
		).length;
		const guidedSweep = this.getGuidedSweep();
		const sceneProgressLabel =
			guidedSweep && guidedSweep.notePaths.length > 1
				? `scene ${guidedSweep.currentNoteIndex + 1} of ${guidedSweep.notePaths.length}`
				: undefined;

		return {
			hasReviewBlock,
			completionLabel: this.isSweepComplete(suggestions) ? "sweep complete" : undefined,
			pendingCount,
			resolvedCount,
			sceneProgressLabel,
			selectedIndexLabel:
				selectedIndex === -1 ? `${suggestions.length} total` : `${selectedIndex + 1} of ${suggestions.length}`,
			unresolvedCount,
			canApply: this.canAcceptSelectedSuggestion(),
			canLater: this.canLaterSelectedSuggestion(),
			canNext: this.getAdjacentRevealableSuggestionId("next") !== null,
			canPrevious: this.getAdjacentRevealableSuggestionId("previous") !== null,
			canReject: this.canRejectSelectedSuggestion(),
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
			this.deferredSuggestionIds.clear();
			this.lastAppliedChange = null;
			return;
		}

		const refreshedSession = this.reviewEngine.buildSession(context.filePath, context.text, session);
		const hydratedSession = this.applyPersistedReviewDecisionsToSession(refreshedSession);
		void this.persistContributorProfilesIfNeeded();
		if (!hydratedSession.hasReviewBlock) {
			this.activeHighlightRange = null;
			this.activeHighlightTone = "active";
			this.deferredSuggestionIds.clear();
			this.lastAppliedChange = null;
			this.store.clearSession();
			return;
		}

		const preferredSelectionId = this.store.getState().selectedSuggestionId;
		this.store.setSession(hydratedSession, preferredSelectionId);
		this.restoreDeferredSuggestionsForSession(hydratedSession);
		this.selectPreferredSuggestionForSession(preferredSelectionId);
		this.store.updateGuidedSweepCurrentNote(context.filePath);
		this.pruneDeferredSuggestions();
		void this.syncReviewerSignalsForSession(hydratedSession);
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
		await this.syncReviewerSignalsForSession(this.store.getSession());
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

	private async syncReviewerSignalsForSession(session: ReviewSession | null): Promise<void> {
		if (!session) {
			return;
		}

		let didChange = false;
		const nextIndex = {
			...this.pluginData.reviewerSignalIndex,
		};

		for (const suggestion of session.suggestions) {
			const key = this.createReviewerSignalKey(session.notePath, suggestion);
			const existingRecord = nextIndex[key];
			const desiredRecord = this.createReviewerSignalRecord(key, suggestion);

			if (this.sameReviewerSignalRecord(existingRecord, desiredRecord)) {
				continue;
			}

			if (existingRecord) {
				this.applyReviewerSignalDelta(existingRecord, -1);
				delete nextIndex[key];
				didChange = true;
			}

			if (desiredRecord) {
				this.applyReviewerSignalDelta(desiredRecord, 1);
				nextIndex[key] = desiredRecord;
				didChange = true;
			}
		}

		if (didChange) {
			this.pluginData.reviewerSignalIndex = nextIndex;
			await this.savePluginData();
			this.refreshReviewPanel();
		}
	}

	private createReviewerSignalKey(notePath: string, suggestion: ReviewSuggestion): string {
		return [
			notePath,
			suggestion.source.blockIndex,
			suggestion.source.entryIndex,
			suggestion.operation,
			suggestion.executionMode,
			...getSuggestionSignatureParts(suggestion),
		].join("::");
	}

	private createReviewerSignalRecord(key: string, suggestion: ReviewSuggestion): ReviewerSignalRecord | null {
		const reviewerId = suggestion.contributor.reviewerId;
		if (!reviewerId) {
			return null;
		}

		const presentationState = this.getSuggestionPresentationState(suggestion);

		return {
			key,
			reviewerId,
			status:
				presentationState === "accepted" || presentationState === "resolved"
					? "accepted"
					: presentationState === "rejected"
						? "rejected"
						: presentationState === "later"
							? "deferred"
							: "unresolved",
			operation: suggestion.operation,
		};
	}

	private sameReviewerSignalRecord(
		left: ReviewerSignalRecord | undefined,
		right: ReviewerSignalRecord | null,
	): boolean {
		if (!left && !right) {
			return true;
		}

		if (!left || !right) {
			return false;
		}

		return (
			left.key === right.key &&
			left.reviewerId === right.reviewerId &&
			left.status === right.status &&
			left.operation === right.operation
		);
	}

	private applyReviewerSignalDelta(record: ReviewerSignalRecord, direction: 1 | -1): void {
		const profile = this.reviewerDirectory.getProfileById(record.reviewerId);
		if (!profile) {
			return;
		}

		const stats = {
			totalSuggestions: profile.stats?.totalSuggestions ?? 0,
			accepted: profile.stats?.accepted ?? 0,
			deferred: profile.stats?.deferred ?? 0,
			rejected: profile.stats?.rejected ?? 0,
			unresolved: profile.stats?.unresolved ?? 0,
			acceptedEdits: profile.stats?.acceptedEdits ?? 0,
			acceptedMoves: profile.stats?.acceptedMoves ?? 0,
		};

		stats.totalSuggestions = Math.max(0, stats.totalSuggestions + direction);
		if (record.status === "accepted") {
			stats.accepted = Math.max(0, stats.accepted + direction);
			if (record.operation === "move") {
				stats.acceptedMoves = Math.max(0, (stats.acceptedMoves ?? 0) + direction);
			} else if (record.operation === "edit" || record.operation === "cut" || record.operation === "condense") {
				stats.acceptedEdits = Math.max(0, (stats.acceptedEdits ?? 0) + direction);
			}
		} else if (record.status === "rejected") {
			stats.rejected = Math.max(0, stats.rejected + direction);
		} else if (record.status === "deferred") {
			stats.deferred = Math.max(0, stats.deferred + direction);
		} else {
			stats.unresolved = Math.max(0, stats.unresolved + direction);
		}

		this.reviewerDirectory.setStats(record.reviewerId, stats);
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
		if (!batchId) {
			return null;
		}

		return this.pluginData.sweepRegistry[batchId] ?? null;
	}

	private getCurrentBatchId(): string | null {
		const guidedSweep = this.getGuidedSweep();
		if (guidedSweep) {
			return guidedSweep.batchId;
		}

		const context = this.getReviewNoteContext() ?? this.getActiveNoteContext();
		if (!context) {
			return null;
		}

		return findImportedReviewBlocks(context.text)[0]?.batchId ?? null;
	}

	private hasLiveActionableSuggestions(session: ReviewSession): boolean {
		return session.suggestions.some((suggestion) => {
			const tier = this.getSuggestionTraversalTier(suggestion);
			return tier === 0 || tier === 1;
		});
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
		if (suggestion.status === "accepted" || suggestion.status === "rejected") {
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
		if (!this.canRevealSuggestionInManuscript(suggestion)) {
			return null;
		}

		if (isSuggestionResolved(suggestion)) {
			return 2;
		}

		if (forceDeferred || this.deferredSuggestionIds.has(suggestion.id)) {
			return 1;
		}

		return 0;
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
		return !suggestions.some((suggestion) => {
			const tier = this.getSuggestionTraversalTier(suggestion);
			return tier === 0 || tier === 1;
		});
	}

	private pruneDeferredSuggestions(): void {
		const session = this.store.getSession();
		if (!session) {
			this.deferredSuggestionIds.clear();
			return;
		}

		const validSuggestionIds = new Set(session.suggestions.map((suggestion) => suggestion.id));
		for (const suggestionId of [...this.deferredSuggestionIds]) {
			if (!validSuggestionIds.has(suggestionId)) {
				this.deferredSuggestionIds.delete(suggestionId);
			}
		}
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

	private applyPersistedReviewDecisionsToSession(session: ReviewSession): ReviewSession {
		return {
			...session,
			suggestions: session.suggestions.map((suggestion) => {
				const record = this.pluginData.reviewDecisionIndex[this.createPersistedReviewDecisionKey(session.notePath, suggestion)];
				if (!record || record.status === "later") {
					return suggestion;
				}

				return {
					...suggestion,
					status: record.status,
				};
			}),
		};
	}

	private restoreDeferredSuggestionsForSession(session: ReviewSession): void {
		this.deferredSuggestionIds.clear();
		for (const suggestion of session.suggestions) {
			const record = this.pluginData.reviewDecisionIndex[this.createPersistedReviewDecisionKey(session.notePath, suggestion)];
			if (record?.status === "later" && suggestion.status !== "accepted" && suggestion.status !== "rejected" && !isSuggestionResolved(suggestion)) {
				this.deferredSuggestionIds.add(suggestion.id);
			}
		}
	}

	private async persistReviewDecision(
		notePath: string,
		suggestion: ReviewSuggestion,
		status: PersistedReviewDecisionRecord["status"],
	): Promise<void> {
		const key = this.createPersistedReviewDecisionKey(notePath, suggestion);
		this.pluginData.reviewDecisionIndex[key] = {
			key,
			status,
			updatedAt: Date.now(),
		};
		await this.savePluginData();
	}

	private async clearPersistedReviewDecision(notePath: string, suggestion: ReviewSuggestion): Promise<void> {
		const key = this.createPersistedReviewDecisionKey(notePath, suggestion);
		if (!this.pluginData.reviewDecisionIndex[key]) {
			return;
		}

		delete this.pluginData.reviewDecisionIndex[key];
		await this.savePluginData();
	}

	private createPersistedReviewDecisionKey(notePath: string, suggestion: ReviewSuggestion): string {
		return [
			notePath,
			suggestion.operation,
			suggestion.executionMode,
			suggestion.contributor.displayName,
			getLegacyContributorSignatureKind(suggestion.contributor),
			...getSuggestionSignatureParts(suggestion),
			suggestion.why ?? "",
		].join("::");
	}

	private async loadPluginData(): Promise<void> {
		const savedData = (await this.loadData()) as Partial<EditorialistPluginData> | null;
		this.pluginData = {
			reviewerProfiles: Array.isArray(savedData?.reviewerProfiles) ? savedData?.reviewerProfiles : [],
			reviewerSignalIndex:
				savedData?.reviewerSignalIndex && typeof savedData.reviewerSignalIndex === "object"
					? savedData.reviewerSignalIndex
					: {},
			reviewDecisionIndex:
				savedData?.reviewDecisionIndex && typeof savedData.reviewDecisionIndex === "object"
					? savedData.reviewDecisionIndex
					: {},
			sceneReviewIndex:
				savedData?.sceneReviewIndex && typeof savedData.sceneReviewIndex === "object"
					? savedData.sceneReviewIndex
					: {},
			sweepRegistry:
				savedData?.sweepRegistry && typeof savedData.sweepRegistry === "object"
					? savedData.sweepRegistry
					: {},
		};
		this.reviewerDirectory.setProfiles(this.pluginData.reviewerProfiles);
	}

	private async refreshRadialTimelineBookScope(): Promise<void> {
		try {
			const radialDataPath = normalizePath(`${this.app.vault.configDir}/plugins/radial-timeline/data.json`);
			if (!(await this.app.vault.adapter.exists(radialDataPath))) {
				this.radialTimelineActiveBookLabel = null;
				this.radialTimelineActiveBookSourceFolder = null;
				return;
			}

			const raw = await this.app.vault.adapter.read(radialDataPath);
			const parsed = JSON.parse(raw) as {
				activeBookId?: string;
				books?: Array<{ id?: string; name?: string; title?: string; sourceFolder?: string }>;
			};
			const books = Array.isArray(parsed.books) ? parsed.books : [];
			const activeBook = books.find((book) => book.id === parsed.activeBookId) ?? books[0];
			const sourceFolder = activeBook?.sourceFolder?.trim();
			const activeBookLabel = activeBook?.title?.trim() || activeBook?.name?.trim() || activeBook?.id?.trim() || null;
			this.radialTimelineActiveBookLabel = activeBookLabel;
			this.radialTimelineActiveBookSourceFolder = sourceFolder ? normalizePath(sourceFolder) : null;
		} catch {
			this.radialTimelineActiveBookLabel = null;
			this.radialTimelineActiveBookSourceFolder = null;
		}
	}

	private async savePluginData(): Promise<void> {
		this.pluginData = {
			reviewerProfiles: this.reviewerDirectory.getProfiles(),
			reviewerSignalIndex: this.pluginData.reviewerSignalIndex,
			reviewDecisionIndex: this.pluginData.reviewDecisionIndex,
			sceneReviewIndex: this.pluginData.sceneReviewIndex,
			sweepRegistry: this.pluginData.sweepRegistry,
		};
		await this.saveData(this.pluginData);
	}

	private async syncSceneReviewIndex(): Promise<void> {
		const nextIndex: Record<string, SceneReviewRecord> = {};
		const batchPresence = new Map<string, Set<string>>();
		const now = Date.now();

		for (const file of this.app.vault.getMarkdownFiles()) {
			const noteText = this.getNoteContextByPath(file.path)?.view.editor.getValue() ?? (await this.app.vault.cachedRead(file));
			const importedBlocks = findImportedReviewBlocks(noteText);
			if (importedBlocks.length === 0) {
				continue;
			}

			const batchIds = [...new Set(importedBlocks.map((block) => block.batchId).filter((value): value is string => Boolean(value)))];
			for (const batchId of batchIds) {
				const paths = batchPresence.get(batchId) ?? new Set<string>();
				paths.add(file.path);
				batchPresence.set(batchId, paths);
			}

			const session = this.applyPersistedReviewDecisionsToSession(this.reviewEngine.buildSession(file.path, noteText, null));
			const deferredIds = this.getDeferredSuggestionIdsForSession(session);
			let pendingCount = 0;
			let deferredCount = 0;
			let resolvedCount = 0;
			let rejectedCount = 0;
			let lastDecisionAt = 0;

			for (const suggestion of session.suggestions) {
				const record = this.pluginData.reviewDecisionIndex[this.createPersistedReviewDecisionKey(file.path, suggestion)];
				if (record?.updatedAt) {
					lastDecisionAt = Math.max(lastDecisionAt, record.updatedAt);
				}

				if (deferredIds.has(suggestion.id)) {
					deferredCount += 1;
					continue;
				}

				if (suggestion.status === "rejected") {
					rejectedCount += 1;
					continue;
				}

				if (suggestion.status === "accepted" || isSuggestionResolved(suggestion)) {
					resolvedCount += 1;
					continue;
				}

				pendingCount += 1;
			}

			const status =
				pendingCount === 0 && deferredCount === 0
					? "completed"
					: resolvedCount === 0 && rejectedCount === 0 && deferredCount === 0
						? "not_started"
						: "in_progress";

			nextIndex[file.path] = {
				sceneId: this.getSceneIdForPath(file.path),
				notePath: file.path,
				noteTitle: file.basename,
				bookLabel: this.getBookHintForPath(file.path),
				batchIds,
				batchCount: batchIds.length,
				pendingCount,
				deferredCount,
				resolvedCount,
				rejectedCount,
				status,
				lastUpdated: Math.max(file.stat.mtime, lastDecisionAt),
			};
		}

		for (const existing of Object.values(this.pluginData.sceneReviewIndex)) {
			if (nextIndex[existing.notePath]) {
				continue;
			}

			nextIndex[existing.notePath] = {
				...existing,
				batchIds: [],
				batchCount: 0,
				pendingCount: 0,
				deferredCount: 0,
				resolvedCount: 0,
				rejectedCount: 0,
				status: "cleaned",
				cleanedAt: existing.cleanedAt ?? now,
				lastUpdated: existing.cleanedAt ?? now,
			};
		}

		this.pluginData.sceneReviewIndex = nextIndex;
		this.reconcileSweepRegistryWithSceneInventory(batchPresence, now);
		await this.savePluginData();
	}

	private reconcileSweepRegistryWithSceneInventory(batchPresence: Map<string, Set<string>>, now: number): void {
		const nextRegistry: Record<string, ReviewSweepRegistryEntry> = {};
		for (const entry of Object.values(this.pluginData.sweepRegistry)) {
			const currentPaths = [...(batchPresence.get(entry.batchId) ?? new Set<string>())].sort();
			const sceneOrder = entry.sceneOrder.filter((path) => currentPaths.includes(path));
			const nextSceneOrder = sceneOrder.length > 0 ? sceneOrder : currentPaths;
			const currentNotePath = entry.currentNotePath && currentPaths.includes(entry.currentNotePath)
				? entry.currentNotePath
				: nextSceneOrder[0];

			nextRegistry[entry.batchId] = {
				...entry,
				activeBookLabel: entry.activeBookLabel ?? this.radialTimelineActiveBookLabel ?? undefined,
				activeBookSourceFolder: entry.activeBookSourceFolder ?? this.radialTimelineActiveBookSourceFolder ?? undefined,
				cleanedAt: currentPaths.length === 0 ? entry.cleanedAt ?? now : undefined,
				importedNotePaths: currentPaths,
				currentNotePath,
				sceneOrder: nextSceneOrder,
				status: currentPaths.length === 0 ? "cleaned_up" : entry.status,
				updatedAt: now,
			};
		}

		this.pluginData.sweepRegistry = nextRegistry;
	}

	private getDeferredSuggestionIdsForSession(session: ReviewSession): Set<string> {
		const ids = new Set<string>();
		for (const suggestion of session.suggestions) {
			const record = this.pluginData.reviewDecisionIndex[this.createPersistedReviewDecisionKey(session.notePath, suggestion)];
			if (record?.status === "later") {
				ids.add(suggestion.id);
			}
		}

		return ids;
	}

	private getSceneIdForPath(notePath: string): string | undefined {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) {
			return undefined;
		}

		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		const values = this.getFrontmatterStringValues(frontmatter, ["id", "ID", "sceneid", "SceneId"]);
		return values[0]?.trim() || undefined;
	}

	private getBookHintForPath(notePath: string): string | undefined {
		if (
			this.radialTimelineActiveBookLabel &&
			this.radialTimelineActiveBookSourceFolder &&
			this.isPathInFolderScope(notePath, this.radialTimelineActiveBookSourceFolder)
		) {
			return this.radialTimelineActiveBookLabel;
		}

		const normalizedPath = normalizePath(notePath);
		const segments = normalizedPath.split("/");
		return segments.length > 1 ? segments.slice(0, -1).join("/") : undefined;
	}

	private getSceneReviewStatusRank(status: SceneReviewRecord["status"]): number {
		switch (status) {
			case "in_progress":
				return 0;
			case "not_started":
				return 1;
			case "completed":
				return 2;
			case "cleaned":
				return 3;
		}
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
		const payload: EditorialistMetadataExport = {
			schemaVersion: "2.0.0",
			exportedAt: Date.now(),
			contributors: this.getSortedReviewerProfiles().map((profile) => ({
				createdAt: profile.createdAt,
				displayName: profile.displayName,
				id: profile.id,
				kind: profile.kind,
				reviewerType: profile.reviewerType,
				aliases: [...profile.aliases],
				isStarred: profile.isStarred,
				model: profile.model,
				provider: profile.provider,
				stats: profile.stats ? { ...profile.stats } : undefined,
				updatedAt: profile.updatedAt,
			})),
			scenes: this.getSceneReviewRecords().map((record) => ({ ...record, batchIds: [...record.batchIds] })),
			sweeps: this.getSweepRegistryEntries().map((entry) => ({
				...entry,
				importedNotePaths: [...entry.importedNotePaths],
				sceneOrder: [...entry.sceneOrder],
			})),
		};
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
		const warnings: string[] = [];
		if (!this.isSceneClassNote(notePath)) {
			warnings.push("Warning: current note is not a scene.");
		}

		if (
			this.radialTimelineActiveBookSourceFolder &&
			!this.isPathInFolderScope(notePath, this.radialTimelineActiveBookSourceFolder)
		) {
			const activeBookLabel = this.radialTimelineActiveBookLabel ?? "the active book";
			warnings.push(`Warning: current note is outside the active book, ${activeBookLabel}.`);
		}

		if (/(^|\/)(exports?|archives?|drafts?|revisions?)(\/|$)/i.test(notePath)) {
			warnings.push("Warning: current note appears to be an export, archive, draft, or revision note.");
		}

		return warnings;
	}

	private isSceneClassNote(notePath: string): boolean {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) {
			return false;
		}

		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const classValues = this.getFrontmatterStringValues(frontmatter, ["class", "Class", "classes", "Classes"]);

		return classValues.some((value) => typeof value === "string" && value.trim().toLowerCase() === "scene");
	}

	private getFrontmatterStringValues(frontmatter: Record<string, unknown> | undefined, keys: string[]): string[] {
		if (!frontmatter) {
			return [];
		}

		return keys.flatMap((key) => {
			const value = frontmatter[key];
			if (Array.isArray(value)) {
				return value.filter((item): item is string => typeof item === "string");
			}
			return typeof value === "string" ? [value] : [];
		});
	}

	private isPathInFolderScope(filePath: string, scopeRoot: string): boolean {
		const normalizedScopeRoot = normalizePath(scopeRoot);
		const normalizedFilePath = normalizePath(filePath);
		if (!normalizedScopeRoot) {
			return !normalizedFilePath.includes("/");
		}

		return normalizedFilePath === normalizedScopeRoot || normalizedFilePath.startsWith(`${normalizedScopeRoot}/`);
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
		const duplicateSweep = this.findDuplicateSweep(batch);
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
				await this.openExistingSweep(duplicateSweep);
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

		await this.recordImportedBatch(batch, importedGroups, startReview ? "in_progress" : "imported");

		if (!startReview) {
			new Notice(
				`Imported ${importedGroups.reduce((count, group) => count + group.suggestions.length, 0)} suggestions into ${importedGroups.length} note${importedGroups.length === 1 ? "" : "s"}.`,
			);
		}

		if (!startReview) {
			return;
		}

		await this.startGuidedSweep(batch, importedGroups);
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
		const duplicateSweep = this.findDuplicateSweep(batch);
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
				await this.openExistingSweep(duplicateSweep);
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
		await this.recordImportedBatch(batch, [{
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
		}], startReview ? "in_progress" : "imported");

		if (startReview) {
			this.store.setGuidedSweep({
				batchId: batch.batchId,
				currentNoteIndex: 0,
				notePaths: [context.filePath],
				startedAt: Date.now(),
			});
			await this.parseCurrentNote({ suppressNotice: true });
			return;
		}

		new Notice("Imported review block into the active note.");
	}

	private findDuplicateSweep(batch: ReviewImportBatch): ReviewSweepRegistryEntry | null {
		return (
			Object.values(this.pluginData.sweepRegistry).find(
				(entry) => entry.contentHash === batch.contentHash && entry.status !== "cleaned_up",
			) ?? null
		);
	}

	private async recordImportedBatch(
		batch: ReviewImportBatch,
		importedGroups: ReviewImportNoteGroup[],
		status: ReviewSweepStatus,
		currentNotePath?: string,
	): Promise<void> {
		const now = Date.now();
		this.pluginData.sweepRegistry[batch.batchId] = {
			activeBookLabel: this.radialTimelineActiveBookLabel ?? undefined,
			activeBookSourceFolder: this.radialTimelineActiveBookSourceFolder ?? undefined,
			batchId: batch.batchId,
			contentHash: batch.contentHash,
			importedAt: batch.createdAt,
			importedNotePaths: importedGroups.map((group) => group.filePath),
			currentNotePath: currentNotePath ?? importedGroups[0]?.filePath,
			sceneOrder: importedGroups.map((group) => group.filePath),
			status,
			totalSuggestions: batch.summary.totalSuggestions,
			updatedAt: now,
		};
		await this.syncSceneReviewIndex();
	}

	private async updateSweepRegistry(
		batchId: string,
		updates: Partial<ReviewSweepRegistryEntry>,
	): Promise<void> {
		const existing = this.pluginData.sweepRegistry[batchId];
		if (!existing) {
			return;
		}

		this.pluginData.sweepRegistry[batchId] = {
			...existing,
			...updates,
			updatedAt: Date.now(),
		};
		await this.savePluginData();
	}

	private async openExistingSweep(entry: ReviewSweepRegistryEntry): Promise<void> {
		const notePaths = entry.sceneOrder.length > 0 ? entry.sceneOrder : entry.importedNotePaths;
		this.store.setGuidedSweep({
			batchId: entry.batchId,
			currentNoteIndex: Math.max(0, notePaths.findIndex((path) => path === entry.currentNotePath)),
			notePaths,
			startedAt: entry.importedAt,
		});

		const targetPath = entry.currentNotePath ?? notePaths[0];
		if (!targetPath) {
			return;
		}

		await this.openSweepNote(targetPath);
	}

	private async startGuidedSweep(batch: ReviewImportBatch, importedGroups: ReviewImportNoteGroup[]): Promise<void> {
		const notePaths = importedGroups.map((group) => group.filePath);
		const [firstNotePath] = notePaths;
		if (!firstNotePath) {
			return;
		}

		this.store.setGuidedSweep({
			batchId: batch.batchId,
			currentNoteIndex: 0,
			notePaths,
			startedAt: Date.now(),
		});
		await this.updateSweepRegistry(batch.batchId, {
			currentNotePath: firstNotePath,
			sceneOrder: notePaths,
			status: "in_progress",
		});
		await this.openSweepNote(firstNotePath);
	}

	private async advanceGuidedSweepToNextScene(): Promise<void> {
		const guidedSweep = this.getGuidedSweep();
		if (!guidedSweep) {
			this.store.selectSuggestion(null);
			await this.revealSelectedSuggestion();
			return;
		}

		const nextNotePath = guidedSweep.notePaths[guidedSweep.currentNoteIndex + 1];
		if (!nextNotePath) {
			await this.finishGuidedSweep();
			return;
		}

		new Notice("Scene complete — continuing to next scene.");
		await this.updateSweepRegistry(guidedSweep.batchId, {
			currentNotePath: nextNotePath,
			status: "in_progress",
		});
		this.store.setGuidedSweep({
			...guidedSweep,
			currentNoteIndex: guidedSweep.currentNoteIndex + 1,
		});
		await this.openSweepNote(nextNotePath);
	}

	private async finishGuidedSweep(): Promise<void> {
		const guidedSweep = this.getGuidedSweep();
		if (!guidedSweep) {
			return;
		}

		await this.updateSweepRegistry(guidedSweep.batchId, {
			status: "completed",
		});
		this.store.setGuidedSweep(null);
		const choice = await openEditorialistChoiceModal(this.app, {
			title: "Sweep complete",
			description: "This guided sweep is complete. Keep the imported review blocks or clean up this batch now.",
			choices: [
				{ label: "Keep review blocks", value: "keep" },
				{ label: "Clean up this batch", value: "cleanup" },
			],
		});
		if (choice === "cleanup") {
			await this.cleanupReviewBatch(guidedSweep.batchId);
			return;
		}

		new Notice("Guided sweep complete.");
	}

	private async openSweepNote(filePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			return;
		}

		this.isGuidedSweepTransitioning = true;
		try {
			const leaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(true);
			await leaf.openFile(file);
			await this.parseCurrentNote({ suppressNotice: true });
		} finally {
			this.isGuidedSweepTransitioning = false;
			this.syncActiveEditorDecorations();
		}
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
		const batchId = this.getCurrentBatchId();
		if (!batchId) {
			new Notice("No imported review batch is active.");
			return;
		}

		await this.cleanupReviewBatch(batchId);
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
		await this.syncSceneReviewIndex();
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

		await this.updateSweepRegistry(batchId, {
			status: "cleaned_up",
			cleanedAt: Date.now(),
		});
		if (this.getGuidedSweep()?.batchId === batchId) {
			this.store.setGuidedSweep(null);
		}
		await this.syncSceneReviewIndex();
		this.resyncSessionForActiveNote();
		new Notice(
			removedCount > 0
				? `Cleaned up ${removedCount} imported review block${removedCount === 1 ? "" : "s"}.`
				: "No imported review blocks were found for this batch.",
		);
	}

	private resetReviewSession(): void {
		this.activeHighlightRange = null;
		this.store.clearSession();
		this.syncActiveEditorDecorations();
		this.refreshReviewPanel();
		new Notice("Review session reset.");
	}
}
